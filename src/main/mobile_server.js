// Mobile access server: an HTTP + WebSocket server inside the Electron main process that lets a phone
// browser control the same sessions the desktop shows. The static page comes from src/mobile/ under
// /m/<token>/; terminal I/O is bridged over the WebSocket /ws/<token> (the 'ws' package).
//
// Auth follows hook_server.js: a 32-hex token in the URL path, compared with crypto.timingSafeEqual;
// three bad tokens lock new connections out for 30 s. The token lives in mobile.json (mobile_settings.js)
// so the phone stays paired across app restarts until it is rotated in the UI.
//
// Terminal I/O goes straight through pty_manager (terminal_events / write / resize / create / kill / list),
// so the phone sees exactly what the desktop sees and both can drive the same pane (last writer wins).
// Pane creation from the phone is validated: the workspace must already exist in state.json, the agent must
// be in the agent catalog (agents.js, require()d from here) and installed (command_check.js). The phone never
// picks a filesystem path itself.
//
// Emitted for the desktop renderer (wired in ipc_mobile.js):
//   'terminal_created' (info)  a pane was created from the phone
//   'terminal_killed'  ({ terminal_id })  a pane was closed from the phone (closing never emits pty 'exit')
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { WebSocketServer } = require('ws');

const pty_manager = require('./pty_manager');
const { get_hook_server } = require('./hook_server');
const { check_commands } = require('./command_check');
const { create_limiter } = require('./rate_limit');
const { create_agent_pane } = require('./pane_launch');

const TOKEN_HEX_LENGTH = 32;
const STATIC_PATTERN = new RegExp(`^\\/m\\/([0-9a-f]{${TOKEN_HEX_LENGTH}})(\\/.*)?$`);
const WS_PATTERN = new RegExp(`^\\/ws\\/([0-9a-f]{${TOKEN_HEX_LENGTH}})$`);
const AGENT_SVG_PATTERN = /^\/assets\/agents\/([A-Za-z0-9_-]+\.svg)$/;
const MAX_WS_MESSAGE_BYTES = 64 * 1024;
const MAX_INPUT_LENGTH = 8192;
const MAX_ATTACHED = 8; // per client; the mobile UI uses one at a time
const FAIL_LIMIT = 3;
const FAIL_LOCKOUT_MS = 30 * 1000;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_PANE_SIZE = 500;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};
// The page is served with a token in the URL, so nothing may be cached anywhere.
const STATIC_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function content_type_for(file_path) {
  return CONTENT_TYPES[path.extname(file_path).toLowerCase()] || 'application/octet-stream';
}

function send_plain(response, status, text) {
  if (response.headersSent) return;
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(text);
}

function clamp_size(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 && number <= MAX_PANE_SIZE ? number : fallback;
}

// The replay buffer travels only on attach; lists and broadcasts stay small.
function without_buffer(info) {
  const { buffer, ...rest } = info;
  return rest;
}

