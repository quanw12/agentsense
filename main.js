// App lifecycle: creates the main window, registers the ipc modules and
// kills every pty when the app quits.
const path = require('path');

const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const { migrate_legacy_state } = require('./src/main/migrate_state');

// Product identity. setName must run before anything reads userData, because the default userData
// folder is %APPDATA%\<app name>.
app.setName('AgentSense');
app.setAppUserModelId('com.agentsense.app');

// Must run before anything reads userData (store.js, single-instance lock).
// Tests point this at a fresh temp directory.
const user_data_override = process.env.AGENT_HUB_USER_DATA;
if (user_data_override) {
  app.setPath('userData', user_data_override);
} else {
  // Workspaces and presets saved by the old agent_hub build live in %APPDATA%\agent_hub. Copy them once.
  migrate_legacy_state(app.getPath('userData'), path.join(app.getPath('appData'), 'agent_hub'));
}

const pty_manager = require('./src/main/pty_manager');
const { register_terminal_ipc } = require('./src/main/ipc_terminals');
const { register_workspace_ipc } = require('./src/main/ipc_workspaces');
const { register_agent_ipc } = require('./src/main/ipc_agents');
const { register_clipboard_ipc } = require('./src/main/ipc_clipboard');
const { register_session_ipc } = require('./src/main/ipc_sessions');
const { register_providers_ipc } = require('./src/main/ipc_providers');
const { register_file_ipc } = require('./src/main/ipc_files');
const { register_mobile_ipc } = require('./src/main/ipc_mobile');
const { get_hook_server } = require('./src/main/hook_server');
const { get_mobile_server } = require('./src/main/mobile_server');

const WINDOW_WIDTH = 1400;
const WINDOW_HEIGHT = 900;
const WINDOW_BACKGROUND = '#000000';
// Zoom is in Electron's zoom-level units (0 = 100%, each step about 20%). Kept for the session only.
const ZOOM_STEP = 0.5;
const ZOOM_MIN = -3;
const ZOOM_MAX = 5;
// A close waits this long for the renderer to save its editors before asking what to do.
const FLUSH_WARN_MS = 8000;
// More crashes than this inside the window stop the automatic reload, so a crash loop cannot trap the user.
const CRASH_RELOAD_LIMIT = 3;
const CRASH_WINDOW_MS = 60000;

let main_window = null;
let crash_times = [];

function clamp_zoom(level) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
}

// Only the bare key combination counts: Alt+0, Shift+0 and friends pass through to the page.
function has_only_ctrl(input) {
  return input.control && !input.alt && !input.meta && !input.shift;
}

function has_no_modifiers(input) {
  return !input.control && !input.alt && !input.meta && !input.shift;
}

// Returns 'in', 'out', 'reset' or null for a zoom shortcut.
function zoom_action_for(input) {
  const key = String(input.key || '');
  const code = String(input.code || '');
  if (input.control && !input.alt && !input.meta) {
    // Ctrl+= and Ctrl++ (Ctrl+Shift+= produces "+" on most layouts). Shift is allowed for these two only.
    if (key === '=' || key === '+' || code === 'NumpadAdd') return 'in';
    if (!input.shift && (key === '-' || code === 'NumpadSubtract')) return 'out';
    if (!input.shift && key === '0') return 'reset';
  }
  return null;
}

function apply_zoom(target_window, action) {
  const contents = target_window.webContents;
  const current = contents.getZoomLevel();
  if (action === 'reset') {
    contents.setZoomLevel(0);
    return;
  }
  const delta = action === 'in' ? ZOOM_STEP : -ZOOM_STEP;
  contents.setZoomLevel(clamp_zoom(current + delta));
}

