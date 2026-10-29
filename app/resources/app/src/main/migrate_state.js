// One-time copy of the state file from the old userData folder (%APPDATA%\agent_hub) to the new one
// (%APPDATA%\AgentSense). Pure: takes the two directories as parameters and never touches Electron,
// so tests can run it against temp folders. The old file is copied, never moved or deleted.
const fs = require('fs');
const path = require('path');

const STATE_FILE_NAME = 'state.json';

// Returns 'copied', 'already_migrated' (new state.json exists), 'no_legacy_state' or 'failed'.
function migrate_legacy_state(new_dir, legacy_dir) {
  const new_file = path.join(new_dir, STATE_FILE_NAME);
  const legacy_file = path.join(legacy_dir, STATE_FILE_NAME);

  if (fs.existsSync(new_file)) return 'already_migrated';
  if (!fs.existsSync(legacy_file)) return 'no_legacy_state';

  try {
    fs.mkdirSync(new_dir, { recursive: true });
    // COPYFILE_EXCL: fails instead of overwriting if the new file appeared in the meantime.
    fs.copyFileSync(legacy_file, new_file, fs.constants.COPYFILE_EXCL);
    return 'copied';
  } catch (error) {
    if (error.code === 'EEXIST') return 'already_migrated';
    console.error(`state migration failed: ${error.message}`);
    return 'failed';
  }
}

module.exports = { migrate_legacy_state, STATE_FILE_NAME };
