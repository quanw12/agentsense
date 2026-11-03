// Independent review fixtures. Runs in Electron with throwaway files/profile only.
// Run: node node_modules/electron/cli.js scripts/codex_review_regressions.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { app } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-codex-review-'));
const profile = path.join(root, 'profile');
const fixture = path.join(root, 'workspace');
fs.mkdirSync(profile);
fs.mkdirSync(fixture);
process.env.AGENT_HUB_USER_DATA = profile;
fs.writeFileSync(path.join(fixture, 'large.txt'), 'a'.repeat(600 * 1024));
fs.writeFileSync(path.join(fixture, 'a.txt'), 'original A');
fs.writeFileSync(path.join(fixture, 'b.txt'), 'original B');
for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Review', '-c', 'user.email=review@example.invalid', 'commit', '-m', 'fixture']]) {
  execFileSync('git', args, { cwd: fixture, windowsHide: true, stdio: 'pipe' });
}
const results = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  const end = Date.now() + 20000;
  while (!await fn()) {
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await delay(50);
  }
}
function record(id, expectation, passed, actual) {
  results.push({ id, expectation, passed, actual });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${id}: ${JSON.stringify(actual)}`);
}
async function run(win) {
  const js = code => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  await until(() => js('return Boolean(window.__grid && window.__sidebar && document.body.dataset.view_settled === "true")'), 'startup');
  await js(`window.reviewWorkspace = await hub.workspaces.add(${JSON.stringify(fixture)}); __grid.show_workspace(reviewWorkspace);`);
  await until(() => js('return Boolean(document.querySelector(".tg-view-active .fp-row[data-path=\\"a.txt\\"]"))'), 'file tree');
  async function open(name) {
    await js(`document.querySelector('.tg-view-active .fp-row[data-path="${name}"]').click();`);
    await until(() => js(`return Boolean(document.querySelector('.tf-file-tab-active')?.textContent.startsWith('${name}') && document.querySelector('.tf-editor'));`), `open ${name}`);
    await delay(150);
  }
  async function edit(text) {
    await js(`const e = document.querySelector('.tg-view-active .tf-editor'); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', {bubbles:true}));`);
  }

  await open('large.txt');
  const shown = await js('return document.querySelector(".tf-editor").value.length;');
  await edit('a'.repeat(shown) + 'EDIT');
  await delay(1000);
  const savedBytes = fs.statSync(path.join(fixture, 'large.txt')).size;
  record('R1', 'Editing a 600 KiB text file preserves its unseen tail', savedBytes >= 600 * 1024, { before: 600 * 1024, shown, after: savedBytes });

  await open('a.txt');
  await edit('MY UNSAVED EDIT');
  fs.writeFileSync(path.join(fixture, 'a.txt'), 'EXTERNAL DISK UPDATE');
  await delay(1000);
  const conflict = await js('return document.querySelector(".tf-save")?.textContent;');
  await open('b.txt');
  await js(`Array.from(document.querySelectorAll('.tf-file-tab')).find(b => b.textContent.startsWith('a.txt')).click();`);
  await delay(300);
  const returned = await js('return document.querySelector(".tf-editor").value;');
  record('R2', 'A conflicted buffer survives switching tabs', returned === 'MY UNSAVED EDIT', { statusBeforeSwitch: conflict, editorAfterReturn: returned });

  const providers = require('../src/main/providers_store');
  const providerFile = path.join(root, 'providers-legacy.json');
  providers.set_file_for_tests(providerFile);
  providers.set_codec_for_tests({ available: () => false });
  fs.writeFileSync(providerFile, JSON.stringify({providers:[{ id:'legacy', name:'Legacy', kind:'anthropic', base_url:'https://example.invalid', api_key:'FAKE-REVIEW-KEY', models:['demo'] }]}));
  let rejected = false;
  try { providers.save_provider({ id:'legacy', name:'Renamed', kind:'anthropic', base_url:'https://example.invalid', models:['demo'] }); }
  catch { rejected = true; }
  const stored = JSON.parse(fs.readFileSync(providerFile, 'utf8')).providers[0];
  record('R3', 'Metadata edits cannot erase a legacy key when secure storage is unavailable', rejected || Boolean(stored.api_key || stored.api_key_enc), { rejected, secretStatus: stored.secret_status, keyRetained: Boolean(stored.api_key || stored.api_key_enc) });
  providers.set_codec_for_tests(null);
  providers.set_file_for_tests(null);

  // Cold restore: saved records exist, but there are no live terminals to reattach.
  const sessions = require('../src/main/session_store');
  const ws = await js('return reviewWorkspace;');
  const records = [0, 1].map(i => sessions.make_record({ workspace_id:ws.id, agent_id:'terminal', title:`Review${i}|terminal|Terminal`, command:'powershell.exe', cwd:fixture, base_cwd:fixture, resume_mode:'terminal' }));
  for (const saved of records) sessions.add_record(path.join(profile, 'sessions.json'), saved);
  const tree = { type:'split', dir:'row', sizes:[0.7,0.3], children:records.map(r => ({type:'leaf', key:r.record_id})) };
  // A fresh workspace view ensures attachment runs with zero live panes.
  await js(`__grid.forget_workspace(reviewWorkspace.id); const ui=JSON.parse(localStorage.getItem('agentsense.workbench')||'{}'); ui.workspaces=ui.workspaces||{}; ui.workspaces[reviewWorkspace.id]={files_open:true, files_width:270, tree:${JSON.stringify(tree)}, file_tabs:[]}; localStorage.setItem('agentsense.workbench',JSON.stringify(ui)); __grid.show_workspace(reviewWorkspace); await __grid.restore_saved_sessions(reviewWorkspace);`);
  await until(() => js('return document.querySelectorAll(".tg-view-active .tg-pane[data-terminal-id]").length === 2;'), 'restored terminals');
  const widths = await js('return Array.from(document.querySelectorAll(".tg-view-active .tg-pane[data-terminal-id]")).map(e=>e.getBoundingClientRect().width);');
  const ratio = widths[0] / widths.reduce((a,b)=>a+b,0);
  record('R4', 'Cold restore preserves a saved 70/30 split', Math.abs(ratio - 0.7) < 0.03, { savedRatio:0.7, restoredRatio:ratio, widths });

  // Real worktree, process exit, then the actual Restart button.
  await js(`await __grid.launch_seats(reviewWorkspace,[{agent_id:'terminal',label:'Terminal',command:'powershell.exe'}],{use_worktree:true});`);
  const pty = require('../src/main/pty_manager');
  const wt = pty.list_terminals().find(t => t.worktree);
  await until(() => pty.list_terminals().find(t=>t.terminal_id===wt.terminal_id)?.buffer.includes('>'), 'worktree shell prompt');
  await js(`document.querySelector('.tg-pane[data-terminal-id="${wt.terminal_id}"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));`);
  const explorerRoot = await js('return document.querySelector(".tg-view-active .fp-title").title;');
  record('R5', 'Clicking inside a worktree terminal updates the explorer root', path.resolve(explorerRoot) === path.resolve(wt.cwd), { expectedRoot:wt.cwd, actualRoot:explorerRoot });
  pty.write_terminal(wt.terminal_id, 'exit\r');
  await until(() => pty.list_terminals().find(t=>t.terminal_id===wt.terminal_id)?.alive === false, 'shell exit');
  await js(`document.querySelector('.tg-pane[data-terminal-id="${wt.terminal_id}"] .tg-restart').click();`);
  await until(() => pty.list_terminals().some(t=>t.alive && t.cwd===wt.cwd), 'restarted shell');
  const restarted = pty.list_terminals().find(t=>t.alive && t.cwd===wt.cwd);
  const diskRecord = sessions.find_record(path.join(profile,'sessions.json'), restarted.record_id);
  record('R6', 'Restart retains worktree metadata in main and on disk', Boolean(restarted.worktree && diskRecord.worktree), { cwdRetained:restarted.cwd===wt.cwd, mainWorktree:restarted.worktree, diskWorktree:diskRecord.worktree });
}
app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => {
    run(win).catch(error => { console.error(error); results.push({id:'HARNESS',passed:false,error:String(error)}); }).finally(async () => {
      const pty = require('../src/main/pty_manager');
      for (const t of pty.list_terminals()) if(t.alive) pty.write_terminal(t.terminal_id,'exit\r');
      await delay(1500);
      pty.kill_all();
      const reviewedHead = execFileSync('git', ['rev-parse','HEAD'], {cwd:path.join(__dirname,'..'), encoding:'utf8', windowsHide:true}).trim();
      const evidence = { reviewedHead, createdAt:new Date().toISOString(), fixtureRoot:root, results };
      const evidenceDir = path.join(__dirname,'../docs/handoffs/stabilization/evidence');
      const original = path.join(evidenceDir,'codex-review-regressions.json');
      // Preserve the first review evidence. Follow-up runs receive their own SHA/timestamp file.
      const output = fs.existsSync(original)
        ? path.join(evidenceDir,`codex-review-regressions-${reviewedHead.slice(0,7)}-${Date.now()}.json`)
        : original;
      fs.writeFileSync(output, JSON.stringify(evidence,null,2));
      console.log(`Evidence: ${output}`);
      app.exit(results.some(r=>!r.passed) ? 1 : 0);
    });
  });
});
setTimeout(()=>{ console.error('Review fixture timeout'); app.exit(2); },120000).unref();
require('../main');