// Keyboard shortcuts without a menu. Only keyDown is handled; a handled key gets preventDefault so the
// page never sees it. Plain typing and other modifier combinations are left alone.
function register_shortcuts(target_window) {
  const dev_enabled = process.env.AGENT_HUB_DEVTOOLS === '1';
  target_window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '').toLowerCase();

    if (key === 'f11' && has_no_modifiers(input)) {
      event.preventDefault();
      target_window.setFullScreen(!target_window.isFullScreen());
      return;
    }

    const zoom_action = zoom_action_for(input);
    if (zoom_action) {
      event.preventDefault();
      apply_zoom(target_window, zoom_action);
      return;
    }

    // Development hatch: F12 devtools, Ctrl+R reload, Ctrl+Shift+I devtools. Only with AGENT_HUB_DEVTOOLS=1.
    if (!dev_enabled) return;
    if (key === 'f12' && has_no_modifiers(input)) {
      event.preventDefault();
      target_window.webContents.toggleDevTools();
    } else if (key === 'r' && has_only_ctrl(input)) {
      event.preventDefault();
      target_window.webContents.reload();
    } else if (key === 'i' && input.control && input.shift && !input.alt && !input.meta) {
      event.preventDefault();
      target_window.webContents.toggleDevTools();
    }
  });
}

function renderer_page() {
  return path.join(__dirname, 'src', 'renderer', 'index.html');
}

