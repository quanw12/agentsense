// Owns every pty session. Nothing else in the main process spawns ptys.
// Emits 'data' (terminal_id, data) and 'exit' (terminal_id, exit_code) on terminal_events.
// Also keeps the saved-session record of each pane (session_store), the worktree of a pane (worktree) and the
// Claude Code hooks file of a claude pane (claude_hooks, status comes in through hook_server).
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const pty = require('node-pty');
const { env_with_fresh_path } = require('./fresh_path');
const session_store = require('./session_store');
const worktree = require('./worktree');
const claude_hooks = require('./claude_hooks');
const { get_hook_server } = require('./hook_server');
const cli_capabilities = require('./cli_capabilities');
const providers_store = require('./providers_store');

const RING_BUFFER_LIMIT = 200 * 1024; // characters kept per terminal for repaint after reload
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DIRECT_COMMANDS = ['powershell.exe', 'cmd.exe'];

const sessions = new Map(); // terminal_id -> session
const terminal_events = new EventEmitter();
const lifecycle = [];
let desktop_present = () => false;

function note_life(step, detail) {
  lifecycle.push({ at: Date.now(), step, detail: detail || null });
  if (lifecycle.length > 400) lifecycle.shift();
}

function set_desktop_present(fn) {
  desktop_present = typeof fn === 'function' ? fn : () => false;
}

function clamp_size(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

// powershell.exe and cmd.exe are spawned directly. Everything else goes through cmd.exe /d /s /c "<command>".
// The command is passed as one raw command line: node-pty would backslash-escape the quotes of an argument
// list, and cmd.exe cannot read those (the hooks file path is quoted).
function resolve_spawn(command) {
  if (DIRECT_COMMANDS.includes(command.toLowerCase())) {
    return { file: command, args: [] };
  }
  return { file: 'cmd.exe', args: `/d /s /c "${command}"` };
}

function resolve_cwd(cwd) {
  if (!cwd) return os.homedir();
  let stat = null;
  try {
    stat = fs.statSync(cwd);
  } catch (error) {
    throw new Error(`cwd does not exist: ${cwd}`);
  }
  if (!stat.isDirectory()) throw new Error(`cwd is not a folder: ${cwd}`);
  return cwd;
}

function same_path(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  if (process.platform === 'win32') return path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();
  return path.normalize(left) === path.normalize(right);
}

// Explicit agent_id, else the first word of the command without .exe (legacy callers pass only a command).
function normalize_agent_id(agent_id, command) {
  if (typeof agent_id === 'string' && agent_id.trim() !== '') {
    return agent_id.trim().toLowerCase().slice(0, 40);
  }
  const first_word = command.split(/\s+/)[0] || '';
  return path.basename(first_word).replace(/\.exe$/i, '').toLowerCase() || 'custom';
}

function normalize_resume_id(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!claude_hooks.is_valid_session_id(value)) throw new Error('resume_session_id has characters that are not allowed');
  return value;
}

// <userData>/hooks: one settings file per claude pane. Electron is read only when this is called.
function hooks_dir() {
  const { app } = require('electron');
  return claude_hooks.hooks_dir_for(app.getPath('userData'));
}

// Per-seat env from the launch page (models, third-party APIs). Only well-formed pairs are kept:
// NAME characters [A-Za-z_][A-Za-z0-9_]* and a string value; anything else is dropped.
function env_extra(opts) {
  const extra = opts && opts.env_extra;
  if (!extra || typeof extra !== 'object') return {};
  const result = {};
  for (const [key, value] of Object.entries(extra)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (typeof value !== 'string' || value.length > 8192) continue;
    result[key] = value;
  }
  return result;
}

function append_buffer(session, data) {
  session.buffer += data;
  if (session.buffer.length > RING_BUFFER_LIMIT) {
    session.buffer = session.buffer.slice(session.buffer.length - RING_BUFFER_LIMIT);
  }
}

function to_info(session) {
  return {
    terminal_id: session.terminal_id,
    workspace_id: session.workspace_id,
    agent_id: session.agent_id,
    title: session.title,
    command: session.command,
    cwd: session.cwd,
    base_cwd: session.base_cwd,
    alive: session.alive,
    exit_code: session.exit_code,
    pid: session.pid,
    buffer: session.buffer,
    record_id: session.record_id,
    worktree: session.worktree,
    model_id: session.model_id,
    provider_id: session.provider_id,
    resume_mode: session.resume_mode,
    cols: session.cols,
    rows: session.rows,
    size_owner: session.size_owner,
  };
}

