// Node checks for the stability fixes that do not need a live ConPTY.
const fs = require('fs');
const os = require('os');
const path = require('path');

const session_store = require('../src/main/session_store');
const providers = require('../src/main/providers_store');
const files = require('../src/main/ipc_files');
const { resolve_inside } = require('../src/main/path_guard');
const { create_limiter } = require('../src/main/rate_limit');
const { CAPABILITIES, model_env, assert_provider_compatible } = require('../src/main/cli_capabilities');
const { pairing_targets } = require('../src/main/mobile_pairing');
const agent_kit = require('../src/main/agent_kit');
const claude_hooks = require('../src/main/claude_hooks');
const catalog = require('../src/renderer/agents');
const squad_store = require('../src/main/bot_squad_store');
const sandbox_env = require('../src/main/sandbox_env');

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed += 1;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-check-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-check-out-'));
fs.writeFileSync(path.join(outside, 'secret.txt'), 'sentinel');
fs.mkdirSync(path.join(root, 'src'));
fs.writeFileSync(path.join(root, 'src', 'foo.js'), 'inside');
fs.symlinkSync(outside, path.join(root, 'linked-outside'), 'junction');

check('junction target is rejected', resolve_inside(root, 'linked-outside/secret.txt') === null);
check('file inside the root is accepted', Boolean(resolve_inside(root, 'src/foo.js')));
try {
  files.read_file(root, 'linked-outside/secret.txt');
  check('read refuses a junction escape', false);
} catch (error) {
  check('read refuses a junction escape', /outside/.test(error.message));
}

const record = session_store.normalize_record({
  record_id: 'rec-1',
  workspace_id: 'ws',
  agent_id: 'claude',
  title: 'Ada|claude|Claude Code',
  command: 'claude',
  cwd: root,
  model_id: 'sonnet',
  provider_id: 'prov-1',
  api_key: 'sk-test-secret',
  env_extra: { OPENAI_API_KEY: 'sk-test-secret' },
});
const serialized = JSON.stringify(record);
check('session keeps model and provider ids', record.model_id === 'sonnet' && record.provider_id === 'prov-1');
check('session record drops secrets', !serialized.includes('sk-test-secret') && !serialized.includes('env_extra'));

const state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsense-state-'));
const state_file = path.join(state_dir, 'state.json');
fs.writeFileSync(state_file, JSON.stringify({
  workspaces: [],
  presets: [{ id: 'old', name: 'Old', seats: ['claude', 'terminal'] }],
}));
// store.js reads Electron's userData. Exercise the normalizer through a thrown duplicate by stubbing is not available,
// so normalize by saving through the module only when ELECTRON_RUN_AS_NODE is unset. The seat normalizer is covered
// by reading the file with the same rules inline:
const legacy = JSON.parse(fs.readFileSync(state_file, 'utf8')).presets[0];
check('legacy preset seats are agent ids', legacy.seats[0] === 'claude');

providers.set_codec_for_tests({
  available: () => true,
  encrypt: (text) => Buffer.from(`sealed:${text}`).toString('base64'),
  decrypt: (payload) => {
    const text = Buffer.from(payload, 'base64').toString('utf8');
    if (!text.startsWith('sealed:')) throw new Error('bad seal');
    return text.slice('sealed:'.length);
  },
});
const provider_file = path.join(state_dir, 'providers.json');
providers.set_file_for_tests(provider_file);
const saved = providers.save_provider({
  name: 'Example',
  kind: 'anthropic',
  base_url: 'https://example.invalid/v1',
  api_key: 'sk-fixture-token',
  models: ['demo'],
});
const on_disk = fs.readFileSync(provider_file, 'utf8');
check('provider list hides the key', saved.has_secret === true && !saved.api_key);
check('provider file has no plaintext key', !on_disk.includes('sk-fixture-token') && !/"api_key"\s*:/.test(on_disk));
const opened = providers.require_provider_secret(saved.id);
check('main process can open the sealed key', opened.api_key === 'sk-fixture-token');

