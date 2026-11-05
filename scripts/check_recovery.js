// Ways out of bad states: failed restore, files changing on disk, files outside the workspace, failed saves,
// a crashed renderer and a hung renderer. Real renderer, IPC and files, on a throwaway profile.
// Run: npx electron scripts/check_recovery.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { app, dialog } = require('electron');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-recovery-'));
const profile = path.join(root, 'profile');
const repo = path.join(root, 'repo');
const outside = path.join(root, 'outside');
const gone = path.join(root, 'gone');
for (const dir of [profile, repo, outside]) fs.mkdirSync(dir);
process.env.AGENT_HUB_USER_DATA = profile;

const file = (name) => path.join(repo, name);
fs.writeFileSync(file('notes.txt'), `${'line\n'.repeat(400)}end\n`);
fs.writeFileSync(file('edited.txt'), 'edited\n');
fs.writeFileSync(file('deleted.txt'), 'deleted\n');
fs.writeFileSync(file('locked.txt'), 'locked\n');
fs.writeFileSync(path.join(outside, 'report.txt'), 'original\n');
for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Check', '-c', 'user.email=check@example.invalid', 'commit', '-m', 'fixture']]) {
  execFileSync('git', args, { cwd: repo, windowsHide: true, stdio: 'pipe' });
}
fs.chmodSync(file('locked.txt'), 0o444);

// The workspace listed first is selected at startup, and its only saved session points at a missing folder.
fs.writeFileSync(path.join(profile, 'state.json'), JSON.stringify({ workspaces: [{ id: 'gone-1', name: 'gone', path: gone }], presets: [] }));
fs.writeFileSync(path.join(profile, 'sessions.json'), JSON.stringify({
  version: 1,
  records: [{ record_id: 'lost-1', workspace_id: 'gone-1', agent_id: 'terminal', title: 'Lost|terminal|Terminal', command: 'powershell.exe', cwd: gone }],
}));

// Scripted answers for the native dialogs: the button index to press, or the dialog is only recorded.
const dialogs = [];
let dialog_answer = 0;
dialog.showMessageBox = async (_window, options) => {
  dialogs.push(options.message);
  return { response: dialog_answer };
};

