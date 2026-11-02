// AgentSense mobile client. One WebSocket to the desktop (mobile_server.js), xterm.js for the focused
// session, a session list, and a bottom sheet to start a new session. Classic script, no bundler.
//
// Connection: the page is served at /m/<token>/, so the token for /ws/<token> comes from the URL.
// Reconnects with a capped backoff; after every reconnect the list is re-fetched and the open session
// is re-attached, which replays its buffer, so nothing is missed while the phone was offline.
(function mobile_app() {
  'use strict';

  const TOKEN = (function () {
    const match = /^\/m\/([0-9a-f]{32})/.exec(window.location.pathname);
    return match ? match[1] : '';
  })();

  const TERMINAL_OPTIONS = {
    fontFamily: '"Cascadia Mono", Consolas, monospace',
    fontSize: 14,
    scrollback: 2000,
    cursorBlink: true,
    // Matches the desktop theme (terminal_grid.js).
    theme: {
      background: '#000000',
      foreground: '#ececec',
      cursor: '#ececec',
      cursorAccent: '#000000',
      selectionBackground: 'rgba(91, 141, 239, 0.35)',
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

  const QUICK_KEYS = [
    { id: 'mode', label: 'Line' },
    { id: 'esc', label: 'Esc', data: '\x1b' },
    { id: 'tab', label: 'Tab', data: '\t' },
    { id: 'up', label: '↑', data: '\x1b[A' },
    { id: 'down', label: '↓', data: '\x1b[B' },
    { id: 'left', label: '←', data: '\x1b[D' },
    { id: 'right', label: '→', data: '\x1b[C' },
    { id: 'ctrlc', label: '^C', data: '\x03' },
    { id: 'ctrld', label: '^D', data: '\x04' },
    { id: 'enter', label: '⏎', data: '\r' },
  ];

  const STATUS_LABEL = {
    running: 'Running',
    working: 'Working',
    waiting: 'Waiting',
    done: 'Done',
    idle: 'Idle',
    ended: 'Ended',
    exited: 'Exited',
  };

  const state = {
    ws: null,
    connected: false,
    backoff_ms: 1000,
    reconnect_timer: null,
    announced_offline: false,
    workspaces: [],
    terminals: [],
    status: {}, // terminal_id -> { status, detail, updated_at }
    availability: {}, // command -> installed?
    availability_requested: false,
    selected_workspace: null,
    selected_agent: null,
    viewing_terminal_id: null, // session open in the terminal view (null in the list view)
    attached_id: null, // session the server streams to us
    pending_attach: null,
    launch_pending: false,
    term: null,
    fit: null,
    line_mode: false,
    toast_timer: null,
  };

  const by_id = (id) => document.getElementById(id);

  // ---- helpers ----

  function send(message) {
    if (state.ws && state.ws.readyState === 1) {
      try {
        state.ws.send(JSON.stringify(message));
      } catch (error) {
        /* the close handler reconnects */
      }
    }
  }

  function toast(text) {
    const element = by_id('toast');
    element.textContent = String(text || '');
    element.hidden = false;
    if (state.toast_timer) window.clearTimeout(state.toast_timer);
    state.toast_timer = window.setTimeout(() => {
      element.hidden = true;
    }, 2600);
  }

  function decode_title(raw_title, command) {
    const parts = String(raw_title || '').split('|');
    if (parts.length >= 3 && parts[0].trim()) {
      return { name: parts[0].trim(), agent_id: parts[1].trim(), agent_label: parts.slice(2).join('|').trim() };
    }
    return { name: String(raw_title || command || 'Session').trim() || 'Session', agent_id: '', agent_label: String(command || '') };
  }

  function status_of(info) {
    if (!info.alive) return 'exited';
    const hook = state.status[info.terminal_id];
    if (hook && hook.status && STATUS_LABEL[hook.status]) return hook.status;
    return 'running';
  }

  // 45s, 2m, 3h — same format as the desktop sidebar.
  function format_age(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h`;
  }

  function status_text(info) {
    const status = status_of(info);
    let text = STATUS_LABEL[status] || status;
    const hook = state.status[info.terminal_id];
    if (hook && typeof hook.updated_at === 'number' && ['working', 'waiting', 'done', 'idle'].includes(status)) {
      text += ` ${format_age(Date.now() - hook.updated_at)}`;
    }
    return text;
  }

  function build_logo(agent_id) {
    const agent = typeof window.find_agent === 'function' ? window.find_agent(agent_id) : null;
    if (!agent || typeof agent.logo !== 'string' || agent.logo === '') return null;
    const image = document.createElement('img');
    image.className = 'session_logo';
    image.alt = '';
    image.draggable = false;
    image.src = agent.logo;
    image.addEventListener('error', () => {
      image.remove();
      // No logo file: fall back to the glyph so the card keeps its shape.
      const glyph = document.createElement('span');
      glyph.className = 'session_glyph';
      glyph.textContent = agent.glyph || '?';
      image.replaceWith(glyph);
    });
    return image;
  }

  // ---- connection ----

  function connect() {
    if (state.reconnect_timer) {
      window.clearTimeout(state.reconnect_timer);
      state.reconnect_timer = null;
    }
    if (state.ws) {
      try {
        state.ws.close();
      } catch (error) {
        /* replaced below anyway */
      }
    }
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    let ws;
    try {
      ws = new WebSocket(`${protocol}${window.location.host}/ws/${TOKEN}`);
    } catch (error) {
      schedule_reconnect();
      return;
    }
    state.ws = ws;
    ws.onopen = () => {
      state.connected = true;
      state.backoff_ms = 1000;
      state.announced_offline = false;
      set_conn('online');
      send({ type: 'list' });
      if (state.availability_requested === false) {
        state.availability_requested = true;
        send({ type: 'agents_check', commands: catalog_commands() });
      }
      // The open session is re-attached after a roam; the replay covers the gap.
      if (state.viewing_terminal_id) send({ type: 'attach', terminal_id: state.viewing_terminal_id });
    };
    ws.onmessage = (event) => {
      let msg = null;
      try {
        msg = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      route(msg);
    };
    ws.onclose = () => {
      state.connected = false;
      set_conn('offline');
      schedule_reconnect();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch (error) {
        /* the close handler reconnects */
      }
    };
  }

  function schedule_reconnect() {
    if (state.reconnect_timer) return;
    state.reconnect_timer = window.setTimeout(() => {
      state.reconnect_timer = null;
      connect();
    }, state.backoff_ms);
    state.backoff_ms = Math.min(state.backoff_ms * 2, 15000);
  }

  function set_conn(mode) {
    const dot = by_id('conn_dot');
    dot.className = `conn_dot ${mode}`;
    dot.title = mode === 'online' ? 'Connected' : 'Reconnecting…';
    if (mode === 'offline' && !state.announced_offline) {
      state.announced_offline = true;
      if (state.viewing_terminal_id && state.term) state.term.write('\r\n\x1b[2m[connection lost, reconnecting…]\x1b[0m\r\n');
    }
  }

  function catalog_commands() {
    const catalog = Array.isArray(window.AGENT_CATALOG) ? window.AGENT_CATALOG : [];
    return catalog.map((agent) => agent.command).filter((command) => typeof command === 'string');
  }

  // ---- server messages ----

  function route(msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'snapshot':
        apply_snapshot(msg);
        break;
      case 'attached':
        on_attached(msg);
        break;
      case 'data':
        if (msg.terminal_id === state.attached_id && state.term) state.term.write(String(msg.data));
        break;
      case 'exit':
        on_exit(msg.terminal_id, msg.exit_code);
        break;
      case 'status':
        state.status[msg.terminal_id] = msg.info || null;
        if (!state.terminals.some((info) => info.terminal_id === msg.terminal_id)) {
          send({ type: 'list' }); // a session appeared on the desktop
        }
        refresh_status_ui();
        break;
      case 'created':
        on_created(msg.terminal);
        break;
      case 'closed':
        on_closed(msg.terminal_id);
        break;
      case 'agents_check':
        state.availability = msg.available || {};
        render_agent_grid();
        break;
      case 'error':
        toast(msg.message || 'Error');
        break;
      default:
        break;
    }
  }

  function apply_snapshot(msg) {
    state.workspaces = Array.isArray(msg.workspaces) ? msg.workspaces.filter((ws) => ws && ws.id) : [];
    state.terminals = Array.isArray(msg.terminals) ? msg.terminals : [];
    state.status = msg.status && typeof msg.status === 'object' ? msg.status : {};

    const ids = state.workspaces.map((ws) => ws.id);
    if (!ids.includes(state.selected_workspace)) {
      const viewing = state.viewing_terminal_id
        ? state.terminals.find((info) => info.terminal_id === state.viewing_terminal_id)
        : null;
      const with_terminals = state.terminals.find((info) => info.workspace_id && ids.includes(info.workspace_id));
      state.selected_workspace =
        (viewing && viewing.workspace_id) ||
        (with_terminals && with_terminals.workspace_id) ||
        ids[0] ||
        null;
    }
    if (state.viewing_terminal_id && !state.terminals.some((info) => info.terminal_id === state.viewing_terminal_id)) {
      show_sessions();
    } else if (state.viewing_terminal_id) {
      const info = state.terminals.find((item) => item.terminal_id === state.viewing_terminal_id);
      if (info) set_term_header(info);
    }
    render_ws_selects();
    render_sessions();
    render_agent_grid();
  }

  function on_attached(msg) {
    if (msg.terminal_id !== state.pending_attach) return; // stale reply (user went back)
    state.pending_attach = null;
    state.attached_id = msg.terminal_id;
    if (state.term) {
      state.term.reset();
      if (typeof msg.buffer === 'string' && msg.buffer !== '') state.term.write(msg.buffer);
      if (msg.alive === false) {
        state.term.write(`\r\n[process exited with code ${msg.exit_code}]\r\n`);
      }
    }
    fit_term();
    // Explicit resize after the replay: the pane on the desktop may still have another size.
    if (state.term) {
      send({ type: 'resize', terminal_id: state.attached_id, cols: state.term.cols, rows: state.term.rows });
    }
    refresh_status_ui();
  }

  function on_exit(terminal_id, exit_code) {
    const info = state.terminals.find((item) => item.terminal_id === terminal_id);
    if (info) {
      info.alive = false;
      info.exit_code = typeof exit_code === 'number' ? exit_code : null;
    }
    if (terminal_id === state.attached_id && state.term) {
      state.term.write(`\r\n[process exited with code ${info ? info.exit_code : exit_code}]\r\n`);
    }
    render_sessions();
    refresh_status_ui();
  }

  function on_created(terminal) {
    if (!terminal || !terminal.terminal_id) return;
    if (!state.terminals.some((info) => info.terminal_id === terminal.terminal_id)) {
      state.terminals.push(terminal);
    }
    render_sessions();
    if (state.launch_pending) {
      state.launch_pending = false;
      close_sheet();
      state.selected_workspace = terminal.workspace_id || state.selected_workspace;
      render_ws_selects();
      open_terminal(terminal.terminal_id);
    }
  }

  function on_closed(terminal_id) {
    state.terminals = state.terminals.filter((info) => info.terminal_id !== terminal_id);
    if (terminal_id === state.attached_id || terminal_id === state.viewing_terminal_id) {
      state.attached_id = null;
      state.pending_attach = null;
      toast('Session was closed');
      show_sessions();
    }
    render_sessions();
  }

  // ---- views ----

  function show_sessions() {
    if (state.attached_id) {
      send({ type: 'detach', terminal_id: state.attached_id });
      state.attached_id = null;
    }
    state.pending_attach = null;
    state.viewing_terminal_id = null;
    by_id('view_terminal').hidden = true;
    by_id('view_sessions').hidden = false;
    render_sessions();
  }

  function open_terminal(terminal_id) {
    const info = state.terminals.find((item) => item.terminal_id === terminal_id);
    if (!info) return;
    state.viewing_terminal_id = terminal_id;
    state.attached_id = null;
    state.pending_attach = terminal_id;
    set_term_header(info);
    by_id('view_sessions').hidden = true;
    by_id('view_terminal').hidden = false;
    ensure_term();
    window.requestAnimationFrame(() => {
      fit_term();
    });
    send({ type: 'attach', terminal_id });
  }

  function set_term_header(info) {
    const decoded = decode_title(info.title, info.command);
    by_id('term_title').textContent = decoded.name;
    refresh_status_ui();
  }

  function ensure_term() {
    if (state.term) return;
    const host = by_id('term_host');
    const term = new window.Terminal(TERMINAL_OPTIONS);
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(host);
    term.onData((data) => {
      // In line mode the on-screen input owns typing; the terminal only receives quick-key bytes.
      if (state.attached_id && !state.line_mode) send({ type: 'input', terminal_id: state.attached_id, data });
    });
    term.onResize((size) => {
      if (state.attached_id) {
        send({ type: 'resize', terminal_id: state.attached_id, cols: size.cols, rows: size.rows });
      }
    });
    state.term = term;
    state.fit = fit;
    host.addEventListener('click', () => {
      if (!state.line_mode) term.focus();
    });
  }

  function fit_term() {
    if (!state.term || !state.fit || by_id('view_terminal').hidden) return;
    try {
      state.fit.fit();
    } catch (error) {
      /* zero-size moments are fine */
    }
  }

  function refresh_status_ui() {
    const dot = by_id('term_dot');
    const info = state.viewing_terminal_id
      ? state.terminals.find((item) => item.terminal_id === state.viewing_terminal_id)
      : null;
    if (info) {
      const status = status_of(info);
      dot.className = `dot ${status}`;
      dot.title = status_text(info);
    } else {
      dot.className = 'dot';
    }
    // Card ages ("Waiting 2m") only change on a re-render; keep it cheap by refreshing visible cards.
    if (!by_id('view_sessions').hidden) render_sessions();
  }

  // ---- session list rendering ----

  function render_ws_selects() {
    for (const select_id of ['ws_select', 'sheet_ws']) {
      const select = by_id(select_id);
      const previous = select.value;
      select.replaceChildren(
        ...state.workspaces.map((ws) => {
          const option = document.createElement('option');
          option.value = ws.id;
          option.textContent = ws.name || ws.path || ws.id;
          return option;
        })
      );
      if (state.workspaces.some((ws) => ws.id === previous)) {
        select.value = previous;
      } else if (state.selected_workspace && state.workspaces.some((ws) => ws.id === state.selected_workspace)) {
        select.value = state.selected_workspace;
      }
    }
  }

  function render_sessions() {
    const list = by_id('session_list');
    const empty = by_id('sessions_empty');
    const selected = state.selected_workspace;
    const rows = state.terminals.filter((info) => info.workspace_id === selected || (selected === null && !info.workspace_id));
    const cards = rows.map((info) => {
      const decoded = decode_title(info.title, info.command);
      const card = document.createElement('div');
      card.className = 'session_card';
      card.setAttribute('role', 'listitem');
      const logo = build_logo(decoded.agent_id);
      if (logo) card.append(logo);
      else {
        const glyph = document.createElement('span');
        glyph.className = 'session_glyph';
        glyph.textContent = (decoded.agent_label || '?').slice(0, 2).toUpperCase();
        card.append(glyph);
      }
      const text = document.createElement('div');
      text.className = 'session_text';
      const name = document.createElement('div');
      name.className = 'session_name';
      name.textContent = decoded.name;
      const meta = document.createElement('div');
      meta.className = 'session_meta';
      meta.textContent = `${decoded.agent_label || decoded.name} · ${status_text(info)}`;
      text.append(name, meta);
      const dot = document.createElement('span');
      dot.className = `dot ${status_of(info)}`;
      card.append(text, dot);
      card.addEventListener('click', () => open_terminal(info.terminal_id));
      return card;
    });
    list.replaceChildren(...cards);
    empty.hidden = rows.length > 0 || state.workspaces.length === 0;
    if (state.workspaces.length === 0) {
      empty.textContent = 'No workspaces yet — add one on the desktop first.';
      empty.hidden = false;
    }
  }

  // ---- new session sheet ----

  function open_sheet() {
    render_ws_selects();
    render_agent_grid();
    by_id('sheet_new').hidden = false;
  }

  function close_sheet() {
    by_id('sheet_new').hidden = true;
    state.launch_pending = false;
  }

  function render_agent_grid() {
    const grid = by_id('agent_grid');
    const catalog = Array.isArray(window.AGENT_CATALOG) ? window.AGENT_CATALOG : [];
    grid.replaceChildren(
      ...catalog.map((agent) => {
        const card = document.createElement('div');
        card.className = 'agent_card';
        card.setAttribute('role', 'option');
        const installed = state.availability[agent.command];
        if (installed === false) card.classList.add('disabled');
        if (state.selected_agent === agent.id) card.classList.add('selected');

        let visual;
        if (agent.logo) {
          visual = document.createElement('img');
          visual.alt = '';
          visual.draggable = false;
          visual.src = agent.logo;
          visual.addEventListener('error', () => {
            const glyph = document.createElement('span');
            glyph.textContent = agent.glyph || '?';
            visual.replaceWith(glyph);
          });
        } else {
          visual = document.createElement('span');
          visual.textContent = agent.glyph || '?';
        }
        const name = document.createElement('span');
        name.className = 'agent_name';
        name.textContent = agent.label;
        const state_text = document.createElement('span');
        state_text.className = 'agent_state';
        state_text.textContent = installed === undefined ? 'checking…' : installed === false ? 'not installed' : 'ready';
        card.append(visual, name, state_text);
        if (installed !== false) {
          card.addEventListener('click', () => {
            state.selected_agent = agent.id;
            const name_input = by_id('sheet_name');
            if (name_input.value.trim() === '') name_input.placeholder = agent.label;
            render_agent_grid();
            update_launch_button();
          });
        }
        return card;
      })
    );
    update_launch_button();
  }

  function update_launch_button() {
    const button = by_id('btn_launch');
    const agent_ok = state.selected_agent !== null;
    const ws_ok = by_id('sheet_ws').value !== '';
    button.disabled = !(agent_ok && ws_ok);
  }

  function launch() {
    const workspace_id = by_id('sheet_ws').value;
    const agent = (window.AGENT_CATALOG || []).find((item) => item.id === state.selected_agent);
    if (!workspace_id || !agent) return;
    const name = by_id('sheet_name').value.trim().slice(0, 60) || agent.label;
    state.launch_pending = true;
    send({ type: 'create', workspace_id, agent_id: agent.id, title: name });
    // 'created' closes the sheet and opens the new session; a failure arrives as {type:'error'}.
  }

  // ---- input zone ----

  function build_keys() {
    const row = by_id('keys_row');
    row.replaceChildren(
      ...QUICK_KEYS.map((key) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'key_button';
        button.textContent = key.label;
        button.dataset.key_id = key.id;
        if (key.id === 'mode') {
          button.classList.toggle('toggled', state.line_mode);
          button.addEventListener('click', toggle_line_mode);
        } else {
          button.addEventListener('click', () => {
            if (state.attached_id) send({ type: 'input', terminal_id: state.attached_id, data: key.data });
          });
        }
        return button;
      })
    );
  }

  function toggle_line_mode() {
    state.line_mode = !state.line_mode;
    by_id('line_row').hidden = !state.line_mode;
    const mode_button = Array.from(document.querySelectorAll('.key_button')).find((button) => button.dataset.key_id === 'mode');
    if (mode_button) {
      mode_button.classList.toggle('toggled', state.line_mode);
      mode_button.textContent = state.line_mode ? 'Keys' : 'Line';
    }
    if (state.line_mode) {
      by_id('line_input').focus();
    } else if (state.term) {
      state.term.focus();
    }
  }

  function send_line() {
    const input = by_id('line_input');
    const value = input.value;
    if (value === '' || !state.attached_id) return;
    send({ type: 'input', terminal_id: state.attached_id, data: `${value}\r` });
    input.value = '';
    input.focus();
  }

  // ---- boot ----

  function register_events() {
    by_id('btn_refresh').addEventListener('click', () => send({ type: 'list' }));
    by_id('btn_new').addEventListener('click', open_sheet);
    by_id('btn_sheet_close').addEventListener('click', close_sheet);
    by_id('sheet_new').addEventListener('click', (event) => {
      if (event.target === by_id('sheet_new')) close_sheet();
    });
    by_id('btn_launch').addEventListener('click', launch);
    by_id('btn_back').addEventListener('click', show_sessions);
    by_id('ws_select').addEventListener('change', (event) => {
      state.selected_workspace = event.target.value || null;
      render_sessions();
    });
    by_id('btn_send').addEventListener('click', send_line);
    by_id('line_input').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        send_line();
      }
    });
    window.addEventListener('resize', () => {
      fit_term();
    });
    window.addEventListener('orientationchange', () => {
      window.setTimeout(fit_term, 250);
    });
    // Coming back to the app (street → pocket → street): refresh everything.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (state.connected) send({ type: 'list' });
        else connect();
        window.setTimeout(fit_term, 200);
      }
    });
  }

  if (!TOKEN) {
    window.document.body.innerHTML =
      '<p style="color:#ececec;font-family:sans-serif;padding:24px">This page must be opened through the AgentSense mobile link (it contains the pairing token).</p>';
    return;
  }

  register_events();
  build_keys();
  render_sessions();
  connect();
})();
