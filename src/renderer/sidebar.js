// Workspace sidebar: a tree of workspaces, each with its live sessions (terminal panes) underneath.
// Contract: window.init_sidebar({ container, on_select, on_remove, on_new_session, on_select_session, on_close_session })
//   -> { refresh(), set_counts(counts), set_sessions(sessions_by_workspace), get_selected(), add_folder_path(folder_path),
//        apply_status(terminal_id, info), get_statuses(), status_subscription_count() }
//   on_select(workspace)                          the selected workspace changed (workspace may be null)
//   on_remove(workspace_id)                       a workspace was removed
//   on_new_session(workspace)                     the row's + button; the workspace is selected and expanded first
//   on_select_session(workspace, terminal_id)     a session row was clicked; its workspace is selected first
//   on_close_session(workspace_id, terminal_id)   the session row's x (and the dashboard's Close idle)
// Agent status (v3): hub.terminals.on_status is subscribed once, hub.terminals.get_status seeds the map on every
// refresh, and a 15 s timer refreshes the dashboard's "Waiting 2m" labels. A session row's dot shows the status
// (working, waiting, done, idle, ended) when there is one, else the running / exited dot. The header's dashboard
// button opens the overlay from dashboard.js; its rows come from build_dashboard_rows() below.
// Wrapped in an IIFE because classic scripts share one global scope with the other renderer scripts.
(function sidebar_module() {
  const SELECTED_KEY = 'agent_hub.selected_workspace';
  const EXPANDED_KEY = 'agent_hub.expanded_workspaces';
  const EMPTY_HINT = 'No workspaces yet — click + to add a project folder';
  const STATUS_RUNNING = 'running';
  const STATUS_EXITED = 'exited';
  const HUB_STATES = ['working', 'waiting', 'done', 'idle', 'ended'];
  const STATUS_TICK_MS = 15000;
  const DASHBOARD_ICON =
    '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">' +
    '<rect x="1" y="1" width="4" height="4" rx="0.8" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
    '<rect x="7" y="1" width="4" height="4" rx="0.8" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
    '<rect x="1" y="7" width="4" height="4" rx="0.8" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
    '<rect x="7" y="7" width="4" height="4" rx="0.8" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';

  const MOBILE_ICON =
    '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">' +
    '<rect x="3.2" y="0.8" width="5.6" height="10.4" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
    '<path d="M5 9.4 h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"/></svg>';

  function read_saved_id() {
    try {
      return window.localStorage.getItem(SELECTED_KEY);
    } catch (error) {
      return null;
    }
  }

  function save_selected_id(workspace_id) {
    try {
      if (workspace_id === null) {
        window.localStorage.removeItem(SELECTED_KEY);
      } else {
        window.localStorage.setItem(SELECTED_KEY, workspace_id);
      }
    } catch (error) {
      // Storage can be unavailable; the selection then simply is not remembered.
    }
  }

  // Map of workspace_id -> boolean (true = expanded). A workspace missing from the map is expanded.
  function read_expanded_map() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(EXPANDED_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function save_expanded_map(expanded_map) {
    try {
      window.localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded_map));
    } catch (error) {
      // Storage can be unavailable; the collapsed state then simply is not remembered.
    }
  }

  // Case-insensitive on Windows, with trailing separators ignored, to match store.js.
  function path_key(folder_path) {
    return String(folder_path).replace(/[\\/]+$/, '').toLowerCase();
  }

  function create_element(tag, class_name, text) {
    const element = document.createElement(tag);
    if (class_name) element.className = class_name;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function as_callback(value) {
    return typeof value === 'function' ? value : () => {};
  }

  // Claude hook status wins. Otherwise a running pane is working while bytes arrive, then idle.
  function session_state(session, hub_info) {
    if (hub_info && HUB_STATES.includes(hub_info.status)) return hub_info.status;
    if (session.status === STATUS_RUNNING && session.activity === 'output') return 'working';
    if (session.status === STATUS_RUNNING && session.activity === 'quiet') return 'idle';
    return session.status === STATUS_RUNNING ? STATUS_RUNNING : STATUS_EXITED;
  }

  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // The agent's logo as a 14px image. Unknown agents and agents without a logo get no image at all.
  function build_logo(agent_id) {
    const agent = typeof window.find_agent === 'function' ? window.find_agent(agent_id) : null;
    if (!agent || typeof agent.logo !== 'string' || agent.logo === '') return null;
    const image = document.createElement('img');
    image.className = 'session_logo';
    image.alt = '';
    image.draggable = false;
    image.src = agent.logo;
    // A logo file that is missing simply disappears instead of showing a broken image.
    image.addEventListener('error', () => image.remove());
    return image;
  }

  function init_sidebar(options) {
    const opts = options || {};
    const container = opts.container;
    const on_select = as_callback(opts.on_select);
    const on_remove = as_callback(opts.on_remove);
    const on_new_session = as_callback(opts.on_new_session);
    const on_select_session = as_callback(opts.on_select_session);
    const on_close_session = as_callback(opts.on_close_session);
    const on_mode_change = as_callback(opts.on_mode_change);

    let workspaces = [];
    let counts = {};
    let sessions_by_workspace = {};
    let expanded_map = read_expanded_map();
    let selected_id = null;
    let selected_terminal_id = null;
    let loaded = false;
    // terminal_id -> { status, session_id, detail, updated_at }. Unknown terminal ids are kept and simply not shown.
    const status_by_terminal = new Map();
    let status_subscribed = false;
    let status_subscription_total = 0;
    let dashboard = null;
    let mobile_panel = null;

    // Skeleton: header with the dashboard, mobile and + buttons, the tree, and the empty-state hint.
    const root = create_element('div', 'sidebar_root');
    root.id = 'sidebar_root';
    const header = create_element('div', 'sidebar_header');
    const title = create_element('span', 'sidebar_title', 'Workspaces');
    const header_actions = create_element('div', 'sidebar_header_actions');
    const dashboard_button = create_element('button', 'dashboard_button');
    dashboard_button.type = 'button';
    dashboard_button.title = 'Dashboard';
    dashboard_button.setAttribute('aria-label', 'Dashboard');
    dashboard_button.setAttribute('aria-haspopup', 'dialog');
    dashboard_button.setAttribute('aria-expanded', 'false');
    dashboard_button.innerHTML = DASHBOARD_ICON;
    const mobile_button = create_element('button', 'dashboard_button');
    mobile_button.type = 'button';
    mobile_button.title = 'Mobile access';
    mobile_button.setAttribute('aria-label', 'Mobile access');
    mobile_button.setAttribute('aria-haspopup', 'dialog');
    mobile_button.setAttribute('aria-expanded', 'false');
    mobile_button.innerHTML = MOBILE_ICON;
    const add_button = create_element('button', 'add_button', '+');
    add_button.type = 'button';
    add_button.title = 'Add a workspace folder';
    add_button.setAttribute('aria-label', 'Add a workspace folder');
    header_actions.append(dashboard_button, mobile_button, add_button);
    header.append(title, header_actions);
    const list = create_element('ul', 'workspace_list');
    list.setAttribute('role', 'tree');
    list.setAttribute('aria-label', 'Workspaces');
    const hint = create_element('p', 'sidebar_empty', EMPTY_HINT);
    hint.hidden = true;
    const mode_switcher = create_element('div', 'sidebar_mode_switcher');
    const grid_mode_btn = create_element('button', 'sidebar_mode_btn active', '🧩 Grid');
    grid_mode_btn.type = 'button';
    grid_mode_btn.dataset.mode = 'grid';
    grid_mode_btn.title = 'Terminal Grid mode';
    const squad_mode_btn = create_element('button', 'sidebar_mode_btn', '💬 Squad');
    squad_mode_btn.type = 'button';
    squad_mode_btn.dataset.mode = 'squad';
    squad_mode_btn.title = 'OpenMausBot-style AI Bot Squad Chat & Sandbox VMs';
    mode_switcher.append(grid_mode_btn, squad_mode_btn);
    function set_mode(mode) {
      const is_squad = mode === 'squad';
      grid_mode_btn.classList.toggle('active', !is_squad);
      squad_mode_btn.classList.toggle('active', is_squad);
    }
    grid_mode_btn.addEventListener('click', () => {
      set_mode('grid');
      on_mode_change('grid');
    });
    squad_mode_btn.addEventListener('click', () => {
      set_mode('squad');
      on_mode_change('squad');
    });
    const appearance_button = create_element('button', 'sidebar_appearance', 'Appearance');
    appearance_button.type = 'button';
    appearance_button.title = 'Dark, light, or Windows color, and the accent color';
    appearance_button.setAttribute('aria-label', 'Appearance');
    appearance_button.addEventListener('click', () => {
      if (typeof window.open_settings === 'function') window.open_settings();
    });
    root.append(header, mode_switcher, list, hint, appearance_button);
    container.replaceChildren(root);
    container.dataset.loaded = 'false';

    function find_workspace(workspace_id) {
      if (workspace_id === null || workspace_id === undefined) return null;
      return workspaces.find((workspace) => workspace.id === workspace_id) || null;
    }

    function get_selected() {
      return find_workspace(selected_id);
    }

    function is_expanded(workspace_id) {
      return expanded_map[workspace_id] !== false;
    }

    function sessions_of(workspace_id) {
      const list_for_workspace = sessions_by_workspace[workspace_id];
      if (!Array.isArray(list_for_workspace)) return [];
      return list_for_workspace.filter((session) => session && session.terminal_id !== undefined && session.terminal_id !== null);
    }

    function session_exists(terminal_id) {
      return Object.values(sessions_by_workspace).some(
        (list_for_workspace) =>
          Array.isArray(list_for_workspace) && list_for_workspace.some((session) => session && session.terminal_id === terminal_id)
      );
    }

    // Re-focuses the element that had focus before a redraw, so keyboard users keep their place.
    function restore_focus(focus_key) {
      if (!focus_key) return;
      const target = Array.from(list.querySelectorAll('[data-focus_key]')).find((element) => element.dataset.focus_key === focus_key);
      if (target) target.focus();
    }

    function render() {
      const focused = document.activeElement;
      const focus_key = focused && root.contains(focused) && focused.dataset ? focused.dataset.focus_key : undefined;
      list.replaceChildren(...workspaces.map(build_row));
      hint.hidden = !loaded || workspaces.length > 0;
      container.dataset.loaded = String(loaded);
      restore_focus(focus_key);
      if (dashboard) dashboard.refresh();
    }

    // Sets the workspace selection (and the selected session, if any), redraws, and notifies the owner once.
    function apply_selection(workspace_id, terminal_id = null) {
      const workspace = find_workspace(workspace_id);
      selected_id = workspace ? workspace.id : null;
      selected_terminal_id = terminal_id;
      save_selected_id(selected_id);
      render();
      on_select(workspace);
    }

    function set_expanded(workspace_id, expanded) {
      expanded_map[workspace_id] = expanded;
      save_expanded_map(expanded_map);
      render();
    }

    function choose_session(workspace, terminal_id) {
      if (workspace.id !== selected_id) {
        apply_selection(workspace.id, terminal_id);
      } else {
        selected_terminal_id = terminal_id;
        render();
      }
      on_select_session(find_workspace(workspace.id) || workspace, terminal_id);
    }

    function start_new_session(workspace) {
      // The new session is shown under its workspace, so expand it and select it first.
      if (!is_expanded(workspace.id)) {
        expanded_map[workspace.id] = true;
        save_expanded_map(expanded_map);
      }
      if (workspace.id !== selected_id) {
        apply_selection(workspace.id);
      } else {
        render();
      }
      on_new_session(find_workspace(workspace.id) || workspace);
    }

    // ---- Agent status ----

    // Keeps the newest status per terminal. A seed (get_status) that raced a newer event cannot overwrite it.
    // Returns true when the map changed. Malformed input is ignored, never thrown.
    function store_status(terminal_id, info) {
      if (typeof terminal_id !== 'string' || terminal_id === '') return false;
      if (!info || typeof info !== 'object' || !HUB_STATES.includes(info.status)) return false;
      const updated_at = typeof info.updated_at === 'number' && Number.isFinite(info.updated_at) ? info.updated_at : 0;
      const previous = status_by_terminal.get(terminal_id);
      if (previous && previous.updated_at > updated_at) return false;
      status_by_terminal.set(terminal_id, {
        status: info.status,
        session_id: typeof info.session_id === 'string' ? info.session_id : null,
        detail: typeof info.detail === 'string' ? info.detail : null,
        updated_at,
      });
      return true;
    }

    // The single entry for every status update: the on_status callback and the test hook both come here.
    // Returns true when the event was accepted (an unknown terminal id is accepted too, and shown only if it has a row).
    function apply_status(terminal_id, info) {
      const changed = store_status(terminal_id, info);
      if (changed) render();
      return changed;
    }

    function subscribe_status() {
      if (status_subscribed) return;
      const hub_terminals = window.hub && window.hub.terminals;
      if (!hub_terminals || typeof hub_terminals.on_status !== 'function') return;
      try {
        hub_terminals.on_status((terminal_id, info) => apply_status(terminal_id, info));
        status_subscribed = true;
        status_subscription_total += 1;
      } catch (error) {
        console.error('terminals.on_status failed:', error);
      }
    }

    async function seed_status() {
      const hub_terminals = window.hub && window.hub.terminals;
      if (!hub_terminals || typeof hub_terminals.get_status !== 'function') return;
      let snapshot = null;
      try {
        snapshot = await hub_terminals.get_status();
      } catch (error) {
        console.error('terminals.get_status failed:', error);
        return;
      }
      if (!snapshot || typeof snapshot !== 'object') return;
      let changed = false;
      for (const terminal_id of Object.keys(snapshot)) {
        if (store_status(terminal_id, snapshot[terminal_id])) changed = true;
      }
      if (changed) render();
    }

    // Rows for the dashboard: every session of every known workspace, with its dot state and last update.
    function build_dashboard_rows() {
      const rows = [];
      for (const workspace of workspaces) {
        for (const session of sessions_of(workspace.id)) {
          const hub_info = status_by_terminal.get(session.terminal_id) || null;
          rows.push({
            workspace_id: workspace.id,
            workspace_name: workspace.name,
            terminal_id: session.terminal_id,
            title: session.title || 'Session',
            agent_id: session.agent_id || '',
            agent_label: session.agent_label || '',
            state: session_state(session, hub_info),
            updated_at: hub_info ? hub_info.updated_at : null,
          });
        }
      }
      return rows;
    }

    function build_session_row(workspace, session) {
      const is_selected = workspace.id === selected_id && session.terminal_id === selected_terminal_id;
      const status = session.status === STATUS_RUNNING ? STATUS_RUNNING : STATUS_EXITED;
      const hub_info = status_by_terminal.get(session.terminal_id) || null;
      const state = session_state(session, hub_info);
      const session_title = session.title || 'Session';
      const agent_label = session.agent_label || '';

      const item = create_element('li', 'session_item');
      item.setAttribute('role', 'none');
      const row = create_element('div', 'session_row' + (is_selected ? ' selected' : ''));
      row.dataset.terminal_id = session.terminal_id;
      row.dataset.status = status;
      row.dataset.state = state;
      row.dataset.hub_status = hub_info ? hub_info.status : '';
      row.dataset.focus_key = `session:${session.terminal_id}`;
      row.tabIndex = 0;
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-selected', String(is_selected));
      row.title = [session_title, agent_label, capitalize(state)].filter((part) => part !== '').join(' · ');

      const dot = create_element('span', `session_dot ${state}`);
      dot.setAttribute('aria-hidden', 'true');
      const logo = build_logo(session.agent_id);
      const name = create_element('span', 'session_name', session_title);
      const agent = create_element('span', 'session_agent', agent_label);
      // The row's actions float over the right edge (hover or focus only), so they take no room from the name.
      const actions = create_element('span', 'session_actions');
      const close_button = create_element('button', 'session_close', 'x');
      close_button.type = 'button';
      close_button.dataset.focus_key = `close:${session.terminal_id}`;
      close_button.title = 'Close session';
      close_button.setAttribute('aria-label', `Close session ${session_title}`);
      actions.append(close_button);

      row.append(dot);
      if (logo) row.append(logo);
      row.append(name, agent, actions);

      row.addEventListener('click', () => choose_session(workspace, session.terminal_id));
      row.addEventListener('keydown', (event) => {
        if (event.target !== row) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          choose_session(workspace, session.terminal_id);
        }
      });
      close_button.addEventListener('click', (event) => {
        event.stopPropagation();
        on_close_session(workspace.id, session.terminal_id);
      });

      item.append(row);
      return item;
    }

    function build_row(workspace) {
      const is_selected = workspace.id === selected_id;
      const expanded = is_expanded(workspace.id);

      const item = create_element('li', 'workspace_item');
      item.setAttribute('role', 'none');
      const row = create_element('div', 'workspace_row' + (is_selected ? ' selected' : ''));
      row.dataset.workspace_id = workspace.id;
      row.dataset.focus_key = `workspace:${workspace.id}`;
      row.title = workspace.path;
      row.tabIndex = 0;
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-selected', String(is_selected));
      row.setAttribute('aria-expanded', String(expanded));

      const chevron_button = create_element('button', 'chevron_button');
      chevron_button.type = 'button';
      chevron_button.dataset.focus_key = `chevron:${workspace.id}`;
      const chevron_label = `${expanded ? 'Collapse' : 'Expand'} ${workspace.name}`;
      chevron_button.title = chevron_label;
      chevron_button.setAttribute('aria-label', chevron_label);
      chevron_button.append(create_element('span', expanded ? 'chevron expanded' : 'chevron'));

      const name = create_element('span', 'workspace_name', workspace.name);
      const count = counts[workspace.id] || 0;
      const badge = create_element('span', 'count_badge', String(count));
      badge.hidden = count === 0;
      badge.title = `${count} live terminal${count === 1 ? '' : 's'}`;

      const new_button = create_element('button', 'new_session_button', '+');
      new_button.type = 'button';
      new_button.dataset.focus_key = `new:${workspace.id}`;
      new_button.title = 'New session in this workspace';
      new_button.setAttribute('aria-label', `New session in ${workspace.name}`);

      const remove_button = create_element('button', 'remove_button', 'x');
      remove_button.type = 'button';
      remove_button.dataset.focus_key = `remove:${workspace.id}`;
      remove_button.title = 'Remove workspace';
      remove_button.setAttribute('aria-label', `Remove workspace ${workspace.name}`);

      const actions = create_element('span', 'row_actions');
      actions.append(new_button, remove_button);

      row.append(chevron_button, name, badge, actions);

      row.addEventListener('click', () => {
        if (workspace.id !== selected_id) apply_selection(workspace.id);
      });
      row.addEventListener('keydown', (event) => {
        // Only the row itself: Enter on a focused button inside the row must press that button.
        if (event.target !== row) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (workspace.id !== selected_id) apply_selection(workspace.id);
        }
      });
      chevron_button.addEventListener('click', (event) => {
        event.stopPropagation();
        set_expanded(workspace.id, !expanded);
      });
      new_button.addEventListener('click', (event) => {
        event.stopPropagation();
        start_new_session(workspace);
      });
      remove_button.addEventListener('click', (event) => {
        event.stopPropagation();
        remove_workspace(workspace.id);
      });

      item.append(row);
      if (expanded) {
        const sessions = sessions_of(workspace.id);
        if (sessions.length > 0) {
          const session_list = create_element('ul', 'session_list');
          session_list.setAttribute('role', 'group');
          session_list.append(...sessions.map((session) => build_session_row(workspace, session)));
          item.append(session_list);
        }
      }
      return item;
    }

    async function reload_workspaces() {
      workspaces = await window.hub.workspaces.list();
    }

    async function refresh() {
      await reload_workspaces();
      await seed_status();
      if (!loaded) {
        loaded = true;
        const saved_id = read_saved_id();
        const first = workspaces[0] || null;
        apply_selection(find_workspace(saved_id) ? saved_id : (first ? first.id : null));
        return;
      }
      if (!find_workspace(selected_id)) {
        // The selected workspace is gone (or nothing was selected yet): fall back to the first one.
        const first = workspaces[0] || null;
        if (first || selected_id !== null) {
          apply_selection(first ? first.id : null);
          return;
        }
      }
      render();
    }

    function set_counts(next_counts) {
      counts = Object.assign({}, next_counts || {});
      render();
    }

    // Full map {[workspace_id]: [session, ...]}; replaces what was shown before.
    function set_sessions(next_sessions_by_workspace) {
      sessions_by_workspace = Object.assign({}, next_sessions_by_workspace || {});
      if (selected_terminal_id !== null && !session_exists(selected_terminal_id)) {
        selected_terminal_id = null;
      }
      render();
    }

    async function add_folder_path(folder_path) {
      await reload_workspaces();
      const key = path_key(folder_path);
      const existing = workspaces.find((workspace) => path_key(workspace.path) === key);
      if (existing) {
        if (existing.id !== selected_id) apply_selection(existing.id);
        return existing;
      }
      let workspace = null;
      try {
        workspace = await window.hub.workspaces.add(folder_path);
      } catch (error) {
        window.alert(`Could not add the workspace: ${error.message}`);
        return null;
      }
      await reload_workspaces();
      apply_selection(workspace.id);
      return workspace;
    }

    async function pick_and_add() {
      const folder_path = await window.hub.workspaces.pick_folder();
      if (!folder_path) return;
      await add_folder_path(folder_path);
    }

    async function remove_workspace(workspace_id) {
      const workspace = find_workspace(workspace_id);
      if (!workspace) return;
      const live_count = counts[workspace_id] || 0;
      if (live_count > 0) {
        const approved = window.confirm(`Remove workspace "${workspace.name}" and close its terminals?`);
        if (!approved) return;
      }
      const index = workspaces.indexOf(workspace);
      const was_selected = workspace_id === selected_id;
      try {
        await window.hub.workspaces.remove(workspace_id);
      } catch (error) {
        window.alert(`Could not remove the workspace: ${error.message}`);
        return;
      }
      on_remove(workspace_id);
      delete counts[workspace_id];
      delete sessions_by_workspace[workspace_id];
      delete expanded_map[workspace_id];
      save_expanded_map(expanded_map);
      await reload_workspaces();
      if (!was_selected) {
        render();
        return;
      }
      // Neighbour rule: the row that now sits where the removed one was, else the one before it.
      const neighbour = workspaces[index] || workspaces[index - 1] || null;
      apply_selection(neighbour ? neighbour.id : null);
    }

    // The dashboard lives in its own module; a missing one only disables its button.
    if (typeof window.init_dashboard === 'function') {
      dashboard = window.init_dashboard({
        get_rows: build_dashboard_rows,
        on_focus_session: (workspace_id, terminal_id) => {
          const workspace = find_workspace(workspace_id);
          if (workspace) choose_session(workspace, terminal_id);
        },
        on_close_session: (workspace_id, terminal_id) => on_close_session(workspace_id, terminal_id),
        on_toggle: (is_open) => dashboard_button.setAttribute('aria-expanded', String(is_open)),
      });
    } else {
      dashboard_button.disabled = true;
    }

    dashboard_button.addEventListener('click', () => {
      if (dashboard) dashboard.toggle();
    });
    // The mobile access panel lives in its own module; a missing one only disables its button.
    if (typeof window.init_mobile_panel === 'function') {
      mobile_panel = window.init_mobile_panel({
        on_toggle: (is_open) => mobile_button.setAttribute('aria-expanded', String(is_open)),
      });
    } else {
      mobile_button.disabled = true;
    }
    mobile_button.addEventListener('click', () => {
      if (mobile_panel) mobile_panel.toggle();
    });
    add_button.addEventListener('click', () => {
      pick_and_add().catch((error) => window.alert(`Could not add the workspace: ${error.message}`));
    });

    subscribe_status();
    // Labels such as "Waiting 2m" age while the dashboard is open; the sidebar dots do not change with time.
    window.setInterval(() => {
      if (dashboard && dashboard.is_open()) dashboard.refresh();
    }, STATUS_TICK_MS);

    return {
      refresh,
      set_counts,
      set_sessions,
      get_selected,
      select: (workspace_id) => {
        if (workspace_id !== selected_id) apply_selection(workspace_id);
      },
      add_folder_path,
      apply_status,
      get_statuses: () => Object.fromEntries(status_by_terminal),
      status_subscription_count: () => status_subscription_total,
      build_dashboard_rows,
      set_mode,
    };
  }

  window.init_sidebar = init_sidebar;
})();
