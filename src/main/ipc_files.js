// ipcMain handlers for the workspace file panel:
//  files:list(root_path, rel)         - one folder level of entries
//  files:read(root_path, rel, limit)  - what the viewer shows: text content, or a file URL for previews
//  files:render_document(root, rel)   - a .docx converted to HTML for the viewer
//  files:open_external(root, rel)     - opens the file with its default app
//  files:reveal(root, rel)            - shows the file in File Explorer
//  files:copy_in(root_path, sources)  - copies files/dropped folders from the OS into the workspace
// Every relative path is resolved and constrained to root_path, so the page cannot escape the workspace.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { ipcMain, shell } = require('electron');

const TEXT_MAX_BYTES = 1024 * 512; // the viewer shows at most this much of a file
const COPY_MAX_NAME = 180;
const COPY_MAX_ITEMS = 100;
const DOCUMENT_MAX_BYTES = 1024 * 1024 * 40; // larger .docx files are not converted

// Files the viewer previews natively (the renderer loads them by file URL).
const PREVIEW_KINDS = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.bmp': 'image',
  '.ico': 'image', '.svg': 'image', '.avif': 'image',
  '.pdf': 'pdf',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.m4v': 'video', '.ogv': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.m4a': 'audio', '.flac': 'audio', '.aac': 'audio',
  '.docx': 'docx',
};
// Office formats without a built-in preview: the viewer offers "Open with default app".
const OFFICE_EXTS = new Set([
  '.doc', '.dot', '.rtf', '.odt', '.xls', '.xlsx', '.xlsm', '.ods', '.ppt', '.pptx', '.odp', '.pages', '.numbers', '.key',
]);

function to_rel(root, target) {
  const rel = path.relative(root, target);
  if (rel === '') return '';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

function is_within(root, target) {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Inside(root, rel or absolute) -> { root, rel, path } or null.
// An absolute target that lives under root is accepted (re-attaching keeps absolute paths simple).
function resolve_under(root, value) {
  if (typeof value !== 'string' || value.trim() === '') return { root, rel: '', path: root };
  const target = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
  if (!target.toLowerCase().startsWith(root.toLowerCase())) return null;
  const rel = to_rel(root, target);
  if (rel === null) return null;
  return { root, rel, path: target };
}

function entry_stat(entry_path) {
  try {
    return fs.statSync(entry_path);
  } catch (error) {
    return null;
  }
}

function list_dir(root_path, rel) {
  const root = path.resolve(root_path);
  const root_stat = entry_stat(root);
  if (!root_stat || !root_stat.isDirectory()) throw new Error(`workspace folder does not exist: ${root}`);
  const resolved = resolve_under(root, rel);
  if (!resolved) throw new Error('that path is outside the workspace');
  let entries = null;
  try {
    entries = fs.readdirSync(resolved.path, { withFileTypes: true });
  } catch (error) {
    if (resolved.rel !== '' || error.code !== 'ENOENT') throw error;
    return [];
  }
  const items = [];
  for (const entry of entries) {
    const item_path = path.join(resolved.path, entry.name);
    if (!is_within(root, item_path)) continue;
    const stat = entry_stat(item_path);
    if (!stat) continue; // vanished or unreadable; skip quietly
    items.push({
      name: entry.name,
      rel: to_rel(root, item_path),
      kind: stat.isDirectory() ? 'dir' : 'file',
      size: stat.isDirectory() ? 0 : stat.size,
      modified: stat.mtimeMs,
    });
  }
  // Folders first, then files; both alphabetical without case tricks.
  items.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1
  );
  return items;
}

// Guesses text vs binary by extension and a quick zero-byte-head scan.
function looks_textual(file_path, size, ext) {
  const binary_exts = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.exe', '.dll', '.zip', '.gz',
    '.7z', '.rar', '.pdf', '.mp3', '.mp4', '.avi', '.mov', '.wav', '.woff', '.woff2', '.ttf',
    '.otf', '.eot', '.pdb', '.bin', '.so', '.dylib', '.pak', '.asar',
  ]);
  for (const office of OFFICE_EXTS) binary_exts.add(office);
  if (binary_exts.has(ext)) return false;
  if (size === 0) return true;
  const probe = fs.openSync(file_path, 'r');
  try {
    const buf = Buffer.alloc(Math.min(4096, size));
    fs.readSync(probe, buf, 0, buf.length, 0);
    return !buf.includes(0);
  } finally {
    fs.closeSync(probe);
  }
}

// One existing file under root (never a folder) -> { rel, path, stat, ext }.
function resolve_file(root_path, rel) {
  const root = path.resolve(root_path);
  const resolved = resolve_under(root, rel);
  if (!resolved) throw new Error('that path is outside the workspace');
  if (resolved.rel === '') throw new Error('cannot read the workspace folder itself');
  const stat = entry_stat(resolved.path);
  if (!stat) throw new Error(`file not found: ${resolved.rel}`);
  if (stat.isDirectory()) throw new Error('that is a folder; open a file instead');
  return { rel: resolved.rel, path: resolved.path, stat, ext: path.extname(resolved.path).toLowerCase() };
}

