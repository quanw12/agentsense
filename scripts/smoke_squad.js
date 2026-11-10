// End-to-end Electron + ConPTY smoke check for the OpenMausBot-style Bot Squad mode.
// Tests: Sidebar mode switcher, Bot Roster & Channels, Brain Picker, Per-Bot isolated worktree/VM boot,
// real chat message execution + live screen streaming, and Browser Sandbox tabs.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { app } = require('electron');

const app_root = fs.existsSync(path.join(__dirname, '../node_modules'))
  ? path.join(__dirname, '..')
  : path.join(__dirname, '../app/resources/app');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-squad-profile-'));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-squad-repo-'));
process.env.AGENT_HUB_USER_DATA = profile;

fs.writeFileSync(path.join(fixture, 'README.md'), '# Squad Test Repo\n');
for (const args of [
  ['init'],
  ['add', '.'],
  ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-m', 'init'],
]) {
  execFileSync('git', args, { cwd: fixture, windowsHide: true, stdio: 'pipe' });
}

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures += 1;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 20000) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeout) throw new Error(`Timed out: ${label}`);
    await delay(100);
  }
}

async function run(window) {
  window.show();
  const contents = window.webContents;
  contents.setBackgroundThrottling(false);
  const js = (source) =>
    contents
      .executeJavaScript(source.includes('await ') ? `(async () => { ${source} })()` : source)
      .catch((error) => {
        console.error(`Renderer JS error in: ${source}`);
        throw error;
      });

  const errors = [];
  contents.on('console-message', (event) => {
    if (event.level === 'error') {
      errors.push(event.message);
      console.error(event.message);
    }
  });

  await until(
    () => js('Boolean(window.__grid && window.__sidebar && window.__squad_chat && document.body.dataset.view_settled === "true")'),
    'renderer startup'
  );

  // Add test workspace
  await js(`window.testWs = await window.hub.workspaces.add(${JSON.stringify(fixture)});
    await window.__sidebar.refresh();`);

  // Click the 💬 Squad button in the sidebar mode switcher
  await js(`document.querySelector('.sidebar_mode_btn[data-mode="squad"]').click()`);
  await until(() => js('!document.getElementById("squad_host").hidden'), 'squad host visible');
  check('clicking 💬 Squad switches main area to OpenMausBot Squad Chat', await js('!document.getElementById("squad_host").hidden && document.getElementById("terminal_grid").hidden'));

  // Check starter roster & channels
  await until(() => js('document.querySelectorAll(".sq_nav_row[data-bot_id]").length === 4'), '4 starter bots rendered');
  check('4 starter bots and 3 channels are rendered in the left rail', await js(
    'document.querySelectorAll(".sq_nav_row[data-bot_id]").length === 4 && document.querySelectorAll(".sq_nav_row[data-thread_id^=\'chan:\']").length === 3'
  ));

  // Select 1-on-1 DM with @builder and switch its CLI brain to PowerShell ('terminal') so we can run a deterministic command on any PC
  await js(`document.querySelector('.sq_nav_row[data-bot_id="bot-builder"]').click()`);
  await until(() => js('document.querySelector(".sq_chat_title").textContent.includes("Forge Builder")'), 'Forge Builder DM open');
  await js(`const sel = document.querySelector('[data-action="switch_bot_cli"]');
    sel.value = 'terminal';
    sel.dispatchEvent(new Event('change'));`);
  await delay(300);

  // Send a chat command to Forge Builder in Squad Chat
  await js(`const box = document.querySelector('.sq_input');
    box.value = 'Write-Output "SQUAD_VM_OK"';
    document.querySelector('[data-action="send_squad_message"]').click();`);

  // Wait for the bot reply bubble and live terminal screen to show SQUAD_VM_OK
  await until(
    () =>
      js(`Array.from(document.querySelectorAll('.sq_msg.bot .sq_msg_text')).some(el => el.textContent.includes('SQUAD_VM_OK'))`),
    'bot reply streams SQUAD_VM_OK from its isolated worktree terminal',
    25000
  );
  check('bot spawns isolated worktree computer and streams terminal output into chat bubble', true);

  // Check that the right-hand Bot Computer drawer shows the live screen and worktree branch
  check('right-hand Bot Computer drawer shows live terminal screen', await js(
    `document.getElementById('sq_live_screen_box') && document.getElementById('sq_live_screen_box').textContent.includes('SQUAD_VM_OK')`
  ));

  // Switch Bot Computer drawer to VM / Worktree Info tab and verify worktree isolation
  await js(`document.querySelector('.sq_comp_tab[data-tab="env"]').click()`);
  check('VM / Worktree tab displays isolated branch and capabilities', await js(
    `document.querySelector('.sq_comp_body').textContent.includes('agentsense/') && document.querySelector('.sq_comp_body').textContent.includes('persist:bot_bot-builder')`
  ));

  // Switch back to 🧩 Grid mode and verify the bot's terminal pane is also visible in Terminal Grid
  await js(`document.querySelector('.sidebar_mode_btn[data-mode="grid"]').click()`);
  await until(() => js('!document.getElementById("terminal_grid").hidden'), 'grid visible again');
  check('switching back to 🧩 Grid shows the bot session in the workbench', await js(
    `window.__grid.list_sessions(window.testWs.id).length === 1`
  ));

  check('no renderer console errors', errors.length === 0);

  // Clean up test terminals
  await js('for (const s of await window.hub.terminals.list()) await window.hub.terminals.kill(s.terminal_id)');
  console.log(`\nSquad smoke: ${failures ? `${failures} failed` : 'all checks passed'}`);
}

app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    run(window)
      .catch((error) => {
        failures += 1;
        console.error(error);
      })
      .finally(async () => {
        await require(path.join(app_root, 'src/main/pty_manager')).kill_all();
        app.exit(failures ? 1 : 0);
      });
  });
});

setTimeout(() => {
  console.error('Squad smoke timeout');
  app.exit(1);
}, 90000).unref();

require(path.join(app_root, 'main'));
