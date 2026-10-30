// Local HTTP server that receives Claude Code hook calls and turns them into pane status.
// Listens on 127.0.0.1 only, on a random port, and requires a random secret token in the path.
// POST /hook/<token>/<terminal_id>/<EventName>, body = the hook JSON that Claude Code sends on stdin.
//
// Status info per registered terminal: { status, session_id, detail, updated_at (ms) }.
// status: 'working' | 'waiting' | 'done' | 'idle' | 'ended'.
// updated_at is the time of the last hook event. The done -> idle change keeps it, so it counts from when Claude
// finished.
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DONE_TO_IDLE_MS = 120000;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_DETAIL_LENGTH = 200;
const TOKEN_HEX_LENGTH = 32;
const REQUEST_PATTERN = /^\/hook\/([0-9a-f]{32})\/([A-Za-z0-9-]{1,64})\/([A-Za-z]{1,40})$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// Event name -> status. Notification takes its detail from the payload message.
const EVENT_TO_STATUS = {
  SessionStart: { status: 'working', detail: 'started' },
  UserPromptSubmit: { status: 'working', detail: null },
  Notification: { status: 'waiting', detail: null, detail_from_message: true },
  Stop: { status: 'done', detail: null },
  SessionEnd: { status: 'ended', detail: null },
};

function is_plain_object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function copy_info(info) {
  return Object.assign({}, info);
}

class HookServer extends EventEmitter {
  constructor(options) {
    super();
    const opts = options || {};
    this.done_to_idle_ms = typeof opts.done_to_idle_ms === 'number' ? opts.done_to_idle_ms : DONE_TO_IDLE_MS;
    this.server = null;
    this.port = null;
    this.token = null;
    this.terminals = new Map(); // terminal_id -> { info: null | info, timer: null }
  }

