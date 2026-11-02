// Agent availability lookup: `where.exe` (Windows) / `which` for a list of command names.
// Pure Node, no Electron: ipc_agents.js re-exports these, and mobile_server.js uses them before the
// phone is allowed to spawn a pane.
const { execFile } = require('child_process');

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

module.exports = { check_commands, is_safe_command, MAX_CHECK_COMMANDS };
