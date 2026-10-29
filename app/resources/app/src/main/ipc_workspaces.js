// ipcMain handlers for workspaces (list, add, remove, native folder picker).
const { ipcMain, dialog, BrowserWindow } = require('electron');

const store = require('./store');
const pty_manager = require('./pty_manager');

function register_workspace_ipc() {
  ipcMain.handle('workspaces:list', () => store.list_workspaces());

  ipcMain.handle('workspaces:add', (_event, folder_path) => store.add_workspace(folder_path));

  ipcMain.handle('workspaces:remove', async (_event, workspace_id) => {
    await pty_manager.kill_workspace_terminals(workspace_id);
    store.remove_workspace(workspace_id);
  });

  ipcMain.handle('workspaces:pick_folder', async () => {
    const owner = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
    const options = { title: 'Choose a workspace folder', properties: ['openDirectory'] };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}

module.exports = { register_workspace_ipc };
