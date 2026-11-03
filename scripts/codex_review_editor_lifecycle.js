// Review: real renderer/IPC/file IO, isolated profile and files, no real user data.
// Run: node node_modules/electron/cli.js scripts/codex_review_editor_lifecycle.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { app } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-review-editor-'));
const fixture = path.join(root, 'files');
const profile = path.join(root, 'profile');
fs.mkdirSync(fixture);
fs.mkdirSync(profile);
process.env.AGENT_HUB_USER_DATA = profile;
fs.writeFileSync(path.join(fixture, 'a.txt'), 'original A');
fs.writeFileSync(path.join(fixture, 'b.txt'), 'original B');
const results = [];
let closingDirtyWindow = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function record(id, expectation, passed, actual) {
  results.push({id, expectation, passed, actual});
  console.log(`${passed ? 'PASS' : 'FAIL'} ${id}: ${JSON.stringify(actual)}`);
}
async function until(predicate, label) {
  const deadline = Date.now() + 15000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error(`Timeout: ${label}`);
    await delay(40);
  }
}
async function run(win) {
  const js = code => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  await until(() => js('return Boolean(window.__grid && window.__sidebar && document.body.dataset.view_settled === "true")'), 'startup');
  await js(`window.reviewWorkspace = await hub.workspaces.add(${JSON.stringify(fixture)}); __grid.show_workspace(reviewWorkspace);`);
  await until(() => js(`return Boolean(document.querySelector('.tg-view-active .fp-row[data-path="a.txt"]'));`), 'tree');
  const open = async name => {
    await js(`document.querySelector('.tg-view-active .fp-row[data-path="${name}"]').click();`);
    await until(() => js(`return document.querySelector('.tf-file-tab-active')?.textContent.startsWith('${name}') && Boolean(document.querySelector('.tf-editor'));`), `open ${name}`);
    await delay(150);
  };
  const edit = text => js(`const e=document.querySelector('.tg-view-active .tf-editor'); e.value=${JSON.stringify(text)}; e.dispatchEvent(new Event('input',{bubbles:true}));`);

  // Control: closing a dirty tab without an external conflict saves successfully.
  await open('a.txt');
  await edit('SAVED ON CLOSE');
  await js(`document.querySelector('.tf-file-tab-active').parentElement.querySelector('.tf-file-tab-close').click();`);
  await delay(850);
  record('CONTROL', 'Normal dirty-tab close saves its buffer', fs.readFileSync(path.join(fixture,'a.txt'),'utf8') === 'SAVED ON CLOSE', {disk:fs.readFileSync(path.join(fixture,'a.txt'),'utf8')});

  // External modification before debounce: close starts async save, which must
  // retain the tab/buffer until it knows whether the save succeeded.
  await open('a.txt');
  await edit('UNSAVED CONFLICT BUFFER');
  fs.writeFileSync(path.join(fixture,'a.txt'),'EXTERNAL CHANGE');
  await js(`document.querySelector('.tf-file-tab-active').parentElement.querySelector('.tf-file-tab-close').click();`);
  await delay(850);
  const retained = await js(`return Boolean(Array.from(document.querySelectorAll('.tf-file-tab')).find(b=>b.textContent.startsWith('a.txt')) && document.querySelector('.tf-editor')?.value === 'UNSAVED CONFLICT BUFFER');`);
  const banner = await js(`return document.querySelector('.tg-banner-text')?.textContent;`);
  await open('a.txt');
  const reopened = await js(`return document.querySelector('.tf-editor').value;`);
  record('R7', 'A close-time conflict retains the dirty tab and recoverable buffer', retained || reopened === 'UNSAVED CONFLICT BUFFER', {retained, reopened, disk:fs.readFileSync(path.join(fixture,'a.txt'),'utf8'), banner});

  // R7 leaves a known conflict. A normal close must not run until that buffer is
  // explicitly discarded. Discard reloads the external file and does not write it.
  await js(`document.querySelector('.tf-discard').click();`);
  await until(() => js(`return document.querySelector('.tf-editor')?.value === 'EXTERNAL CHANGE' && document.querySelector('.tf-save')?.textContent === 'saved';`), 'discard conflict');
  record('R7_DISCARD', 'Discard is explicit and keeps the external file', fs.readFileSync(path.join(fixture,'a.txt'),'utf8') === 'EXTERNAL CHANGE', {disk:fs.readFileSync(path.join(fixture,'a.txt'),'utf8')});

  // Real native window close, no app.exit or renderer-reload shortcut. The app's
  // normal close/quit handlers must flush or cancel close while edits are dirty.
  await open('b.txt');
  await edit('EDIT JUST BEFORE WINDOW CLOSE');
  closingDirtyWindow = true;
  win.once('closed', () => {
    const disk = fs.readFileSync(path.join(fixture,'b.txt'),'utf8');
    const kept = fs.readFileSync(path.join(fixture,'a.txt'),'utf8');
    record('R8', 'Native app close preserves edits pending the autosave debounce', disk === 'EDIT JUST BEFORE WINDOW CLOSE' && kept === 'EXTERNAL CHANGE', {disk, expected:'EDIT JUST BEFORE WINDOW CLOSE', conflictedFile:kept});
  });
  win.close();
}
app.on('browser-window-created', (_event,win) => {
  win.webContents.once('did-finish-load', () => run(win).catch(error => {
    record('HARNESS','Fixture completes without errors',false,{error:String(error)});
    app.quit();
  }));
});
app.on('will-quit', () => {
  if (!closingDirtyWindow) record('HARNESS_CLOSE','Native close scenario was reached',false,{});
  const reviewedHead = execFileSync('git',['rev-parse','HEAD'],{cwd:path.join(__dirname,'..'),encoding:'utf8',windowsHide:true}).trim();
  const evidence = {reviewedHead,createdAt:new Date().toISOString(),fixtureRoot:root,results};
  const output = path.join(__dirname,`../docs/handoffs/stabilization/evidence/codex-review-editor-${reviewedHead.slice(0,7)}-${Date.now()}.json`);
  fs.writeFileSync(output,JSON.stringify(evidence,null,2));
  console.log(`Evidence: ${output}`);
  process.exitCode = results.some(r=>!r.passed) ? 1 : 0;
  app.exit(process.exitCode);
});
setTimeout(()=>{ console.error('Editor review fixture timeout'); app.exit(2); },45000).unref();
require('../main');
