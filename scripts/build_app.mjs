// Rebuilds from source, verifies the payload, then stages and swaps app/.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A single command always rebuilds. An existing exe is not evidence of freshness.
execFileSync(process.execPath, [path.join(root, 'node_modules/electron-builder/cli.js'), '--win', '--dir'], {
  cwd: root, stdio: 'inherit', windowsHide: true,
});
const unpacked = path.join(root, 'dist', 'win-unpacked');
const exe = path.join(unpacked, 'AgentSense.exe');
if (!existsSync(exe)) {
  console.error('dist/win-unpacked/AgentSense.exe not found. Run "npm run dist" first.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
let commit = 'unknown';
let source_dirty = true;
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  source_dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim() !== '';
} catch (error) {
  commit = 'unknown';
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function source_paths(dir) {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Source links must be resolved before packaging: ${rel}`);
    return entry.isDirectory() ? source_paths(rel) : [rel];
  });
}
function native_runtime_paths(dir) {
  // Debug/linker artifacts are intentionally omitted by electron-builder.
  return source_paths(dir).filter(rel => /\.(node|dll|exe)$/i.test(rel));
}

const source_hashes = {};
for (const rel of ['main.js', 'preload.js', 'build/icon.png', ...source_paths('src'),
  ...source_paths('node_modules/node-pty/lib'), ...native_runtime_paths('node_modules/node-pty/prebuilds/win32-x64'),
  ...(existsSync(path.join(root, 'node_modules/node-pty/build/Release')) ? native_runtime_paths('node_modules/node-pty/build/Release') : [])]) {
  const source_hash = sha256(path.join(root, rel));
  if (sha256(path.join(unpacked, 'resources/app', rel)) !== source_hash) {
    throw new Error(`Packaged file differs from source: ${rel}`);
  }
  source_hashes[rel] = source_hash;
}
const packed_pkg = JSON.parse(readFileSync(path.join(unpacked, 'resources/app/package.json'), 'utf8'));
if (packed_pkg.version !== pkg.version || packed_pkg.main !== pkg.main) throw new Error('Packaged application metadata differs from source');
const dependencies = {};
for (const dependency of Object.keys(pkg.dependencies)) {
  const installed = JSON.parse(readFileSync(path.join(root, 'node_modules', dependency, 'package.json'), 'utf8')).version;
  const packed = JSON.parse(readFileSync(path.join(unpacked, 'resources/app/node_modules', dependency, 'package.json'), 'utf8')).version;
  if (installed !== packed) throw new Error(`Packaged dependency differs from tested installation: ${dependency}`);
  dependencies[dependency] = packed;
}
// electron-builder normalizes dependency package.json (removes dev metadata).
// Verify its version above, then record the checksum of the installed metadata.
source_hashes['node_modules/node-pty/package.json'] = sha256(path.join(unpacked, 'resources/app/node_modules/node-pty/package.json'));

function assert_owned_dir(candidate) {
  const relative = path.relative(root, path.resolve(candidate));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Unsafe build target: ${candidate}`);
}
async function rename_owned(from, to) {
  assert_owned_dir(from);
  assert_owned_dir(to);
  // Windows antivirus/indexing can briefly lock a newly copied native payload.
  // Retry only sharing/permission errors, with a bounded budget; rollback still
  // runs if the lock belongs to a running application and does not clear.
  for (let attempt = 0; ; attempt++) {
    try { renameSync(from, to); return; }
    catch (error) {
      if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 50 * (2 ** attempt)));
    }
  }
}

const stage = path.join(root, 'app.staging');
const target = path.join(root, 'app');
const previous = path.join(root, 'app.previous');
for (const dir of [stage, target, previous]) assert_owned_dir(dir);
if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
// Separate the recursive copier's lifetime from the swap. On Windows a copy
// process can retain directory handles until it exits, preventing the rename.
execFileSync(process.execPath, ['-e', "require('node:fs').cpSync(process.argv[1], process.argv[2], {recursive:true});", unpacked, stage], {
  cwd: root, stdio: 'inherit', windowsHide: true,
});
if (!existsSync(path.join(stage, 'AgentSense.exe'))) {
  rmSync(stage, { recursive: true, force: true });
  console.error('Staged payload has no AgentSense.exe. app/ was left unchanged.');
  process.exit(1);
}

const manifest = {
  name: pkg.name,
  version: pkg.version,
  commit,
  source_dirty,
  source_hashes,
  dependencies,
  built_at: new Date().toISOString(),
  platform: 'win32-x64',
  signing: 'unsigned',
  exe_sha256: sha256(path.join(stage, 'AgentSense.exe')),
};
writeFileSync(path.join(stage, 'BUILD.json'), JSON.stringify(manifest, null, 2));
mkdirSync(path.join(root, 'dist'), { recursive: true });
writeFileSync(path.join(root, 'dist', 'BUILD.json'), JSON.stringify(manifest, null, 2));

if (existsSync(previous)) rmSync(previous, { recursive: true, force: true });
if (existsSync(target)) await rename_owned(target, previous);
try {
  await rename_owned(stage, target);
} catch (error) {
  if (existsSync(previous) && !existsSync(target)) await rename_owned(previous, target);
  console.error(error.message);
  process.exit(1);
}
if (existsSync(previous)) rmSync(previous, { recursive: true, force: true });
console.log(`app/ rebuilt from dist/win-unpacked (${pkg.version}, ${commit.slice(0, 12)}).`);
