// ipcMain handlers for the Telegram section of the mobile panel. Holds the Electron-only parts: the bot token is
// sealed with safeStorage (DPAPI on Windows) and the renderer can set it but never read it back.
const { ipcMain, powerSaveBlocker, safeStorage } = require('electron');

const settings_store = require('./telegram_settings');
const { TelegramBot } = require('./telegram_bot');
const { get_mobile_server } = require('./mobile_server');
const { get_hook_server } = require('./hook_server');
const { check_commands } = require('./command_check');
const { render_screen } = require('./terminal_screen');
const { broadcast } = require('./ipc_terminals');
const files = require('./ipc_files');
const pty_manager = require('./pty_manager');

const TOKEN_PATTERN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

let bot = null;
let saver_id = null;

function get_telegram_bot() {
  if (bot) return bot;
  bot = new TelegramBot({
    panes: pty_manager,
    hooks: get_hook_server(),
    list_workspaces: () => require('./store').list_workspaces(),
    catalog: require('../renderer/agents'),
    check_commands,
    render_screen,
    files,
    on_owner_changed: (owner_id, owner_name) => {
      update_settings({ owner_id, owner_name });
    },
  });
  return bot;
}

function read_settings() {
  return settings_store.read_settings(settings_store.default_file_path());
}

function update_settings(changes) {
  const file_path = settings_store.default_file_path();
  return settings_store.write_settings(file_path, { ...settings_store.read_settings(file_path), ...changes });
}

function encryption_available() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch (error) {
    return false;
  }
}

function unseal(sealed_token) {
  return safeStorage.decryptString(Buffer.from(sealed_token, 'base64'));
}

function update_saver() {
  const settings = read_settings();
  const wanted = settings.enabled && settings.keep_awake && Boolean(bot && bot.run);
  if (wanted && saver_id === null) {
    saver_id = powerSaveBlocker.start('prevent-app-suspension');
  } else if (!wanted && saver_id !== null) {
    powerSaveBlocker.stop(saver_id);
    saver_id = null;
  }
}

function build_state() {
  const settings = read_settings();
  const status = get_telegram_bot().get_status();
  return {
    enabled: settings.enabled,
    has_token: Boolean(settings.sealed_token),
    paired: Boolean(settings.owner_id),
    owner_name: settings.owner_name,
    notify: settings.notify,
    keep_awake: settings.keep_awake,
    encryption_available: encryption_available(),
    ...status,
  };
}

// A token sealed on another Windows account cannot be opened here; the panel then asks for it again.
async function restart_bot() {
  const instance = get_telegram_bot();
  await instance.stop();
  const settings = read_settings();
  if (settings.enabled && settings.sealed_token) {
    let token = null;
    try {
      token = unseal(settings.sealed_token);
    } catch (error) {
      update_settings({ sealed_token: null, enabled: false, owner_id: null, owner_name: null });
      update_saver();
      throw new Error('The saved bot token could not be read on this account. Save it again.');
    }
    instance.start({ token, owner_id: settings.owner_id, notify: settings.notify });
  }
  update_saver();
}

function stop_telegram_bot() {
  return bot ? bot.stop() : Promise.resolve();
}

function register_telegram_ipc() {
  ipcMain.handle('telegram:get_state', () => build_state());

  // A new token is a new bot, so it starts unpaired.
  ipcMain.handle('telegram:set_token', async (_event, token) => {
    const clean = typeof token === 'string' ? token.trim() : '';
    if (!TOKEN_PATTERN.test(clean)) throw new Error('That does not look like a bot token. Copy the whole token from @BotFather.');
    if (!encryption_available()) throw new Error('Windows cannot encrypt the token on this account, so it was not saved.');
    get_telegram_bot().clear_owner();
    update_settings({
      sealed_token: safeStorage.encryptString(clean).toString('base64'),
      owner_id: null,
      owner_name: null,
      enabled: true,
    });
    await restart_bot();
    return build_state();
  });

  ipcMain.handle('telegram:clear_token', async () => {
    get_telegram_bot().clear_owner();
    update_settings({ sealed_token: null, owner_id: null, owner_name: null, enabled: false });
    await restart_bot();
    return build_state();
  });

  ipcMain.handle('telegram:set_enabled', async (_event, enabled) => {
    update_settings({ enabled: enabled === true });
    await restart_bot();
    return build_state();
  });

  ipcMain.handle('telegram:new_pair_code', () => {
    const instance = get_telegram_bot();
    if (instance.run) instance.new_pair_code();
    return build_state();
  });

  ipcMain.handle('telegram:unpair', () => {
    get_telegram_bot().clear_owner();
    update_settings({ owner_id: null, owner_name: null });
    return build_state();
  });

  ipcMain.handle('telegram:set_notify', (_event, notify) => {
    const settings = update_settings({ notify: notify === true });
    get_telegram_bot().set_notify(settings.notify);
    return build_state();
  });

  ipcMain.handle('telegram:set_keep_awake', (_event, keep_awake) => {
    update_settings({ keep_awake: keep_awake === true });
    update_saver();
    return build_state();
  });

  // Panes the bot starts or closes reach the desktop and the phone page like any other pane event.
  const instance = get_telegram_bot();
  instance.on('terminal_created', (info) => {
    broadcast('terminals:created', info);
    const { buffer, ...terminal } = info;
    get_mobile_server().broadcast_all({ type: 'created', terminal });
  });
  instance.on('terminal_killed', ({ terminal_id }) => {
    broadcast('terminals:closed', terminal_id);
    get_mobile_server().broadcast_all({ type: 'closed', terminal_id });
  });

  // The bot comes back with the app when it was left on.
  restart_bot().catch((error) => {
    console.error(`telegram bot did not start: ${error && error.message ? error.message : error}`);
  });
}

module.exports = { register_telegram_ipc, stop_telegram_bot };
