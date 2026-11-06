// The agent kit: a Claude Code plugin shipped with the app (src/agent_kit/agentsense) that adds /agentsense:lead and
// the agentsense:worker subagent to every claude pane, whatever folder it is opened in. It is passed per pane with
// --plugin-dir, so neither the project folder nor ~/.claude is touched.
//
// The on/off choice is one JSON file in <userData>/agent_kit.json: { version: 1, enabled }. On by default.
// Nothing here may stop a pane from starting: any problem means the pane starts without the kit.
const fs = require('fs');
const path = require('path');

const FILE_NAME = 'agent_kit.json';
const FILE_VERSION = 1;
const KIT_DIR = path.join(__dirname, '..', 'agent_kit', 'agentsense');
const MANIFEST = path.join('.claude-plugin', 'plugin.json');
// These cannot be quoted safely on a cmd.exe command line (see claude_hooks.build_claude_command).
const UNSAFE_PATH = /["%\r\n]/;

function default_file_path() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), FILE_NAME);
}

function is_enabled(file_path) {
  try {
    return JSON.parse(fs.readFileSync(file_path, 'utf8')).enabled !== false;
  } catch (error) {
    return true;
  }
}

function set_enabled(file_path, enabled) {
  const value = enabled === true;
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  const tmp_path = `${file_path}.${process.pid}.tmp`;
  fs.writeFileSync(tmp_path, JSON.stringify({ version: FILE_VERSION, enabled: value }, null, 2), 'utf8');
  fs.renameSync(tmp_path, file_path);
  return value;
}

// The plugin folder when it can be used, otherwise null.
function usable_kit_dir(kit_dir) {
  if (UNSAFE_PATH.test(kit_dir)) return null;
  return fs.existsSync(path.join(kit_dir, MANIFEST)) ? kit_dir : null;
}

// What a claude pane should pass to --plugin-dir: a folder, or null to start without the kit.
function plugin_dir_for_launch(file_path, kit_dir) {
  try {
    const settings_file = file_path || default_file_path();
    return is_enabled(settings_file) ? usable_kit_dir(kit_dir || KIT_DIR) : null;
  } catch (error) {
    return null;
  }
}

module.exports = {
  default_file_path,
  is_enabled,
  set_enabled,
  usable_kit_dir,
  plugin_dir_for_launch,
  KIT_DIR,
};
