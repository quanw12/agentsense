// Dashboard overlay: every session of every workspace with its agent status, counts at the top, a two-step
// "Close idle" button, and Esc / X to close. Covers the main area (right of the sidebar). Classic script.
// Contract: window.init_dashboard({ get_rows, on_focus_session, on_close_session, on_toggle })
//   -> { open(), close(options), is_open(), toggle(), refresh() }; the same object is window.__dashboard (test hook).
//   get_rows() -> [{ workspace_id, workspace_name, terminal_id, title, agent_id, agent_label, state, updated_at }]
//     state: working | waiting | done | idle | ended | running | exited; updated_at: ms since epoch, or null.
//   on_focus_session(workspace_id, terminal_id)   a row was clicked; the dashboard has already closed.
//   on_close_session(workspace_id, terminal_id)   "Close idle" was confirmed: called once per idle, ended or exited row.
//   on_toggle(is_open)                            the overlay opened or closed (the sidebar button uses it).
// Wrapped in an IIFE because classic scripts share one global scope with the other renderer scripts.
(function dashboard_module() {
  const OVERLAY_ID = 'dashboard_overlay';
  const CONFIRM_TIMEOUT_MS = 4000;
  const CLOSABLE_STATES = ['idle', 'ended', 'exited'];
  const COUNTED_STATES = ['working', 'waiting', 'done', 'idle'];
  // Order of the rows: what needs the user first.
  const STATE_RANK = { waiting: 0, working: 1, done: 2, idle: 3, running: 4, ended: 5, exited: 6 };
  const STATE_LABEL = {
    working: 'Working',
    waiting: 'Waiting',
    done: 'Done',
    idle: 'Idle',
    running: 'Running',
    ended: 'Ended',
    exited: 'Exited',
  };
  const CLOSE_ICON =
    '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">' +
    '<path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>';

  function create_element(tag, class_name, text) {
    const element = document.createElement(tag);
    if (class_name) element.className = class_name;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  // The agent's logo as a 16px image; unknown agents and agents without a logo get none.
  function build_logo(agent_id) {
    const agent = typeof window.find_agent === 'function' ? window.find_agent(agent_id) : null;
    if (!agent || typeof agent.logo !== 'string' || agent.logo === '') return null;
    const image = document.createElement('img');
    image.className = 'dashboard_logo';
    image.alt = '';
    image.draggable = false;
    image.src = agent.logo;
    image.addEventListener('error', () => image.remove());
    return image;
  }

  // 45s, 2m, 3h. Used for "Waiting 2m" style labels.
  function format_age(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h`;
  }

  function status_line(row, now) {
    const label = STATE_LABEL[row.state] || row.state;
    if (typeof row.updated_at !== 'number') return label;
    return `${label} ${format_age(now - row.updated_at)}`;
  }

  // Unusable rows are dropped; the rest get safe defaults, so one odd entry cannot break the overlay.
  function normalize_rows(raw_rows) {
    if (!Array.isArray(raw_rows)) return [];
    return raw_rows
      .filter((row) => row && typeof row.terminal_id === 'string' && typeof row.workspace_id === 'string')
      .map((row) => ({
        workspace_id: row.workspace_id,
        workspace_name: typeof row.workspace_name === 'string' ? row.workspace_name : '',
        terminal_id: row.terminal_id,
        title: typeof row.title === 'string' && row.title !== '' ? row.title : 'Session',
        agent_id: typeof row.agent_id === 'string' ? row.agent_id : '',
        agent_label: typeof row.agent_label === 'string' ? row.agent_label : '',
        state: typeof row.state === 'string' ? row.state : 'exited',
        updated_at: typeof row.updated_at === 'number' && Number.isFinite(row.updated_at) ? row.updated_at : null,
      }));
  }

  function rank_of(row) {
    return Object.prototype.hasOwnProperty.call(STATE_RANK, row.state) ? STATE_RANK[row.state] : 9;
  }

  function sorted_rows(rows) {
    return rows.slice().sort((a, b) => {
      const by_rank = rank_of(a) - rank_of(b);
      if (by_rank !== 0) return by_rank;
      const by_time = (b.updated_at || 0) - (a.updated_at || 0);
      if (by_time !== 0) return by_time;
      return a.title.localeCompare(b.title);
    });
  }

  function is_closable(row) {
    return CLOSABLE_STATES.includes(row.state);
  }

  function init_dashboard(options) {
    const opts = options || {};
    const get_rows = typeof opts.get_rows === 'function' ? opts.get_rows : () => [];
    const on_focus_session = typeof opts.on_focus_session === 'function' ? opts.on_focus_session : () => {};
    const on_close_session = typeof opts.on_close_session === 'function' ? opts.on_close_session : () => {};
    const on_toggle = typeof opts.on_toggle === 'function' ? opts.on_toggle : () => {};

    const state = {
      open: false,
      root: null,
      confirm_pending: false,
      confirm_timer: null,
      return_focus: null,
    };

    function load_rows() {
      try {
        return sorted_rows(normalize_rows(get_rows()));
      } catch (error) {
        console.error('dashboard rows failed:', error);
        return [];
      }
    }

    function clear_confirm() {
      if (state.confirm_timer !== null) {
        window.clearTimeout(state.confirm_timer);
        state.confirm_timer = null;
      }
      state.confirm_pending = false;
    }

    function on_close_idle_click() {
      const rows = load_rows().filter(is_closable);
      if (rows.length === 0) {
        clear_confirm();
        render();
        return;
      }
      if (!state.confirm_pending) {
        // First click arms the button; it disarms by itself after a few seconds.
        state.confirm_pending = true;
        state.confirm_timer = window.setTimeout(() => {
          state.confirm_timer = null;
          state.confirm_pending = false;
          render();
        }, CONFIRM_TIMEOUT_MS);
        render();
        return;
      }
      clear_confirm();
      for (const row of rows) {
        try {
          on_close_session(row.workspace_id, row.terminal_id);
        } catch (error) {
          console.error('close idle failed:', error);
        }
      }
      render();
    }

    function on_row_activate(row) {
      close({ restore_focus: false });
      try {
        on_focus_session(row.workspace_id, row.terminal_id);
      } catch (error) {
        console.error('focus session failed:', error);
      }
    }

    function build_row(row, now) {
      const element = create_element('div', 'dashboard_row');
      element.setAttribute('role', 'button');
      element.tabIndex = 0;
      element.dataset.terminal_id = row.terminal_id;
      element.dataset.workspace_id = row.workspace_id;
      element.dataset.state = row.state;
      element.dataset.focus_key = `row:${row.terminal_id}`;
      const line = status_line(row, now);
      element.title = `${row.title} · ${row.workspace_name} · ${line}`;

      const logo = build_logo(row.agent_id);
      const name = create_element('span', 'dashboard_name', row.title);
      const workspace = create_element('span', 'dashboard_workspace', row.workspace_name);
      const status = create_element('span', 'dashboard_status');
      const dot = create_element('span', `session_dot dashboard_dot ${row.state}`);
      dot.setAttribute('aria-hidden', 'true');
      status.append(dot, create_element('span', 'dashboard_status_text', line));

      if (logo) element.append(logo);
      element.append(name, workspace, status);

      element.addEventListener('click', () => on_row_activate(row));
      element.addEventListener('keydown', (event) => {
        if (event.target !== element) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          on_row_activate(row);
        }
      });
      return element;
    }

    function build_summary(counts, closable_count) {
      const summary = create_element('div', 'dashboard_summary');
      const chips = create_element('div', 'dashboard_counts');
      for (const count_state of COUNTED_STATES) {
        const chip = create_element('span', 'dashboard_count');
        chip.dataset.state = count_state;
        const dot = create_element('span', `session_dot dashboard_dot ${count_state}`);
        dot.setAttribute('aria-hidden', 'true');
        const value = create_element('strong', 'dashboard_count_value', String(counts[count_state]));
        chip.append(dot, `${STATE_LABEL[count_state]} `, value);
        chips.append(chip);
      }

      const confirming = state.confirm_pending && closable_count > 0;
      const idle_button = create_element('button', 'dashboard_close_idle');
      idle_button.type = 'button';
      idle_button.dataset.focus_key = 'close_idle';
      idle_button.dataset.action = 'close_idle';
      idle_button.disabled = closable_count === 0;
      idle_button.classList.toggle('confirming', confirming);
      if (confirming) {
        idle_button.textContent = `Confirm: close ${closable_count}`;
        idle_button.title = 'Click again to close these sessions';
      } else {
        idle_button.textContent = closable_count > 0 ? `Close idle (${closable_count})` : 'Close idle';
        idle_button.title = 'Closes idle and ended sessions (asks once more)';
      }
      idle_button.addEventListener('click', on_close_idle_click);

      summary.append(chips, idle_button);
      return summary;
    }

    function build_header(total) {
      const header = create_element('header', 'dashboard_header');
      const inner = create_element('div', 'dashboard_header_inner');
      const title_wrap = create_element('div', 'dashboard_title_wrap');
      const title = create_element('h2', 'dashboard_title', 'Dashboard');
      const count = create_element('span', 'dashboard_title_count', `${total} session${total === 1 ? '' : 's'}`);
      title_wrap.append(title, count);

      const close_button = create_element('button', 'dashboard_close');
      close_button.type = 'button';
      close_button.dataset.focus_key = 'close';
      close_button.dataset.action = 'close';
      close_button.title = 'Close (Esc)';
      close_button.setAttribute('aria-label', 'Close dashboard');
      close_button.innerHTML = CLOSE_ICON;
      close_button.addEventListener('click', () => close());

      inner.append(title_wrap, close_button);
      header.append(inner);
      return header;
    }

    function render() {
      const root = state.root;
      if (!root) return;
      const focused = document.activeElement;
      const focus_key = focused && root.contains(focused) && focused.dataset ? focused.dataset.focus_key : undefined;

      const rows = load_rows();
      const now = Date.now();
      const counts = {};
      for (const count_state of COUNTED_STATES) counts[count_state] = 0;
      for (const row of rows) {
        if (Object.prototype.hasOwnProperty.call(counts, row.state)) counts[row.state] += 1;
      }
      const closable_count = rows.filter(is_closable).length;
      if (closable_count === 0) clear_confirm();

      const column = create_element('div', 'dashboard_column');
      column.append(build_summary(counts, closable_count));
      if (rows.length === 0) {
        column.append(
          create_element('p', 'dashboard_empty', 'No sessions yet. Open a workspace and start one with + New session.')
        );
      } else {
        const list = create_element('div', 'dashboard_list');
        list.setAttribute('role', 'list');
        for (const row of rows) list.append(build_row(row, now));
        column.append(list);
      }

      const body = create_element('div', 'dashboard_body');
      body.append(column);
      root.replaceChildren(build_header(rows.length), body);

      if (focus_key) {
        const target = Array.from(root.querySelectorAll('[data-focus_key]')).find(
          (element) => element.dataset.focus_key === focus_key
        );
        if (target && !target.disabled) target.focus();
      }
    }

    function on_key_down(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    }

    function open() {
      if (state.open) {
        render();
        return;
      }
      state.open = true;
      state.return_focus = document.activeElement;
      const root = create_element('div');
      root.id = OVERLAY_ID;
      root.className = 'dashboard_overlay';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-label', 'Dashboard');
      root.tabIndex = -1;
      state.root = root;
      document.body.append(root);
      document.addEventListener('keydown', on_key_down, true);
      render();
      root.focus();
      notify_toggle();
    }

    // options.restore_focus = false keeps the focus where the next action puts it (a row click focuses a pane).
    function close(options) {
      if (!state.open) return;
      const restore = !options || options.restore_focus !== false;
      state.open = false;
      clear_confirm();
      document.removeEventListener('keydown', on_key_down, true);
      if (state.root) state.root.remove();
      state.root = null;
      const previous = state.return_focus;
      state.return_focus = null;
      if (restore && previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus();
      notify_toggle();
    }

    function notify_toggle() {
      try {
        on_toggle(state.open);
      } catch (error) {
        console.error('dashboard on_toggle failed:', error);
      }
    }

    function refresh() {
      if (state.open) render();
    }

    function toggle() {
      if (state.open) close();
      else open();
    }

    const api = {
      open,
      close,
      is_open: () => state.open,
      toggle,
      refresh,
    };
    window.__dashboard = api;
    return api;
  }

  window.init_dashboard = init_dashboard;
})();
