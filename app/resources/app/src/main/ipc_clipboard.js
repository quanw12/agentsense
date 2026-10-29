// ipcMain handlers for the system clipboard (hub.clipboard). Uses Electron's clipboard module, because
// navigator.clipboard is not reliable on the file:// page the renderer runs from.
const { clipboard, ipcMain } = require('electron');

const CLIPBOARD_MAX_BYTES = 1024 * 1024;

function read_text() {
  return clipboard.readText();
}

function write_text(text) {
  if (typeof text !== 'string') throw new Error('text must be a string');
  if (Buffer.byteLength(text, 'utf8') > CLIPBOARD_MAX_BYTES) throw new Error('text is larger than 1 MB');
  clipboard.writeText(text);
}

function register_clipboard_ipc() {
  ipcMain.handle('clipboard:read_text', () => read_text());
  ipcMain.handle('clipboard:write_text', (_event, text) => write_text(text));
}

module.exports = { register_clipboard_ipc, CLIPBOARD_MAX_BYTES };