// kind: 'text' | 'image' | 'pdf' | 'video' | 'audio' | 'docx' | 'office' | 'binary' | 'too_large'.
// Previewable kinds carry url (a file:// URL); text carries content.
function read_file(root_path, rel, limit) {
  const resolved = resolve_file(root_path, rel);
  const stat = resolved.stat;
  const preview = PREVIEW_KINDS[resolved.ext];
  if (preview) {
    return {
      path: resolved.rel,
      kind: preview,
      url: pathToFileURL(resolved.path).href,
      truncated: false,
      binary: true,
      size: stat.size,
      content: '',
    };
  }
  if (OFFICE_EXTS.has(resolved.ext)) {
    return { path: resolved.rel, kind: 'office', truncated: false, binary: true, size: stat.size, content: '' };
  }
  if (stat.size > TEXT_MAX_BYTES * 8) {
    return { path: resolved.rel, kind: 'too_large', truncated: true, too_large: true, size: stat.size, content: '' };
  }
  if (!looks_textual(resolved.path, stat.size, resolved.ext)) {
    return { path: resolved.rel, kind: 'binary', truncated: false, binary: true, size: stat.size, content: '' };
  }
  const handle = fs.openSync(resolved.path, 'r');
  try {
    const buf = Buffer.alloc(Math.min(TEXT_MAX_BYTES, stat.size));
    fs.readSync(handle, buf, 0, buf.length, 0);
    return {
      path: resolved.rel,
      kind: 'text',
      truncated: stat.size > buf.length,
      binary: false,
      size: stat.size,
      content: buf.toString('utf8'),
    };
  } finally {
    fs.closeSync(handle);
  }
}

// mammoth is loaded on first use, so the app starts without it.
async function render_document(root_path, rel) {
  const resolved = resolve_file(root_path, rel);
  if (resolved.ext !== '.docx') throw new Error('only .docx documents can be previewed');
  if (resolved.stat.size > DOCUMENT_MAX_BYTES) throw new Error('the document is too large to preview');
  const mammoth = require('mammoth');
  const result = await mammoth.convertToHtml({ path: resolved.path });
  return { html: result.value, warnings: result.messages.length };
}

async function open_external(root_path, rel) {
  const resolved = resolve_file(root_path, rel);
  const failure = await shell.openPath(resolved.path);
  if (failure) throw new Error(failure);
  return true;
}

function reveal(root_path, rel) {
  const resolved = resolve_file(root_path, rel);
  shell.showItemInFolder(resolved.path);
  return true;
}

// A dropped absolute path is only copied when the source exists; the copy keeps the top-level name
// and never overwrites silently: "name", "name (1)", "name (2)"...
function unique_destination(dir_path, base_name) {
  const clean = String(base_name || '').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, COPY_MAX_NAME) || 'file';
  let candidate = clean;
  let index = 1;
  while (entry_stat(path.join(dir_path, candidate))) {
    const dot = clean.lastIndexOf('.');
    const stem = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : '';
    candidate = `${stem} (${index})${ext}`;
    index += 1;
  }
  return path.join(dir_path, candidate);
}

// sources: [{ path: absolute OS path, name? }]. Returns per-item outcomes for the UI banner.
function copy_in(root_path, sources) {
  const root = path.resolve(root_path);
  const root_stat = entry_stat(root);
  if (!root_stat || !root_stat.isDirectory()) throw new Error(`workspace folder does not exist: ${root}`);
  const list = Array.isArray(sources) ? sources.slice(0, COPY_MAX_ITEMS) : [];
  const results = [];
  for (const source of list) {
    if (!source || typeof source.path !== 'string' || source.path.trim() === '') {
      results.push({ ok: false, name: '(unknown)', message: 'no path given' });
      continue;
    }
    const from = path.resolve(source.path);
    const from_stat = entry_stat(from);
    if (!from_stat) {
      results.push({ ok: false, name: source.name || from, message: 'source not found' });
      continue;
    }
    const destination = unique_destination(root, path.basename(from));
    try {
      if (from_stat.isDirectory()) {
        fs.cpSync(from, destination, { recursive: true });
      } else {
        fs.copyFileSync(from, destination);
      }
      results.push({ ok: true, name: path.basename(destination), message: '' });
    } catch (error) {
      results.push({ ok: false, name: path.basename(from), message: error.message });
    }
  }
  return { results, root };
}

function register_file_ipc() {
  ipcMain.handle('files:list', (_event, root_path, rel) => list_dir(root_path, rel));
  ipcMain.handle('files:read', (_event, root_path, rel, limit) => read_file(root_path, rel, limit));
  ipcMain.handle('files:render_document', (_event, root_path, rel) => render_document(root_path, rel));
  ipcMain.handle('files:open_external', (_event, root_path, rel) => open_external(root_path, rel));
  ipcMain.handle('files:reveal', (_event, root_path, rel) => reveal(root_path, rel));
  ipcMain.handle('files:copy_in', (_event, root_path, sources) => copy_in(root_path, sources));
}

module.exports = { register_file_ipc, list_dir, read_file, render_document, copy_in, resolve_under };
