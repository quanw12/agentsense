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
  const contents = window.webContents;
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
  check('opening a file creates one reusable tab', await js('document.querySelectorAll(".tg-view-active .tg-file-pane").length === 1 && document.querySelectorAll(".tg-view-active [role=tab]").length === 3'));
  check('file contents render as text', await js('document.querySelector(".tg-view-active .tf-text").textContent.includes("Drag this file")'));
  await js('document.querySelector("[data-action=toggle_mode]").click()');
  check('Tab view displays only the selected file', await js('document.querySelectorAll(".tg-view-active .tg-pane:not([hidden])").length === 1 && !document.querySelector(".tg-view-active .tg-file-pane").hidden'));
  await js('document.querySelector(".tg-view-active [role=tab]").click()');
  check('agent tab switches back to its live terminal', await js('document.querySelectorAll(".tg-view-active .tg-pane:not([hidden])").length === 1 && !document.querySelector(".tg-view-active .tg-pane[data-terminal-id]").hidden'));
  await js(`document.querySelector('.tg-root').dispatchEvent(new KeyboardEvent('keydown', {key:'Tab', ctrlKey:true, bubbles:true}));`);
  check('Ctrl+Tab selects the next agent', await js('document.querySelectorAll(".tg-view-active [role=tab]")[1].getAttribute("aria-selected") === "true"'));
  await js(`document.querySelector('[data-action=toggle_mode]').click();
    document.querySelector('.tg-view-active .tg-pane-titlebar').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}));
    document.querySelector('.tg-view-active .tg-tab:last-child [role=tab]').click();`);
  check('tabs switch correctly while a pane is maximized', await js('!document.querySelector(".tg-view-active .tg-file-pane").hidden && document.querySelectorAll(".tg-view-active .tg-pane:not([hidden])").length === 1'));
  await js(`document.querySelector('.tg-view-active .tg-file-pane .tg-pane-titlebar').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}));`);
  check('Split view restores all panes', await js('document.querySelectorAll(".tg-view-active .tg-pane:not([hidden])").length === 3'));
  const before_cols = await js('Number(document.querySelector(".tg-view-active .tg-pane[data-terminal-id]").dataset.cols)');
  await js('document.querySelector("[data-action=toggle_files]").click()');
  await delay(250);
  check('hiding explorer refits terminals and exposes toggle state', await js(`document.querySelector('[data-action=toggle_files]').getAttribute('aria-pressed') === 'false' && Number(document.querySelector('.tg-view-active .tg-pane[data-terminal-id]').dataset.cols) > ${before_cols}`));
  await js(`document.querySelector('.tg-root').dispatchEvent(new KeyboardEvent('keydown', {key:'E', ctrlKey:true, shiftKey:true, bubbles:true}));
    document.querySelector('.tg-view-active .tg-files-resize').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowLeft', bubbles:true}));`);
  check('explorer shortcut and keyboard resizing persist', await js(`(() => {
    const saved = JSON.parse(localStorage.getItem('agentsense.workbench'));
    return saved.files_open && saved.files_width === 290;
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
    document.querySelectorAll('.tg-view-active .tg-tab')[1].dispatchEvent(new DragEvent('drop', {dataTransfer:dt, bubbles:true, cancelable:true}));
  })()`;
  await js(drag);
  await until(() => writes.some((w) => w.id === terminal_ids[1] && w.data.includes('brief.txt')), 'file path reaches second agent');
  check('tree drag targets only the receiving agent and never submits', writes.every((w) => w.id === terminal_ids[1] && !/[\r\n]/.test(w.data)));
  writes.length = 0;
  await js(`(() => {
    const dt = new DataTransfer();
    document.querySelector('.tg-view-active .tg-tab:nth-child(3) [role=tab]').dispatchEvent(new DragEvent('dragstart', {dataTransfer:dt, bubbles:true}));
    document.querySelector('.tg-view-active .tg-tab:first-child').dispatchEvent(new DragEvent('drop', {dataTransfer:dt, bubbles:true, cancelable:true}));
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
  check('drop copies into the target worktree without overwriting tracked files', fs.existsSync(path.join(info.cwd, 'brief (1).txt')) &&
    path_writes.length === 1 && path_writes.every((w) => w.id === info.terminal_id && w.data.includes(info.cwd) && !/[\r\n]/.test(w.data)));
  // OS-file drops use Electron's native File->path resolver. The synthetic File uses the legacy fallback.
  writes.length = 0;
  await js(`(() => {
    const dt = new DataTransfer(); const file = new File(['attachment'], 'external brief.txt');
    Object.defineProperty(file, 'path', {value:${JSON.stringify(path.join(outside, 'external brief.txt'))}});
    dt.items.add(file);
    document.querySelector('.tg-view-active .tg-pane[data-terminal-id="${info.terminal_id}"]').dispatchEvent(new DragEvent('drop', {dataTransfer:dt, bubbles:true, cancelable:true}));
  })()`);
  await until(() => fs.existsSync(path.join(info.cwd, 'external brief.txt')), 'external drop copied');
  check('external files land in the receiving worktree', fs.existsSync(path.join(info.cwd, 'external brief.txt')) && !fs.existsSync(path.join(fixture, 'external brief.txt')));
  ipc.removeListener('terminals:write', observe_write);

  await js(`document.querySelector('.tg-view-active .fp-row[data-path="preview.png"]').click()`);
  await until(() => js('Boolean(document.querySelector(".tg-view-active .tf-image")?.naturalWidth)'), 'image preview');
  check('image previews load', await js('document.querySelector(".tg-view-active .tf-image").naturalWidth > 0'));
  if (process.env.AGENTSENSE_SCREENSHOT) {
    fs.writeFileSync(process.env.AGENTSENSE_SCREENSHOT, (await contents.capturePage()).toPNG());
    console.log(`Screenshot: ${process.env.AGENTSENSE_SCREENSHOT}`);
  }

  await js(`document.querySelector('[data-action=toggle_files]').click();
    document.querySelector('[data-action=toggle_mode]').click();`);
  await contents.reload();
  await until(() => js('Boolean(window.__grid && document.querySelector(".tg-view-active .tg-pane"))'), 'renderer reload');
  check('panel visibility, width and mode survive reload', await js(`!document.querySelector('.tg-view-active').classList.contains('tg-with-files') &&
    document.querySelector('[data-action=toggle_mode]').textContent === 'Split view' &&
    document.querySelector('.tg-root').style.getPropertyValue('--files-width') === '290px'`));
  check('sessions reattach without respawning', pty.list_terminals().length === 3);
  // Workspace created after hiding explorer must inherit its hidden state.
  await js(`window.otherWorkspace = await window.hub.workspaces.add(${JSON.stringify(outside)});
    window.__grid.show_workspace(otherWorkspace);`);
  check('new workspaces honor the hidden explorer preference', await js('!document.querySelector(".tg-view-active").classList.contains("tg-with-files")'));
  await js('await window.__show_launch_page(otherWorkspace.id)');
  await until(() => js('Boolean(document.querySelector(".launch_custom_form"))'), 'custom CLI form');
  await js(`document.querySelector('.launch_custom_form input').value = 'powershell.exe';
    document.querySelector('.launch_custom_form').requestSubmit();`);
  await until(() => pty.list_terminals().length === 4, 'custom CLI launches');
  check('custom CLI launches with the standard session lifecycle', pty.list_terminals().some((t) => t.workspace_id !== info.workspace_id && t.command === 'powershell.exe'));
  check('no renderer errors', errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
  // Exit the test shells before closing their ConPTY handles, so node-pty's process-list helper can detach.
  await js(`for (const s of await window.hub.terminals.list()) window.hub.terminals.write(s.terminal_id, '\\x03');`);
  await delay(100);
  await js(`for (const s of await window.hub.terminals.list()) window.hub.terminals.write(s.terminal_id, 'exit\\r');`);
  await until(() => pty.list_terminals().every((t) => !t.alive), 'test shells exit');
  await js('for (const s of await window.hub.terminals.list()) await window.hub.terminals.kill(s.terminal_id)');
  // The worktree contains dropped files, so normal close must preserve it.
  check('closing an agent preserves its modified worktree', fs.existsSync(path.join(info.cwd, 'external brief.txt')));
  console.log(`\nWorkbench smoke: ${failures ? `${failures} failed` : 'all checks passed'}`);
}

app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    run(window).catch((error) => { failures++; console.error(error); }).finally(() => {
      require('../src/main/pty_manager').kill_all();
      app.exit(failures ? 1 : 0);
    });
  });
});
// Safety net if startup itself fails before the renderer is ready.
setTimeout(() => { console.error('Workbench smoke timeout'); app.exit(1); }, 120000).unref();
require('../main');