// Model and provider ids only. env_extra from the renderer is ignored so API keys never land in the session record.
function launch_context(agent_id, options) {
  const model_id = typeof options.model_id === 'string' && options.model_id.trim() !== '' ? options.model_id.trim() : null;
  const provider_id = typeof options.provider_id === 'string' && options.provider_id.trim() !== '' ? options.provider_id.trim() : null;
  const caps = cli_capabilities.capability_for(agent_id);
  const env = {};
  if (provider_id) {
    const provider = providers_store.require_provider_secret(provider_id);
    if (!provider) throw new Error('the selected provider no longer exists; choose another provider');
    cli_capabilities.assert_provider_compatible(agent_id, provider.kind);
    if (provider.kind === 'anthropic') {
      env.ANTHROPIC_BASE_URL = provider.base_url;
      env.ANTHROPIC_AUTH_TOKEN = provider.api_key;
      if (model_id) env.ANTHROPIC_MODEL = model_id;
    } else {
      env.OPENAI_BASE_URL = provider.base_url;
      env.OPENAI_API_KEY = provider.api_key;
      if (model_id) env.OPENAI_MODEL = model_id;
    }
  } else if (model_id) {
    if (!caps.model_env) {
      throw new Error(`${agent_id} has no verified model flag in this build; launch with the CLI default`);
    }
    Object.assign(env, cli_capabilities.model_env(agent_id, model_id));
  }
  return { env, model_id, provider_id, resume_mode: caps.resume };
}

function worktree_public(worktree_info) {
  if (!worktree_info) return null;
  return {
    path: worktree_info.path,
    branch: worktree_info.branch,
    repo_path: worktree_info.repo_path,
    base_commit: worktree_info.base_commit || null,
  };
}

function empty_kill_result() {
  return { worktree_removed: false, worktree_path: null, worktree_kept_reason: null };
}

function log_error(message, error) {
  console.error(`${message}: ${error && error.message ? error.message : error}`);
}

