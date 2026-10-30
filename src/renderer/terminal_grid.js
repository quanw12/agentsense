// Terminal grid: one view per workspace; sessions are xterm panes with a free (drag & resize) layout.
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

  // Free pane layout. Rects are fractions {x, y, w, h} of the pane area; panes can be dragged
  // anywhere and resized from their edges, so the old fixed CSS grid is gone.
  // MIN_* keep panes usable; a pane is never dragged fully off screen.
  const MIN_PANE_PX = 140; // smallest width or height for any pane
  const MIN_PANE_WIDTH = MIN_PANE_PX;
  const MIN_PANE_HEIGHT = MIN_PANE_PX;
  const DRAG_VISIBLE_PX = 40; // at least this much of a pane stays inside while dragging
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

  function create_el(tag, class_name, text) {
    const node = document.createElement(tag);
    if (class_name) node.className = class_name;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function columns_for_count(count) {
    if (count <= 1) return 1;
    if (count <= 4) return 2;
    return 3;
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
    window.hub.terminals.on_data((terminal_id, data) => {
      const pane = PANE_BY_TERMINAL.get(terminal_id);
      if (pane) pane.term.write(data);
    });
    window.hub.terminals.on_exit((terminal_id, exit_code) => route_exit(terminal_id, exit_code));
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
    const grid = {
      container,
      on_counts_change: callbacks.on_counts_change,
      on_sessions_change: callbacks.on_sessions_change,
      on_new_session_request: callbacks.on_new_session_request,
      views: new Map(),
      active_view: null,
      active_pane: null,
      files_open: true,
      notice_timer: 0,
      dom: null,
    };
    grid.dom = build_frame(grid);
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
    files_button.title = 'Show or hide the workspace files panel';
    files_button.setAttribute('data-action', 'toggle_files');
    files_button.addEventListener('click', () => toggle_files_panel(grid));
    toolbar.append(new_button, files_button, note);

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
    return { root, new_button, files_button, note, banner, banner_text, notice, notice_text, views, empty };
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
    const count = view.panes.length;
    if (count === 0) {
      grid.dom.note.textContent = 'No terminals. Click + New session to start one.';
      return;
    }
    grid.dom.note.textContent = `${count} terminal${count === 1 ? '' : 's'}. Drag to move panes; drag the edges to resize.`;
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
    // Layout: [file panel | pane area]. The panel shows the workspace tree and accepts drag & drop;
    // tg-with-files on the root toggles its width on and off.
    const root = create_el('div', 'tg-view tg-with-files');
    const file_side = create_el('div', 'fp-side');
    const pane_area = create_el('div', 'tg-pane-area');
    const pane_grid = create_el('div', 'tg-grid');
    const hint = create_el('div', 'tg-hint', 'Click + New session to start a session');
    pane_area.append(pane_grid, hint);
    root.append(file_side, pane_area);
    grid.dom.views.appendChild(root);
    const view = {
      workspace,
      root,
      file_side,
      pane_area,
      pane_grid,
      hint,
      panes: [],
      attach_promise: null,
      ready: false,
      disposed: false,
    };
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
    grid.files_open = !grid.files_open;
    grid.dom.files_button.classList.toggle('tg-btn-selected', grid.files_open);
    for (const view of grid.views.values()) {
      view.root.classList.toggle('tg-with-files', grid.files_open);
    }
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

    for (const info of infos) EXTERNAL_TERMINALS.delete(info.terminal_id);
    for (const info of infos) {
      if (PANE_BY_TERMINAL.has(info.terminal_id)) continue;
      const decoded = decode_title(info.title, info.command);
      const pane = build_pane(grid, view, {
        name: decoded.name,
        agent_id: decoded.agent_id,
        agent_label: decoded.agent_label,
        command: info.command,
        cwd: info.cwd,
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
    }
    view.ready = true;
    notify_grid(grid);
  }

  // spec = { name, agent_id, agent_label, command, cwd, base_cwd?, worktree? }
  // cwd is where the pane runs now; base_cwd is the folder it was asked to use (the repo, when cwd is a worktree).
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

    // Free-layout handles: right edge, bottom edge and the bottom-right corner resize the pane;
    // the titlebar moves it (attach_pane_drag).
    const resize = {};
    const resize_e = create_el('div', 'tg-handle tg-handle-e');
    const resize_s = create_el('div', 'tg-handle tg-handle-s');
    const resize_se = create_el('div', 'tg-handle tg-handle-se');
    element.append(resize_e, resize_s, resize_se);
    resize.e = resize_e;
    resize.s = resize_s;
    resize.se = resize_se;

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
      element,
      titlebar,
      resize,
      rect: null, // filled by place_pane; null = uniform tiling slot for the current count
      dirty_layout: false, // true once the user moved or resized this pane by hand
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
      if (pane.status === 'running' && pane.terminal_id) {
        window.hub.terminals.resize(pane.terminal_id, cols, rows);
      }
    });
    attach_terminal_input(pane);
    restart_btn.addEventListener('click', (event) => {
      event.stopPropagation();
      restart_pane(grid, pane);
    });
    close_btn.addEventListener('click', (event) => {
      event.stopPropagation();
      close_pane(grid, pane);
    });
    element.addEventListener('mousedown', () => set_active_pane(grid, pane), true);
    element.addEventListener('mousedown', () => {
      // Focused panes float above the ones behind them.
      pane_serial += 1;
      element.style.zIndex = String(pane_serial);
    }, true);
    attach_pane_drag(pane);
    attach_pane_resize(pane, 'e');
    attach_pane_resize(pane, 's');
    attach_pane_resize(pane, 'se');

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

  function mount_pane(grid, view, pane) {
    view.panes.push(pane);
    view.pane_grid.appendChild(pane.element);
    relayout_view(grid, view);
    pane.term.open(pane.body);
    refit_pane(pane);
  }

  // ---- file viewer panes ----
  // A read-only pane that shows one workspace file. It has no terminal: close removes it, drag/resize
  // work like terminal panes (same handle logic), and it never counts as a running session.
  const FILE_READ_LIMIT = 512 * 1024; // must match files:read in the main process

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
    name_el.title = spec.name;
    const close_btn = create_el('button', 'tg-close', 'x');
    close_btn.type = 'button';
    close_btn.title = 'Close file';
    titlebar.append(icon, name_el, close_btn);
    const body = create_el('div', 'tf-body');
    body.textContent = 'Loading…';
    const resize = {};
    const resize_e = create_el('div', 'tg-handle tg-handle-e');
    const resize_s = create_el('div', 'tg-handle tg-handle-s');
    const resize_se = create_el('div', 'tg-handle tg-handle-se');
    element.append(titlebar, body, resize_e, resize_s, resize_se);
    resize.e = resize_e;
    resize.s = resize_s;
    resize.se = resize_se;

    pane_serial += 1;
    const pane = {
      pane_id: pane_serial,
      grid,
      view,
      kind: 'file',
      name: spec.name,
      path: spec.path,
      element,
      titlebar,
      resize,
      rect: null,
      dirty_layout: false,
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
      remove_pane(grid, pane);
      notify_grid(grid);
    });
    element.addEventListener('mousedown', () => set_active_pane(grid, pane), true);
    pane.observer = new ResizeObserver(() => schedule_refit(pane));
    pane.observer.observe(body);
    return pane;
  }

  function mount_file_pane(grid, view, pane) {
    view.panes.push(pane);
    view.pane_grid.appendChild(pane.element);
    relayout_view(grid, view);
    load_file_content(pane);
  }

  async function load_file_content(pane) {
    const view = pane.view;
    try {
      const result = await window.hub.files.read(view.workspace.path, pane.path);
      if (pane.disposed) return;
      pane.body.textContent = '';
      const meta = create_el('div', 'tf-meta');
      const size = format_byte_size(result.bytes != null ? result.bytes : 0);
      if (result.kind === 'text') {
        meta.textContent = `${size}${result.bytes >= FILE_READ_LIMIT ? ' (truncated)' : ''}`;
        pane.body.append(meta);
        const text = create_el('div', 'tf-text');
        text.textContent = String(result.text || '');
        pane.body.append(text);
      } else {
        meta.textContent = `${result.ext || 'This file'} — binary (preview skipped, ${size})`;
        pane.body.append(meta);
      }
    } catch (error) {
      if (pane.disposed) return;
      pane.body.textContent = '';
      const text = create_el('div', 'tf-text tf-error', `Could not read file: ${error_text(error)}`);
      pane.body.append(text);
    }
  }

  // Opens the file viewer pane for a workspace-relative path; an existing pane for the same file is focused.
  function open_file_in_grid(grid, workspace, rel_path) {
    const view = grid.views.get(workspace.id);
    if (!view) return;
    const existing = view.panes.find(
      (pane) => pane.kind === 'file' && !pane.disposed && pane.path === rel_path
    );
    if (existing) {
      set_active_pane(grid, existing);
      return;
    }
    const pane = build_file_pane(grid, view, { name: rel_path.split(/[\\/]/).pop() || rel_path, path: rel_path });
    mount_file_pane(grid, view, pane);
    set_active_pane(grid, pane);
  }

  // Free pane layout (replaces the old CSS grid). Each pane keeps rect = {x, y, w, h} as fractions of
  // the pane area. rect === null means "not placed yet": such panes get a slot from the uniform tiling
  // for the current count (the old behaviour) the next time they are placed.
  function relayout_view(grid, view) {
    for (const pane of view.panes) place_pane(pane, view);
    view.hint.hidden = count_panes(view) > 0;
    if (grid.active_view === view) update_note(grid);
  }

  function count_panes(view) {
    let counted = 0;
    for (const pane of view.panes) {
      if (!pane.disposed) counted += 1;
    }
    return counted;
  }

  function columns_for_count(count) {
    if (count <= 1) return 1;
    if (count <= 4) return 2;
    return 3;
  }

  // Uniform tiling for `count` panes: same slots as the old CSS grid (1 column / 2 / 3 by count).
  function rect_for_slot(index, count) {
    const columns = columns_for_count(count);
    const rows = Math.ceil(count / columns);
    return {
      x: (index % columns) / columns,
      y: Math.floor(index / columns) / rows,
      w: 1 / columns,
      h: 1 / rows,
    };
  }

  function place_pane(pane, view) {
    const area = view.pane_grid;
    const width = Math.max(area.clientWidth, 1);
    const height = Math.max(area.clientHeight, 1);
    if (!pane.rect) {
      const index = view.panes.indexOf(pane);
      pane.rect = rect_for_slot(index, view.panes.length);
      // Keep the minimum size even in tiny windows.
      pane.rect.w = Math.max(pane.rect.w, Math.min(1, MIN_PANE_PX / width));
      pane.rect.h = Math.max(pane.rect.h, Math.min(1, MIN_PANE_PX / height));
    }
    const element = pane.element;
    element.style.left = `${pane.rect.x * 100}%`;
    element.style.top = `${pane.rect.y * 100}%`;
    element.style.width = `${pane.rect.w * 100}%`;
    element.style.height = `${pane.rect.h * 100}%`;
    element.style.zIndex = String(pane.pane_id % 100000);
  }

  // Clamp helpers: a pane stays inside the pane area and never smaller than MIN_PANE_PX.
  function clamp_rect(rect, area_width, area_height) {
    const min_w = Math.min(1, MIN_PANE_PX / Math.max(area_width, 1));
    const min_h = Math.min(1, MIN_PANE_PX / Math.max(area_height, 1));
    const w = Math.min(Math.max(rect.w, min_w), 1);
    const h = Math.min(Math.max(rect.h, min_h), 1);
    const max_x = Math.max(0, 1 - w);
    const max_y = Math.max(0, 1 - h);
    const x = Math.min(Math.max(rect.x, 0), max_x);
    const y = Math.min(Math.max(rect.y, 0), max_y);
    return { x, y, w, h };
  }

  function clamp_drag_rect(rect, area_width, area_height) {
    // While dragging, the pane head must stay grabbable: keep part of it inside the area.
    const keep_w = Math.min(rect.w, Math.min(1, DRAG_VISIBLE_PX / Math.max(area_width, 1)));
    const keep_h = Math.min(rect.h, Math.min(1, DRAG_VISIBLE_PX / Math.max(area_height, 1)));
    const min_x = -(rect.w - keep_w);
    const min_y = -(rect.h - keep_h);
    const x = Math.min(Math.max(rect.x, min_x), 1 - keep_w);
    const y = Math.min(Math.max(rect.y, min_y), 1 - keep_h);
    return { x, y, w: rect.w, h: rect.h };
  }

  //Moving a pane: pointer down on the titlebar (not on a button), then follow the pointer.
  function attach_pane_drag(pane) {
    const handle = pane.titlebar;
    let started = false;
    let start = null;
    let area_rect = null;

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (event.target && event.target.closest && event.target.closest('button')) return;
      started = true;
      const area = pane.view.pane_grid.getBoundingClientRect();
      area_rect = area;
      start = { px: event.clientX, py: event.clientY, rect: Object.assign({}, pane.rect) };
      pane.element.classList.add('tg-dragging');
      event.preventDefault();
    });

    window.addEventListener(
      'pointermove',
      (event) => {
        if (!started) return;
        const width = Math.max(area_rect.width, MIN_PANE_WIDTH);
        const height = Math.max(area_rect.height, MIN_PANE_HEIGHT);
        const dx = (event.clientX - start.px) / width;
        const dy = (event.clientY - start.py) / height;
        pane.rect = clamp_drag_rect(
          { x: start.rect.x + dx, y: start.rect.y + dy, w: start.rect.w, h: start.rect.h },
          width,
          height
        );
        pane.dirty_layout = true;
        place_pane(pane, pane.view);
      },
      { passive: true }
    );

    window.addEventListener('pointerup', () => {
      if (!started) return;
      started = false;
      pane.element.classList.remove('tg-dragging');
    });
  }

  //Resizing: thin handles on the right edge (e), bottom edge (s) and bottom-right corner (se).
  function attach_pane_resize(pane, mode) {
    const handle = pane.resize[mode];
    let started = false;
    let start = null;
    let area_rect = null;

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      started = true;
      area_rect = pane.view.pane_grid.getBoundingClientRect();
      start = { px: event.clientX, py: event.clientY, rect: Object.assign({}, pane.rect) };
      pane.element.classList.add('tg-resizing');
    });

    window.addEventListener(
      'pointermove',
      (event) => {
        if (!started) return;
        const width = Math.max(area_rect.width, MIN_PANE_WIDTH);
        const height = Math.max(area_rect.height, MIN_PANE_HEIGHT);
        const next = Object.assign({}, start.rect);
        if (mode === 'e' || mode === 'se') {
          next.w = start.rect.w + (event.clientX - start.px) / width;
        }
        if (mode === 's' || mode === 'se') {
          next.h = start.rect.h + (event.clientY - start.py) / height;
        }
        pane.rect = clamp_rect(next, width, height);
        pane.dirty_layout = true;
        place_pane(pane, pane.view);
      },
      { passive: true }
    );

    window.addEventListener('pointerup', () => {
      if (!started) return;
      started = false;
      pane.element.classList.remove('tg-resizing');
    });
  }

  function refit_pane(pane) {
    if (pane.disposed) return;
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
      if (!pane.disposed) pane.term.refresh(0, Math.max(0, pane.term.rows - 1));
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
    pane.worktree = result.worktree || null;
    pane.element.setAttribute('data-worktree', pane.worktree ? pane.worktree.path : '');
    return result.terminal_id;
  }

  function set_active_pane(grid, pane) {
    const previous = grid.active_pane;
    if (previous && previous !== pane) previous.element.classList.remove('tg-active');
    grid.active_pane = pane;
    pane.element.classList.add('tg-active');
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
    if (pane.observer) pane.observer.disconnect();
    if (pane.term) pane.term.dispose();
    pane.element.remove();
    if (grid.active_pane === pane) grid.active_pane = null;
    relayout_view(grid, view);
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
    // seat.env (from the launch page: model and third-party API) becomes env_extra for the pty.
    const env_extra =
      seat.env && typeof seat.env === 'object'
        ? Object.fromEntries(
            Object.entries(seat.env)
              .filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(key)) && typeof value === 'string')
              .map(([key, value]) => [String(key), value])
          )
        : {};
    return {
      name: next_free_name(view),
      agent_id,
      agent_label,
      command: String((((window.find_agent && window.find_agent(agent_id)) || {}).launch_command) || seat.command || '').trim(),
      cwd: view.workspace.path,
      env_extra,
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

    const want_worktree = Boolean(options && options.use_worktree === true);
    clear_banner(grid);
    const failures = [];
    let first_pane = null;
    for (const seat of seats) {
      if (view.disposed) break;
      const spec = seat_spec(view, seat || {});
      const pane = build_pane(grid, view, spec);
      mount_pane(grid, view, pane);
      if (!first_pane) {
        first_pane = pane;
        set_active_pane(grid, pane);
      }
      try {
        const terminal_id = await launch_terminal(pane, {
          use_worktree: want_worktree && spec.agent_id !== AGENT_INSTALL_ID,
          env_extra: spec.env_extra,
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
    if (grid.active_view === view && first_pane && !first_pane.disposed) first_pane.term.focus();
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

    clear_banner(grid);
    let restored = 0;
    const failures = [];
    for (const record of records) {
      if (view.disposed) break;
      const pane = build_pane(grid, view, restore_spec(record));
      mount_pane(grid, view, pane);
      try {
        const terminal_id = await launch_terminal(pane, {
          restore_record_id: record.record_id,
          resume_session_id: record.claude_session_id || null,
          title: record.title,
          use_worktree: false,
        });
        if (pane.disposed) {
          note_kept_worktree(grid, await kill_quietly(terminal_id));
          continue;
        }
        bind_terminal(pane, terminal_id, 'running', null);
        if (restored === 0) set_active_pane(grid, pane);
        restored += 1;
      } catch (error) {
        failures.push(`${pane.name}: ${error_text(error)}`);
        if (!pane.disposed) remove_pane(grid, pane);
        try {
          await window.hub.sessions.discard(record.record_id);
        } catch (discard_error) {
          console.error('sessions.discard failed:', error_text(discard_error));
        }
      }
      notify_grid(grid);
    }

    if (failures.length) {
      show_banner(grid, `Could not restore ${failures.join(' | ')} (that saved session was discarded)`);
    }
    return restored;
  }

  async function restart_pane(grid, pane) {
    if (pane.disposed || pane.status !== 'exited') return;
    const old_terminal_id = pane.terminal_id;
    // A pane with a worktree gets a fresh one: closing the exited session removes its worktree when it is clean,
    // so the old folder cannot be reused.
    const had_worktree = Boolean(pane.worktree);
    // 'starting' first, so a second click on Restart does nothing while the old session is removed.
    set_pane_status(pane, 'starting', null);
    pane.term.write('\r\n\x1b[2m[restarting]\x1b[0m\r\n');
    if (old_terminal_id) {
      if (PANE_BY_TERMINAL.get(old_terminal_id) === pane) PANE_BY_TERMINAL.delete(old_terminal_id);
      // Removes the exited session from the main process before the new one starts.
      note_kept_worktree(grid, await kill_quietly(old_terminal_id));
    }

    try {
      const terminal_id = await launch_terminal(pane, {
        cwd: had_worktree ? pane.base_cwd : pane.cwd,
        use_worktree: had_worktree,
      });
      if (pane.disposed) {
        note_kept_worktree(grid, await kill_quietly(terminal_id));
        return;
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
    set_active_pane(grid, pane);
    pane.term.focus();
    pane.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
      focus_session: (terminal_id) => focus_session_in_grid(grid, terminal_id),
      close_session: (terminal_id) => close_session_in_grid(grid, terminal_id),
    };
  }

  window.init_terminal_grid = init_terminal_grid;
})();
