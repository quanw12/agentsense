// Sandbox & Virtual Environment coordinator ("Every Bot Gets a Computer").
// Supports 4 execution isolation modes per bot on Windows:
// - 'worktree': Isolated Git Worktree (<repo>.worktrees/<bot>) + isolated Chromium browser partition
// - 'wsl':      WSL2 Linux VM environment mounted to the bot's working directory
// - 'docker':   Docker container sandbox mounting the bot's working directory
// - 'local':    Shared workspace folder + isolated Chromium browser partition
// Also detects Human-in-the-Loop permission prompts from terminal screens to surface Inline Approval Cards.
const { check_commands } = require('./command_check');
const worktree = require('./worktree');

const APPROVAL_PATTERNS = [
  /do you want to (proceed|continue|run|allow|make this edit|create|delete)/i,
  /allow\s+.*\?\s*(\(|\[)?(y\/n|yes\/no|1|y)/i,
  /^\s*[❯>]\s*1[\.\)]\s*(yes|allow|approve|run)/im,
  /\b1[\.\)]\s*yes\b[\s\S]{0,120}\b2[\.\)]\s*(yes|no|allow|don't)/i,
  /\[y\/n\]|\(y\/n\)|\[Y\/n\]|\(Y\/n\)/,
  /press enter to confirm|waiting for approval|requires approval/i,
];

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

// Builds the effective command and create_terminal options for a bot's chosen sandbox_mode.
// Note: when agent_id === 'claude' and base_command === 'claude' in 'worktree' or 'local' mode,
// pty_manager.js natively wraps `claude` with --settings (hook_server) and --plugin-dir (agent_kit).
function build_bot_launch_spec(bot, catalog_entry, capabilities) {
  const base_cmd =
    catalog_entry && typeof catalog_entry.launch_command === 'string' && catalog_entry.launch_command.trim() !== ''
      ? catalog_entry.launch_command.trim()
      : (catalog_entry && catalog_entry.command) || 'powershell.exe';

  const mode = bot && typeof bot.sandbox_mode === 'string' ? bot.sandbox_mode : 'worktree';
  const use_worktree = mode === 'worktree' || mode === 'wsl' || mode === 'docker';

  if (mode === 'wsl' && capabilities && capabilities.wsl) {
    // Runs inside the user's default WSL2 Linux distribution in the current directory.
    const inner = base_cmd === 'powershell.exe' ? 'bash' : base_cmd;
    return {
      command: `wsl.exe -- bash -lic "${inner.replace(/"/g, '\\"')}"`,
      agent_id: bot.agent_id || 'terminal',
      use_worktree: Boolean(capabilities.worktree),
      effective_sandbox: 'wsl',
      sandbox_label: 'WSL2 Linux VM',
    };
  }

  if (mode === 'docker' && capabilities && capabilities.docker) {
    const image = process.env.AGENTSENSE_DOCKER_IMAGE || 'node:20-bookworm';
    return {
      command: `docker run --rm -it -v "%CD%:/workspace" -w /workspace ${image} bash`,
      agent_id: bot.agent_id || 'terminal',
      use_worktree: Boolean(capabilities.worktree),
      effective_sandbox: 'docker',
      sandbox_label: `Docker (${image})`,
    };
  }

  if (use_worktree && capabilities && capabilities.worktree) {
    return {
      command: base_cmd,
      agent_id: bot.agent_id || 'claude',
      use_worktree: true,
      effective_sandbox: 'worktree',
      sandbox_label: 'Isolated Git Worktree',
    };
  }

  return {
    command: base_cmd,
    agent_id: bot.agent_id || 'claude',
    use_worktree: false,
    effective_sandbox: 'local',
    sandbox_label: 'Local Workspace + Browser Sandbox',
  };
}

// Inspects the last lines of a bot's rendered terminal screen and its hook_server status
// to detect if the bot is waiting for Human-in-the-Loop approval.
function detect_approval_prompt(screen_text, hub_status) {
  const tail = String(screen_text || '')
    .split('\n')
    .slice(-14)
    .join('\n')
    .trim();

  if (hub_status && hub_status.status === 'waiting') {
    return {
      required: true,
      state: 'pending',
      prompt_excerpt: hub_status.detail || tail.slice(-260) || 'Agent is waiting for your approval or input.',
    };
  }

  if (!tail) return null;
  for (const pattern of APPROVAL_PATTERNS) {
    if (pattern.test(tail)) {
      const lines = tail.split('\n').filter((line) => line.trim() !== '');
      const excerpt = lines.slice(-4).join(' · ').slice(0, 260);
      return {
        required: true,
        state: 'pending',
        prompt_excerpt: excerpt || 'Confirm action in terminal',
      };
    }
  }
  return null;
}

module.exports = {
  windows_to_wsl_path,
  detect_sandbox_capabilities,
  build_bot_launch_spec,
  detect_approval_prompt,
};
