// Telegram bot: a chat remote for the panes on this PC. It long-polls the Bot API, so it needs no open port and
// no VPN, and it drives panes through the same pty_manager calls as the phone page (mobile_server.js).
//
// Who it obeys: one Telegram user, set by pairing. The panel shows a one-time code and that user sends /pair <code>
// in a private chat. Everyone else, and every group, gets silence once the bot has an owner.
// What it never does: run a message sent while the app was off (a queued prompt must not fire hours later), or take
// a forwarded message as input. A pane is only closed after a confirm button.
//
// Plain text goes to the current pane, or to the pane of the screen message it replies to. Unknown /commands go to
// the pane too, so an agent's own slash commands still work; /send is there for names both sides use.
//
// Every dependency is injected (see ipc_telegram.js), so scripts/check_telegram.js runs this without Electron.
//
// Emits for the desktop renderer: 'terminal_created' (info), 'terminal_killed' ({ terminal_id }).
const crypto = require('crypto');
const path = require('path');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');

const { TelegramApi } = require('./telegram_api');
const { create_agent_pane } = require('./pane_launch');

const POLL_TIMEOUT_S = 30;
const MAX_PRE_CHARS = 3600; // Telegram allows 4096 per message; the heading and the keyboard hint need the rest
const MAX_INLINE_DOC = 3400;
const MAX_LIST_ENTRIES = 100;
const MAX_HANDLES = 512;
const MAX_SCREEN_MESSAGES = 256;
const MAX_RETRY_WAIT_S = 30;
const STALE_MESSAGE_S = 120;
const PAIR_TTL_MS = 10 * 60 * 1000;
const PAIR_MAX_TRIES = 5;
const PAIR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PAIR_LENGTH = 8;
const GIT_TIMEOUT_MS = 20 * 1000;
const GIT_MAX_OUTPUT = 20 * 1024 * 1024;
const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 30 * 1000;

const DEFAULT_TIMING = {
  submit_delay_ms: 150, // agents treat text and Enter arriving together as a paste and do not submit it
  follow_interval_ms: 3000,
  follow_quiet_ms: 20 * 1000,
  follow_max_ms: 10 * 60 * 1000,
  notify_settle_ms: 800, // the hook fires before the agent has finished drawing its prompt
  notify_cooldown_ms: 15 * 1000,
};

const KEYS = {
  enter: { label: '⏎', data: '\r' },
  esc: { label: 'Esc', data: '\x1b' },
  ctrlc: { label: '^C', data: '\x03' },
  up: { label: '↑', data: '\x1b[A' },
  down: { label: '↓', data: '\x1b[B' },
  one: { label: '1', data: '1' },
  two: { label: '2', data: '2' },
  three: { label: '3', data: '3' },
};

const COMMANDS = [
  { command: 'panes', description: 'List panes and pick one' },
  { command: 'screen', description: 'Show the current pane' },
  { command: 'new', description: 'Start an agent' },
  { command: 'close', description: 'Close the current pane' },
  { command: 'diff', description: 'Git status and diff of the current pane' },
  { command: 'ls', description: 'List a folder: /ls src' },
  { command: 'cat', description: 'Read a file: /cat src/main.js' },
  { command: 'send', description: 'Send text as is, for /help and the like' },
  { command: 'help', description: 'How this bot works' },
];

const HELP_TEXT = [
  '<b>AgentSense remote</b>',
  '',
  'Send a message and it goes to the current pane. Reply to a screen message to send to that pane instead.',
  'Commands the bot does not know go to the pane too, so /compact and the like reach the agent.',
  '',
  '/panes list panes and pick one',
  '/screen show the current pane',
  '/new start an agent',
  '/close close the current pane',
  '/diff git status and diff',
  '/ls [folder] and /cat &lt;file&gt; browse the workspace',
  '/send &lt;text&gt; send text as is, such as /send /help',
].join('\n');

