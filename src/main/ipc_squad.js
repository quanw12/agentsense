// ipcMain coordinator for the OpenMausBot-style Bot Squad mode:
// - Manages Bot Roster, Multi-Bot Channels, Portable Playbooks, and Chat Threads
// - Spawns and binds per-bot isolated computers (Git Worktree, WSL2, Docker, or Local + Browser Sandbox)
// - Routes chat prompts to one or multiple bots (@mentions / @all) and streams live terminal screen updates
//   and Human-in-the-Loop Inline Approval cards back to the chat UI.
const { ipcMain } = require('electron');

const store = require('./store');
const squad_store = require('./bot_squad_store');
const pty_manager = require('./pty_manager');
const { get_hook_server } = require('./hook_server');
const { get_mobile_server } = require('./mobile_server');
const { check_commands } = require('./command_check');
const { render_screen } = require('./terminal_screen');
const { encode_title } = require('./pane_launch');
const { broadcast } = require('./ipc_terminals');
const {
  detect_sandbox_capabilities,
  build_bot_launch_spec,
  detect_approval_prompt,
} = require('./sandbox_env');
const catalog = require('../renderer/agents');

const SUBMIT_DELAY_MS = 160;
const STREAM_THROTTLE_MS = 450;
const QUIET_DONE_MS = 12000;
const MAX_FOLLOW_MS = 5 * 60 * 1000;

// Active live trackers: terminal_id -> { workspace_id, thread_id, message_id, bot_id, started_at, last_data_at, timer, primed }
const active_trackers = new Map();
// Track which terminals have already received their bot's system persona note
const primed_terminals = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function find_workspace(workspace_id) {
  if (!workspace_id) return null;
  try {
    return store.list_workspaces().find((w) => w && w.id === workspace_id) || null;
  } catch (error) {
    return null;
  }
}

function find_catalog_agent(agent_id) {
  return catalog.find((item) => item.id === agent_id) || catalog.find((item) => item.id === 'terminal') || catalog[0];
}

function find_live_terminal(terminal_id) {
  if (!terminal_id) return null;
  return pty_manager.list_terminals().find((t) => t.terminal_id === terminal_id) || null;
}

// Resolves the live terminal bound to a bot in a workspace, or null if not running.
function get_live_bot_terminal(workspace_id, bot_id) {
  const bound_id = squad_store.get_bot_binding(workspace_id, bot_id);
  if (bound_id) {
    const info = find_live_terminal(bound_id);
    if (info && info.alive) return info;
  }
  // Also check if a pane with the bot's title already exists in this workspace
  const bot = squad_store.read_state().bots.find((b) => b.id === bot_id);
  if (!bot) return null;
  const match = pty_manager
    .list_terminals(workspace_id)
    .find((t) => t.alive && String(t.title || '').split('|')[0].toLowerCase() === bot.name.toLowerCase());
  if (match) {
    squad_store.set_bot_binding(workspace_id, bot_id, match.terminal_id);
    return match;
  }
  return null;
}

// Ensures a bot has a running isolated terminal session in the workspace.
async function ensure_bot_computer(workspace_id, bot_id, options = {}) {
  const workspace = find_workspace(workspace_id);
  if (!workspace) throw new Error('Select or add a workspace folder first.');
  const state = squad_store.read_state();
  const bot = state.bots.find((b) => b.id === bot_id);
  if (!bot) throw new Error(`Bot not found: ${bot_id}`);

  if (!options.force_restart) {
    const existing = get_live_bot_terminal(workspace_id, bot.id);
    if (existing) return { terminal: existing, created: false, bot, fallback_note: null };
  } else {
    const old = get_live_bot_terminal(workspace_id, bot.id);
    if (old) {
      await pty_manager.close_terminal(old.terminal_id, {}).catch(() => {});
      broadcast('terminals:closed', old.terminal_id);
    }
  }

  const capabilities = await detect_sandbox_capabilities(workspace.path);
  let target_entry = find_catalog_agent(bot.agent_id);
  const avail = await check_commands([target_entry.command]).catch(() => ({}));
  let fallback_note = null;

  if (!avail[target_entry.command]) {
    const fallback_entry = find_catalog_agent('terminal');
    fallback_note = `${target_entry.label} (${target_entry.command}) is not installed on this PC — launched ${bot.name}'s computer in PowerShell instead. You can switch its CLI anytime in the header.`;
    target_entry = fallback_entry;
  }

  const spec = build_bot_launch_spec(
    { ...bot, agent_id: target_entry.id },
    target_entry,
    capabilities
  );

  // Only pass model_id when cli_capabilities supports it (e.g. claude)
  const use_model = target_entry.id === 'claude' ? bot.model_id : null;
  const title = encode_title(bot.name, target_entry.id, target_entry.label);

  const created = await pty_manager.create_terminal({
    workspace_id: workspace.id,
    agent_id: target_entry.id,
    cwd: workspace.path,
    command: spec.command,
    title,
    cols: 100,
    rows: 28,
    use_worktree: spec.use_worktree,
    model_id: use_model,
  });

  squad_store.set_bot_binding(workspace.id, bot.id, created.terminal_id);
  const info = find_live_terminal(created.terminal_id);
  if (info) {
    broadcast('terminals:created', info);
    const { buffer, ...mobile_terminal } = info;
    get_mobile_server().broadcast_all({ type: 'created', terminal: mobile_terminal });
  }
  return {
    terminal: info || created,
    created: true,
    bot,
    sandbox_label: spec.sandbox_label,
    effective_sandbox: spec.effective_sandbox,
    fallback_note,
  };
}

