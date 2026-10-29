// Persistence for third-party API providers: a JSON file (providers.json) in app.getPath('userData').
// Shape: providers: [{ id, name, kind, base_url, api_key, models: [string, ...] }]
// kind is 'openai' or 'anthropic'; it selects which env vars the launch page builds for a seat.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { app } = require('electron');

const MAX_PROVIDERS = 30;
const MAX_MODELS = 60;
const KINDS = ['openai', 'anthropic'];
const MAX_NAME_LENGTH = 60;

function providers_file_path() {
  return path.join(app.getPath('userData'), 'providers.json');
}

// A hand-edited or older file keeps working: unknown shapes are dropped, not fatal.
function normalize_provider(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || raw.id.trim() === '') return null;
  if (typeof raw.name !== 'string' || raw.name.trim() === '') return null;
  const kind = KINDS.includes(raw.kind) ? raw.kind : 'openai';
  const base_url = typeof raw.base_url === 'string' ? raw.base_url.trim() : '';
  const api_key = typeof raw.api_key === 'string' ? raw.api_key.trim() : '';
  const models = Array.isArray(raw.models)
    ? raw.models.filter((m) => typeof m === 'string' && m.trim() !== '').slice(0, MAX_MODELS)
    : [];
  return { id: raw.id, name: raw.name.trim().slice(0, MAX_NAME_LENGTH), kind, base_url, api_key, models };
}

function read_providers() {
  const file_path = providers_file_path();
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
      .map(normalize_provider)
      .filter(Boolean);
  } catch (error) {
    const aside_path = `${file_path}.corrupt-${Date.now()}`;
    fs.renameSync(file_path, aside_path);
    console.error(`providers.json was unreadable, moved to ${aside_path}`);
    return [];
  }
}

function write_providers(providers) {
  const file_path = providers_file_path();
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  const tmp_path = `${file_path}.tmp`;
  fs.writeFileSync(tmp_path, JSON.stringify({ providers }, null, 2), 'utf8');
  fs.renameSync(tmp_path, file_path);
}

function list_providers() {
  return read_providers();
}

// Validates one provider from the page and stores it. Without `id` a new one is created;
// with an existing `id` that provider is overwritten (the UI sends all of it every time).
function save_provider(provider) {
  if (!provider || typeof provider !== 'object') {
    throw new Error('provider must be an object');
  }
  const name = typeof provider.name === 'string' ? provider.name.trim() : '';
  if (name === '') throw new Error('provider name is required');
  const kind = provider.kind === 'anthropic' ? 'anthropic' : 'openai';
  const base_url = typeof provider.base_url === 'string' ? provider.base_url.trim() : '';
  if (base_url === '' || !/^https?:\/\/.+/i.test(base_url)) {
    throw new Error('provider base_url must be an http(s) URL');
  }
  const api_key = typeof provider.api_key === 'string' ? provider.api_key.trim() : '';
  const models = Array.isArray(provider.models)
    ? provider.models
        .map((model) => (typeof model === 'string' ? model.trim() : ''))
        .filter((model) => model !== '')
        .slice(0, MAX_MODELS)
    : [];

  const state = read_providers();
  const provider_id = typeof provider.id === 'string' ? provider.id.trim() : '';
  if (provider_id !== '') {
    const index = state.findIndex((item) => item.id === provider_id);
    if (index === -1) throw new Error(`provider not found: ${provider_id}`);
    state[index] = { ...state[index], name: name.slice(0, MAX_NAME_LENGTH), kind, base_url, api_key, models };
    write_providers(state);
    return state[index];
  }

  if (state.length >= MAX_PROVIDERS) {
    throw new Error(`at most ${MAX_PROVIDERS} providers are stored`);
  }
  const created = { id: crypto.randomUUID(), name: name.slice(0, MAX_NAME_LENGTH), kind, base_url, api_key, models };
  state.push(created);
  write_providers(state);
  return created;
}

function remove_provider(provider_id) {
  if (typeof provider_id !== 'string' || provider_id.trim() === '') {
    throw new Error('provider id is required');
  }
  const remaining = read_providers().filter((item) => item.id !== provider_id);
  write_providers(remaining);
}

module.exports = {
  list_providers,
  save_provider,
  remove_provider,
  providers_file_path,
};