class MobileServer extends EventEmitter {
  constructor(options) {
    super();
    const opts = options || {};
    // Injectable for tests; the defaults read the real stores.
    this.list_workspaces =
      typeof opts.list_workspaces === 'function'
        ? opts.list_workspaces
        : () => require('./store').list_workspaces();
    this.catalog = Array.isArray(opts.catalog) ? opts.catalog : require('../renderer/agents');
    this.static_dir = typeof opts.static_dir === 'string' ? opts.static_dir : path.join(__dirname, '..', 'mobile');

    this.server = null;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE_BYTES });
    this.port = null;
    this.host = null;
    this.bind_all = false;
    this.token = null;
    this.limiter = create_limiter({ limit: FAIL_LIMIT, lock_ms: FAIL_LOCKOUT_MS });
    this.clients = new Set(); // open WebSocket clients
    this.subscribed = false;

    // route -> absolute file path. A fixed whitelist, so no request path can escape it.
    this.static_routes = new Map([
      ['/', path.join(this.static_dir, 'index.html')],
      ['/index.html', path.join(this.static_dir, 'index.html')],
      ['/app.js', path.join(this.static_dir, 'app.js')],
      ['/styles.css', path.join(this.static_dir, 'styles.css')],
      ['/manifest.webmanifest', path.join(this.static_dir, 'manifest.webmanifest')],
      ['/agents.js', path.join(__dirname, '..', 'renderer', 'agents.js')],
      ['/vendor/xterm.js', require.resolve('@xterm/xterm/lib/xterm.js')],
      ['/vendor/xterm.css', require.resolve('@xterm/xterm/css/xterm.css')],
      ['/vendor/addon-fit.js', require.resolve('@xterm/addon-fit/lib/addon-fit.js')],
      ['/icon.png', path.join(__dirname, '..', '..', 'build', 'icon.png')],
    ]);
    this.agents_assets_dir = path.join(__dirname, '..', 'renderer', 'assets', 'agents');
  }

  // options: { port, bind_all, token }. Resolves with { port, token, bind_all } once listening.
  start(options) {
    if (this.server) return Promise.resolve(this.get_connection());
    const opts = options || {};
    if (typeof opts.token === 'string' && opts.token.trim() !== '') this.token = opts.token.trim();
    this.bind_all = opts.bind_all === true;
    const host = this.bind_all ? '0.0.0.0' : '127.0.0.1';
    const port = Number.isInteger(opts.port) && opts.port >= 0 && opts.port <= 65535 ? opts.port : 0;
    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => this.handle_request(request, response));
      server.on('upgrade', (request, socket, head) => this.handle_upgrade(request, socket, head));
      server.once('error', (error) => {
        if (!this.server) reject(error);
      });
      server.listen(port, host, () => {
        this.server = server;
        this.port = server.address().port;
        this.host = host;
        this.subscribe_events();
        resolve(this.get_connection());
      });
    });
  }

  stop() {
    for (const ws of Array.from(this.clients)) {
      try {
        ws.close(1001, 'server stopping');
      } catch (error) {
        /* already gone */
      }
    }
    this.clients.clear();
    const server = this.server;
    this.server = null;
    this.port = null;
    this.host = null;
    return new Promise((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
  }

  // { port, token, bind_all } while listening, otherwise null.
  get_connection() {
    if (!this.server || this.port === null || !this.token) return null;
    return { port: this.port, token: this.token, bind_all: this.bind_all };
  }

  client_count() {
    return this.clients.size;
  }

  // Called after a token rotation: the old pairing link stops working immediately.
  set_token(token) {
    this.token = typeof token === 'string' && token.trim() !== '' ? token.trim() : this.token;
    this.kick_all();
  }

  kick_all() {
    for (const ws of Array.from(this.clients)) {
      try {
        ws.close(4001, 'token rotated');
      } catch (error) {
        /* already gone */
      }
    }
    this.clients.clear();
  }

  token_matches(candidate) {
    if (typeof this.token !== 'string' || candidate.length !== this.token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(this.token, 'utf8'));
  }

  is_locked(request) {
    return this.limiter.is_locked(request || { socket: { remoteAddress: 'unknown' } });
  }

  // Wrong tokens are counted per remote address. One source cannot lock out another.
  note_fail(request) {
    this.limiter.note_fail(request || { socket: { remoteAddress: 'unknown' } });
  }

  // One subscription for the life of the process; the fan-out is filtered per client.
  subscribe_events() {
    if (this.subscribed) return;
    this.subscribed = true;
    pty_manager.terminal_events.on('data', (terminal_id, data) => {
      this.broadcast_attached(terminal_id, { type: 'data', terminal_id, data });
    });
    pty_manager.terminal_events.on('exit', (terminal_id, exit_code) => {
      this.broadcast_all({ type: 'exit', terminal_id, exit_code });
    });
    get_hook_server().on('status', (terminal_id, info) => {
      this.broadcast_all({ type: 'status', terminal_id, info });
    });
  }

  find_terminal(terminal_id) {
    if (typeof terminal_id !== 'string' || terminal_id === '') return null;
    return pty_manager.list_terminals().find((info) => info.terminal_id === terminal_id) || null;
  }

  build_snapshot() {
    let workspaces = [];
    try {
      workspaces = this.list_workspaces();
    } catch (error) {
      console.error(`mobile: could not list workspaces: ${error && error.message ? error.message : error}`);
    }
    const terminals = pty_manager.list_terminals().map(without_buffer);
    let status = {};
    try {
      status = get_hook_server().get_status();
    } catch (error) {
      console.error(`mobile: could not read hook status: ${error && error.message ? error.message : error}`);
    }
    return { workspaces, terminals, status };
  }

  handle_request(request, response) {
    let pathname = '/';
    try {
      pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
    } catch (error) {
      request.resume();
      return send_plain(response, 400, 'bad request');
    }
    const match = STATIC_PATTERN.exec(pathname);
    if (!match) {
      request.resume();
      return send_plain(response, 404, 'not found');
    }
    if (!this.token || !this.token_matches(match[1]) || this.is_locked(request)) {
      this.note_fail(request);
      request.resume();
      return send_plain(response, 404, 'not found');
    }
    this.limiter.note_ok(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      request.resume();
      return send_plain(response, 405, 'method not allowed');
    }
    const route = match[2] || '/';
    const file = this.static_routes.get(route) || this.agent_svg_file(route);
    if (!file) {
      request.resume();
      return send_plain(response, 404, 'not found');
    }
    return this.serve_file(response, file, request.method === 'HEAD');
  }

  agent_svg_file(route) {
    const match = AGENT_SVG_PATTERN.exec(route);
    if (!match) return null;
    return path.join(this.agents_assets_dir, match[1]);
  }

  serve_file(response, file_path, head_only) {
    fs.readFile(file_path, (error, data) => {
      if (error || response.destroyed) {
        if (!response.headersSent && !response.destroyed) send_plain(response, 404, 'not found');
        return;
      }
      response.writeHead(200, {
        'Content-Type': content_type_for(file_path),
        'Content-Length': data.length,
        // xterm injects inline styles; the WebSocket talks to the same origin.
        'Content-Security-Policy':
          "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:",
        ...STATIC_HEADERS,
      });
      response.end(head_only ? undefined : data);
    });
  }

  handle_upgrade(request, socket, head) {
    let pathname = '/';
    try {
      pathname = new URL(request.url || '/', 'http://localhost').pathname;
    } catch (error) {
      socket.destroy();
      return;
    }
    const match = WS_PATTERN.exec(pathname);
    if (!match) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!this.token || !this.token_matches(match[1]) || this.is_locked(request)) {
      this.note_fail(request);
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => this.setup_socket(ws));
  }

  setup_socket(ws) {
    ws.attached = new Set();
    this.clients.add(ws);
    ws.on('message', (data, is_binary) => {
      if (is_binary) {
        ws.close(1003, 'binary messages not supported');
        return;
      }
      if (data.length > MAX_WS_MESSAGE_BYTES) {
        ws.close(1009, 'message too large');
        return;
      }
      this.handle_message(ws, data.toString('utf8'));
    });
    ws.on('close', () => {
      this.clients.delete(ws);
    });
    ws.on('error', () => {
      this.clients.delete(ws);
      try {
        ws.terminate();
      } catch (error) {
        /* already gone */
      }
    });
    // Greet with the current snapshot, so the first render needs no round trip.
    this.send_to(ws, { type: 'snapshot', ...this.build_snapshot() });
  }

  handle_message(ws, text) {
    let msg = null;
    try {
      msg = JSON.parse(text);
    } catch (error) {
      return this.send_to(ws, { type: 'error', message: 'bad json' });
    }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
      return this.send_to(ws, { type: 'error', message: 'bad message' });
    }
    switch (msg.type) {
      case 'list':
        return this.send_to(ws, { type: 'snapshot', ...this.build_snapshot() });
      case 'attach':
        return this.handle_attach(ws, msg);
      case 'detach':
        if (typeof msg.terminal_id === 'string') ws.attached.delete(msg.terminal_id);
        return undefined;
      case 'input':
        return this.handle_input(ws, msg);
      case 'resize':
        return this.handle_resize(ws, msg);
      case 'create':
        return this.handle_create(ws, msg);
      case 'kill':
        return this.handle_kill(ws, msg);
      case 'agents_check':
        return this.handle_agents_check(ws, msg);
      default:
        return this.send_to(ws, { type: 'error', message: `unknown type: ${msg.type.slice(0, 40)}` });
    }
  }

  handle_attach(ws, msg) {
    const info = this.find_terminal(msg.terminal_id);
    if (!info) return this.send_to(ws, { type: 'error', message: 'unknown terminal' });
    if (!ws.attached.has(info.terminal_id) && ws.attached.size >= MAX_ATTACHED) {
      return this.send_to(ws, { type: 'error', message: 'too many attached terminals' });
    }
    // Buffer first, then live routing: no await in between, so no data chunk can slip in front of the replay.
    this.send_to(ws, {
      type: 'attached',
      terminal_id: info.terminal_id,
      buffer: info.buffer,
      alive: info.alive,
      exit_code: info.exit_code,
    });
    ws.attached.add(info.terminal_id);
    return undefined;
  }

  handle_input(ws, msg) {
    if (typeof msg.data !== 'string' || msg.data.length === 0) {
      return this.send_to(ws, { type: 'error', message: 'input must be a non-empty string' });
    }
    if (msg.data.length > MAX_INPUT_LENGTH) {
      return this.send_to(ws, { type: 'error', message: 'input too long' });
    }
    if (!this.find_terminal(msg.terminal_id)) {
      return this.send_to(ws, { type: 'error', message: 'unknown terminal' });
    }
    pty_manager.write_terminal(msg.terminal_id, msg.data);
    return undefined;
  }

  handle_resize(ws, msg) {
    if (!this.find_terminal(msg.terminal_id)) {
      return this.send_to(ws, { type: 'error', message: 'unknown terminal' });
    }
    const result = pty_manager.resize_terminal(
      msg.terminal_id,
      clamp_size(msg.cols, DEFAULT_COLS),
      clamp_size(msg.rows, DEFAULT_ROWS),
      'mobile'
    );
    return this.send_to(ws, { type: 'resized', terminal_id: msg.terminal_id, result });
  }

  // The phone picks only a workspace id and an agent id; the folder and the command line come from
  // state.json and the catalog. A missing agent is reported instead of spawning a shell error.
  async handle_create(ws, msg) {
    let info = null;
    try {
      info = await create_agent_pane(
        { list_workspaces: this.list_workspaces, catalog: this.catalog, check_commands, pty: pty_manager },
        { workspace_id: msg.workspace_id, agent_id: msg.agent_id, title: msg.title }
      );
    } catch (error) {
      return this.send_to(ws, { type: 'error', message: error.message });
    }
    // The phone replays the buffer on attach; the desktop broadcast carries it so its pane can too.
    this.broadcast_all({ type: 'created', terminal: without_buffer(info) });
    this.emit('terminal_created', info);
    return undefined;
  }

  async handle_kill(ws, msg) {
    const terminal_id = typeof msg.terminal_id === 'string' ? msg.terminal_id : '';
    if (!this.find_terminal(terminal_id)) {
      return this.send_to(ws, { type: 'error', message: 'unknown terminal' });
    }
    const result = await pty_manager.kill_terminal(terminal_id).catch((error) => ({
      worktree_removed: false,
      worktree_path: null,
      worktree_kept_reason: error && error.message ? error.message : String(error),
    }));
    this.send_to(ws, { type: 'killed', terminal_id, result });
    this.broadcast_all({ type: 'closed', terminal_id });
    this.emit('terminal_killed', { terminal_id });
    return undefined;
  }

  async handle_agents_check(ws, msg) {
    try {
      const available = await check_commands(msg.commands);
      this.send_to(ws, { type: 'agents_check', available });
    } catch (error) {
      this.send_to(ws, { type: 'error', message: error && error.message ? error.message : 'agents check failed' });
    }
  }

  send_to(ws, message) {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      try {
        ws.close();
      } catch (close_error) {
        /* already gone */
      }
    }
  }

  broadcast_all(message) {
    for (const ws of this.clients) this.send_to(ws, message);
  }

  // Only clients that attached this terminal receive its output, so a phone on mobile data
  // does not stream panes it is not looking at.
  broadcast_attached(terminal_id, message) {
    for (const ws of this.clients) {
      if (ws.attached && ws.attached.has(terminal_id)) this.send_to(ws, message);
    }
  }
}

// The one server the app uses. Created lazily; ipc_mobile.js starts and stops it.
let default_server = null;
function get_mobile_server() {
  if (!default_server) default_server = new MobileServer();
  return default_server;
}

module.exports = { MobileServer, get_mobile_server, TOKEN_HEX_LENGTH, FAIL_LIMIT, FAIL_LOCKOUT_MS };
