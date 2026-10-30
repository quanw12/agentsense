// ipcMain handlers for agent availability (agents:check) and launch presets (presets:*).
const { ipcMain } = require('electron');

const store = require('./store');
// The lookup itself is pure Node (command_check.js), so mobile_server.js can reuse it.
const { check_commands } = require('./command_check');

function register_agent_ipc() {
  ipcMain.handle('agents:check', (_event, commands) => check_commands(commands));
  ipcMain.handle('presets:list', () => store.list_presets());
  ipcMain.handle('presets:save', (_event, preset) => store.save_preset(preset));
  ipcMain.handle('presets:remove', (_event, preset_id) => store.remove_preset(preset_id));
}

module.exports = { register_agent_ipc, check_commands };