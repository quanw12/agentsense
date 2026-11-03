// Resolves a user-supplied path and refuses anything that leaves the workspace root,
// including Windows junctions and symlinks whose real target is outside that root.
const fs = require('fs');
const path = require('path');

function is_inside(root_real, target_real) {
  const rel = path.relative(root_real, target_real);
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Real path of target. Missing tail segments stay lexical, joined onto the nearest existing real parent.
function existing_realpath(target) {
  let current = path.resolve(target);
  const missing = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.push(path.basename(current));
    current = parent;
  }
  const real = fs.realpathSync.native ? fs.realpathSync.native(current) : fs.realpathSync(current);
  let joined = real;
  for (const part of missing.reverse()) joined = path.join(joined, part);
  return joined;
}

// root + relative or absolute value -> { root, rel, path } or null when the real target leaves root.
// rel is relative to the real root, using forward slashes. An empty value means the root itself.
function resolve_inside(root, value) {
  if (typeof root !== 'string' || root.trim() === '') return null;
  const root_abs = path.resolve(root);
  let root_real = null;
  try {
    root_real = existing_realpath(root_abs);
  } catch (error) {
    return null;
  }
  const lexical = !value || String(value).trim() === ''
    ? root_abs
    : path.isAbsolute(value)
      ? path.resolve(value)
      : path.resolve(root_abs, value);
  const lexical_rel = path.relative(root_abs, lexical);
  if (lexical_rel.startsWith('..') || path.isAbsolute(lexical_rel)) return null;
  let target_real = null;
  try {
    target_real = existing_realpath(lexical);
  } catch (error) {
    return null;
  }
  if (!is_inside(root_real, target_real)) return null;
  const rel = path.relative(root_real, target_real).split(path.sep).join('/');
  return { root: root_real, rel, path: target_real };
}

module.exports = { resolve_inside, is_inside, existing_realpath };
