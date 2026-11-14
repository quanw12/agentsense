// How a squad bot's computer is started on Windows.
// - worktree: a git worktree plus a separate browser profile
// - wsl: the default WSL distro in that folder, not a private VM
// - docker: a container with the workspace mounted read-write, not a locked sandbox
// - local: the shared workspace folder plus a separate browser profile
// Also notices a real approval prompt on the terminal screen.
const { check_commands } = require('./command_check');
const worktree = require('./worktree');

// A real prompt, not a sentence that merely talks about approval.
const CHOICE_LINE = /(?:^|\n)\s*(?:[❯>]\s*)?1[\.\)]\s*(yes|allow|approve|run)\b/i;
const YN_LINE = /(?:^|\n)\s*[^\n]{0,120}(?:\[y\/n\]|\(y\/n\)|\[Y\/n\]|\(Y\/n\))/i;
const ASK_LINE = /(?:^|\n)\s*[^\n]{0,160}\bdo you want to (?:proceed|continue|run|allow|make this edit|create|delete)\b[^\n]{0,80}\?/i;
const DEFAULT_DOCKER_IMAGE = 'node:20-bookworm';

function windows_to_wsl_path(win_path) {
  const normalized = String(win_path || '').replace(/\\/g, '/');
  const drive_match = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!drive_match) return normalized;
  return `/mnt/${drive_match[1].toLowerCase()}/${drive_match[2]}`;
}

async function detect_sandbox_capabilities(workspace_path) {
  const commands = await check_commands(['git', 'wsl', 'docker']).catch(() => ({}));
  const is_git = workspace_path ? await worktree.is_git_repo(workspace_path).catch(() => false) : false;
  return {
    worktree: Boolean(commands.git && is_git),
    git_installed: Boolean(commands.git),
    is_git_repo: Boolean(is_git),
    wsl: Boolean(commands.wsl),
    docker: Boolean(commands.docker),
    browser: true, // Isolated Chromium <webview> partition is always built into Electron
  };
}

// A Docker image name only. Anything else falls back so the command line cannot grow a second command.
function clean_docker_image(value) {
  const image = String(value || '').trim();
  if (/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,120}$/.test(image)) return image;
  return DEFAULT_DOCKER_IMAGE;
}

// Builds the effective command and create_terminal options for a bot's chosen sandbox_mode.
// WSL and Docker are shells around the workspace, not separate locked machines.
// Note: when agent_id === 'claude' and base_command === 'claude' in 'worktree' or 'local' mode,
// pty_manager.js natively wraps `claude` with --settings (hook_server) and --plugin-dir (agent_kit).
function build_bot_launch_spec(bot, catalog_entry, capabilities) {
  const base_cmd =
    catalog_entry && typeof catalog_entry.launch_command === 'string' && catalog_entry.launch_command.trim() !== ''
      ? catalog_entry.launch_command.trim()
      : (catalog_entry && catalog_entry.command) || 'powershell.exe';

  const mode = bot && typeof bot.sandbox_mode === 'string' ? bot.sandbox_mode : 'worktree';
  const caps = capabilities || {};
  const agent_id = (bot && bot.agent_id) || (catalog_entry && catalog_entry.id) || 'claude';
  const notes = [];
  const wants_worktree = mode === 'worktree' || mode === 'wsl' || mode === 'docker';

  if (mode === 'wsl' && caps.wsl) {
    // The user's default WSL distro, started in the bot's directory. Not a private VM.
    const inner = base_cmd === 'powershell.exe' ? 'bash' : base_cmd;
    return {
      command: `wsl.exe -- bash -lic "${inner.replace(/"/g, '\\"')}"`,
      agent_id,
      use_worktree: Boolean(caps.worktree),
      effective_sandbox: 'wsl',
      sandbox_label: 'WSL shell',
      limit_note: 'This is your default WSL distro in this folder, not a separate machine.',
    };
  }
  if (mode === 'wsl') notes.push('WSL is not installed, so this bot stays on Windows.');

  if (mode === 'docker' && caps.docker) {
    const image = clean_docker_image(process.env.AGENTSENSE_DOCKER_IMAGE || DEFAULT_DOCKER_IMAGE);
    return {
      command: `docker run --rm -it --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 -v "%CD%:/workspace" -w /workspace ${image} bash`,
      agent_id,
      use_worktree: Boolean(caps.worktree),
      effective_sandbox: 'docker',
      sandbox_label: `Docker shell (${image})`,
      limit_note: 'The container can use the network, and the workspace folder is mounted read-write. This is not a locked-down sandbox.',
    };
  }
  if (mode === 'docker') notes.push('Docker is not available, so this bot stays on Windows.');

  if (wants_worktree && caps.worktree) {
    return {
      command: base_cmd,
      agent_id,
      use_worktree: true,
      effective_sandbox: 'worktree',
      sandbox_label: 'Git worktree',
      limit_note: notes.join(' ') || null,
    };
  }
  if (wants_worktree) notes.push('Git worktree is unavailable here, so this bot uses the shared folder.');

  return {
    command: base_cmd,
    agent_id,
    use_worktree: false,
    effective_sandbox: 'local',
    sandbox_label: 'Shared folder',
    limit_note: notes.join(' ') || null,
  };
}

// Inspects the last lines of a bot's rendered terminal screen and its hook_server status.
// A Claude hook status of waiting is trusted. Screen text counts only when a line looks like a prompt.
function detect_approval_prompt(screen_text, hub_status) {
  const lines = String(screen_text || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');
  const tail = lines.slice(-8).join('\n');

  if (hub_status && hub_status.status === 'waiting') {
    return {
      required: true,
      state: 'pending',
      prompt_excerpt: hub_status.detail || tail.slice(-260) || 'Agent is waiting for your approval or input.',
    };
  }

  if (!tail) return null;
  if (!CHOICE_LINE.test(tail) && !YN_LINE.test(tail) && !ASK_LINE.test(tail)) return null;
  return {
    required: true,
    state: 'pending',
    prompt_excerpt: lines.slice(-4).join(' · ').slice(0, 260) || 'Confirm action in terminal',
  };
}

module.exports = {
  windows_to_wsl_path,
  detect_sandbox_capabilities,
  build_bot_launch_spec,
  detect_approval_prompt,
  clean_docker_image,
};
