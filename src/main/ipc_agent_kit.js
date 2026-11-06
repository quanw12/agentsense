// ipcMain handlers for the agent kit on/off choice (agent_kit:*). It applies to panes started after the change.
const { ipcMain } = require('electron');

const agent_kit = require('./agent_kit');

function register_agent_kit_ipc() {
  ipcMain.handle('agent_kit:get', () => agent_kit.is_enabled(agent_kit.default_file_path()));
  ipcMain.handle('agent_kit:set', (_event, enabled) => agent_kit.set_enabled(agent_kit.default_file_path(), enabled));
}

module.exports = { register_agent_kit_ipc };
