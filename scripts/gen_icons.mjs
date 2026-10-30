// Renders assets/logo.svg into the app icons:
//   build/icon.png  512x512 (electron-builder, window icon)
//   build/icon.ico  multi-size (Windows taskbar/explorer, referenced by electron-builder)
// The .ico embeds standard PNG entries (Vista+ format), so no external ico tool is needed.
// Usage: npm run icons
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const svg = readFileSync(new URL('../assets/logo.svg', import.meta.url), 'utf8');

function render(size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  });
  return resvg.render().asPng();
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = new Map(sizes.map((s) => [s, render(s)]));

mkdirSync(new URL('../build', import.meta.url), { recursive: true });
writeFileSync(new URL('../build/icon.png', import.meta.url), render(512));

// ICO: 6-byte header, one 16-byte directory entry per size, then the PNG blobs.
const entries = sizes.map((s) => ({ size: s, png: pngs.get(s) }));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(entries.length, 4);

const dir = Buffer.alloc(entries.length * 16);
let offset = header.length + dir.length;
entries.forEach((entry, i) => {
  const base = i * 16;
  dir.writeUInt8(entry.size === 256 ? 0 : entry.size, base + 0); // width (0 = 256)
  dir.writeUInt8(entry.size === 256 ? 0 : entry.size, base + 1); // height
  dir.writeUInt8(0, base + 2); // palette colors
  dir.writeUInt8(0, base + 3); // reserved
  dir.writeUInt16LE(1, base + 4); // color planes
  dir.writeUInt16LE(32, base + 6); // bits per pixel
  dir.writeUInt32LE(entry.png.length, base + 8); // data size
  dir.writeUInt32LE(offset, base + 12); // data offset
  offset += entry.png.length;
});

const ico = Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
writeFileSync(new URL('../build/icon.ico', import.meta.url), ico);

console.log(`build/icon.png (512) + build/icon.ico (${sizes.join(', ')}) written.`);