function escape_html(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Keeps the end of the text, because the end of a screen or a log is what matters.
function keep_tail(text, max_chars) {
  if (text.length <= max_chars) return text;
  let cut = text.slice(-max_chars);
  const newline = cut.indexOf('\n');
  if (newline !== -1 && newline < cut.length - 1) cut = cut.slice(newline + 1);
  else if (/^[\uDC00-\uDFFF]/.test(cut)) cut = cut.slice(1);
  return `…\n${cut}`;
}

function pane_name(info) {
  const parts = String(info.title || '').split('|');
  return parts[0] || parts[2] || info.agent_id || 'pane';
}

// Telegram messages are not end-to-end encrypted, so /cat refuses the files that usually hold credentials.
// A deny list cannot be complete; the panel says so.
function is_secret_path(value) {
  const parts = String(value).split(/[\\/]+/).map((part) => part.replace(/[. ]+$/, '').toLowerCase());
  if (parts.includes('.git') || parts.includes('.ssh') || parts.includes('.aws')) return true;
  const base = parts[parts.length - 1] || '';
  if (/^\.env(\.(example|sample|template))$/.test(base)) return false;
  return (
    /^\.env(\.|$)/.test(base) ||
    /\.(pem|key|pfx|p12|keystore|jks|kdbx)$/.test(base) ||
    /^id_(rsa|dsa|ecdsa|ed25519)/.test(base) ||
    /^(\.npmrc|\.netrc|\.pypirc|\.git-credentials)$/.test(base) ||
    /(^|[._-])(secret|secrets|credential|credentials)([._-]|$)/.test(base)
  );
}

function default_run_git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=off', ...args],
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_OUTPUT, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(String(stderr || error.message).trim().split('\n')[0]));
        return resolve(stdout);
      }
    );
  });
}

class TelegramBot extends EventEmitter {
  // deps: { panes, hooks, list_workspaces, catalog, check_commands, render_screen, files, run_git, create_api,
  //         on_owner_changed, timing, now }
  constructor(deps) {
    super();
    this.deps = deps;
    this.timing = { ...DEFAULT_TIMING, ...(deps.timing || {}) };
    this.now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    this.run_git = typeof deps.run_git === 'function' ? deps.run_git : default_run_git;
    this.create_api = typeof deps.create_api === 'function' ? deps.create_api : (token) => new TelegramApi({ token });
    this.run = null;
    this.api = null;
    this.state = 'off';
    this.error = null;
    this.username = null;
    this.owner_id = null;
    this.notify = true;
    this.pair = null;
    this.offset = undefined;
    this.started_at_s = 0;
    this.current_id = null;
    this.handles = new Map(); // short id -> value, for the 64-byte callback_data limit
    this.handle_ids = new Map(); // value -> short id
    this.next_handle = 1;
    this.screen_messages = new Map(); // message id -> terminal id, for replies
    this.follow = null;
    this.notify_times = new Map();
    this.timers = new Set();
    this.on_data = (terminal_id) => this.note_output(terminal_id);
    this.on_exit = (terminal_id, exit_code) => this.note_exit(terminal_id, exit_code);
    this.on_hook = (terminal_id, info) => this.note_status(terminal_id, info);
  }

  // options: { token, owner_id, notify }. Safe to call once per stop().
  start(options) {
    if (this.run) return;
    this.api = this.create_api(options.token);
    this.owner_id = options.owner_id || null;
    this.notify = options.notify !== false;
    this.state = 'connecting';
    this.error = null;
    this.username = null;
    this.offset = undefined;
    this.started_at_s = Math.floor(this.now() / 1000);
    const run = { controller: new AbortController(), done: null };
    this.run = run;
    this.deps.panes.terminal_events.on('data', this.on_data);
    this.deps.panes.terminal_events.on('exit', this.on_exit);
    this.deps.hooks.on('status', this.on_hook);
    run.done = this.poll_loop(run);
  }

  async stop() {
    const run = this.run;
    this.run = null;
    this.stop_follow();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.pair = null;
    this.state = 'off';
    this.error = null;
    this.username = null;
    if (!run) return;
    this.deps.panes.terminal_events.off('data', this.on_data);
    this.deps.panes.terminal_events.off('exit', this.on_exit);
    this.deps.hooks.off('status', this.on_hook);
    run.controller.abort();
    await run.done;
  }

  get_status() {
    const pair = this.pair && this.pair.expires_at > this.now() ? this.pair : null;
    return {
      state: this.state,
      error: this.error,
      username: this.username,
      pair_code: pair ? pair.code : null,
      pair_expires_at: pair ? pair.expires_at : null,
    };
  }