// Writes text + Enter to a bot's PTY with bracketed paste detection and submit delay.
async function write_prompt_to_terminal(terminal_id, prompt_text) {
  const info = find_live_terminal(terminal_id);
  if (!info || !info.alive) throw new Error('Bot terminal is no longer running.');
  const { bracketed_paste } = await render_screen(info.buffer || '', info.cols || 100, info.rows || 28);
  const clean_lines = String(prompt_text || '').replace(/\r?\n/g, '\r');
  const payload =
    clean_lines.includes('\r') && bracketed_paste
      ? `\x1b[200~${clean_lines.replace(/\x1b/g, '␛')}\x1b[201~`
      : clean_lines;
  pty_manager.write_terminal(terminal_id, payload);
  await sleep(SUBMIT_DELAY_MS);
  pty_manager.write_terminal(terminal_id, '\r');
}

// Resolves which bots should answer a message in a thread ('dm:<bot_id>' or 'chan:<channel_id>').
function resolve_target_bots(state, thread_id, text, explicit_bot_ids) {
  if (Array.isArray(explicit_bot_ids) && explicit_bot_ids.length > 0) {
    const found = explicit_bot_ids
      .map((id) => state.bots.find((b) => b.id === id))
      .filter(Boolean);
    if (found.length > 0) return found;
  }

  if (String(thread_id).startsWith('dm:')) {
    const bot_id = String(thread_id).slice(3);
    const bot = state.bots.find((b) => b.id === bot_id);
    return bot ? [bot] : state.bots.slice(0, 1);
  }

  const chan_id = String(thread_id).startsWith('chan:') ? String(thread_id).slice(5) : thread_id;
  const channel = state.channels.find((c) => c.id === chan_id) || state.channels[0];
  const channel_bots = channel
    ? channel.bot_ids.map((id) => state.bots.find((b) => b.id === id)).filter(Boolean)
    : state.bots;

  const lower = String(text || '').toLowerCase();
  if (/(^|\s)@(all|squad|team|everyone)\b/.test(lower)) {
    return channel_bots.length > 0 ? channel_bots : state.bots.slice(0, 1);
  }

  const mentioned = [];
  for (const bot of state.bots) {
    const pattern = new RegExp(`(^|\\s)@${bot.handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(text)) mentioned.push(bot);
  }
  if (mentioned.length > 0) return mentioned;

  if (channel && channel.lead_bot_id) {
    const lead = state.bots.find((b) => b.id === channel.lead_bot_id);
    if (lead) return [lead];
  }
  return channel_bots.length > 0 ? [channel_bots[0]] : state.bots.slice(0, 1);
}

async function refresh_tracked_message(terminal_id, force_status = null) {
  const tracker = active_trackers.get(terminal_id);
  if (!tracker || tracker.busy) return;
  tracker.busy = true;
  try {
    const info = find_live_terminal(terminal_id);
    const hub_statuses = get_hook_server().get_status();
    const hub_info = hub_statuses[terminal_id] || null;
    let screen_text = '';
    if (info && info.buffer) {
      const rendered = await render_screen(info.buffer, info.cols || 100, info.rows || 28);
      screen_text = rendered.text || '';
    }
    const lines = screen_text.split('\n').filter((l) => l.trim() !== '');
    const preview_tail = lines.slice(-22).join('\n');
    const approval = detect_approval_prompt(screen_text, hub_info);

    let status = force_status || (hub_info ? hub_info.status : info && info.alive ? 'working' : 'ended');
    if (approval && approval.required) status = 'waiting';

    const elapsed_quiet = Date.now() - tracker.last_data_at;
    const elapsed_total = Date.now() - tracker.started_at;
    if (!force_status && status === 'working' && elapsed_quiet > QUIET_DONE_MS && preview_tail.length > 0) {
      status = 'done';
    }

    const summary_text =
      preview_tail.trim() !== ''
        ? preview_tail
        : status === 'working'
        ? 'Starting isolated environment and processing prompt…'
        : 'Session ready.';

    const updated = squad_store.update_message(tracker.workspace_id, tracker.thread_id, tracker.message_id, {
      text: summary_text,
      screen_preview: screen_text.slice(-8000),
      status,
      approval: approval || null,
    });

    if (updated) {
      broadcast('squad:message_updated', {
        workspace_id: tracker.workspace_id,
        thread_id: tracker.thread_id,
        message: updated,
      });
    }

    if (status === 'done' || status === 'ended' || status === 'idle' || elapsed_total > MAX_FOLLOW_MS) {
      if (status !== 'waiting') {
        stop_tracker(terminal_id);
      }
    }
  } catch (error) {
    // Ignore transient render errors
  } finally {
    tracker.busy = false;
  }
}

function start_tracker(terminal_id, context) {
  stop_tracker(terminal_id);
  const now = Date.now();
  const tracker = {
    terminal_id,
    workspace_id: context.workspace_id,
    thread_id: context.thread_id,
    message_id: context.message_id,
    bot_id: context.bot_id,
    started_at: now,
    last_data_at: now,
    busy: false,
    timer: null,
  };
  tracker.timer = setInterval(() => {
    refresh_tracked_message(terminal_id).catch(() => {});
  }, STREAM_THROTTLE_MS);
  if (typeof tracker.timer.unref === 'function') tracker.timer.unref();
  active_trackers.set(terminal_id, tracker);
}

function stop_tracker(terminal_id) {
  const existing = active_trackers.get(terminal_id);
  if (!existing) return;
  if (existing.timer) clearInterval(existing.timer);
  active_trackers.delete(terminal_id);
}

async function build_squad_state(workspace_id) {
  const state = squad_store.read_state();
  const workspace = find_workspace(workspace_id);
  const capabilities = await detect_sandbox_capabilities(workspace ? workspace.path : null);
  const all_commands = catalog.map((a) => a.command);
  const available_agents = await check_commands(all_commands).catch(() => ({}));
  const hub_statuses = get_hook_server().get_status();

  const bot_computers = {};
  if (workspace) {
    for (const bot of state.bots) {
      const live = get_live_bot_terminal(workspace.id, bot.id);
      if (live) {
        const hub_st = hub_statuses[live.terminal_id];
        bot_computers[bot.id] = {
          terminal_id: live.terminal_id,
          alive: live.alive,
          agent_id: live.agent_id,
          model_id: live.model_id,
          cwd: live.cwd,
          worktree: live.worktree || null,
          status: hub_st ? hub_st.status : live.alive ? 'running' : 'exited',
          detail: hub_st ? hub_st.detail : null,
        };
      }
    }
  }

  return {
    bots: state.bots,
    channels: state.channels,
    capabilities,
    available_agents,
    bot_computers,
  };
}

function register_squad_ipc() {
  ipcMain.handle('squad:get_state', (_event, workspace_id) => build_squad_state(workspace_id));

  ipcMain.handle('squad:save_bot', async (_event, bot_input, workspace_id) => {
    const saved = squad_store.save_bot(bot_input);
    const full = await build_squad_state(workspace_id);
    broadcast('squad:state_changed', full);
    return { bot: saved, state: full };
  });

  ipcMain.handle('squad:remove_bot', async (_event, bot_id, workspace_id) => {
    squad_store.remove_bot(bot_id);
    const full = await build_squad_state(workspace_id);
    broadcast('squad:state_changed', full);
    return full;
  });

  // Switch a bot's CLI brain, model, or sandbox mode mid-conversation ("Pick a Brain per Bot").
  ipcMain.handle('squad:switch_brain', async (_event, payload) => {
    const { workspace_id, bot_id, agent_id, model_id, sandbox_mode, restart_computer } = payload || {};
    const state = squad_store.read_state();
    const existing = state.bots.find((b) => b.id === bot_id);
    if (!existing) throw new Error('Bot not found');
    const updated_bot = squad_store.save_bot({
      ...existing,
      agent_id: agent_id !== undefined ? agent_id : existing.agent_id,
      model_id: model_id !== undefined ? model_id : existing.model_id,
      sandbox_mode: sandbox_mode !== undefined ? sandbox_mode : existing.sandbox_mode,
    });
    if (restart_computer && workspace_id) {
      const live = get_live_bot_terminal(workspace_id, bot_id);
      if (live) {
        await ensure_bot_computer(workspace_id, bot_id, { force_restart: true });
      }
    }
    const full = await build_squad_state(workspace_id);
    broadcast('squad:state_changed', full);
    return { bot: updated_bot, state: full };
  });

  ipcMain.handle('squad:save_channel', async (_event, channel_input, workspace_id) => {
    const saved = squad_store.save_channel(channel_input);
    const full = await build_squad_state(workspace_id);
    broadcast('squad:state_changed', full);
    return { channel: saved, state: full };
  });

  ipcMain.handle('squad:remove_channel', async (_event, channel_id, workspace_id) => {
    squad_store.remove_channel(channel_id);
    const full = await build_squad_state(workspace_id);
    broadcast('squad:state_changed', full);
    return full;
  });

  ipcMain.handle('squad:list_messages', (_event, workspace_id, thread_id) =>
    squad_store.list_messages(workspace_id, thread_id)
  );

  ipcMain.handle('squad:clear_messages', (_event, workspace_id, thread_id) =>
    squad_store.clear_messages(workspace_id, thread_id)
  );

  ipcMain.handle('squad:ensure_computer', async (_event, { workspace_id, bot_id, force_restart }) => {
    const res = await ensure_bot_computer(workspace_id, bot_id, { force_restart: Boolean(force_restart) });
    const full = await build_squad_state(workspace_id);
    broadcast('squad:state_changed', full);
    return { ...res, state: full };
  });

  ipcMain.handle('squad:get_computer_screen', async (_event, { workspace_id, bot_id }) => {
    const live = get_live_bot_terminal(workspace_id, bot_id);
    if (!live) return { alive: false, text: '', terminal_id: null, worktree: null, cwd: null };
    const rendered = await render_screen(live.buffer || '', live.cols || 100, live.rows || 28);
    const hub_st = get_hook_server().get_status()[live.terminal_id] || null;
    return {
      alive: live.alive,
      terminal_id: live.terminal_id,
      text: rendered.text || '',
      cwd: live.cwd,
      worktree: live.worktree || null,
      status: hub_st ? hub_st.status : live.alive ? 'running' : 'exited',
      approval: detect_approval_prompt(rendered.text || '', hub_st),
    };
  });

  ipcMain.handle('squad:send_message', async (_event, payload) => {
    const { workspace_id, thread_id, text, target_bot_ids } = payload || {};
    const clean = typeof text === 'string' ? text.trim() : '';
    if (!workspace_id) throw new Error('Select a workspace folder first.');
    if (!clean) throw new Error('Message cannot be empty.');

    const state = squad_store.read_state();
    const user_msg = squad_store.append_message(workspace_id, thread_id, {
      sender_type: 'user',
      sender_name: 'You',
      sender_avatar: '👤',
      sender_color: '#5b8def',
      text: clean,
      status: 'done',
    });
    broadcast('squad:message_added', { workspace_id, thread_id, message: user_msg });

    const targets = resolve_target_bots(state, thread_id, clean, target_bot_ids);
    const replies = [];

    for (const bot of targets) {
      let computer = null;
      try {
        computer = await ensure_bot_computer(workspace_id, bot.id);
      } catch (error) {
        const err_msg = squad_store.append_message(workspace_id, thread_id, {
          sender_type: 'bot',
          bot_id: bot.id,
          sender_name: bot.name,
          sender_avatar: bot.avatar,
          sender_color: bot.color,
          agent_id: bot.agent_id,
          model_id: bot.model_id,
          sandbox_mode: bot.sandbox_mode,
          text: `⚠️ Could not start ${bot.name}'s computer: ${error.message}`,
          status: 'ended',
        });
        broadcast('squad:message_added', { workspace_id, thread_id, message: err_msg });
        replies.push(err_msg);
        continue;
      }

      const terminal_id = computer.terminal.terminal_id;
      const initial_text = computer.fallback_note
        ? `ℹ️ ${computer.fallback_note}\n\n⏳ Sending prompt to ${bot.name}…`
        : `⏳ ${bot.name} is working in its isolated computer (${computer.sandbox_label || bot.sandbox_mode})…`;

      const bot_msg = squad_store.append_message(workspace_id, thread_id, {
        sender_type: 'bot',
        bot_id: bot.id,
        sender_name: bot.name,
        sender_avatar: bot.avatar,
        sender_color: bot.color,
        agent_id: computer.terminal.agent_id || bot.agent_id,
        model_id: bot.model_id,
        sandbox_mode: bot.sandbox_mode,
        terminal_id,
        text: initial_text,
        status: 'working',
      });
      broadcast('squad:message_added', { workspace_id, thread_id, message: bot_msg });
      replies.push(bot_msg);

      // Start live screen tracker for this bot reply
      start_tracker(terminal_id, {
        workspace_id,
        thread_id,
        message_id: bot_msg.id,
        bot_id: bot.id,
      });

      // If this terminal was just created, wait briefly so the CLI / shell prompt is ready
      if (computer.created) {
        await sleep(450);
      }

      // Format prompt: strip leading @handle if directed at this bot, and include role hint on first message if CLI agent
      let effective_prompt = clean.replace(new RegExp(`^@${bot.handle}\\b\\s*`, 'i'), '').trim() || clean;
      if (!primed_terminals.has(terminal_id)) {
        primed_terminals.add(terminal_id);
        if (bot.system_prompt && computer.terminal.agent_id !== 'terminal') {
          effective_prompt = `[Role: ${bot.name} — ${bot.role}. ${bot.system_prompt}]\n\nTask: ${effective_prompt}`;
        }
      }

      await write_prompt_to_terminal(terminal_id, effective_prompt).catch((err) => {
        squad_store.update_message(workspace_id, thread_id, bot_msg.id, {
          text: `⚠️ Failed to write to terminal: ${err.message}`,
          status: 'ended',
        });
      });
    }

    const full = await build_squad_state(workspace_id);
    broadcast('squad:state_changed', full);
    return { user_message: user_msg, replies };
  });

  // Human-in-the-Loop Inline Approval handler
  ipcMain.handle('squad:send_approval', async (_event, payload) => {
    const { workspace_id, thread_id, message_id, bot_id, decision } = payload || {};
    const live = get_live_bot_terminal(workspace_id, bot_id);
    if (!live || !live.alive) throw new Error('Bot terminal is not running.');

    let keystroke = '\r';
    let next_state = 'approved';
    if (decision === 'approve_yes' || decision === '1') {
      keystroke = '1\r';
      next_state = 'approved';
    } else if (decision === 'approve_always' || decision === '2') {
      keystroke = '2\r';
      next_state = 'approved';
    } else if (decision === 'yes_y') {
      keystroke = 'y\r';
      next_state = 'approved';
    } else if (decision === 'deny' || decision === 'esc') {
      keystroke = '\x1b';
      next_state = 'denied';
    } else if (decision === 'ctrlc') {
      keystroke = '\x03';
      next_state = 'denied';
    }

    pty_manager.write_terminal(live.terminal_id, keystroke);
    if (message_id && thread_id) {
      const updated = squad_store.update_message(workspace_id, thread_id, message_id, {
        status: next_state === 'approved' ? 'working' : 'done',
        approval: {
          required: false,
          state: next_state,
          prompt_excerpt: next_state === 'approved' ? 'Approved by user' : 'Denied / cancelled by user',
        },
      });
      if (updated) {
        broadcast('squad:message_updated', { workspace_id, thread_id, message: updated });
      }
      if (next_state === 'approved') {
        start_tracker(live.terminal_id, { workspace_id, thread_id, message_id, bot_id });
      }
    }
    return { ok: true, state: next_state };
  });

  ipcMain.handle('squad:export_playbook', () => squad_store.export_playbook());

  ipcMain.handle('squad:import_playbook', async (_event, markdown, workspace_id) => {
    const imported = squad_store.import_playbook(markdown);
    const full = await build_squad_state(workspace_id);
    broadcast('squad:state_changed', full);
    return { imported, state: full };
  });

  // Subscribe to PTY data, exit, and hook_server status to keep trackers lively
  pty_manager.terminal_events.on('data', (terminal_id) => {
    const tracker = active_trackers.get(terminal_id);
    if (tracker) {
      tracker.last_data_at = Date.now();
    }
  });

  pty_manager.terminal_events.on('exit', (terminal_id) => {
    if (active_trackers.has(terminal_id)) {
      refresh_tracked_message(terminal_id, 'ended').finally(() => stop_tracker(terminal_id));
    }
  });

  get_hook_server().on('status', (terminal_id, info) => {
    if (active_trackers.has(terminal_id)) {
      refresh_tracked_message(terminal_id, info.status).catch(() => {});
    }
  });
}

module.exports = {
  register_squad_ipc,
  build_squad_state,
  resolve_target_bots,
};