// Opts: workspace_id, agent_id, cwd, command, title, cols, rows, use_worktree, restore_record_id, resume_session_id.
// Resolves with { terminal_id, cwd, worktree }. Rejects (and starts nothing) when the worktree cannot be made.
async function create_terminal(opts) {
  const options = opts || {};
  const base_command = (options.command || '').trim() || 'powershell.exe';
  const agent_id = normalize_agent_id(options.agent_id, base_command);
  const workspace_id = typeof options.workspace_id === 'string' ? options.workspace_id : null;
  const title = options.title || base_command;
  const requested_cwd = resolve_cwd(options.cwd);
  const cols = clamp_size(options.cols, DEFAULT_COLS);
  const rows = clamp_size(options.rows, DEFAULT_ROWS);
  const resume_session_id = normalize_resume_id(options.resume_session_id);
  const context = launch_context(agent_id, options);
  note_life('create-start', agent_id);
  const restore_id = typeof options.restore_record_id === 'string' && options.restore_record_id !== ''
    ? options.restore_record_id
    : null;
  const restore_record = restore_id ? session_store.find_record(session_store.default_file_path(), restore_id) : null;
  // Only a plain `claude` command of a claude pane gets the hooks; other commands (a test shell, a custom
  // command) are started exactly as given.
  const wrap_claude = agent_id === 'claude' && base_command.toLowerCase() === 'claude';

  let cwd = requested_cwd;
  const base_cwd = typeof options.base_cwd === 'string' && options.base_cwd.trim() !== ''
    ? resolve_cwd(options.base_cwd)
    : requested_cwd;
  let worktree_info = null;
  let created_worktree = false;
  if (options.use_worktree === true && (await worktree.is_git_repo(requested_cwd))) {
    worktree_info = await worktree.create_worktree({ repo_path: requested_cwd, name: title });
    cwd = worktree_info.path;
    created_worktree = true;
  } else if (restore_record && restore_record.worktree && same_path(restore_record.worktree.path, requested_cwd)) {
    // A restored pane keeps the worktree it had.
    worktree_info = restore_record.worktree;
  }

  const terminal_id = crypto.randomUUID();
  const connection = wrap_claude ? get_hook_server().get_connection() : null;
  let hooks_file = null;
  let proc = null;
  try {
    let spawn_command = base_command;
    if (wrap_claude) {
      if (connection) hooks_file = claude_hooks.write_hooks_file(hooks_dir(), terminal_id, connection);
      spawn_command = claude_hooks.build_claude_command(hooks_file, resume_session_id);
    }
    const spawn_spec = resolve_spawn(spawn_command);
    // PATH is read fresh so panes can run agents installed after the app started. env_extra carries the
    // per-seat model/API settings chosen on the launch page.
    const env = env_with_fresh_path(Object.assign({}, process.env, context.env, { TERM: 'xterm-256color' }));
    // useConptyDll avoids node-pty's console-list helper. That helper calls AttachConsole
    // after the console is already destroyed, so a normal kill printed a native exception.
    const spawn_options = {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    };
    if (process.platform === 'win32') {
      spawn_options.useConpty = true;
      spawn_options.useConptyDll = true;
    }
    proc = pty.spawn(spawn_spec.file, spawn_spec.args, spawn_options);
    watch_native_exit(proc);
  } catch (error) {
    if (hooks_file) claude_hooks.delete_hooks_file(hooks_dir(), terminal_id);
    if (created_worktree) {
      await worktree.remove_if_clean(worktree_info).catch(() => null);
    }
    note_life('create-failed', error && error.message);
    throw error;
  }

  const kept_worktree = worktree_public(worktree_info);
  const record_fields = {
    workspace_id,
    agent_id,
    title: String(title),
    command: base_command,
    cwd,
    base_cwd,
    claude_session_id: resume_session_id || (restore_record && restore_record.claude_session_id) || null,
    model_id: context.model_id || (restore_record && restore_record.model_id) || null,
    provider_id: context.provider_id || (restore_record && restore_record.provider_id) || null,
    resume_mode: context.resume_mode,
    last_error: null,
    worktree: kept_worktree,
  };
  if (restore_id) record_fields.record_id = restore_id;
  const record = session_store.make_record(record_fields);

  const session = {
    terminal_id,
    record_id: record.record_id,
    workspace_id,
    agent_id,
    title,
    command: base_command,
    cwd,
    base_cwd,
    pty: proc,
    pid: proc.pid,
    alive: true,
    exit_code: null,
    buffer: '',
    cols,
    rows,
    size_owner: 'desktop',
    mobile_viewport: null,
    claude_session_id: record.claude_session_id,
    model_id: context.model_id,
    provider_id: context.provider_id,
    resume_mode: context.resume_mode,
    hooks_file,
    worktree: kept_worktree,
  };
  sessions.set(terminal_id, session);
  if (hooks_file) get_hook_server().register_terminal(terminal_id);

  try {
    if (restore_id) {
      session_store.replace_record(session_store.default_file_path(), restore_id, record);
    } else {
      session_store.add_record(session_store.default_file_path(), record);
    }
  } catch (error) {
    log_error('could not save the session record', error);
  }

  proc.onData((data) => {
    // Ignore output from a session that was killed and removed.
    if (!sessions.has(terminal_id)) return;
    append_buffer(session, data);
    terminal_events.emit('data', terminal_id, data);
  });

  proc.onExit(({ exitCode }) => {
    // A killed session is already removed; its exit is not reported.
    // Keep the pty object here. This callback runs on the ConPTY completion path, and
    // dropping the last reference from it can free the native handles before that path returns.
    if (!sessions.has(terminal_id)) return;
    session.alive = false;
    session.exit_code = exitCode;
    console.log(`pty socket exit id=${terminal_id} code=${exitCode}`);
    note_life('exit', terminal_id);
    // Keep the saved record, including worktree identity, so Restart can resolve it.
    // An explicit close is what removes the record.
    if (session.hooks_file) claude_hooks.delete_hooks_file(hooks_dir(), terminal_id);
    terminal_events.emit('exit', terminal_id, exitCode);
  });

  note_life('create-ready', terminal_id);
  return {
    terminal_id,
    cwd,
    base_cwd,
    record_id: record.record_id,
    model_id: context.model_id,
    provider_id: context.provider_id,
    resume_mode: context.resume_mode,
    worktree: kept_worktree,
  };
}

function write_terminal(terminal_id, data) {
  const session = sessions.get(terminal_id);
  if (!session || !session.alive) return;
  session.pty.write(String(data));
}

