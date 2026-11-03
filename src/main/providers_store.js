// Third-party API providers. The JSON file stores a sealed key (OS safeStorage), never a plaintext key
// after a successful migration. The renderer only receives metadata. Launch resolves the secret in this process.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_PROVIDERS = 30;
const MAX_MODELS = 60;
const KINDS = ['openai', 'anthropic'];
const MAX_NAME_LENGTH = 60;

let codec_override = null;
let file_override = null;

function providers_file_path() {
  if (file_override) return file_override;
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'providers.json');
}

function os_codec() {
  if (codec_override) return codec_override;
  const { safeStorage } = require('electron');
  return {
    available: () => {
      try { return safeStorage.isEncryptionAvailable(); } catch (error) { return false; }
    },
    encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
    decrypt: (payload) => safeStorage.decryptString(Buffer.from(payload, 'base64')),
  };
}

// Tests inject a codec. Production leaves this unset.
function set_codec_for_tests(codec) {
  codec_override = codec;
}

function set_file_for_tests(file_path) {
  file_override = file_path;
}

function seal_key(api_key) {
  const codec = os_codec();
  if (!codec.available()) {
    throw new Error('OS secret storage is unavailable; the API key was not saved');
  }
  return codec.encrypt(api_key);
}

function open_key(payload) {
  const codec = os_codec();
  if (!codec.available()) {
    throw new Error('OS secret storage is unavailable');
  }
  return codec.decrypt(payload);
}

function normalize_models(models) {
  if (!Array.isArray(models)) return [];
  return models
    .map((model) => (typeof model === 'string' ? model.trim() : ''))
    .filter((model) => model !== '')
    .slice(0, MAX_MODELS);
}

function public_provider(item) {
  return {
    id: item.id,
    name: item.name,
    kind: item.kind,
    base_url: item.base_url,
    models: item.models,
    has_secret: item.secret_status === 'sealed' || item.secret_status === 'decrypt_failed',
    secret_status: item.secret_status,
  };
}

function normalize_stored(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || raw.id.trim() === '') return null;
  if (typeof raw.name !== 'string' || raw.name.trim() === '') return null;
  const kind = KINDS.includes(raw.kind) ? raw.kind : 'openai';
  const base_url = typeof raw.base_url === 'string' ? raw.base_url.trim() : '';
  const models = normalize_models(raw.models);
  const sealed = typeof raw.api_key_enc === 'string' && raw.api_key_enc.trim() !== '' ? raw.api_key_enc.trim() : '';
  const plain = typeof raw.api_key === 'string' ? raw.api_key.trim() : '';
  let secret_status = 'empty';
  let api_key_enc = sealed;
  if (sealed) secret_status = 'sealed';
  else if (plain) secret_status = 'plaintext_pending';
  if (raw.secret_status === 'decrypt_failed' && sealed) secret_status = 'decrypt_failed';
  return {
    id: raw.id,
    name: raw.name.trim().slice(0, MAX_NAME_LENGTH),
    kind,
    base_url,
    models,
    api_key_enc,
    secret_status,
    // Held only in memory during migration. Never written back.
    pending_plain: secret_status === 'plaintext_pending' ? plain : '',
  };
}

function to_disk(item) {
  return {
    id: item.id,
    name: item.name,
    kind: item.kind,
    base_url: item.base_url,
    models: item.models,
    api_key_enc: item.api_key_enc || '',
    secret_status: item.secret_status === 'decrypt_failed' ? 'decrypt_failed' : (item.api_key_enc ? 'sealed' : 'empty'),
  };
}

