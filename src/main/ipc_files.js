// ipcMain handlers for the workspace file panel.
// Every relative path is resolved and constrained to the real workspace root, so a junction
// or symlink cannot be used to read or write outside that root.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
function electron_bits() {
  return require('electron');
}

const { resolve_inside } = require('./path_guard');

const TEXT_MAX_BYTES = 1024 * 512;
const EDIT_MAX_BYTES = TEXT_MAX_BYTES * 8;
const COPY_MAX_NAME = 180;
const COPY_BATCH_MAX = 200;
const SEARCH_MAX = 200;
const DOCUMENT_MAX_BYTES = 1024 * 1024 * 40;
const WATCH_DEBOUNCE_MS = 200;

const PREVIEW_KINDS = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.bmp': 'image',
  '.ico': 'image', '.svg': 'image', '.avif': 'image',
  '.pdf': 'pdf',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.m4v': 'video', '.ogv': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.m4a': 'audio', '.flac': 'audio', '.aac': 'audio',
  '.docx': 'docx',
};
const OFFICE_EXTS = new Set([
  '.doc', '.dot', '.rtf', '.odt', '.xls', '.xlsx', '.xlsm', '.ods', '.ppt', '.pptx', '.odp', '.pages', '.numbers', '.key',
]);
const SKIP_DIR = new Set(['node_modules', '.git']);

const watches = new Map();
const copy_jobs = new Map();
let copy_serial = 0;

function require_root(root_path) {
  const resolved = resolve_inside(root_path, '');
  if (!resolved) throw new Error(`workspace folder does not exist: ${root_path}`);
  return resolved;
}

function resolve_under(root, value) {
  return resolve_inside(root, value);
}

function heavy_dir(name) {
  return SKIP_DIR.has(name);
}

async function list_dir(root_path, rel) {
  const root_info = require_root(root_path);
  const resolved = resolve_inside(root_info.path, rel || '');
  if (!resolved) throw new Error('that path is outside the workspace');
  let entries = [];
  try {
    entries = await fs.promises.readdir(resolved.path, { withFileTypes: true });
  } catch (error) {
    if (resolved.rel !== '' || error.code !== 'ENOENT') throw error;
    return [];
  }
  const items = [];
  for (const entry of entries) {
    if (heavy_dir(entry.name) && resolved.rel === '') {
      items.push({ name: entry.name, rel: entry.name, kind: 'dir', size: 0, modified: 0, skipped: true });
      continue;
    }
    const child = resolve_inside(root_info.path, path.join(resolved.path, entry.name));
    if (!child) continue;
    let stat = null;
    try { stat = await fs.promises.stat(child.path); } catch (error) { stat = null; }
    if (!stat) continue;
    items.push({
      name: entry.name,
      rel: child.rel,
      kind: stat.isDirectory() ? 'dir' : 'file',
      size: stat.isDirectory() ? 0 : stat.size,
      modified: stat.mtimeMs,
    });
  }
  items.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
  return items;
}

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

function resolve_file(root_path, rel) {
  const root_info = require_root(root_path);
  const resolved = resolve_inside(root_info.path, rel);
  if (!resolved) throw new Error('that path is outside the workspace');
  if (resolved.rel === '') throw new Error('cannot read the workspace folder itself');
  let stat = null;
  try { stat = fs.statSync(resolved.path); } catch (error) { stat = null; }
  if (!stat) throw new Error(`file not found: ${resolved.rel}`);
  if (stat.isDirectory()) throw new Error('that is a folder; open a file instead');
  return { rel: resolved.rel, path: resolved.path, stat, ext: path.extname(resolved.path).toLowerCase(), root: root_info.path };
}

