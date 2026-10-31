// Mobile-access settings: one JSON file in <userData>/mobile.json.
// Every function takes the file path as its first argument (like session_store.js), so the module is
// testable without Electron; only default_file_path() reads Electron, and only when it is called.
//
// Shape: { version: 1, enabled, bind_all, keep_awake, port, token }
// enabled: the server starts with the app. bind_all: listen on every interface (LAN / Tailscale)
// instead of loopback only. keep_awake: keep the PC awake while mobile access is on.
// port: 0 = pick a free one (the chosen port is saved, so the URL stays stable).
// token: 32 hex chars; the phone pairs with /m/<token>/ and the WebSocket /ws/<token>.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE_NAME = 'mobile.json';
const FILE_VERSION = 1;
const TOKEN_HEX_LENGTH = 32;

function default_file_path() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), FILE_NAME);
}

function new_token() {
  return crypto.randomBytes(TOKEN_HEX_LENGTH / 2).toString('hex');
}

// Returns a clean copy with safe defaults, so a hand-edited file cannot break the server.
function normalize_settings(raw) {
  const settings = raw && typeof raw === 'object' ? raw : {};
  const token = typeof settings.token === 'string' && new RegExp(`^[0-9a-f]{${TOKEN_HEX_LENGTH}}$`).test(settings.token)
    ? settings.token
    : new_token();
  const port = Number.isInteger(settings.port) && settings.port >= 0 && settings.port <= 65535 ? settings.port : 0;
  return {
    version: FILE_VERSION,
    enabled: settings.enabled === true,
    bind_all: settings.bind_all === true,
    keep_awake: settings.keep_awake === true,
    port,
    token,
  };
}

// A corrupt file is moved aside (never overwritten), so nothing is lost silently.
function move_corrupt_aside(file_path) {
  const aside_path = `${file_path}.corrupt-${Date.now()}`;
  try {
    fs.renameSync(file_path, aside_path);
  } catch (error) {
    console.error(`could not move ${file_path} aside: ${error.message}`);
  }
  console.error(`mobile settings were unreadable, moved to ${aside_path}`);
}

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
    move_corrupt_aside(file_path);
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

module.exports = {
  default_file_path,
  new_token,
  normalize_settings,
  read_settings,
  write_settings,
  FILE_VERSION,
  TOKEN_HEX_LENGTH,
};
