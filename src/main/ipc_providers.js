// ipcMain handlers for third-party API providers (providers:*).
const { ipcMain } = require('electron');

const providers_store = require('./providers_store');

function register_providers_ipc() {
  ipcMain.handle('providers:list', () => providers_store.list_providers());
  ipcMain.handle('providers:save', (_event, provider) => providers_store.save_provider(provider));
  ipcMain.handle('providers:remove', (_event, provider_id) => providers_store.remove_provider(provider_id));
}

module.exports = { register_providers_ipc };
