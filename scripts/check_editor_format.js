// Real editor/IPC checks for Windows line endings, BOM and unsupported encodings.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-editor-format-'));
process.env.AGENT_HUB_USER_DATA = path.join(root, 'profile');
fs.writeFileSync(path.join(root, 'crlf.txt'), '\uFEFFone\r\ntwo\r\n');
fs.writeFileSync(path.join(root, 'mixed.txt'), 'one\r\ntwo\n');
fs.writeFileSync(path.join(root, 'legacy.txt'), Buffer.from([0x80,0x81,0x82]));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  const deadline = Date.now() + 15000;
  while (!await fn()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await delay(40);
  }
}
app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    const js = code => win.webContents.executeJavaScript(`(async()=>{${code}})()`);
    try {
      await until(() => js('return Boolean(window.__grid && document.body.dataset.view_settled === "true");'), 'startup');
      await js(`const workspace=await hub.workspaces.add(${JSON.stringify(root)}); __grid.show_workspace(workspace);`);
      await until(() => js(`return Boolean(document.querySelector('.tg-view-active .fp-row[data-path="crlf.txt"]'));`), 'file tree');
      async function open(name) {
        await js(`document.querySelector('.tg-view-active .fp-row[data-path="${name}"]').click();`);
        await until(() => js(`return document.querySelector('.tf-file-tab-active')?.textContent.startsWith('${name}') && Boolean(document.querySelector('.tf-editor'));`), `open ${name}`);
        await delay(150);
      }
      await open('crlf.txt');
      await js(`const editor=document.querySelector('.tf-editor'); editor.value += ${JSON.stringify('third\n')}; editor.dispatchEvent(new Event('input',{bubbles:true}));`);
      const expected = '\uFEFFone\r\ntwo\r\nthird\r\n';
      await until(() => fs.readFileSync(path.join(root,'crlf.txt'),'utf8') === expected, 'CRLF/BOM autosave');
      console.log('PASS real editor preserves BOM and CRLF after editing');
      for (const name of ['mixed.txt','legacy.txt']) {
        const before = fs.readFileSync(path.join(root,name));
        await open(name);
        if (!await js(`return document.querySelector('.tf-editor').readOnly;`)) throw new Error(`${name} is unexpectedly editable`);
        if (!fs.readFileSync(path.join(root,name)).equals(before)) throw new Error(`${name} was rewritten`);
        console.log(`PASS ${name} stays read-only and byte-identical`);
      }
      win.close();
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
});
setTimeout(() => {console.error('Editor format deadline'); app.exit(2);},45000).unref();
require('../main');
