// Workspace and preset persistence: a JSON file in app.getPath('userData').
// Shape: { workspaces: [{ id, name, path }], presets: [{ id, name, seats: [agent_id, ...] }] }
// Files written before presets existed have no `presets` key and still load.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { app } = require('electron');

const MAX_SEATS = 6;
const MAX_PRESET_NAME_LENGTH = 40;

function state_file_path() {
  return path.join(app.getPath('userData'), 'state.json');
}

// Keeps only well-formed presets, so a hand-edited file cannot break the dialog.
function normalize_presets(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((preset) => preset && typeof preset.id === 'string' && typeof preset.name === 'string' && Array.isArray(preset.seats))
    .map((preset) => ({
      id: preset.id,
      name: preset.name,
      seats: preset.seats
        .filter((seat) => typeof seat === 'string' && seat.trim() !== '')
        .slice(0, MAX_SEATS),
    }));
}

// A corrupt state file is moved aside, not overwritten, so nothing is lost silently.
function read_state() {
  const file_path = state_file_path();
  let raw = null;
  try {
    raw = fs.readFileSync(file_path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { workspaces: [], presets: [] };
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    const workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces : [];
    const presets = normalize_presets(parsed.presets);
    return { workspaces, presets };
  } catch (error) {
    const aside_path = `${file_path}.corrupt-${Date.now()}`;
    fs.renameSync(file_path, aside_path);
    console.error(`state.json was unreadable, moved to ${aside_path}`);
    return { workspaces: [], presets: [] };
  }
}

function write_state(state) {
  const file_path = state_file_path();
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  const payload = { workspaces: state.workspaces, presets: state.presets || [] };
  const tmp_path = `${file_path}.tmp`;
  fs.writeFileSync(tmp_path, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp_path, file_path);
}

function same_path(left, right) {
  if (process.platform === 'win32') {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

function list_workspaces() {
  return read_state().workspaces;
}

function add_workspace(folder_path) {
  if (typeof folder_path !== 'string' || folder_path.trim() === '') {
    throw new Error('folder_path is required');
  }
  const resolved = path.resolve(folder_path);
  let stat = null;
  try {
    stat = fs.statSync(resolved);
  } catch (error) {
    throw new Error(`folder does not exist: ${resolved}`);
  }
  if (!stat.isDirectory()) throw new Error(`not a folder: ${resolved}`);

  const state = read_state();
  const existing = state.workspaces.find((workspace) => same_path(workspace.path, resolved));
  if (existing) return existing;

  const workspace = {
    id: crypto.randomUUID(),
    name: path.basename(resolved) || resolved,
    path: resolved,
  };
  state.workspaces.push(workspace);
  write_state(state);
  return workspace;
}

function remove_workspace(workspace_id) {
  const state = read_state();
  const remaining = state.workspaces.filter((workspace) => workspace.id !== workspace_id);
  if (remaining.length !== state.workspaces.length) {
    write_state({ workspaces: remaining, presets: state.presets });
  }
}

function list_presets() {
  return read_state().presets;
}

// Seats are agent ids. They are not checked against the catalog here: a preset may name an
// agent that was removed from the catalog, and the dialog skips such seats when applying it.
function validate_seats(seats) {
  if (!Array.isArray(seats) || seats.length < 1 || seats.length > MAX_SEATS) {
    throw new Error(`seats must be an array of 1 to ${MAX_SEATS} agent ids`);
  }
  return seats.map((seat, index) => {
    if (typeof seat !== 'string' || seat.trim() === '') {
      throw new Error(`seat ${index + 1} must be a non-empty agent id`);
    }
    return seat.trim();
  });
}

// Without `id` a new preset is created. With an existing `id` that preset is overwritten.
function save_preset(preset) {
  if (!preset || typeof preset !== 'object') {
    throw new Error('preset must be an object with name and seats');
  }
  if (typeof preset.name !== 'string' || preset.name.trim() === '') {
    throw new Error('preset name is required');
  }
  const name = preset.name.trim().slice(0, MAX_PRESET_NAME_LENGTH).trim();
  const seats = validate_seats(preset.seats);

  const state = read_state();
  const preset_id = preset.id === undefined || preset.id === null ? null : preset.id;
  if (preset_id !== null && (typeof preset_id !== 'string' || preset_id.trim() === '')) {
    throw new Error('preset id must be a non-empty string');
  }

  if (preset_id === null) {
    const created = { id: crypto.randomUUID(), name, seats };
    state.presets.push(created);
    write_state(state);
    return created;
  }

  const index = state.presets.findIndex((item) => item.id === preset_id);
  if (index === -1) throw new Error(`preset not found: ${preset_id}`);
  const updated = { id: preset_id, name, seats };
  state.presets[index] = updated;
  write_state(state);
  return updated;
}

function remove_preset(preset_id) {
  const state = read_state();
  const remaining = state.presets.filter((preset) => preset.id !== preset_id);
  if (remaining.length !== state.presets.length) {
    write_state({ workspaces: state.workspaces, presets: remaining });
  }
}

module.exports = {
  list_workspaces,
  add_workspace,
  remove_workspace,
  list_presets,
  save_preset,
  remove_preset,
  state_file_path,
};