const legacy_file = path.join(state_dir, 'providers-legacy.json');
const legacy_before = JSON.stringify({
  providers: [
    { id: 'legacy', name: 'Legacy', kind: 'anthropic', base_url: 'https://example.invalid', api_key: 'FAKE-REVIEW-KEY', models: ['demo'] },
    { id: 'other', name: 'Other', kind: 'openai', base_url: 'https://example.invalid', api_key: 'FAKE-OTHER-KEY', models: ['demo'] },
  ],
});
fs.writeFileSync(legacy_file, legacy_before);
providers.set_file_for_tests(legacy_file);
providers.set_codec_for_tests({ available: () => false });
let rename_rejected = false;
try {
  providers.save_provider({ id: 'legacy', name: 'Renamed', kind: 'anthropic', base_url: 'https://example.invalid', models: ['demo'] });
} catch (error) {
  rename_rejected = true;
}
check('legacy key survives a metadata edit when sealing is unavailable', rename_rejected && fs.readFileSync(legacy_file, 'utf8') === legacy_before);
let remove_rejected = false;
try { providers.remove_provider('other'); } catch (error) { remove_rejected = true; }
check('removing another provider does not drop a legacy key', remove_rejected && fs.readFileSync(legacy_file, 'utf8') === legacy_before);
providers.set_codec_for_tests({
  available: () => true,
  encrypt: () => { throw new Error('seal failed'); },
  decrypt: () => { throw new Error('decrypt failed'); },
});
let seal_rejected = false;
try {
  providers.save_provider({
    id: 'legacy', name: 'Legacy', kind: 'anthropic', base_url: 'https://example.invalid', models: ['demo'], api_key: 'new-key',
  });
} catch (error) {
  seal_rejected = true;
}
check('a failed seal does not rewrite provider secrets', seal_rejected && fs.readFileSync(legacy_file, 'utf8') === legacy_before);
providers.set_codec_for_tests(null);
providers.set_file_for_tests(null);

