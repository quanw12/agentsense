// Builds app/ from a verified dist/win-unpacked. A stale app/ is replaced only after the
// new payload has AgentSense.exe and a manifest. Nothing is uploaded.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const root = process.cwd();
const unpacked = path.join(root, 'dist', 'win-unpacked');
const exe = path.join(unpacked, 'AgentSense.exe');
if (!existsSync(exe)) {
  console.error('dist/win-unpacked/AgentSense.exe not found. Run "npm run dist" first.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
} catch (error) {
  commit = 'unknown';
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

const stage = path.join(root, 'app.staging');
const target = path.join(root, 'app');
const previous = path.join(root, 'app.previous');
if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
cpSync(unpacked, stage, { recursive: true });
if (!existsSync(path.join(stage, 'AgentSense.exe'))) {
  rmSync(stage, { recursive: true, force: true });
  console.error('Staged payload has no AgentSense.exe. app/ was left unchanged.');
  process.exit(1);
}

const manifest = {
  name: pkg.name,
  version: pkg.version,
  commit,
  built_at: new Date().toISOString(),
  platform: 'win32-x64',
  signing: 'unsigned',
  exe_sha256: sha256(path.join(stage, 'AgentSense.exe')),
};
writeFileSync(path.join(stage, 'BUILD.json'), JSON.stringify(manifest, null, 2));
mkdirSync(path.join(root, 'dist'), { recursive: true });
writeFileSync(path.join(root, 'dist', 'BUILD.json'), JSON.stringify(manifest, null, 2));

if (existsSync(previous)) rmSync(previous, { recursive: true, force: true });
if (existsSync(target)) renameSync(target, previous);
try {
  renameSync(stage, target);
} catch (error) {
  if (existsSync(previous) && !existsSync(target)) renameSync(previous, target);
  console.error(error.message);
  process.exit(1);
}
if (existsSync(previous)) rmSync(previous, { recursive: true, force: true });
console.log(`app/ rebuilt from dist/win-unpacked (${pkg.version}, ${commit.slice(0, 12)}).`);
