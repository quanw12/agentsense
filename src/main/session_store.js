// Saved sessions: one record per pane, kept in <userData>/sessions.json. Records survive an app quit so the
// panes can be restored on the next start. Every function takes the file path as its first argument, so the
// module is testable without Electron. Only default_file_path() reads Electron, and only when it is called.
//
// Record shape:
// { record_id, workspace_id, agent_id, title, command, cwd, base_cwd, claude_session_id,
//   model_id, provider_id, last_error, resume_mode,
//   worktree: null | { path, branch, repo_path, base_commit } }
// Secrets (env_extra, api_key, tokens) are dropped on purpose and never written back.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE_NAME = 'sessions.json';
const FILE_VERSION = 1;

function default_file_path() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), FILE_NAME);
}

function is_non_empty_string(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function normalize_worktree(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!is_non_empty_string(raw.path) || !is_non_empty_string(raw.branch) || !is_non_empty_string(raw.repo_path)) {
    return null;
  }
  return {
    path: raw.path,
    branch: raw.branch,
    repo_path: raw.repo_path,
    base_commit: is_non_empty_string(raw.base_commit) ? raw.base_commit : null,
  };
}

// Returns a clean copy of a record, or null when a required field is missing or has the wrong type.
function normalize_record(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!is_non_empty_string(raw.record_id)) return null;
  if (raw.workspace_id !== null && raw.workspace_id !== undefined && typeof raw.workspace_id !== 'string') return null;
  const string_fields = ['agent_id', 'title', 'command', 'cwd'];
  for (const field of string_fields) {
    if (!is_non_empty_string(raw[field])) return null;
  }
  const optional = (field) => (is_non_empty_string(raw[field]) ? raw[field] : null);
  return {
    record_id: raw.record_id,
    workspace_id: typeof raw.workspace_id === 'string' ? raw.workspace_id : null,
    agent_id: raw.agent_id,
    title: raw.title,
    command: raw.command,
    cwd: raw.cwd,
    base_cwd: optional('base_cwd'),
    claude_session_id: optional('claude_session_id'),
    model_id: optional('model_id'),
    provider_id: optional('provider_id'),
    last_error: optional('last_error'),
    resume_mode: raw.resume_mode === 'conversation' || raw.resume_mode === 'terminal' || raw.resume_mode === 'unverified'
      ? raw.resume_mode
      : null,
    worktree: normalize_worktree(raw.worktree),
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
  console.error(`sessions file was unreadable, moved to ${aside_path}`);
}

function list_records(file_path) {
  let raw = null;
  try {
    raw = fs.readFileSync(file_path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.records)) {
    move_corrupt_aside(file_path);
    return [];
  }
  return parsed.records.map(normalize_record).filter((record) => record !== null);
}

function write_records(file_path, records) {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  const payload = { version: FILE_VERSION, records };
  const tmp_path = `${file_path}.tmp`;
  fs.writeFileSync(tmp_path, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp_path, file_path);
}

// Builds a new record with a fresh record_id. Fields that are not given default to null / empty.
function make_record(fields) {
  const record = normalize_record(Object.assign({ record_id: crypto.randomUUID() }, fields));
  if (!record) throw new Error('invalid saved session record');
  return record;
}

function find_record(file_path, record_id) {
  return list_records(file_path).find((record) => record.record_id === record_id) || null;
}

function add_record(file_path, record) {
  const records = list_records(file_path);
  records.push(normalize_record(record));
  write_records(file_path, records);
  return record;
}

// Removes old_record_id (when present) and appends the new record in one write, so a restore never leaves
// the old record and the new one side by side.
function replace_record(file_path, old_record_id, record) {
  const records = list_records(file_path).filter((item) => item.record_id !== old_record_id);
  records.push(normalize_record(record));
  write_records(file_path, records);
  return record;
}

function remove_record(file_path, record_id) {
  const records = list_records(file_path);
  const remaining = records.filter((record) => record.record_id !== record_id);
  if (remaining.length === records.length) return false;
  write_records(file_path, remaining);
  return true;
}

function remove_workspace_records(file_path, workspace_id) {
  const records = list_records(file_path);
  const remaining = records.filter((record) => record.workspace_id !== workspace_id);
  const removed = records.length - remaining.length;
  if (removed > 0) write_records(file_path, remaining);
  return removed;
}

// Only claude_session_id can be changed in place (a hook reports it after the record was written).
function update_record(file_path, record_id, patch) {
  const records = list_records(file_path);
  const index = records.findIndex((record) => record.record_id === record_id);
  if (index === -1) return null;
  records[index] = normalize_record(Object.assign({}, records[index], patch, { record_id }));
  write_records(file_path, records);
  return records[index];
}

function set_claude_session_id(file_path, record_id, claude_session_id) {
  if (!is_non_empty_string(claude_session_id)) return null;
  return update_record(file_path, record_id, { claude_session_id });
}

function set_last_error(file_path, record_id, last_error) {
  const message = is_non_empty_string(last_error) ? String(last_error).slice(0, 500) : null;
  return update_record(file_path, record_id, { last_error: message });
}

// Saved records of one workspace whose pane is not alive now. live_record_ids is a Set of record ids
// that belong to running panes; those are never returned.
function list_saved(file_path, workspace_id, live_record_ids) {
  const live = live_record_ids || new Set();
  return list_records(file_path).filter(
    (record) => record.workspace_id === workspace_id && !live.has(record.record_id)
  );
}

module.exports = {
  default_file_path,
  list_records,
  make_record,
  find_record,
  add_record,
  replace_record,
  remove_record,
  remove_workspace_records,
  set_claude_session_id,
  set_last_error,
  update_record,
  list_saved,
  normalize_record,
  FILE_NAME,
};