function read_file(root_path, rel) {
  const resolved = resolve_file(root_path, rel);
  const stat = resolved.stat;
  const preview = PREVIEW_KINDS[resolved.ext];
  const base = { path: resolved.rel, size: stat.size, mtime: stat.mtimeMs };
  if (preview) {
    return { ...base, kind: preview, url: pathToFileURL(resolved.path).href, truncated: false, binary: true, content: '' };
  }
  if (OFFICE_EXTS.has(resolved.ext)) {
    return { ...base, kind: 'office', truncated: false, binary: true, content: '' };
  }
  if (stat.size > TEXT_MAX_BYTES * 8) {
    return { ...base, kind: 'too_large', truncated: true, too_large: true, content: '' };
  }
  if (!looks_textual(resolved.path, stat.size, resolved.ext)) {
    return { ...base, kind: 'binary', truncated: false, binary: true, content: '' };
  }
  if (stat.size <= EDIT_MAX_BYTES) {
    const buf = fs.readFileSync(resolved.path);
    const content = buf.toString('utf8');
    const utf8 = Buffer.from(content, 'utf8').equals(buf);
    return {
      ...base,
      kind: 'text',
      truncated: false,
      editable: utf8,
      readonly_reason: utf8 ? null : 'This encoding is not supported for editing. Open the file externally.',
      binary: false,
      loaded_bytes: buf.length,
      content,
    };
  }
  const handle = fs.openSync(resolved.path, 'r');
  try {
    const buf = Buffer.alloc(Math.min(TEXT_MAX_BYTES, stat.size));
    fs.readSync(handle, buf, 0, buf.length, 0);
    let end = buf.length;
    while (end > 0 && (buf[end - 1] & 0xc0) === 0x80) end -= 1;
    const preview = buf.subarray(0, end > 0 ? end : buf.length);
    return {
      ...base,
      kind: 'text',
      truncated: true,
      editable: false,
      binary: false,
      loaded_bytes: preview.length,
      content: preview.toString('utf8'),
    };
  } finally {
    fs.closeSync(handle);
  }
}

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
  const failure = await electron_bits().shell.openPath(resolved.path);
  if (failure) throw new Error(failure);
  return true;
}

function reveal(root_path, rel) {
  const resolved = resolve_file(root_path, rel);
  electron_bits().shell.showItemInFolder(resolved.path);
  return true;
}

function emit_changed(payload) {
  const { broadcast } = require('./ipc_terminals');
  broadcast('files:changed', payload);
}

// options.recursive = false watches one folder only, for a file opened from outside the workspace
// (its folder may be as large as a whole drive). A later recursive request upgrades the watch.
function watch_root(root_path, options) {
  const root_info = require_root(root_path);
  const recursive = !options || options.recursive !== false;
  const existing = watches.get(root_info.path);
  if (existing) {
    if (existing.recursive || !recursive) return { root: root_info.path };
    unwatch_root(root_info.path);
  }
  const watcher = fs.watch(root_info.path, { recursive }, (_event, filename) => {
    const name = filename ? String(filename) : '';
    if (/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(name)) return;
    const entry = watches.get(root_info.path);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      emit_changed({ root: root_info.path, rel: name.split(path.sep).join('/') });
    }, WATCH_DEBOUNCE_MS);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();
  });
  watcher.on('error', () => unwatch_root(root_info.path));
  watches.set(root_info.path, { watcher, timer: null, recursive });
  return { root: root_info.path };
}

// Never throws for a missing file or folder: an open tab asks this after any change on disk.
async function stat_file(root_path, rel) {
  const resolved = resolve_inside(root_path, rel || '');
  if (!resolved) return { exists: false };
  try {
    const stat = await fs.promises.stat(resolved.path);
    return { exists: true, is_dir: stat.isDirectory(), mtime: stat.mtimeMs, size: stat.size };
  } catch (error) {
    return { exists: false };
  }
}

function unwatch_root(root_path) {
  const resolved = resolve_inside(root_path, '') || { path: path.resolve(root_path) };
  const entry = watches.get(resolved.path);
  if (!entry) return false;
  if (entry.timer) clearTimeout(entry.timer);
  entry.watcher.close();
  watches.delete(resolved.path);
  return true;
}

function unique_destination(dir_path, base_name) {
  const clean = String(base_name || '').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, COPY_MAX_NAME) || 'file';
  let candidate = clean;
  let index = 1;
  while (fs.existsSync(path.join(dir_path, candidate))) {
    const dot = clean.lastIndexOf('.');
    const stem = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : '';
    candidate = `${stem} (${index})${ext}`;
    index += 1;
    if (index > 1000) throw new Error('too many name collisions');
  }
  return path.join(dir_path, candidate);
}

