// Captures the README screenshots into docs/media/ from a real Electron window.
// Uses a throwaway profile and demo repositories, so none of your own workspaces appear.
// Run: npx electron scripts/capture_screenshots.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { app } = require('electron');

const OUT = path.join(__dirname, '..', 'docs', 'media');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-shots-'));
const profile = path.join(root, 'profile');
process.env.AGENT_HUB_USER_DATA = profile;

const DEMO_FILES = {
  'README.md': '# demo-app\n\nA small HTTP API used to demo AgentSense.\n',
  'package.json': JSON.stringify({ name: 'demo-app', version: '0.4.2', scripts: { dev: 'tsx watch src/server.ts', test: 'vitest run' } }, null, 2) + '\n',
  '.gitignore': 'node_modules/\ndist/\n',
  'src/server.ts': [
    "import { createServer } from 'node:http';",
    "import { route } from './router';",
    '',
    'const PORT = Number(process.env.PORT ?? 3000);',
    '',
    'const server = createServer(async (req, res) => {',
    '  const started = performance.now();',
    '  try {',
    '    const result = await route(req);',
    "    res.writeHead(result.status, { 'content-type': 'application/json' });",
    '    res.end(JSON.stringify(result.body));',
    '  } catch (error) {',
    "    res.writeHead(500, { 'content-type': 'application/json' });",
    "    res.end(JSON.stringify({ error: 'internal_error' }));",
    '  } finally {',
    '    const ms = (performance.now() - started).toFixed(1);',
    '    console.log(`${req.method} ${req.url} ${res.statusCode} ${ms}ms`);',
    '  }',
    '});',
    '',
    'server.listen(PORT, () => console.log(`demo-app listening on :${PORT}`));',
    '',
  ].join('\n'),
  'src/router.ts': "export async function route(req) {\n  if (req.url === '/health') return { status: 200, body: { ok: true } };\n  return { status: 404, body: { error: 'not_found' } };\n}\n",
  'src/users/service.ts': 'export function listUsers() {\n  return [];\n}\n',
  'tests/router.test.ts': "import { route } from '../src/router';\n",
};

function make_repo(name, files) {
  const dir = path.join(root, name);
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  const git = (...args) => execFileSync('git', args, { cwd: dir, windowsHide: true, stdio: 'pipe' });
  git('init', '-b', 'main');
  git('add', '.');
  const commit = (message) => git('-c', 'user.name=Demo', '-c', 'user.email=demo@example.invalid', 'commit', '--allow-empty', '-m', message);
  commit('feat: initial API skeleton');
  if (name === 'demo-app') {
    for (const message of ['feat(router): add /health endpoint', 'test: cover router fallbacks', 'chore: log request timings', 'fix(server): return JSON on 500']) commit(message);
    fs.appendFileSync(path.join(dir, 'src/router.ts'), "\nexport const VERSION = '0.4.2';\n");
    fs.writeFileSync(path.join(dir, 'src/users/routes.ts'), 'export {};\n');
  }
  return dir;
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
  const demo = make_repo('demo-app', DEMO_FILES);
  const others = ['api-gateway', 'docs-site'].map((name) => make_repo(name, { 'README.md': `# ${name}\n` }));
  window.setContentSize(1440, 900);
  window.center();
  window.show();
  const contents = window.webContents;
  contents.setBackgroundThrottling(false);
  const js = (source) => contents.executeJavaScript(source.includes('await ') ? `(async () => { ${source} })()` : source);
  const shot = async (name) => {
    await delay(600);
    fs.writeFileSync(path.join(OUT, name), (await contents.capturePage()).toPNG());
    console.log(`wrote docs/media/${name}`);
  };
  fs.mkdirSync(OUT, { recursive: true });

  await until(() => js('Boolean(window.__grid && window.__sidebar && document.body.dataset.view_settled === "true")'), 'renderer startup');
  await js(`window.demo = await window.hub.workspaces.add(${JSON.stringify(demo)})`);
  for (const dir of others) await js(`await window.hub.workspaces.add(${JSON.stringify(dir)})`);
  await js('await window.__sidebar.refresh(); await window.__show_launch_page(demo.id);');
  await until(() => js('Boolean(document.querySelector(".launch_agent_button[data-agent-id=terminal]:not(:disabled)"))'), 'agent catalog');
  await shot('launch.png');

  // Workbench: four real PowerShell panes running ordinary commands in the demo repo.
  await js(`document.querySelector('.launch_agent_button[data-agent-id=terminal]').click();
    document.querySelector('[data-count="4"]').click();
    document.querySelector('[data-action="launch"]').click();`);
  await until(() => js(`document.querySelectorAll('.tg-view-active .tg-pane[data-terminal-id]').length === 4`), 'four terminals');
  const pty = require('../src/main/pty_manager');
  await until(() => pty.list_terminals().length === 4 && pty.list_terminals().every((t) => t.buffer.includes('>')), 'PowerShell prompts');
  const commands = [
    'git log --oneline --decorate -n 6',
    'Get-ChildItem -Recurse -File -Name -Exclude .git* | Select-Object -First 12',
    'git status --short --branch',
    'Get-Content src\\server.ts -TotalCount 12',
  ];
  pty.list_terminals().forEach((t, i) => {
    pty.write_terminal(t.terminal_id, `function prompt { "PS demo-app> " }; Clear-Host; ${commands[i]}\r`);
  });
  await delay(2500);
  await until(() => js(`Boolean(document.querySelector('.tg-view-active .fp-row[data-path="src"]'))`), 'file tree');
  await js(`document.querySelector('.tg-view-active .fp-row[data-path="src"]').click()`);
  await until(() => js(`Boolean(document.querySelector('.tg-view-active .fp-row[data-path="src/server.ts"]'))`), 'src expanded').catch(() => {});
  await js(`const row = document.querySelector('.tg-view-active .fp-row[data-path="src/server.ts"]'); if (row) row.click();`);
  await until(() => js('Boolean(document.querySelector(".tg-view-active .tf-text"))'), 'text preview').catch(() => {});
  await shot('workbench.png');

  await js('for (const s of await window.hub.terminals.list()) await window.hub.terminals.kill(s.terminal_id)');
}

app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    run(window)
      .catch((error) => { console.error(error); process.exitCode = 1; })
      .finally(async () => {
        await require('../src/main/pty_manager').kill_all();
        app.exit(process.exitCode || 0);
      });
  });
});
setTimeout(() => { console.error('Screenshot capture timeout'); app.exit(1); }, 120000).unref();
require('../main');
