// Packs the app icons from the brand source images:
//   assets/icon.png      (512, brand mark — the app and README logo)
//   assets/icon-256.png  (256, for the Windows .ico entry)
// Outputs:
//   build/icon.png  copy of the 512 brand mark (electron-builder, window icon)
//   build/icon.ico  single 256 PNG entry (Windows taskbar/explorer; Vista+ scales it down)
// Resize assets/icon.png to 256 (any image editor) when the brand mark changes.
// Usage: npm run icons
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/icon-256.png', import.meta.url));

// ICO: 6-byte header, one 16-byte directory entry, then the 256px PNG blob.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one entry

const dir = Buffer.alloc(16);
dir.writeUInt8(0, 0); // width (0 = 256)
dir.writeUInt8(0, 1); // height (0 = 256)
dir.writeUInt8(0, 2); // palette colors
dir.writeUInt8(0, 3); // reserved
dir.writeUInt16LE(1, 4); // color planes
dir.writeUInt16LE(32, 6); // bits per pixel
dir.writeUInt32LE(source.length, 8); // data size
dir.writeUInt32LE(22, 12); // data offset (6 + 16)

writeFileSync(new URL('../build/icon.ico', import.meta.url), Buffer.concat([header, dir, source]));
copyFileSync(new URL('../assets/icon.png', import.meta.url), new URL('../build/icon.png', import.meta.url));

console.log('build/icon.png (512) + build/icon.ico (256) written from the wolf brand mark.');