function reject_batch(list, message) {
  return {
    rejected: true,
    results: list.map((source, index) => ({
      ok: false,
      index,
      name: source && (source.name || source.path) ? path.basename(String(source.name || source.path)) : '(unknown)',
      message,
    })),
  };
}

async function copy_in(root_path, sources, options) {
  const root_info = require_root(root_path);
  const list = Array.isArray(sources) ? sources : [];
  const job_id = `copy-${++copy_serial}`;
  const job = { cancelled: false };
  copy_jobs.set(job_id, job);
  const stage = path.join(root_info.path, '.agentsense-import');
  try {
    if (list.length > COPY_BATCH_MAX) {
      return { ...reject_batch(list, `batch rejected before copy: ${list.length} items exceeds ${COPY_BATCH_MAX}`), root: root_info.path, job_id };
    }
    if (list.length === 0) return { results: [], root: root_info.path, rejected: false, job_id };
    await fs.promises.mkdir(stage, { recursive: true });
    const stage_real = resolve_inside(root_info.path, stage);
    if (!stage_real) throw new Error('import folder escaped the workspace');
    const results = [];
    for (let index = 0; index < list.length; index += 1) {
      const source = list[index];
      if (job.cancelled) {
        results.push({ ok: false, index, name: source && source.name ? source.name : '(cancelled)', message: 'cancelled' });
        continue;
      }
      if (!source || typeof source.path !== 'string' || source.path.trim() === '') {
        results.push({ ok: false, index, name: '(unknown)', message: 'no path given' });
        continue;
      }
      const from = path.resolve(source.path);
      let from_stat = null;
      try { from_stat = await fs.promises.stat(from); } catch (error) { from_stat = null; }
      if (!from_stat) {
        results.push({ ok: false, index, name: source.name || path.basename(from), message: 'source not found' });
        continue;
      }
      const destination = unique_destination(stage_real.path, path.basename(from));
      const dest_real = resolve_inside(root_info.path, destination);
      if (!dest_real) {
        results.push({ ok: false, index, name: path.basename(from), message: 'destination left the workspace' });
        continue;
      }
      try {
        if (from_stat.isDirectory()) await fs.promises.cp(from, dest_real.path, { recursive: true });
        else await fs.promises.copyFile(from, dest_real.path);
        results.push({ ok: true, index, name: path.basename(dest_real.path), rel: dest_real.rel, message: '' });
      } catch (error) {
        results.push({ ok: false, index, name: path.basename(from), message: error.message });
      }
    }
    return { results, root: root_info.path, rejected: false, job_id };
  } finally {
    copy_jobs.delete(job_id);
  }
}

function cancel_copy(job_id) {
  const job = copy_jobs.get(job_id);
  if (!job) return false;
  job.cancelled = true;
  return true;
}

// Copies one source to root/rel when that file is absent. Never overwrites.
async function import_mapped(root_path, source_path, rel) {
  const root_info = require_root(root_path);
  if (typeof rel !== 'string' || rel.trim() === '' || rel.split(/[\\/]/).includes('..')) {
    throw new Error('mapped path is not inside the workspace');
  }
  const destination = resolve_inside(root_info.path, rel);
  if (!destination || destination.rel === '') throw new Error('mapped path is not inside the workspace');
  if (fs.existsSync(destination.path)) {
    return { ok: false, existed: true, rel: destination.rel, message: 'target already exists; not overwritten' };
  }
  await fs.promises.mkdir(path.dirname(destination.path), { recursive: true });
  await fs.promises.copyFile(source_path, destination.path);
  const after = resolve_inside(root_info.path, destination.rel);
  if (!after) {
    await fs.promises.rm(destination.path, { force: true }).catch(() => null);
    throw new Error('mapped copy left the workspace');
  }
  return { ok: true, existed: false, rel: after.rel, message: '' };
}

