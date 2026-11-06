// Telegram bot settings: one JSON file in <userData>/telegram.json, written like mobile_settings.js.
// Every function takes the file path first, so the module is testable without Electron.
//
// Shape: { version: 1, enabled, sealed_token, owner_id, owner_name, notify, keep_awake }
// sealed_token: the bot token encrypted by the caller (ipc_telegram.js uses Electron safeStorage). This module
// never sees the plain token. owner_id: the only Telegram user the bot obeys, set by pairing.
const fs = require('fs');
const path = require('path');

const FILE_NAME = 'telegram.json';
const FILE_VERSION = 1;
const MAX_OWNER_NAME = 80;

function default_file_path() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), FILE_NAME);
}

function normalize_settings(raw) {
  const settings = raw && typeof raw === 'object' ? raw : {};
  const owner_id = Number.isSafeInteger(settings.owner_id) && settings.owner_id > 0 ? settings.owner_id : null;
  return {
    version: FILE_VERSION,
    enabled: settings.enabled === true,
    sealed_token: typeof settings.sealed_token === 'string' && settings.sealed_token !== '' ? settings.sealed_token : null,
    owner_id,
    owner_name: owner_id && typeof settings.owner_name === 'string' ? settings.owner_name.slice(0, MAX_OWNER_NAME) : null,
    notify: settings.notify !== false,
    keep_awake: settings.keep_awake === true,
  };
}

// A corrupt file is moved aside (never overwritten) and the bot comes back disabled and unpaired.
function read_settings(file_path) {
  let raw = null;
  try {
    raw = fs.readFileSync(file_path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return normalize_settings(null);
    throw error;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object') {
    const aside_path = `${file_path}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(file_path, aside_path);
      console.error(`telegram settings were unreadable, moved to ${aside_path}`);
    } catch (error) {
      console.error(`could not move ${file_path} aside: ${error.message}`);
    }
    return normalize_settings(null);
  }
  return normalize_settings(parsed);
}

function write_settings(file_path, settings) {
  const clean = normalize_settings(settings);
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  const tmp_path = `${file_path}.tmp`;
  fs.writeFileSync(tmp_path, JSON.stringify(clean, null, 2), 'utf8');
  fs.renameSync(tmp_path, file_path);
  return clean;
}

module.exports = { default_file_path, normalize_settings, read_settings, write_settings, FILE_VERSION };
