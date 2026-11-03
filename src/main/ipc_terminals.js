// ipcMain handlers for terminals, plus forwarding of pty output, exit and hook status events to every window.
const { ipcMain, BrowserWindow } = require('electron');

const pty_manager = require('./pty_manager');
const { get_hook_server } = require('./hook_server');

function broadcast(channel, ...args) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, ...args);
    }
  }
}

function register_terminal_ipc() {
  pty_manager.set_desktop_present(() => BrowserWindow.getAllWindows().some(
    (window) => !window.isDestroyed() && window.isVisible() && !window.isMinimized()
  ));
  ipcMain.handle('terminals:create', (_event, opts) => pty_manager.create_terminal(opts));
  ipcMain.on('terminals:write', (_event, terminal_id, data) => {
    pty_manager.write_terminal(terminal_id, data);
  });
  ipcMain.on('terminals:resize', (_event, terminal_id, cols, rows) => {
    pty_manager.resize_terminal(terminal_id, cols, rows, 'desktop');
  });
  ipcMain.handle('terminals:close', async (_event, terminal_id, options) => {
    const result = await pty_manager.close_terminal(terminal_id, options || {});
    broadcast('terminals:closed', terminal_id);
    return result;
  });
  ipcMain.handle('terminals:kill', async (_event, terminal_id) => {
    const result = await pty_manager.kill_terminal(terminal_id);
    // An explicit close emits no pty exit; the phone (and any other window) still needs to know.
    broadcast('terminals:closed', terminal_id);
    return result;
  });
  ipcMain.handle('terminals:list', (_event, workspace_id) => pty_manager.list_terminals(workspace_id));
  ipcMain.handle('terminals:get_status', () => get_hook_server().get_status());

  pty_manager.terminal_events.on('data', (terminal_id, data) => {
    broadcast('terminals:data', terminal_id, data);
  });
  pty_manager.terminal_events.on('exit', (terminal_id, exit_code) => {
    broadcast('terminals:exit', terminal_id, exit_code);
    // Every pane gets 'ended' when its process exits, Claude Code or not.
    get_hook_server().set_ended(terminal_id);
  });

  const hook_server = get_hook_server();
  hook_server.on('status', (terminal_id, info) => {
    // Keep the claude session id of the saved record up to date (needed for `claude --resume`).
    if (info.session_id) pty_manager.note_claude_session(terminal_id, info.session_id);
    broadcast('terminals:status', terminal_id, info);
  });
}

module.exports = { register_terminal_ipc, broadcast };
