// Checks for the Telegram bot against a fake Bot API and fake panes. Needs node_modules (@xterm/headless), not Electron.
// Run with: npm run check:telegram
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('events');

const { FakeTelegram } = require('./fake_telegram');
const { TelegramBot, is_secret_path, keep_tail, PAIR_MAX_TRIES } = require('../src/main/telegram_bot');
const { TelegramApi } = require('../src/main/telegram_api');
const { render_screen } = require('../src/main/terminal_screen');
const settings_store = require('../src/main/telegram_settings');
const files = require('../src/main/ipc_files');

const TOKEN = '123456789:AAFakeTokenForTheTelegramBotChecks';
const OWNER = { id: 7001, is_bot: false, first_name: 'Owner', username: 'owner_user' };
const STRANGER = { id: 9009, is_bot: false, first_name: 'Stranger' };

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`);
  if (!ok) failed += 1;
}

async function wait_for(predicate, label) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  console.log(`timeout waiting for ${label}`);
  return false;
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms || 120));

function make_panes() {
  const panes = {
    terminal_events: new EventEmitter(),
    list: [],
    writes: [],
    killed: [],
    created: [],
    list_terminals() {
      return panes.list;
    },
    write_terminal(terminal_id, data) {
      panes.writes.push({ terminal_id, data });
    },
    async kill_terminal(terminal_id) {
      panes.killed.push(terminal_id);
      panes.list = panes.list.filter((info) => info.terminal_id !== terminal_id);
      return { worktree_removed: false, worktree_path: null, worktree_kept_reason: null };
    },
    async create_terminal(opts) {
      panes.created.push(opts);
      const terminal_id = `new-${panes.created.length}`;
      panes.list.push(make_pane(terminal_id, opts.title, opts.cwd, ''));
      return { terminal_id };
    },
  };
  return panes;
}

function make_pane(terminal_id, title, cwd, buffer) {
  return { terminal_id, workspace_id: 'ws1', agent_id: 'claude', title, cwd, alive: true, exit_code: null, buffer, cols: 80, rows: 24 };
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-telegram-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-telegram-out-'));

function chat_of(user) {
  return { id: user.id, type: 'private' };
}
function now_s() {
  return Math.floor(Date.now() / 1000);
}

async function main() {
  // ---- pure helpers ----
  const screen = await render_screen('first line\r\nold text\x1b[1A\r\x1b[2Knew first\x1b[1B\r\x1b[2Ksecond\x1b[?2004h', 40, 6);
  check('screen replays cursor moves instead of showing raw escapes', screen.text === 'new first\nsecond', screen.text);
  check('screen reports bracketed paste mode', screen.bracketed_paste === true);
  const plain = await render_screen('hello', 40, 6);
  check('screen reports no bracketed paste when not asked', plain.bracketed_paste === false);
  check('tail keeps the end of long text', keep_tail(`old\n${'x'.repeat(50)}\nnew`, 10).endsWith('new'));

  for (const secret of ['.env', '.env.local', 'config/.env.production', 'id_rsa', 'id_ed25519.pub', 'server.pem', 'a/b.key',
    '.git/config', '.ssh/known_hosts', '.npmrc', 'secrets.json', 'aws_credentials', '.ENV', '.env.', 'certs\\site.pfx']) {
    check(`secret path refused: ${secret}`, is_secret_path(secret));
  }
  for (const normal of ['.env.example', 'src/main.js', 'README.md', 'docs/secretary.md', 'keyboard.js', 'environment.ts']) {
    check(`normal path allowed: ${normal}`, !is_secret_path(normal));
  }

  const api = new TelegramApi({ token: TOKEN, fetch_impl: async () => { throw new Error(`failed for /bot${TOKEN}/getMe`); } });
  let leaked = '';
  await api.get_me().catch((error) => { leaked = error.message; });
  check('network errors never carry the token', leaked !== '' && !leaked.includes(TOKEN), leaked);

  // ---- settings ----
  const settings_file = path.join(outside, 'telegram.json');
  check('settings default to off and unpaired', (() => {
    const value = settings_store.read_settings(settings_file);
    return value.enabled === false && value.owner_id === null && value.sealed_token === null && value.notify === true;
  })());
  const saved = settings_store.write_settings(settings_file, { enabled: true, sealed_token: 'abc', owner_id: 5, owner_name: 'x', bot_token: TOKEN });
  check('settings keep only known fields', !JSON.stringify(saved).includes(TOKEN) && !fs.readFileSync(settings_file, 'utf8').includes(TOKEN));
  check('a bad owner id does not survive', settings_store.normalize_settings({ owner_id: 'everyone' }).owner_id === null);
  fs.writeFileSync(settings_file, '{broken');
  check('corrupt settings come back off', settings_store.read_settings(settings_file).enabled === false);
  check('corrupt settings are kept aside', fs.readdirSync(path.dirname(settings_file)).some((name) => name.startsWith(`${path.basename(settings_file)}.corrupt-`)));

  // ---- wrong token ----
  const fake = new FakeTelegram(TOKEN);
  await fake.start();
  const panes = make_panes();
  const hooks = new EventEmitter();
  hooks.status = {};
  hooks.get_status = () => hooks.status;
  let owner_saved = null;
  const created_events = [];
  const killed_events = [];
  const make_bot = (token_for_api) => {
    const instance = new TelegramBot({
      panes,
      hooks,
      list_workspaces: () => [{ id: 'ws1', name: 'demo', path: workspace }],
      catalog: [
        { id: 'claude', label: 'Claude Code', command: 'claude' },
        { id: 'missing', label: 'Not Installed', command: 'missing-cli' },
      ],
      check_commands: async () => ({ claude: true }),
      render_screen,
      files,
      create_api: () => new TelegramApi({ token: token_for_api, base_url: fake.base_url }),
      on_owner_changed: (id, name) => { owner_saved = { id, name }; },
      timing: { submit_delay_ms: 5, follow_interval_ms: 30, follow_quiet_ms: 200, follow_max_ms: 5000, notify_settle_ms: 5, notify_cooldown_ms: 100000 },
    });
    instance.on('terminal_created', (info) => created_events.push(info));
    instance.on('terminal_killed', (info) => killed_events.push(info));
    return instance;
  };

  const rejected = make_bot('999:wrong');
  rejected.start({ token: '999:wrong', owner_id: null });
  check('a wrong token stops with an error', await wait_for(() => rejected.get_status().state === 'error', 'rejected token'));
  check('the token error says what to do', /BotFather/.test(rejected.get_status().error || ''));
  const polls_before = fake.calls.length;
  await settle();
  check('a wrong token is not retried', fake.calls.length === polls_before);
  await rejected.stop();

  // ---- pairing ----
  const bot = make_bot(TOKEN);
  bot.start({ token: TOKEN, owner_id: null });
  check('bot connects', await wait_for(() => fake.waiter && fake.sent('getMe').length > 0, 'first poll'));
  fake.flush();
  check('bot reports online', await wait_for(() => bot.get_status().state === 'online', 'online'));
  check('bot username comes from Telegram', bot.get_status().username === 'fake_bot');
  check('commands are registered', fake.sent('setMyCommands').length === 1);
  check('queued messages are dropped at startup', fake.sent('deleteWebhook')[0].params.drop_pending_updates === true);
  await wait_for(() => fake.waiter, 'poll');

  const message = (from, text, extra) => ({ message: { message_id: 1, date: now_s(), from, chat: chat_of(from), text, ...extra } });
  const send = async (update) => {
    const before = fake.next_update;
    fake.push(update);
    // The bot polls again only after it has finished handling the update.
    await wait_for(() => bot.offset >= before + 1 && fake.waiter, 'update handled');
    await settle(20);
  };

  panes.list.push(make_pane('pane-1', 'Ada|claude|Claude Code', workspace, 'prompt> <b>markup</b> & more'));

  await send(message(STRANGER, 'run something bad'));
  check('unpaired bot ignores ordinary text', panes.writes.length === 0 && fake.said().length === 0);
  await send(message(STRANGER, '/start'));
  check('unpaired /start explains pairing', /not paired/.test(fake.said()[0] || ''));
  await send(message(STRANGER, '/pair ABCDEFGH'));
  check('/pair without an open code is silent', fake.said().length === 1 && owner_saved === null);

  const status = bot.new_pair_code();
  check('pairing code is shown to the panel', /^[A-Z2-9]{8}$/.test(status.pair_code), status.pair_code);
  for (let attempt = 0; attempt < PAIR_MAX_TRIES; attempt += 1) await send(message(STRANGER, '/pair WRONGCOD'));
  check('wrong codes never pair', owner_saved === null && bot.owner_id === null);
  check('too many wrong codes burn the code', bot.get_status().pair_code === null);
  await send(message(STRANGER, `/pair ${status.pair_code}`));
  check('a burned code no longer pairs', owner_saved === null);

  const code = bot.new_pair_code().pair_code;
  const group_chat = { message: { message_id: 2, date: now_s(), from: OWNER, chat: { id: -100, type: 'group' }, text: `/pair ${code}` } };
  await send(group_chat);
  check('pairing refuses a group chat', owner_saved === null);
  await send(message(OWNER, `/pair ${code.toLowerCase()}`));
  check('the right code pairs and is saved', owner_saved && owner_saved.id === OWNER.id && owner_saved.name === '@owner_user', owner_saved);
  check('the code works only once', bot.get_status().pair_code === null);

  // ---- who the bot obeys ----
  await send(message(STRANGER, `/pair ${code}`));
  check('a second user cannot take over', bot.owner_id === OWNER.id);
  const said_before = fake.said().length;
  await send(message(STRANGER, 'hello'));
  await send(message(STRANGER, '/panes'));
  check('after pairing a stranger gets silence and no input', panes.writes.length === 0 && fake.said().length === said_before);
  await send({ message: { message_id: 3, date: now_s(), from: OWNER, chat: { id: -100, type: 'group' }, text: 'in a group' } });
  check('the owner in a group is ignored', panes.writes.length === 0 && fake.said().length === said_before);

  // ---- old and forwarded messages ----
  await send(message(OWNER, 'from before the app started', { date: bot.started_at_s - 3600 }));
  check('a message from before startup is dropped', panes.writes.length === 0 && fake.said().length === said_before);
  bot.started_at_s = now_s() - 3600;
  await send(message(OWNER, 'delivered late', { date: now_s() - 600 }));
  check('a late message is not sent to the pane', panes.writes.length === 0);
  check('a late message is reported', /too late/.test(fake.said().slice(-1)[0]));
  await send(message(OWNER, 'rm -rf everything', { forward_origin: { type: 'user' } }));
  check('a forwarded message is not sent to the pane', panes.writes.length === 0 && /Forwarded/.test(fake.said().slice(-1)[0]));
  await send({ message: { message_id: 4, date: now_s(), from: OWNER, chat: chat_of(OWNER), photo: [{}] } });
  check('a photo is refused with a note', panes.writes.length === 0 && /Only text/.test(fake.said().slice(-1)[0]));

  // ---- input ----
  await send(message(OWNER, 'fix the bug'));
  check('the only pane is chosen automatically', await wait_for(() => panes.writes.length === 2, 'text and enter'));
  check('text and Enter are written separately', panes.writes[0].data === 'fix the bug' && panes.writes[1].data === '\r', panes.writes);
  await wait_for(() => fake.said().some((text) => text.includes('<pre>')), 'screen');
  const screen_text = fake.said().find((text) => text.includes('<pre>'));
  check('screen output is escaped for Telegram HTML', screen_text.includes('&lt;b&gt;markup&lt;/b&gt; &amp; more'), screen_text);

  panes.writes.length = 0;
  await send(message(OWNER, '/compact'));
  check('an unknown command reaches the agent', await wait_for(() => panes.writes.some((write) => write.data === '/compact'), 'slash passthrough'));
  panes.writes.length = 0;
  await send(message(OWNER, '/help'));
  check('a bot command stays with the bot', panes.writes.length === 0 && fake.said().some((text) => text.includes('AgentSense remote')));
  await send(message(OWNER, '/send /help'));
  check('/send delivers a command name to the agent', await wait_for(() => panes.writes.some((write) => write.data === '/help'), 'send'));
  panes.writes.length = 0;
  await send(message(OWNER, '/screen@some_other_bot'));
  check('a command for another bot is not treated as ours', await wait_for(() => panes.writes.some((write) => write.data.includes('some_other_bot')), 'other bot'));

  panes.writes.length = 0;
  await send(message(OWNER, 'line one\nline two'));
  await wait_for(() => panes.writes.length === 2, 'multi line');
  check('multi-line text in a shell is not bracketed', panes.writes[0].data === 'line one\rline two', panes.writes[0]);
  panes.list[0].buffer += '\x1b[?2004h';
  panes.writes.length = 0;
  await send(message(OWNER, 'line one\nline two\x1b[201~'));
  await wait_for(() => panes.writes.length === 2, 'bracketed');
  check('multi-line text is bracketed when the program asks', panes.writes[0].data === '\x1b[200~line one\rline two␛[201~\x1b[201~', panes.writes[0]);
  check('text cannot break out of the bracket', !panes.writes[0].data.slice(6, -6).includes('\x1b'));

  // ---- two panes: choosing and replying ----
  panes.list.push(make_pane('pane-2', 'Bob|codex|Codex', workspace, 'second pane'));
  await send(message(OWNER, '/panes'));
  const panes_message = fake.sent().slice(-1)[0].params;
  const buttons = panes_message.reply_markup.inline_keyboard.flat();
  check('/panes lists both panes and New', buttons.length === 3 && buttons[0].text.includes('Ada') && buttons[1].text.includes('Bob'), buttons);
  check('every button fits the 64-byte limit', buttons.every((button) => Buffer.byteLength(button.callback_data) <= 64));

  const press = async (data, from, message_id) => {
    const before = fake.next_update;
    fake.push({ callback_query: { id: `cb-${before}`, from: from || OWNER, data, message: { message_id: message_id || 50, chat: chat_of(from || OWNER) } } });
    await wait_for(() => bot.offset >= before + 1 && fake.waiter, 'callback handled');
    await settle(20);
  };

  panes.writes.length = 0;
  const answers_before = fake.sent('answerCallbackQuery').length;
  await press(buttons[1].callback_data, STRANGER);
  check('a stranger pressing a button does nothing', bot.current_id === 'pane-1' && fake.sent('answerCallbackQuery').length === answers_before);
  await press(buttons[1].callback_data);
  check('a button chooses the pane', bot.current_id === 'pane-2');
  const second_screen = fake.sent().slice(-1)[0];
  check('choosing a pane shows its screen', second_screen.params.text.includes('second pane'));

  await send(message(OWNER, 'for bob'));
  await wait_for(() => panes.writes.length === 2, 'write to bob');
  check('text goes to the chosen pane', panes.writes.every((write) => write.terminal_id === 'pane-2'), panes.writes);

  const ada_screen_id = [...bot.screen_messages.entries()].find(([, terminal_id]) => terminal_id === 'pane-1')[0];
  panes.writes.length = 0;
  await send(message(OWNER, 'for ada', { reply_to_message: { message_id: ada_screen_id } }));
  await wait_for(() => panes.writes.length === 2, 'write to ada');
  check('replying to a screen goes to that pane', panes.writes.every((write) => write.terminal_id === 'pane-1'), panes.writes);

  // ---- keys ----
  const ada_handle = bot.handle_for('pane:pane-1');
  panes.writes.length = 0;
  await press(`k:${ada_handle}:ctrlc`);
  check('a key button writes that key', panes.writes.length === 1 && panes.writes[0].data === '\x03', panes.writes);
  panes.writes.length = 0;
  await press(`k:${ada_handle}:constructor`);
  check('an invented key id writes nothing', panes.writes.length === 0);
  await press('k:zzz:enter');
  check('a stale button is refused', panes.writes.length === 0 && /expired/.test(fake.sent('answerCallbackQuery').slice(-1)[0].params.text));

  // ---- live screen ----
  bot.start_follow('pane-1', 777, null);
  panes.list[0].buffer += '\r\nLIVE-UPDATE';
  panes.terminal_events.emit('data', 'pane-1', 'x');
  check('a followed screen is edited with new output', await wait_for(
    () => fake.sent('editMessageText').some((call) => call.params.message_id === 777 && call.params.text.includes('LIVE-UPDATE')),
    'live edit'
  ));
  check('following stops after a quiet period', await wait_for(() => bot.follow === null, 'follow stop'));

  // ---- notifications ----
  const said_count = () => fake.said().length;
  let count = said_count();
  hooks.emit('status', 'pane-1', { status: 'working' });
  await settle();
  check('working is not worth a notification', said_count() === count);
  hooks.emit('status', 'pane-1', { status: 'waiting', detail: 'Allow <rm>?' });
  check('waiting notifies with the screen', await wait_for(() => fake.said().some((text) => text.includes('Needs you') && text.includes('Allow &lt;rm&gt;?') && text.includes('<pre>')), 'waiting notification'));
  count = said_count();
  hooks.emit('status', 'pane-1', { status: 'waiting', detail: 'again' });
  await settle();
  check('repeat notifications are held back', said_count() === count);
  hooks.emit('status', 'pane-2', { status: 'done' });
  check('finished notifies', await wait_for(() => fake.said().some((text) => text.includes('Finished')), 'done notification'));
  const done_call = fake.sent().filter((call) => call.params.text.includes('Finished')).slice(-1)[0];
  check('a notification for another pane offers to switch to it', JSON.stringify(done_call.params.reply_markup).includes('Use this pane'), done_call.params.reply_markup);
  panes.terminal_events.emit('exit', 'pane-2', 3);
  check('an exit is reported', await wait_for(() => fake.said().some((text) => text.includes('exited with code 3')), 'exit'));
  bot.set_notify(false);
  count = said_count();
  hooks.emit('status', 'pane-2', { status: 'waiting', detail: 'silent' });
  await settle();
  check('notifications can be turned off', said_count() === count);
  bot.set_notify(true);

  // ---- closing ----
  const bob_handle = bot.handle_for('pane:pane-2');
  bot.current_id = 'pane-2';
  await send(message(OWNER, '/close'));
  check('/close alone does not kill', panes.killed.length === 0 && /Close/.test(fake.said().slice(-1)[0]));
  await press('x');
  check('Keep leaves the pane', panes.killed.length === 0);
  await press(`c:${bob_handle}`, STRANGER);
  check('a stranger cannot confirm a close', panes.killed.length === 0);
  await press(`c:${bob_handle}`);
  check('the confirm button closes the pane', panes.killed.includes('pane-2'));
  check('the desktop hears about the close', killed_events.some((event) => event.terminal_id === 'pane-2'));
  check('a closed pane is no longer current', bot.current_id === null || bot.find_pane(bot.current_id) === null);
  await press(`k:${bob_handle}:enter`);
  check('keys for a closed pane are refused', /closed/.test(fake.sent('answerCallbackQuery').slice(-1)[0].params.text));

  // ---- starting an agent ----
  await send(message(OWNER, '/new'));
  const ws_button = fake.sent().slice(-1)[0].params.reply_markup.inline_keyboard[0][0];
  check('/new offers the workspaces', ws_button.text === 'demo');
  await press(ws_button.callback_data);
  const agent_buttons = fake.sent('editMessageText').slice(-1)[0].params.reply_markup.inline_keyboard.flat();
  check('/new offers only installed agents', agent_buttons.length === 1 && agent_buttons[0].text === 'Claude Code', agent_buttons);
  await press(agent_buttons[0].callback_data);
  check('the button starts the agent in the saved folder', await wait_for(() => panes.created.length === 1 && panes.created[0].cwd === workspace && panes.created[0].command === 'claude', 'create'), panes.created);
  check('the desktop hears about the new pane', created_events.length === 1);
  check('the new pane becomes current', bot.current_id === 'new-1');
  bot.current_id = 'pane-1';

  // ---- viewing code ----
  fs.writeFileSync(path.join(workspace, 'small.js'), 'const a = 1 < 2;\n');
  fs.writeFileSync(path.join(workspace, 'big.txt'), 'y'.repeat(10000));
  fs.writeFileSync(path.join(workspace, '.env'), 'API_KEY=topsecret');
  fs.writeFileSync(path.join(workspace, '.env.example'), 'API_KEY=');
  fs.writeFileSync(path.join(workspace, 'image.png'), Buffer.from([0x89, 0x50, 0, 1, 2]));
  fs.writeFileSync(path.join(outside, 'outside.txt'), 'sentinel-outside');
  fs.symlinkSync(outside, path.join(workspace, 'linked'), 'junction');

  await send(message(OWNER, '/cat small.js'));
  check('/cat shows a small file, escaped', fake.said().slice(-1)[0].includes('const a = 1 &lt; 2;'));
  const docs_before = fake.sent('sendDocument').length;
  await send(message(OWNER, '/cat big.txt'));
  check('/cat sends a long file as a document', await wait_for(() => fake.sent('sendDocument').length === docs_before + 1, 'document'));
  check('the document holds the content', fake.sent('sendDocument').slice(-1)[0].params.raw.includes('y'.repeat(10000)));
  await send(message(OWNER, '/cat .env'));
  check('/cat refuses .env', /credentials/.test(fake.said().slice(-1)[0]) && !JSON.stringify(fake.calls).includes('topsecret'));
  await send(message(OWNER, '/cat .env::$DATA'));
  check('/cat refuses an alternate data stream', /credentials/.test(fake.said().slice(-1)[0]) && !JSON.stringify(fake.calls).includes('topsecret'));
  await send(message(OWNER, '/cat .env.example'));
  check('/cat allows .env.example', fake.said().slice(-1)[0].includes('API_KEY='));
  await send(message(OWNER, '/cat linked/outside.txt'));
  check('/cat refuses a junction out of the workspace', !JSON.stringify(fake.calls).includes('sentinel-outside') && /outside/.test(fake.said().slice(-1)[0]));
  await send(message(OWNER, '/cat ../../../../Windows/win.ini'));
  check('/cat refuses a path out of the workspace', /outside/.test(fake.said().slice(-1)[0]));
  await send(message(OWNER, '/cat image.png'));
  check('/cat refuses a binary file', /not a text file/.test(fake.said().slice(-1)[0]));
  await send(message(OWNER, '/cat'));
  check('/cat without a path explains itself', /Usage/.test(fake.said().slice(-1)[0]));
  await send(message(OWNER, '/ls'));
  check('/ls lists the folder', fake.said().slice(-1)[0].includes('small.js'));
  await send(message(OWNER, '/ls linked'));
  check('/ls refuses a junction out of the workspace', /outside/.test(fake.said().slice(-1)[0]));

  execFileSync('git', ['init', '-q'], { cwd: workspace });
  execFileSync('git', ['add', 'small.js'], { cwd: workspace });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'one'], { cwd: workspace });
  fs.writeFileSync(path.join(workspace, 'small.js'), 'const a = 2 > 1;\n');
  await send(message(OWNER, '/diff'));
  await wait_for(() => fake.said().some((text) => text.includes('diff against HEAD')), 'diff');
  const diff_text = fake.said().slice(-1)[0];
  check('/diff shows the change, escaped', diff_text.includes('+const a = 2 &gt; 1;'), diff_text);
  check('/diff also shows status', fake.said().some((text) => text.includes('git status') && text.includes('small.js')));

  // ---- transport failures ----
  fake.fail_next.set('sendMessage', { error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 0.05 } });
  await send(message(OWNER, '/help'));
  check('a flood limit is retried', await wait_for(() => fake.said().slice(-1)[0].includes('AgentSense remote') && fake.sent('sendMessage').length > 0, 'retry'));
  fake.fail_next.set('getUpdates', { error_code: 409, description: 'Conflict' });
  fake.flush();
  check('a second poller is reported', await wait_for(() => /Another program/.test(bot.get_status().error || ''), 'conflict'));
  check('the bot recovers after a conflict', await wait_for(() => {
    fake.flush();
    return bot.get_status().state === 'online';
  }, 'recover'));

  // ---- unpair and stop ----
  bot.clear_owner();
  panes.writes.length = 0;
  count = said_count();
  await send(message(OWNER, 'after unpair'));
  check('after unpairing the old owner has no access', panes.writes.length === 0 && said_count() === count);
  hooks.emit('status', 'pane-1', { status: 'done' });
  await settle();
  check('after unpairing nothing is sent', said_count() === count);

  const started = Date.now();
  await bot.stop();
  check('stop ends the long poll at once', Date.now() - started < 2000);
  check('stop removes its listeners', panes.terminal_events.listenerCount('data') === 0 && hooks.listenerCount('status') === 0);
  check('nothing in the log calls holds the token', !JSON.stringify(fake.calls).includes(TOKEN));
  await fake.stop();
}

main()
  .catch((error) => {
    console.log(`FAIL unexpected error: ${error && error.stack ? error.stack : error}`);
    failed += 1;
  })
  .finally(() => {
    for (const dir of [workspace, outside]) fs.rmSync(dir, { recursive: true, force: true });
    console.log(failed === 0 ? 'telegram checks passed' : `${failed} telegram check(s) failed`);
    process.exit(failed === 0 ? 0 : 1);
  });
