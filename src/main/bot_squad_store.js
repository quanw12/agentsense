// Persistence and playbook management for the OpenMausBot-style Bot Squad mode.
// Stores the customizable Bot Roster, multi-bot Channels/Rooms, and per-workspace chat threads
// in <userData>/bot_squad.json. Also supports importing and exporting portable Markdown Team Playbooks.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE_NAME = 'bot_squad.json';
const FILE_VERSION = 1;
const MAX_MESSAGES_PER_THREAD = 200;
const MAX_BOTS = 24;
const MAX_CHANNELS = 24;

const SANDBOX_MODES = ['worktree', 'wsl', 'docker', 'local'];

// Default starter roster inspired by OpenMausBot: a Chief of Staff + specialized bots.
const DEFAULT_BOTS = [
  {
    id: 'bot-chief',
    name: 'Maus Lead',
    handle: 'lead',
    role: 'Chief of Staff & Architect',
    avatar: '🦊',
    color: '#5b8def',
    agent_id: 'claude',
    model_id: 'sonnet',
    sandbox_mode: 'worktree',
    browser_url: 'http://localhost:3000',
    system_prompt:
      'You are Maus Lead (Chief of Staff). Break down complex goals, coordinate the squad, and review diffs. When a job touches several files, start it with /agentsense:lead. That skill plans the work, runs workers in their own git worktrees, and does not merge until the user approves. Do not merge or push from this chat.',
  },
  {
    id: 'bot-builder',
    name: 'Forge Builder',
    handle: 'builder',
    role: 'Full-Stack Implementation Bot',
    avatar: '🛠️',
    color: '#3fb950',
    agent_id: 'codex',
    model_id: 'gpt-5.1-codex',
    sandbox_mode: 'worktree',
    browser_url: 'http://localhost:3000',
    system_prompt:
      'You are Forge Builder. Implement features cleanly inside your isolated git worktree, run tests, and report concise summaries of files changed.',
  },
  {
    id: 'bot-scout',
    name: 'Grok Scout',
    handle: 'scout',
    role: 'Fast Recon & Debugger',
    avatar: '⚡',
    color: '#d9a441',
    agent_id: 'grok',
    model_id: null,
    sandbox_mode: 'worktree',
    browser_url: 'http://localhost:3000',
    system_prompt:
      'You are Grok Scout. Quickly investigate bugs, trace logs, inspect CLI output, and propose fast, high-signal fixes.',
  },
  {
    id: 'bot-qa',
    name: 'Sentinel QA',
    handle: 'qa',
    role: 'Verification, Security & Browser Tester',
    avatar: '🛡️',
    color: '#c678dd',
    agent_id: 'claude',
    model_id: 'sonnet',
    sandbox_mode: 'worktree',
    browser_url: 'http://localhost:3000',
    system_prompt:
      'You are Sentinel QA. Verify behavior, run smoke/stability suites, inspect UI flows in your sandbox browser, and catch regressions before merge.',
  },
];

const DEFAULT_CHANNELS = [
  {
    id: 'chan-squad',
    name: 'general-squad',
    description: 'Main war room — mention @lead, @builder, @scout, @qa or @all',
    bot_ids: ['bot-chief', 'bot-builder', 'bot-scout', 'bot-qa'],
    lead_bot_id: 'bot-chief',
  },
  {
    id: 'chan-build',
    name: 'feature-delivery',
    description: 'Architecture & implementation room (@lead + @builder)',
    bot_ids: ['bot-chief', 'bot-builder'],
    lead_bot_id: 'bot-builder',
  },
  {
    id: 'chan-qa',
    name: 'qa-and-recon',
    description: 'Bug hunting, security & verification (@scout + @qa)',
    bot_ids: ['bot-scout', 'bot-qa'],
    lead_bot_id: 'bot-qa',
  },
];

let file_override = null;

function set_file_for_tests(custom_path) {
  file_override = custom_path || null;
}

function default_file_path() {
  if (file_override) return file_override;
  const { app } = require('electron');
  return path.join(app.getPath('userData'), FILE_NAME);
}

function clean_text(value, fallback, max_len = 120) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed === '' ? fallback : trimmed.slice(0, max_len);
}

function clean_handle(value, fallback_name) {
  const raw = typeof value === 'string' && value.trim() !== '' ? value : fallback_name || 'bot';
  const normalized = String(raw)
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return normalized || 'bot';
}

