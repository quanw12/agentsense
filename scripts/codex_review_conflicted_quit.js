// Checks native close with an already-known conflict, using only throwaway data.
// Run: node node_modules/electron/cli.js scripts/codex_review_conflicted_quit.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { app } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-review-conflict-'));
const fixture = path.join(root,'files');
const profile = path.join(root,'profile');
fs.mkdirSync(fixture);
fs.mkdirSync(profile);
process.env.AGENT_HUB_USER_DATA = profile;
const filePath = path.join(fixture,'conflict.txt');
fs.writeFileSync(filePath,'original');
const results = [];
let finished = false;
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
function record(id, passed, actual) {
  results.push({id,passed,actual});
  console.log(`${passed ? 'PASS' : 'FAIL'} ${id}: ${JSON.stringify(actual)}`);
}
async function until(fn,label) {
  const deadline = Date.now()+15000;
  while (!await fn()) {
    if (Date.now()>deadline) throw new Error(`Timeout: ${label}`);
    await delay(40);
  }
}
function finish() {
  if (finished) return;
  finished = true;
  const reviewedHead = execFileSync('git',['rev-parse','HEAD'],{cwd:path.join(__dirname,'..'),encoding:'utf8',windowsHide:true}).trim();
  const evidence = {reviewedHead,createdAt:new Date().toISOString(),fixtureRoot:root,results};
  const output = path.join(__dirname,`../docs/handoffs/stabilization/evidence/codex-review-conflicted-quit-${reviewedHead.slice(0,7)}-${Date.now()}.json`);
  fs.writeFileSync(output,JSON.stringify(evidence,null,2));
  console.log(`Evidence: ${output}`);
  app.exit(results.some(result=>!result.passed) ? 1 : 0);
}
async function run(win) {
  const js = code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
  await until(()=>js('return Boolean(window.__grid && document.body.dataset.view_settled === "true");'),'startup');
  await js(`const workspace=await hub.workspaces.add(${JSON.stringify(fixture)}); __grid.show_workspace(workspace);`);
  await until(()=>js(`return Boolean(document.querySelector('.tg-view-active .fp-row[data-path="conflict.txt"]'));`),'file tree');
  await js(`document.querySelector('.tg-view-active .fp-row[data-path="conflict.txt"]').click();`);
  await until(()=>js('return Boolean(document.querySelector(".tf-editor"));'),'editor');
  await js(`const editor=document.querySelector('.tf-editor'); editor.value='UNSAVED BUFFER TO KEEP'; editor.dispatchEvent(new Event('input',{bubbles:true}));`);
  fs.writeFileSync(filePath,'EXTERNAL DISK VERSION');
  await until(()=>js(`return document.querySelector('.tf-save')?.textContent === 'conflict';`),'known conflict');
  record('SETUP',true,{status:'conflict',buffer:await js(`return document.querySelector('.tf-editor').value;`),disk:fs.readFileSync(filePath,'utf8')});
  let closed = false;
  win.once('closed',()=>{
    // finish() exits the app after a blocked close. That teardown also emits closed.
    // It is not the quit under test; a close before the wait is still a failure.
    if (finished) return;
    closed = true;
    record('R9',false,{expectation:'Known-conflict buffer blocks close unless explicitly resolved/discarded or persisted for recovery',windowClosed:true,disk:fs.readFileSync(filePath,'utf8'),userDiscarded:false});
    finish();
  });
  win.close();
  await delay(1200);
  if (!closed) {
    const buffer=await js(`return document.querySelector('.tf-editor')?.value;`);
    record('R9',buffer==='UNSAVED BUFFER TO KEEP',{windowClosed:false,buffer,disk:fs.readFileSync(filePath,'utf8')});
    finish();
  }
}
app.on('browser-window-created',(_event,win)=>{
  win.webContents.once('did-finish-load',()=>run(win).catch(error=>{
    record('HARNESS',false,{error:String(error)});
    finish();
  }));
});
setTimeout(()=>{record('HARNESS_TIMEOUT',false,{});finish();},30000).unref();
require('../main');
