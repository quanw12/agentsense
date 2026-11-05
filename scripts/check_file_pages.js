// The Files page: clicking through files, preview tabs, and dragging tabs into side-by-side groups.
// Real renderer, IPC and files on a throwaway profile. Drags are DOM drag events at real pane coordinates.
// Run: npx electron scripts/check_file_pages.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-file-pages-'));
const profile = process.env.AGENTSENSE_FILE_PAGES_PROFILE || path.join(root, 'profile');
const repo = path.join(root, 'repo');
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(repo);
process.env.AGENT_HUB_USER_DATA = profile;
for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) fs.writeFileSync(path.join(repo, name), `${name} content\n`);
fs.writeFileSync(path.join(repo, 'e.pdf'), '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n');

let failures = 0;
function check(name, passed, actual) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${passed || actual === undefined ? '' : `: ${JSON.stringify(actual)}`}`);
  if (!passed) failures += 1;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 15000) {
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
  const page_errors = [];
  contents.on('console-message', (event) => {
    if (event.level === 'error') page_errors.push(event.message);
  });
  const js = (source) => contents.executeJavaScript(`(async () => { ${source} })()`);
  await until(() => js('return Boolean(window.__grid && window.__sidebar && document.body.dataset.view_settled === "true");'), 'startup');

  const page_names = () => js(`return [...document.querySelectorAll('.tg-view-active [role=tab]')].map(t => t.textContent + (t.getAttribute('aria-selected') === 'true' ? '*' : ''));`);
  const groups = () => js(`return [...document.querySelectorAll('.tg-view-active .tg-file-pane:not([hidden])')].map(p => {
    const r = p.getBoundingClientRect();
    return { tabs: [...p.querySelectorAll('.tf-file-tab')].map(t => t.textContent), active: p.querySelector('.tf-file-tab-active')?.textContent, preview: [...p.querySelectorAll('.tf-file-tab-preview')].map(t => t.textContent), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), editor: p.querySelector('.tf-editor')?.value };
  });`);
  const click_row = (name) => js(`document.querySelector('.tg-view-active .fp-row[data-path="${name}"]').click();`);
  const showing = async (name) => (await groups()).some((group) => group.active && group.active.startsWith(name) && group.editor !== undefined && group.editor.startsWith(name.slice(0, 1)));
  const drag_tab = (tab_name, group_index, where) => js(`
    const panes = [...document.querySelectorAll('.tg-view-active .tg-file-pane:not([hidden])')];
    const tab = [...document.querySelectorAll('.tg-view-active .tg-file-pane:not([hidden]) .tf-file-tab')].find(t => t.textContent.startsWith('${tab_name}'));
    const target = panes[${group_index}];
    const r = target.getBoundingClientRect();
    const spots = { right: [r.right - 8, r.top + r.height / 2], left: [r.left + 8, r.top + r.height / 2], bottom: [r.left + r.width / 2, r.bottom - 8], center: [r.left + r.width / 2, r.top + r.height / 2] };
    const [clientX, clientY] = spots['${where}'];
    const dt = new DataTransfer();
    tab.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    const under = target.querySelector('.tf-body');
    under.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX, clientY }));
    const indicator = document.querySelector('.tg-view-active .tg-drop-indicator');
    window.__indicator = { shown: Boolean(indicator && !indicator.hidden) };
    under.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX, clientY }));
  `);
  const edit = (group_index, text) => js(`
    const e = document.querySelectorAll('.tg-view-active .tg-file-pane:not([hidden]) .tf-editor')[${group_index}];
    e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', { bubbles: true }));`);

  await js(`window.ws = await hub.workspaces.add(${JSON.stringify(repo)}); await __sidebar.refresh(); __sidebar.select(ws.id);`);
  await until(() => js(`return !document.getElementById('launch_host').hidden;`), 'launch page');
  await js(`document.querySelector('[data-action=cancel]').click();`);
  await js(`await __grid.launch_seats(ws, [{agent_id:'terminal', label:'Terminal', command:'powershell.exe'}], {});`);
  const pty = require('../src/main/pty_manager');
  await until(() => pty.list_terminals().length === 1, 'terminal');
  await until(() => js(`return Boolean(document.querySelector('.tg-view-active .fp-row[data-path="a.txt"]'));`), 'tree');
  const terminal_cols = await js(`return Number(document.querySelector('.tg-view-active .tg-pane[data-terminal-id]').dataset.cols);`);

  // Clicking through files.
  await click_row('a.txt');
  await until(() => showing('a.txt'), 'a opens');
  check('clicking a file opens a separate Files page', JSON.stringify(await page_names()) === JSON.stringify(['Page 1', 'Files*']), await page_names());
  check('the file fills the page', await js(`
    const p = document.querySelector('.tg-view-active .tg-file-pane:not([hidden])').getBoundingClientRect();
    const a = document.querySelector('.tg-view-active .tg-grid').getBoundingClientRect();
    return Math.abs(p.width - a.width + 6) < 1 && Math.abs(p.height - a.height + 6) < 1;`));
  check('the terminal is not on the Files page and keeps its size', await js(`
    const t = document.querySelector('.tg-view-active .tg-pane[data-terminal-id]');
    return t.hidden && Number(t.dataset.cols) === ${terminal_cols};`));

  await click_row('b.txt');
  await until(() => showing('b.txt'), 'b replaces a');
  let state = await groups();
  check('the next click replaces the file on view', state.length === 1 && state[0].tabs.length === 1 && state[0].tabs[0] === 'b.txt', state);
  check('a viewed file is a preview tab', state[0].preview.includes('b.txt'), state);
  check('no second Files page appears', (await page_names()).length === 2, await page_names());

  await js(`document.querySelector('.tg-view-active .tf-file-tab').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));`);
  await click_row('c.txt');
  await until(() => showing('c.txt'), 'c opens next to the kept tab');
  state = await groups();
  check('double-clicking a tab keeps it when another file is clicked', JSON.stringify(state[0].tabs) === JSON.stringify(['b.txt', 'c.txt']), state);

  await edit(0, 'c.txt edited\n');
  await until(() => fs.readFileSync(path.join(repo, 'c.txt'), 'utf8') === 'c.txt edited\n', 'edit saved');
  await click_row('d.txt');
  await until(() => showing('d.txt'), 'd opens');
  state = await groups();
  check('an edited file keeps its tab', state[0].tabs.includes('c.txt') && state[0].tabs.includes('d.txt') && !state[0].preview.includes('c.txt'), state);

  await click_row('c.txt');
  await until(async () => (await groups())[0].active === 'c.txt', 'c back');
  check('clicking a file that is already open shows that tab', (await groups())[0].tabs.filter((tab) => tab === 'c.txt').length === 1);

  // Going back to the agents.
  await js(`document.querySelectorAll('.tg-view-active [role=tab]')[0].click();`);
  check('the agent page is untouched', await js(`return document.querySelectorAll('.tg-view-active .tg-pane:not([hidden])').length === 1 && Boolean(document.querySelector('.tg-view-active .tg-pane[data-terminal-id]:not([hidden])'));`));
  await js(`document.querySelectorAll('.tg-view-active [role=tab]')[1].click();`);
  await js(`await __grid.launch_seats(ws, [{agent_id:'terminal', label:'Terminal', command:'powershell.exe'}], {});`);
  await until(() => pty.list_terminals().length === 2, 'second terminal');
  check('a new session started from the Files page goes to the agents', JSON.stringify(await page_names()) === JSON.stringify(['Page 1*', 'Files']), await page_names());
  await js(`document.querySelectorAll('.tg-view-active [role=tab]')[1].click();`);

  // Splitting by dragging a tab.
  await drag_tab('b.txt', 0, 'right');
  await until(async () => (await groups()).length === 2, 'split right');
  state = await groups();
  check('dragging a tab to the right edge shows the two files side by side', state[1].x > state[0].x && state[0].y === state[1].y && state[0].h === state[1].h && state[1].active === 'b.txt' && !state[0].tabs.includes('b.txt'), state);
  check('the drag shows where the file will land', await js(`return window.__indicator.shown;`));
  await until(async () => (await groups()).every((group) => group.editor !== undefined), 'both editors');

  await drag_tab('d.txt', 1, 'bottom');
  await until(async () => (await groups()).length === 3, 'split bottom');
  state = await groups();
  const below = state.find((group) => group.active === 'd.txt');
  const above = state.find((group) => group.active === 'b.txt');
  check('dragging a tab to the bottom edge stacks it', below && above && below.y > above.y && below.x === above.x, state);

  await drag_tab('d.txt', 0, 'center');
  await until(async () => (await groups()).length === 2, 'move into group');
  state = await groups();
  check('dropping a tab on a group moves it there and removes the empty group', state[0].tabs.includes('d.txt') && state[0].active === 'd.txt', state);

  // A clicked file goes to the group in use, and unsaved edits travel with their tab.
  await js(`document.querySelectorAll('.tg-view-active .tg-file-pane:not([hidden])')[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));`);
  await click_row('a.txt');
  await until(async () => (await groups())[1].active === 'a.txt', 'a in second group');
  state = await groups();
  check('a clicked file replaces the view in the group last used', state[0].tabs.includes('d.txt') && state[1].tabs.includes('a.txt'), state);

  await edit(1, 'a.txt typed\n');
  await drag_tab('a.txt', 0, 'center');
  await until(async () => (await groups()).some((group) => group.active && group.active.startsWith('a.txt') && group.editor === 'a.txt typed\n' && group.x === state[0].x), 'unsaved tab moved');
  await until(() => fs.readFileSync(path.join(repo, 'a.txt'), 'utf8') === 'a.txt typed\n', 'moved edit saved');
  check('unsaved edits move with the tab and still save', true);

  // A tree row dragged to an edge.
  await js(`
    const panes = [...document.querySelectorAll('.tg-view-active .tg-file-pane:not([hidden])')];
    const r = panes[0].getBoundingClientRect();
    const dt = new DataTransfer();
    document.querySelector('.tg-view-active .fp-row[data-path="d.txt"]').dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    const at = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + r.height / 2 };
    panes[0].querySelector('.tf-body').dispatchEvent(new DragEvent('dragover', at));
    panes[0].querySelector('.tf-body').dispatchEvent(new DragEvent('drop', at));`);
  await until(async () => (await groups()).length === 3, 'tree row split');
  state = await groups();
  check('dragging a tree row to an edge opens it side by side', state.some((group) => group.active === 'd.txt' && group.tabs.length === 1), state);

  // A real mouse drag with Chromium's own hit testing, across a PDF frame that would otherwise swallow it.
  await click_row('e.pdf');
  await until(() => js(`return Boolean(document.querySelector('.tg-view-active .tg-file-pane:not([hidden]) .tf-frame'));`), 'pdf opens');
  await delay(800);
  const rects = await js(`
    const panes = [...document.querySelectorAll('.tg-view-active .tg-file-pane:not([hidden])')];
    const with_frame = panes.find(p => p.querySelector('.tf-frame'));
    const source = panes.find(p => p !== with_frame && p.querySelector('.tf-file-tab'));
    const t = source.querySelector('.tf-file-tab').getBoundingClientRect();
    const f = with_frame.querySelector('.tf-frame').getBoundingClientRect();
    return { tab_x: t.left + t.width / 2, tab_y: t.top + t.height / 2, drop_x: f.right - 6, drop_y: f.top + f.height / 2, tab: source.querySelector('.tf-file-tab').textContent, tabs_in_source: source.querySelectorAll('.tf-file-tab').length, groups: panes.length };`);
  const cdp = contents.debugger;
  cdp.attach('1.3');
  const intercepted = new Promise((resolve) => {
    cdp.on('message', (_event, method, params) => {
      if (method === 'Input.dragIntercepted') resolve(params.data);
    });
  });
  await cdp.sendCommand('Input.setInterceptDrags', { enabled: true });
  const mouse = (type, x, y, extra) => cdp.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
  await mouse('mouseMoved', rects.tab_x, rects.tab_y, { button: 'none', clickCount: 0 });
  await mouse('mousePressed', rects.tab_x, rects.tab_y, { buttons: 1 });
  await mouse('mouseMoved', rects.tab_x + 12, rects.tab_y + 12, { buttons: 1 });
  await mouse('mouseMoved', rects.tab_x + 40, rects.tab_y + 40, { buttons: 1 });
  const drag_data = await Promise.race([intercepted, delay(5000).then(() => null)]);
  check('a real mouse press on a tab starts a drag', Boolean(drag_data));
  for (const type of ['dragEnter', 'dragOver', 'dragOver']) {
    await cdp.sendCommand('Input.dispatchDragEvent', { type, x: rects.drop_x, y: rects.drop_y, data: drag_data });
  }
  check('the page marks the drag so frames let it through', await js(`return document.body.classList.contains('tg-internal-drag');`));
  check('hovering the edge of a PDF shows the drop indicator', await js(`const i = document.querySelector('.tg-view-active .tg-drop-indicator'); return Boolean(i && !i.hidden);`));
  await cdp.sendCommand('Input.dispatchDragEvent', { type: 'drop', x: rects.drop_x, y: rects.drop_y, data: drag_data });
  await mouse('mouseReleased', rects.drop_x, rects.drop_y, {});
  await cdp.sendCommand('Input.setInterceptDrags', { enabled: false });
  cdp.detach();
  const expected_groups = rects.tabs_in_source === 1 ? rects.groups : rects.groups + 1;
  await until(async () => (await groups()).some((group) => group.active === rects.tab && group.x > 0) && (await groups()).length === expected_groups, 'real drag splits');
  check('a real drag onto the edge of a PDF splits beside it', await js(`return !document.body.classList.contains('tg-internal-drag');`));

  // Layout across a restart of the window contents.
  const before =(await groups()).map((group) => ({ tabs: group.tabs.slice().sort(), x: group.x, y: group.y }));
  const terminals_before = pty.list_terminals().length;
  await contents.reload();
  await until(() => js('return Boolean(window.__grid && window.__sidebar && document.body.dataset.view_settled === "true");'), 'reload');
  await until(async () => (await groups()).length === before.length, 'groups restored');
  const after =(await groups()).map((group) => ({ tabs: group.tabs.slice().sort(), x: group.x, y: group.y }));
  check('file groups, tabs and positions survive a reload', JSON.stringify(after) === JSON.stringify(before), { before, after });
  check('the Files page survives a reload as a Files page', (await page_names()).includes('Files*') && pty.list_terminals().length === terminals_before, await page_names());
  await click_row('c.txt');
  await delay(300);
  check('after a reload a click still uses the same Files page', (await page_names()).filter((name) => name.startsWith('Files')).length === 1, await page_names());

  // Closing everything removes the page and returns to the agents.
  await js(`while (document.querySelector('.tg-view-active .tg-file-pane:not([hidden]) .tf-file-tab-close')) {
    document.querySelector('.tg-view-active .tg-file-pane:not([hidden]) .tf-file-tab-close').click();
    await new Promise(resolve => setTimeout(resolve, 150));
  }`);
  await until(() => js(`return document.querySelector('.tg-view-active .tg-tabs').hidden;`), 'Files page closes');
  check('closing the last file removes the Files page', await js(`return document.querySelectorAll('.tg-view-active .tg-pane[data-terminal-id]:not([hidden])').length === 2;`));

  check('no renderer errors', page_errors.length === 0, page_errors);
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => {
    run(win).catch((error) => {
      failures += 1;
      console.error(error);
    }).finally(async () => {
      console.log(`\nFile page checks: ${failures ? `${failures} failed` : 'all passed'}`);
      await require('../src/main/pty_manager').kill_all();
      app.exit(failures ? 1 : 0);
    });
  });
});
setTimeout(() => { console.error('File page check timeout'); app.exit(2); }, 120000).unref();
require('../main');
