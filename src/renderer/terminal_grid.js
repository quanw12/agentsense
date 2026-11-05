// Terminal grid: each workspace has pages of tiled terminal and file panes.
// Classic script (no import/export). Exposes window.init_terminal_grid(options).
// Depends on the globals Terminal (xterm) and FitAddon.FitAddon, on window.hub (preload.js) and on
// file_panel.js (window.init_file_panel) for the workspace file tree beside the sessions.
(function terminal_grid_module() {
  'use strict';

  // 100 unique first names, short and international. The first 12 keep their original order.
  const NAME_POOL = [
    'Matthew', 'John', 'Cynthia', 'Andy', 'Sarah', 'David', 'Emma', 'Lucas', 'Mia', 'Noah', 'Olivia', 'Ethan',
    'Aiko', 'Amara', 'Arjun', 'Ayumi', 'Bruno', 'Carlos', 'Chen', 'Clara', 'Dmitri', 'Diego',
    'Elena', 'Emil', 'Fatima', 'Freya', 'Gabriel', 'Greta', 'Hana', 'Hugo', 'Ibrahim', 'Ingrid',
    'Isabel', 'Ivan', 'Jamal', 'Jin', 'Kenji', 'Keira', 'Kofi', 'Lars', 'Leila', 'Linh',
    'Lina', 'Maya', 'Mateo', 'Miguel', 'Mei', 'Nadia', 'Nia', 'Nikhil', 'Olga', 'Omar',
    'Paolo', 'Pierre', 'Priya', 'Rafael', 'Rania', 'Ravi', 'Rosa', 'Ruth', 'Sakura', 'Samir',
    'Sofia', 'Stefan', 'Sven', 'Tariq', 'Teo', 'Tomas', 'Uma', 'Vera', 'Viktor', 'Wei',
    'Xavier', 'Yara', 'Yuki', 'Zara', 'Adnan', 'Anika', 'Bianca', 'Bjorn', 'Chloe', 'Dario',
    'Emeka', 'Esther', 'Felix', 'Fiona', 'Grace', 'Hassan', 'Idris', 'Jonas', 'Julia', 'Kai',
    'Lena', 'Malik', 'Marta', 'Nour', 'Oscar', 'Pablo', 'Petra', 'Kwame',
  ];
  const DEFAULT_AGENT_ID = 'terminal';
  // Used only for terminals that were created before titles carried the agent (old format titles).
  const LEGACY_AGENTS = {
    'powershell.exe': { agent_id: 'terminal', label: 'Terminal' },
    claude: { agent_id: 'claude', label: 'Claude Code' },
  };
  const STATUS_TEXT = { starting: 'starting', running: 'running', exited: 'exited' };
  const WORKTREE_NOTICE_MS = 8000;
  const AGENT_INSTALL_ID = 'install';

  // Tiled pane layout (see "tiled layout" below). Sizes are in CSS pixels.
  const MIN_PANE_PX = 120; // a divider never squeezes a pane below this
  const PANE_GAP_PX = 6; // space between neighbouring panes
  const DIVIDER_HIT_PX = 8; // grabbable width of a divider
  const DRAG_START_PX = 5; // a title bar press becomes a move after this much travel
  const DROP_EDGE_ZONE = 0.28; // closer than this (fraction of the pane) to an edge = split there
  const RESIZE_DEBOUNCE_MS = 80; // pty resizes wait until a divider drag settles
  const INTERNAL_PATH_TYPE = 'application/x-agentsense-path'; // file tree row drag (file_panel.js)
  const UI_STORAGE_KEY = 'agentsense.workbench';
  const FILE_CHECK_DELAY_MS = 100; // groups the change events of one burst before open tabs are compared with disk

  function read_ui() {
    try {
      const parsed = JSON.parse(localStorage.getItem(UI_STORAGE_KEY)) || {};
      // Tabs and zoom used to be a global mode. Fixed splits ignore that and keep the rest of the record.
      if (parsed.mode === 'tabs' || parsed.mode === 'zoom') delete parsed.mode;
      if (!parsed.workspaces || typeof parsed.workspaces !== 'object') parsed.workspaces = {};
      return parsed;
    } catch { return { workspaces: {} }; }
  }

  function write_ui(ui) {
    try { localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(ui)); }
    catch { /* The workbench still works when storage is unavailable. */ }
  }

  function workspace_ui(workspace_id) {
    const ui = read_ui();
    return ui.workspaces[workspace_id] || {};
  }

  function save_workspace_ui(workspace_id, patch) {
    const ui = read_ui();
    ui.version = 2;
    ui.workspaces[workspace_id] = Object.assign({}, ui.workspaces[workspace_id] || {}, patch);
    write_ui(ui);
  }
  const TERMINAL_OPTIONS = {
    fontFamily: '"Cascadia Mono", Consolas, monospace',
    fontSize: 13,
    scrollback: 5000,
    cursorBlink: true,
    theme: {
      // Matches the --bg / --text tokens in styles.css.
      background: '#000000',
      foreground: '#ececec',
      cursor: '#ececec',
      cursorAccent: '#000000',
      selectionBackground: 'rgba(91, 141, 239, 0.35)',
      // "black" is lifted from the old #1b1b1b so it stays visible on the pure black background.
      black: '#2b2b30',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#d0d0d0',
      brightBlack: '#5c6370',
      brightRed: '#ef7b84',
      brightGreen: '#a9d18e',
      brightYellow: '#f0d08a',
      brightBlue: '#7cc0f5',
      brightMagenta: '#d592e8',
      brightCyan: '#6fc8d2',
      brightWhite: '#ffffff',
    },
  };

  // Module-wide routing. One hub subscription per page routes events by terminal_id.
  const PANE_BY_TERMINAL = new Map(); // terminal_id -> pane (panes of every grid)
  // Terminals of workspaces that have no attached view yet (found after a UI reload):
  // terminal_id -> { workspace_id, alive, title, agent_id, agent_label }
  const EXTERNAL_TERMINALS = new Map();
  const LIVE_GRIDS = new Set();
  let hub_subscribed = false;
  let pane_serial = 0;
  let file_check_timer = 0;
  let file_check_running = false;
  let file_check_again = false;

  function create_el(tag, class_name, text) {
    const node = document.createElement(tag);
    if (class_name) node.className = class_name;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function error_text(error) {
    const raw = error && error.message ? error.message : String(error);
    return raw.replace(/^Error invoking remote method '[^']+': /, '').replace(/^Error: /, '');
  }

  function exit_line(exit_code) {
    return `\r\n[process exited with code ${exit_code}]\r\n`;
  }

  // The pane's name, agent id and agent label travel to the main process inside the title field:
  // name|agent_id|agent_label. Main only stores title/command, so this is how they survive a re-attach.
  function clean_part(value) {
    return String(value === undefined || value === null ? '' : value).replace(/\|/g, '/').trim();
  }

  function encode_title(name, agent_id, agent_label) {
    return [clean_part(name), clean_part(agent_id), clean_part(agent_label)].join('|');
  }

  // The agent's logo as a 16px image before the pane name. Unknown agents and agents without a logo get none.
  function build_logo(agent_id) {
    const agent = typeof window.find_agent === 'function' ? window.find_agent(agent_id) : null;
    if (!agent || typeof agent.logo !== 'string' || agent.logo === '') return null;
    const image = create_el('img', 'tg-pane-logo');
    image.alt = '';
    image.draggable = false;
    image.src = agent.logo;
    // A logo file that is missing simply disappears instead of showing a broken image.
    image.addEventListener('error', () => image.remove());
    return image;
  }

  function legacy_agent_for(command) {
    const key = String(command || '').trim().toLowerCase();
    if (LEGACY_AGENTS[key]) return LEGACY_AGENTS[key];
    return { agent_id: key || DEFAULT_AGENT_ID, label: String(command || '').trim() || DEFAULT_AGENT_ID };
  }

  function decode_title(raw_title, command) {
    const text = String(raw_title || '');
    const parts = text.split('|');
    const fallback = legacy_agent_for(command);
    if (parts.length >= 3 && parts[0].trim()) {
      return {
        name: parts[0].trim(),
        agent_id: parts[1].trim() || fallback.agent_id,
        agent_label: parts.slice(2).join('|').trim() || fallback.label,
      };
    }
    return { name: text.trim() || fallback.label, agent_id: fallback.agent_id, agent_label: fallback.label };
  }

  // Returns the kill result ({ worktree_removed, worktree_path, worktree_kept_reason }) or null on failure.
  async function kill_quietly(terminal_id) {
    try {
      const result = await window.hub.terminals.kill(terminal_id);
      return result && typeof result === 'object' ? result : null;
    } catch (error) {
      console.error('terminals.kill failed:', error);
      return null;
    }
  }

  // A kept worktree (it has changes) is announced for a few seconds, without blocking anything.
  function note_kept_worktree(grid, kill_result) {
    if (!kill_result || !kill_result.worktree_path || kill_result.worktree_removed) return;
    show_worktree_notice(grid, kill_result.worktree_path, kill_result.worktree_kept_reason);
  }

  function subscribe_hub_once() {
    if (hub_subscribed) return;
    hub_subscribed = true;
    // A file dropped anywhere that does not handle it (sidebar, toolbar, gaps) must not make the window
    // navigate to that file and lose the app.
    document.addEventListener('dragover', (event) => event.preventDefault());
    document.addEventListener('drop', (event) => event.preventDefault());
    window.hub.terminals.on_data((terminal_id, data) => {
      const pane = PANE_BY_TERMINAL.get(terminal_id);
      if (pane) pane.term.write(data);
    });
    window.hub.terminals.on_exit((terminal_id, exit_code) => route_exit(terminal_id, exit_code));
    // Panes created or closed by the phone (mobile_server.js -> terminals:created / terminals:closed).
    window.hub.terminals.on_created((info) => route_created(info));
    window.hub.terminals.on_closed((terminal_id) => route_closed(terminal_id));
    // Agents edit files while they are open here. Window focus also covers folders nothing watches (node_modules).
    if (window.hub.files.on_changed) window.hub.files.on_changed(() => schedule_open_file_check());
    window.addEventListener('focus', () => schedule_open_file_check());
  }

  function route_exit(terminal_id, exit_code) {
    const pane = PANE_BY_TERMINAL.get(terminal_id);
    if (!pane) {
      const entry = EXTERNAL_TERMINALS.get(terminal_id);
      if (entry) {
        entry.alive = false;
        notify_all_grids();
      }
      return;
    }
    pane.term.write(exit_line(exit_code));
    set_pane_status(pane, 'exited', exit_code);
    notify_grid(pane.grid);
  }

  // Builds a pane for a live terminal info (a list entry or a created broadcast), replays its buffer and
  // binds the live routing. Shared by the workspace attach and the phone-created route below.
  function attach_info_to_view(grid, view, info) {
    const decoded = decode_title(info.title, info.command);
    const pane = build_pane(grid, view, {
      name: decoded.name,
      agent_id: info.agent_id || decoded.agent_id,
      agent_label: decoded.agent_label,
      command: info.command,
      cwd: info.cwd,
      base_cwd: info.base_cwd || info.cwd,
      worktree: info.worktree || null,
      record_id: info.record_id || null,
      model_id: info.model_id || null,
      provider_id: info.provider_id || null,
      resume_mode: info.resume_mode || null,
    });
    mount_pane(grid, view, pane);
    // The buffer is the output so far; live data for this terminal is routed from now on.
    if (info.buffer) pane.term.write(info.buffer);
    if (info.alive) {
      bind_terminal(pane, info.terminal_id, 'running', null);
    } else {
      pane.term.write(exit_line(info.exit_code));
      bind_terminal(pane, info.terminal_id, 'exited', info.exit_code);
    }
    return pane;
  }

  // A pane was created from the phone: show it in its workspace view when that view is on screen,
  // else remember it like any other externally created terminal (the sidebar picks it up).
  function route_created(info) {
    if (!info || typeof info.terminal_id !== 'string' || PANE_BY_TERMINAL.has(info.terminal_id)) return;
    for (const grid of LIVE_GRIDS) {
      const view = grid.views.get(info.workspace_id);
      if (view && view.ready && !view.disposed) {
        attach_info_to_view(grid, view, info);
        notify_grid(grid);
        return;
      }
    }
    const decoded = decode_title(info.title, info.command);
    EXTERNAL_TERMINALS.set(info.terminal_id, {
      workspace_id: info.workspace_id,
      alive: Boolean(info.alive),
      title: decoded.name,
      agent_id: decoded.agent_id,
      agent_label: decoded.agent_label,
    });
    notify_all_grids();
  }

  // A pane was closed from the phone: an explicit close emits no pty exit, so this is its own event.
  function route_closed(terminal_id) {
    if (typeof terminal_id !== 'string') return;
    const pane = PANE_BY_TERMINAL.get(terminal_id);
    if (pane && !pane.disposed) {
      pane.term.write('\r\n[session closed from another device]\r\n');
      set_pane_status(pane, 'exited', null);
      notify_grid(pane.grid);
      return;
    }
    if (EXTERNAL_TERMINALS.delete(terminal_id)) notify_all_grids();
  }

  async function load_external_terminals() {
    try {
      const infos = await window.hub.terminals.list();
      for (const info of infos) {
        if (PANE_BY_TERMINAL.has(info.terminal_id)) continue;
        const decoded = decode_title(info.title, info.command);
        EXTERNAL_TERMINALS.set(info.terminal_id, {
          workspace_id: info.workspace_id,
          alive: Boolean(info.alive),
          title: decoded.name,
          agent_id: decoded.agent_id,
          agent_label: decoded.agent_label,
        });
      }
    } catch (error) {
      console.error('terminals.list failed:', error);
    }
    notify_all_grids();
  }

  function compute_counts(grid) {
    const counts = {};
    for (const entry of EXTERNAL_TERMINALS.values()) {
      if (!entry.alive) continue;
      const view = grid.views.get(entry.workspace_id);
      if (view && view.ready) continue;
      counts[entry.workspace_id] = (counts[entry.workspace_id] || 0) + 1;
    }
    for (const view of grid.views.values()) {
      counts[view.workspace.id] = view.panes.filter((pane) => pane.status === 'running').length;
    }
    return counts;
  }

  function session_of_pane(pane) {
    return {
      terminal_id: pane.terminal_id,
      title: pane.name,
      agent_id: pane.agent_id,
      agent_label: pane.agent_label,
      status: pane.status === 'exited' ? 'exited' : 'running',
    };
  }

  // Sessions of one workspace. A pane without a terminal_id (still starting) is not listed yet.
  function list_sessions_in_grid(grid, workspace_id) {
    const view = grid.views.get(workspace_id);
    if (view && view.ready) {
      return view.panes
        .filter((pane) => !pane.disposed && pane.terminal_id && pane.status !== 'starting')
        .map(session_of_pane);
    }
    const sessions = [];
    for (const [terminal_id, entry] of EXTERNAL_TERMINALS) {
      if (entry.workspace_id !== workspace_id) continue;
      sessions.push({
        terminal_id,
        title: entry.title,
        agent_id: entry.agent_id,
        agent_label: entry.agent_label,
        status: entry.alive ? 'running' : 'exited',
      });
    }
    return sessions;
  }

  function build_sessions_map(grid) {
    const ids = new Set(grid.views.keys());
    for (const entry of EXTERNAL_TERMINALS.values()) ids.add(entry.workspace_id);
    const map = {};
    for (const id of ids) map[id] = list_sessions_in_grid(grid, id);
    return map;
  }

  function notify_grid(grid) {
    try {
      grid.on_counts_change(compute_counts(grid));
    } catch (error) {
      console.error('on_counts_change failed:', error);
    }
    try {
      grid.on_sessions_change(build_sessions_map(grid));
    } catch (error) {
      console.error('on_sessions_change failed:', error);
    }
  }

  function notify_all_grids() {
    for (const grid of LIVE_GRIDS) notify_grid(grid);
  }

  function build_grid(container, callbacks) {
    const ui = read_ui();
    const grid = {
      container,
      on_counts_change: callbacks.on_counts_change,
      on_sessions_change: callbacks.on_sessions_change,
      on_new_session_request: callbacks.on_new_session_request,
      on_attention: callbacks.on_attention,
      views: new Map(),
      active_view: null,
      active_pane: null,
      files_open: true,
      files_width: Math.min(520, Math.max(180, Number(ui.files_width) || 270)),
      notice_timer: 0,
      dom: null,
    };
    grid.dom = build_frame(grid);
    grid.dom.root.style.setProperty('--files-width', `${grid.files_width}px`);
    grid.dom.root.addEventListener('keydown', (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        event.stopPropagation();
        toggle_files_panel(grid);
      } else if (event.key.toLowerCase() === 'p' && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        void open_quick_open(grid);
      } else if (event.key === 'Tab') {
        const view = grid.active_view;
        if (!view) return;
        event.preventDefault();
        event.stopPropagation();
        const index = view.pages.indexOf(view.active_page);
        select_page(grid, view, view.pages[(index + (event.shiftKey ? -1 : 1) + view.pages.length) % view.pages.length]);
      }
    }, true);
    LIVE_GRIDS.add(grid);
    return grid;
  }

  function build_frame(grid) {
    const root = create_el('div', 'tg-root');

    const toolbar = create_el('div', 'tg-toolbar');
    const new_button = create_el('button', 'tg-btn tg-btn-primary', '+ New session');
    new_button.type = 'button';
    new_button.setAttribute('data-action', 'new_session');
    new_button.addEventListener('click', () => on_new_session_click(grid));
    const note = create_el('span', 'tg-note', '');
    const files_button = create_el('button', 'tg-btn tg-btn-selected', 'Files');
    files_button.type = 'button';
    files_button.title = 'Toggle right files panel (Ctrl+Shift+E)';
    files_button.setAttribute('aria-label', files_button.title);
    files_button.setAttribute('data-action', 'toggle_files');
    files_button.addEventListener('click', () => toggle_files_panel(grid));
    const version = create_el('span', 'tg-version', '');
    version.title = 'AgentSense build';
    if (window.hub.app && typeof window.hub.app.info === 'function') {
      window.hub.app.info().then((info) => {
        if (info && info.version) version.textContent = `v${info.version}`;
      }).catch(() => {});
    }
    const page_button = create_el('button', 'tg-btn', '+ New page');
    page_button.type = 'button';
    page_button.dataset.action = 'new_page';
    page_button.title = 'Open another page in this workspace';
    page_button.addEventListener('click', () => {
      const view = grid.active_view;
      if (!view) return;
      const page = make_page(view);
      view.pages.push(page);
      select_page(grid, view, page);
    });
    toolbar.append(new_button, page_button, note, version, files_button);

    const banner = create_el('div', 'tg-banner');
    const banner_text = create_el('span', 'tg-banner-text', '');
    const banner_close = create_el('button', 'tg-banner-close', 'x');
    banner_close.type = 'button';
    banner_close.title = 'Dismiss';
    banner_close.addEventListener('click', () => clear_banner(grid));
    banner.append(banner_text, banner_close);
    banner.hidden = true;

    // Non-blocking notice (e.g. a kept worktree). Disappears by itself after WORKTREE_NOTICE_MS.
    const notice = create_el('div', 'tg-notice');
    const notice_text = create_el('span', 'tg-notice-text', '');
    const notice_close = create_el('button', 'tg-notice-close', 'x');
    notice_close.type = 'button';
    notice_close.title = 'Dismiss';
    notice_close.addEventListener('click', () => hide_worktree_notice(grid));
    notice.append(notice_text, notice_close);
    notice.hidden = true;

    const views = create_el('div', 'tg-views');
    const empty = create_el('div', 'tg-empty', 'Add a workspace to start');
    views.appendChild(empty);

    root.append(toolbar, banner, notice, views);
    grid.container.appendChild(root);
    return { root, new_button, page_button, files_button, note, version, banner, banner_text, notice, notice_text, views, empty };
  }

  function show_worktree_notice(grid, worktree_path, reason) {
    grid.dom.notice_text.textContent = `Worktree kept (has changes): ${worktree_path}`;
    grid.dom.notice.title = reason ? String(reason) : '';
    grid.dom.notice.hidden = false;
    if (grid.notice_timer) window.clearTimeout(grid.notice_timer);
    grid.notice_timer = window.setTimeout(() => {
      grid.notice_timer = 0;
      hide_worktree_notice(grid);
    }, WORKTREE_NOTICE_MS);
  }

  function hide_worktree_notice(grid) {
    if (grid.notice_timer) window.clearTimeout(grid.notice_timer);
    grid.notice_timer = 0;
    grid.dom.notice_text.textContent = '';
    grid.dom.notice.hidden = true;
  }

  function set_toolbar_enabled(grid, enabled) {
    grid.dom.new_button.disabled = !enabled;
    grid.dom.page_button.disabled = !enabled;
    grid.dom.files_button.disabled = !enabled;
  }

  function on_new_session_click(grid) {
    const view = grid.active_view;
    if (!view) return;
    try {
      grid.on_new_session_request(view.workspace);
    } catch (error) {
      console.error('on_new_session_request failed:', error);
    }
  }

  function update_note(grid) {
    const view = grid.active_view;
    if (!view) {
      grid.dom.note.textContent = '';
      return;
    }
    const count = view.panes.filter((pane) => pane.kind !== 'file').length;
    if (count === 0) {
      grid.dom.note.textContent = 'No terminals. Click + New session to start one.';
      return;
    }
    const files = view.panes.length - count;
    grid.dom.note.textContent = `${view.workspace.name} / ${count} agent${count === 1 ? '' : 's'}${files ? ` · ${files} file${files === 1 ? '' : 's'}` : ''}`;
    grid.dom.note.title = 'Ctrl+Tab moves focus · Drag a divider to resize · Ctrl+P finds a file';
  }

  function show_banner(grid, message) {
    grid.dom.banner_text.textContent = message;
    grid.dom.banner.hidden = false;
  }

  function clear_banner(grid) {
    grid.dom.banner_text.textContent = '';
    grid.dom.banner.hidden = true;
  }

  function create_view(grid, workspace) {
    // Layout: [pane area | file panel]. The panel shows the workspace tree and accepts drag & drop;
    // tg-with-files on the root toggles its width on and off.
    const prefs = workspace_ui(workspace.id);
    const files_open = prefs.files_open !== false;
    const files_width = Math.min(520, Math.max(180, Number(prefs.files_width) || grid.files_width || 270));
    const root = create_el('div', files_open ? 'tg-view tg-with-files' : 'tg-view');
    const file_side = create_el('div', 'fp-side');
    const pane_area = create_el('div', 'tg-pane-area');
    const tabs = create_el('div', 'tg-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Workspace pages');
    const pane_grid = create_el('div', 'tg-grid');
    const hint = create_el('div', 'tg-page-empty');
    hint.append(create_el('div', 'tg-page-empty-title', 'Start this page'),
      create_el('p', 'tg-page-empty-note', 'Open a file or terminal in this folder. Drop files here to open them.'));
    const empty_actions = create_el('div', 'tg-page-empty-actions');
    const page_actions = create_el('div', 'tg-page-actions');
    page_actions.setAttribute('role', 'toolbar');
    page_actions.setAttribute('aria-label', 'Page actions');
    const add_action = (host, action, label, run) => {
      const button = create_el('button', 'tg-btn', label);
      button.type = 'button';
      button.dataset.action = action;
      button.addEventListener('click', run);
      host.append(button);
      return button;
    };
    for (const host of [empty_actions, page_actions]) {
      add_action(host, 'open_file', 'Open file', () => void pick_page_files(grid, view));
      add_action(host, 'open_terminal', 'Open terminal', () => void open_page_terminal(grid, view));
    }
    hint.append(empty_actions);
    const split_direction = create_el('select', 'tg-btn tg-split-direction');
    split_direction.setAttribute('aria-label', 'Terminal split direction');
    for (const [value, label] of [['right', 'Side by side'], ['bottom', 'Stacked']]) {
      const option = create_el('option', '', label);
      option.value = value;
      split_direction.append(option);
    }
    page_actions.append(split_direction);
    const split_button = add_action(page_actions, 'split_terminal', 'Split terminal', () =>
      void open_page_terminal(grid, view, split_direction.value));
    pane_grid.append(hint);
    pane_area.append(page_actions, pane_grid);
    pane_area.prepend(tabs);
    const file_resize = create_el('div', 'tg-files-resize');
    file_resize.setAttribute('role', 'separator');
    file_resize.setAttribute('aria-label', 'Resize files panel');
    file_resize.setAttribute('aria-orientation', 'vertical');
    file_resize.setAttribute('aria-valuemin', '180');
    file_resize.setAttribute('aria-valuemax', '520');
    file_resize.setAttribute('aria-valuenow', String(grid.files_width));
    file_resize.tabIndex = 0;
    const set_width = (width) => {
      view.files_width = Math.round(Math.min(520, Math.max(180, Math.min(width, root.clientWidth - 240))));
      grid.dom.root.style.setProperty('--files-width', `${view.files_width}px`);
      file_resize.setAttribute('aria-valuenow', String(view.files_width));
      relayout_view(grid, view);
      refit_view(view);
    };
    file_resize.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      set_width(view.files_width + (event.key === 'ArrowLeft' ? 20 : -20));
      save_workspace_ui(workspace.id, { files_open: view.files_open, files_width: view.files_width });
    });
    file_resize.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      file_resize.setPointerCapture(event.pointerId);
      const start = event.clientX;
      const width = view.files_width;
      root.classList.add('tg-resizing-row');
      const move = (e) => set_width(width + start - e.clientX);
      const end = () => {
        root.classList.remove('tg-resizing-row');
        file_resize.removeEventListener('pointermove', move);
        file_resize.removeEventListener('pointerup', end);
        file_resize.removeEventListener('pointercancel', end);
        save_workspace_ui(workspace.id, { files_open: view.files_open, files_width: view.files_width, tree: serialize_layout(view.layout) });
      };
      file_resize.addEventListener('pointermove', move);
      file_resize.addEventListener('pointerup', end);
      file_resize.addEventListener('pointercancel', end);
    });
    root.append(pane_area, file_resize, file_side);
    grid.dom.views.appendChild(root);
    const view = {
      workspace,
      root,
      file_side,
      pane_area,
      pane_grid,
      tabs,
      selected: null,
      hint,
      split_button,
      panes: [],
      files_open,
      files_width,
      pages: [],
      active_page: null,
      zoomed: null, // kept null; selection never maximizes a pane
      dividers: [],
      drop_indicator: null,
      attach_promise: null,
      ready: false,
      disposed: false,
    };
    const saved_pages = Array.isArray(prefs.pages) && prefs.pages.length ? prefs.pages : [{ id: 'page-1', name: 'Page 1' }];
    view.pages = saved_pages.map((page) => ({ id: page.id, name: page.name, layout: null }));
    view.active_page = view.pages.find((page) => page.id === prefs.active_page) || view.pages[0];
    Object.defineProperty(view, 'layout', {
      get: () => view.active_page.layout,
      set: (layout) => { view.active_page.layout = layout; },
    });
    attach_drop_to_page(grid, view);
    mount_file_panel(grid, view);
    return view;
  }

  // Creates file panel.js's tree once per view (when the skill is present; between app versions it may not be).
  function mount_file_panel(grid, view) {
    if (!window.init_file_panel || !view.workspace || !view.workspace.id) return;
    view.file_panel = window.init_file_panel({
      container: view.file_side,
      workspace: view.workspace,
      on_open_file: (rel_path) => open_file_in_grid(grid, view.workspace, rel_path),
      on_error: (message) => show_banner(grid, String(message || 'File panel error')),
    });
  }

  function toggle_files_panel(grid) {
    const view = grid.active_view;
    if (!view) return;
    view.files_open = !view.files_open;
    view.root.classList.toggle('tg-with-files', view.files_open);
    grid.dom.files_button.classList.toggle('tg-btn-selected', view.files_open);
    grid.dom.files_button.setAttribute('aria-pressed', String(view.files_open));
    relayout_view(grid, view);
    refit_view(view);
    save_workspace_ui(view.workspace.id, { files_open: view.files_open, files_width: view.files_width });
  }

  // Creates the view for a workspace if needed and starts re-attaching its live terminals once.
  function ensure_view(grid, workspace) {
    let view = grid.views.get(workspace.id);
    if (!view) {
      view = create_view(grid, workspace);
      grid.views.set(workspace.id, view);
    }
    view.workspace = workspace;
    if (!view.attach_promise) {
      view.attach_promise = attach_workspace_terminals(grid, view).catch((error) => {
        console.error('attach failed:', error);
        view.ready = true;
      });
    }
    return view;
  }

  async function wait_for_attach(view) {
    if (view.attach_promise) await view.attach_promise;
  }

  function show_workspace_in_grid(grid, workspace) {
    if (!workspace) {
      grid.active_view = null;
      for (const view of grid.views.values()) view.root.classList.remove('tg-view-active');
      grid.dom.empty.hidden = false;
      set_toolbar_enabled(grid, false);
      update_note(grid);
      return;
    }

    const view = ensure_view(grid, workspace);
    for (const other of grid.views.values()) {
      other.root.classList.toggle('tg-view-active', other === view);
    }
    grid.active_view = view;
    grid.dom.root.style.setProperty('--files-width', `${view.files_width}px`);
    grid.dom.files_button.classList.toggle('tg-btn-selected', view.files_open);
    grid.dom.files_button.setAttribute('aria-pressed', String(view.files_open));
    grid.dom.empty.hidden = true;
    set_toolbar_enabled(grid, true);
    update_note(grid);

    // The view was display:none until now, so every pane needs a fresh fit.
    window.requestAnimationFrame(() => {
      if (view.disposed) return;
      relayout_view(grid, view);
      refit_view(view);
    });
  }

  function forget_workspace_in_grid(grid, workspace_id) {
    const view = grid.views.get(workspace_id);
    if (view) {
      view.disposed = true;
      if (view.file_panel && typeof view.file_panel.dispose === 'function') view.file_panel.dispose();
      for (const pane of view.panes.slice()) remove_pane(grid, pane);
      view.root.remove();
      grid.views.delete(workspace_id);
      if (grid.active_view === view) show_workspace_in_grid(grid, null);
    }
    for (const [terminal_id, entry] of EXTERNAL_TERMINALS) {
      if (entry.workspace_id === workspace_id) EXTERNAL_TERMINALS.delete(terminal_id);
    }
    notify_grid(grid);
  }

  async function attach_workspace_terminals(grid, view) {
    let infos = [];
    try {
      infos = await window.hub.terminals.list(view.workspace.id);
    } catch (error) {
      show_banner(grid, error_text(error));
    }
    if (view.disposed) return;

    view.hold_layout = true;
    for (const info of infos) EXTERNAL_TERMINALS.delete(info.terminal_id);
    for (const info of infos) {
      if (PANE_BY_TERMINAL.has(info.terminal_id)) continue;
      attach_info_to_view(grid, view, info);
    }
    const saved_files = workspace_ui(view.workspace.id).file_tabs;
    if (Array.isArray(saved_files)) {
      for (const tab of saved_files) {
        if (tab && typeof tab.path === 'string' && tab.path !== '') {
          view.active_page = view.pages.find((page) => page.id === tab.page_id) || view.pages[0];
          open_file_in_grid(grid, view.workspace, tab.path, tab.root);
        }
      }
    }
    apply_saved_layout(view);
    relayout_view(grid, view);
    view.hold_layout = false;
    view.ready = true;
    notify_grid(grid);
  }

  // File picker and canvas drops open files in the page that initiated the action.
  async function pick_page_files(grid, view) {
    const page = view.active_page;
    try {
      const paths = await window.hub.files.pick(view.workspace.path);
      await open_paths_in_page(grid, view, page, paths);
    } catch (error) { show_banner(grid, error_text(error)); }
  }

  async function open_paths_in_page(grid, view, page, paths) {
    if (view.disposed || page.closing || !view.pages.includes(page)) return;
    const failures = [];
    for (const path of paths) {
      const rel = relative_under(view.workspace.path, path);
      if (rel) {
        open_file_in_grid(grid, view.workspace, rel, view.workspace.path, page);
        continue;
      }
      // A file from outside the workspace opens where it lives: edits reach the original and the repo stays clean.
      const { root, name } = split_parent(path);
      const stat = await window.hub.files.stat(root, name);
      if (view.disposed || page.closing || !view.pages.includes(page)) return;
      if (!stat.exists) failures.push(`${name}: file not found`);
      else if (stat.is_dir) failures.push(`${name}: this is a folder; open a file instead`);
      else open_file_in_grid(grid, view.workspace, name, root, page);
    }
    if (failures.length) show_banner(grid, `Could not open files: ${failures.join('; ')}`);
  }

  // C:\dir\a.txt -> { root: 'C:\dir', name: 'a.txt' }. A drive root keeps its separator.
  function split_parent(file_path) {
    const text = String(file_path);
    const index = Math.max(text.lastIndexOf('\\'), text.lastIndexOf('/'));
    const root = text.slice(0, index);
    return { root: /^[A-Za-z]:$/.test(root) ? `${root}\\` : root, name: text.slice(index + 1) };
  }

  function attach_drop_to_page(grid, view) {
    const area = view.pane_grid;
    const accepts = (event) => event.dataTransfer && Array.from(event.dataTransfer.types || [])
      .some((type) => type === 'Files' || type === INTERNAL_PATH_TYPE);
    area.addEventListener('dragover', (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      area.classList.add('tg-page-drop-target');
    });
    area.addEventListener('dragleave', (event) => {
      if (!area.contains(event.relatedTarget)) area.classList.remove('tg-page-drop-target');
    });
    area.addEventListener('drop', (event) => {
      area.classList.remove('tg-page-drop-target');
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const page = view.active_page;
      const payload = event.dataTransfer.getData(INTERNAL_PATH_TYPE);
      const files = Array.from(event.dataTransfer.files || []);
      void (async () => {
        try {
          if (payload) {
            const source = JSON.parse(payload);
            if (typeof source.root_path !== 'string' || typeof source.rel_path !== 'string') return;
            open_file_in_grid(grid, view.workspace, source.rel_path, source.root_path, page);
          } else {
            const paths = files.map((file) => window.hub.files.path_for_file(file) || file.path || '').filter(Boolean);
            if (!paths.length) throw new Error('Could not resolve the dropped file paths.');
            await open_paths_in_page(grid, view, page, paths);
          }
        } catch (error) { show_banner(grid, error_text(error)); }
      })();
    });
  }

  async function open_page_terminal(grid, view, side) {
    const page = view.active_page;
    const terminals = view.panes.filter((pane) => pane.page_id === page.id && pane.term && !pane.disposed);
    const anchor = terminals.includes(view.selected) ? view.selected : terminals[0];
    await launch_seats_in_grid(grid, view.workspace,
      [{ agent_id: 'terminal', label: 'Terminal', command: 'powershell.exe' }], {
        page_id: page.id,
        split_target: side ? anchor : null,
        split_side: side,
        cwd: anchor ? anchor.cwd : view.workspace.path,
      });
  }

  // cwd is where the pane runs now; base_cwd is the folder it was asked to use (the repo, when cwd is a worktree).
  // Dropping files on a pane copies them into its cwd (unless they already live inside it)
  // and pastes the absolute destinations at the CLI cursor, so the running agent can use them.
  function attach_drop_to_pane(grid, pane, element = pane.element) {
    element.addEventListener('dragover', (event) => {
      if (!event.dataTransfer) return;
      const types = Array.from(event.dataTransfer.types || []);
      if (!types.includes('Files') && !types.includes(INTERNAL_PATH_TYPE)) return;
      event.preventDefault();
      event.stopPropagation();
      pane.view.pane_grid.classList.remove('tg-page-drop-target');
      event.dataTransfer.dropEffect = 'copy';
      element.classList.add('tg-drop-target');
    });
    element.addEventListener('dragleave', () => {
      element.classList.remove('tg-drop-target');
    });
    element.addEventListener('drop', (event) => {
      element.classList.remove('tg-drop-target');
      if (!event.dataTransfer) return;
      const rel_path = event.dataTransfer.getData(INTERNAL_PATH_TYPE);
      if (rel_path) {
        event.preventDefault();
        event.stopPropagation();
        void paste_workspace_path(grid, pane, rel_path);
        return;
      }
      const files_list = Array.from(event.dataTransfer.files || []);
      if (files_list.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      void drop_files_into_pane(grid, pane, files_list);
    });
  }

  // Tree/tab drags carry their source workspace; isolated agents stage a copy in their own cwd.
  async function paste_workspace_path(grid, pane, payload) {
    const workspace = pane.view ? pane.view.workspace : null;
    if (pane.kind === 'file' || !workspace || !workspace.path) return;
    if (pane.status !== 'running' || !pane.terminal_id) {
      show_banner(grid, 'The session is not running yet — wait for it to start, then drop again.');
      return;
    }
    let source_root = workspace.path;
    let rel_path = payload;
    try {
      const source = JSON.parse(payload);
      source_root = source.root_path;
      rel_path = source.rel_path;
    } catch { /* Older file tree drags carried just a relative path. */ }
    if (typeof source_root !== 'string' || typeof rel_path !== 'string' ||
        !rel_path || rel_path.split(/[\\/]/).some((part) => part === '..') || /^[\\/]|^[A-Za-z]:/.test(rel_path)) {
      show_banner(grid, 'Could not resolve the dragged workspace file.');
      return;
    }
    const root_abs = String(source_root);
    const sep = root_abs.includes('\\') ? '\\' : '/';
    const base = root_abs.endsWith(sep) ? root_abs : root_abs + sep;
    await drop_paths_into_pane(grid, pane, [base + rel_path.split('/').join(sep)]);
  }

  async function drop_files_into_pane(grid, pane, files_list) {
    if (pane.status !== 'running' || !pane.terminal_id) {
      show_banner(grid, 'The session is not running yet — wait for it to start, then drop again.');
      return;
    }
    const resolved = [];
    for (const file of files_list) {
      let source_path = '';
      try {
        source_path = String(window.hub.files.path_for_file(file) || file.path || '');
      } catch {
        source_path = typeof file.path === 'string' ? file.path : '';
      }
      if (source_path) resolved.push(source_path);
    }
    if (resolved.length === 0) {
      show_banner(grid, 'Could not resolve the file paths of that drop.');
      return;
    }
    await drop_paths_into_pane(grid, pane, resolved);
  }

  async function drop_paths_into_pane(grid, pane, resolved) {
    if (pane.disposed || pane.status !== 'running' || !pane.terminal_id) return;
    // The session's actual cwd can be an isolated worktree. Route each drop to that session.
    const root_abs = String(pane.cwd || pane.view.workspace.path);

    const parts = [];
    const external = [];
    const workspace_root = pane.view.workspace.path;
    for (const source_path of resolved) {
      const rel = relative_under(workspace_root, source_path) || relative_under(root_abs, source_path);
      if (rel) {
        const mapped = join_path(root_abs, rel);
        if (path_is_under(root_abs, source_path)) {
          parts.push(quote_path(source_path, pane.agent_id));
          continue;
        }
        let mapped_in = null;
        try {
          mapped_in = await window.hub.files.import_mapped(root_abs, source_path, rel);
        } catch (error) {
          show_banner(grid, `Could not map ${rel}: ${error_text(error)}`);
          continue;
        }
        if (mapped_in && mapped_in.existed) {
          parts.push(quote_path(mapped, pane.agent_id));
          show_banner(grid, `${rel} already exists in this worktree. Referenced it and did not overwrite.`);
        } else if (mapped_in && mapped_in.ok) {
          parts.push(quote_path(mapped, pane.agent_id));
        }
        continue;
      }
      external.push(source_path);
    }
    if (external.length > 0) {
      let outcome;
      try {
        outcome = await window.hub.files.copy_in(root_abs, external.map((p) => ({ path: p })));
      } catch (error) {
        show_banner(grid, `Could not copy dropped files: ${error_text(error)}`);
        return;
      }
      const results = Array.isArray(outcome.results) ? outcome.results : [];
      const copied = results.filter((r) => r && r.ok);
      const failed = results.filter((r) => r && !r.ok);
      if (copied.length === 0 && parts.length === 0) {
        show_banner(grid, `Could not copy dropped files — ${failed.map((f) => `${f.name}: ${f.message}`).join('; ')}`);
        return;
      }
      parts.push(...copied.map((r) => quote_path(join_path(root_abs, r.rel || r.name), pane.agent_id)));
      if (failed.length > 0) {
        show_banner(grid, `Copied ${copied.length}, failed ${failed.length}: ${failed.map((f) => `${f.name}: ${f.message}`).join('; ')}`);
      }
    }
    if (parts.length > 0 && !pane.disposed && pane.status === 'running' && pane.terminal_id) {
      select_tab(grid, pane);
      pane.term.paste(`${parts.join(' ')} `);
      pane.term.focus();
    }
  }

  // True when p is root itself or lives under it (case-insensitive, Windows-style separators).
  function path_is_under(root, p) {
    const norm = (value) => String(value || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    const r = norm(root);
    const v = norm(p);
    return v === r || v.startsWith(r + '\\');
  }

  function join_path(root, rel) {
    const sep = String(root).includes('\\') ? '\\' : '/';
    const base = String(root).replace(/[\\/]+$/, '');
    return base + sep + String(rel || '').split('/').join(sep);
  }

  function relative_under(root, target) {
    if (!path_is_under(root, target)) return null;
    const norm = (value) => String(value || '').replace(/\//g, '\\').replace(/\\+$/, '');
    const extra = norm(target).slice(norm(root).length).replace(/^\\+/, '');
    if (!extra || extra.split('\\').includes('..')) return null;
    return extra.split('\\').join('/');
  }

  function quote_path(p, agent_id) {
    if (agent_id === 'terminal') return `'${p.replace(/'/g, "''")}'`;
    return `"${p}"`;
  }

  function build_pane(grid, view, spec) {
    const element = create_el('div', 'tg-pane');
    element.setAttribute('data-name', spec.name);
    element.setAttribute('data-agent-id', spec.agent_id);
    element.setAttribute('data-terminal-id', '');
    element.setAttribute('data-worktree', spec.worktree ? spec.worktree.path : '');
    const titlebar = create_el('div', 'tg-pane-titlebar');
    const dot = create_el('span', 'tg-dot');
    dot.title = STATUS_TEXT.starting;
    const name_el = create_el('span', 'tg-pane-title', spec.name);
    name_el.title = spec.name;
    const agent_el = create_el('span', 'tg-pane-agent', spec.agent_label);
    agent_el.title = spec.agent_label;
    const restart_btn = create_el('button', 'tg-restart', 'Restart');
    restart_btn.type = 'button';
    restart_btn.hidden = true;
    const close_btn = create_el('button', 'tg-close', 'x');
    close_btn.type = 'button';
    close_btn.title = 'Close terminal';
    const logo = build_logo(spec.agent_id);
    titlebar.append(dot);
    if (logo) titlebar.append(logo);
    titlebar.append(name_el, agent_el, restart_btn, close_btn);
    const body = create_el('div', 'tg-pane-body');
    element.append(titlebar, body);

    const term = new window.Terminal(Object.assign({}, TERMINAL_OPTIONS));
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);

    pane_serial += 1;
    const pane = {
      pane_id: pane_serial,
      grid,
      view,
      workspace_id: view.workspace.id,
      name: spec.name,
      agent_id: spec.agent_id,
      agent_label: spec.agent_label,
      command: spec.command,
      cwd: spec.cwd,
      base_cwd: spec.base_cwd || spec.cwd,
      worktree: spec.worktree || null,
      record_id: spec.record_id || null,
      model_id: spec.model_id || null,
      provider_id: spec.provider_id || null,
      resume_mode: spec.resume_mode || null,
      slot_id: spec.record_id || `slot-${pane_serial}`,
      element,
      titlebar,
      rect: null, // filled by relayout_view from the view's split tree
      dot,
      restart_btn,
      body,
      term,
      fit,
      terminal_id: null,
      status: 'starting',
      exit_code: null,
      observer: null,
      refit_frame: 0,
      resize_timer: 0,
      disposed: false,
    };

    term.onData((data) => {
      if (pane.status === 'running' && pane.terminal_id) {
        window.hub.terminals.write(pane.terminal_id, data);
      }
    });
    term.onResize(({ cols, rows }) => {
      element.setAttribute('data-cols', String(cols));
      element.setAttribute('data-rows', String(rows));
      // Dragging a divider refits every frame; ConPTY only needs the size it settles on.
      if (pane.resize_timer) window.clearTimeout(pane.resize_timer);
      pane.resize_timer = window.setTimeout(() => {
        pane.resize_timer = 0;
        if (pane.status === 'running' && pane.terminal_id && !pane.disposed) {
          window.hub.terminals.resize(pane.terminal_id, pane.term.cols, pane.term.rows);
        }
      }, RESIZE_DEBOUNCE_MS);
    });
    attach_terminal_input(pane);
    attach_drop_to_pane(grid, pane);
    restart_btn.addEventListener('click', (event) => {
      event.stopPropagation();
      restart_pane(grid, pane);
    });
    close_btn.addEventListener('click', (event) => {
      event.stopPropagation();
      close_pane(grid, pane);
    });
    element.addEventListener('mousedown', () => set_active_pane(grid, pane), true);
    attach_pane_rearrange(grid, pane);

    pane.observer = new ResizeObserver(() => schedule_refit(pane));
    pane.observer.observe(body);
    return pane;
  }

  // Clipboard and keys for one pane. Ctrl+C copies only when there is a selection (otherwise it is the
  // interrupt and passes through). Ctrl+Shift+C always copies and never reaches the pty. Ctrl+V and
  // Ctrl+Shift+V paste. Right mouse copies a selection (and clears it), otherwise pastes.
  function attach_terminal_input(pane) {
    pane.term.attachCustomKeyEventHandler((event) => handle_key_event(pane, event));
    // Any native paste (Shift+Insert, the browser's own paste) is replaced by term.paste, so it runs once.
    pane.body.addEventListener(
      'paste',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        const text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
        if (text) pane.term.paste(text);
      },
      true
    );
    pane.body.addEventListener('mousedown', (event) => handle_right_mouse(pane, event), true);
    pane.body.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  // Returns false when the key was handled here, so xterm does not process it as well.
  function handle_key_event(pane, event) {
    if (event.type !== 'keydown' || event.isComposing) return true;
    if (!event.ctrlKey || event.altKey || event.metaKey) return true;
    const key = String(event.key || '').toLowerCase();
    if (key === 'c') {
      if (!event.shiftKey && !pane.term.hasSelection()) return true;
      event.preventDefault();
      copy_selection(pane);
      return false;
    }
    if (key === 'v') {
      event.preventDefault();
      paste_from_clipboard(pane);
      return false;
    }
    return true;
  }

  function handle_right_mouse(pane, event) {
    if (event.button !== 2) return;
    event.preventDefault();
    event.stopPropagation();
    pane.term.focus();
    if (pane.term.hasSelection()) copy_selection(pane);
    else paste_from_clipboard(pane);
  }

  // Copies the selection to the system clipboard and clears the selection. Nothing happens without one.
  function copy_selection(pane) {
    if (!pane.term.hasSelection()) return;
    const text = pane.term.getSelection();
    pane.term.clearSelection();
    if (!text) return;
    window.hub.clipboard.write_text(text).catch((error) => show_banner(pane.grid, error_text(error)));
  }

  async function paste_from_clipboard(pane) {
    let text = '';
    try {
      text = await window.hub.clipboard.read_text();
    } catch (error) {
      show_banner(pane.grid, error_text(error));
      return;
    }
    if (pane.disposed || typeof text !== 'string' || text === '') return;
    // term.paste uses bracketed paste when the shell asked for it. Input goes to the pty only while running.
    pane.term.paste(text);
  }

  function mount_pane(grid, view, pane, page = view.active_page, target, side) {
    const visible_page = view.active_page;
    view.active_page = page;
    view.zoomed = null;
    pane.page_id = view.active_page.id;
    insert_into_layout(view, pane, target, side);
    view.panes.push(pane);
    view.pane_grid.appendChild(pane.element);
    view.active_page = visible_page;
    relayout_view(grid, view);
    pane.term.open(pane.body);
    refit_pane(pane);
  }

  // ---- file viewer panes ----
  // A read-only pane that shows one workspace file. It has no terminal: close removes it, it tiles and
  // moves like a terminal pane, and it never counts as a running session.
  // Text shows as text; images, PDF, audio/video and .docx get a real preview; anything else offers
  // "Open" (default app) and "Reveal" (File Explorer).

  function format_byte_size(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${bytes} B`;
  }

  function build_file_pane(grid, view, spec) {
    const element = create_el('div', 'tg-pane tg-file-pane');
    const titlebar = create_el('div', 'tg-pane-titlebar');
    const icon = create_el('span', 'tg-dot tf-dot');
    icon.title = 'File';
    const name_el = create_el('span', 'tg-pane-title', spec.name);
    name_el.title = spec.path;
    // The folder part only (the name is already shown); empty for files at the workspace root.
    const folder = spec.path.includes('/') ? spec.path.slice(0, spec.path.lastIndexOf('/')) : '';
    const path_el = create_el('span', 'tg-pane-agent', folder);
    path_el.title = spec.path;
    const open_btn = create_el('button', 'tg-restart tf-action', 'Open');
    open_btn.type = 'button';
    open_btn.title = 'Open with the default app';
    const reveal_btn = create_el('button', 'tg-restart tf-action', 'Reveal');
    reveal_btn.type = 'button';
    reveal_btn.title = 'Show in File Explorer';
    const close_btn = create_el('button', 'tg-close', 'x');
    close_btn.type = 'button';
    close_btn.title = 'Close file';
    titlebar.append(icon, name_el, path_el, open_btn, reveal_btn, close_btn);
    const tabstrip = create_el('div', 'tf-tabs');
    const body = create_el('div', 'tf-body');
    body.tabIndex = -1;
    body.textContent = 'No file open';
    element.append(titlebar, tabstrip, body);

    pane_serial += 1;
    const pane = {
      pane_id: pane_serial,
      grid,
      view,
      kind: 'file',
      name: spec.name,
      path: spec.path,
      files: [],
      active: -1,
      tabstrip,
      element,
      titlebar,
      rect: null,
      body,
      close_btn,
      terminal_id: null,
      status: 'file',
      disposed: false,
      observer: null,
      refit_frame: 0,
      term: null,
      fit: null,
    };
    close_btn.addEventListener('click', (event) => {
      event.stopPropagation();
      close_active_file(grid, pane);
    });
    open_btn.addEventListener('click', (event) => {
      event.stopPropagation();
      open_file_externally(grid, pane, 'open_external');
    });
    reveal_btn.addEventListener('click', (event) => {
      event.stopPropagation();
      open_file_externally(grid, pane, 'reveal');
    });
    element.addEventListener('mousedown', () => set_active_pane(grid, pane), true);
    attach_pane_rearrange(grid, pane);
    return pane;
  }

  async function open_file_externally(grid, pane, action) {
    try {
      const file = pane.files && pane.files[pane.active];
      await window.hub.files[action](file ? file.root : pane.view.workspace.path, file ? file.path : pane.path);
    } catch (error) {
      show_banner(grid, `Could not open ${pane.name}: ${error_text(error)}`);
    }
  }

  function mount_file_pane(grid, view, pane) {
    pane.page_id = view.active_page.id;
    const anchor = largest_pane(view);
    insert_into_layout(view, pane, anchor, 'bottom');
    view.panes.push(pane);
    view.pane_grid.appendChild(pane.element);
    relayout_view(grid, view);
  }

  function file_group(view) {
    return view.panes.find((pane) => pane.kind === 'file' && !pane.disposed && pane.page_id === view.active_page.id) || null;
  }

  function render_file_tabs(grid, pane) {
    pane.tabstrip.textContent = '';
    pane.files.forEach((file, index) => {
      const button = create_el('button', 'tf-file-tab');
      button.type = 'button';
      button.textContent = file.name + (file.dirty ? ' *' : '');
      button.title = `${file.root} / ${file.path}`;
      button.draggable = true;
      button.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData(INTERNAL_PATH_TYPE, JSON.stringify({ root_path: file.root, rel_path: file.path }));
        event.dataTransfer.setData('text/plain', file.path);
        event.dataTransfer.effectAllowed = 'copy';
      });
      button.classList.toggle('tf-file-tab-active', index === pane.active);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        void activate_file(grid, pane, index, true);
      });
      const close = create_el('button', 'tf-file-tab-close', '×');
      close.type = 'button';
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        close_file_at(grid, pane, index);
      });
      const wrap = create_el('span', 'tf-file-tab-wrap');
      wrap.append(button, close);
      pane.tabstrip.append(wrap);
    });
    const current = pane.files[pane.active];
    pane.name = current ? current.name : 'Files';
    pane.path = current ? current.path : '';
    const title = pane.element.querySelector('.tg-pane-title');
    if (title) title.textContent = pane.name;
  }

  function close_active_file(grid, pane) {
    if (!pane.files.length) {
      remove_pane(grid, pane);
      notify_grid(grid);
      return;
    }
    void close_file_at(grid, pane, pane.active);
  }

  async function close_file_at(grid, pane, index) {
    const file = pane.files[index];
    if (!file || file.closing) return;
    file.closing = true;
    try {
      let attempts = 0;
      while (file.dirty && file.editable !== false && !file.conflict && attempts < 5) {
        attempts += 1;
        const outcome = await flush_editor(grid, pane, file);
        if (!outcome || outcome.conflict || outcome.error) break;
      }
      if (file.dirty || file.conflict) {
        const message = file.conflict
          ? `${file.name} changed on disk. Your edits are still in the editor and were not overwritten.`
          : `Could not save ${file.name}. The tab was kept. Fix the problem and close it again, or use Discard my edits.`;
        show_banner(grid, message);
        render_file_tabs(grid, pane);
        return;
      }
      const current = pane.files.indexOf(file);
      if (current === -1) return;
      pane.files.splice(current, 1);
      if (pane.files.length === 0) {
        remove_pane(grid, pane);
        save_view_layout(grid, pane.view);
        notify_grid(grid);
        return;
      }
      pane.active = Math.max(0, Math.min(pane.active, pane.files.length - 1));
      render_file_tabs(grid, pane);
      await activate_file(grid, pane, pane.active, true);
      save_view_layout(grid, pane.view);
    } finally {
      file.closing = false;
    }
  }

  async function activate_file(grid, pane, index, reload) {
    pane.active = index;
    const file = pane.files[index];
    if (!file) return;
    pane.path = file.path;
    pane.name = file.name;
    render_file_tabs(grid, pane);
    if (file.loaded && (file.dirty || file.conflict)) {
      paint_text_editor(grid, pane, file);
      return;
    }
    if (reload || !file.loaded) await load_file_content(grid, pane);
  }

  function file_unsupported(grid, pane, message) {
    const box = create_el('div', 'tf-unsupported');
    box.append(create_el('div', 'tf-unsupported-text', message));
    const open_btn = create_el('button', 'tg-btn tg-btn-primary', 'Open with default app');
    open_btn.type = 'button';
    open_btn.addEventListener('click', () => open_file_externally(grid, pane, 'open_external'));
    box.append(open_btn);
    return box;
  }

  // A .docx converted to HTML in the main process; shown in a script-less sandboxed frame like a paper page.
  function document_frame(html) {
    const frame = create_el('iframe', 'tf-frame tf-doc');
    frame.setAttribute('sandbox', '');
    frame.srcdoc =
      '<!doctype html><meta charset="utf-8"><style>' +
      'html{background:#3a3a3e}body{box-sizing:border-box;max-width:820px;margin:12px auto;padding:clamp(16px,6vw,56px);' +
      'background:#fff;color:#1d1d1f;font:14px/1.6 "Segoe UI",Calibri,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.4)}' +
      'img{max-width:100%;height:auto}table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #bbb;padding:4px 8px}' +
      'h1,h2,h3{line-height:1.25}a{color:#0b62c4}</style>' +
      html;
    return frame;
  }

  // options.refresh = { generation }: a reload caused by a change on disk. It gives way to anything typed
  // meanwhile, and keeps the caret, selection, scroll position and focus of the editor it replaces.
  async function load_file_content(grid, pane, options) {
    const view = pane.view;
    const refresh = options && options.refresh;
    const file = pane.files && pane.files[pane.active];
    const root_path = file ? file.root : view.workspace.path;
    const rel_path = file ? file.path : pane.path;
    const request = (pane.load_token = (pane.load_token || 0) + 1);
    let read_done = false;
    try {
      const result = await window.hub.files.read(root_path, rel_path);
      read_done = true;
      if (pane.disposed || pane.load_token !== request) return;
      if (refresh && file && (file.dirty || file.conflict || (file.edit_generation || 0) !== refresh.generation)) return;
      const previous = refresh ? editor_view_state(pane) : null;
      if (file) {
        file.missing = false;
        file.save_error = false;
        file.loaded = true;
        file.mtime = result.mtime;
        file.disk = String(result.content || '');
        file.buffer = file.disk;
        file.dirty = false;
        file.conflict = false;
        file.editable = result.editable !== false && !result.truncated;
        const has_crlf = file.disk.includes('\r\n');
        const other_lines = file.disk.replace(/\r\n/g, '');
        const mixed_lines = other_lines.includes('\r') || (has_crlf && other_lines.includes('\n'));
        file.line_ending = has_crlf ? '\r\n' : '\n';
        file.readonly_reason = result.readonly_reason || (mixed_lines ? 'Mixed or legacy line endings: open externally to edit without changing the file format.' : null);
        if (mixed_lines) file.editable = false;
        file.loaded_bytes = Number.isFinite(result.loaded_bytes) ? result.loaded_bytes : result.size;
      }
      pane.body.textContent = '';
      const meta = create_el('div', 'tf-meta');
      const size = format_byte_size(result.size != null ? result.size : 0);
      const kind = result.kind || (result.binary ? 'binary' : 'text');
      meta.textContent = size;
      if (kind === 'text') {
        if (result.truncated) meta.textContent = `${size} (showing the first part, read-only)`;
        paint_text_editor(grid, pane, file, meta);
        restore_editor_view_state(pane, previous);
        if (refresh && file && file.status_el) file.status_el.textContent = 'reloaded';
      } else if (kind === 'image') {
        const media = create_el('div', 'tf-media');
        const image = create_el('img', 'tf-image');
        image.alt = pane.name;
        // The query defeats the image cache, which would keep showing the old file after a change on disk.
        image.src = `${result.url}?v=${Math.round(result.mtime)}`;
        image.addEventListener('load', () => {
          meta.textContent = `${size} · ${image.naturalWidth} × ${image.naturalHeight}`;
        });
        media.append(image);
        pane.body.append(meta, media);
      } else if (kind === 'pdf') {
        const frame = create_el('iframe', 'tf-frame');
        frame.src = result.url;
        pane.body.append(frame);
      } else if (kind === 'video' || kind === 'audio') {
        const media = create_el('div', 'tf-media');
        const player = create_el(kind, `tf-${kind}`);
        player.controls = true;
        player.src = result.url;
        media.append(player);
        pane.body.append(meta, media);
      } else if (kind === 'docx') {
        meta.textContent = `${size} · converting document…`;
        pane.body.append(meta);
        const rendered = await window.hub.files.render_document(root_path, rel_path);
        if (pane.disposed) return;
        meta.textContent = `${size} · Word document (preview; layout is simplified)`;
        pane.body.append(document_frame(String(rendered.html || '')));
      } else if (kind === 'too_large') {
        pane.body.append(meta, file_unsupported(grid, pane, `This file is too large to preview (${size}).`));
      } else {
        const what = kind === 'office' ? 'This Office file has no built-in preview' : 'This is a binary file';
        pane.body.append(meta, file_unsupported(grid, pane, `${what} (${size}).`));
      }
    } catch (error) {
      if (pane.disposed) return;
      if (file && !read_done) file.missing = true;
      pane.body.textContent = '';
      pane.body.append(file_unsupported(grid, pane, `Could not preview this file: ${error_text(error)}`));
    }
  }

  function editor_view_state(pane) {
    const editor = pane.body.querySelector('.tf-editor');
    if (!editor) return null;
    return {
      top: editor.scrollTop,
      left: editor.scrollLeft,
      start: editor.selectionStart,
      end: editor.selectionEnd,
      focused: document.activeElement === editor,
    };
  }

  function restore_editor_view_state(pane, state) {
    const editor = pane.body.querySelector('.tf-editor');
    if (!editor || !state) return;
    if (state.focused) editor.focus();
    editor.setSelectionRange(state.start, state.end);
    editor.scrollTop = state.top;
    editor.scrollLeft = state.left;
  }

  function schedule_open_file_check() {
    if (file_check_timer) return;
    file_check_timer = window.setTimeout(() => {
      file_check_timer = 0;
      void check_open_files();
    }, FILE_CHECK_DELAY_MS);
  }

  // Each pane shows one file; the others reload anyway when their tab is activated.
  async function check_open_files() {
    if (file_check_running) {
      file_check_again = true;
      return;
    }
    file_check_running = true;
    try {
      for (const grid of LIVE_GRIDS) {
        for (const view of Array.from(grid.views.values())) {
          for (const pane of view.panes.slice()) {
            if (pane.kind !== 'file' || pane.disposed) continue;
            const file = pane.files[pane.active];
            if (file) await refresh_open_file(grid, pane, file);
          }
        }
      }
    } catch (error) {
      console.error('checking open files failed:', error_text(error));
    } finally {
      file_check_running = false;
      if (file_check_again) {
        file_check_again = false;
        schedule_open_file_check();
      }
    }
  }

  // Unsaved edits and our own in-flight saves are never replaced; a real clash still surfaces as a save conflict.
  function file_is_busy(file) {
    return file.dirty || file.conflict || file.closing || file.save_timer || file.saves_in_flight > 0;
  }

  async function refresh_open_file(grid, pane, file) {
    if ((!file.loaded && !file.missing) || file_is_busy(file)) return;
    const stat = await window.hub.files.stat(file.root, file.path);
    if (pane.disposed || pane.files[pane.active] !== file || file_is_busy(file)) return;
    if (!stat.exists) {
      if (file.missing) return;
      file.missing = true;
      await load_file_content(grid, pane);
      return;
    }
    if (!file.missing && Math.abs(stat.mtime - file.mtime) <= 1) return;
    await load_file_content(grid, pane, { refresh: { generation: file.edit_generation || 0 } });
  }

  function paint_text_editor(grid, pane, file, meta) {
    if (!meta) {
      pane.body.textContent = '';
      meta = create_el('div', 'tf-meta');
      meta.textContent = file.editable === false ? 'read-only preview' : '';
    }
    if (file.readonly_reason) meta.textContent = file.readonly_reason;
    const text = create_el('textarea', 'tf-text tf-editor');
    text.value = file.buffer != null ? file.buffer : '';
    text.spellcheck = false;
    text.readOnly = file.editable === false;
    const status = create_el('span', 'tf-save', file.conflict ? 'conflict' : (file.dirty ? 'edited' : 'saved'));
    meta.append(status);
    file.status_el = status;
    if (file.conflict || file.save_error) ensure_discard_button(grid, pane, file);
    if (file.editable !== false) {
      text.addEventListener('input', () => {
        file.edit_generation = (file.edit_generation || 0) + 1;
        file.buffer = file.line_ending === '\r\n' ? text.value.replace(/\r?\n/g, '\r\n') : text.value;
        file.dirty = file.buffer !== file.disk;
        status.textContent = file.dirty ? 'edited' : 'saved';
        render_file_tabs(grid, pane);
        schedule_save(grid, pane, file);
      });
    }
    pane.body.append(meta, text);
  }

  function schedule_save(grid, pane, file) {
    if (file.save_timer) window.clearTimeout(file.save_timer);
    file.save_timer = window.setTimeout(() => {
      file.save_timer = 0;
      void enqueue_save(grid, pane, file, file.buffer, file.edit_generation || 0);
    }, 600);
  }

  function enqueue_save(grid, pane, file, snapshot, generation) {
    const epoch = file.save_epoch || 0;
    const previous = file.save_tail || Promise.resolve();
    file.saves_in_flight = (file.saves_in_flight || 0) + 1;
    const run = previous.then(() => perform_save(grid, pane, file, snapshot, generation, epoch));
    const settle = () => {
      file.saves_in_flight -= 1;
      return null;
    };
    file.save_tail = run.then(settle, settle);
    return run;
  }

  function flush_editor(grid, pane, file) {
    if (file.save_timer) {
      window.clearTimeout(file.save_timer);
      file.save_timer = 0;
    }
    return enqueue_save(grid, pane, file, file.buffer, file.edit_generation || 0);
  }

  function save_still_current(file, epoch) {
    return !!file && (file.save_epoch || 0) === epoch;
  }

  async function perform_save(grid, pane, file, snapshot, generation, epoch) {
    if (!save_still_current(file, epoch) || file.editable === false) return { saved: false, cancelled: true };
    if (!file.dirty) {
      return file.disk === snapshot && !file.conflict ? { saved: true } : { saved: false, cancelled: true };
    }
    if (file.status_el) file.status_el.textContent = 'saving';
    try {
      if (!save_still_current(file, epoch)) return { saved: false, cancelled: true };
      const outcome = await window.hub.files.write(file.root, file.path, snapshot, file.mtime, file.loaded_bytes);
      if (!save_still_current(file, epoch)) return { saved: false, cancelled: true };
      if (outcome && outcome.conflict) {
        file.conflict = true;
        file.dirty = true;
        if (file.buffer == null) file.buffer = snapshot;
        if (file.status_el) file.status_el.textContent = 'conflict';
        show_banner(grid, outcome.deleted
          ? `${file.name} was deleted on disk. Your edits are still in the editor and the file was not recreated.`
          : `${file.name} changed on disk. Your edits are still in the editor and were not overwritten.`);
        ensure_discard_button(grid, pane, file);
        render_file_tabs(grid, pane);
        return { saved: false, conflict: true };
      }
      clear_save_error(file);
      file.mtime = outcome.mtime;
      file.loaded_bytes = outcome.size;
      const newer = file.buffer !== snapshot || (file.edit_generation || 0) !== generation;
      file.disk = snapshot;
      if (newer) {
        file.dirty = true;
        if (file.status_el) file.status_el.textContent = 'edited';
        schedule_save(grid, pane, file);
        return { saved: false, pending: true };
      }
      file.dirty = false;
      file.conflict = false;
      file.buffer = snapshot;
      if (file.status_el) file.status_el.textContent = 'saved';
      render_file_tabs(grid, pane);
      return { saved: true };
    } catch (error) {
      if (!save_still_current(file, epoch)) return { saved: false, cancelled: true };
      file.dirty = true;
      file.save_error = true;
      if (file.status_el) file.status_el.textContent = 'error';
      show_banner(grid, `Could not save ${file.name}: ${error_text(error)}`);
      ensure_discard_button(grid, pane, file);
      return { saved: false, error: true };
    }
  }

  // A later save worked (say the file stopped being read-only), so the way out is no longer needed.
  function clear_save_error(file) {
    if (!file.save_error) return;
    file.save_error = false;
    const meta = file.status_el && file.status_el.parentElement;
    const discard = meta && meta.querySelector('.tf-discard');
    if (discard) discard.remove();
  }

  function ensure_discard_button(grid, pane, file) {
    const meta = file.status_el && file.status_el.parentElement;
    if (!meta || meta.querySelector('.tf-discard')) return;
    const discard = create_el('button', 'tf-discard', 'Discard my edits');
    discard.type = 'button';
    discard.title = 'Replace the unsaved edits with the file on disk';
    discard.addEventListener('click', () => {
      file.save_epoch = (file.save_epoch || 0) + 1;
      if (file.save_timer) {
        window.clearTimeout(file.save_timer);
        file.save_timer = 0;
      }
      file.conflict = false;
      file.save_error = false;
      file.dirty = false;
      file.loaded = false;
      pane.active = Math.max(0, pane.files.indexOf(file));
      clear_banner(grid);
      render_file_tabs(grid, pane);
      void load_file_content(grid, pane);
    });
    meta.append(discard);
  }

  async function flush_dirty_editors(grid) {
    const held = [];
    const pending = [];
    for (const view of grid.views.values()) {
      for (const pane of view.panes) {
        if (pane.disposed || pane.kind !== 'file' || !pane.files) continue;
        for (const file of pane.files) {
          if (file.editable === false) continue;
          if (file.conflict) {
            held.push({ pane, file });
            continue;
          }
          if (!file.dirty) continue;
          pending.push(flush_editor(grid, pane, file).then((result) => ({ pane, file, result })));
        }
      }
    }
    const finished = await Promise.all(pending);
    for (const { pane, file, result } of finished) {
      if (!result || !result.saved || file.dirty || file.conflict) held.push({ pane, file });
    }
    if (held.length === 0) return { ok: true };
    const names = [...new Set(held.map(({ file }) => file.name))].join(', ');
    reveal_held_file(grid, held[0]);
    for (const { pane, file } of held) {
      if (file.conflict || file.save_error) ensure_discard_button(grid, pane, file);
    }
    show_banner(grid, `Close cancelled. Keep, save, or discard unsaved edits in: ${names}`);
    return { ok: false, blocked: names };
  }

  // A blocked close must show why, wherever the file is: another workspace, another page, another tab,
  // or behind the launch page, which hides the banner too.
  function reveal_held_file(grid, { pane, file }) {
    try {
      grid.on_attention(pane.view.workspace);
    } catch (error) {
      console.error('on_attention failed:', error);
    }
    select_tab(grid, pane);
    if (pane.files[pane.active] !== file) void activate_file(grid, pane, pane.files.indexOf(file), false);
  }

  // One file region per page. Further files become tabs in that region.
  function open_file_in_grid(grid, workspace, rel_path, root_path, page) {
    const view = grid.views.get(workspace.id);
    if (!view || typeof rel_path !== 'string' || rel_path === '') return;
    page = page || view.active_page;
    if (page.closing || !view.pages.includes(page)) return;
    const visible_page = view.active_page;
    view.active_page = page;
    const root = root_path || (view.file_panel && view.file_panel.current_root ? view.file_panel.current_root() : workspace.path);
    let pane = file_group(view);
    if (!pane) {
      pane = build_file_pane(grid, view, { name: 'Files', path: rel_path });
      mount_file_pane(grid, view, pane);
    }
    let index = pane.files.findIndex((file) => file.root === root && file.path === rel_path);
    if (index === -1) {
      pane.files.push({
        root,
        path: rel_path,
        name: rel_path.split(/[\\/]/).pop() || rel_path,
        dirty: false,
        loaded: false,
      });
      index = pane.files.length - 1;
      // The file panel already watches the workspace. Elsewhere only this one folder is watched.
      if (!path_is_under(workspace.path, root)) window.hub.files.watch(root, { recursive: false }).catch(() => {});
    }
    void activate_file(grid, pane, index, true);
    view.active_page = visible_page;
    relayout_view(grid, view);
    if (visible_page === page) select_tab(grid, pane);
    if (!view.hold_layout) save_view_layout(grid, view);
  }

  // ---- tiled layout ----
  // Panes tile the pane area like split editors, so they never overlap. view.layout is a split tree:
  //   leaf:  { type: 'leaf', pane }
  //   split: { type: 'split', dir: 'row' | 'column', children: [node, ...], sizes: [fractions summing to 1] }
  // A new pane splits the largest pane along its longer side. Dividers between siblings resize them.
  // Dragging a title bar onto another pane moves it there: near an edge it splits beside that pane,
  // in the middle the two swap places. Double-clicking a title bar maximizes the pane (and back).
  // pane.rect is the computed {x, y, w, h} as fractions of the pane area.

  const FULL_RECT = { x: 0, y: 0, w: 1, h: 1 };

  function pane_key(pane) {
    if (pane.kind === 'file') return pane.page_id === 'page-1' ? 'file-group' : `file-group:${pane.page_id}`;
    return pane.record_id || pane.slot_id || `pane-${pane.pane_id}`;
  }

  function serialize_layout(node) {
    if (!node) return null;
    if (node.type === 'leaf') return { type: 'leaf', key: pane_key(node.pane) };
    return {
      type: 'split',
      dir: node.dir,
      sizes: node.sizes.map((size) => Math.round(size * 10000) / 10000),
      children: node.children.map(serialize_layout),
    };
  }

  function save_view_layout(grid, view) {
    if (!view || !view.workspace || view.disposed || view.hold_layout) return;
    save_workspace_ui(view.workspace.id, {
      files_open: view.files_open,
      files_width: view.files_width,
      tree: serialize_layout(view.layout),
      active_page: view.active_page.id,
      pages: view.pages.map((page) => ({ id: page.id, name: page.name, tree: serialize_layout(page.layout) })),
      file_tabs: view.panes.filter((pane) => pane.kind === 'file').flatMap((pane) =>
        pane.files.map((file) => ({ root: file.root, path: file.path, page_id: pane.page_id }))),
    });
  }

  function apply_saved_layout(view) {
    const saved = workspace_ui(view.workspace.id);
    if (!saved.tree && !saved.pages) return;
    const pool = new Map();
    for (const pane of view.panes) pool.set(pane_key(pane), pane);
    const rebuild = (node) => {
      if (!node) return null;
      if (node.type === 'leaf') {
        const pane = pool.get(node.key);
        if (!pane) return null;
        pool.delete(node.key);
        return { type: 'leaf', pane };
      }
      const children = [];
      const sizes = [];
      (node.children || []).forEach((child, index) => {
        const built = rebuild(child);
        if (!built) return;
        children.push(built);
        sizes.push(node.sizes && node.sizes[index] ? node.sizes[index] : 1);
      });
      if (children.length === 0) return null;
      if (children.length === 1) return children[0];
      const sum = sizes.reduce((total, size) => total + size, 0) || 1;
      return {
        type: 'split',
        dir: node.dir === 'row' ? 'row' : 'column',
        children,
        sizes: sizes.map((size) => size / sum),
      };
    };
    const assign = (node, page) => {
      if (!node) return;
      if (node.type === 'leaf') node.pane.page_id = page.id;
      else node.children.forEach((child) => assign(child, page));
    };
    for (const page of view.pages) {
      const record = saved.pages ? saved.pages.find((item) => item.id === page.id) : saved;
      page.layout = rebuild(record && record.tree);
      assign(page.layout, page);
    }
    view.active_page = view.pages.find((page) => page.id === saved.active_page) || view.pages[0];
    for (const pane of pool.values()) {
      pane.page_id = view.active_page.id;
      insert_into_layout(view, pane);
    }
  }

  function ensure_forget_button(grid, pane, record_id) {
    if (pane.forget_btn) return;
    const button = create_el('button', 'tg-restart', 'Forget');
    button.type = 'button';
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      try { await window.hub.sessions.discard(record_id); }
      catch (error) { show_banner(grid, error_text(error)); return; }
      remove_pane(grid, pane);
      notify_grid(grid);
    });
    pane.titlebar.append(button);
    pane.forget_btn = button;
  }

  async function open_quick_open(grid) {
    const view = grid.active_view;
    if (!view) return;
    let overlay = view.quick;
    if (!overlay) {
      overlay = create_el('div', 'tg-quick');
      const input = create_el('input', 'tg-quick-input');
      input.type = 'text';
      input.placeholder = 'File name in this root';
      const list = create_el('div', 'tg-quick-list');
      overlay.append(input, list);
      view.root.append(overlay);
      view.quick = overlay;
      const live_root = () => (view.file_panel && view.file_panel.current_root ? view.file_panel.current_root() : view.workspace.path);
      input.addEventListener('keydown', async (event) => {
        if (event.key === 'Escape') { overlay.hidden = true; return; }
        if (event.key === 'Enter') {
          const chosen = list.querySelector('.tg-quick-item');
          if (chosen) open_file_in_grid(grid, view.workspace, chosen.dataset.path, live_root());
          overlay.hidden = true;
        }
      });
      input.addEventListener('input', async () => {
        const found = await window.hub.files.search(live_root(), input.value);
        list.textContent = '';
        for (const item of (found && found.results) || []) {
          const row = create_el('button', 'tg-quick-item', item.rel);
          row.type = 'button';
          row.dataset.path = item.rel;
          row.addEventListener('click', () => {
            open_file_in_grid(grid, view.workspace, item.rel, live_root());
            overlay.hidden = true;
          });
          list.append(row);
        }
      });
    }
    overlay.hidden = false;
    const input = overlay.querySelector('input');
    input.value = '';
    input.focus();
    input.dispatchEvent(new Event('input'));
  }

  // -> { leaf, parent, index, grand, grand_index } for the leaf that holds pane, or null.
  function locate_leaf(node, pane, parent, index, grand, grand_index) {
    if (!node) return null;
    if (node.type === 'leaf') {
      return node.pane === pane ? { leaf: node, parent, index, grand, grand_index } : null;
    }
    for (let i = 0; i < node.children.length; i += 1) {
      const found = locate_leaf(node.children[i], pane, node, i, parent, index);
      if (found) return found;
    }
    return null;
  }

  function replace_child(view, parent, index, node) {
    if (parent) parent.children[index] = node;
    else view.layout = node;
  }

  function area_size(view) {
    const width = view.pane_grid.clientWidth;
    const height = view.pane_grid.clientHeight;
    // A hidden view measures 0x0; assume a typical landscape window then.
    return width > 0 && height > 0 ? { width, height } : { width: 1600, height: 900 };
  }

  function largest_pane(view) {
    let best = null;
    let best_area = -1;
    for (const pane of view.panes) {
      if (pane.disposed || pane.page_id !== view.active_page.id || !pane.rect) continue;
      const area = pane.rect.w * pane.rect.h;
      if (area > best_area + 1e-6) {
        best = pane;
        best_area = area;
      }
    }
    return best;
  }

  // Puts pane into the layout. With a target it goes on that side of it ('left' | 'right' | 'top' | 'bottom');
  // without one it splits the largest pane: side by side when that pane is wide, stacked when it is tall.
  function insert_into_layout(view, pane, target, side) {
    const leaf = { type: 'leaf', pane };
    if (!view.layout) {
      view.layout = leaf;
      return;
    }
    let anchor = target || largest_pane(view);
    let found = anchor ? locate_leaf(view.layout, anchor, null, 0, null, 0) : null;
    if (!found) {
      // Nothing measured yet: split the first leaf.
      let node = view.layout;
      while (node.type !== 'leaf') node = node.children[0];
      anchor = node.pane;
      found = locate_leaf(view.layout, anchor, null, 0, null, 0);
    }
    if (!side) {
      const size = area_size(view);
      const rect = anchor.rect || FULL_RECT;
      // Terminal cells are tall, so a pane must be clearly wider than high before it splits sideways.
      side = rect.w * size.width >= rect.h * size.height * 1.1 ? 'right' : 'bottom';
    }
    const dir = side === 'left' || side === 'right' ? 'row' : 'column';
    const before = side === 'left' || side === 'top';
    const { parent, index } = found;
    if (parent && parent.dir === dir) {
      const half = parent.sizes[index] / 2;
      parent.sizes[index] = half;
      const at = before ? index : index + 1;
      parent.children.splice(at, 0, leaf);
      parent.sizes.splice(at, 0, half);
      return;
    }
    const split = {
      type: 'split',
      dir,
      children: before ? [leaf, found.leaf] : [found.leaf, leaf],
      sizes: [0.5, 0.5],
    };
    replace_child(view, parent, index, split);
  }

  // Takes pane out of the layout; its space goes to the neighbour before it (or after, when it was first).
  function remove_from_layout(view, pane) {
    const found = locate_leaf(view.layout, pane, null, 0, null, 0);
    if (!found) return;
    const { parent, index, grand, grand_index } = found;
    if (!parent) {
      view.layout = null;
      return;
    }
    const freed = parent.sizes[index];
    parent.children.splice(index, 1);
    parent.sizes.splice(index, 1);
    parent.sizes[Math.max(0, index - 1)] += freed;
    if (parent.children.length > 1) return;
    // One child left: the split disappears. A child split in the grandparent's direction merges into it.
    const only = parent.children[0];
    if (grand && only.type === 'split' && only.dir === grand.dir) {
      const share = grand.sizes[grand_index];
      grand.children.splice(grand_index, 1, ...only.children);
      grand.sizes.splice(grand_index, 1, ...only.sizes.map((size) => size * share));
      return;
    }
    replace_child(view, grand, grand_index, only);
  }

  // Fills pane.rect for every leaf and collects the dividers between siblings.
  function compute_layout(node, rect, dividers) {
    if (node.type === 'leaf') {
      node.pane.rect = rect;
      return;
    }
    let offset = 0;
    node.children.forEach((child, i) => {
      const size = node.sizes[i];
      const child_rect =
        node.dir === 'row'
          ? { x: rect.x + offset * rect.w, y: rect.y, w: size * rect.w, h: rect.h }
          : { x: rect.x, y: rect.y + offset * rect.h, w: rect.w, h: size * rect.h };
      compute_layout(child, child_rect, dividers);
      offset += size;
      if (i < node.children.length - 1) dividers.push({ split: node, index: i, rect, offset });
    });
  }

  // Prune stale leaves and normalize each split, including layouts saved by older builds.
  function compact_layout(node, panes) {
    if (!node) return null;
    if (node.type === 'leaf') return !node.pane.disposed && panes.includes(node.pane) ? node : null;
    const children = [];
    const sizes = [];
    node.children.forEach((child, index) => {
      const live = compact_layout(child, panes);
      if (!live) return;
      children.push(live);
      const weight = Number(node.sizes[index]);
      sizes.push(Number.isFinite(weight) && weight > 0 ? weight : 1);
    });
    if (!children.length) return null;
    if (children.length === 1) return children[0];
    const total = sizes.reduce((sum, size) => sum + size, 0);
    node.children = children;
    node.sizes = sizes.map((size) => size / total);
    return node;
  }

  function relayout_view(grid, view) {
    const panes = view.panes.filter((pane) => pane.page_id === view.active_page.id && !pane.disposed);
    view.layout = compact_layout(view.layout, panes);
    const dividers = [];
    if (view.layout) compute_layout(view.layout, FULL_RECT, dividers);
    if (!panes.includes(view.selected)) view.selected = panes[0] || null;
    for (const pane of view.panes) {
      pane.element.hidden = !panes.includes(pane);
      if (!pane.element.hidden) place_pane(pane);
    }
    render_tabs(grid, view);
    render_dividers(grid, view, dividers);
    view.hint.hidden = panes.length > 0;
    view.split_button.disabled = !panes.some((pane) => pane.term);
    if (grid.active_view === view) update_note(grid);
  }

  function count_panes(view) {
    let counted = 0;
    for (const pane of view.panes) {
      if (!pane.disposed) counted += 1;
    }
    return counted;
  }

  function place_pane(pane) {
    const rect = pane.rect || FULL_RECT;
    const element = pane.element;
    const half_gap = PANE_GAP_PX / 2;
    element.hidden = false;
    element.classList.remove('tg-zoomed');
    element.style.left = `calc(${rect.x * 100}% + ${half_gap}px)`;
    element.style.top = `calc(${rect.y * 100}% + ${half_gap}px)`;
    element.style.width = `calc(${rect.w * 100}% - ${PANE_GAP_PX}px)`;
    element.style.height = `calc(${rect.h * 100}% - ${PANE_GAP_PX}px)`;
  }

  // Divider elements are reused by position, so the one being dragged keeps its pointer capture
  // while the layout is recomputed under it.
  function render_dividers(grid, view, dividers) {
    if (!view.dividers) view.dividers = [];
    while (view.dividers.length > dividers.length) view.dividers.pop().remove();
    while (view.dividers.length < dividers.length) {
      const element = create_el('div', 'tg-divider');
      element.addEventListener('pointerdown', (event) => start_divider_drag(grid, view, element, event));
      view.pane_grid.appendChild(element);
      view.dividers.push(element);
    }
    dividers.forEach((info, i) => {
      const element = view.dividers[i];
      element.divider = info;
      const { rect, offset, split } = info;
      const row = split.dir === 'row';
      element.classList.toggle('tg-divider-row', row);
      element.classList.toggle('tg-divider-column', !row);
      if (row) {
        element.style.left = `calc(${(rect.x + offset * rect.w) * 100}% - ${DIVIDER_HIT_PX / 2}px)`;
        element.style.top = `${rect.y * 100}%`;
        element.style.width = `${DIVIDER_HIT_PX}px`;
        element.style.height = `${rect.h * 100}%`;
      } else {
        element.style.left = `${rect.x * 100}%`;
        element.style.top = `calc(${(rect.y + offset * rect.h) * 100}% - ${DIVIDER_HIT_PX / 2}px)`;
        element.style.width = `${rect.w * 100}%`;
        element.style.height = `${DIVIDER_HIT_PX}px`;
      }
    });
  }

  function start_divider_drag(grid, view, element, event) {
    const info = element.divider;
    if (!info || event.button !== 0) return;
    event.preventDefault();
    const { split, index, rect } = info;
    const row = split.dir === 'row';
    const size = area_size(view);
    const span_px = Math.max(1, row ? rect.w * size.width : rect.h * size.height);
    const start_pos = row ? event.clientX : event.clientY;
    const first = split.sizes[index];
    const pair = first + split.sizes[index + 1];
    const min = Math.min(pair / 2, MIN_PANE_PX / span_px);
    element.setPointerCapture(event.pointerId);
    element.classList.add('tg-divider-active');
    view.root.classList.add(row ? 'tg-resizing-row' : 'tg-resizing-column');

    const on_move = (move_event) => {
      const delta = ((row ? move_event.clientX : move_event.clientY) - start_pos) / span_px;
      const next = Math.min(pair - min, Math.max(min, first + delta));
      split.sizes[index] = next;
      split.sizes[index + 1] = pair - next;
      relayout_view(grid, view);
    };
    const on_end = () => {
      element.removeEventListener('pointermove', on_move);
      element.removeEventListener('pointerup', on_end);
      element.removeEventListener('pointercancel', on_end);
      element.classList.remove('tg-divider-active');
      view.root.classList.remove('tg-resizing-row', 'tg-resizing-column');
      save_view_layout(grid, view);
    };
    element.addEventListener('pointermove', on_move);
    element.addEventListener('pointerup', on_end);
    element.addEventListener('pointercancel', on_end);
  }

  // Which pane (other than the dragged one) is under the pointer, and where: an edge or the centre.
  function find_drop_spot(view, dragged, client_x, client_y) {
    const area = view.pane_grid.getBoundingClientRect();
    for (const pane of view.panes) {
      if (pane === dragged || pane.disposed || pane.page_id !== view.active_page.id || !pane.rect) continue;
      const left = area.left + pane.rect.x * area.width;
      const top = area.top + pane.rect.y * area.height;
      const width = pane.rect.w * area.width;
      const height = pane.rect.h * area.height;
      if (client_x < left || client_x > left + width || client_y < top || client_y > top + height) continue;
      const rx = (client_x - left) / width;
      const ry = (client_y - top) / height;
      const edges = [
        ['left', rx],
        ['right', 1 - rx],
        ['top', ry],
        ['bottom', 1 - ry],
      ];
      edges.sort((a, b) => a[1] - b[1]);
      const zone = edges[0][1] < DROP_EDGE_ZONE ? edges[0][0] : 'center';
      return { target: pane, zone };
    }
    return null;
  }

  function show_drop_indicator(view, spot) {
    if (!view.drop_indicator) {
      view.drop_indicator = create_el('div', 'tg-drop-indicator');
      view.pane_grid.appendChild(view.drop_indicator);
    }
    const indicator = view.drop_indicator;
    if (!spot) {
      indicator.hidden = true;
      return;
    }
    const rect = Object.assign({}, spot.target.rect);
    if (spot.zone === 'left' || spot.zone === 'right') {
      rect.w /= 2;
      if (spot.zone === 'right') rect.x += rect.w;
    } else if (spot.zone === 'top' || spot.zone === 'bottom') {
      rect.h /= 2;
      if (spot.zone === 'bottom') rect.y += rect.h;
    }
    indicator.hidden = false;
    indicator.classList.toggle('tg-drop-swap', spot.zone === 'center');
    indicator.style.left = `calc(${rect.x * 100}% + ${PANE_GAP_PX / 2}px)`;
    indicator.style.top = `calc(${rect.y * 100}% + ${PANE_GAP_PX / 2}px)`;
    indicator.style.width = `calc(${rect.w * 100}% - ${PANE_GAP_PX}px)`;
    indicator.style.height = `calc(${rect.h * 100}% - ${PANE_GAP_PX}px)`;
  }

  function move_pane(grid, view, pane, spot) {
    if (spot.zone === 'center') {
      const a = locate_leaf(view.layout, pane, null, 0, null, 0);
      const b = locate_leaf(view.layout, spot.target, null, 0, null, 0);
      if (!a || !b) return;
      a.leaf.pane = spot.target;
      b.leaf.pane = pane;
    } else {
      remove_from_layout(view, pane);
      insert_into_layout(view, pane, spot.target, spot.zone);
    }
    relayout_view(grid, view);
    save_view_layout(grid, view);
  }

  function toggle_zoom() {
    // Fixed panes: a double-click must not maximize or hide the other agents.
  }

  // Title bar: drag onto another pane to move it there; double-click to maximize or restore.
  // Listeners for one drag live only for that drag (pointer capture), so nothing piles up on window.
  function attach_pane_rearrange(grid, pane) {
    const handle = pane.titlebar;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (event.target && event.target.closest && event.target.closest('button')) return;
      const view = pane.view;
      const start_x = event.clientX;
      const start_y = event.clientY;
      let dragging = false;
      let spot = null;
      handle.setPointerCapture(event.pointerId);

      const on_move = (move_event) => {
        if (!dragging) {
          const moved = Math.hypot(move_event.clientX - start_x, move_event.clientY - start_y);
          if (moved < DRAG_START_PX || count_panes(view) < 2) return;
          dragging = true;
          pane.element.classList.add('tg-dragging');
          view.root.classList.add('tg-rearranging');
        }
        spot = find_drop_spot(view, pane, move_event.clientX, move_event.clientY);
        show_drop_indicator(view, spot);
      };
      const on_end = (end_event) => {
        handle.removeEventListener('pointermove', on_move);
        handle.removeEventListener('pointerup', on_end);
        handle.removeEventListener('pointercancel', on_end);
        if (!dragging) return;
        pane.element.classList.remove('tg-dragging');
        view.root.classList.remove('tg-rearranging');
        show_drop_indicator(view, null);
        if (spot && end_event.type === 'pointerup' && !pane.disposed && !spot.target.disposed) {
          move_pane(grid, view, pane, spot);
        }
      };
      handle.addEventListener('pointermove', on_move);
      handle.addEventListener('pointerup', on_end);
      handle.addEventListener('pointercancel', on_end);
    });
    handle.addEventListener('dblclick', (event) => {
      if (event.target && event.target.closest && event.target.closest('button')) return;
      event.preventDefault();
      toggle_zoom();
    });
  }

  function refit_pane(pane) {
    if (pane.disposed || !pane.fit) return;
    if (pane.body.clientWidth === 0 || pane.body.clientHeight === 0) return;
    try {
      pane.fit.fit();
    } catch (error) {
      console.error('fit failed:', error);
      return;
    }
    pane.element.setAttribute('data-cols', String(pane.term.cols));
    pane.element.setAttribute('data-rows', String(pane.term.rows));
  }

  function refit_view(view) {
    for (const pane of view.panes) {
      refit_pane(pane);
      if (!pane.disposed && pane.term) pane.term.refresh(0, Math.max(0, pane.term.rows - 1));
    }
  }

  function schedule_refit(pane) {
    if (pane.refit_frame || pane.disposed) return;
    pane.refit_frame = window.requestAnimationFrame(() => {
      pane.refit_frame = 0;
      refit_pane(pane);
    });
  }

  function set_pane_status(pane, status, exit_code) {
    pane.status = status;
    pane.exit_code = exit_code;
    pane.element.setAttribute('data-status', status);
    pane.element.setAttribute('data-terminal-id', pane.terminal_id || '');
    pane.dot.classList.toggle('tg-dot-running', status === 'running');
    pane.dot.title = STATUS_TEXT[status];
    pane.restart_btn.hidden = status !== 'exited';
  }

  function bind_terminal(pane, terminal_id, status, exit_code) {
    if (pane.terminal_id && PANE_BY_TERMINAL.get(pane.terminal_id) === pane) {
      PANE_BY_TERMINAL.delete(pane.terminal_id);
    }
    pane.terminal_id = terminal_id;
    PANE_BY_TERMINAL.set(terminal_id, pane);
    set_pane_status(pane, status, exit_code);
    save_view_layout(pane.grid, pane.view);
    if (status === 'running') {
      window.hub.terminals.resize(terminal_id, pane.term.cols, pane.term.rows);
    }
  }

  // extra may override cwd, use_worktree, restore_record_id, resume_session_id and title (restore passes the saved title).
  // Resolves with the terminal id; the pane then knows its real cwd and worktree (null without one).
  async function launch_terminal(pane, extra) {
    refit_pane(pane);
    const options = Object.assign(
      {
        workspace_id: pane.workspace_id,
        agent_id: pane.agent_id,
        cwd: pane.cwd,
        command: pane.command,
        title: encode_title(pane.name, pane.agent_id, pane.agent_label),
        cols: pane.term.cols,
        rows: pane.term.rows,
        use_worktree: false,
        restore_record_id: null,
        resume_session_id: null,
      },
      extra || {}
    );
    const result = await window.hub.terminals.create(options);
    pane.cwd = result.cwd || options.cwd;
    pane.base_cwd = result.base_cwd || pane.base_cwd;
    pane.worktree = result.worktree || null;
    pane.record_id = result.record_id || pane.record_id;
    pane.model_id = result.model_id || pane.model_id;
    pane.provider_id = result.provider_id || pane.provider_id;
    pane.resume_mode = result.resume_mode || pane.resume_mode;
    if (pane.record_id) pane.slot_id = pane.record_id;
    pane.element.setAttribute('data-worktree', pane.worktree ? pane.worktree.path : '');
    return result.terminal_id;
  }

  function set_active_pane(grid, pane) {
    const previous = grid.active_pane;
    if (previous && previous !== pane) previous.element.classList.remove('tg-active');
    grid.active_pane = pane;
    pane.view.selected = pane;
    pane.element.classList.add('tg-active');
    render_tabs(grid, pane.view);
    sync_file_context(pane.view, pane);
  }

  function select_tab(grid, pane) {
    if (!pane || pane.disposed) return;
    const view = pane.view;
    if (pane.page_id !== view.active_page.id) {
      select_page(grid, view, view.pages.find((page) => page.id === pane.page_id));
    }
    set_active_pane(grid, pane);
    render_tabs(grid, view);
    if (pane.term) pane.term.focus();
    else if (pane.body) pane.body.focus();
  }

  function sync_file_context(view, pane) {
    if (!view.file_panel || typeof view.file_panel.set_context !== 'function') return;
    if (pane.kind === 'file') {
      const file = pane.files && pane.files[pane.active];
      if (file) view.file_panel.select(file.path);
      return;
    }
    const root = pane.worktree && pane.worktree.path ? pane.worktree.path : pane.cwd || view.workspace.path;
    const branch = pane.worktree && pane.worktree.branch ? pane.worktree.branch : '';
    view.file_panel.set_context({
      path: root,
      label: branch ? `${view.workspace.name} · ${branch}` : view.workspace.name,
    });
  }

  function make_page(view) {
    let number = 1;
    while (view.pages.some((page) => page.id === `page-${number}`)) number += 1;
    return { id: `page-${number}`, name: `Page ${number}`, layout: null };
  }

  function select_page(grid, view, page) {
    if (!page || !view.pages.includes(page)) return;
    view.active_page = page;
    relayout_view(grid, view);
    if (view.selected) set_active_pane(grid, view.selected);
    else if (grid.active_pane && grid.active_pane.view === view) {
      grid.active_pane.element.classList.remove('tg-active');
      grid.active_pane = null;
      if (view.file_panel) view.file_panel.set_context({ path: view.workspace.path, label: view.workspace.name });
    }
    refit_view(view);
    if (view.selected && view.selected.term) view.selected.term.focus();
    save_view_layout(grid, view);
  }

  async function close_page(grid, view, page) {
    if (page.closing) return;
    page.closing = true;
    try {
      const panes = view.panes.filter((pane) => pane.page_id === page.id);
      // Save editors before ending any terminals. Conflicted edits keep their page open.
      for (const pane of panes.filter((pane) => pane.kind === 'file')) {
        while (!pane.disposed && pane.files.length) {
          const count = pane.files.length;
          await close_file_at(grid, pane, pane.active);
          if (!pane.disposed && pane.files.length === count) return;
        }
      }
      for (const pane of panes.filter((pane) => pane.kind !== 'file')) await close_pane(grid, pane);
      const index = view.pages.indexOf(page);
      view.pages.splice(index, 1);
      if (!view.pages.length) view.pages.push(make_page(view));
      select_page(grid, view, view.active_page === page ? view.pages[Math.max(0, index - 1)] : view.active_page);
    } finally { page.closing = false; }
  }

  function render_tabs(grid, view) {
    view.tabs.replaceChildren();
    view.tabs.hidden = view.pages.length <= 1;
    for (const page of view.pages) {
      const tab = create_el('div', 'tg-tab');
      tab.dataset.pageId = page.id;
      const selected = view.active_page === page;
      tab.classList.toggle('tg-tab-active', selected);
      const button = create_el('button', 'tg-tab-select', page.name);
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.addEventListener('click', () => select_page(grid, view, page));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = view.pages.indexOf(page);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? view.pages.length - 1 :
          (index + (event.key === 'ArrowLeft' ? -1 : 1) + view.pages.length) % view.pages.length;
        select_page(grid, view, view.pages[next]);
        view.tabs.querySelector(`[data-page-id="${view.active_page.id}"] button`).focus();
      });
      const close = create_el('button', 'tg-tab-close', '×');
      close.type = 'button';
      close.setAttribute('aria-label', `Close ${page.name}`);
      close.addEventListener('click', () => void close_page(grid, view, page));
      tab.append(button, close);
      view.tabs.append(tab);
    }
  }

  function remove_pane(grid, pane) {
    if (pane.disposed) return;
    pane.disposed = true;
    const view = pane.view;
    const index = view.panes.indexOf(pane);
    if (index !== -1) view.panes.splice(index, 1);
    if (pane.terminal_id && PANE_BY_TERMINAL.get(pane.terminal_id) === pane) {
      PANE_BY_TERMINAL.delete(pane.terminal_id);
    }
    if (pane.refit_frame) window.cancelAnimationFrame(pane.refit_frame);
    if (pane.resize_timer) window.clearTimeout(pane.resize_timer);
    if (pane.observer) pane.observer.disconnect();
    if (pane.term) pane.term.dispose();
    pane.element.remove();
    const page = view.pages.find((item) => item.id === pane.page_id);
    if (page) {
      const holder = { layout: page.layout };
      remove_from_layout(holder, pane);
      page.layout = holder.layout;
    }
    if (grid.active_pane === pane) grid.active_pane = null;
    relayout_view(grid, view);
    if (!view.disposed && view.selected) select_tab(grid, view.selected);
    save_view_layout(grid, view);
    refit_view(view);
  }

  // First unused person name in this workspace; "Agent N" once the pool is used up.
  function next_free_name(view) {
    const used = new Set(view.panes.filter((pane) => !pane.disposed).map((pane) => pane.name));
    for (const name of NAME_POOL) {
      if (!used.has(name)) return name;
    }
    let number = 1;
    while (used.has(`Agent ${number}`)) number += 1;
    return `Agent ${number}`;
  }

  function seat_spec(view, seat) {
    const agent_id = clean_part(seat.agent_id) || DEFAULT_AGENT_ID;
    const agent_label = clean_part(seat.label) || agent_id;
    return {
      name: next_free_name(view),
      agent_id,
      agent_label,
      command: String((((window.find_agent && window.find_agent(agent_id)) || {}).launch_command) || seat.command || '').trim(),
      cwd: view.workspace.path,
      model_id: typeof seat.model_id === 'string' ? seat.model_id : null,
      provider_id: typeof seat.provider_id === 'string' ? seat.provider_id : null,
    };
  }

  // Seats are launched one after another: each hub.terminals.create must resolve before the next starts.
  // A failed seat shows a banner and its pane is removed; the remaining seats still launch.
  // options.use_worktree (from the launch page checkbox) puts every agent seat in its own git worktree.
  async function launch_seats_in_grid(grid, workspace, seats, options) {
    if (!workspace || !workspace.id || !Array.isArray(seats) || seats.length === 0) return;
    const view = ensure_view(grid, workspace);
    await wait_for_attach(view);
    if (view.disposed) return;

    const page = options && options.page_id ? view.pages.find((item) => item.id === options.page_id) : view.active_page;
    if (!page || page.closing) return;
    const want_worktree = Boolean(options && options.use_worktree === true);
    clear_banner(grid);
    const failures = [];
    let first_pane = null;
    for (const seat of seats) {
      if (view.disposed || page.closing || !view.pages.includes(page)) break;
      const spec = seat_spec(view, seat || {});
      if (options && options.cwd) spec.cwd = options.cwd;
      const pane = build_pane(grid, view, spec);
      const target = options && options.split_target;
      mount_pane(grid, view, pane, page, target && !target.disposed ? target : null, options && options.split_side);
      if (!first_pane) {
        first_pane = pane;
        if (view.active_page === page) set_active_pane(grid, pane);
      }
      try {
        const terminal_id = await launch_terminal(pane, {
          use_worktree: want_worktree && spec.agent_id !== AGENT_INSTALL_ID,
          model_id: spec.model_id,
          provider_id: spec.provider_id,
          base_cwd: view.workspace.path,
        });
        if (pane.disposed) {
          note_kept_worktree(grid, await kill_quietly(terminal_id));
          continue;
        }
        bind_terminal(pane, terminal_id, 'running', null);
      } catch (error) {
        failures.push(`${pane.name} (${pane.agent_label}): ${error_text(error)}`);
        if (!pane.disposed) remove_pane(grid, pane);
      }
      notify_grid(grid);
    }

    if (failures.length) show_banner(grid, failures.join(' | '));
    if (grid.active_view === view && view.active_page === page && first_pane && !first_pane.disposed) first_pane.term.focus();
  }

  // A saved record becomes a pane again: same title (name, agent), same command, the Claude session resumed when
  // there is one, and the worktree it had (when that folder still exists the process starts there).
  function restore_spec(record) {
    const decoded = decode_title(record.title, record.command);
    const worktree = record.worktree || null;
    return {
      name: decoded.name,
      agent_id: clean_part(record.agent_id) || decoded.agent_id,
      agent_label: decoded.agent_label,
      command: record.command,
      cwd: worktree ? worktree.path : record.cwd,
      base_cwd: worktree ? worktree.repo_path : record.cwd,
      worktree,
    };
  }

  // Recreates the saved sessions of one workspace (the caller decides when: first selection in this app run).
  // A record that cannot be started is discarded; the rest still start. Resolves with the number restored.
  async function restore_saved_in_grid(grid, workspace) {
    if (!workspace || !workspace.id) return 0;
    let records = [];
    try {
      records = await window.hub.sessions.list_saved(workspace.id);
    } catch (error) {
      show_banner(grid, error_text(error));
      return 0;
    }
    if (!Array.isArray(records) || records.length === 0) return 0;

    const view = ensure_view(grid, workspace);
    await wait_for_attach(view);
    if (view.disposed) return 0;
    view.hold_layout = true;

    clear_banner(grid);
    let restored = 0;
    const failures = [];
    for (const record of records) {
      if (view.disposed) break;
      const pane = build_pane(grid, view, restore_spec(record));
      pane.record_id = record.record_id;
      pane.model_id = record.model_id || null;
      pane.provider_id = record.provider_id || null;
      pane.resume_mode = record.resume_mode || null;
      pane.resume_session_id = record.claude_session_id || null;
      mount_pane(grid, view, pane);
      try {
        const resume_id = record.resume_mode === 'unverified' ? null : (record.claude_session_id || null);
        if (record.agent_id === 'claude' && !record.claude_session_id) {
          pane.term.write('\r\n[no Claude session id was saved; this starts a new conversation]\r\n');
        }
        const terminal_id = await launch_terminal(pane, {
          restore_record_id: record.record_id,
          resume_session_id: record.agent_id === 'claude' ? resume_id : null,
          title: record.title,
          use_worktree: false,
          model_id: record.model_id,
          provider_id: record.provider_id,
          base_cwd: record.base_cwd || (record.worktree ? record.worktree.repo_path : record.cwd),
        });
        if (pane.disposed) {
          note_kept_worktree(grid, await kill_quietly(terminal_id));
          continue;
        }
        bind_terminal(pane, terminal_id, 'running', null);
        if (restored === 0) set_active_pane(grid, pane);
        restored += 1;
      } catch (error) {
        const message = error_text(error);
        failures.push(`${pane.name}: ${message}`);
        if (!pane.disposed) {
          set_pane_status(pane, 'exited', null);
          pane.term.write(`\r\n[restore failed: ${message}. Use Restart or Forget.]\r\n`);
          pane.restore_failed = true;
          pane.record_id = record.record_id;
          ensure_forget_button(grid, pane, record.record_id);
        }
        try { await window.hub.sessions.note_error(record.record_id, message); }
        catch (note_error) { console.error('sessions.note_error failed:', error_text(note_error)); }
      }
      notify_grid(grid);
    }

    apply_saved_layout(view);
    relayout_view(grid, view);
    view.hold_layout = false;
    save_view_layout(grid, view);
    if (failures.length) {
      show_banner(grid, `Could not restore ${failures.join(' | ')}. Use Restart after fixing it, or Forget to remove the saved session.`);
    }
    return restored;
  }

  async function restart_pane(grid, pane) {
    if (pane.disposed || pane.status !== 'exited') return;
    const old_terminal_id = pane.terminal_id;
    // Restart reuses the current worktree. The saved record keeps its identity so main can resolve it.
    set_pane_status(pane, 'starting', null);
    pane.term.write('\r\n\x1b[2m[restarting]\x1b[0m\r\n');
    if (pane.resume_mode && pane.resume_mode !== 'conversation') {
      pane.term.write('\r\n[this restart opens the command again; it does not continue an agent conversation]\r\n');
    }
    if (old_terminal_id) {
      if (PANE_BY_TERMINAL.get(old_terminal_id) === pane) PANE_BY_TERMINAL.delete(old_terminal_id);
      try {
        await window.hub.terminals.close(old_terminal_id, { keep_worktree: true, keep_record: true });
      } catch (error) {
        show_banner(grid, error_text(error));
      }
    }

    try {
      const terminal_id = await launch_terminal(pane, {
        cwd: pane.cwd,
        base_cwd: pane.base_cwd,
        use_worktree: false,
        model_id: pane.model_id,
        provider_id: pane.provider_id,
        restore_record_id: pane.record_id,
        resume_session_id: pane.resume_mode === 'conversation' ? pane.resume_session_id || null : null,
      });
      if (pane.disposed) {
        note_kept_worktree(grid, await kill_quietly(terminal_id));
        return;
      }
      pane.restore_failed = false;
      if (pane.forget_btn) {
        pane.forget_btn.remove();
        pane.forget_btn = null;
      }
      bind_terminal(pane, terminal_id, 'running', null);
      clear_banner(grid);
      notify_grid(grid);
    } catch (error) {
      if (!pane.disposed) {
        set_pane_status(pane, 'exited', pane.exit_code);
        show_banner(grid, error_text(error));
        notify_grid(grid);
      }
    }
  }

  // Removes the pane, then ends its session. A worktree kept because it has changes is announced.
  async function close_pane(grid, pane) {
    if (pane.disposed) return null;
    const terminal_id = pane.terminal_id;
    remove_pane(grid, pane);
    notify_grid(grid);
    if (!terminal_id) return null;
    const result = await kill_quietly(terminal_id);
    note_kept_worktree(grid, result);
    return result;
  }

  function find_pane_in_grid(grid, terminal_id) {
    const pane = PANE_BY_TERMINAL.get(terminal_id);
    return pane && pane.grid === grid && !pane.disposed ? pane : null;
  }

  // Resolves once the pane exists (a workspace may still be re-attaching), true when focused.
  async function focus_session_in_grid(grid, terminal_id) {
    for (const view of grid.views.values()) await wait_for_attach(view);
    const pane = find_pane_in_grid(grid, terminal_id);
    if (!pane) return false;
    select_tab(grid, pane);
    return true;
  }

  async function close_session_in_grid(grid, terminal_id) {
    const pane = find_pane_in_grid(grid, terminal_id);
    if (pane) {
      await close_pane(grid, pane);
      return true;
    }
    if (EXTERNAL_TERMINALS.has(terminal_id)) {
      EXTERNAL_TERMINALS.delete(terminal_id);
      notify_all_grids();
      note_kept_worktree(grid, await kill_quietly(terminal_id));
      return true;
    }
    return false;
  }

  function init_terminal_grid(options) {
    const settings = options || {};
    if (!settings.container) throw new Error('init_terminal_grid: container is required');
    subscribe_hub_once();

    const grid = build_grid(settings.container, {
      on_counts_change: typeof settings.on_counts_change === 'function' ? settings.on_counts_change : () => {},
      on_sessions_change: typeof settings.on_sessions_change === 'function' ? settings.on_sessions_change : () => {},
      on_new_session_request:
        typeof settings.on_new_session_request === 'function' ? settings.on_new_session_request : () => {},
      on_attention: typeof settings.on_attention === 'function' ? settings.on_attention : () => {},
    });
    show_workspace_in_grid(grid, null);
    load_external_terminals();

    return {
      show_workspace: (workspace) => show_workspace_in_grid(grid, workspace || null),
      forget_workspace: (workspace_id) => forget_workspace_in_grid(grid, workspace_id),
      get_counts: () => compute_counts(grid),
      launch_seats: (workspace, seats, options) => launch_seats_in_grid(grid, workspace, seats, options),
      restore_saved_sessions: (workspace) => restore_saved_in_grid(grid, workspace),
      list_sessions: (workspace_id) => list_sessions_in_grid(grid, workspace_id),
      count_failed_restores: (workspace_id) => {
        const view = grid.views.get(workspace_id);
        return view ? view.panes.filter((pane) => pane.restore_failed && !pane.disposed).length : 0;
      },
      focus_session: (terminal_id) => focus_session_in_grid(grid, terminal_id),
      close_session: (terminal_id) => close_session_in_grid(grid, terminal_id),
      flush_editors: () => flush_dirty_editors(grid),
    };
  }

  window.init_terminal_grid = init_terminal_grid;
})();
