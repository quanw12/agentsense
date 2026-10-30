// Mirrors dist/win-unpacked into app/, the payload folder the distribution zip
// ships (Install AgentSense.cmd copies app/ to %LOCALAPPDATA%\Programs\AgentSense).
// Run "npm run dist" first. The old app/ folder is replaced only after the new
// build is verified to contain AgentSense.exe, so a failed build never wipes it.
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const unpacked = path.join(root, 'dist', 'win-unpacked');
const exe = path.join(unpacked, 'AgentSense.exe');

if (!existsSync(exe)) {
  console.error('dist/win-unpacked/AgentSense.exe not found. Run "npm run dist" first.');
  process.exit(1);
}

const target = path.join(root, 'app');
if (existsSync(target)) {
  rmSync(target, { recursive: true, force: true });
}
cpSync(unpacked, target, { recursive: true });

console.log(`app/ rebuilt from dist/win-unpacked (${count_entries(target)} entries, AgentSense.exe present).`);

function count_entries(dir) {
  let count = 1;
  for (const dirent of readdirSync(dir)) {
    const full = path.join(dir, dirent);
    count += statSync(full).isDirectory() ? count_entries(full) : 1;
  }
  return count;
}