function read_stored(file_path) {
  let raw = null;
  try {
    raw = fs.readFileSync(file_path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    return (Array.isArray(parsed.providers) ? parsed.providers : [])
      .map(normalize_stored)
      .filter(Boolean);
  } catch (error) {
    const aside_path = `${file_path}.corrupt-${Date.now()}`;
    fs.renameSync(file_path, aside_path);
    console.error(`providers.json was unreadable, moved to ${aside_path}`);
    return [];
  }
}

function write_stored(file_path, providers) {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  const payload = { version: 2, providers: providers.map(to_disk) };
  const serialized = JSON.stringify(payload, null, 2);
  if (/"api_key"\s*:/.test(serialized)) {
    throw new Error('refusing to write a provider file that still contains an api_key field');
  }
  const tmp_path = `${file_path}.${process.pid}.tmp`;
  fs.writeFileSync(tmp_path, serialized, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp_path, file_path);
}

// Seals any plaintext keys already on disk. If sealing is unavailable, the file is left untouched.
function migrate_plaintext(file_path, providers) {
  const pending = providers.filter((item) => item.pending_plain);
  if (pending.length === 0) return providers;
  let codec_ok = false;
  try { codec_ok = os_codec().available(); } catch (error) { codec_ok = false; }
  if (!codec_ok) return providers;
  const next = providers.map((item) => {
    if (!item.pending_plain) return item;
    return {
      ...item,
      api_key_enc: seal_key(item.pending_plain),
      pending_plain: '',
      secret_status: 'sealed',
    };
  });
  write_stored(file_path, next);
  return next;
}

function load_all(file_path) {
  const stored = read_stored(file_path);
  return migrate_plaintext(file_path, stored);
}

function list_providers() {
  return load_all(providers_file_path()).map(public_provider);
}

function save_provider(provider) {
  if (!provider || typeof provider !== 'object') throw new Error('provider must be an object');
  const name = typeof provider.name === 'string' ? provider.name.trim() : '';
  if (name === '') throw new Error('provider name is required');
  const kind = provider.kind === 'anthropic' ? 'anthropic' : 'openai';
  const base_url = typeof provider.base_url === 'string' ? provider.base_url.trim() : '';
  if (base_url === '' || !/^https?:\/\/.+/i.test(base_url)) {
    throw new Error('provider base_url must be an http(s) URL');
  }
  const models = normalize_models(provider.models);
  const file_path = providers_file_path();
  const state = load_all(file_path);
  const incoming = typeof provider.api_key === 'string' ? provider.api_key.trim() : '';
  const provider_id = typeof provider.id === 'string' ? provider.id.trim() : '';

  if (provider_id !== '') {
    const index = state.findIndex((item) => item.id === provider_id);
    if (index === -1) throw new Error(`provider not found: ${provider_id}`);
    const current = state[index];
    let api_key_enc = current.api_key_enc;
    let secret_status = current.secret_status;
    if (incoming !== '') {
      api_key_enc = seal_key(incoming);
      secret_status = 'sealed';
    }
    state[index] = {
      ...current,
      name: name.slice(0, MAX_NAME_LENGTH),
      kind,
      base_url,
      models,
      api_key_enc,
      secret_status,
      pending_plain: '',
    };
    write_stored(file_path, state);
    return public_provider(state[index]);
  }

  if (state.length >= MAX_PROVIDERS) throw new Error(`at most ${MAX_PROVIDERS} providers are stored`);
  if (incoming === '') throw new Error('provider api_key is required');
  const created = {
    id: crypto.randomUUID(),
    name: name.slice(0, MAX_NAME_LENGTH),
    kind,
    base_url,
    models,
    api_key_enc: seal_key(incoming),
    secret_status: 'sealed',
    pending_plain: '',
  };
  state.push(created);
  write_stored(file_path, state);
  return public_provider(created);
}

function remove_provider(provider_id) {
  if (typeof provider_id !== 'string' || provider_id.trim() === '') throw new Error('provider id is required');
  const file_path = providers_file_path();
  const remaining = load_all(file_path).filter((item) => item.id !== provider_id);
  write_stored(file_path, remaining);
}

// Used only by the main process when a pane is launched. Returns null when the provider is gone.
// Throws when the sealed key cannot be opened, so the caller can tell the user instead of swapping providers.
function require_provider_secret(provider_id) {
  if (typeof provider_id !== 'string' || provider_id.trim() === '') return null;
  const found = load_all(providers_file_path()).find((item) => item.id === provider_id);
  if (!found) return null;
  if (!found.api_key_enc || found.secret_status === 'plaintext_pending') {
    throw new Error(`provider ${found.name} has no sealed API key; open Manage APIs and save the key again`);
  }
  try {
    return { ...public_provider(found), api_key: open_key(found.api_key_enc) };
  } catch (error) {
    found.secret_status = 'decrypt_failed';
    const file_path = providers_file_path();
    const all = load_all(file_path).map((item) => item.id === found.id ? { ...item, secret_status: 'decrypt_failed' } : item);
    write_stored(file_path, all);
    throw new Error(`could not decrypt the API key for ${found.name}; it was kept, not deleted`);
  }
}

module.exports = {
  list_providers,
  save_provider,
  remove_provider,
  providers_file_path,
  require_provider_secret,
  set_codec_for_tests,
  set_file_for_tests,
  public_provider,
  load_all,
  write_stored,
  read_stored,
};