function normalize_bot(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const name = clean_text(raw.name, `Bot ${index + 1}`, 40);
  const id = clean_text(raw.id, `bot-${crypto.randomUUID().slice(0, 8)}`, 64);
  const handle = clean_handle(raw.handle, name);
  const role = clean_text(raw.role, 'Autonomous Coding Bot', 80);
  const avatar = clean_text(raw.avatar, '🤖', 8);
  const color = clean_text(raw.color, '#5b8def', 24);
  const agent_id = clean_text(raw.agent_id, 'claude', 40).toLowerCase();
  const model_id = typeof raw.model_id === 'string' && raw.model_id.trim() !== '' ? raw.model_id.trim().slice(0, 60) : null;
  const sandbox_mode = SANDBOX_MODES.includes(raw.sandbox_mode) ? raw.sandbox_mode : 'worktree';
  const browser_url = clean_text(raw.browser_url, 'http://localhost:3000', 300);
  const system_prompt = clean_text(raw.system_prompt, '', 2000);
  return {
    id,
    name,
    handle,
    role,
    avatar,
    color,
    agent_id,
    model_id,
    sandbox_mode,
    browser_url,
    system_prompt,
  };
}

function normalize_channel(raw, valid_bot_ids) {
  if (!raw || typeof raw !== 'object') return null;
  const name = clean_handle(raw.name, 'channel');
  const id = clean_text(raw.id, `chan-${crypto.randomUUID().slice(0, 8)}`, 64);
  const description = clean_text(raw.description, 'Multi-bot project channel', 160);
  const raw_bots = Array.isArray(raw.bot_ids) ? raw.bot_ids : [];
  const bot_ids = raw_bots.filter((bot_id) => typeof bot_id === 'string' && (!valid_bot_ids || valid_bot_ids.has(bot_id)));
  const lead_bot_id =
    typeof raw.lead_bot_id === 'string' && bot_ids.includes(raw.lead_bot_id)
      ? raw.lead_bot_id
      : bot_ids[0] || null;
  return {
    id,
    name,
    description,
    bot_ids,
    lead_bot_id,
  };
}

function normalize_message(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  return {
    id: raw.id,
    thread_id: clean_text(raw.thread_id, '', 80),
    sender_type: raw.sender_type === 'bot' || raw.sender_type === 'system' ? raw.sender_type : 'user',
    bot_id: typeof raw.bot_id === 'string' ? raw.bot_id : null,
    sender_name: clean_text(raw.sender_name, 'User', 60),
    sender_avatar: clean_text(raw.sender_avatar, '👤', 8),
    sender_color: clean_text(raw.sender_color, '#5b8def', 24),
    agent_id: typeof raw.agent_id === 'string' ? raw.agent_id : null,
    model_id: typeof raw.model_id === 'string' ? raw.model_id : null,
    sandbox_mode: typeof raw.sandbox_mode === 'string' ? raw.sandbox_mode : null,
    text: typeof raw.text === 'string' ? raw.text.slice(0, 32000) : '',
    screen_preview: typeof raw.screen_preview === 'string' ? raw.screen_preview.slice(0, 12000) : null,
    terminal_id: typeof raw.terminal_id === 'string' ? raw.terminal_id : null,
    status: clean_text(raw.status, 'done', 24),
    approval:
      raw.approval && typeof raw.approval === 'object'
        ? {
            required: Boolean(raw.approval.required),
            state: clean_text(raw.approval.state, 'pending', 24), // 'pending' | 'approved' | 'denied'
            prompt_excerpt: clean_text(raw.approval.prompt_excerpt, 'Bot is waiting for confirmation in terminal', 300),
          }
        : null,
    created_at: typeof raw.created_at === 'number' ? raw.created_at : Date.now(),
    updated_at: typeof raw.updated_at === 'number' ? raw.updated_at : Date.now(),
  };
}

function default_state() {
  const bots = DEFAULT_BOTS.map((bot, idx) => normalize_bot(bot, idx));
  const bot_set = new Set(bots.map((bot) => bot.id));
  const channels = DEFAULT_CHANNELS.map((chan) => normalize_channel(chan, bot_set));
  return {
    version: FILE_VERSION,
    bots,
    channels,
    threads: {}, // { [workspace_id]: { [thread_id]: [message, ...] } }
    bindings: {}, // { [workspace_id]: { [bot_id]: terminal_id } }
  };
}