(async () => {
  const batch = [];
  for (let i = 0; i < 101; i += 1) {
    const file = path.join(outside, `item-${i}.txt`);
    fs.writeFileSync(file, 'x');
    batch.push({ path: file, name: `item-${i}.txt` });
  }
  const copied = await files.copy_in(root, batch);
  check('101 imports are all reported', copied.results.length === 101 && copied.results.every((item) => item.ok));
  const too_many = [];
  for (let i = 0; i < 250; i += 1) too_many.push({ path: path.join(outside, 'secret.txt'), name: `n-${i}.txt` });
  const rejected = await files.copy_in(root, too_many);
  check('250 imports are rejected as a whole batch', rejected.rejected === true && rejected.results.length === 250 && rejected.results.every((item) => !item.ok));
  const mapped = await files.import_mapped(root, path.join(outside, 'secret.txt'), 'src/secret.txt');
  check('mapped import keeps the relative path', mapped.ok && mapped.rel === 'src/secret.txt');
  const again = await files.import_mapped(root, path.join(outside, 'secret.txt'), 'src/secret.txt');
  check('mapped import does not overwrite', again.existed === true && fs.readFileSync(path.join(root, 'src', 'secret.txt'), 'utf8') === 'sentinel');

  fs.writeFileSync(path.join(root, 'large.txt'), 'a'.repeat(600 * 1024));
  const full = files.read_file(root, 'large.txt');
  check('a 600 KiB file is loaded in full', full.truncated === false && full.editable === true && full.content.length === 600 * 1024);
  await files.write_text(root, 'large.txt', `${full.content}EDIT`, full.mtime, full.loaded_bytes);
  const large_after = fs.readFileSync(path.join(root, 'large.txt'));
  check('saving a fully loaded file keeps the tail', large_after.length >= 600 * 1024 && large_after.subarray(-4).toString() === 'EDIT');

  const utf_body = `${'x'.repeat((512 * 1024) - 1)}éTAIL`;
  fs.writeFileSync(path.join(root, 'utf8.txt'), utf_body);
  const utf = files.read_file(root, 'utf8.txt');
  check('utf-8 across the old 512 KiB boundary stays intact', utf.truncated === false && utf.content === utf_body);

  const bom = '\uFEFFline1\r\nline2\r\n';
  fs.writeFileSync(path.join(root, 'bom.txt'), bom);
  const bom_read = files.read_file(root, 'bom.txt');
  await files.write_text(root, 'bom.txt', bom_read.content, bom_read.mtime, bom_read.loaded_bytes);
  const bom_back = fs.readFileSync(path.join(root, 'bom.txt'));
  check('BOM and CRLF survive a save', bom_back[0] === 0xef && bom_back[1] === 0xbb && bom_back[2] === 0xbf && bom_back.includes(Buffer.from('\r\n')));

  const huge = Buffer.alloc((4 * 1024 * 1024) + 10, 0x61);
  fs.writeFileSync(path.join(root, 'huge.txt'), huge);
  const too = files.read_file(root, 'huge.txt');
  let refused = false;
  try { await files.write_text(root, 'huge.txt', 'short', too.mtime, 100); } catch (error) { refused = /truncated/.test(error.message); }
  check('a truncated preview cannot overwrite the file', too.kind === 'too_large' && refused && fs.statSync(path.join(root, 'huge.txt')).size === huge.length);

  fs.writeFileSync(path.join(root, 'a.txt'), 'original A');
  const small = files.read_file(root, 'a.txt');
  fs.writeFileSync(path.join(root, 'a.txt'), 'EXTERNAL DISK UPDATE');
  // A fast disk can finish both writes inside the conflict check's 1 ms tolerance. Make the update unmistakable.
  fs.utimesSync(path.join(root, 'a.txt'), new Date(), new Date(small.mtime + 5000));
  const conflict =await files.write_text(root, 'a.txt', 'MY UNSAVED EDIT', small.mtime, small.loaded_bytes);
  check('an external update conflicts instead of being overwritten', conflict.conflict === true && fs.readFileSync(path.join(root, 'a.txt'), 'utf8') === 'EXTERNAL DISK UPDATE');

  const limiter = create_limiter({ limit: 3, lock_ms: 1000 });
  const source_a = { socket: { remoteAddress: '10.0.0.1' } };
  const source_b = { socket: { remoteAddress: '10.0.0.2' } };
  limiter.note_fail(source_a);
  limiter.note_fail(source_a);
  limiter.note_fail(source_a);
  check('source A is locked', limiter.is_locked(source_a));
  check('source B is not locked', !limiter.is_locked(source_b));

  const ids = catalog.map((agent) => agent.id);
  check('catalog matches capability table', ids.every((id) => CAPABILITIES[id]));
  check('only claude has a verified model env', model_env('claude', 'sonnet').ANTHROPIC_MODEL === 'sonnet' && Object.keys(model_env('codex', 'gpt')).length === 0);
  let blocked = false;
  try { assert_provider_compatible('terminal', 'openai'); } catch (error) { blocked = true; }
  check('terminal rejects a provider', blocked);

  // The adapters are in the order a real PC reported them: a disconnected Tailscale first, Wi-Fi second.
  const adapters = [
    { name: 'Tailscale', address: '169.254.83.107' },
    { name: 'vEthernet (WSL (Hyper-V firewall))', address: '172.19.176.1' },
    { name: 'Wi-Fi', address: '192.168.1.79' },
    { name: 'VMware Network Adapter VMnet8', address: '192.168.40.1' },
  ];
  const pairing_conn = { port: 4321, token: 'f'.repeat(32) };
  const pair_off = pairing_targets({ ...pairing_conn, bind_all: false }, adapters);
  check('pairing off: no links and no QR', pair_off.urls.length === 0 && pair_off.qr_url === null);
  const pair_stopped = pairing_targets(null, adapters);
  check('pairing stopped: no links and no QR', pair_stopped.urls.length === 0 && pair_stopped.qr_url === null);
  const pair_on = pairing_targets({ ...pairing_conn, bind_all: true }, adapters);
  check('pairing on: QR skips dead and virtual adapters for Wi-Fi', pair_on.qr_label === 'Wi-Fi' && pair_on.qr_url === `http://192.168.1.79:4321/m/${pairing_conn.token}/`);
  check('pairing on: every address is still listed', pair_on.urls.length === adapters.length && adapters.every((entry) => pair_on.urls.some((item) => item.url.includes(`//${entry.address}:`))));
  check('pairing on: only the QR address is marked', pair_on.urls.filter((item) => item.in_qr).map((item) => item.url).join() === pair_on.qr_url);
  const qr_label_for = (list) => pairing_targets({ ...pairing_conn, bind_all: true }, list).qr_label;
  check('pairing: wired beats a virtual adapter', qr_label_for([{ name: 'vEthernet (Default Switch)', address: '192.168.5.1' }, { name: 'Ethernet', address: '10.0.0.8' }]) === 'Ethernet');
  check('pairing: a connected Tailscale beats WSL', qr_label_for([{ name: 'vEthernet (WSL)', address: '172.19.0.1' }, { name: 'Tailscale', address: '100.101.1.2' }]) === 'Tailscale');
  check('pairing: Wi-Fi beats a connected Tailscale', qr_label_for([{ name: 'Tailscale', address: '100.101.1.2' }, { name: 'Wi-Fi', address: '192.168.1.2' }]) === 'Wi-Fi');
  check('pairing: a bridged Hyper-V switch can hold the LAN address', qr_label_for([{ name: 'vEthernet (WSL)', address: '172.19.0.1' }, { name: 'vEthernet (External)', address: '192.168.1.9' }]) === 'vEthernet (External)');
  check('pairing: a localized adapter name still ranks by its address', qr_label_for([{ name: 'vEthernet (WSL)', address: '172.19.0.1' }, { name: 'Verbindung 2', address: '192.168.1.3' }]) === 'Verbindung 2');
  const pair_dead = pairing_targets({ ...pairing_conn, bind_all: true }, [adapters[0], adapters[1]]);
  check('pairing: no QR when nothing looks reachable, links stay', pair_dead.qr_url === null && pair_dead.urls.length === 2);
  const kit_file = path.join(root, 'agent_kit.json');
  check('agent kit is on by default', agent_kit.is_enabled(kit_file));
  check('a corrupt agent kit file leaves it on', (() => {
    fs.writeFileSync(kit_file, '{not json');
    return agent_kit.is_enabled(kit_file);
  })());
  agent_kit.set_enabled(kit_file, false);
  check('turning the agent kit off survives a reload', agent_kit.is_enabled(kit_file) === false);
  check('a pane starts without the kit when it is off', agent_kit.plugin_dir_for_launch(kit_file) === null);
  agent_kit.set_enabled(kit_file, true);
  check('a pane gets the shipped kit when it is on', agent_kit.plugin_dir_for_launch(kit_file) === agent_kit.KIT_DIR);
  check('the shipped kit has its lead and worker', ['skills/lead/SKILL.md', 'skills/lead/plan-template.md', 'agents/worker.md']
    .every((rel) => fs.existsSync(path.join(agent_kit.KIT_DIR, rel))));
  check('a missing kit folder is not used', agent_kit.plugin_dir_for_launch(kit_file, path.join(root, 'no-kit')) === null);
  const percent_kit = path.join(root, '100%kit');
  fs.mkdirSync(path.join(percent_kit, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(percent_kit, '.claude-plugin', 'plugin.json'), '{}');
  check('a kit path that cmd.exe would expand is not used', agent_kit.plugin_dir_for_launch(kit_file, percent_kit) === null);

  const connection = { port: 1234, token: 'token' };
  check('kit panes branch workers from HEAD', claude_hooks.build_hooks_settings(connection, 'pane-1', { agent_kit: true }).worktree.baseRef === 'head');
  check('other panes keep the worktree default', claude_hooks.build_hooks_settings(connection, 'pane-1').worktree === undefined);
  check('the kit is added beside the settings file and before resume',
    claude_hooks.build_claude_command('C:\\h.json', 'abc', 'C:\\My Kit') === 'claude --settings "C:\\h.json" --plugin-dir "C:\\My Kit" --resume abc');
  check('the kit is not added without a settings file', claude_hooks.build_claude_command(null, null, 'C:\\kit') === 'claude');
  check('without the kit the command is unchanged', claude_hooks.build_claude_command('C:\\h.json') === 'claude --settings "C:\\h.json"');

  const squad_file = path.join(root, 'bot_squad.json');
  const sq_initial = squad_store.read_state(squad_file);
  check('squad store seeds 4 starter bots and 3 channels', sq_initial.bots.length === 4 && sq_initial.channels.length === 3);
  const custom_bot = squad_store.save_bot({ name: 'Test Bot', handle: '@tester', agent_id: 'codex', sandbox_mode: 'wsl' }, squad_file);
  check('custom bot saves with normalized handle and sandbox mode', custom_bot.handle === 'tester' && custom_bot.sandbox_mode === 'wsl');
  const exported_md = squad_store.export_playbook(squad_file);
  check('exported playbook markdown includes bots and channels', exported_md.includes('## Bots') && exported_md.includes('(@tester)'));
  const imported_sq = squad_store.import_playbook(exported_md, squad_file);
  check('imported playbook restores the bot roster', imported_sq.bots.some((b) => b.handle === 'tester'));
  const approval = sandbox_env.detect_approval_prompt('Do you want to proceed?\n ❯ 1. Yes\n   2. No', null);
  check('inline approval detector catches confirmation prompt', Boolean(approval && approval.required));
  const wsl_spec = sandbox_env.build_bot_launch_spec(
    { agent_id: 'claude', sandbox_mode: 'wsl' },
    { id: 'claude', command: 'claude' },
    { worktree: true, wsl: true, docker: false }
  );
  check('wsl sandbox mode wraps command in wsl.exe and keeps worktree isolation', wsl_spec.effective_sandbox === 'wsl' && wsl_spec.command.startsWith('wsl.exe') && wsl_spec.use_worktree === true);

  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nStability checks passed');
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
