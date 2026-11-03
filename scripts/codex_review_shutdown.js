// Native shutdown control. Does not weaken assertions or hide a nonzero exit.
// harness: shells exit, then close, then app.exit (skips will-quit), same order as the workbench smoke.
// quit: hidden BrowserWindow close, then the product will-quit drain, then app.quit.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-shutdown-'));
app.setPath('userData', profile);
const pty = require('../src/main/pty_manager');
const mode = process.argv[2] === 'quit' ? 'quit' : 'harness';

function pid_exists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !!(error && error.code === 'EPERM');
  }
}

function wait_until(predicate, label) {
  const deadline = Date.now() + 15000;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) resolve();
      else if (Date.now() >= deadline) reject(new Error(label));
      else setTimeout(tick, 50);
    };
    tick();
  });
}

let quit_state = 'open';
app.on('will-quit', (event) => {
  if (quit_state === 'done') return;
  event.preventDefault();
  if (quit_state === 'draining') return;
  quit_state = 'draining';
  Promise.resolve(pty.kill_all()).catch((error) => {
    console.error(`terminal shutdown failed: ${error && error.message ? error.message : error}`);
  }).finally(() => {
    quit_state = 'done';
    app.quit();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.whenReady().then(async () => {
  const created = [];
  for (let i = 0; i < 4; i += 1) {
    created.push(await pty.create_terminal({
      command: 'powershell.exe',
      cwd: os.tmpdir(),
      title: 'shutdown',
      cols: 80,
      rows: 24,
    }));
  }
  const before = pty.list_terminals().map((t) => ({
    terminal_id: t.terminal_id,
    pid: t.pid,
    alive: t.alive,
  }));
  console.log(`shutdown control mode=${mode} before: ${JSON.stringify(before)}`);
  if (mode === 'quit') {
    const win = new BrowserWindow({ show: false });
    win.close();
    return;
  }
  for (const terminal of pty.list_terminals()) pty.write_terminal(terminal.terminal_id, 'exit\r');
  await wait_until(() => pty.list_terminals().every((t) => !t.alive), 'shells stayed alive');
  const after_exit = pty.list_terminals().map((t) => ({
    terminal_id: t.terminal_id,
    pid: t.pid,
    alive: t.alive,
    exit_code: t.exit_code,
  }));
  console.log(`shutdown control after-exit: ${JSON.stringify(after_exit)}`);
  for (const row of after_exit) {
    await pty.close_terminal(row.terminal_id, { keep_worktree: true, keep_record: true });
  }
  const orphans = after_exit.filter((row) => pid_exists(row.pid)).map((row) => row.pid);
  console.log(`shutdown control orphans: ${JSON.stringify(orphans)} live: ${pty.list_terminals().length}`);
  app.exit(orphans.length || pty.list_terminals().length ? 1 : 0);
}).catch((error) => {
  console.error(`shutdown control FAIL ${error && error.message ? error.message : error}`);
  app.exit(1);
});
