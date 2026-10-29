// App lifecycle: creates the main window, registers the ipc modules and
// kills every pty when the app quits.
const path = require('path');

const { app, BrowserWindow, Menu } = require('electron');
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
const { get_hook_server } = require('./src/main/hook_server');

const WINDOW_WIDTH = 1400;
const WINDOW_HEIGHT = 900;
const WINDOW_BACKGROUND = '#000000';
// Zoom is in Electron's zoom-level units (0 = 100%, each step about 20%). Kept for the session only.
const ZOOM_STEP = 0.5;
const ZOOM_MIN = -3;
const ZOOM_MAX = 5;

let main_window = null;

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
    },
  });
  // No menu bar at all (File / Edit / View / Window), and no space reserved for one.
  main_window.removeMenu();
  register_shortcuts(main_window);

  main_window.on('closed', () => {
    main_window = null;
  });

  main_window.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
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
    register_workspace_ipc();
    register_agent_ipc();
    register_clipboard_ipc();
    register_terminal_ipc();
    register_session_ipc();
    register_providers_ipc();
    register_file_ipc();
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

  app.on('will-quit', () => {
    pty_manager.kill_all();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
