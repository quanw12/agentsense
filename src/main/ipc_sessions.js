// ipcMain handlers for saved sessions (sessions:*) and the git check (git:is_repo).
const { ipcMain } = require('electron');

const session_store = require('./session_store');
const pty_manager = require('./pty_manager');
const worktree = require('./worktree');

function require_string(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
  return value;
}

function list_saved(workspace_id) {
  require_string(workspace_id, 'workspace_id');
  return session_store.list_saved(session_store.default_file_path(), workspace_id, pty_manager.live_record_ids());
}

// Forgets a saved record. A worktree of that record is left untouched.
function discard(record_id) {
  require_string(record_id, 'record_id');
  if (pty_manager.live_record_ids().has(record_id)) {
    throw new Error('this session is still running; close its pane instead');
  }
  session_store.remove_record(session_store.default_file_path(), record_id);
}

function note_error(record_id, message) {
  require_string(record_id, 'record_id');
  return session_store.set_last_error(session_store.default_file_path(), record_id, message);
}

function register_session_ipc() {
  ipcMain.handle('sessions:list_saved', (_event, workspace_id) => list_saved(workspace_id));
  ipcMain.handle('sessions:discard', (_event, record_id) => discard(record_id));
  ipcMain.handle('sessions:note_error', (_event, record_id, message) => note_error(record_id, message));
  ipcMain.handle('git:is_repo', (_event, folder_path) => worktree.is_git_repo(folder_path));
}

module.exports = { register_session_ipc, list_saved, discard, note_error };
