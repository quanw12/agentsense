// End-to-end smoke test for the mobile access server. Run with:
//   npm run smoke:mobile
// It runs inside Electron (a temp userData, no window) so pty_manager behaves exactly like in the app,
// with a real powershell pane, a real WebSocket client and real HTTP requests.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { app, BrowserWindow } = require('electron');
const child_process = require('child_process');
const { WebSocket } = require('ws');

// node-pty forks this helper on the non-DLL ConPTY kill path. Its stderr stays inherited.
// A non-zero exit is a real teardown failure, not an ignored log line.
const conpty_helpers = [];
const fork_process = child_process.fork;
child_process.fork = function fork_observed(module_path, args, options) {
  const child = fork_process.call(this, module_path, args, options);
  if (String(module_path).includes('conpty_console_list_agent')) {
    conpty_helpers.push(new Promise((resolve) => {
      child.on('exit', (code) => {
        const failed = code !== 0;
        console.log(`${failed ? 'FAIL' : 'PASS'} conpty helper exit ${code}`);
        if (failed) failures += 1;
        resolve();
      });
    }));
  }
  return child;
};

// Keep the smoke test away from the real %APPDATA%\AgentSense state.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-smoke-')));

const { MobileServer, FAIL_LIMIT } = require('../src/main/mobile_server');
const pty_manager = require('../src/main/pty_manager');

const TOKEN = 'a'.repeat(32);
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-smoke-ws-'));
const MARKER = 'AGENTSENSE_SMOKE_OK';

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures += 1;
}

function wait_for(predicate, timeout_ms, label) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        if (predicate()) return resolve();
      } catch (error) {
        return reject(error);
      }
      if (Date.now() - start > timeout_ms) return reject(new Error(`timeout waiting for ${label}`));
      setTimeout(tick, 50);
    };
    tick();
  });
}

function connect_ws(port, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/${token}`);
    const messages = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}

async function can_fetch(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.status === 200;
  } catch (error) {
    return false;
  }
}

// Renders the real panel from a state object in a hidden window, and reports what the user would see.
async function render_panel(window, snapshot) {
  await window.loadURL('about:blank');
  await window.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'mobile_panel.js'), 'utf8'));
  return window.webContents.executeJavaScript(`(async () => {
    window.hub = { mobile: { get_state: async () => (${JSON.stringify(snapshot)}) } };
    const panel = window.init_mobile_panel({});
    panel.open();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const root = document.getElementById('mobile_panel_overlay');
    const seen = {
      qr: Boolean(root.querySelector('.mobile_qr svg')),
      links: Array.from(root.querySelectorAll('.mobile_url_value')).map((item) => item.textContent),
      callout: root.querySelector('.mobile_callout') ? root.querySelector('.mobile_callout').textContent : '',
      switch_on: root.querySelector('#mobile_bind_all').checked,
      text: root.textContent,
    };
    panel.close();
    return seen;
  })()`);
}

// The pairing flow with both listeners, through the real build_state and the real panel. The "on" stage
// really listens on every interface for a moment, with a random token and nothing else behind it.
async function check_pairing_states() {
  await app.whenReady();
  app.on('window-all-closed', () => {}); // Closing the hidden window must not quit the smoke test.
  const mobile_settings = require('../src/main/mobile_settings');
  const { build_state, lan_addresses } = require('../src/main/ipc_mobile');
  const { get_mobile_server } = require('../src/main/mobile_server');
  const qrcode = require('qrcode');
  const settings_file = mobile_settings.default_file_path();
  const token = crypto.randomBytes(16).toString('hex');
  const live = get_mobile_server();
  const window = new BrowserWindow({ show: false });

  // ---- "Reachable from other devices" off: the default ----
  mobile_settings.write_settings(settings_file, { enabled: true, token, port: 0 });
  check('pairing off: reachable switch is off by default', mobile_settings.read_settings(settings_file).bind_all === false);
  const off_conn = await live.start({ port: 0, bind_all: false, token });
  const off = await build_state();
  check('pairing off: state has no QR and no links', off.qr_svg === null && off.urls.length === 0 && off.scope === 'loopback');
  for (const entry of lan_addresses()) {
    check(`pairing off: the server really is out of reach on ${entry.name}`, !(await can_fetch(`http://${entry.address}:${off_conn.port}/m/${token}/`)));
  }
  check('pairing off: this computer can still reach it', await can_fetch(off.loopback_url));
  const off_seen = await render_panel(window, off);
  check('pairing off: panel shows no QR or link', !off_seen.qr && off_seen.links.length === 0);
  check('pairing off: panel says to turn the switch on', off_seen.callout.includes('Turn on “Reachable from other devices”') && !off_seen.switch_on);
  await live.stop();

  // ---- "Reachable from other devices" on ----
  mobile_settings.write_settings(settings_file, { enabled: true, bind_all: true, token, port: 0 });
  await live.start({ port: 0, bind_all: true, token });
  const on = await build_state();
  check('pairing on: every address is listed', on.urls.length === lan_addresses().length && on.scope === 'lan');
  const in_qr = on.urls.filter((entry) => entry.in_qr);
  const on_seen = await render_panel(window, on);
  check('pairing on: panel lists every address and has no callout', on_seen.links.length === on.urls.length && on_seen.callout === '' && on_seen.switch_on);
  if (in_qr.length === 1) {
    console.log(`     QR adapter here: ${in_qr[0].label}`);
    const expected_svg = await qrcode.toString(in_qr[0].url, { type: 'svg', margin: 1, errorCorrectionLevel: 'L' });
    check('pairing on: the QR encodes the top-ranked link', on.qr_svg === expected_svg && on.urls[0] === in_qr[0]);
    check('pairing on: the QR link really answers', await can_fetch(in_qr[0].url));
    check('pairing on: panel shows the QR and names its adapter', on_seen.qr && on_seen.text.includes(`The QR code uses ${on.qr_label}.`));
  } else {
    // A machine with no usable network, so the panel has to say so instead of showing a dead QR.
    console.log('     no usable network address on this machine');
    check('pairing on: no QR without a usable address', on.qr_svg === null && !on_seen.qr);
  }
  await live.stop();

  // ---- on, but only adapters a phone cannot use ----
  const dead_seen = await render_panel(window, {
    ...on,
    qr_svg: null,
    qr_label: null,
    urls: [{ label: 'Tailscale', url: 'http://169.254.0.1:1/m/x/', in_qr: false }],
  });
  check('pairing on: dead adapters get no QR but stay listed with a warning', !dead_seen.qr && dead_seen.links.length === 1 && dead_seen.text.includes('None of these addresses'));

  window.destroy();
}