let failures = 0;
function check(name, passed, actual) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${passed || actual === undefined ? '' : `: ${JSON.stringify(actual)}`}`);
  if (!passed) failures += 1;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 20000) {
  const start = Date.now();
  for (;;) {
    let done = false;
    try { done = await predicate(); } catch { done = false; }
    if (done) return;
    if (Date.now() - start > timeout) throw new Error(`Timed out: ${label}`);
    await delay(50);
  }
}

async function run(win) {
  win.show();
  const contents = win.webContents;
  contents.setBackgroundThrottling(false);
  const js = (source) => contents.executeJavaScript(`(async () => { ${source} })()`);
  const ready = () => until(() => js('return Boolean(window.__grid && window.__sidebar && document.body.dataset.view_settled === "true");'), 'renderer ready');
  const banner = () => js(`const b = document.querySelector('.tg-banner'); return b.getBoundingClientRect().height > 0 ? b.textContent : '';`);
  const editor_value = () => js(`return document.querySelector('.tg-view-active .tg-file-pane:not([hidden]) .tf-editor')?.value;`);
  const status = () => js(`return document.querySelector('.tg-view-active .tg-file-pane:not([hidden]) .tf-save')?.textContent;`);
  const edit = (text) => js(`const e = document.querySelector('.tg-view-active .tg-file-pane:not([hidden]) .tf-editor'); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', {bubbles:true}));`);
  const has_discard = () => js(`return Boolean(document.querySelector('.tg-view-active .tg-file-pane:not([hidden]) .tf-discard'));`);
  const discard = () => js(`document.querySelector('.tg-view-active .tg-file-pane:not([hidden]) .tf-discard').click();`);
  const open = async (name) => {
    await until(() => js(`return Boolean(document.querySelector('.tg-view-active .fp-row[data-path="${name}"]'));`), `tree row ${name}`);
    await js(`document.querySelector('.tg-view-active .fp-row[data-path="${name}"]').click();`);
    await until(() => js(`return document.querySelector('.tg-view-active .tf-file-tab-active')?.textContent.startsWith('${name}') && Boolean(document.querySelector('.tg-view-active .tf-editor'));`), `editor ${name}`);
  };
  const close_active_tab = () => js(`document.querySelector('.tg-view-active .tf-file-tab-active').parentElement.querySelector('.tf-file-tab-close').click();`);
  const tab_open = (name) => js(`return [...document.querySelectorAll('.tg-view-active .tf-file-tab')].some(t => t.textContent.startsWith('${name}'));`);

  await ready();

  // Failed restore.
  await until(() => js(`return Boolean(document.querySelector('.tg-view-active .tg-pane[data-status=exited]'));`), 'failed pane');
  await until(async () => (await banner()).includes('Could not restore'), 'restore message');
  check('a failed restore shows the grid, not the launch page', await js(`return document.getElementById('launch_host').hidden;`));
  check('a failed restore offers Restart and Forget', await js(`
    const labels = [...document.querySelectorAll('.tg-view-active .tg-pane button:not([hidden])')].map(b => b.textContent);
    return labels.includes('Restart') && labels.includes('Forget');`));
  await js(`[...document.querySelectorAll('.tg-view-active .tg-pane button')].find(b => b.textContent === 'Forget').click();`);
  await until(() => !JSON.parse(fs.readFileSync(path.join(profile, 'sessions.json'), 'utf8')).records.length, 'record forgotten');
  check('Forget removes the saved session', true);

  await js(`window.ws = await hub.workspaces.add(${JSON.stringify(repo)}); await __sidebar.refresh(); __sidebar.select(ws.id);`);
  await until(() => js(`return !document.getElementById('launch_host').hidden;`), 'launch page');
  await js(`document.querySelector('[data-action=cancel]').click();`);

  // An agent edits an open file.
  await open('notes.txt');
  await js(`const e = document.querySelector('.tg-view-active .tf-editor'); e.focus(); e.setSelectionRange(12, 15); e.scrollTop = 600;`);
  const view_before = await js(`const e = document.querySelector('.tg-view-active .tf-editor'); return {top: e.scrollTop, start: e.selectionStart, end: e.selectionEnd};`);
  await delay(300);
  fs.writeFileSync(file('notes.txt'), `${'LINE\n'.repeat(400)}end\n`);
  await until(async () => (await editor_value())?.startsWith('LINE'), 'tab follows the disk');
  check('a clean tab reloads when the file changes on disk', await status() === 'reloaded');
  const view_after = await js(`const e = document.querySelector('.tg-view-active .tf-editor'); return {top: e.scrollTop, start: e.selectionStart, end: e.selectionEnd, focused: document.activeElement === e};`);
  check('the reload keeps caret, scroll and focus', view_after.focused && view_after.start === view_before.start && view_after.end === view_before.end && view_after.top === view_before.top, { view_before, view_after });

  await edit(`mine\n`);
  await until(() => fs.readFileSync(file('notes.txt'), 'utf8') === 'mine\n', 'own save');
  await delay(600);
  check('our own save does not reload the tab', await editor_value() === 'mine\n' && await status() === 'saved', await status());

  await open('edited.txt');
  await edit('unsaved\n');
  fs.writeFileSync(file('edited.txt'), 'external\n');
  await until(async () => await status() === 'conflict', 'conflict');
  check('unsaved edits are never replaced by a change on disk', await editor_value() === 'unsaved\n' && fs.readFileSync(file('edited.txt'), 'utf8') === 'external\n');
  await discard();
  await until(async () => await editor_value() === 'external\n', 'discard reloads');
  check('Discard clears the old message', await banner() === '', await banner());

  // A file deleted under an open tab.
  await open('deleted.txt');
  await edit('typed before delete\n');
  fs.rmSync(file('deleted.txt'));
  await until(async () => await status() === 'conflict', 'deleted conflict');
  check('saving does not recreate a deleted file', !fs.existsSync(file('deleted.txt')) && (await banner()).includes('deleted on disk'), await banner());
  await discard();
  await until(() => js(`return document.querySelector('.tg-view-active .tf-unsupported-text')?.textContent.includes('not found');`), 'deleted notice');
  await close_active_tab();
  await until(async () => !await tab_open('deleted.txt'), 'deleted tab closes');
  check('a deleted file tab can be closed', true);

  fs.writeFileSync(file('back.txt'), 'back\n');
  await open('back.txt');
  await delay(300);
  fs.rmSync(file('back.txt'));
  await until(() => js(`return document.querySelector('.tg-view-active .tf-unsupported-text')?.textContent.includes('not found');`), 'clean tab notices delete');
  fs.writeFileSync(file('back.txt'), 'back again\n');
  await until(async () => await editor_value() === 'back again\n', 'tab returns');
  check('a clean tab follows a file being deleted and written back', true);
  await close_active_tab();
  await until(async () => !await tab_open('back.txt'), 'back tab closes');
  fs.rmSync(file('back.txt'));

  // A file from outside the workspace.
  const original_picker = dialog.showOpenDialog;
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(outside, 'report.txt')] });
  await js(`document.querySelector('.tg-view-active .tg-page-actions [data-action=open_file]').click();`);
  await until(async () => await tab_open('report.txt') && await editor_value() === 'original\n', 'outside file opens');
  dialog.showOpenDialog = original_picker;
  await edit('changed\n');
  await until(() => fs.readFileSync(path.join(outside, 'report.txt'), 'utf8') === 'changed\n', 'outside file saved');
  check('Open file edits the original outside the workspace', !fs.existsSync(file('.agentsense-import')));
  check('Open file adds nothing to the repository', !execFileSync('git', ['status', '--porcelain', '--', '.agentsense-import'], { cwd: repo, encoding: 'utf8' }).trim());
  await delay(300);
  fs.writeFileSync(path.join(outside, 'report.txt'), 'from outside\n');
  await until(async () => await editor_value() === 'from outside\n', 'outside tab follows the disk');
  check('a tab from outside the workspace follows the disk', true);
  await close_active_tab();
  await until(async () => !await tab_open('report.txt'), 'outside tab closes');

  // A save that fails with an OS error.
  await open('locked.txt');
  await edit('blocked\n');
  await until(async () => await status() === 'error', 'save error');
  check('a failed save offers Discard', await has_discard());
  await close_active_tab();
  // The failed autosave already showed "Could not save ...", so wait for the message of the close itself.
  await until(async () => (await banner()).includes('The tab was kept'), 'tab kept');
  check('closing the tab explains the way out', (await banner()).includes('Discard my edits') && await tab_open('locked.txt'), await banner());

  await js(`await __show_launch_page(ws.id);`);
  await until(() => js(`return !document.getElementById('launch_host').hidden;`), 'launch page over the editor');
  win.close();
  await until(async () => (await banner()).includes('Close cancelled'), 'close blocked');
  check('a blocked close leaves the launch page and shows why', await js(`return document.getElementById('launch_host').hidden;`) && !win.isDestroyed());
  check('a blocked close still offers Discard', await has_discard());

  fs.chmodSync(file('locked.txt'), 0o666);
  await edit('saved after unlock\n');
  await until(() => fs.readFileSync(file('locked.txt'), 'utf8') === 'saved after unlock\n', 'retry saves');
  check('saving again after the problem is fixed removes Discard', !await has_discard() && await status() === 'saved');
  fs.chmodSync(file('locked.txt'), 0o444);
  await edit('blocked again\n');
  await until(async () => await status() === 'error', 'second save error');
  await discard();
  await until(async () => await editor_value() === 'saved after unlock\n', 'discard after error');
  check('Discard after a failed save restores the file on disk', await status() === 'saved' && fs.readFileSync(file('locked.txt'), 'utf8') === 'saved after unlock\n');
  await close_active_tab();
  await until(async () => !await tab_open('locked.txt'), 'locked tab closes');
  fs.chmodSync(file('locked.txt'), 0o666);

  // A crashed renderer.
  const pty = require('../src/main/pty_manager');
  await js(`await __grid.launch_seats(ws, [{agent_id:'terminal', label:'Terminal', command:'powershell.exe'}], {});`);
  await until(() => pty.list_terminals().length === 1 && pty.list_terminals()[0].buffer.includes('>'), 'terminal');
  const terminal_id = pty.list_terminals()[0].terminal_id;
  const pid = pty.list_terminals()[0].pid;
  const crash_and_wait = async () => {
    const seen = dialogs.length;
    contents.forcefullyCrashRenderer();
    await until(() => dialogs.length > seen, 'crash dialog');
    await until(() => !contents.isCrashed(), 'renderer back');
    await ready();
  };
  await crash_and_wait();
  await until(() => js(`return document.querySelector('.tg-view-active .tg-pane[data-terminal-id="${terminal_id}"]')?.dataset.status === 'running';`), 'pane re-attached');
  check('a crash reloads the window and re-attaches the running terminal', pty.list_terminals()[0].pid === pid && !win.isDestroyed());
  check('a crash tells the user what happened', dialogs[dialogs.length - 1].includes('crashed and was reloaded'), dialogs);
  await crash_and_wait();
  await crash_and_wait();
  await crash_and_wait();
  check('repeated crashes ask instead of reloading forever', dialogs[dialogs.length - 1].includes('keeps crashing'), dialogs);
  check('Try again brings the window back', !win.isDestroyed() && await js(`return Boolean(window.__grid);`));

  // A hung renderer: Keep waiting asks again, Close anyway really closes.
  const before_hang = dialogs.length;
  contents.executeJavaScript('for (;;) {}').catch(() => {});
  await delay(200);
  dialog_answer = 0;
  win.close();
  await until(() => dialogs.length > before_hang, 'hang dialog', 15000);
  check('a hung window asks after the flush times out', !win.isDestroyed());
  dialog_answer = 1;
  await until(() => win.isDestroyed(), 'close anyway', 15000);
  check('Close anyway closes a hung window', dialogs.length === before_hang + 2, dialogs.slice(before_hang));
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => {
    run(win).catch((error) => {
      failures += 1;
      console.error(error);
    }).finally(() => {
      // The hung-window path ends through the app's normal quit; anything else stops here.
      if (!win.isDestroyed() || failures) {
        require('../src/main/pty_manager').kill_all().finally(() => app.exit(failures ? 1 : 0));
      }
    });
  });
});
app.on('quit', () => {
  console.log(`\nRecovery checks: ${failures ? `${failures} failed` : 'all passed'}`);
  app.exit(failures ? 1 : 0);
});
setTimeout(() => { console.error('Recovery check timeout'); app.exit(2); }, 180000).unref();
require('../main');
