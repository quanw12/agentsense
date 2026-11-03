// Repeated native processes: assertions and the OS exit code must both pass.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { createHash } = require('crypto');
const root = path.join(__dirname, '..');
const output = process.env.AGENTSENSE_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-native-runs-'));
fs.mkdirSync(output, { recursive: true });
const repeat = Number(process.env.AGENTSENSE_NATIVE_REPEATS || 4);
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) throw new Error('Native repeat count must be 1..20');
const suites = [
  ['workbench', 'smoke_workbench.js', 'Workbench smoke: all checks passed'],
  ['mobile', 'smoke_mobile.js', 'ALL CHECKS PASSED'],
  ['product-quit', 'check_app_shutdown.js', 'PASS native product quit'],
];
const results = [];
function run(suite, script, marker, iteration) {
  return new Promise(resolve => {
    const child = spawn(require('electron'), [path.join(__dirname, script)], {cwd: root, windowsHide: true, env: process.env});
    let log = '';
    let timedOut = false;
    child.stdout.on('data', data => { log += data; });
    child.stderr.on('data', data => { log += data; });
    const timer = setTimeout(() => {
      timedOut = true;
      // Stop only this fixture's process tree if its own deadline expires.
      if (process.platform === 'win32') execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true}, () => {});
      else child.kill('SIGKILL');
    }, 90000);
    child.on('error', error => { log += String(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const passed = !timedOut && code === 0 && log.includes(marker) && !/FAIL |AttachConsole failed/.test(log);
      const logFile = `${suite}-${iteration}.log`;
      fs.writeFileSync(path.join(output, logFile), log);
      const result = {suite, iteration, code, signal, timedOut, passed, logFile};
      results.push(result);
      console.log(`${passed ? 'PASS' : 'FAIL'} ${suite} ${iteration}: exit ${code}`);
      resolve();
    });
  });
}
(async () => {
  for (const [suite, script, marker] of suites) {
    for (let iteration = 1; iteration <= repeat; iteration++) await run(suite, script, marker, iteration);
  }
  const sourceHashes = {};
  for (const file of ['main.js','src/main/pty_manager.js','package.json']) {
    sourceHashes[file] = createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
  }
  const evidence = {createdAt:new Date().toISOString(),node:process.version,electron:require('electron/package.json').version,nodePty:require('node-pty/package.json').version,sourceHashes,results};
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(evidence,null,2));
  console.log(`Native stability evidence: ${output}`);
  process.exitCode = results.every(result => result.passed) ? 0 : 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
