// Opens and closes a real PowerShell ConPTY 20 times in a throwaway profile.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-lifecycle-'));
app.setPath('userData', profile);
const pty = require('../src/main/pty_manager');

const cycles = Number(process.env.AGENTSENSE_CYCLES || 20);

app.whenReady().then(async () => {
  const before = process.pid;
  let failed = 0;
  for (let i = 0; i < cycles; i += 1) {
    const started = Date.now();
    try {
      const created = await pty.create_terminal({
        command: 'powershell.exe',
        cwd: os.tmpdir(),
        title: 'lifecycle',
        cols: 80,
        rows: 24,
      });
      await pty.close_terminal(created.terminal_id, { keep_worktree: true });
      console.log(`PASS cycle ${i + 1} ${Date.now() - started}ms`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL cycle ${i + 1} ${error.message}`);
    }
  }
  console.log(`lifecycle pid ${before} failures ${failed} live ${pty.list_terminals().length}`);
  app.exit(failed ? 1 : 0);
});
