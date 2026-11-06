// End-to-end smoke test for the Telegram bot. Run with: npm run smoke:telegram
// Runs inside Electron (a temp userData) so pty_manager and safeStorage behave as in the app: a real powershell pane
// and the real screen rendering, driven through the real bot. Only the Telegram server is a local fake.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, safeStorage } = require('electron');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-smoke-tg-')));

const { FakeTelegram } = require('./fake_telegram');
const { TelegramBot } = require('../src/main/telegram_bot');
const { TelegramApi } = require('../src/main/telegram_api');
const { render_screen } = require('../src/main/terminal_screen');
const { HookServer } = require('../src/main/hook_server');
const { check_commands } = require('../src/main/command_check');
const settings_store = require('../src/main/telegram_settings');
const files = require('../src/main/ipc_files');
const pty_manager = require('../src/main/pty_manager');

const TOKEN = '123456789:AAFakeTokenForTheTelegramSmokeTest';
const OWNER = { id: 7001, is_bot: false, first_name: 'Owner' };
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-smoke-tg-ws-'));

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`);
  if (!ok) failures += 1;
}

async function wait_for(predicate, timeout_ms, label) {
  const started = Date.now();
  while (Date.now() - started < timeout_ms) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  console.log(`timeout waiting for ${label}`);
  return false;
}

// The real section in a hidden window, against a stand-in for the IPC layer: re-rendering must not lose typed text.
async function check_panel() {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false } });
  await window.loadURL('about:blank');
  const read = (name) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', name), 'utf8');
  await window.webContents.executeJavaScript(read('telegram_section.js'));
  await window.webContents.executeJavaScript(read('mobile_panel.js'));
  const seen = await window.webContents.executeJavaScript(`(async () => {
    const base = { enabled: false, has_token: false, paired: false, owner_name: null, notify: true, keep_awake: false, state: 'off', error: null, username: null, pair_code: null };
    let snapshot = base;
    const saved = [];
    window.hub = {
      mobile: { get_state: async () => ({ enabled: false, running: false, urls: [] }) },
      telegram: {
        get_state: async () => snapshot,
        set_token: async (token) => { saved.push(token); snapshot = { ...base, enabled: true, has_token: true, state: 'online', username: 'demo_bot' }; return snapshot; },
        new_pair_code: async () => { snapshot = { ...snapshot, pair_code: 'ABCD2345' }; return snapshot; },
        unpair: async () => { snapshot = { ...snapshot, paired: false, owner_name: null }; return snapshot; },
      },
    };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const panel = window.init_mobile_panel({});
    panel.open();
    await wait(100);
    const root = document.getElementById('mobile_panel_overlay');
    const out = {};
    let input = root.querySelector('.telegram_token_input');
    out.asks_for_token = Boolean(input) && input.type === 'password';
    input.focus();
    input.value = 'typed-so-far';
    await wait(2300); // one 2 s poll re-renders the whole panel
    input = root.querySelector('.telegram_token_input');
    out.text_survives_render = input.value === 'typed-so-far';
    out.focus_survives_render = document.activeElement === input;
    input.value = '123456789:AAtoken';
    Array.from(root.querySelectorAll('.telegram_section button')).find((item) => item.textContent === 'Save').click();
    await wait(100);
    out.saved = saved;
    out.field_is_cleared = input.value === '';
    out.shows_online = root.textContent.includes('Online as @demo_bot');
    Array.from(root.querySelectorAll('.telegram_section button')).find((item) => item.textContent === 'Get pairing code').click();
    await wait(100);
    out.shows_code = root.textContent.includes('/pair ABCD2345');
    snapshot = { ...snapshot, paired: true, owner_name: '@me', pair_code: null };
    await wait(2300);
    out.shows_paired = root.textContent.includes('Paired with @me');
    const find_unpair = () => Array.from(root.querySelectorAll('.telegram_section button')).find((item) => /npair/.test(item.textContent));
    find_unpair().click();
    await wait(50);
    out.unpair_asks_first = find_unpair().textContent === 'Confirm: unpair' && root.textContent.includes('Paired with @me');
    find_unpair().click();
    await wait(100);
    out.unpair_works = !root.textContent.includes('Paired with');
    out.warns_about_telegram = root.textContent.includes('not end-to-end encrypted');
    panel.close();
    return out;
  })()`);
  window.destroy();
  check('panel asks for the token in a password field', seen.asks_for_token);
  check('typed token survives the 2 s re-render', seen.text_survives_render);
  check('focus survives the 2 s re-render', seen.focus_survives_render);
  check('panel saves the token and clears the field', seen.saved[0] === '123456789:AAtoken' && seen.field_is_cleared, seen);
  check('panel shows the bot is online', seen.shows_online);
  check('panel shows the pairing command', seen.shows_code);
  check('panel shows who is paired', seen.shows_paired);
  check('unpair asks first, then works', seen.unpair_asks_first && seen.unpair_works, seen);
  check('panel warns that Telegram is not end-to-end encrypted', seen.warns_about_telegram);
}

function check_sealed_token() {
  check('safeStorage is available', safeStorage.isEncryptionAvailable());
  const file_path = path.join(app.getPath('userData'), 'telegram.json');
  const sealed = safeStorage.encryptString(TOKEN).toString('base64');
  settings_store.write_settings(file_path, { sealed_token: sealed, enabled: true });
  const on_disk = fs.readFileSync(file_path, 'utf8');
  check('the token is not readable on disk', !on_disk.includes(TOKEN) && !on_disk.includes(TOKEN.split(':')[1]));
  const read_back = settings_store.read_settings(file_path).sealed_token;
  check('the sealed token opens again', safeStorage.decryptString(Buffer.from(read_back, 'base64')) === TOKEN);
}

async function main() {
  await app.whenReady();
  app.on('window-all-closed', () => {}); // Closing the hidden window must not quit the smoke test.

  check_sealed_token();
  await check_panel();

  const fake = new FakeTelegram(TOKEN);
  await fake.start();
  const hooks = new HookServer();
  await hooks.start();
  const workspaces = [{ id: 'ws1', name: 'smoke', path: WORK_DIR }];
  const created = [];
  const killed = [];
  const bot = new TelegramBot({
    panes: pty_manager,
    hooks,
    list_workspaces: () => workspaces,
    catalog: require('../src/renderer/agents'),
    check_commands,
    render_screen,
    files,
    create_api: () => new TelegramApi({ token: TOKEN, base_url: fake.base_url }),
    timing: { follow_interval_ms: 300, notify_settle_ms: 100, follow_quiet_ms: 2000 },
  });
  bot.on('terminal_created', (info) => created.push(info));
  bot.on('terminal_killed', (info) => killed.push(info));
  bot.start({ token: TOKEN, owner_id: OWNER.id });
  await wait_for(() => fake.waiter, 10000, 'first poll');

  const message = (text) => ({ message: { message_id: 1, date: Math.floor(Date.now() / 1000), from: OWNER, chat: { id: OWNER.id, type: 'private' }, text } });
  const press = (data) => fake.push({ callback_query: { id: 'cb', from: OWNER, data, message: { message_id: 500, chat: { id: OWNER.id, type: 'private' } } } });

  // Start a real PowerShell pane from chat.
  fake.push(message('/new'));
  check('/new offers the workspace', await wait_for(() => fake.said().some((text) => /which workspace/.test(text)), 5000, 'workspace picker'));
  fake.flush();
  const workspace_button = fake.sent().slice(-1)[0].params.reply_markup.inline_keyboard[0][0];
  await wait_for(() => fake.waiter, 2000, 'poll');
  press(workspace_button.callback_data);
  check('/new offers installed agents', await wait_for(() => fake.sent('editMessageText').length > 0, 30000, 'agent picker'));
  const agents = fake.sent('editMessageText').slice(-1)[0].params.reply_markup.inline_keyboard.flat();
  const terminal_button = agents.find((button) => button.text === 'Terminal');
  check('the terminal agent is offered', Boolean(terminal_button), agents);
  await wait_for(() => fake.waiter, 2000, 'poll');
  press(terminal_button.callback_data);
  check('the pane starts', await wait_for(() => created.length === 1, 30000, 'pane'));
  const terminal_id = created[0].terminal_id;
  check('the pane runs in the saved folder', pty_manager.list_terminals()[0].cwd === WORK_DIR, pty_manager.list_terminals()[0].cwd);

  // Let the prompt appear, then drive it with a plain chat message.
  await wait_for(() => /PS .*>/.test(pty_manager.list_terminals()[0].buffer), 30000, 'prompt');
  await wait_for(() => fake.waiter, 5000, 'poll');
  fake.push(message('Write-Output ("TELEGRAM" + "_SMOKE_" + (6*7))'));
  check('chat input runs in the real pane', await wait_for(
    () => pty_manager.list_terminals()[0].buffer.includes('TELEGRAM_SMOKE_42'),
    20000,
    'command output'
  ));
  const seen_on_screen = () => [...fake.said(), ...fake.sent('editMessageText').map((call) => call.params.text)];
  check('the real output reaches the chat', await wait_for(
    () => seen_on_screen().some((text) => /<pre>[\s\S]*^TELEGRAM_SMOKE_42$/m.test(text)),
    20000,
    'screen update'
  ), seen_on_screen().slice(-1)[0]);
  const last_screen = seen_on_screen().slice(-1)[0];
  check('the chat shows no raw escape codes', !last_screen.includes('\x1b') && !/\[\d+;\d+H/.test(last_screen), last_screen);

  // A key button reaches the pane: Ctrl+C interrupts a long sleep, so the next command runs.
  const handle = bot.handle_for(`pane:${terminal_id}`);
  await wait_for(() => fake.waiter, 5000, 'poll');
  fake.push(message('Start-Sleep -Seconds 300'));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await wait_for(() => fake.waiter, 5000, 'poll');
  press(`k:${handle}:ctrlc`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await wait_for(() => fake.waiter, 5000, 'poll');
  fake.push(message('Write-Output ("AFTER" + "_CTRL_C")'));
  check('the ^C button interrupts the running command', await wait_for(
    () => pty_manager.list_terminals()[0].buffer.includes('AFTER_CTRL_C'),
    20000,
    'after ctrl c'
  ));

  // A real hook event produces a notification.
  hooks.register_terminal(terminal_id);
  hooks.apply_event(terminal_id, 'Notification', { message: 'Permission needed' });
  check('a hook event notifies the chat', await wait_for(
    () => fake.said().some((text) => text.includes('Permission needed')),
    5000,
    'notification'
  ));

  // Closing needs the confirm button and really ends the pane.
  await wait_for(() => fake.waiter, 5000, 'poll');
  fake.push(message('/close'));
  check('/close asks first', await wait_for(() => fake.said().some((text) => text.startsWith('Close ')), 5000, 'close prompt'));
  check('the pane is still running after /close', pty_manager.list_terminals().length === 1);
  await wait_for(() => fake.waiter, 5000, 'poll');
  press(`c:${handle}`);
  check('the confirm button closes the real pane', await wait_for(() => pty_manager.list_terminals().length === 0, 30000, 'pane closed'));
  check('the close is announced to the desktop', killed.length === 1 && killed[0].terminal_id === terminal_id);

  const started = Date.now();
  await bot.stop();
  check('stop returns promptly', Date.now() - started < 3000);
  await hooks.stop();
  await fake.stop();
  await pty_manager.kill_all();
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('SMOKE FAILED:', error);
  await pty_manager.kill_all();
  process.exit(1);
});
