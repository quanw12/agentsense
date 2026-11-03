// Exercises main.js itself: close the real BrowserWindow with live ConPTYs.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const appRoot = process.env.AGENTSENSE_TEST_APP_ROOT || path.join(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-app-quit-'));
process.env.AGENT_HUB_USER_DATA = profile;
const pty = require(path.join(appRoot, 'src/main/pty_manager'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pids = [];
let requestedClose = false;
function exists(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.once('did-finish-load', async () => {
    try {
      for (let i = 0; i < 4; i++) {
        const created = await pty.create_terminal({command: 'powershell.exe', cwd: profile});
        pids.push(pty.list_terminals().find(t => t.terminal_id === created.terminal_id).pid);
      }
      const deadline = Date.now() + 20000;
      while (!pty.list_terminals().every(t => t.buffer.includes('>'))) {
        if (Date.now() > deadline) throw new Error('Shell prompt deadline');
        await delay(50);
      }
      requestedClose = true;
      win.close();
    } catch (error) {
      console.error(error);
      await pty.shutdown();
      app.exit(1);
    }
  });
});
app.on('quit', (_event, code) => {
  const orphans = pids.filter(exists);
  console.log(`${requestedClose && code === 0 && orphans.length === 0 ? 'PASS' : 'FAIL'} native product quit: ${JSON.stringify({code, requestedClose, orphans, sessions:pty.list_terminals().length})}`);
});
setTimeout(() => { console.error('FAIL native quit deadline'); app.exit(2); }, 45000).unref();
require(path.join(appRoot, 'main.js'));
