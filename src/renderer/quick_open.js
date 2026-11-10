// File search overlay for the workbench. Ctrl+P finds names. Ctrl+Shift+F finds a line of text.
// Classic script. Exposes window.open_workspace_search.
(function quick_open_module() {
  const TEXT_MIN = 2;
  const NAME_WAIT_MS = 60;
  const TEXT_WAIT_MS = 200;

  function create_el(tag, class_name, text) {
    const element = document.createElement(tag);
    if (class_name) element.className = class_name;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function open_workspace_search(options) {
    const host = options && options.host;
    if (!host) return;
    const mode = options.mode === 'text' ? 'text' : 'name';
    let overlay = host.__quick_open;
    if (!overlay) {
      overlay = create_el('div', 'tg-quick');
      const input = create_el('input', 'tg-quick-input');
      input.type = 'text';
      const hint = create_el('div', 'tg-quick-hint');
      const list = create_el('div', 'tg-quick-list');
      overlay.append(input, hint, list);
      host.append(overlay);
      host.__quick_open = overlay;
      overlay.__state = { serial: 0, timer: 0, active: 0, rows: [] };

      input.addEventListener('keydown', (event) => {
        const state = overlay.__state;
        if (event.key === 'Escape') {
          event.preventDefault();
          overlay.hidden = true;
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (state.rows.length === 0) return;
          const step = event.key === 'ArrowDown' ? 1 : -1;
          state.active = (state.active + step + state.rows.length) % state.rows.length;
          paint_active(overlay);
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          const row = state.rows[state.active];
          if (row) choose(overlay, row.rel);
        }
      });
      input.addEventListener('input', () => schedule(overlay));
    }

    overlay.__options = options;
    overlay.hidden = false;
    const input = overlay.querySelector('input');
    input.value = '';
    input.placeholder = mode === 'text' ? 'Text in this workspace' : 'File name in this workspace';
    input.focus();
    schedule(overlay);
  }

  function choose(overlay, rel) {
    const options = overlay.__options;
    overlay.hidden = true;
    const root = options.get_root();
    options.on_open(rel, root);
  }

  function paint_active(overlay) {
    const state = overlay.__state;
    const buttons = overlay.querySelectorAll('.tg-quick-item');
    for (let i = 0; i < buttons.length; i += 1) {
      buttons[i].classList.toggle('tg-quick-active', i === state.active);
    }
    if (buttons[state.active]) buttons[state.active].scrollIntoView({ block: 'nearest' });
  }

  function schedule(overlay) {
    const state = overlay.__state;
    if (state.timer) window.clearTimeout(state.timer);
    const mode = overlay.__options.mode === 'text' ? 'text' : 'name';
    state.timer = window.setTimeout(() => {
      state.timer = 0;
      void run_query(overlay);
    }, mode === 'text' ? TEXT_WAIT_MS : NAME_WAIT_MS);
  }

  async function run_query(overlay) {
    const state = overlay.__state;
    const options = overlay.__options;
    const mode = options.mode === 'text' ? 'text' : 'name';
    const query = overlay.querySelector('input').value;
    const hint = overlay.querySelector('.tg-quick-hint');
    const list = overlay.querySelector('.tg-quick-list');
    const token = state.serial + 1;
    state.serial = token;

    if (mode === 'text' && query.trim().length < TEXT_MIN) {
      hint.textContent = 'Type at least 2 characters. Ctrl+P finds a file name.';
      list.textContent = '';
      state.rows = [];
      return;
    }
    hint.textContent = mode === 'text' ? 'Searching file text…' : '';

    let found = null;
    try {
      const root = options.get_root();
      found = mode === 'text'
        ? await options.search_text(root, query)
        : await options.search_names(root, query);
    } catch (error) {
      if (state.serial !== token) return;
      hint.textContent = error && error.message ? error.message : 'Search failed';
      list.textContent = '';
      state.rows = [];
      return;
    }
    if (state.serial !== token) return;

    const results = (found && found.results) || [];
    state.rows = results;
    state.active = 0;
    list.textContent = '';
    if (results.length === 0) {
      hint.textContent = mode === 'text' ? 'No matching lines.' : 'No matching files.';
      return;
    }
    hint.textContent = found.truncated ? `Showing ${results.length}. The search stopped early.` : '';
    for (const item of results) {
      const button = create_el('button', 'tg-quick-item');
      button.type = 'button';
      if (mode === 'text') {
        button.append(
          create_el('span', 'tg-quick-path', `${item.rel}:${item.line}`),
          create_el('span', 'tg-quick-meta', item.text || '')
        );
      } else {
        button.textContent = item.rel;
      }
      button.addEventListener('click', () => choose(overlay, item.rel));
      list.append(button);
    }
    paint_active(overlay);
  }

  window.open_workspace_search = open_workspace_search;
})();
