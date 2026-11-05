// Real Electron renderer + IPC + ConPTY checks, isolated from the user's profile and repositories.
// Run: npm run smoke:workbench. Optional AGENTSENSE_SCREENSHOT=/absolute/path.png.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { app } = require('electron');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-workbench-profile-'));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-workbench-files-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-workbench-drop-'));
process.env.AGENT_HUB_USER_DATA = profile;
fs.writeFileSync(path.join(fixture, 'brief.txt'), 'AgentSense workbench\nDrag this file to an agent.\n');
fs.writeFileSync(path.join(fixture, '.hidden'), 'Hidden files stay visible.');
fs.copyFileSync(path.join(__dirname, '../assets/icon.png'), path.join(fixture, 'preview.png'));
fs.writeFileSync(path.join(outside, 'external brief.txt'), 'External attachment');
for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-m', 'fixture']]) {
  execFileSync('git', args, { cwd: fixture, windowsHide: true, stdio: 'pipe' });
}

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures++;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 20000) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeout) throw new Error(`Timed out: ${label}`);
    await delay(75);
  }
}

async function run(window) {
  // A launcher may set SW_HIDE. xterm needs an actual rendered surface to
  // measure cell dimensions; default 80 columns are not proof of a first fit.
  window.show();
  const contents = window.webContents;
  contents.setBackgroundThrottling(false);
  const js = (source) => contents.executeJavaScript(source.includes('await ') ? `(async () => { ${source} })()` : source).catch((error) => {
    console.error(`Renderer check failed: ${source}`);
    throw error;
  });
  const errors = [];
  contents.on('console-message', (event) => {
    if (event.level === 'error') { errors.push(event.message); console.error(event.message); }
  });
  await until(() => js('Boolean(window.__grid && window.__sidebar && document.body.dataset.view_settled === "true")'), 'renderer startup');
  await js(`window.testWorkspace = await window.hub.workspaces.add(${JSON.stringify(fixture)});
    await window.__sidebar.refresh(); await window.__show_launch_page(testWorkspace.id);`);
  await until(() => js('Boolean(document.querySelector(".launch_agent_button[data-agent-id=terminal]:not(:disabled)"))'), 'agent catalog');
  check('14 built-in CLI entries include Gemini, Copilot, Pi and Hermes', await js(
    `['gemini','copilot','pi','hermes'].every(id => window.AGENT_CATALOG.some(a => a.id === id && a.install_command)) && AGENT_CATALOG.length === 14`));
  await js(`document.querySelector('.launch_agent_button[data-agent-id=terminal]').click();
    document.querySelector('[data-count="2"]').click();
    document.querySelector('[data-action="launch"]').click();`);
  await until(() => js(`Array.from(document.querySelectorAll('.tg-view-active .tg-pane[data-terminal-id]')).filter(p => p.dataset.terminalId).length === 2`), 'two terminals');
  const terminal_ids = await js('window.__grid.list_sessions(testWorkspace.id).map(s => s.terminal_id)');
  check('two real PowerShell terminals start through the launch page', terminal_ids.length === 2);
  await until(() => js(`Boolean(document.querySelector('.tg-view-active .fp-row[data-path="brief.txt"]'))`), 'file tree');
  check('file explorer is on the right', await js(`(() => {
    const view = document.querySelector('.tg-view-active');
    return view.querySelector('.fp-side').getBoundingClientRect().left > view.querySelector('.tg-pane-area').getBoundingClientRect().left;
  })()`));
  check('hidden files are visible', await js(`Boolean(document.querySelector('.tg-view-active .fp-row[data-path=".hidden"]'))`));
  await js(`document.querySelector('.tg-view-active .fp-row[data-path="brief.txt"]').click()`);
  await until(() => js('Boolean(document.querySelector(".tg-view-active .tf-text"))'), 'text preview');
  await js(`document.querySelector('.tg-view-active .fp-row[data-path="brief.txt"]').click()`);
  check('opening a file creates one reusable tab on the Files page', await js(`document.querySelectorAll(".tg-view-active .tg-file-pane").length === 1 && !document.querySelector(".tg-view-active .tg-tabs").hidden &&
    document.querySelector('.tg-view-active [role=tab][aria-selected=true]').textContent === 'Files'`));
  check('file contents render as text', await js(`(() => {
    const node = document.querySelector('.tg-view-active .tf-text');
    return ((node && (node.value || node.textContent)) || '').includes('Drag this file');
  })()`));
  check('tab view control is gone', await js('!document.querySelector("[data-action=toggle_mode]")'));
  await js(`document.querySelectorAll('.tg-view-active [role=tab]')[0].click()`);
  const bounds_before = await js(`JSON.stringify(Array.from(document.querySelectorAll('.tg-view-active .tg-pane:not([hidden])')).map(p => {
    const r = p.getBoundingClientRect();
    return { id: p.id, w: Math.round(r.width), h: Math.round(r.height), hidden: p.hidden };
  }))`);
  for (let i = 0; i < 20; i += 1) {
    await js(`document.querySelectorAll('.tg-view-active .tg-pane:not([hidden]) .tg-pane-titlebar')[${i % 2}].click()`);
  }
  await js(`document.querySelector('.tg-view-active .tg-pane:not([hidden]) .tg-pane-titlebar').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}));`);
  const bounds_after = await js(`JSON.stringify(Array.from(document.querySelectorAll('.tg-view-active .tg-pane:not([hidden])')).map(p => {
    const r = p.getBoundingClientRect();
    return { id: p.id, w: Math.round(r.width), h: Math.round(r.height), hidden: p.hidden };
  }))`);
  const before = JSON.parse(bounds_before);
  const after = JSON.parse(bounds_after);
  check('focus and double-click keep every pane visible', after.length === before.length && after.every((pane) => pane.hidden === false));
  check('focus does not move pane bounds by more than 1px', after.every((pane, index) => Math.abs(pane.w - before[index].w) <= 1 && Math.abs(pane.h - before[index].h) <= 1));
  await js(`document.querySelector('.tg-root').dispatchEvent(new KeyboardEvent('keydown', {key:'Tab', ctrlKey:true, bubbles:true}));`);
  check('Ctrl+Tab moves to the next page', await js(`document.querySelector('.tg-view-active [role=tab][aria-selected=true]').textContent === 'Files'`));
  await js(`document.querySelectorAll('.tg-view-active [role=tab]')[0].click()`);
  check('coming back shows every agent again', await js('document.querySelectorAll(".tg-view-active .tg-pane:not([hidden])").length === 2'));
  await until(() => js('Number(document.querySelector(".tg-view-active .tg-pane[data-terminal-id]").dataset.cols) > 0'), 'initial terminal fit');
  const before_cols = await js('Number(document.querySelector(".tg-view-active .tg-pane[data-terminal-id]").dataset.cols)');
  await js('document.querySelector("[data-action=toggle_files]").click()');
  const explorer_refit = `document.querySelector('[data-action=toggle_files]').getAttribute('aria-pressed') === 'false' && Number(document.querySelector('.tg-view-active .tg-pane[data-terminal-id]').dataset.cols) > ${before_cols}`;
  await until(() => js(explorer_refit), 'terminal refit after hiding explorer');
  check('hiding explorer refits terminals and exposes toggle state', await js(explorer_refit));
  await js(`document.querySelector('.tg-root').dispatchEvent(new KeyboardEvent('keydown', {key:'E', ctrlKey:true, shiftKey:true, bubbles:true}));
    document.querySelector('.tg-view-active .tg-files-resize').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowLeft', bubbles:true}));`);
  check('explorer shortcut and keyboard resizing persist', await js(`(() => {
    const saved = JSON.parse(localStorage.getItem('agentsense.workbench'));
    const workspace = saved.workspaces && saved.workspaces[testWorkspace.id];
    return workspace && workspace.files_open === true && workspace.files_width === 290;
  })()`));

  // Capture renderer-to-PTY writes without replacing the real IPC. Enter is never sent for a drop.
  const ipc = require('electron').ipcMain;
  const writes = [];
  const observe_write = (_e, id, data) => writes.push({ id, data });
  ipc.on('terminals:write', observe_write);
  // Wait for PowerShell's prompt; ConPTY may still be starting when a pane is first mounted.
  const pty = require('../src/main/pty_manager');
  await until(() => pty.list_terminals().every((t) => t.buffer.includes('>')), 'PowerShell prompts');
  const drag = `(() => {
    const dt = new DataTransfer();
    document.querySelector('.tg-view-active .fp-row[data-path="brief.txt"]').dispatchEvent(new DragEvent('dragstart', {dataTransfer:dt, bubbles:true}));
    document.querySelectorAll('.tg-view-active .tg-pane[data-terminal-id]')[1].dispatchEvent(new DragEvent('drop', {dataTransfer:dt, bubbles:true, cancelable:true}));
  })()`;
  await js(drag);
  await until(() => writes.some((w) => w.id === terminal_ids[1] && w.data.includes('brief.txt')), 'file path reaches second agent');
  // CPR/focus reports are xterm replies to shell queries, not drop input. The
  // receiving path and every non-protocol write must still target this agent.
  const drop_inputs = writes.filter(w => !/^\x1b\[(?:\d+;\d+R|[IO])$/.test(w.data));
  check('tree drag targets only the receiving agent and never submits', drop_inputs.some(w => w.data.includes('brief.txt')) && drop_inputs.every((w) => w.id === terminal_ids[1] && !/[\r\n]/.test(w.data)));
  writes.length = 0;
  await js(`(() => {
    const dt = new DataTransfer();
    document.querySelector('.tg-view-active .tf-file-tab').dispatchEvent(new DragEvent('dragstart', {dataTransfer:dt, bubbles:true}));
    document.querySelector('.tg-view-active .tg-pane[data-terminal-id]').dispatchEvent(new DragEvent('drop', {dataTransfer:dt, bubbles:true, cancelable:true}));
  })()`);
  await until(() => writes.some((w) => w.id === terminal_ids[0] && w.data.includes('brief.txt')), 'file tab drop');
  check('open file tabs can be dragged to a different agent', writes.filter(w => w.data.includes('brief.txt')).every(w => w.id === terminal_ids[0]));
  writes.length = 0;
  // Dispatch from inside xterm's input, so a bubbling shortcut cannot also leak into the shell.
  await js(`document.querySelector('.tg-view-active .xterm-helper-textarea').dispatchEvent(new KeyboardEvent('keydown', {key:'Tab', ctrlKey:true, bubbles:true, cancelable:true}));`);
  await delay(100);
  // xterm may report focus/cursor position while the selected terminal changes. Those are expected;
  // the shortcut itself must not become a Tab (or Ctrl+E) character in the terminal's input.
  check('workbench shortcut keystrokes do not leak into the shell', !writes.some(w => w.data === '\t' || w.data === '\x05'));

  // Launch a third terminal isolated in a real git worktree, then drop a workspace file onto it.
  await js(`await window.__grid.launch_seats(testWorkspace, [{agent_id:'terminal', label:'Terminal', command:'powershell.exe'}], {use_worktree:true});`);
  await until(() => js('document.querySelectorAll(".tg-view-active .tg-pane[data-terminal-id]").length === 3'), 'worktree session');
  const info = pty.list_terminals().find((t) => !terminal_ids.includes(t.terminal_id));
  check('isolated agent runs in its worktree', info && path.resolve(info.cwd) !== path.resolve(fixture));
  await until(() => pty.list_terminals().find((t) => t.terminal_id === info.terminal_id)?.buffer.includes('>'), 'worktree prompt');
  await js(`(() => {
    const dt = new DataTransfer();
    document.querySelector('.tg-view-active .fp-row[data-path="brief.txt"]').dispatchEvent(new DragEvent('dragstart', {dataTransfer:dt, bubbles:true}));
    document.querySelector('.tg-view-active .tg-pane[data-terminal-id="${info.terminal_id}"]').dispatchEvent(new DragEvent('drop', {dataTransfer:dt, bubbles:true, cancelable:true}));
  })()`);
  await until(() => writes.some((w) => w.id === info.terminal_id && w.data.includes('brief')), 'worktree drop');
  const path_writes = writes.filter((w) => w.data.includes('brief'));
  check('drop references the worktree file and does not overwrite it', !fs.existsSync(path.join(info.cwd, 'brief (1).txt')) &&
    fs.existsSync(path.join(info.cwd, 'brief.txt')) &&
    path_writes.length === 1 && path_writes.every((w) => w.id === info.terminal_id && w.data.includes(info.cwd) && w.data.includes('brief.txt') && !/[\r\n]/.test(w.data)));
  // OS-file drops use Electron's native File->path resolver. The synthetic File uses the legacy fallback.
  writes.length = 0;
  await js(`(() => {
    const dt = new DataTransfer(); const file = new File(['attachment'], 'external brief.txt');
    Object.defineProperty(file, 'path', {value:${JSON.stringify(path.join(outside, 'external brief.txt'))}});
    dt.items.add(file);
    document.querySelector('.tg-view-active .tg-pane[data-terminal-id="${info.terminal_id}"]').dispatchEvent(new DragEvent('drop', {dataTransfer:dt, bubbles:true, cancelable:true}));
  })()`);
  const staged_external = path.join(info.cwd, '.agentsense-import', 'external brief.txt');
  await until(() => fs.existsSync(staged_external), 'external drop copied');
  check('external files land in the receiving worktree import folder', fs.existsSync(staged_external) && !fs.existsSync(path.join(fixture, 'external brief.txt')));
  ipc.removeListener('terminals:write', observe_write);

  await js(`document.querySelector('.tg-view-active .fp-row[data-path="preview.png"]').click()`);
  await until(() => js('Boolean(document.querySelector(".tg-view-active .tf-image")?.naturalWidth)'), 'image preview');
  check('image previews load', await js('document.querySelector(".tg-view-active .tf-image").naturalWidth > 0'));
  if (process.env.AGENTSENSE_SCREENSHOT) {
    fs.writeFileSync(process.env.AGENTSENSE_SCREENSHOT, (await contents.capturePage()).toPNG());
    console.log(`Screenshot: ${process.env.AGENTSENSE_SCREENSHOT}`);
  }

  await js(`document.querySelector('[data-action=toggle_files]').click();`);
  await contents.reload();
  await until(() => js('Boolean(window.__grid && document.querySelector(".tg-view-active .tg-pane"))'), 'renderer reload');
  check('panel visibility and width survive reload', await js(`!document.querySelector('.tg-view-active').classList.contains('tg-with-files') &&
    !document.querySelector('[data-action=toggle_mode]') &&
    document.querySelector('.tg-root').style.getPropertyValue('--files-width') === '290px'`));
  check('sessions reattach without respawning', pty.list_terminals().length === 3);
  await js(`window.testWorkspace = (await window.hub.workspaces.list()).find(w => w.path === ${JSON.stringify(fixture)});`);
  // Pages contain pane groups. A new page must not disturb the sessions on the first one.
  await js(`document.querySelector('[data-action=new_page]').click()`);
  check('new page hides the previous group and shows page navigation', await js(`
    document.querySelectorAll('.tg-view-active .tg-pane:not([hidden])').length === 0 &&
    !document.querySelector('.tg-view-active .tg-tabs').hidden &&
    document.querySelectorAll('.tg-view-active [role=tab]').length === 3`));
  await js(`await window.__grid.launch_seats(testWorkspace, [{agent_id:'terminal', label:'Terminal', command:'powershell.exe'}], {});`);
  check('terminal on a new page fills the available area', await js(`(() => {
    const pane = document.querySelector('.tg-view-active .tg-pane:not([hidden])');
    const area = document.querySelector('.tg-view-active .tg-grid').getBoundingClientRect();
    const r = pane.getBoundingClientRect();
    return Math.abs(r.top - area.top - 3) < 1 && Math.abs(r.height - area.height + 6) < 1 && Math.abs(r.width - area.width + 6) < 1;
  })()`));
  await js(`document.querySelector('[data-action=toggle_files]').click();
    document.querySelector('.tg-view-active .fp-row[data-path="brief.txt"]').click();`);
  await until(() => js(`document.querySelector('.tg-view-active [role=tab][aria-selected=true]').textContent === 'Files'`), 'tree click goes to the Files page');
  check('a tree click reuses the one Files page', await js(`document.querySelectorAll('.tg-view-active .tg-file-pane').length === 1 && document.querySelectorAll('.tg-view-active [role=tab]').length === 3`));
  await js(`document.querySelectorAll('.tg-view-active [role=tab]')[0].click()`);
  check('returning to first page restores its panes', await js(`document.querySelectorAll('.tg-view-active .tg-pane:not([hidden])').length === 3`));
  await contents.reload();
  await until(() => js(`Boolean(window.__grid && document.querySelectorAll('.tg-view-active [role=tab]').length === 3 && document.querySelectorAll('.tg-view-active .tg-pane').length === 5)`), 'page restore');
  check('page membership survives reload without respawning', pty.list_terminals().length === 4 && await js(`document.querySelectorAll('.tg-view-active .tg-pane:not([hidden])').length === 3`));
  await js(`document.querySelectorAll('.tg-view-active [role=tab]')[2].click();
    document.querySelectorAll('.tg-view-active .tg-tab-close')[2].click()`);
  await until(() => js(`document.querySelectorAll('.tg-view-active [role=tab]').length === 2`), 'page closed');
  check('closing a page ends only its sessions', pty.list_terminals().length === 3);
  await js(`document.querySelectorAll('.tg-view-active [role=tab]')[0].click()`);
  // Drive the real divider with pointer events, then verify that pane bounds still cover the grid.
  await js(`(() => {
    const divider = document.querySelector('.tg-view-active .tg-divider');
    const r = divider.getBoundingClientRect();
    const row = divider.classList.contains('tg-divider-row');
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    // setPointerCapture requires an active native pointer; the geometry path is otherwise identical.
    divider.setPointerCapture = () => {};
    divider.dispatchEvent(new PointerEvent('pointerdown', {button:0, pointerId:1, clientX:x, clientY:y}));
    divider.dispatchEvent(new PointerEvent('pointermove', {pointerId:1, clientX:x + (row ? 90 : 0), clientY:y + (row ? 0 : 90)}));
    divider.dispatchEvent(new PointerEvent('pointerup', {pointerId:1}));
  })()`);
  check('manual divider resizing keeps every pane inside the panel', await js(`(() => {
    const area = document.querySelector('.tg-view-active .tg-grid').getBoundingClientRect();
    return [...document.querySelectorAll('.tg-view-active .tg-pane:not([hidden])')].every(pane => {
      const r = pane.getBoundingClientRect();
      return r.left >= area.left && r.top >= area.top && r.right <= area.right + 1 && r.bottom <= area.bottom + 1;
    });
  })()`));
  // Close nested branches and verify the survivors cover the full height, then all available space.
  await js(`while(document.querySelector('.tg-view-active .tf-file-tab-close')) {
    document.querySelector('.tg-view-active .tf-file-tab-close').click();
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await window.__grid.close_session(${JSON.stringify(info.terminal_id)});`);
  check('two surviving terminals fill the panel without a blank band', await js(`(() => {
    const panes = [...document.querySelectorAll('.tg-view-active .tg-pane:not([hidden])')];
    const area = document.querySelector('.tg-view-active .tg-grid').getBoundingClientRect();
    const rects = panes.map(pane => pane.getBoundingClientRect());
    const covered = rects.reduce((sum, r) => sum + (r.width + 6) * (r.height + 6), 0);
    return panes.length === 2 && Math.abs(covered - area.width * area.height) < area.width &&
      Math.abs(Math.min(...rects.map(r => r.top)) - area.top - 3) < 1 &&
      Math.abs(Math.max(...rects.map(r => r.bottom)) - area.bottom + 3) < 1;
  })()`));
  await js(`await window.__grid.close_session(${JSON.stringify(terminal_ids[1])});`);
  check('last terminal expands to the full panel', await js(`(() => {
    const r = document.querySelector('.tg-view-active .tg-pane:not([hidden])').getBoundingClientRect();
    const area = document.querySelector('.tg-view-active .tg-grid').getBoundingClientRect();
    return Math.abs(r.width - area.width + 6) < 1 && Math.abs(r.height - area.height + 6) < 1;
  })()`));
  // Exercise the page's actual actions, native picker bridge, drop surface and repeatable splits.
  await js(`document.querySelector('[data-action=new_page]').click()`);
  if (process.env.AGENTSENSE_EMPTY_SCREENSHOT) fs.writeFileSync(process.env.AGENTSENSE_EMPTY_SCREENSHOT, (await contents.capturePage()).toPNG());
  check('empty page offers file and terminal actions', await js(`
    !document.querySelector('.tg-view-active .tg-page-empty').hidden &&
    document.querySelector('.tg-view-active .tg-page-empty [data-action=open_file]') &&
    document.querySelector('.tg-view-active .tg-page-empty [data-action=open_terminal]')`));
  const dialog = require('electron').dialog;
  const original_picker = dialog.showOpenDialog;
  let picker_options;
  try {
    dialog.showOpenDialog = async (_owner, options) => {
      picker_options = options;
      return { canceled: true, filePaths: [] };
    };
    await js(`document.querySelector('.tg-view-active .tg-page-empty [data-action=open_file]').click()`);
    await until(() => Boolean(picker_options), 'native file picker called');
    check('file picker starts in this workspace and cancellation keeps page empty', picker_options.defaultPath === fixture &&
      await js(`document.querySelectorAll('.tg-view-active .tg-pane:not([hidden])').length === 0`));
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(fixture, 'brief.txt')] });
    await js(`document.querySelector('.tg-view-active .tg-page-empty [data-action=open_file]').click()`);
    await until(() => js(`Boolean(document.querySelector('.tg-view-active .tg-file-pane:not([hidden]) .tf-text'))`), 'picker opens file');
  } finally { dialog.showOpenDialog = original_picker; }
  check('file-only page does not enable terminal split', await js(`document.querySelector('.tg-view-active [data-action=split_terminal]').disabled`));
  await js(`(() => {
    const dt = new DataTransfer();
    dt.setData('application/x-agentsense-path', JSON.stringify({root_path:${JSON.stringify(fixture)},rel_path:'preview.png'}));
    document.querySelector('.tg-view-active .tg-grid').dispatchEvent(new DragEvent('drop', {dataTransfer:dt,bubbles:true,cancelable:true}));
  })()`);
  await until(() => js(`Boolean(document.querySelector('.tg-view-active .tg-file-pane:not([hidden]) .tf-image')?.naturalWidth)`), 'page opens tree drop');
  check('dropping a workspace file opens it on the current page', await js(`document.querySelectorAll('.tg-view-active .tg-file-pane:not([hidden]) .tf-file-tab').length === 2`));
  await js(`(() => {
    const dt = new DataTransfer(); const file = new File(['attachment'], 'external brief.txt');
    Object.defineProperty(file, 'path', {value:${JSON.stringify(path.join(outside, 'external brief.txt'))}});
    dt.items.add(file);
    document.querySelector('.tg-view-active .tg-grid').dispatchEvent(new DragEvent('drop', {dataTransfer:dt,bubbles:true,cancelable:true}));
  })()`);
  await until(() => js(`document.querySelectorAll('.tg-view-active .tg-file-pane:not([hidden]) .tf-file-tab').length === 3`), 'page imports external drop');
  check('external page drop opens the original and adds nothing to the workspace', !fs.existsSync(path.join(fixture, '.agentsense-import')) &&
    await js(`document.querySelector('.tg-view-active .tg-file-pane:not([hidden]) .tf-file-tab-active').title.includes(${JSON.stringify(outside)})`));
  await js(`document.querySelector('.tg-view-active .tg-page-actions [data-action=open_terminal]').click()`);
  await until(() => js(`document.querySelectorAll('.tg-view-active .tg-pane[data-terminal-id]:not([hidden])').length === 1 && Boolean(document.querySelector('.tg-view-active .tg-pane[data-terminal-id]:not([hidden])').dataset.terminalId)`), 'page terminal action');
  const visible_terminals = () => js(`document.querySelectorAll('.tg-view-active .tg-pane[data-terminal-id]:not([hidden])').length`);
  for (let index = 0; index < 7; index += 1) {
    const side = index === 1 ? 'bottom' : 'right';
    const before = await js(`(() => { const r = document.querySelector('.tg-view-active .tg-pane.tg-active').getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height}; })()`);
    await js(`document.querySelector('.tg-view-active .tg-split-direction').value = '${side}';
      document.querySelector('.tg-view-active [data-action=split_terminal]').click()`);
    await until(async () => await visible_terminals() === index + 2 && await js(`Boolean(document.querySelector('.tg-view-active .tg-pane.tg-active').dataset.terminalId)`), 'terminal split action');
    if (index < 2) check(side === 'right' ? 'split places a terminal beside the selected one' : 'split places a terminal below the selected one', await js(`(() => {
      const r = document.querySelector('.tg-view-active .tg-pane.tg-active').getBoundingClientRect();
      return ${side === 'right' ? `r.left > ${before.left} && Math.abs(r.top - ${before.top}) < 1 && Math.abs(r.height - ${before.height}) < 1` : `r.top > ${before.top} && Math.abs(r.left - ${before.left}) < 1 && Math.abs(r.width - ${before.width}) < 1`};
    })()`));
    if (index === 1 && process.env.AGENTSENSE_SPLIT_SCREENSHOT) fs.writeFileSync(process.env.AGENTSENSE_SPLIT_SCREENSHOT, (await contents.capturePage()).toPNG());
  }
  check('page splitting supports more than six terminals in the same folder', await visible_terminals() === 8 && pty.list_terminals().filter(t => t.cwd === fixture).length === 9);
  await js(`document.querySelectorAll('.tg-view-active [role=tab]')[0].click()`);
  check('repeated splits leave the other page intact', await visible_terminals() === 1);
  await js(`document.querySelectorAll('.tg-view-active .tg-tab-close')[1].click()`);
  await until(() => pty.list_terminals().length === 1, 'split page closes');
  // Workspace created after hiding explorer must inherit its hidden state.
  await js(`window.otherWorkspace = await window.hub.workspaces.add(${JSON.stringify(outside)});
    window.__grid.show_workspace(otherWorkspace);`);
  check('another workspace keeps its own files panel', await js('document.querySelector(".tg-view-active").classList.contains("tg-with-files")'));
  await js('await window.__show_launch_page(otherWorkspace.id)');
  await until(() => js('Boolean(document.querySelector(".launch_custom_form"))'), 'custom CLI form');
  await js(`document.querySelector('.launch_custom_form input').value = 'powershell.exe';
    document.querySelector('.launch_custom_form').requestSubmit();`);
  await until(() => pty.list_terminals().length === 2, 'custom CLI launches');
  check('custom CLI launches with the standard session lifecycle', pty.list_terminals().some((t) => t.workspace_id !== info.workspace_id && t.command === 'powershell.exe'));
  check('no renderer errors', errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
  // Close through the product API. Drag/drop deliberately left unsubmitted input
  // in these shells; injecting Ctrl+C/exit is not a reliable cleanup protocol.
  // Concurrent natural shell exit is tested separately in check_pty_lifecycle.
  const shells_before_exit = pty.list_terminals().map((t) => ({
    terminal_id: t.terminal_id,
    pid: t.pid,
    alive: t.alive,
    exit_code: t.exit_code,
    command: t.command,
    cwd: t.cwd,
  }));
  console.log(`shells before exit: ${JSON.stringify(shells_before_exit)}`);
  console.log('shutdown step: close through product API');
  await js('for (const s of await window.hub.terminals.list()) await window.hub.terminals.kill(s.terminal_id)');
  check('all test terminals close through the product API', pty.list_terminals().length === 0);
  console.log('shutdown step: killed');
  // The worktree contains dropped files, so normal close must preserve it.
  check('closing an agent preserves its modified worktree', fs.existsSync(staged_external));
  console.log(`\nWorkbench smoke: ${failures ? `${failures} failed` : 'all checks passed'}`);
}

app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    run(window).catch((error) => { failures++; console.error(error); }).finally(async () => {
      await require('../src/main/pty_manager').kill_all();
      app.exit(failures ? 1 : 0);
    });
  });
});
// Safety net if startup itself fails before the renderer is ready.
setTimeout(() => { console.error('Workbench smoke timeout'); app.exit(1); }, 120000).unref();
require('../main');