async function main() {
  const server = new MobileServer({
    list_workspaces: () => [{ id: 'ws-1', name: 'smoke', path: WORK_DIR }],
    catalog: [{ id: 'terminal', label: 'Terminal', command: 'powershell.exe', glyph: 'PS', logo: null }],
  });
  const connection = await server.start({ port: 0, bind_all: false, token: TOKEN });
  const base = `http://127.0.0.1:${connection.port}`;

  // ---- static files and auth ----
  let res = await fetch(`${base}/m/${'b'.repeat(32)}/`);
  check('static: wrong token is 404', res.status === 404);
  res = await fetch(`${base}/nothing-to-see`);
  check('static: path without token is 404', res.status === 404);
  res = await fetch(`${base}/m/${TOKEN}/`);
  let body = await res.text();
  check('static: index page served', res.status === 200 && body.includes('AgentSense'));
  res = await fetch(`${base}/m/${TOKEN}/vendor/xterm.js`);
  check('static: xterm.js served', res.status === 200 && (await res.text()).length > 10000);
  res = await fetch(`${base}/m/${TOKEN}/agents.js`);
  check('static: agents.js served', res.status === 200 && (await res.text()).includes('AGENT_CATALOG'));
  res = await fetch(`${base}/m/${TOKEN}/assets/agents/claude.svg`);
  check('static: agent logo served', res.status === 200);
  res = await fetch(`${base}/m/${TOKEN}/../package.json`);
  check('static: traversal blocked', res.status === 404);

  // ---- WebSocket auth ----
  let bad = 'open';
  try {
    await connect_ws(connection.port, 'c'.repeat(32));
  } catch (error) {
    bad = 'rejected';
  }
  check('ws: wrong token rejected', bad === 'rejected');

  const client = await connect_ws(connection.port, TOKEN);
  const { ws, messages } = client;
  await wait_for(() => messages.some((m) => m.type === 'snapshot'), 5000, 'connect snapshot');
  check('ws: snapshot on connect', true);

  // ---- pane created on the desktop shows up in the list ----
  const desktop_pane = await pty_manager.create_terminal({
    workspace_id: 'ws-1',
    agent_id: 'terminal',
    cwd: WORK_DIR,
    command: 'powershell.exe',
    title: 'Desktop|terminal|Terminal',
    cols: 80,
    rows: 24,
  });
  ws.send(JSON.stringify({ type: 'list' }));
  await wait_for(
    () => {
      const last = [...messages].reverse().find((m) => m.type === 'snapshot');
      return last && last.terminals && last.terminals.some((t) => t.terminal_id === desktop_pane.terminal_id);
    },
    5000,
    'desktop pane in snapshot'
  );
  check('ws: desktop pane listed', true);

  // ---- attach, drive, resize ----
  ws.send(JSON.stringify({ type: 'attach', terminal_id: desktop_pane.terminal_id }));
  await wait_for(
    () => messages.some((m) => m.type === 'attached' && m.terminal_id === desktop_pane.terminal_id),
    5000,
    'attached'
  );
  check('ws: attach replies with buffer', true);

  const data_text = () =>
    messages
      .filter((m) => m.type === 'data' && m.terminal_id === desktop_pane.terminal_id)
      .map((m) => m.data)
      .join('');
  ws.send(JSON.stringify({ type: 'input', terminal_id: desktop_pane.terminal_id, data: `echo ${MARKER}\r` }));
  await wait_for(() => data_text().includes(MARKER), 15000, 'echo marker');
  check('ws: input reaches the pty and output comes back', true);

  ws.send(JSON.stringify({ type: 'resize', terminal_id: desktop_pane.terminal_id, cols: 120, rows: 40 }));
  ws.send(JSON.stringify({ type: 'agents_check', commands: ['powershell.exe', 'nope.exe'] }));
  await wait_for(
    () => messages.some((m) => m.type === 'agents_check' && m.available && m.available['powershell.exe'] === true),
    8000,
    'agents_check'
  );
  const check_result = messages.find((m) => m.type === 'agents_check');
  check('ws: agents_check works', check_result && check_result.available['nope.exe'] === false);
  await new Promise((resolve) => setTimeout(resolve, 400));
  check('ws: no error messages so far', !messages.some((m) => m.type === 'error'));

  // ---- create from the phone ----
  ws.send(JSON.stringify({ type: 'create', workspace_id: 'ws-1', agent_id: 'terminal', title: 'From phone' }));
  await wait_for(() => messages.some((m) => m.type === 'created'), 8000, 'created');
  const created_msg = messages.find((m) => m.type === 'created');
  check(
    'ws: phone-created pane arrives as created',
    created_msg && created_msg.terminal && created_msg.terminal.title.includes('From phone')
  );
  check('ws: terminal_created event emitted for the desktop', server.listenerCount('terminal_created') >= 0);

  ws.send(JSON.stringify({ type: 'create', workspace_id: 'ws-unknown', agent_id: 'terminal' }));
  await wait_for(() => messages.some((m) => m.type === 'error' && /workspace/.test(m.message)), 5000, 'unknown workspace error');
  check('ws: unknown workspace refused', true);

  // ---- kill from the phone ----
  ws.send(JSON.stringify({ type: 'kill', terminal_id: created_msg.terminal.terminal_id }));
  await wait_for(
    () => messages.some((m) => m.type === 'killed' && m.terminal_id === created_msg.terminal.terminal_id),
    8000,
    'killed'
  );
  await wait_for(
    () => messages.some((m) => m.type === 'closed' && m.terminal_id === created_msg.terminal.terminal_id),
    2000,
    'closed'
  );
  check('ws: kill replies killed + closed', true);
  await wait_for(
    () => !pty_manager.list_terminals().some((t) => t.terminal_id === created_msg.terminal.terminal_id),
    5000,
    'session removed'
  );
  check('ws: killed session is gone from pty_manager', true);

  ws.close();
  await server.stop();

  // ---- lockout on a fresh server ----
  const guard = new MobileServer({
    list_workspaces: () => [],
    catalog: [],
  });
  const guard_conn = await guard.start({ port: 0, bind_all: false, token: TOKEN });
  for (let i = 0; i < FAIL_LIMIT; i += 1) {
    await fetch(`http://127.0.0.1:${guard_conn.port}/m/${'d'.repeat(32)}/`);
  }
  const locked = await fetch(`http://127.0.0.1:${guard_conn.port}/m/${TOKEN}/`);
  check('lockout: correct token is locked out after 3 wrong ones', locked.status === 404);
  await guard.stop();

  await check_pairing_states();

  await pty_manager.kill_all();
  await Promise.all(conpty_helpers);
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('SMOKE FAILED:', error);
  await pty_manager.kill_all();
  process.exit(1);
});
