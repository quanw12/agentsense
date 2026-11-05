// Real ConPTY regressions: final output, owned child processes and concurrent close.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-pty-final-'));
app.setPath('userData', path.join(fixture, 'profile'));
const pty = require('../src/main/pty_manager');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let failed = 0;
function check(name, passed) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed++;
}
function exists(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
async function until(fn, label) {
  const deadline = Date.now() + 15000;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await delay(25);
  }
}
app.whenReady().then(async () => {
  const outputScript = path.join(fixture, 'output.js');
  const marker = 'FINAL_OUTPUT_COMPLETE_0123456789';
  fs.writeFileSync(outputScript, `process.stdout.write('x'.repeat(100000) + ${JSON.stringify(marker)});`);
  for (let i = 0; i < 4; i++) {
    const created = await pty.create_terminal({ command: `node "${outputScript}"`, cwd: fixture });
    await until(() => !pty.list_terminals().find(t => t.terminal_id === created.terminal_id)?.alive, 'output process exit');
    check(`final output survives natural exit ${i + 1}`, pty.list_terminals().find(t => t.terminal_id === created.terminal_id).buffer.includes(marker));
    await pty.close_terminal(created.terminal_id, { keep_worktree: true });
  }
  for (let i = 0; i < 4; i++) await pty.create_terminal({command:'powershell.exe', cwd:fixture});
  await until(() => pty.list_terminals().every(t => t.buffer.includes('>')), 'concurrent shell prompts');
  for (const terminal of pty.list_terminals()) pty.write_terminal(terminal.terminal_id, 'exit\r');
  await until(() => pty.list_terminals().every(t => !t.alive), 'concurrent natural shell exits');
  check('four simultaneous natural exits report success', pty.list_terminals().every(t => t.exit_code === 0));
  await pty.kill_all();
  // A local mock executable captures actual launch arguments, without auth or a
  // real Claude installation. Restart must resolve the saved ID in main.
  const resumeId = 'a1234567-1234-4567-8123-123456789abc';
  const argsFile = path.join(fixture, 'resume-args.json');
  const capture = path.join(fixture, 'capture.js');
  fs.writeFileSync(capture, `require('fs').writeFileSync(${JSON.stringify(argsFile)},JSON.stringify(process.argv.slice(2)));`);
  fs.writeFileSync(path.join(fixture, 'claude.cmd'), '@echo off\r\nnode "%~dp0capture.js" %*\r\n');
  const store = require('../src/main/session_store');
  const saved = store.make_record({agent_id:'claude',workspace_id:'mock',title:'Mock Claude',command:'claude',cwd:fixture,claude_session_id:resumeId,resume_mode:'conversation'});
  store.add_record(store.default_file_path(), saved);
  // The agent kit is only added next to the per-pane settings file, which needs the hook server.
  const hook_server = require('../src/main/hook_server').get_hook_server();
  await hook_server.start();
  const resumed = await pty.create_terminal({agent_id:'claude',command:'claude',cwd:fixture,restore_record_id:saved.record_id});
  await until(() => fs.existsSync(argsFile), 'mock Claude launch');
  const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
  check('restart uses the saved Claude conversation ID in the real launch command', args.includes('--resume') && args.includes(resumeId));
  check('a claude pane receives the agent kit folder intact', args[args.indexOf('--plugin-dir') + 1] === require('../src/main/agent_kit').KIT_DIR);
  await pty.close_terminal(resumed.terminal_id);
  hook_server.stop();
  const childScript = path.join(fixture, 'child.js');
  const pidFile = path.join(fixture, 'child-pid.json');
  fs.writeFileSync(childScript, `require('fs').writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify({pid:process.pid,parent:process.ppid})); setInterval(()=>{},1000);`);
  const created = await pty.create_terminal({ command: `node "${childScript}"`, cwd: fixture });
  await until(() => fs.existsSync(pidFile), 'agent child starts');
  const child = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
  const closeOne = pty.close_terminal(created.terminal_id);
  const closeTwo = pty.close_terminal(created.terminal_id);
  check('concurrent close shares the full cleanup promise', closeOne === closeTwo);
  await Promise.all([closeOne, closeTwo]);
  await delay(100);
  const stopped = !exists(child.pid);
  check('close stops the agent child behind cmd.exe', stopped);
  // Cleanup is restricted to the exact PID created by this fixture.
  if (!stopped) process.kill(child.pid);
  check('all sessions removed', pty.list_terminals().length === 0);
  // Include an accepted launch that is still in progress when shutdown begins.
  const inFlight = pty.create_terminal({ command: 'powershell.exe', cwd: fixture });
  const shuttingDown = pty.shutdown();
  let rejected = false;
  try { await pty.create_terminal({ command: 'powershell.exe', cwd: fixture }); }
  catch (error) { rejected = /shutting down/.test(error.message); }
  await inFlight;
  await shuttingDown;
  check('shutdown rejects new launches and drains an accepted launch', rejected && pty.list_terminals().length === 0);
  app.exit(failed ? 1 : 0);
}).catch(async error => {
  console.error(error);
  await pty.kill_all();
  app.exit(1);
});
setTimeout(() => { console.error('PTY lifecycle deadline'); app.exit(2); }, 60000).unref();