// The renderer died. Terminals live in this process, so a reload gets every pane back. Only a crash loop asks first.
async function recover_renderer(target_window, reason) {
  const now = Date.now();
  crash_times = crash_times.filter((time) => now - time < CRASH_WINDOW_MS);
  crash_times.push(now);
  const looping = crash_times.length > CRASH_RELOAD_LIMIT;
  if (looping) {
    const { response } = await dialog.showMessageBox(target_window, {
      type: 'error',
      title: 'AgentSense',
      message: 'The AgentSense window keeps crashing',
      detail: `Last reason: ${reason}. Your terminals are still running. Quitting stops them; saved sessions come back on the next start.`,
      buttons: ['Try again', 'Quit AgentSense'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (target_window.isDestroyed()) return;
    if (response === 1) {
      target_window.flush_complete = true;
      target_window.destroy();
      return;
    }
    crash_times = [];
  }
  target_window.loadFile(renderer_page()).catch((error) => {
    console.error(`could not reload the window: ${error && error.message ? error.message : error}`);
  });
  if (looping) return;
  dialog.showMessageBox(target_window, {
    type: 'warning',
    title: 'AgentSense',
    message: 'The AgentSense window crashed and was reloaded',
    detail: 'Your terminals kept running. Edits typed in the last moment before the crash may not have been saved.',
    buttons: ['OK'],
    noLink: true,
  }).catch(() => {});
}

function create_main_window() {
  main_window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    backgroundColor: WINDOW_BACKGROUND,
    title: 'AgentSense',
    // build/icon.png is kept in the portable package (scripts/build_portable.js), so this path works packaged too.
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Chromium's PDF viewer, used by the file viewer pane for .pdf files.
      plugins: true,
    },
  });
  // No menu bar at all (File / Edit / View / Window), and no space reserved for one.
  main_window.removeMenu();
  register_shortcuts(main_window);

  let flush_in_progress = false;
  let flush_timer = null;

  function stop_flush_wait() {
    flush_in_progress = false;
    if (flush_timer) clearTimeout(flush_timer);
    flush_timer = null;
  }

  // Nothing more can be saved here, so the user decides. Keep waiting re-arms the question while a flush runs.
  async function ask_close_anyway(detail) {
    const target_window = main_window;
    if (!target_window || target_window.isDestroyed()) return;
    const { response } = await dialog.showMessageBox(target_window, {
      type: 'warning',
      title: 'AgentSense',
      message: 'AgentSense could not finish saving',
      detail,
      buttons: ['Keep waiting', 'Close anyway'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (target_window.isDestroyed()) return;
    if (response === 1) {
      stop_flush_wait();
      target_window.flush_complete = true;
      target_window.destroy();
    } else if (flush_in_progress) {
      arm_flush_timer();
    }
  }

  function arm_flush_timer() {
    flush_timer = setTimeout(() => {
      flush_timer = null;
      if (!flush_in_progress) return;
      ask_close_anyway('The window is not responding. Closing now can lose edits that were not saved yet.').catch(() => {});
    }, FLUSH_WARN_MS);
  }

  main_window.on('close', (event) => {
    if (main_window.flush_complete) return;
    // A dead renderer holds nothing to save, and it could never answer the flush below.
    const contents = main_window.webContents;
    if (contents.isDestroyed() || contents.isCrashed()) return;
    event.preventDefault();
    if (flush_in_progress) return;
    flush_in_progress = true;
    arm_flush_timer();
    contents.executeJavaScript(
      'window.__grid && window.__grid.flush_editors ? window.__grid.flush_editors() : { ok: true }'
    ).then((result) => {
      stop_flush_wait();
      if (!main_window || main_window.isDestroyed()) return;
      if (result && result.ok) {
        main_window.flush_complete = true;
        main_window.close();
      }
    }).catch((error) => {
      if (!flush_in_progress) return;
      stop_flush_wait();
      const message = error && error.message ? error.message : error;
      console.error(`could not flush editors before close: ${message}`);
      ask_close_anyway(`Saving failed: ${message}. Closing now can lose edits that were not saved yet.`).catch(() => {});
    });
  });

  main_window.webContents.on('render-process-gone', (_event, details) => {
    const target_window = main_window;
    const was_closing = flush_in_progress;
    stop_flush_wait();
    if (!target_window || target_window.isDestroyed() || target_window.flush_complete) return;
    console.error(`renderer gone: ${details.reason} (exit code ${details.exitCode})`);
    // The user already asked to close and the renderer can no longer answer.
    if (was_closing) {
      target_window.flush_complete = true;
      target_window.destroy();
      return;
    }
    recover_renderer(target_window, details.reason).catch((error) => {
      console.error(`could not recover the window: ${error && error.message ? error.message : error}`);
    });
  });

  main_window.on('closed', () => {
    stop_flush_wait();
    main_window = null;
  });

  main_window.loadFile(renderer_page());
}

// Single instance: a second launch focuses the existing window instead.
const got_lock = app.requestSingleInstanceLock();
if (!got_lock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (main_window) {
      if (main_window.isMinimized()) main_window.restore();
      main_window.focus();
    }
  });

  app.whenReady().then(async () => {
    // Before any window exists: the default application menu is not created.
    Menu.setApplicationMenu(null);
    ipcMain.handle('app:info', () => ({
      name: 'AgentSense',
      version: app.getVersion(),
      platform: 'win32-x64',
      commit: process.env.AGENTSENSE_COMMIT || null,
    }));
    register_workspace_ipc();
    register_agent_ipc();
    register_clipboard_ipc();
    register_terminal_ipc();
    register_session_ipc();
    register_providers_ipc();
    register_file_ipc();
    // Starts the mobile access server itself when it was left enabled (mobile.json).
    register_mobile_ipc();
    // Claude Code hooks post to this server. Without it the app still works; claude panes just get no status.
    try {
      await get_hook_server().start();
    } catch (error) {
      console.error(`hook server did not start: ${error.message}`);
    }
    create_main_window();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) create_main_window();
    });
  });

  let quit_state = 'open';
  app.on('will-quit', (event) => {
    if (quit_state === 'done') return;
    event.preventDefault();
    if (quit_state === 'draining') return;
    quit_state = 'draining';
    const terminals_done = pty_manager.shutdown();
    Promise.all([terminals_done, get_mobile_server().stop(), get_hook_server().stop()]).catch((error) => {
      console.error(`terminal shutdown failed: ${error && error.message ? error.message : error}`);
    }).finally(() => {
      quit_state = 'done';
      app.quit();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
