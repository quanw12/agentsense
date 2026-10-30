// PATH as the registry holds it now, not as this process inherited it at launch. A running process never
// sees PATH changes made after it started, so an agent CLI installed later (its folder added to the user
// PATH) is invisible to it. Windows only; elsewhere the process PATH is returned unchanged.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');

const REG_TIMEOUT_MS = 5000;
const CACHE_MS = 3000; // the user may install an agent while the app runs
const MACHINE_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';
const USER_KEY = 'HKCU\\Environment';
const REG_PATH_PATTERN = /^\s*Path\s+REG_\w+\s+(.*?)\s*$/im;
const VAR_PATTERN = /%([^%]+)%/g;
// Per-user vendor bin folders that an installer may leave off the Windows PATH (xAI's Grok Build installer
// only edits ~/.bashrc). They are appended AFTER the registry entries, so an earlier entry still wins (for
// example Cursor's `agent` over xAI's agent.exe). A folder is added only when it exists on disk. The
// Windows PATH itself is never changed.
const EXTRA_PATH_DIRS = ['%USERPROFILE%\\.grok\\bin'];

let cache = null; // { value, read_at }

// Raw data of the Path value under a registry key, or null when reg.exe fails or the value is missing.
function read_registry_path(key) {
  try {
    const output = execFileSync('reg.exe', ['query', key, '/v', 'Path'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: REG_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = REG_PATH_PATTERN.exec(output);
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
}

// Expands %NAME% from env, matching names case-insensitively. Unknown names are left as written.
function expand_variables(value, env) {
  const by_upper_name = new Map();
  for (const name of Object.keys(env)) {
    by_upper_name.set(name.toUpperCase(), env[name]);
  }
  return value.replace(VAR_PATTERN, (whole, name) => {
    const found = by_upper_name.get(name.toUpperCase());
    return found === undefined ? whole : found;
  });
}

function split_entries(value) {
  return (value || '')
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

// Dedupe key: case-insensitive, no quotes, no trailing backslash or slash.
function entry_key(entry) {
  return entry.replace(/"/g, '').replace(/[\\/]+$/, '').trim().toLowerCase();
}

function is_existing_dir(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch (error) {
    return false;
  }
}

// Joins the entry lists in order, keeping the first spelling of each directory. Then appends each extra
// directory that dir_exists accepts and that is not already in the list. An extra directory already present
// earlier keeps its place. dir_exists is injectable so tests need no disk.
function build_path_list(lists, extra_dirs, dir_exists = is_existing_dir) {
  const seen = new Set();
  const entries = [];
  for (const entry of lists.flat()) {
    const key = entry_key(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  for (const dir of extra_dirs) {
    const key = entry_key(dir);
    if (seen.has(key) || !dir_exists(dir)) continue;
    seen.add(key);
    entries.push(dir);
  }
  return entries.join(';');
}

// Environment used to expand %NAME% in EXTRA_PATH_DIRS. USERPROFILE falls back to the home directory.
function extra_dir_env() {
  return Object.assign({ USERPROFILE: os.homedir() }, process.env);
}

// Machine entries, then User entries, then the process PATH entries that are not already present, then
// the EXTRA_PATH_DIRS that exist. When reg.exe fails for both keys, the process PATH entries are used.
function get_fresh_path() {
  const inherited = process.env.PATH || '';
  if (process.platform !== 'win32') return inherited;

  const now = Date.now();
  if (cache !== null && now - cache.read_at < CACHE_MS) return cache.value;

  let lists = [split_entries(inherited)];
  try {
    const machine_value = read_registry_path(MACHINE_KEY);
    const user_value = read_registry_path(USER_KEY);
    if (machine_value !== null || user_value !== null) {
      const machine_entries = split_entries(expand_variables(machine_value || '', process.env));
      const user_entries = split_entries(expand_variables(user_value || '', process.env));
      lists = [machine_entries, user_entries, split_entries(inherited)];
    }
  } catch (error) {
    lists = [split_entries(inherited)];
  }
  const env = extra_dir_env();
  const extra_dirs = EXTRA_PATH_DIRS.map((dir) => expand_variables(dir, env));
  const value = build_path_list(lists, extra_dirs);
  cache = { value, read_at: now };
  return value;
}

// Copy of base_env with PATH set to get_fresh_path(). On Windows environment names are case-insensitive
// but a plain object is not, so any other casing of PATH (such as Path) is removed first to avoid two keys.
function env_with_fresh_path(base_env) {
  const env = Object.assign({}, base_env);
  if (process.platform === 'win32') {
    for (const name of Object.keys(env)) {
      if (name.toUpperCase() === 'PATH') delete env[name];
    }
  }
  env.PATH = get_fresh_path();
  return env;
}

module.exports = { get_fresh_path, env_with_fresh_path, build_path_list, EXTRA_PATH_DIRS };
