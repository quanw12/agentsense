// Synchronizes main.js, preload.js and src/ into app/resources/app/ and refreshes app/BUILD.json checksums
// so app/AgentSense.exe and install.ps1 can run and verify the updated payload without downloading electron-builder.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app_dir = path.join(root, 'app');
const res_app = path.join(app_dir, 'resources', 'app');

if (!existsSync(path.join(app_dir, 'AgentSense.exe'))) {
  console.error('app/AgentSense.exe not found');
  process.exit(1);
}

cpSync(path.join(root, 'main.js'), path.join(res_app, 'main.js'));
cpSync(path.join(root, 'preload.js'), path.join(res_app, 'preload.js'));
rmSync(path.join(res_app, 'src'), { recursive: true, force: true });
cpSync(path.join(root, 'src'), path.join(res_app, 'src'), { recursive: true });

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function list_files(base_dir, rel_dir) {
  return readdirSync(path.join(base_dir, rel_dir), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const rel = `${rel_dir}/${entry.name}`;
      return entry.isDirectory() ? list_files(base_dir, rel) : [rel];
    });
}

const build_json_path = path.join(app_dir, 'BUILD.json');
const manifest = JSON.parse(readFileSync(build_json_path, 'utf8'));

// Keep existing node_modules hashes from manifest, update main.js, preload.js, build/icon.png, and all src/ files
const next_hashes = {};
for (const rel of ['main.js', 'preload.js', 'build/icon.png', ...list_files(res_app, 'src')]) {
  next_hashes[rel] = sha256(path.join(res_app, rel));
}
for (const [key, val] of Object.entries(manifest.source_hashes || {})) {
  if (key.startsWith('node_modules/')) {
    next_hashes[key] = val;
  }
}
manifest.source_hashes = next_hashes;
manifest.built_at = new Date().toISOString();
writeFileSync(build_json_path, JSON.stringify(manifest, null, 2));
console.log(`Synced main.js, preload.js, and src/ into app/resources/app/ (${Object.keys(next_hashes).length} hashed files).`);