function read_state(custom_path) {
  const file_path = custom_path || default_file_path();
  let raw = null;
  try {
    raw = fs.readFileSync(file_path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return default_state();
    return default_state();
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return default_state();
    const bots = Array.isArray(parsed.bots) && parsed.bots.length > 0
      ? parsed.bots.map(normalize_bot).filter(Boolean).slice(0, MAX_BOTS)
      : DEFAULT_BOTS.map(normalize_bot);
    const bot_set = new Set(bots.map((bot) => bot.id));
    const channels = Array.isArray(parsed.channels) && parsed.channels.length > 0
      ? parsed.channels.map((chan) => normalize_channel(chan, bot_set)).filter(Boolean).slice(0, MAX_CHANNELS)
      : DEFAULT_CHANNELS.map((chan) => normalize_channel(chan, bot_set));
    const threads = {};
    if (parsed.threads && typeof parsed.threads === 'object') {
      for (const [ws_id, ws_threads] of Object.entries(parsed.threads)) {
        if (!ws_threads || typeof ws_threads !== 'object') continue;
        threads[ws_id] = {};
        for (const [thread_id, list] of Object.entries(ws_threads)) {
          if (!Array.isArray(list)) continue;
          threads[ws_id][thread_id] = list.map(normalize_message).filter(Boolean).slice(-MAX_MESSAGES_PER_THREAD);
        }
      }
    }
    const bindings = parsed.bindings && typeof parsed.bindings === 'object' ? parsed.bindings : {};
    return { version: FILE_VERSION, bots, channels, threads, bindings };
  } catch (error) {
    return default_state();
  }
}

function write_state(state, custom_path) {
  const file_path = custom_path || default_file_path();
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  const payload = {
    version: FILE_VERSION,
    bots: state.bots || [],
    channels: state.channels || [],
    threads: state.threads || {},
    bindings: state.bindings || {},
  };
  const tmp_path = `${file_path}.${process.pid}.tmp`;
  fs.writeFileSync(tmp_path, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp_path, file_path);
  return payload;
}

function save_bot(bot_input, custom_path) {
  const state = read_state(custom_path);
  const existing_idx = bot_input && bot_input.id ? state.bots.findIndex((b) => b.id === bot_input.id) : -1;
  const merged = existing_idx >= 0 ? Object.assign({}, state.bots[existing_idx], bot_input) : bot_input;
  const normalized = normalize_bot(merged, state.bots.length);
  if (!normalized) throw new Error('Invalid bot configuration');

  // Ensure handle uniqueness
  const duplicate_handle = state.bots.find((b) => b.handle === normalized.handle && b.id !== normalized.id);
  if (duplicate_handle) {
    normalized.handle = `${normalized.handle}-${state.bots.length + 1}`;
  }

  if (existing_idx >= 0) {
    state.bots[existing_idx] = normalized;
  } else {
    if (state.bots.length >= MAX_BOTS) throw new Error(`Maximum of ${MAX_BOTS} bots reached`);
    state.bots.push(normalized);
    // Also add new bot to the first general channel if present
    if (state.channels[0] && !state.channels[0].bot_ids.includes(normalized.id)) {
      state.channels[0].bot_ids.push(normalized.id);
    }
  }
  write_state(state, custom_path);
  return normalized;
}

function remove_bot(bot_id, custom_path) {
  const state = read_state(custom_path);
  if (state.bots.length <= 1) throw new Error('Cannot remove the last remaining bot in the roster');
  state.bots = state.bots.filter((b) => b.id !== bot_id);
  for (const channel of state.channels) {
    channel.bot_ids = channel.bot_ids.filter((id) => id !== bot_id);
    if (channel.lead_bot_id === bot_id) {
      channel.lead_bot_id = channel.bot_ids[0] || null;
    }
  }
  write_state(state, custom_path);
  return state.bots;
}

function save_channel(channel_input, custom_path) {
  const state = read_state(custom_path);
  const bot_set = new Set(state.bots.map((b) => b.id));
  const existing_idx = channel_input && channel_input.id ? state.channels.findIndex((c) => c.id === channel_input.id) : -1;
  const merged = existing_idx >= 0 ? Object.assign({}, state.channels[existing_idx], channel_input) : channel_input;
  const normalized = normalize_channel(merged, bot_set);
  if (!normalized) throw new Error('Invalid channel configuration');
  if (normalized.bot_ids.length === 0 && state.bots[0]) {
    normalized.bot_ids = [state.bots[0].id];
    normalized.lead_bot_id = state.bots[0].id;
  }
  if (existing_idx >= 0) {
    state.channels[existing_idx] = normalized;
  } else {
    if (state.channels.length >= MAX_CHANNELS) throw new Error(`Maximum of ${MAX_CHANNELS} channels reached`);
    state.channels.push(normalized);
  }
  write_state(state, custom_path);
  return normalized;
}

function remove_channel(channel_id, custom_path) {
  const state = read_state(custom_path);
  if (state.channels.length <= 1) throw new Error('Cannot remove the last channel');
  state.channels = state.channels.filter((c) => c.id !== channel_id);
  write_state(state, custom_path);
  return state.channels;
}

function list_messages(workspace_id, thread_id, custom_path) {
  if (!workspace_id || !thread_id) return [];
  const state = read_state(custom_path);
  const ws_threads = state.threads[workspace_id];
  if (!ws_threads || !Array.isArray(ws_threads[thread_id])) return [];
  return ws_threads[thread_id];
}

function append_message(workspace_id, thread_id, message_input, custom_path) {
  const state = read_state(custom_path);
  if (!state.threads[workspace_id]) state.threads[workspace_id] = {};
  if (!Array.isArray(state.threads[workspace_id][thread_id])) {
    state.threads[workspace_id][thread_id] = [];
  }
  const msg = normalize_message(
    Object.assign(
      {
        id: crypto.randomUUID(),
        thread_id,
        created_at: Date.now(),
        updated_at: Date.now(),
      },
      message_input
    )
  );
  state.threads[workspace_id][thread_id].push(msg);
  if (state.threads[workspace_id][thread_id].length > MAX_MESSAGES_PER_THREAD) {
    state.threads[workspace_id][thread_id] = state.threads[workspace_id][thread_id].slice(-MAX_MESSAGES_PER_THREAD);
  }
  write_state(state, custom_path);
  return msg;
}

function update_message(workspace_id, thread_id, message_id, patch, custom_path) {
  const state = read_state(custom_path);
  const list = state.threads[workspace_id] && state.threads[workspace_id][thread_id];
  if (!Array.isArray(list)) return null;
  const idx = list.findIndex((m) => m.id === message_id);
  if (idx === -1) return null;
  const updated = normalize_message(Object.assign({}, list[idx], patch, { updated_at: Date.now() }));
  list[idx] = updated;
  write_state(state, custom_path);
  return updated;
}

function clear_messages(workspace_id, thread_id, custom_path) {
  const state = read_state(custom_path);
  if (state.threads[workspace_id] && state.threads[workspace_id][thread_id]) {
    state.threads[workspace_id][thread_id] = [];
    write_state(state, custom_path);
  }
  return [];
}

function get_bot_binding(workspace_id, bot_id, custom_path) {
  const state = read_state(custom_path);
  return (state.bindings[workspace_id] && state.bindings[workspace_id][bot_id]) || null;
}

function set_bot_binding(workspace_id, bot_id, terminal_id, custom_path) {
  const state = read_state(custom_path);
  if (!state.bindings[workspace_id]) state.bindings[workspace_id] = {};
  if (terminal_id === null || terminal_id === undefined) {
    delete state.bindings[workspace_id][bot_id];
  } else {
    state.bindings[workspace_id][bot_id] = terminal_id;
  }
  write_state(state, custom_path);
}

// Portable Markdown Team Playbook exporter/importer (like OpenMausBot playbooks).
function export_playbook(custom_path) {
  const state = read_state(custom_path);
  const lines = [
    '# AgentSense Team Playbook',
    '',
    '> Portable multi-bot squad configuration (OpenMausBot-compatible format).',
    '',
    '## Bots',
    '',
  ];
  for (const bot of state.bots) {
    lines.push(`### ${bot.avatar} ${bot.name} (@${bot.handle})`);
    lines.push(`- **id**: ${bot.id}`);
    lines.push(`- **role**: ${bot.role}`);
    lines.push(`- **agent**: ${bot.agent_id}`);
    if (bot.model_id) lines.push(`- **model**: ${bot.model_id}`);
    lines.push(`- **sandbox**: ${bot.sandbox_mode}`);
    lines.push(`- **color**: ${bot.color}`);
    if (bot.browser_url) lines.push(`- **browser_url**: ${bot.browser_url}`);
    if (bot.system_prompt) {
      lines.push(`- **prompt**: ${bot.system_prompt.replace(/\r?\n/g, ' ')}`);
    }
    lines.push('');
  }
  lines.push('## Channels');
  lines.push('');
  for (const channel of state.channels) {
    const handles = channel.bot_ids
      .map((id) => {
        const found = state.bots.find((b) => b.id === id);
        return found ? `@${found.handle}` : id;
      })
      .join(', ');
    lines.push(`### #${channel.name}`);
    lines.push(`- **description**: ${channel.description}`);
    lines.push(`- **members**: ${handles}`);
    lines.push('');
  }
  return lines.join('\n');
}

function import_playbook(markdown, custom_path) {
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    throw new Error('Playbook markdown cannot be empty');
  }
  const bots = [];
  const channels = [];
  let section = null;
  let current_item = null;

  const commit_current = () => {
    if (!current_item) return;
    if (current_item._kind === 'bot') {
      bots.push(normalize_bot(current_item, bots.length));
    } else if (current_item._kind === 'channel') {
      channels.push(current_item);
    }
    current_item = null;
  };

  for (const raw_line of markdown.split(/\r?\n/)) {
    const line = raw_line.trim();
    if (/^##\s+Bots/i.test(line)) {
      commit_current();
      section = 'bots';
      continue;
    }
    if (/^##\s+Channels/i.test(line)) {
      commit_current();
      section = 'channels';
      continue;
    }
    if (section === 'bots' && line.startsWith('### ')) {
      commit_current();
      const header = line.slice(4).trim();
      const handle_match = header.match(/\(@([a-zA-Z0-9_-]+)\)/);
      const clean_header = header.replace(/\(@[a-zA-Z0-9_-]+\)/, '').trim();
      const first_space = clean_header.indexOf(' ');
      const has_emoji = first_space > 0 && first_space <= 4;
      const avatar = has_emoji ? clean_header.slice(0, first_space).trim() : '🤖';
      const name = has_emoji ? clean_header.slice(first_space + 1).trim() : clean_header;
      current_item = {
        _kind: 'bot',
        id: `bot-${clean_handle(handle_match ? handle_match[1] : name, name)}`,
        name: name || 'Bot',
        handle: handle_match ? handle_match[1] : clean_handle(name, 'bot'),
        avatar,
      };
      continue;
    }
    if (section === 'channels' && line.startsWith('### ')) {
      commit_current();
      const name = line.slice(4).replace(/^#+/, '').trim();
      current_item = {
        _kind: 'channel',
        id: `chan-${clean_handle(name, 'room')}`,
        name: clean_handle(name, 'room'),
        description: 'Imported channel',
        member_handles: [],
      };
      continue;
    }
    const kv = line.match(/^-\s+\*\*([a-z_]+)\*\*:\s*(.+)$/i);
    if (kv && current_item) {
      const key = kv[1].toLowerCase();
      const val = kv[2].trim();
      if (current_item._kind === 'bot') {
        if (key === 'id') current_item.id = val;
        else if (key === 'role') current_item.role = val;
        else if (key === 'agent') current_item.agent_id = val;
        else if (key === 'model') current_item.model_id = val;
        else if (key === 'sandbox') current_item.sandbox_mode = val;
        else if (key === 'color') current_item.color = val;
        else if (key === 'browser_url') current_item.browser_url = val;
        else if (key === 'prompt') current_item.system_prompt = val;
      } else if (current_item._kind === 'channel') {
        if (key === 'description') current_item.description = val;
        else if (key === 'members') {
          current_item.member_handles = val
            .split(',')
            .map((s) => s.trim().replace(/^@/, '').toLowerCase())
            .filter(Boolean);
        }
      }
    }
  }
  commit_current();

  if (bots.length === 0) {
    throw new Error('No bots found in the Playbook markdown. Use ### Avatar Name (@handle) under ## Bots.');
  }

  const state = read_state(custom_path);
  state.bots = bots.filter(Boolean).slice(0, MAX_BOTS);
  const bot_set = new Set(state.bots.map((b) => b.id));
  if (channels.length > 0) {
    state.channels = channels
      .map((ch) => {
        const bot_ids = ch.member_handles
          .map((h) => {
            const found = state.bots.find((b) => b.handle === h || b.id === h);
            return found ? found.id : null;
          })
          .filter(Boolean);
        return normalize_channel(
          {
            id: ch.id,
            name: ch.name,
            description: ch.description,
            bot_ids: bot_ids.length > 0 ? bot_ids : state.bots.map((b) => b.id),
          },
          bot_set
        );
      })
      .filter(Boolean);
  } else {
    state.channels = DEFAULT_CHANNELS.map((c) =>
      normalize_channel({ ...c, bot_ids: state.bots.map((b) => b.id) }, bot_set)
    );
  }
  write_state(state, custom_path);
  return { bots: state.bots, channels: state.channels };
}

module.exports = {
  SANDBOX_MODES,
  DEFAULT_BOTS,
  DEFAULT_CHANNELS,
  set_file_for_tests,
  default_file_path,
  read_state,
  write_state,
  save_bot,
  remove_bot,
  save_channel,
  remove_channel,
  list_messages,
  append_message,
  update_message,
  clear_messages,
  get_bot_binding,
  set_bot_binding,
  export_playbook,
  import_playbook,
};
