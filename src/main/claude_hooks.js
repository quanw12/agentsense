// Builds the per-pane Claude Code settings file that carries the hooks, and the claude command line that uses it.
// The user's own ~/.claude/settings.json is never touched: the file is passed with `claude --settings <file>`.
//
// Hook schema (Claude Code hooks reference): settings.hooks maps an event name to an array of matcher groups,
// each with a nested `hooks` array of handlers: { type: 'command', command, timeout }. No matcher is set, so
// the hook fires for every source / notification type.
const fs = require('fs');
const path = require('path');

const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd'];
const HOOK_TIMEOUT_SECONDS = 5;
const TERMINAL_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function is_valid_session_id(value) {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

function hooks_dir_for(user_data_dir) {
  return path.join(user_data_dir, 'hooks');
}

function hooks_file_for(hooks_dir, terminal_id) {
  if (!TERMINAL_ID_PATTERN.test(terminal_id)) throw new Error(`invalid terminal id: ${terminal_id}`);
  return path.join(hooks_dir, `${terminal_id}.json`);
}

// Shell command for one hook. The JSON Claude sends on stdin is posted as is. `; exit 0` keeps a failed post
// (for example after the app has quit) from showing a hook error in Claude Code. curl.exe is the Windows
// binary; Claude runs hook commands in Git Bash (or PowerShell when Git Bash is missing), where `;` works in both.
function build_hook_command(connection, terminal_id, event_name) {
  if (!connection || !Number.isInteger(connection.port) || typeof connection.token !== 'string') {
    throw new Error('hook server is not running');
  }
  if (!TERMINAL_ID_PATTERN.test(terminal_id)) throw new Error(`invalid terminal id: ${terminal_id}`);
  const url = `http://127.0.0.1:${connection.port}/hook/${connection.token}/${terminal_id}/${event_name}`;
  return `curl.exe -s -m 3 -X POST -H "Content-Type: application/json" --data-binary @- "${url}"; exit 0`;
}

// The settings object written to the hooks file.
function build_hooks_settings(connection, terminal_id) {
  const hooks = {};
  for (const event_name of HOOK_EVENTS) {
    hooks[event_name] = [
      {
        hooks: [
          {
            type: 'command',
            command: build_hook_command(connection, terminal_id, event_name),
            timeout: HOOK_TIMEOUT_SECONDS,
          },
        ],
      },
    ];
  }
  return { hooks };
}

// Writes <hooks_dir>/<terminal_id>.json (atomic: tmp file, then rename). Returns the file path.
function write_hooks_file(hooks_dir, terminal_id, connection) {
  const file_path = hooks_file_for(hooks_dir, terminal_id);
  const settings = build_hooks_settings(connection, terminal_id);
  fs.mkdirSync(hooks_dir, { recursive: true });
  const tmp_path = `${file_path}.tmp`;
  fs.writeFileSync(tmp_path, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(tmp_path, file_path);
  return file_path;
}

// Removes the hooks file of a terminal. A missing file is not an error. Returns true when a file was removed.
function delete_hooks_file(hooks_dir, terminal_id) {
  const file_path = hooks_file_for(hooks_dir, terminal_id);
  try {
    fs.rmSync(file_path, { force: true });
    return true;
  } catch (error) {
    return false;
  }
}

// Command line for a claude pane, run through cmd.exe (claude is an npm .cmd shim).
//   with hooks:    claude --settings "<hooks file>"  [--resume <session id>]
//   without hooks: claude  [--resume <session id>]
// The session id is checked here because it ends up in a shell command line.
function build_claude_command(hooks_file, resume_session_id) {
  const has_resume = resume_session_id !== undefined && resume_session_id !== null && resume_session_id !== '';
  if (has_resume && !is_valid_session_id(resume_session_id)) {
    throw new Error('resume session id has characters that are not allowed');
  }
  const parts = ['claude'];
  if (hooks_file) {
    // cmd.exe expands %NAME% even inside quotes, so % is refused as well as quotes and line breaks.
    if (/["%\r\n]/.test(hooks_file)) throw new Error('hooks file path has characters that are not allowed');
    parts.push('--settings', `"${hooks_file}"`);
  }
  if (has_resume) parts.push('--resume', resume_session_id);
  return parts.join(' ');
}

module.exports = {
  HOOK_EVENTS,
  build_hook_command,
  build_hooks_settings,
  write_hooks_file,
  delete_hooks_file,
  build_claude_command,
  hooks_dir_for,
  hooks_file_for,
  is_valid_session_id,
};