  set_notify(notify) {
    this.notify = notify !== false;
  }

  // Drops the owner at once. A new pairing code is needed before anyone can use the bot again.
  clear_owner() {
    this.owner_id = null;
    this.current_id = null;
    this.stop_follow();
  }

  new_pair_code() {
    let code = '';
    for (let index = 0; index < PAIR_LENGTH; index += 1) code += PAIR_ALPHABET[crypto.randomInt(PAIR_ALPHABET.length)];
    this.pair = { code, expires_at: this.now() + PAIR_TTL_MS, tries: 0 };
    return this.get_status();
  }

  // ---- polling ----

  sleep(ms, signal) {
    return new Promise((resolve) => {
      if (signal && signal.aborted) return resolve();
      const timer = setTimeout(resolve, ms);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }

  async connect(run) {
    const me = await this.api.get_me();
    this.username = me && me.username ? me.username : null;
    // Clears a webhook (which would block polling) and whatever queued while the app was off.
    await this.api.call('deleteWebhook', { drop_pending_updates: true }, { signal: run.controller.signal });
    await this.api.call('setMyCommands', { commands: COMMANDS }).catch(() => {});
  }

  async poll_loop(run) {
    let backoff = BACKOFF_START_MS;
    let connected = false;
    while (this.run === run) {
      try {
        if (!connected) {
          await this.connect(run);
          connected = true;
        }
        const updates = await this.api.get_updates(this.offset, POLL_TIMEOUT_S, run.controller.signal);
        if (this.run !== run) return;
        this.state = 'online';
        this.error = null;
        backoff = BACKOFF_START_MS;
        for (const update of updates) {
          this.offset = update.update_id + 1;
          try {
            await this.handle_update(update);
          } catch (error) {
            console.error(`telegram update failed: ${this.api.redact(error && error.message ? error.message : error)}`);
          }
          if (this.run !== run) return;
        }
      } catch (error) {
        if (this.run !== run) return;
        if (error.code === 401 || error.code === 404) {
          // Retrying cannot fix a wrong token, and Telegram bans clients that keep trying.
          this.state = 'error';
          this.error = 'Telegram rejected this bot token. Check it with @BotFather, then remove it here and save the right one.';
          return;
        }
        this.state = 'error';
        this.error = error.code === 409
          ? 'Another program is using this bot token. Only one can poll at a time.'
          : `Cannot reach Telegram, retrying: ${error.message}`;
        const wait = error.retry_after ? error.retry_after * 1000 : backoff;
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
        await this.sleep(wait, run.controller.signal);
      }
    }
  }

  // ---- sending ----

  // One retry on a flood-limit answer. "Not modified" means an edit found nothing to change.
  async send(method, params) {
    try {
      return await this.api.call(method, params);
    } catch (error) {
      if (/message is not modified/i.test(error.message)) return null;
      if (error.code === 429 && error.retry_after && error.retry_after <= MAX_RETRY_WAIT_S) {
        await this.sleep(error.retry_after * 1000);
        return this.api.call(method, params);
      }
      throw error;
    }
  }

  say(text, reply_markup) {
    if (!this.owner_id) return Promise.resolve(null);
    return this.send('sendMessage', {
      chat_id: this.owner_id,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(reply_markup ? { reply_markup } : {}),
    });
  }

  edit(message_id, text, reply_markup) {
    return this.send('editMessageText', {
      chat_id: this.owner_id,
      message_id,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(reply_markup ? { reply_markup } : {}),
    });
  }

  handle_for(value) {
    const known = this.handle_ids.get(value);
    if (known) return known;
    const id = (this.next_handle++).toString(36);
    this.handles.set(id, value);
    this.handle_ids.set(value, id);
    if (this.handles.size > MAX_HANDLES) {
      const [oldest_id, oldest_value] = this.handles.entries().next().value;
      this.handles.delete(oldest_id);
      this.handle_ids.delete(oldest_value);
    }
    return id;
  }

  // ---- panes ----

  find_pane(terminal_id) {
    if (!terminal_id) return null;
    return this.deps.panes.list_terminals().find((info) => info.terminal_id === terminal_id) || null;
  }

  // The chosen pane, or the only one running. Null when the user has to choose.
  current_pane() {
    const chosen = this.find_pane(this.current_id);
    if (chosen) return chosen;
    const alive = this.deps.panes.list_terminals().filter((info) => info.alive);
    if (alive.length !== 1) return null;
    this.current_id = alive[0].terminal_id;
    return alive[0];
  }

  status_label(info) {
    if (!info.alive) return `exited (${info.exit_code})`;
    const hook = this.deps.hooks.get_status()[info.terminal_id];
    return hook ? hook.status : 'running';
  }

  workspace_name(workspace_id) {
    try {
      const found = this.deps.list_workspaces().find((item) => item && item.id === workspace_id);
      return found ? found.name : '';
    } catch (error) {
      return '';
    }
  }

  screen_keyboard(info) {
    const handle = this.handle_for(`pane:${info.terminal_id}`);
    const button = (text, callback_data) => ({ text, callback_data });
    const key = (id) => button(KEYS[id].label, `k:${handle}:${id}`);
    const panes_row = [button('📂 Panes', 'p')];
    if (!info.alive) return { inline_keyboard: [panes_row] };
    if (info.terminal_id !== this.current_id) panes_row.unshift(button('🎯 Use this pane', `s:${handle}`));
    return {
      inline_keyboard: [
        [button('⟳', `r:${handle}`), key('enter'), key('esc'), key('ctrlc')],
        [key('up'), key('down'), key('one'), key('two'), key('three')],
        panes_row,
      ],
    };
  }

  async screen_message(info, heading) {
    const { text } = await this.deps.render_screen(info.buffer, info.cols, info.rows);
    const title = `<b>${escape_html(pane_name(info))}</b> · ${escape_html(this.status_label(info))}`;
    const body = escape_html(keep_tail(text, MAX_PRE_CHARS)) || '(nothing on screen yet)';
    return { text: `${heading ? `${heading}\n` : ''}${title}\n<pre>${body}</pre>`, keyboard: this.screen_keyboard(info) };
  }

  remember_screen(message, terminal_id) {
    if (!message || !message.message_id) return;
    this.screen_messages.set(message.message_id, terminal_id);
    if (this.screen_messages.size > MAX_SCREEN_MESSAGES) {
      this.screen_messages.delete(this.screen_messages.keys().next().value);
    }
  }

  async post_screen(info, options) {
    const opts = options || {};
    const { text, keyboard } = await this.screen_message(info, opts.heading);
    const message = await this.say(text, keyboard);
    this.remember_screen(message, info.terminal_id);
    if (message && opts.follow) this.start_follow(info.terminal_id, message.message_id, text);
    return message;
  }

  // ---- live screen ----

  // One screen message at a time keeps updating, until the pane has been quiet for a while.
  start_follow(terminal_id, message_id, text) {
    this.stop_follow();
    const started = this.now();
    const follow = {
      terminal_id,
      message_id,
      last_text: text,
      started,
      last_output: started,
      dirty: true,
      busy: false,
      next_at: 0,
      timer: null,
    };
    follow.timer = setInterval(() => {
      this.follow_tick(follow).catch(() => {});
    }, this.timing.follow_interval_ms);
    if (typeof follow.timer.unref === 'function') follow.timer.unref();
    this.follow = follow;
  }

  stop_follow() {
    if (!this.follow) return;
    clearInterval(this.follow.timer);
    this.follow = null;
  }

  async follow_tick(follow) {
    if (this.follow !== follow || follow.busy) return;
    const now = this.now();
    if (now < follow.next_at) return;
    const expired = now - follow.started > this.timing.follow_max_ms || now - follow.last_output > this.timing.follow_quiet_ms;
    if (expired && !follow.dirty) return this.stop_follow();
    if (!follow.dirty) return undefined;
    follow.busy = true;
    follow.dirty = false;
    try {
      const info = this.find_pane(follow.terminal_id);
      if (!info) return this.stop_follow();
      const { text, keyboard } = await this.screen_message(info);
      if (this.follow !== follow || text === follow.last_text) return undefined;
      await this.api.call('editMessageText', {
        chat_id: this.owner_id,
        message_id: follow.message_id,
        text,
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      follow.last_text = text;
    } catch (error) {
      if (error.retry_after) follow.next_at = this.now() + error.retry_after * 1000;
      follow.dirty = true;
    } finally {
      follow.busy = false;
    }
    if (expired) this.stop_follow();
    return undefined;
  }

  note_output(terminal_id) {
    if (this.follow && this.follow.terminal_id === terminal_id) {
      this.follow.dirty = true;
      this.follow.last_output = this.now();
    }
  }

  // ---- notifications ----

  later(ms, action) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      Promise.resolve().then(action).catch((error) => {
        console.error(`telegram notification failed: ${this.api.redact(error && error.message ? error.message : error)}`);
      });
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.add(timer);
  }

  note_status(terminal_id, info) {
    if (!this.notify || !this.owner_id || !info) return;
    if (info.status !== 'waiting' && info.status !== 'done') return;
    const key = `${terminal_id}:${info.status}`;
    const last = this.notify_times.get(key);
    const now = this.now();
    if (last && now - last < this.timing.notify_cooldown_ms) return;
    this.notify_times.set(key, now);
    const heading = info.status === 'waiting'
      ? `⏳ <b>Needs you</b>${info.detail ? `: ${escape_html(info.detail)}` : ''}`
      : '✅ <b>Finished</b>';
    this.later(this.timing.notify_settle_ms, async () => {
      const pane = this.find_pane(terminal_id);
      if (pane && this.owner_id) await this.post_screen(pane, { heading });
    });
  }

  note_exit(terminal_id, exit_code) {
    if (!this.notify || !this.owner_id) return;
    const pane = this.find_pane(terminal_id);
    const name = pane ? pane_name(pane) : 'A pane';
    this.later(0, () => this.say(`⏹ <b>${escape_html(name)}</b> exited with code ${escape_html(exit_code)}`));
  }

  // ---- updates ----

  async handle_update(update) {
    if (update.message) return this.handle_message(update.message);
    if (update.callback_query) return this.handle_callback(update.callback_query);
    return undefined;
  }

  is_owner(from, chat) {
    return Boolean(this.owner_id && from && from.id === this.owner_id && chat && chat.type === 'private');
  }

  async handle_message(message) {
    const { from, chat } = message;
    if (!from || !chat || chat.type !== 'private' || from.is_bot) return undefined;
    // Sent before this run started. Telegram normally drops these for us; this holds even if it did not.
    if (message.date < this.started_at_s - 2) return undefined;
    const text = typeof message.text === 'string' ? message.text : '';
    const parsed = /^\/([A-Za-z_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/.exec(text);
    if (!this.owner_id) return this.handle_unpaired(message, parsed);
    if (!this.is_owner(from, chat)) return undefined;

    // A connection that was down for a while delivers old messages at once. Do not act on them.
    if (Math.floor(this.now() / 1000) - message.date > STALE_MESSAGE_S) {
      return this.say('⚠️ That message arrived too late, so it was not sent. Send it again if you still want it.');
    }
    if (message.forward_origin || message.forward_date) {
      return this.say('Forwarded messages are not sent to agents. Copy the text if you want to send it.');
    }
    if (text === '') return this.say('Only text can be sent to a pane.');

    const reply_target = message.reply_to_message
      ? this.screen_messages.get(message.reply_to_message.message_id) || null
      : null;
    if (parsed && (!parsed[2] || !this.username || parsed[2].toLowerCase() === this.username.toLowerCase())) {
      const handled = await this.handle_command(parsed[1].toLowerCase(), (parsed[3] || '').trim(), reply_target, parsed[3] || '');
      if (handled) return undefined;
    }
    return this.send_input(text, reply_target);
  }

  async handle_unpaired(message, parsed) {
    const command = parsed ? parsed[1].toLowerCase() : '';
    if (command === 'pair') return this.try_pair(message, (parsed[3] || '').trim());
    if (command !== 'start') return undefined;
    return this.send('sendMessage', {
      chat_id: message.chat.id,
      text: 'This bot is not paired yet. In AgentSense, open Mobile access, get a pairing code and send it here as /pair CODE.',
    });
  }

  async try_pair(message, code) {
    const pair = this.pair;
    if (!pair) return undefined;
    if (pair.expires_at <= this.now()) {
      this.pair = null;
      return undefined;
    }
    const given = Buffer.from(code.toUpperCase());
    const wanted = Buffer.from(pair.code);
    if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) {
      pair.tries += 1;
      if (pair.tries >= PAIR_MAX_TRIES) this.pair = null;
      return this.send('sendMessage', { chat_id: message.chat.id, text: 'That code is not valid.' });
    }
    this.pair = null;
    this.owner_id = message.from.id;
    const name = message.from.username ? `@${message.from.username}` : message.from.first_name || String(message.from.id);
    if (typeof this.deps.on_owner_changed === 'function') this.deps.on_owner_changed(this.owner_id, name);
    return this.say(`✅ Paired. This bot now obeys only you.\n\n${HELP_TEXT}`);
  }

  // True when the name is one of the bot's commands. Anything else belongs to the pane.
  async handle_command(command, argument, reply_target, raw_argument) {
    switch (command) {
      case 'start':
      case 'help':
        await this.say(HELP_TEXT);
        return true;
      case 'panes':
        await this.show_panes();
        return true;
      case 'screen':
        await this.with_pane(reply_target, (info) => this.post_screen(info, { follow: true }));
        return true;
      case 'new':
        await this.show_workspace_picker();
        return true;
      case 'close':
        await this.with_pane(reply_target, (info) => this.ask_close(info));
        return true;
      case 'diff':
        await this.with_pane(reply_target, (info) => this.show_diff(info));
        return true;
      case 'ls':
        await this.with_pane(reply_target, (info) => this.show_folder(info, argument));
        return true;
      case 'cat':
        await this.with_pane(reply_target, (info) => this.show_file(info, argument));
        return true;
      case 'send':
        if (raw_argument.trim() === '') await this.say('Usage: /send &lt;text&gt;');
        else await this.send_input(raw_argument, reply_target);
        return true;
      default:
        return false;
    }
  }

  async with_pane(reply_target, action) {
    const info = reply_target ? this.find_pane(reply_target) : this.current_pane();
    if (!info) return this.show_panes('Pick a pane first.');
    try {
      return await action(info);
    } catch (error) {
      return this.say(`⚠️ ${escape_html(this.api.redact(error && error.message ? error.message : error))}`);
    }
  }

  async send_input(text, reply_target) {
    const info = reply_target ? this.find_pane(reply_target) : this.current_pane();
    if (!info) return this.show_panes('Pick a pane first, then send that again.');
    if (!info.alive) return this.say(`<b>${escape_html(pane_name(info))}</b> has exited. Use /panes to pick another.`);
    this.current_id = info.terminal_id;
    const { bracketed_paste } = await this.deps.render_screen(info.buffer, info.cols, info.rows);
    const lines = text.replace(/\r?\n/g, '\r');
    // Same rule as xterm's paste: brackets only when the program asked, so a shell line is not left waiting.
    const payload = lines.includes('\r') && bracketed_paste
      ? `\x1b[200~${lines.replace(/\x1b/g, '␛')}\x1b[201~`
      : lines;
    this.deps.panes.write_terminal(info.terminal_id, payload);
    await this.sleep(this.timing.submit_delay_ms);
    this.deps.panes.write_terminal(info.terminal_id, '\r');
    await this.sleep(this.timing.submit_delay_ms);
    return this.post_screen(this.find_pane(info.terminal_id) || info, { follow: true });
  }

  // ---- views ----

  async show_panes(note) {
    const panes = this.deps.panes.list_terminals();
    const current = this.current_pane();
    const rows = panes.map((info) => {
      const mark = current && current.terminal_id === info.terminal_id ? '🎯 ' : '';
      return [{
        text: `${mark}${pane_name(info)} · ${this.workspace_name(info.workspace_id)} · ${this.status_label(info)}`.slice(0, 60),
        callback_data: `s:${this.handle_for(`pane:${info.terminal_id}`)}`,
      }];
    });
    rows.push([{ text: '➕ New agent', callback_data: 'n' }]);
    const heading = panes.length === 0 ? 'No panes are running.' : 'Panes:';
    return this.say(note ? `${escape_html(note)}\n${heading}` : heading, { inline_keyboard: rows });
  }

  async show_workspace_picker() {
    let workspaces = [];
    try {
      workspaces = this.deps.list_workspaces();
    } catch (error) {
      return this.say('⚠️ Could not read the workspace list.');
    }
    if (workspaces.length === 0) return this.say('No workspaces yet. Add one in AgentSense on the PC first.');
    return this.say('Start an agent in which workspace?', {
      inline_keyboard: workspaces.map((item) => [{
        text: String(item.name).slice(0, 60),
        callback_data: `w:${this.handle_for(`ws:${item.id}`)}`,
      }]),
    });
  }

  async show_agent_picker(workspace_handle, query_message) {
    const commands = this.deps.catalog.map((agent) => agent.command);
    const available = await this.deps.check_commands(commands).catch(() => ({}));
    const agents = this.deps.catalog.filter((agent) => available[agent.command]);
    if (agents.length === 0) return this.edit(query_message.message_id, 'No agents are installed on the PC.');
    const rows = [];
    for (let index = 0; index < agents.length; index += 2) {
      rows.push(agents.slice(index, index + 2).map((agent) => ({
        text: agent.label,
        callback_data: `a:${workspace_handle}:${this.handle_for(`agent:${agent.id}`)}`,
      })));
    }
    return this.edit(query_message.message_id, 'Which agent?', { inline_keyboard: rows });
  }

  async ask_close(info) {
    const handle = this.handle_for(`pane:${info.terminal_id}`);
    return this.say(`Close <b>${escape_html(pane_name(info))}</b>? The agent is stopped.`, {
      inline_keyboard: [[
        { text: '✕ Close it', callback_data: `c:${handle}` },
        { text: 'Keep it', callback_data: 'x' },
      ]],
    });
  }

  async send_text_or_file(heading, body, file_name) {
    if (body.length <= MAX_INLINE_DOC) return this.say(`${heading}\n<pre>${escape_html(body) || '(empty)'}</pre>`);
    await this.say(heading);
    return this.api.send_document(this.owner_id, file_name, Buffer.from(body, 'utf8'));
  }

  async show_diff(info) {
    const flags = ['diff', '--no-ext-diff', '--no-textconv', '--no-color'];
    const status = await this.run_git(info.cwd, ['status', '--short', '--branch']);
    // A repository with no commits has no HEAD to compare against.
    const diff = await this.run_git(info.cwd, [...flags, 'HEAD']).catch(() => this.run_git(info.cwd, flags));
    const name = escape_html(pane_name(info));
    await this.say(`<b>${name}</b> · git status\n<pre>${escape_html(keep_tail(status.trim(), MAX_PRE_CHARS)) || '(clean)'}</pre>`);
    if (diff.trim() === '') return this.say('No changes to tracked files.');
    return this.send_text_or_file(`<b>${name}</b> · diff against HEAD`, diff, 'changes.diff');
  }

  async show_folder(info, rel) {
    const entries = await this.deps.files.list_dir(info.cwd, rel);
    const shown = entries.slice(0, MAX_LIST_ENTRIES).map((entry) => (entry.kind === 'dir' ? `${entry.name}/` : entry.name));
    if (entries.length > shown.length) shown.push(`… and ${entries.length - shown.length} more`);
    return this.say(`<b>${escape_html(rel || '.')}</b>\n<pre>${escape_html(shown.join('\n')) || '(empty)'}</pre>`);
  }

  async show_file(info, rel) {
    if (rel === '') return this.say('Usage: /cat &lt;file&gt;');
    const refused = '🔒 That looks like a credentials file, so it stays on the PC.';
    // A colon would reach an NTFS alternate data stream, past the name check below.
    if (rel.includes(':') || is_secret_path(rel)) return this.say(refused);
    const file = this.deps.files.read_file(info.cwd, rel);
    // The check again on the real name, in case a link with an innocent name points at a secret.
    if (is_secret_path(file.path)) return this.say(refused);
    if (file.kind !== 'text') return this.say(`${escape_html(file.path)} is not a text file, so it cannot be shown here.`);
    const note = file.truncated ? ' (only the start: the file is very large)' : '';
    return this.send_text_or_file(`<b>${escape_html(file.path)}</b>${note}`, file.content, path.basename(file.path));
  }

  // ---- buttons ----

  async handle_callback(query) {
    const message = query.message;
    if (!message || !this.is_owner(query.from, message.chat)) return undefined;
    const parts = String(query.data || '').split(':');
    const answer = (text) => this.api.call('answerCallbackQuery', { callback_query_id: query.id, ...(text ? { text } : {}) }).catch(() => {});
    const value_of = (handle, prefix) => {
      const value = this.handles.get(handle);
      return typeof value === 'string' && value.startsWith(prefix) ? value.slice(prefix.length) : null;
    };
    const expired = () => answer('This button has expired. Use /panes.');

    switch (parts[0]) {
      case 'p':
        await answer();
        return this.show_panes();
      case 'n':
        await answer();
        return this.show_workspace_picker();
      case 'x':
        await answer();
        return this.edit(message.message_id, 'Kept.');
      case 'w': {
        if (value_of(parts[1], 'ws:') === null) return expired();
        await answer();
        return this.show_agent_picker(parts[1], message);
      }
      case 'a':
        return this.launch_from_button(value_of(parts[1], 'ws:'), value_of(parts[2], 'agent:'), message, answer, expired);
      default:
        break;
    }

    const terminal_id = value_of(parts[1], 'pane:');
    if (terminal_id === null) return expired();
    const info = this.find_pane(terminal_id);
    if (!info) return answer('That pane is closed.');

    switch (parts[0]) {
      case 's':
        this.current_id = terminal_id;
        await answer(`Now on ${pane_name(info)}`);
        return this.post_screen(info, { follow: true });
      case 'r': {
        await answer();
        const { text, keyboard } = await this.screen_message(info);
        await this.edit(message.message_id, text, keyboard);
        this.remember_screen(message, terminal_id);
        return this.start_follow(terminal_id, message.message_id, text);
      }
      case 'k': {
        const key = Object.prototype.hasOwnProperty.call(KEYS, parts[2]) ? KEYS[parts[2]] : null;
        if (!key) return expired();
        if (!info.alive) return answer('That pane has exited.');
        this.deps.panes.write_terminal(terminal_id, key.data);
        await answer(key.label);
        return this.start_follow(terminal_id, message.message_id, null);
      }
      case 'c': {
        await answer('Closing…');
        return this.close_from_button(info, message);
      }
      default:
        return expired();
    }
  }

  async close_from_button(info, message) {
    const name = escape_html(pane_name(info));
    if (this.follow && this.follow.terminal_id === info.terminal_id) this.stop_follow();
    let result = null;
    try {
      result = await this.deps.panes.kill_terminal(info.terminal_id);
    } catch (error) {
      return this.edit(message.message_id, `⚠️ Could not close <b>${name}</b>: ${escape_html(error.message)}`);
    }
    if (this.current_id === info.terminal_id) this.current_id = null;
    this.emit('terminal_killed', { terminal_id: info.terminal_id });
    const kept = result && result.worktree_kept_reason ? `\nWorktree kept: ${escape_html(result.worktree_kept_reason)}` : '';
    return this.edit(message.message_id, `Closed <b>${name}</b>.${kept}`);
  }

  async launch_from_button(workspace_id, agent_id, message, answer, expired) {
    if (workspace_id === null || agent_id === null) return expired();
    await answer('Starting…');
    let info = null;
    try {
      info = await create_agent_pane(
        {
          list_workspaces: this.deps.list_workspaces,
          catalog: this.deps.catalog,
          check_commands: this.deps.check_commands,
          pty: this.deps.panes,
        },
        { workspace_id, agent_id }
      );
    } catch (error) {
      return this.edit(message.message_id, `⚠️ ${escape_html(error.message)}`);
    }
    this.current_id = info.terminal_id;
    this.emit('terminal_created', info);
    await this.edit(message.message_id, `Started <b>${escape_html(pane_name(info))}</b>. Messages now go to it.`);
    return this.post_screen(info, { follow: true });
  }
}

module.exports = { TelegramBot, is_secret_path, keep_tail, PAIR_TTL_MS, PAIR_MAX_TRIES };
