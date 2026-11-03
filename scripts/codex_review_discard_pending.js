// Deterministic slow-IO fixture for Discard while two autosaves are queued.
// Real renderer and filesystem writes; only the first IPC write is paused.
// Run: node node_modules/electron/cli.js scripts/codex_review_discard_pending.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { app, ipcMain } = require('electron');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'agentsense-review-discard-'));
const fixture=path.join(root,'files');
const profile=path.join(root,'profile');
fs.mkdirSync(fixture);
fs.mkdirSync(profile);
process.env.AGENT_HUB_USER_DATA=profile;
const filePath=path.join(fixture,'conflict.txt');
fs.writeFileSync(filePath,'original');
const results=[];
let finished=false;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function record(id,passed,actual) {
  results.push({id,passed,actual});
  console.log(`${passed?'PASS':'FAIL'} ${id}: ${JSON.stringify(actual)}`);
}
async function until(fn,label) {
  const deadline=Date.now()+15000;
  while(!await fn()) {
    if(Date.now()>deadline) throw new Error(`Timeout: ${label}`);
    await delay(40);
  }
}
function finish() {
  if(finished) return;
  finished=true;
  const reviewedHead=execFileSync('git',['rev-parse','HEAD'],{cwd:path.join(__dirname,'..'),encoding:'utf8',windowsHide:true}).trim();
  const evidence={reviewedHead,createdAt:new Date().toISOString(),fixtureRoot:root,slowIO:'first post-conflict files:write paused; all writes use production write_text',results};
  const output=path.join(__dirname,`../docs/handoffs/stabilization/evidence/codex-review-discard-pending-${reviewedHead.slice(0,7)}-${Date.now()}.json`);
  fs.writeFileSync(output,JSON.stringify(evidence,null,2));
  console.log(`Evidence: ${output}`);
  app.exit(results.some(r=>!r.passed)?1:0);
}
async function run(win) {
  const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
  await until(()=>js('return Boolean(window.__grid && document.body.dataset.view_settled === "true");'),'startup');
  await js(`const workspace=await hub.workspaces.add(${JSON.stringify(fixture)}); __grid.show_workspace(workspace);`);
  await until(()=>js(`return Boolean(document.querySelector('.tg-view-active .fp-row[data-path="conflict.txt"]'));`),'tree');
  await js(`document.querySelector('.tg-view-active .fp-row[data-path="conflict.txt"]').click();`);
  await until(()=>js(`return Boolean(document.querySelector('.tf-editor'));`),'editor');
  const edit=value=>js(`const editor=document.querySelector('.tf-editor'); editor.value=${JSON.stringify(value)}; editor.dispatchEvent(new Event('input',{bubbles:true}));`);
  await edit('INITIAL UNSAVED EDIT');
  fs.writeFileSync(filePath,'EXTERNAL VERSION TO PRESERVE');
  await until(()=>js(`return document.querySelector('.tf-save')?.textContent === 'conflict';`),'initial conflict');

  const files=require('../src/main/ipc_files');
  let releaseFirst;
  const firstGate=new Promise(resolve=>{releaseFirst=resolve;});
  let firstEntered=false;
  let writeCount=0;
  let discarded=false;
  const writesAfterDiscard=[];
  ipcMain.removeHandler('files:write');
  ipcMain.handle('files:write',async(_event,...args)=>{
    writeCount+=1;
    if(writeCount===1) {
      firstEntered=true;
      await firstGate;
    }
    const outcome=await files.write_text(...args);
    if(discarded && outcome.ok) writesAfterDiscard.push({content:args[2],diskAfterWrite:fs.readFileSync(filePath,'utf8')});
    return outcome;
  });
  await edit('OLD AUTOSAVE ONE');
  await until(()=>firstEntered,'first autosave waiting on slow IO');
  await edit('OLD AUTOSAVE TWO');
  await delay(850); // The second debounce queues behind the first save.
  discarded=true;
  await js(`document.querySelector('.tf-discard').click();`);
  // A correct implementation may wait for the in-flight save before finishing
  // Discard. Release IO independently of the reload so that approach can pass.
  await delay(150);
  record('DISCARD_CONTROL',fs.readFileSync(filePath,'utf8')==='EXTERNAL VERSION TO PRESERVE',{disk:fs.readFileSync(filePath,'utf8'),editor:await js(`return document.querySelector('.tf-editor').value;`),writeCount});
  releaseFirst();
  await delay(1600);
  const disk=fs.readFileSync(filePath,'utf8');
  record('R10',disk==='EXTERNAL VERSION TO PRESERVE' && writesAfterDiscard.every(write=>write.content==='EXTERNAL VERSION TO PRESERVE'),{expectation:'Pending autosaves cannot restore discarded edits or overwrite the external version, including transient writes',disk,editor:await js(`return document.querySelector('.tf-editor')?.value;`),status:await js(`return document.querySelector('.tf-save')?.textContent;`),writeCount,writesAfterDiscard});
  finish();
}
app.on('browser-window-created',(_event,win)=>win.webContents.once('did-finish-load',()=>run(win).catch(error=>{
  record('HARNESS',false,{error:String(error)});
  finish();
})));
setTimeout(()=>{record('HARNESS_TIMEOUT',false,{});finish();},30000).unref();
require('../main');