function resize_terminal(terminal_id, cols, rows, source) {
  const session = sessions.get(terminal_id);
  if (!session || !session.alive || !session.pty) return { applied: false, reason: 'not-running' };
  const origin = source === 'mobile' ? 'mobile' : 'desktop';
  const next_cols = clamp_size(cols, DEFAULT_COLS);
  const next_rows = clamp_size(rows, DEFAULT_ROWS);
  // The visible desktop pane owns the process size. A phone resize is remembered and does not fight it.
  if (origin === 'mobile' && desktop_present()) {
    session.mobile_viewport = { cols: next_cols, rows: next_rows };
    return {
      applied: false,
      reason: 'desktop-owns-size',
      owner: session.size_owner || 'desktop',
      cols: session.cols,
      rows: session.rows,
    };
  }
  if (session.cols === next_cols && session.rows === next_rows && session.size_owner === origin) {
    return { applied: false, reason: 'unchanged', owner: origin, cols: next_cols, rows: next_rows };
  }
  session.cols = next_cols;
  session.rows = next_rows;
  session.size_owner = origin;
  session.pty.resize(next_cols, next_rows);
  terminal_events.emit('resize', terminal_id, { cols: next_cols, rows: next_rows, owner: origin });
  return { applied: true, owner: origin, cols: next_cols, rows: next_rows };
}

// Closes a pane: kills the process, forgets the session, removes its hooks file and (unless keep_record) its saved
// record. Then the worktree is removed when it is clean. Resolves with
// { worktree_removed, worktree_path, worktree_kept_reason }. The kill itself happens synchronously, so
// kill_all does not have to wait for the worktree step.
// The UI removes the pane itself, so no exit event is emitted for an explicit close.
const releases = new Set();

function track_release(promise) {
  const done = Promise.resolve(promise).finally(() => releases.delete(done));
  releases.add(done);
  return done;
}

function pid_exists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

// The DLL ConPTY path releases the pseudoconsole to the OS at spawn. node-pty's
// kill() still calls ClosePseudoConsole on that handle and TerminateProcess on
// hShell. The exit watcher closes hShell and deletes the baton before it enters
// JS, so a later kill is a use-after-free (0xC0000005 / 0xC0000409). Stop the
// shell by pid instead, then wait until that watcher has finished.
function watch_native_exit(proc) {
  const agent = proc && proc._agent;
  if (!agent || agent.__agentsense_exit_promise || typeof agent._$onProcessExit !== 'function') return;
  agent.__agentsense_exit_promise = new Promise((resolve) => {
    const original = agent._$onProcessExit.bind(agent);
    agent._$onProcessExit = function (exitCode) {
      agent.__agentsense_native_exit = true;
      console.log(`pty native exit pid=${proc.pid} code=${exitCode}`);
      const connection = agent._conoutSocketWorker;
      const worker = connection && connection._worker;
      // The DLL exit path never stops the conout worker. After the client
      // process is gone the OS closes the released pseudoconsole, and a worker
      // still blocked in ReadFile faults the host. Stop it before returning.
      if (worker && typeof worker.terminate === 'function' && !agent.__agentsense_worker_done) {
        try {
          if (connection._drainTimeout) clearTimeout(connection._drainTimeout);
        } catch (error) {
          log_error('pty drain clear failed', error);
        }
        agent.__agentsense_worker_done = worker.terminate().catch((error) => {
          log_error('conout worker terminate failed', error);
          return null;
        });
      }
      try {
        return original(exitCode);
      } finally {
        resolve(exitCode);
      }
    };
  });
}

function drain_worker(connection, worker) {
  if (!worker || typeof worker.terminate !== 'function') return Promise.resolve();
  if (!connection || typeof connection.dispose !== 'function' || typeof connection._destroySocket !== 'function') {
    return worker.terminate();
  }
  return new Promise((resolve) => {
    const finish = () => resolve();
    const original = connection._destroySocket.bind(connection);
    connection._destroySocket = function () {
      return Promise.resolve().then(() => original()).then(finish, finish);
    };
    try {
      connection.dispose();
    } catch (error) {
      log_error('conout dispose failed', error);
      worker.terminate().then(finish, finish);
    }
  });
}

function release_pty(proc) {
  if (!proc || proc.__agentsense_released) return Promise.resolve();
  proc.__agentsense_released = true;
  const agent = proc._agent;
  const connection = agent && agent._conoutSocketWorker;
  const worker = connection && connection._worker;
  const native_exit = (agent && agent.__agentsense_exit_promise) || Promise.resolve();
  if (agent && !agent.__agentsense_native_exit && pid_exists(proc.pid)) {
    try {
      process.kill(proc.pid);
    } catch (error) {
      log_error('pty process kill failed', error);
    }
  }
  console.log(`pty release start pid=${proc.pid} native=${!!(agent && agent.__agentsense_native_exit)}`);
  note_life('release', `${proc.pid}:${agent && agent.__agentsense_native_exit ? 'exited' : 'signaled'}`);
  return native_exit.then(() => {
    console.log(`pty release watcher done pid=${proc.pid}`);
    if (agent && agent.__agentsense_worker_done) return agent.__agentsense_worker_done;
    return drain_worker(connection, worker);
  }).then(() => {
    console.log(`pty release worker done pid=${proc.pid}`);
    try {
      if (agent && agent._inSocket) agent._inSocket.destroy();
      if (agent && agent._outSocket) {
        agent._outSocket.removeAllListeners('data');
        agent._outSocket.destroy();
      }
    } catch (error) {
      log_error('pty socket cleanup failed', error);
    }
  }).catch((error) => {
    log_error('conout worker terminate failed', error);
    return null;
  });
}

