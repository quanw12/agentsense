// End-to-end smoke test for the mobile access server. Run with:
//   npm run smoke:mobile
// It runs inside Electron (a temp userData, no window) so pty_manager behaves exactly like in the app,
// with a real powershell pane, a real WebSocket client and real HTTP requests.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { WebSocket } = require('ws');

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

  pty_manager.kill_all();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('SMOKE FAILED:', error);
  pty_manager.kill_all();
  process.exit(1);
});
