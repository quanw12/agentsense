// OpenMausBot-style Squad Chat & Per-Bot Computer UI module.
// Exposes window.init_squad_chat({ container, on_open_terminal_pane, on_switch_to_grid }).
(function squad_chat_module() {
  'use strict';

  const SANDBOX_LABELS = {
    worktree: '🌳 Git worktree',
    wsl: '🐧 WSL shell',
    docker: '🐳 Docker shell',
    local: '📁 Shared folder',
  };

  const PLAYBOOK_TEMPLATES = {
    default_squad: {
      label: '🦊 Default OpenMaus Squad (Lead + Builder + Grok Scout + QA)',
      markdown: [
        '# AgentSense Team Playbook',
        '',
        '## Bots',
        '',
        '### 🦊 Maus Lead (@lead)',
        '- **id**: bot-chief',
        '- **role**: Chief of Staff & Architect',
        '- **agent**: claude',
        '- **model**: sonnet',
        '- **sandbox**: worktree',
        '- **color**: #5b8def',
        '- **prompt**: You are Maus Lead (Chief of Staff). Break down complex goals, coordinate the squad, and review diffs. When a job touches several files, start it with /agentsense:lead and do not merge until the user approves.',
        '',
        '### 🛠️ Forge Builder (@builder)',
        '- **id**: bot-builder',
        '- **role**: Full-Stack Implementation Bot',
        '- **agent**: codex',
        '- **model**: gpt-5.1-codex',
        '- **sandbox**: worktree',
        '- **color**: #3fb950',
        '- **prompt**: You are Forge Builder. Implement features cleanly inside your isolated git worktree and run checks.',
        '',
        '### ⚡ Grok Scout (@scout)',
        '- **id**: bot-scout',
        '- **role**: Fast Recon & Debugger',
        '- **agent**: grok',
        '- **sandbox**: worktree',
        '- **color**: #d9a441',
        '- **prompt**: You are Grok Scout. Quickly investigate bugs, trace logs, and propose fast fixes.',
        '',
        '### 🛡️ Sentinel QA (@qa)',
        '- **id**: bot-qa',
        '- **role**: Verification, Security & Browser Tester',
        '- **agent**: claude',
        '- **model**: sonnet',
        '- **sandbox**: worktree',
        '- **color**: #c678dd',
        '- **prompt**: You are Sentinel QA. Verify behavior, run test suites, and catch regressions.',
        '',
        '## Channels',
        '',
        '### #general-squad',
        '- **description**: Main war room — mention @lead, @builder, @scout, @qa or @all',
        '- **members**: @lead, @builder, @scout, @qa',
        '',
        '### #feature-delivery',
        '- **description**: Architecture & implementation room (@lead + @builder)',
        '- **members**: @lead, @builder',
      ].join('\n'),
    },
    fullstack_trio: {
      label: '🚀 Full-Stack Startup Trio (Architect + Frontend + Backend)',
      markdown: [
        '# AgentSense Team Playbook',
        '',
        '## Bots',
        '',
        '### 🧠 Staff Architect (@arch)',
        '- **id**: bot-arch',
        '- **role**: System Architect & Code Reviewer',
        '- **agent**: claude',
        '- **model**: opus',
        '- **sandbox**: worktree',
        '- **color**: #5b8def',
        '- **prompt**: Design clean APIs, review schemas, and keep the codebase modular.',
        '',
        '### 🎨 Pixel UI (@ui)',
        '- **id**: bot-ui',
        '- **role**: Frontend & UX Engineer',
        '- **agent**: claude',
        '- **model**: sonnet',
        '- **sandbox**: worktree',
        '- **browser_url**: http://localhost:3000',
        '- **color**: #e5c07b',
        '- **prompt**: Build responsive, accessible UI components and verify them in the browser sandbox.',
        '',
        '### ⚙️ Core API (@api)',
        '- **id**: bot-api',
        '- **role**: Backend, DB & Performance Bot',
        '- **agent**: codex',
        '- **model**: gpt-5.1-codex',
        '- **sandbox**: worktree',
        '- **color**: #3fb950',
        '- **prompt**: Write fast, safe backend services, IPC handlers, and unit tests.',
        '',
        '## Channels',
        '',
        '### #product-room',
        '- **description**: Full-stack product squad (@arch, @ui, @api)',
        '- **members**: @arch, @ui, @api',
      ].join('\n'),
    },
  };

  function el(tag, class_name, text) {
    const node = document.createElement(tag);
    if (class_name) node.className = class_name;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function catalog_list() {
    return Array.isArray(window.AGENT_CATALOG) ? window.AGENT_CATALOG : [];
  }

  function find_agent_meta(agent_id) {
    return catalog_list().find((a) => a.id === agent_id) || { id: agent_id || 'claude', label: agent_id || 'Agent', models: [] };
  }

  function init_squad_chat(options) {
    const opts = options || {};
    const container = opts.container;
    const on_open_terminal_pane = typeof opts.on_open_terminal_pane === 'function' ? opts.on_open_terminal_pane : () => {};
    const on_switch_to_grid = typeof opts.on_switch_to_grid === 'function' ? opts.on_switch_to_grid : () => {};

    let current_workspace = null;
    let squad_state = {
      bots: [],
      channels: [],
      capabilities: { worktree: false, wsl: false, docker: false, browser: true },
      available_agents: {},
      bot_computers: {},
    };
    // Active thread: 'chan:<id>' or 'dm:<bot_id>'
    let active_thread_id = 'chan:chan-squad';
    let messages = [];
    let computer_drawer_open = true;
    let inspected_bot_id = null;
    let computer_tab = 'screen'; // 'screen' | 'browser' | 'env'
    let live_screen_cache = { alive: false, text: '', terminal_id: null, cwd: null, worktree: null, status: 'idle' };
    let screen_poll_timer = null;

    // Build root skeleton
    const root = el('div', 'sq_root');
    const rail = el('aside', 'sq_rail');
    const center = el('section', 'sq_center');
    const drawer = el('aside', 'sq_computer_drawer');
    root.append(rail, center, drawer);
    container.replaceChildren(root);

    function active_bot() {
      if (active_thread_id.startsWith('dm:')) {
        const id = active_thread_id.slice(3);
        const found = squad_state.bots.find((b) => b.id === id);
        if (found) return found;
      }
      const chan = active_channel();
      if (chan && chan.lead_bot_id) {
        const lead = squad_state.bots.find((b) => b.id === chan.lead_bot_id);
        if (lead) return lead;
      }
      return squad_state.bots[0] || null;
    }

    function active_channel() {
      if (!active_thread_id.startsWith('chan:')) return null;
      const id = active_thread_id.slice(5);
      return squad_state.channels.find((c) => c.id === id) || squad_state.channels[0] || null;
    }

    function current_inspected_bot() {
      if (inspected_bot_id) {
        const found = squad_state.bots.find((b) => b.id === inspected_bot_id);
        if (found) return found;
      }
      return active_bot();
    }

    async function load_state_and_messages() {
      if (!window.hub || !window.hub.squad) return;
      const ws_id = current_workspace ? current_workspace.id : null;
      try {
        squad_state = await window.hub.squad.get_state(ws_id);
      } catch (error) {
        console.error('squad.get_state failed:', error);
      }
      // Validate active_thread_id
      const valid_chan = active_thread_id.startsWith('chan:') &&
        squad_state.channels.some((c) => `chan:${c.id}` === active_thread_id);
      const valid_dm = active_thread_id.startsWith('dm:') &&
        squad_state.bots.some((b) => `dm:${b.id}` === active_thread_id);
      if (!valid_chan && !valid_dm) {
        if (squad_state.channels[0]) active_thread_id = `chan:${squad_state.channels[0].id}`;
        else if (squad_state.bots[0]) active_thread_id = `dm:${squad_state.bots[0].id}`;
      }
      const bot = active_bot();
      if (bot && (!inspected_bot_id || !squad_state.bots.some((b) => b.id === inspected_bot_id))) {
        inspected_bot_id = bot.id;
      }
      if (ws_id) {
        try {
          messages = await window.hub.squad.list_messages(ws_id, active_thread_id);
        } catch (error) {
          messages = [];
        }
      } else {
        messages = [];
      }
      render_all();
      refresh_computer_screen();
    }

    async function select_thread(thread_id) {
      active_thread_id = thread_id;
      if (thread_id.startsWith('dm:')) {
        inspected_bot_id = thread_id.slice(3);
      } else {
        const b = active_bot();
        if (b) inspected_bot_id = b.id;
      }
      if (current_workspace) {
        messages = await window.hub.squad.list_messages(current_workspace.id, active_thread_id).catch(() => []);
      } else {
        messages = [];
      }
      render_all();
      refresh_computer_screen();
    }

    // ---- Render Left Rail ----
    function render_rail() {
      rail.replaceChildren();
      const header = el('div', 'sq_rail_header');
      const title_wrap = el('div', 'sq_rail_title_wrap');
      title_wrap.append(
        el('span', 'sq_rail_title', current_workspace ? current_workspace.name : 'No Workspace'),
        el('span', 'sq_rail_subtitle', `${squad_state.bots.length} Bots · OpenMaus Mode`)
      );
      const playbook_btn = el('button', 'sq_playbook_btn', '📋 Playbooks');
      playbook_btn.type = 'button';
      playbook_btn.title = 'Import or Export Portable Team Playbooks (Markdown)';
      playbook_btn.addEventListener('click', () => open_playbook_modal());
      header.append(title_wrap, playbook_btn);

      const scroll = el('div', 'sq_rail_scroll');

      // Channels section
      const chan_head = el('div', 'sq_section_head');
      chan_head.append(el('span', '', 'Channels / Rooms'));
      const add_chan_btn = el('button', 'sq_section_add', '+');
      add_chan_btn.type = 'button';
      add_chan_btn.title = 'Create multi-bot channel';
      add_chan_btn.addEventListener('click', () => open_channel_modal());
      chan_head.append(add_chan_btn);

      const chan_list = el('ul', 'sq_nav_list');
      for (const chan of squad_state.channels) {
        const li = el('li', 'sq_nav_item');
        const t_id = `chan:${chan.id}`;
        const row = el('div', 'sq_nav_row' + (active_thread_id === t_id ? ' active' : ''));
        row.dataset.thread_id = t_id;
        const hash = el('span', 'sq_chan_hash', '#');
        const meta = el('div', 'sq_nav_meta');
        const name_line = el('div', 'sq_nav_name_line');
        name_line.append(
          el('span', 'sq_nav_name', chan.name),
          el('span', 'sq_nav_handle', `${chan.bot_ids.length} bots`)
        );
        const sub = el('div', 'sq_nav_sub', chan.description);
        meta.append(name_line, sub);
        row.append(hash, meta);
        row.addEventListener('click', () => select_thread(t_id));
        li.append(row);
        chan_list.append(li);
      }

      // Direct Bots Roster section
      const bot_head = el('div', 'sq_section_head');
      bot_head.append(el('span', '', 'Bot roster'));
      const add_bot_btn = el('button', 'sq_section_add', '+');
      add_bot_btn.type = 'button';
      add_bot_btn.title = 'Add a new AI Bot to the squad';
      add_bot_btn.addEventListener('click', () => open_bot_modal(null));
      bot_head.append(add_bot_btn);

      const bot_list = el('ul', 'sq_nav_list');
      for (const bot of squad_state.bots) {
        const li = el('li', 'sq_nav_item');
        const t_id = `dm:${bot.id}`;
        const comp = squad_state.bot_computers[bot.id] || null;
        const status_state = comp ? comp.status : 'idle';
        const agent_meta = find_agent_meta(bot.agent_id);

        const row = el('div', 'sq_nav_row' + (active_thread_id === t_id ? ' active' : ''));
        row.dataset.thread_id = t_id;
        row.dataset.bot_id = bot.id;

        const avatar = el('div', 'sq_bot_avatar', bot.avatar || '🤖');
        avatar.style.borderColor = bot.color || '#5b8def';
        const dot = el('span', `sq_bot_status_dot ${status_state}`);
        avatar.append(dot);

        const meta = el('div', 'sq_nav_meta');
        const name_line = el('div', 'sq_nav_name_line');
        name_line.append(
          el('span', 'sq_nav_name', bot.name),
          el('span', 'sq_nav_handle', `@${bot.handle}`)
        );
        const sub = el('div', 'sq_nav_sub');
        const brain_label = bot.model_id ? `${agent_meta.label} · ${bot.model_id}` : agent_meta.label;
        sub.append(
          el('span', 'sq_pill', brain_label),
          el('span', 'sq_pill', bot.sandbox_mode)
        );
        meta.append(name_line, sub);
        row.append(avatar, meta);
        row.addEventListener('click', () => select_thread(t_id));
        li.append(row);
        bot_list.append(li);
      }

      scroll.append(chan_head, chan_list, bot_head, bot_list);
      rail.append(header, scroll);
    }

    // ---- Render Center Chat ----
    function render_center() {
      center.replaceChildren();
      const header = el('div', 'sq_chat_header');
      const left = el('div', 'sq_chat_header_left');
      const target_bot = active_bot();
      const chan = active_channel();

      if (chan) {
        const badge = el('div', 'sq_bot_avatar', '#');
        const block = el('div', 'sq_chat_title_block');
        block.append(
          el('div', 'sq_chat_title', `#${chan.name}`),
          el('div', 'sq_chat_desc', chan.description)
        );
        left.append(badge, block);
      } else if (target_bot) {
        const badge = el('div', 'sq_bot_avatar', target_bot.avatar);
        badge.style.borderColor = target_bot.color || '#5b8def';
        const block = el('div', 'sq_chat_title_block');
        block.append(
          el('div', 'sq_chat_title', `${target_bot.name} (@${target_bot.handle})`),
          el('div', 'sq_chat_desc', target_bot.role)
        );
        left.append(badge, block);
      }

      // Controls: Brain Picker (CLI + Model + Sandbox) for target_bot
      const controls = el('div', 'sq_chat_controls');
      if (target_bot) {
        // 1. CLI Agent selector
        const cli_group = el('div', 'sq_control_group');
        cli_group.append(el('span', 'sq_control_label', chan ? `Lead (@${target_bot.handle}) CLI:` : 'Brain:'));
        const cli_select = el('select', 'sq_select');
        cli_select.dataset.action = 'switch_bot_cli';
        cli_select.title = 'Switch CLI Agent mid-conversation';
        for (const agent of catalog_list()) {
          const is_installed = Boolean(squad_state.available_agents[agent.command]);
          const opt = el('option', '', `${agent.label}${is_installed ? '' : ' (not installed)'}`);
          opt.value = agent.id;
          if (agent.id === target_bot.agent_id) opt.selected = true;
          cli_select.append(opt);
        }
        cli_select.addEventListener('change', async () => {
          const next_agent = find_agent_meta(cli_select.value);
          const next_model = next_agent.models && next_agent.models[0] ? next_agent.models[0] : null;
          await window.hub.squad.switch_brain({
            workspace_id: current_workspace ? current_workspace.id : null,
            bot_id: target_bot.id,
            agent_id: cli_select.value,
            model_id: next_model,
            restart_computer: true,
          });
          await load_state_and_messages();
        });
        cli_group.append(cli_select);
        controls.append(cli_group);

        // 2. Model selector (when the chosen CLI has model options)
        const current_agent_meta = find_agent_meta(target_bot.agent_id);
        if (Array.isArray(current_agent_meta.models) && current_agent_meta.models.length > 0) {
          const model_group = el('div', 'sq_control_group');
          model_group.append(el('span', 'sq_control_label', 'Model:'));
          const model_select = el('select', 'sq_select');
          model_select.dataset.action = 'switch_bot_model';
          const default_opt = el('option', '', 'CLI Default');
          default_opt.value = '';
          model_select.append(default_opt);
          for (const m of current_agent_meta.models) {
            const opt = el('option', '', m);
            opt.value = m;
            if (target_bot.model_id === m) opt.selected = true;
            model_select.append(opt);
          }
          model_select.addEventListener('change', async () => {
            await window.hub.squad.switch_brain({
              workspace_id: current_workspace ? current_workspace.id : null,
              bot_id: target_bot.id,
              model_id: model_select.value || null,
              restart_computer: true,
            });
            await load_state_and_messages();
          });
          model_group.append(model_select);
          controls.append(model_group);
        }

        // 3. Sandbox / VM selector
        const sb_group = el('div', 'sq_control_group');
        sb_group.append(el('span', 'sq_control_label', 'Computer:'));
        const sb_select = el('select', 'sq_select');
        sb_select.dataset.action = 'switch_bot_sandbox';
        for (const [mode_key, mode_label] of Object.entries(SANDBOX_LABELS)) {
          const opt = el('option', '', mode_label);
          opt.value = mode_key;
          if (target_bot.sandbox_mode === mode_key) opt.selected = true;
          sb_select.append(opt);
        }
        sb_select.addEventListener('change', async () => {
          await window.hub.squad.switch_brain({
            workspace_id: current_workspace ? current_workspace.id : null,
            bot_id: target_bot.id,
            sandbox_mode: sb_select.value,
            restart_computer: true,
          });
          await load_state_and_messages();
        });
        sb_group.append(sb_select);
        controls.append(sb_group);

        // Edit bot button
        const edit_btn = el('button', 'sq_btn', '⚙️ Bot');
        edit_btn.type = 'button';
        edit_btn.title = 'Customize bot persona, system prompt & sandbox';
        edit_btn.addEventListener('click', () => open_bot_modal(target_bot));
        controls.append(edit_btn);
      }

      // Toggle Bot Computer drawer
      const comp_btn = el('button', 'sq_btn' + (computer_drawer_open ? ' active' : ''), '🖥️ Bot Computer');
      comp_btn.type = 'button';
      comp_btn.dataset.action = 'toggle_computer_drawer';
      comp_btn.title = 'Show/Hide the Bot’s isolated live screen, terminal takeover & browser sandbox';
      comp_btn.addEventListener('click', () => {
        computer_drawer_open = !computer_drawer_open;
        drawer.hidden = !computer_drawer_open;
        comp_btn.classList.toggle('active', computer_drawer_open);
        if (computer_drawer_open) refresh_computer_screen();
      });
      controls.append(comp_btn);

      // Switch to full Terminal Grid
      const grid_btn = el('button', 'sq_btn', '🧩 Terminal Grid');
      grid_btn.type = 'button';
      grid_btn.title = 'Switch to the multi-pane Terminal Grid workbench';
      grid_btn.addEventListener('click', () => on_switch_to_grid());
      controls.append(grid_btn);

      header.append(left, controls);

      // Messages Stream
      const msg_list = el('div', 'sq_messages');
      if (!current_workspace) {
        const empty = el('div', 'sq_empty_state');
        empty.append(
          el('h3', 'sq_empty_title', 'Pick or add a Workspace folder in the left sidebar'),
          el(
            'p',
            'sq_empty_desc',
            'Pick a workspace. Each bot then runs in a git worktree, a WSL shell, a Docker shell, or the shared folder. WSL and Docker are shells on this PC, not separate locked machines.'
          )
        );
        msg_list.append(empty);
      } else if (messages.length === 0) {
        const empty = el('div', 'sq_empty_state');
        empty.append(
          el(
            'h3',
            'sq_empty_title',
            chan ? `Welcome to #${chan.name}` : `Chat with ${target_bot ? target_bot.name : 'Bot'}`
          ),
          el(
            'p',
            'sq_empty_desc',
            'Mention a bot, or @all. A Claude lead plans a multi-file job with /agentsense:lead, which runs workers in their own worktrees and waits for you before merging. Other bots do the task you give them in this chat.'
          )
        );
        const chips = el('div', 'sq_starter_chips');
        const starters = [
          '@lead Summarize the architecture of this repository and suggest next steps',
          '@builder Check git status and run the project test suite',
          '@scout Scan for potential edge cases or stability issues',
          '@all Give me a quick status check from each specialist bot',
        ];
        for (const prompt_text of starters) {
          const chip = el('button', 'sq_chip', prompt_text);
          chip.type = 'button';
          chip.addEventListener('click', () => submit_chat_message(prompt_text));
          chips.append(chip);
        }
        empty.append(chips);
        msg_list.append(empty);
      } else {
        for (const msg of messages) {
          msg_list.append(build_message_node(msg));
        }
      }

      // Composer
      const composer = el('div', 'sq_composer');
      const mention_bar = el('div', 'sq_mention_bar');
      mention_bar.append(el('span', 'sq_mention_label', 'Address:'));

      const input = el('textarea', 'sq_input');
      input.rows = 2;
      input.placeholder = chan
        ? `Message #${chan.name} — type @lead, @builder, @scout, @qa or @all (Enter to send, Shift+Enter for newline)`
        : `Message ${target_bot ? target_bot.name : 'bot'} (${target_bot ? target_bot.agent_id : 'cli'})…`;

      const insert_mention = (tag) => {
        const cur = input.value;
        input.value = cur ? `${cur.trimEnd()} ${tag} ` : `${tag} `;
        input.focus();
      };

      const all_pill = el('button', 'sq_mention_pill', '@all (Entire Squad)');
      all_pill.type = 'button';
      all_pill.addEventListener('click', () => insert_mention('@all'));
      mention_bar.append(all_pill);

      for (const b of squad_state.bots) {
        const pill = el('button', 'sq_mention_pill', `${b.avatar} @${b.handle}`);
        pill.type = 'button';
        pill.addEventListener('click', () => insert_mention(`@${b.handle}`));
        mention_bar.append(pill);
      }

      if (messages.length > 0 && current_workspace) {
        const clear_btn = el('button', 'sq_mention_pill', '🗑️ Clear thread');
        clear_btn.type = 'button';
        clear_btn.style.marginLeft = 'auto';
        clear_btn.addEventListener('click', async () => {
          await window.hub.squad.clear_messages(current_workspace.id, active_thread_id);
          messages = [];
          render_center();
        });
        mention_bar.append(clear_btn);
      }

      const row = el('div', 'sq_composer_row');
      const send_btn = el('button', 'sq_btn primary', 'Send ⏎');
      send_btn.type = 'button';
      send_btn.dataset.action = 'send_squad_message';
      send_btn.addEventListener('click', () => {
        const val = input.value.trim();
        if (!val) return;
        input.value = '';
        submit_chat_message(val);
      });

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          const val = input.value.trim();
          if (!val) return;
          input.value = '';
          submit_chat_message(val);
        }
      });

      row.append(input, send_btn);
      composer.append(mention_bar, row);

      center.append(header, msg_list, composer);
      msg_list.scrollTop = msg_list.scrollHeight;
    }

    function build_message_node(msg) {
      const is_user = msg.sender_type === 'user';
      const wrap = el('div', 'sq_msg' + (is_user ? ' user' : ' bot'));
      wrap.dataset.message_id = msg.id;

      const avatar = el('div', 'sq_msg_avatar', msg.sender_avatar || (is_user ? '👤' : '🤖'));
      if (!is_user && msg.sender_color) avatar.style.borderColor = msg.sender_color;

      const body = el('div', 'sq_msg_body');
      const head = el('div', 'sq_msg_head');
      head.append(el('span', 'sq_msg_sender', msg.sender_name || (is_user ? 'You' : 'Bot')));

      if (!is_user) {
        if (msg.agent_id) {
          const brain_txt = msg.model_id ? `${msg.agent_id} · ${msg.model_id}` : msg.agent_id;
          head.append(el('span', 'sq_msg_badge', brain_txt));
        }
        if (msg.sandbox_mode) {
          head.append(el('span', 'sq_msg_badge', SANDBOX_LABELS[msg.sandbox_mode] || msg.sandbox_mode));
        }
        const status_cls = msg.status || 'done';
        const status_lbl =
          status_cls === 'working'
            ? '● Working…'
            : status_cls === 'waiting'
            ? '⚠️ Waiting Approval'
            : status_cls === 'ended'
            ? 'Exited'
            : '✓ Ready';
        head.append(el('span', `sq_msg_status ${status_cls}`, status_lbl));
      }

      const text_pre = el('pre', 'sq_msg_text', msg.text || '');
      body.append(head, text_pre);

      // Human-in-the-Loop Inline Approval Card when waiting for confirmation
      if (!is_user && msg.approval && (msg.approval.required || msg.approval.state !== 'pending')) {
        const is_pending = msg.approval.required && msg.approval.state === 'pending';
        const card = el('div', 'sq_approval_card' + (is_pending ? '' : ' resolved'));
        card.append(
          el(
            'div',
            'sq_approval_title',
            is_pending
              ? '🛡️ Inline Permission Broker — Bot is asking for confirmation:'
              : `✓ Decision recorded (${msg.approval.state})`
          ),
          el('div', 'sq_approval_excerpt', msg.approval.prompt_excerpt || '')
        );
        if (is_pending && msg.bot_id) {
          const act = el('div', 'sq_approval_actions');
          const add_decision_btn = (label, decision, cls) => {
            const btn = el('button', `sq_mini_btn ${cls || ''}`, label);
            btn.type = 'button';
            btn.addEventListener('click', () => send_inline_decision(msg, decision));
            act.append(btn);
          };
          add_decision_btn('✓ Approve (1)', 'approve_yes', 'approve');
          add_decision_btn('⚡ Allow All (2)', 'approve_always', 'approve');
          add_decision_btn('✓ Yes (y)', 'yes_y', 'approve');
          add_decision_btn('✕ Deny (Esc)', 'deny', 'deny');
          add_decision_btn('🛑 Ctrl+C', 'ctrlc', 'deny');
          card.append(act);
        }
        body.append(card);
      }

      // Quick actions bar on bot replies (Open Live Computer, Quick Approve/Enter, Open in Terminal Grid)
      if (!is_user && msg.bot_id) {
        const footer = el('div', 'sq_msg_footer_actions');
        const inspect_btn = el('button', 'sq_mini_btn', '🖥️ Inspect Computer & Screen');
        inspect_btn.type = 'button';
        inspect_btn.addEventListener('click', () => {
          inspected_bot_id = msg.bot_id;
          computer_drawer_open = true;
          drawer.hidden = false;
          render_drawer();
          refresh_computer_screen();
        });
        footer.append(inspect_btn);

        const enter_btn = el('button', 'sq_mini_btn', '⏎ Send Enter / 1');
        enter_btn.type = 'button';
        enter_btn.title = 'Send 1 + Enter to this bot if it is waiting on a prompt';
        enter_btn.addEventListener('click', () => send_inline_decision(msg, 'approve_yes'));
        footer.append(enter_btn);

        if (msg.terminal_id) {
          const term_btn = el('button', 'sq_mini_btn', '🧩 Focus in Terminal Grid');
          term_btn.type = 'button';
          term_btn.addEventListener('click', () => {
            on_open_terminal_pane(current_workspace, msg.terminal_id);
          });
          footer.append(term_btn);
        }
        body.append(footer);
      }

      wrap.append(avatar, body);
      return wrap;
    }

    async function send_inline_decision(msg, decision) {
      if (!current_workspace || !msg.bot_id) return;
      try {
        await window.hub.squad.send_approval({
          workspace_id: current_workspace.id,
          thread_id: active_thread_id,
          message_id: msg.id,
          bot_id: msg.bot_id,
          decision,
        });
        await refresh_computer_screen();
      } catch (error) {
        window.alert(`Could not send approval: ${error.message}`);
      }
    }

    async function submit_chat_message(text) {
      if (!current_workspace) {
        window.alert('Please add or select a workspace folder in the left sidebar first.');
        return;
      }
      try {
        await window.hub.squad.send_message({
          workspace_id: current_workspace.id,
          thread_id: active_thread_id,
          text,
        });
      } catch (error) {
        window.alert(`Could not send message: ${error.message}`);
      }
    }

    // ---- Render Right Drawer: Bot's Personal Computer ----
    function render_drawer() {
      drawer.hidden = !computer_drawer_open;
      drawer.replaceChildren();
      const bot = current_inspected_bot();
      if (!bot) return;

      const header = el('div', 'sq_comp_header');
      const title = el('div', 'sq_comp_title');
      // Bot switcher dropdown inside computer drawer
      const bot_picker = el('select', 'sq_select');
      for (const b of squad_state.bots) {
        const opt = el('option', '', `${b.avatar} ${b.name} (@${b.handle}) — Computer`);
        opt.value = b.id;
        if (b.id === bot.id) opt.selected = true;
        bot_picker.append(opt);
      }
      bot_picker.addEventListener('change', () => {
        inspected_bot_id = bot_picker.value;
        render_drawer();
        refresh_computer_screen();
      });
      title.append(bot_picker);

      const boot_btn = el(
        'button',
        'sq_btn primary',
        live_screen_cache.alive ? '🔄 Restart computer' : '⚡ Boot computer'
      );
      boot_btn.type = 'button';
      boot_btn.dataset.action = 'boot_bot_computer';
      boot_btn.addEventListener('click', async () => {
        if (!current_workspace) {
          window.alert('Select a workspace folder first.');
          return;
        }
        try {
          await window.hub.squad.ensure_computer({
            workspace_id: current_workspace.id,
            bot_id: bot.id,
            force_restart: Boolean(live_screen_cache.alive),
          });
          await load_state_and_messages();
        } catch (error) {
          window.alert(`Could not start computer: ${error.message}`);
        }
      });
      header.append(title, boot_btn);

      // Sub-tabs: Live Terminal Screen | Isolated Browser | Sandbox Info
      const tabs = el('div', 'sq_comp_tabs');
      const tab_defs = [
        { id: 'screen', label: '🖥️ Live Screen & Takeover' },
        { id: 'browser', label: '🌐 Browser Sandbox' },
        { id: 'env', label: '🌳 Worktree & shell' },
      ];
      for (const t of tab_defs) {
        const b = el('button', 'sq_comp_tab' + (computer_tab === t.id ? ' active' : ''), t.label);
        b.type = 'button';
        b.dataset.tab = t.id;
        b.addEventListener('click', () => {
          computer_tab = t.id;
          render_drawer();
        });
        tabs.append(b);
      }

      const body = el('div', 'sq_comp_body');

      if (computer_tab === 'screen') {
        const status_bar = el('div', 'sq_nav_sub');
        status_bar.append(
          el('span', 'sq_pill', live_screen_cache.alive ? `🟢 Running (${bot.agent_id})` : '⚪ Not booted yet'),
          el('span', 'sq_pill', SANDBOX_LABELS[bot.sandbox_mode] || bot.sandbox_mode)
        );
        if (live_screen_cache.worktree && live_screen_cache.worktree.branch) {
          status_bar.append(el('span', 'sq_pill', `🌿 ${live_screen_cache.worktree.branch}`));
        }

        const screen_pre = el(
          'pre',
          'sq_screen_box',
          live_screen_cache.alive
            ? live_screen_cache.text || '(Waiting for terminal output…)'
            : `Click "⚡ Boot computer" or send a chat message to launch ${bot.name}.`
        );
        screen_pre.id = 'sq_live_screen_box';

        // Direct Takeover controls
        const takeover = el('div', 'sq_takeover_bar');
        const quick_keys = el('div', 'sq_quick_keys');
        quick_keys.append(el('span', 'sq_mention_label', 'Takeover Keys:'));
        const keys = [
          { label: '1 (Yes)', data: '1\r' },
          { label: '2 (Allow)', data: '2\r' },
          { label: 'y', data: 'y\r' },
          { label: 'n', data: 'n\r' },
          { label: '⏎ Enter', data: '\r' },
          { label: 'Esc', data: '\x1b' },
          { label: '^C', data: '\x03' },
          { label: '↑', data: '\x1b[A' },
          { label: '↓', data: '\x1b[B' },
        ];
        for (const k of keys) {
          const kb = el('button', 'sq_mini_btn', k.label);
          kb.type = 'button';
          kb.addEventListener('click', () => {
            if (!live_screen_cache.terminal_id) return;
            window.hub.terminals.write(live_screen_cache.terminal_id, k.data);
            window.setTimeout(refresh_computer_screen, 220);
          });
          quick_keys.append(kb);
        }

        const cmd_row = el('div', 'sq_browser_bar');
        const cmd_input = el('input', 'sq_browser_url');
        cmd_input.type = 'text';
        cmd_input.placeholder = `Type directly into ${bot.name}'s terminal (Takeover)…`;
        const cmd_send = el('button', 'sq_btn', 'Send');
        cmd_send.type = 'button';
        const trigger_direct_send = () => {
          if (!live_screen_cache.terminal_id || !cmd_input.value) return;
          window.hub.terminals.write(live_screen_cache.terminal_id, `${cmd_input.value}\r`);
          cmd_input.value = '';
          window.setTimeout(refresh_computer_screen, 250);
        };
        cmd_send.addEventListener('click', trigger_direct_send);
        cmd_input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            trigger_direct_send();
          }
        });
        cmd_row.append(cmd_input, cmd_send);
        takeover.append(quick_keys, cmd_row);

        body.append(status_bar, screen_pre, takeover);
      } else if (computer_tab === 'browser') {
        const url_bar = el('div', 'sq_browser_bar');
        const url_input = el('input', 'sq_browser_url');
        url_input.type = 'url';
        url_input.value = bot.browser_url || 'https://example.com';
        const go_btn = el('button', 'sq_btn', 'Go');
        go_btn.type = 'button';

        const webview_wrap = el('div', 'sq_webview_wrap');
        const webview = document.createElement('webview');
        webview.className = 'sq_webview';
        // Isolated Chromium partition per bot so cookies/storage never collide!
        webview.setAttribute('partition', `persist:bot_${bot.id}`);
        webview.setAttribute('src', url_input.value);
        webview_wrap.append(webview);

        const navigate = async () => {
          let target = url_input.value.trim();
          if (target && !/^https?:\/\//i.test(target)) target = `http://${target}`;
          url_input.value = target;
          webview.setAttribute('src', target);
          await window.hub.squad.save_bot({ ...bot, browser_url: target }, current_workspace ? current_workspace.id : null);
        };
        go_btn.addEventListener('click', navigate);
        url_input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            navigate();
          }
        });

        url_bar.append(url_input, go_btn);
        body.append(
          el('div', 'sq_nav_sub', `Isolated Chromium Partition: persist:bot_${bot.id}`),
          url_bar,
          webview_wrap
        );
      } else {
        // 'env' tab: Sandbox & Worktree details
        const card = el('div', 'sq_env_card');
        const add_row = (k, v) => {
          const r = el('div', 'sq_env_row');
          r.append(el('span', 'sq_env_key', k), el('span', 'sq_env_val', v || '—'));
          card.append(r);
        };
        add_row('Bot Identity', `${bot.avatar} ${bot.name} (@${bot.handle})`);
        add_row('CLI Brain', `${bot.agent_id}${bot.model_id ? ` (${bot.model_id})` : ''}`);
        add_row('Configured Sandbox', SANDBOX_LABELS[bot.sandbox_mode] || bot.sandbox_mode);
        add_row('Live Status', live_screen_cache.alive ? `Running (${live_screen_cache.status})` : 'Stopped');
        add_row('Isolated Directory', live_screen_cache.cwd || (current_workspace ? current_workspace.path : '—'));
        add_row(
          'Git Worktree Branch',
          live_screen_cache.worktree ? live_screen_cache.worktree.branch : 'Created automatically on launch'
        );
        add_row('Browser Partition', `persist:bot_${bot.id}`);

        const cap_card = el('div', 'sq_env_card');
        cap_card.append(el('strong', '', 'What this PC can run'));
        const caps = squad_state.capabilities || {};
        const add_cap = (name, ok) => {
          const r = el('div', 'sq_env_row');
          r.append(el('span', 'sq_env_key', name), el('span', 'sq_env_val', ok ? '✅ Ready' : '⚪ Not detected'));
          cap_card.append(r);
        };
        add_cap('Git Worktree Isolation', caps.worktree);
        add_cap('WSL shell (wsl.exe)', caps.wsl);
        add_cap('Docker engine', caps.docker);
        add_cap('Isolated Chromium Browser', caps.browser);

        body.append(card, cap_card);
        if (live_screen_cache.terminal_id) {
          const open_grid_btn = el('button', 'sq_btn primary', '🧩 Open Full Xterm Pane in Terminal Grid');
          open_grid_btn.type = 'button';
          open_grid_btn.addEventListener('click', () => {
            on_open_terminal_pane(current_workspace, live_screen_cache.terminal_id);
          });
          body.append(open_grid_btn);
        }
      }

      drawer.append(header, tabs, body);
    }

    async function refresh_computer_screen() {
      const bot = current_inspected_bot();
      if (!bot || !current_workspace || !window.hub || !window.hub.squad) return;
      try {
        const res = await window.hub.squad.get_computer_screen({
          workspace_id: current_workspace.id,
          bot_id: bot.id,
        });
        const prev_alive = live_screen_cache.alive;
        const prev_terminal = live_screen_cache.terminal_id;
        live_screen_cache = res || { alive: false, text: '', terminal_id: null };
        const screen_box = document.getElementById('sq_live_screen_box');
        if (screen_box && computer_tab === 'screen') {
          screen_box.textContent = live_screen_cache.alive
            ? live_screen_cache.text || '(Waiting for terminal output…)'
            : `Click "⚡ Boot computer" or send a chat message to launch ${bot.name}.`;
          screen_box.scrollTop = screen_box.scrollHeight;
        }
        if (prev_alive !== live_screen_cache.alive || prev_terminal !== live_screen_cache.terminal_id) {
          render_drawer();
        }
      } catch (error) {
        // Ignore transient errors
      }
    }

    // ---- Modals: Add/Edit Bot, Add Channel, Playbooks ----
    function open_bot_modal(existing_bot) {
      const is_edit = Boolean(existing_bot);
      const backdrop = el('div', 'sq_modal_backdrop');
      const modal = el('div', 'sq_modal');
      modal.append(el('h3', 'sq_modal_title', is_edit ? `Configure ${existing_bot.name}` : 'Add AI Bot to Squad'));

      const make_field = (label_text, input_node) => {
        const f = el('div', 'sq_field');
        f.append(el('label', '', label_text), input_node);
        modal.append(f);
        return input_node;
      };

      const name_in = make_field('Bot Name', el('input'));
      name_in.value = existing_bot ? existing_bot.name : 'Nova Coder';

      const handle_in = make_field('Handle (@mention)', el('input'));
      handle_in.value = existing_bot ? existing_bot.handle : 'nova';

      const avatar_in = make_field('Avatar Emoji', el('input'));
      avatar_in.value = existing_bot ? existing_bot.avatar : '🤖';

      const role_in = make_field('Role Title', el('input'));
      role_in.value = existing_bot ? existing_bot.role : 'Autonomous Specialist Bot';

      const agent_sel = el('select');
      for (const a of catalog_list()) {
        const opt = el('option', '', `${a.label} (${a.command})`);
        opt.value = a.id;
        if (existing_bot && existing_bot.agent_id === a.id) opt.selected = true;
        agent_sel.append(opt);
      }
      make_field('CLI Brain (Claude Code, Codex, Grok…)', agent_sel);

      const sb_sel = el('select');
      for (const [k, v] of Object.entries(SANDBOX_LABELS)) {
        const opt = el('option', '', v);
        opt.value = k;
        if (existing_bot && existing_bot.sandbox_mode === k) opt.selected = true;
        sb_sel.append(opt);
      }
      make_field('Isolated Computer / Sandbox Mode', sb_sel);

      const prompt_in = make_field('System Persona / Instructions', el('textarea'));
      prompt_in.rows = 3;
      prompt_in.value = existing_bot ? existing_bot.system_prompt || '' : '';

      const actions = el('div', 'sq_modal_actions');
      if (is_edit && squad_state.bots.length > 1) {
        const del_btn = el('button', 'sq_btn danger', 'Delete Bot');
        del_btn.type = 'button';
        del_btn.style.marginRight = 'auto';
        del_btn.addEventListener('click', async () => {
          await window.hub.squad.remove_bot(existing_bot.id, current_workspace ? current_workspace.id : null);
          backdrop.remove();
          await load_state_and_messages();
        });
        actions.append(del_btn);
      }
      const cancel_btn = el('button', 'sq_btn', 'Cancel');
      cancel_btn.type = 'button';
      cancel_btn.addEventListener('click', () => backdrop.remove());

      const save_btn = el('button', 'sq_btn primary', 'Save Bot');
      save_btn.type = 'button';
      save_btn.addEventListener('click', async () => {
        const res = await window.hub.squad.save_bot(
          {
            id: existing_bot ? existing_bot.id : undefined,
            name: name_in.value,
            handle: handle_in.value,
            avatar: avatar_in.value,
            role: role_in.value,
            agent_id: agent_sel.value,
            sandbox_mode: sb_sel.value,
            system_prompt: prompt_in.value,
          },
          current_workspace ? current_workspace.id : null
        );
        backdrop.remove();
        if (res && res.bot) {
          active_thread_id = `dm:${res.bot.id}`;
          inspected_bot_id = res.bot.id;
        }
        await load_state_and_messages();
      });

      actions.append(cancel_btn, save_btn);
      modal.append(actions);
      backdrop.append(modal);
      document.body.append(backdrop);
    }

    function open_channel_modal() {
      const backdrop = el('div', 'sq_modal_backdrop');
      const modal = el('div', 'sq_modal');
      modal.append(el('h3', 'sq_modal_title', 'Create Multi-Bot Channel'));

      const name_f = el('div', 'sq_field');
      const name_in = el('input');
      name_in.placeholder = 'e.g. backend-refactor';
      name_f.append(el('label', '', 'Channel Name'), name_in);

      const desc_f = el('div', 'sq_field');
      const desc_in = el('input');
      desc_in.placeholder = 'What does this squad room focus on?';
      desc_f.append(el('label', '', 'Description'), desc_in);

      const members_f = el('div', 'sq_field');
      members_f.append(el('label', '', 'Bots in this Room'));
      const checks = [];
      for (const b of squad_state.bots) {
        const row = el('label', '');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '6px';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.value = b.id;
        checks.push(cb);
        row.append(cb, document.createTextNode(`${b.avatar} ${b.name} (@${b.handle})`));
        members_f.append(row);
      }

      const actions = el('div', 'sq_modal_actions');
      const cancel_btn = el('button', 'sq_btn', 'Cancel');
      cancel_btn.type = 'button';
      cancel_btn.addEventListener('click', () => backdrop.remove());
      const save_btn = el('button', 'sq_btn primary', 'Create Channel');
      save_btn.type = 'button';
      save_btn.addEventListener('click', async () => {
        const picked = checks.filter((c) => c.checked).map((c) => c.value);
        const res = await window.hub.squad.save_channel(
          {
            name: name_in.value || 'new-room',
            description: desc_in.value || 'Multi-bot channel',
            bot_ids: picked,
          },
          current_workspace ? current_workspace.id : null
        );
        backdrop.remove();
        if (res && res.channel) {
          active_thread_id = `chan:${res.channel.id}`;
        }
        await load_state_and_messages();
      });
      actions.append(cancel_btn, save_btn);
      modal.append(name_f, desc_f, members_f, actions);
      backdrop.append(modal);
      document.body.append(backdrop);
    }

    async function open_playbook_modal() {
      const current_md = await window.hub.squad.export_playbook().catch(() => '');
      const backdrop = el('div', 'sq_modal_backdrop');
      const modal = el('div', 'sq_modal');
      modal.append(
        el('h3', 'sq_modal_title', '📋 Portable Team Playbooks (OpenMausBot Markdown)'),
        el(
          'p',
          'sq_chat_desc',
          'Install a complete multi-bot team from a Markdown Playbook or export your current roster.'
        )
      );

      const preset_row = el('div', 'sq_starter_chips');
      const md_area = el('textarea');
      md_area.rows = 12;
      md_area.style.fontFamily = '"Cascadia Mono", Consolas, monospace';
      md_area.value = current_md;

      for (const tpl of Object.values(PLAYBOOK_TEMPLATES)) {
        const chip = el('button', 'sq_chip', tpl.label);
        chip.type = 'button';
        chip.addEventListener('click', () => {
          md_area.value = tpl.markdown;
        });
        preset_row.append(chip);
      }

      const f = el('div', 'sq_field');
      f.append(el('label', '', 'Playbook Markdown'), md_area);

      const actions = el('div', 'sq_modal_actions');
      const copy_btn = el('button', 'sq_btn', 'Copy Markdown');
      copy_btn.type = 'button';
      copy_btn.addEventListener('click', () => {
        window.hub.clipboard.write_text(md_area.value);
        copy_btn.textContent = '✓ Copied!';
      });
      const cancel_btn = el('button', 'sq_btn', 'Close');
      cancel_btn.type = 'button';
      cancel_btn.addEventListener('click', () => backdrop.remove());
      const apply_btn = el('button', 'sq_btn primary', 'Install Playbook');
      apply_btn.type = 'button';
      apply_btn.addEventListener('click', async () => {
        try {
          await window.hub.squad.import_playbook(md_area.value, current_workspace ? current_workspace.id : null);
          backdrop.remove();
          await load_state_and_messages();
        } catch (error) {
          window.alert(`Playbook error: ${error.message}`);
        }
      });

      actions.append(copy_btn, cancel_btn, apply_btn);
      modal.append(preset_row, f, actions);
      backdrop.append(modal);
      document.body.append(backdrop);
    }

    function render_all() {
      render_rail();
      render_center();
      render_drawer();
    }

    // Subscribe to real-time squad IPC events
    if (window.hub && window.hub.squad) {
      window.hub.squad.on_state_changed((next_state) => {
        if (!next_state) return;
        squad_state = next_state;
        render_rail();
        render_drawer();
      });
      window.hub.squad.on_message_added((payload) => {
        if (!payload || !current_workspace) return;
        if (payload.workspace_id === current_workspace.id && payload.thread_id === active_thread_id) {
          if (!messages.some((m) => m.id === payload.message.id)) {
            messages.push(payload.message);
            render_center();
          }
        }
      });
      window.hub.squad.on_message_updated((payload) => {
        if (!payload || !current_workspace) return;
        if (payload.workspace_id === current_workspace.id && payload.thread_id === active_thread_id) {
          const idx = messages.findIndex((m) => m.id === payload.message.id);
          if (idx !== -1) {
            messages[idx] = payload.message;
            render_center();
          }
        }
        refresh_computer_screen();
      });
    }

    screen_poll_timer = window.setInterval(() => {
      if (!container.hidden && computer_drawer_open && computer_tab === 'screen') {
        refresh_computer_screen();
      }
    }, 1500);

    return {
      show_workspace(workspace) {
        current_workspace = workspace || null;
        load_state_and_messages();
      },
      refresh() {
        return load_state_and_messages();
      },
      destroy() {
        if (screen_poll_timer) clearInterval(screen_poll_timer);
      },
    };
  }

  window.init_squad_chat = init_squad_chat;
})();
