// Starts an agent pane on behalf of a remote client (the phone page or the Telegram bot).
// The client picks only a workspace id and an agent id. The folder and the command line come from
// state.json and the agent catalog, so a remote client never supplies a path or a command.
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_TITLE_LENGTH = 60;

// The pane's name, agent id and agent label travel in the title field (same format as the renderer:
// name|agent_id|agent_label), so identity survives a re-attach on either side.
function clean_part(value) {
  return String(value === undefined || value === null ? '' : value).replace(/\|/g, '/').trim();
}

function encode_title(name, agent_id, agent_label) {
  return [clean_part(name), clean_part(agent_id), clean_part(agent_label)].join('|');
}

// Resolves with the new pane's info (with its replay buffer). Rejects with a message fit to show the user.
// deps: { list_workspaces, catalog, check_commands, pty }
async function create_agent_pane(deps, request) {
  const workspace_id = typeof request.workspace_id === 'string' ? request.workspace_id : '';
  const agent_id = typeof request.agent_id === 'string' ? request.agent_id.trim().toLowerCase() : '';
  let workspace = null;
  try {
    workspace = deps.list_workspaces().find((item) => item && item.id === workspace_id) || null;
  } catch (error) {
    throw new Error('could not read the workspace list');
  }
  if (!workspace) throw new Error('unknown workspace');
  const agent = deps.catalog.find((item) => item && item.id === agent_id) || null;
  if (!agent || typeof agent.command !== 'string' || agent.command.trim() === '') {
    throw new Error('unknown agent');
  }
  const available = await deps.check_commands([agent.command]).catch(() => ({}));
  if (!available[agent.command]) throw new Error(`${agent.label} is not installed on the desktop`);
  const command =
    typeof agent.launch_command === 'string' && agent.launch_command.trim() !== '' ? agent.launch_command : agent.command;
  const name =
    typeof request.title === 'string' && request.title.trim() !== '' ? request.title.trim().slice(0, MAX_TITLE_LENGTH) : agent.label;

  let created = null;
  try {
    created = await deps.pty.create_terminal({
      workspace_id,
      agent_id: agent.id,
      cwd: workspace.path,
      command,
      title: encode_title(name, agent.id, agent.label),
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
    });
  } catch (error) {
    throw new Error(`could not start ${agent.label}: ${error && error.message ? error.message : error}`);
  }
  const info = deps.pty.list_terminals().find((item) => item.terminal_id === created.terminal_id) || null;
  if (!info) throw new Error('terminal disappeared right after start');
  return info;
}

module.exports = { create_agent_pane, encode_title };
