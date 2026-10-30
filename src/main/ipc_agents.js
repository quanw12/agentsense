// ipcMain handlers for agent availability (agents:check) and launch presets (presets:*).
const { execFile } = require('child_process');
const { ipcMain } = require('electron');

const store = require('./store');
const { env_with_fresh_path } = require('./fresh_path');

const MAX_CHECK_COMMANDS = 64;
// Only plain executable names. Anything else (spaces, &, |, quotes, wildcards) is reported as
// not installed and never reaches a process.
const COMMAND_PATTERN = /^[A-Za-z0-9._-]+$/;
const ALWAYS_INSTALLED = new Set(['powershell.exe', 'cmd.exe']);
const LOOKUP_TOOL = process.platform === 'win32' ? 'where.exe' : 'which';
const LOOKUP_TIMEOUT_MS = 5000;

function is_safe_command(command) {
  return COMMAND_PATTERN.test(command) && !command.startsWith('-');
}

// `where <command>` exits 0 when the command is on PATH. No shell is involved.
// env carries the fresh PATH, so agents installed after the app started are found.
function lookup_command(command, env) {
  return new Promise((resolve) => {
    execFile(LOOKUP_TOOL, [command], { windowsHide: true, timeout: LOOKUP_TIMEOUT_MS, env }, (error) => {
      resolve(!error);
    });
  });
}

// Returns { [command]: boolean }. Non-string entries are ignored.
async function check_commands(commands) {
  if (!Array.isArray(commands)) throw new Error('commands must be an array of strings');
  if (commands.length > MAX_CHECK_COMMANDS) {
    throw new Error(`at most ${MAX_CHECK_COMMANDS} commands can be checked at once`);
  }
  const unique = [...new Set(commands.filter((command) => typeof command === 'string'))];
  const lookup_env = env_with_fresh_path(process.env);
  const entries = await Promise.all(
    unique.map(async (command) => {
      if (!is_safe_command(command)) return [command, false];
      if (ALWAYS_INSTALLED.has(command)) return [command, true];
      return [command, await lookup_command(command, lookup_env)];
    })
  );
  return Object.fromEntries(entries);
}

function register_agent_ipc() {
  ipcMain.handle('agents:check', (_event, commands) => check_commands(commands));
  ipcMain.handle('presets:list', () => store.list_presets());
  ipcMain.handle('presets:save', (_event, preset) => store.save_preset(preset));
  ipcMain.handle('presets:remove', (_event, preset_id) => store.remove_preset(preset_id));
}

module.exports = { register_agent_ipc, check_commands };