  // Starts listening. Resolves with { port, token }. A new token is made on every start.
  start() {
    if (this.server) return Promise.resolve(this.get_connection());
    this.token = crypto.randomBytes(TOKEN_HEX_LENGTH / 2).toString('hex');
    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => this.handle_request(request, response));
      server.once('error', (error) => {
        this.server = null;
        reject(error);
      });
      server.listen(0, '127.0.0.1', () => {
        this.server = server;
        this.port = server.address().port;
        resolve(this.get_connection());
      });
    });
  }

  stop() {
    for (const entry of this.terminals.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.terminals.clear();
    const server = this.server;
    this.server = null;
    this.port = null;
    this.token = null;
    return new Promise((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
  }

  // { port, token } while listening, otherwise null.
  get_connection() {
    if (!this.server || this.port === null) return null;
    return { port: this.port, token: this.token };
  }

  // Only registered terminals are accepted by POST. Registering does not create a status entry.
  register_terminal(terminal_id) {
    if (!this.terminals.has(terminal_id)) {
      this.terminals.set(terminal_id, { info: null, timer: null });
    }
  }

  unregister_terminal(terminal_id) {
    const entry = this.terminals.get(terminal_id);
    if (entry && entry.timer) clearTimeout(entry.timer);
    this.terminals.delete(terminal_id);
  }

  // Called when a pane's process exits (any agent). Emits 'ended' once.
  set_ended(terminal_id) {
    let entry = this.terminals.get(terminal_id);
    if (!entry) {
      entry = { info: null, timer: null };
      this.terminals.set(terminal_id, entry);
    }
    if (entry.info && entry.info.status === 'ended') return;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    const session_id = entry.info ? entry.info.session_id : null;
    this.set_info(terminal_id, entry, { status: 'ended', session_id, detail: null });
  }

  // { [terminal_id]: info } for every terminal that has a status.
  get_status() {
    const result = {};
    for (const [terminal_id, entry] of this.terminals) {
      if (entry.info) result[terminal_id] = copy_info(entry.info);
    }
    return result;
  }

  set_info(terminal_id, entry, fields) {
    entry.info = {
      status: fields.status,
      session_id: fields.session_id === undefined ? null : fields.session_id,
      detail: fields.detail === undefined ? null : fields.detail,
      updated_at: fields.updated_at === undefined ? Date.now() : fields.updated_at,
    };
    this.emit('status', terminal_id, copy_info(entry.info));
    return entry.info;
  }

  // Applies one hook event to a registered terminal. Returns the new info, or null when the terminal is unknown
  // or the event name is not one of the five hook events.
  apply_event(terminal_id, event_name, payload) {
    const rule = Object.prototype.hasOwnProperty.call(EVENT_TO_STATUS, event_name)
      ? EVENT_TO_STATUS[event_name]
      : null;
    const entry = this.terminals.get(terminal_id);
    if (!rule || !entry) return null;

    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }

    const body = is_plain_object(payload) ? payload : {};
    let session_id = entry.info ? entry.info.session_id : null;
    if (typeof body.session_id === 'string' && SESSION_ID_PATTERN.test(body.session_id)) {
      session_id = body.session_id;
    }
    let detail = rule.detail;
    if (rule.detail_from_message) {
      detail = typeof body.message === 'string' && body.message.trim() !== ''
        ? body.message.slice(0, MAX_DETAIL_LENGTH)
        : null;
    }

    const info = this.set_info(terminal_id, entry, { status: rule.status, session_id, detail });
    if (rule.status === 'done') {
      entry.timer = setTimeout(() => this.become_idle(terminal_id), this.done_to_idle_ms);
      if (typeof entry.timer.unref === 'function') entry.timer.unref();
    }
    return info;
  }

  become_idle(terminal_id) {
    const entry = this.terminals.get(terminal_id);
    if (!entry || !entry.info || entry.info.status !== 'done') return;
    entry.timer = null;
    this.set_info(terminal_id, entry, {
      status: 'idle',
      session_id: entry.info.session_id,
      detail: null,
      updated_at: entry.info.updated_at,
    });
  }

  handle_request(request, response) {
    const match = REQUEST_PATTERN.exec(request.url || '');
    if (!match || !this.token || !this.token_matches(match[1])) {
      request.resume();
      return send_plain(response, 404, 'not found');
    }
    if (request.method !== 'POST') {
      request.resume();
      return send_plain(response, 405, 'method not allowed');
    }
    const terminal_id = match[2];
    const event_name = match[3];
    if (!Object.prototype.hasOwnProperty.call(EVENT_TO_STATUS, event_name) || !this.terminals.has(terminal_id)) {
      request.resume();
      return send_plain(response, 404, 'not found');
    }

    const chunks = [];
    let size = 0;
    let too_large = false;
    request.on('data', (chunk) => {
      if (too_large) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        too_large = true;
        send_plain(response, 413, 'body too large');
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', () => {});
    request.on('end', () => {
      if (too_large) return;
      const text = Buffer.concat(chunks).toString('utf8');
      let payload = {};
      if (text.trim() !== '') {
        try {
          payload = JSON.parse(text);
        } catch (error) {
          return send_plain(response, 400, 'bad json');
        }
        if (!is_plain_object(payload)) return send_plain(response, 400, 'bad json');
      }
      this.apply_event(terminal_id, event_name, payload);
      return send_plain(response, 200, 'ok');
    });
  }

  token_matches(candidate) {
    if (typeof this.token !== 'string' || candidate.length !== this.token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(this.token, 'utf8'));
  }
}

function send_plain(response, status, text) {
  if (response.headersSent) return;
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(text);
}

// The one server the app uses. Created lazily; main.js starts it before the first window opens.
let default_server = null;
function get_hook_server() {
  if (!default_server) default_server = new HookServer();
  return default_server;
}

module.exports = {
  HookServer,
  get_hook_server,
  EVENT_TO_STATUS,
  DONE_TO_IDLE_MS,
  SESSION_ID_PATTERN,
};