function close_terminal(terminal_id, options) {
  const opts = options || {};
  const session = sessions.get(terminal_id);
  if (!session) return Promise.resolve(empty_kill_result());
  if (session.closing) return session.closing;
  note_life('close-start', terminal_id);
  sessions.delete(terminal_id);
  const proc = session.pty;
  session.pty = null;
  session.alive = false;
  const released = track_release(release_pty(proc));
  session.closing = released;
  get_hook_server().unregister_terminal(terminal_id);
  if (session.hooks_file) claude_hooks.delete_hooks_file(hooks_dir(), terminal_id);
  if (!opts.keep_record) {
    try {
      session_store.remove_record(session_store.default_file_path(), session.record_id);
    } catch (error) {
      log_error('could not remove the session record', error);
    }
  }
  if (!session.worktree) return released.then(() => empty_kill_result());
  if (opts.keep_worktree) {
    return released.then(() => ({
      worktree_removed: false,
      worktree_path: session.worktree.path,
      worktree_kept_reason: 'kept: the app is quitting',
    }));
  }
  return released.then(() => worktree.remove_if_clean(session.worktree)).then(
    (outcome) => ({
      worktree_removed: outcome.removed,
      worktree_path: session.worktree.path,
      worktree_kept_reason: outcome.removed ? null : outcome.reason,
    }),
    (error) => ({
      worktree_removed: false,
      worktree_path: session.worktree.path,
      worktree_kept_reason: error.message,
    })
  );
}

function kill_terminal(terminal_id) {
  return close_terminal(terminal_id, {});
}

function list_terminals(workspace_id) {
  const infos = [];
  for (const session of sessions.values()) {
    if (workspace_id === undefined || workspace_id === null || session.workspace_id === workspace_id) {
      infos.push(to_info(session));
    }
  }
  return infos;
}

// Removes the workspace's saved records, then closes its panes (their worktrees are removed when clean).
async function kill_workspace_terminals(workspace_id) {
  try {
    session_store.remove_workspace_records(session_store.default_file_path(), workspace_id);
  } catch (error) {
    log_error('could not remove the workspace session records', error);
  }
  const results = [];
  for (const session of Array.from(sessions.values())) {
    if (session.workspace_id === workspace_id) {
      results.push(await close_terminal(session.terminal_id, { keep_record: true }));
    }
  }
  return results;
}

// App quit: every process is stopped, but saved records stay, so the panes come back on the next start.
function kill_all() {
  const pending = Array.from(releases);
  for (const terminal_id of Array.from(sessions.keys())) {
    pending.push(close_terminal(terminal_id, { keep_record: true, keep_worktree: true }).catch(() => null));
  }
  return Promise.all(pending);
}

// Record ids of panes whose process is running now. Saved records with these ids are not "saved" any more.
function live_record_ids() {
  const ids = new Set();
  for (const session of sessions.values()) {
    if (session.alive) ids.add(session.record_id);
  }
  return ids;
}

function get_record_id(terminal_id) {
  const session = sessions.get(terminal_id);
  return session ? session.record_id : null;
}

// Stores the Claude session id reported by a hook, so the pane can be resumed after a restart.
function note_claude_session(terminal_id, claude_session_id) {
  const session = sessions.get(terminal_id);
  if (!session || !claude_hooks.is_valid_session_id(claude_session_id)) return false;
  if (session.claude_session_id === claude_session_id) return false;
  session.claude_session_id = claude_session_id;
  try {
    session_store.set_claude_session_id(session_store.default_file_path(), session.record_id, claude_session_id);
  } catch (error) {
    log_error('could not save the claude session id', error);
  }
  return true;
}

module.exports = {
  create_terminal,
  write_terminal,
  resize_terminal,
  kill_terminal,
  close_terminal,
  list_terminals,
  kill_workspace_terminals,
  kill_all,
  live_record_ids,
  get_record_id,
  note_claude_session,
  set_desktop_present,
  get_lifecycle: () => lifecycle.slice(),
  terminal_events,
  RING_BUFFER_LIMIT,
};