async function write_text(root_path, rel, content, expected_mtime, loaded_bytes) {
  if (typeof content !== 'string') throw new Error('content must be text');
  if (Buffer.byteLength(content, 'utf8') > EDIT_MAX_BYTES) throw new Error('file is too large to save here');
  const root_info = require_root(root_path);
  const destination = resolve_inside(root_info.path, rel);
  if (!destination || destination.rel === '') throw new Error('that path is outside the workspace');
  let current = null;
  try { current = await fs.promises.stat(destination.path); } catch (error) { current = null; }
  if (current && current.isDirectory()) throw new Error('that is a folder');
  // The editor loaded this file, so its absence means it was deleted. Saving must not bring it back.
  if (!current && expected_mtime != null) return { conflict: true, deleted: true, mtime: null, content: '' };
  if (current && expected_mtime != null && Number.isFinite(Number(expected_mtime))) {
    if (Math.abs(current.mtimeMs - Number(expected_mtime)) > 1) {
      const disk = await fs.promises.readFile(destination.path);
      return {
        conflict: true,
        mtime: current.mtimeMs,
        content: disk.subarray(0, TEXT_MAX_BYTES).toString('utf8'),
      };
    }
  }
  if (!current) {
    const parent = resolve_inside(root_info.path, path.dirname(destination.path));
    if (!parent) throw new Error('that path is outside the workspace');
    await fs.promises.mkdir(parent.path, { recursive: true });
  }
  const loaded = Number(loaded_bytes);
  if (current && Number.isFinite(loaded) && loaded + 1 < current.size) {
    throw new Error('refusing to overwrite a file from a truncated preview');
  }
  await fs.promises.writeFile(destination.path, content, 'utf8');
  const stat = await fs.promises.stat(destination.path);
  return { ok: true, conflict: false, mtime: stat.mtimeMs, size: stat.size, rel: destination.rel };
}

async function search_files(root_path, query) {
  const root_info = require_root(root_path);
  const needle = String(query || '').trim().toLowerCase();
  const found = [];
  async function walk(dir, rel) {
    if (found.length >= SEARCH_MAX) return;
    let entries = [];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (error) { return; }
    for (const entry of entries) {
      if (found.length >= SEARCH_MAX) return;
      if (heavy_dir(entry.name)) continue;
      const child_rel = rel ? `${rel}/${entry.name}` : entry.name;
      const child = resolve_inside(root_info.path, path.join(dir, entry.name));
      if (!child) continue;
      if (entry.isDirectory()) await walk(child.path, child.rel);
      else if (!needle || entry.name.toLowerCase().includes(needle) || child.rel.toLowerCase().includes(needle)) {
        found.push({ name: entry.name, rel: child.rel });
      }
    }
  }
  await walk(root_info.path, '');
  return { results: found, truncated: found.length >= SEARCH_MAX };
}

function register_file_ipc() {
  const { ipcMain, dialog, BrowserWindow } = electron_bits();
  ipcMain.handle('files:pick', async (event, root_path) => {
    const root = require_root(root_path);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = { title: 'Open files in this page', defaultPath: root.path, properties: ['openFile', 'multiSelections'] };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('files:list', (_event, root_path, rel) => list_dir(root_path, rel));
  ipcMain.handle('files:read', (_event, root_path, rel) => read_file(root_path, rel));
  ipcMain.handle('files:write', (_event, root_path, rel, content, expected_mtime, loaded_bytes) => write_text(root_path, rel, content, expected_mtime, loaded_bytes));
  ipcMain.handle('files:search', (_event, root_path, query) => search_files(root_path, query));
  ipcMain.handle('files:watch', (_event, root_path, options) => watch_root(root_path, options));
  ipcMain.handle('files:stat', (_event, root_path, rel) => stat_file(root_path, rel));
  ipcMain.handle('files:unwatch', (_event, root_path) => unwatch_root(root_path));
  ipcMain.handle('files:render_document', (_event, root_path, rel) => render_document(root_path, rel));
  ipcMain.handle('files:open_external', (_event, root_path, rel) => open_external(root_path, rel));
  ipcMain.handle('files:reveal', (_event, root_path, rel) => reveal(root_path, rel));
  ipcMain.handle('files:copy_in', (_event, root_path, sources) => copy_in(root_path, sources));
  ipcMain.handle('files:cancel_copy', (_event, job_id) => cancel_copy(job_id));
  ipcMain.handle('files:import_mapped', (_event, root_path, source_path, rel) => import_mapped(root_path, source_path, rel));
}

module.exports = {
  register_file_ipc,
  list_dir,
  read_file,
  write_text,
  stat_file,
  search_files,
  copy_in,
  import_mapped,
  resolve_under,
  watch_root,
  unwatch_root,
  cancel_copy,
  COPY_BATCH_MAX,
};
