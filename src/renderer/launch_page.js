// Launch page ("New session"): preset / agent / how many / will launch, rendered inline in a container.
// window.mount_launch_page({ container, workspace, on_launch, on_close }) -> { destroy() }.
// on_launch(seats) receives [{ agent_id, label, command }] in launch order. The caller destroys the page
// after on_launch or on_close. See SPEC.md Phase 2c.
(function () {
  if (window.mount_launch_page) return;

  const MAX_SEATS = 6;
  const COUNT_CHOICES = [1, 2, 3, 4, 5, 6];
  const TERMINAL_AGENT_ID = 'terminal';
  const CLAUDE_AGENT_ID = 'claude';
  const INSTALL_ACTION = 'install';
  const PRESET_NAME_MAX_LENGTH = 40;
  const COPY_FEEDBACK_MS = 1500;
  const MODEL_DEFAULT = ''; // an empty seat model means "let the agent decide"
  const CIRCLE_SHAPES = [
    { tag: 'circle', attrs: { cx: '6', cy: '6', r: '4.6', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.3' } },
  ];
  const TRASH_SHAPES = [
    { tag: 'path', attrs: { d: 'M2.5 3.5h7M4.5 3.5v-1a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M3.5 3.5l.4 6a.8.8 0 0 0 .8.75h2.6a.8.8 0 0 0 .8-.75l.4-6', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round' } },
  ];
  const EDIT_SHAPES = [
    { tag: 'path', attrs: { d: 'M3 8.5V11h2.5L11 5.5 8.5 3 3 8.5z', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linejoin': 'round' } },
  ];

  function error_text(error) {
    if (error && typeof error.message === 'string') return error.message;
    return String(error);
  }

  function catalog() {
    return Array.isArray(window.AGENT_CATALOG) ? window.AGENT_CATALOG : [];
  }

  function find_catalog_agent(agent_id) {
    return catalog().find((agent) => agent.id === agent_id) || null;
  }

  function label_for(agent_id) {
    const agent = find_catalog_agent(agent_id);
    return agent ? agent.label : String(agent_id);
  }

  function is_installed(state, agent_id) {
    const availability = state.availability;
    return Boolean(availability) && availability[agent_id] === true;
  }

  function installed_agents(state) {
    return catalog().filter((agent) => is_installed(state, agent.id));
  }

  function default_agent_id(state) {
    if (is_installed(state, CLAUDE_AGENT_ID)) return CLAUDE_AGENT_ID;
    if (is_installed(state, TERMINAL_AGENT_ID)) return TERMINAL_AGENT_ID;
    const first = installed_agents(state)[0];
    return first ? first.id : TERMINAL_AGENT_ID;
  }

  // The agent id when every seat uses the same agent, otherwise null.
  function common_agent_id(lineup) {
    if (lineup.length === 0) return null;
    const first = lineup[0];
    return lineup.every((agent_id) => agent_id === first) ? first : null;
  }

  // "Claude Code x3 · Codex x1": total count per agent, in first-seen order.
  function summarize_seats(seats) {
    const order = [];
    const counts = new Map();
    for (const agent_id of seats) {
      if (!counts.has(agent_id)) {
        counts.set(agent_id, 0);
        order.push(agent_id);
      }
      counts.set(agent_id, counts.get(agent_id) + 1);
    }
    return order.map((agent_id) => `${label_for(agent_id)} x${counts.get(agent_id)}`).join(' · ');
  }

  function make_element(tag, options) {
    const opts = options || {};
    const element = document.createElement(tag);
    if (opts.class_name) element.className = opts.class_name;
    if (opts.text !== undefined) element.textContent = opts.text;
    const attrs = opts.attrs || {};
    for (const name of Object.keys(attrs)) {
      element.setAttribute(name, String(attrs[name]));
    }
    const handlers = opts.on || {};
    for (const event_name of Object.keys(handlers)) {
      element.addEventListener(event_name, handlers[event_name]);
    }
    return element;
  }

  // Logo image when the catalog has one, otherwise the letter badge. size is 'agent' (20px), 'seat' (16px) or 'small' (14px).
  function build_mark(agent, size) {
    const wrap = make_element('span', { class_name: `launch_mark launch_mark_${size}`, attrs: { 'aria-hidden': 'true' } });
    const glyph_text = agent ? agent.glyph || '' : '';
    if (agent && agent.logo) {
      const img = make_element('img', {
        class_name: 'launch_logo',
        attrs: { src: agent.logo, alt: '', draggable: 'false' },
      });
      img.addEventListener('error', () => {
        img.replaceWith(make_element('span', { class_name: 'launch_agent_glyph', text: glyph_text }));
      });
      wrap.appendChild(img);
    } else {
      wrap.appendChild(make_element('span', { class_name: 'launch_agent_glyph', text: glyph_text }));
    }
    return wrap;
  }

  // Hand-written inline SVG glyphs (no icon font). shapes = [{ tag, attrs }], drawn with currentColor.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const FOLDER_SHAPES = [
    {
      tag: 'path',
      attrs: {
        d: 'M2 4.2A1.2 1.2 0 0 1 3.2 3h2.4l1.3 1.5h5.9A1.2 1.2 0 0 1 14 5.7v5.9a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 11.6z',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.2',
        'stroke-linejoin': 'round',
      },
    },
  ];
  const DOWNLOAD_SHAPES = [
    { tag: 'path', attrs: { d: 'M6 1.5v6.2', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round' } },
    { tag: 'path', attrs: { d: 'M3.4 5.3 6 7.9l2.6-2.6', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } },
    { tag: 'path', attrs: { d: 'M2 10.4h8', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round' } },
  ];
  const PLAY_SHAPES = [{ tag: 'path', attrs: { d: 'M1.5 1v8l7-4z', fill: 'currentColor' } }];
  // Close X: two crossing lines, 1.5px stroke in a 12-unit box.
  const close_shapes = [
    { tag: 'path', attrs: { d: 'M2.5 2.5l7 7M9.5 2.5l-7 7', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round' } },
  ];

  function make_svg(class_name, view_box, shapes) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', view_box);
    svg.setAttribute('class', class_name);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const shape of shapes) {
      const node = document.createElementNS(SVG_NS, shape.tag);
      for (const name of Object.keys(shape.attrs)) {
        node.setAttribute(name, shape.attrs[name]);
      }
      svg.appendChild(node);
    }
    return svg;
  }

  // Availability: hub.agents.check on every mount. If the check fails, only Terminal counts as installed.
  async function load_availability() {
    const commands = catalog().map((agent) => agent.command);
    try {
      const result = await window.hub.agents.check(commands);
      const availability = {};
      for (const agent of catalog()) {
        availability[agent.id] = result[agent.command] === true;
      }
      return { availability, failed: false, error_message: '' };
    } catch (error) {
      const availability = {};
      for (const agent of catalog()) {
        availability[agent.id] = agent.id === TERMINAL_AGENT_ID;
      }
      return { availability, failed: true, error_message: error_text(error) };
    }
  }

  async function load_presets() {
    try {
      const presets = await window.hub.presets.list();
      return { presets: Array.isArray(presets) ? presets : [], failed: false, error_message: '' };
    } catch (error) {
      return { presets: [], failed: true, error_message: error_text(error) };
    }
  }

  // True only when the workspace folder is a git repository. Any failure counts as "not a repo" (no checkbox).
  async function load_repo_flag(folder_path) {
    if (!folder_path || !window.hub.git || typeof window.hub.git.is_repo !== 'function') return false;
    try {
      return (await window.hub.git.is_repo(folder_path)) === true;
    } catch (error) {
      return false;
    }
  }

  function create_state(options) {
    return {
      container: options.container,
      workspace: options.workspace,
      on_launch: options.on_launch,
      on_close: options.on_close,
      closed: false,
      launched: false,
      loading: true,
      availability: null,
      presets: [],
      lineup: [TERMINAL_AGENT_ID],
      selected_preset_id: null,
      new_preset_open: false,
      new_preset_name: '',
      saving: false,
      // Git worktree option: the checkbox exists only for a git repo workspace, and is off by default.
      is_repo: false,
      use_worktree: false,
      // Model selection per seat (parallel to lineup; MODEL_DEFAULT = agent default) and third-party APIs.
      models: [],
      providers: [],
      providers_failed: false,
      providers_error: '',
      managing_apis: false,
      api_draft_open: false,
      api_draft: null, // { editing_id|null, name, kind, base_url, api_key, models_text }
      api_saving: false,
      // Agent whose install command was just copied ("Copied" feedback for COPY_FEEDBACK_MS).
      copied_agent_id: null,
      copy_timer: 0,
      message_text: '',
      message_kind: '',
      root: null,
      body: null,
      summary_el: null,
      primary_el: null,
      primary_label_el: null,
      footer_el: null,
    };
  }

  function set_message(state, text, kind) {
    state.message_text = text;
    state.message_kind = kind || '';
  }

  function build_page(state) {
    const root = make_element('div', { class_name: 'launch_page', attrs: { id: 'launch_page' } });

    const header = make_element('header', { class_name: 'launch_header' });
    const header_inner = make_element('div', { class_name: 'launch_header_inner' });
    // Folder icon, workspace name, then the muted " · New session" (the text reads "<name> · New session").
    const title = make_element('h2', {
      class_name: 'launch_title',
      attrs: { id: 'launch_page_title' },
    });
    title.append(
      make_svg('launch_title_icon', '0 0 16 16', FOLDER_SHAPES),
      make_element('span', { class_name: 'launch_title_name', text: state.workspace.name }),
      make_element('span', { class_name: 'launch_title_rest', text: ' · New session' })
    );
    const close_button = make_element('button', {
      class_name: 'launch_close',
      attrs: { type: 'button', 'aria-label': 'Close', 'data-action': 'close' },
      on: { click: () => request_close(state) },
    });
    close_button.appendChild(make_svg('launch_close_icon', '0 0 12 12', close_shapes));
    header_inner.append(title, close_button);
    header.appendChild(header_inner);

    // Only the body scrolls. It holds the centred 600px column; the footer is a sibling pinned below it.
    const body = make_element('div', { class_name: 'launch_body' });
    const column = make_element('div', { class_name: 'launch_column' });
    body.appendChild(column);

    const footer = make_element('footer', { class_name: 'launch_footer' });
    const footer_inner = make_element('div', { class_name: 'launch_footer_inner' });
    const summary = make_element('span', { class_name: 'launch_summary' });
    const actions = make_element('div', { class_name: 'launch_footer_actions' });
    const cancel = make_element('button', {
      class_name: 'launch_cancel',
      text: 'Cancel',
      attrs: { type: 'button', 'data-action': 'cancel' },
      on: { click: () => request_close(state) },
    });
    const primary = make_element('button', {
      class_name: 'launch_primary',
      attrs: { type: 'button', 'data-action': 'launch' },
      on: { click: () => launch_lineup(state) },
    });
    const primary_label = make_element('span', { class_name: 'launch_primary_label', text: 'Launch' });
    primary.append(make_svg('launch_primary_icon', '0 0 10 10', PLAY_SHAPES), primary_label);
    actions.append(cancel, primary);
    footer_inner.append(summary, actions);
    footer.appendChild(footer_inner);

    root.append(header, body, footer);

    state.root = root;
    state.body = column;
    state.footer_el = footer;
    state.summary_el = summary;
    state.primary_el = primary;
    state.primary_label_el = primary_label;
  }

  function focused_key(state) {
    const active = document.activeElement;
    if (!active || !state.root.contains(active)) return null;
    return active.getAttribute('data-focus-key');
  }

  function focus_by_key(state, key) {
    if (!key) return;
    const target = Array.from(state.root.querySelectorAll('[data-focus-key]')).find(
      (element) => element.getAttribute('data-focus-key') === key
    );
    if (target) target.focus();
  }

  // Rebuilds the body and footer from state, then puts focus back on the control that had it.
  function render(state) {
    if (state.closed) return;
    const key = focused_key(state);
    state.body.replaceChildren(
      ...[
        build_preset_section(state),
        build_agent_section(state),
        build_api_section(state),
        build_count_section(state),
        build_worktree_section(state),
        build_seat_section(state),
        build_message(state),
      ].filter(Boolean)
    );
    render_footer(state);
    focus_by_key(state, key);
  }

  function render_footer(state) {
    const count = state.lineup.length;
    const noun = count === 1 ? 'session' : 'sessions';
    if (state.loading) {
      state.summary_el.textContent = 'Checking installed agents…';
      state.primary_label_el.textContent = 'Checking agents…';
      state.primary_el.disabled = true;
      return;
    }
    state.summary_el.textContent = `${count} ${noun} in ${state.workspace.name}`;
    const common = common_agent_id(state.lineup);
    state.primary_label_el.textContent = common !== null ? `Launch ${label_for(common)}` : `Launch ${count} sessions`;
    state.primary_el.disabled = state.launched;
  }

  // ---- presets ----

  function build_preset_section(state) {
    const section = make_element('section', { class_name: 'launch_section' });
    section.appendChild(make_element('h3', { class_name: 'launch_section_title', text: 'Preset' }));
    const grid = make_element('div', { class_name: 'launch_preset_grid' });
    for (const preset of state.presets) {
      grid.appendChild(build_preset_card(state, preset));
    }
    grid.appendChild(state.new_preset_open ? build_new_preset_form(state) : build_new_preset_card(state));
    section.appendChild(grid);
    return section;
  }

  function build_preset_logos(preset) {
    const row = make_element('div', { class_name: 'launch_preset_logos' });
    const unique = [];
    for (const agent_id of preset.seats) {
      if (!unique.includes(agent_id)) unique.push(agent_id);
    }
    for (const agent_id of unique) {
      row.appendChild(build_mark(find_catalog_agent(agent_id), 'small'));
    }
    return row;
  }

  function build_preset_card(state, preset) {
    const usable_count = preset.seats.filter((agent_id) => is_installed(state, agent_id)).length;
    const missing_count = preset.seats.length - usable_count;

    const wrap = make_element('div', { class_name: 'launch_preset_wrap' });
    const classes = ['launch_preset_card'];
    if (state.selected_preset_id === preset.id) classes.push('selected');
    if (missing_count > 0) classes.push('partial');
    const card = make_element('button', {
      class_name: classes.join(' '),
      attrs: {
        type: 'button',
        'data-preset-id': preset.id,
        'data-focus-key': `preset:${preset.id}`,
        'aria-pressed': String(state.selected_preset_id === preset.id),
      },
      on: { click: () => apply_preset(state, preset) },
    });
    card.disabled = state.loading;

    const head = make_element('div', { class_name: 'launch_preset_head' });
    head.append(
      make_element('span', { class_name: 'launch_preset_name', text: preset.name }),
      make_element('span', {
        class_name: 'launch_preset_count',
        text: String(preset.seats.length),
        attrs: { title: `${preset.seats.length} seats` },
      })
    );
    card.appendChild(head);
    // Logos and the summary share one line under the name.
    const meta = make_element('div', { class_name: 'launch_preset_meta' });
    meta.append(
      build_preset_logos(preset),
      make_element('span', { class_name: 'launch_preset_summary', text: summarize_seats(preset.seats) })
    );
    card.appendChild(meta);
    if (missing_count > 0) {
      card.appendChild(
        make_element('span', {
          class_name: 'launch_preset_note',
          text: `${missing_count} not installed, skipped when applied`,
        })
      );
    }
    wrap.appendChild(card);

    const delete_button = make_element('button', {
      class_name: 'launch_preset_delete',
      text: '×',
      attrs: {
        type: 'button',
        'aria-label': `Delete preset ${preset.name}`,
        'data-preset-delete-id': preset.id,
        'data-focus-key': `delete:${preset.id}`,
      },
      on: {
        click: (event) => {
          event.stopPropagation();
          delete_preset(state, preset.id);
        },
      },
    });
    delete_button.disabled = state.loading;
    wrap.appendChild(delete_button);
    return wrap;
  }

  function build_new_preset_card(state) {
    const card = make_element('button', {
      class_name: 'launch_preset_new',
      attrs: { type: 'button', 'data-focus-key': 'new_preset' },
      on: { click: () => open_new_preset_form(state) },
    });
    card.append(
      make_element('span', { class_name: 'launch_preset_new_title', text: '+ New preset' }),
      make_element('span', { class_name: 'launch_preset_new_hint', text: 'Save this lineup, or build one seat by seat' })
    );
    card.disabled = state.loading;
    return card;
  }

  function build_new_preset_form(state) {
    const form = make_element('div', { class_name: 'launch_preset_form' });
    const input = make_element('input', {
      class_name: 'launch_preset_input',
      attrs: {
        type: 'text',
        maxlength: String(PRESET_NAME_MAX_LENGTH),
        placeholder: 'Preset name',
        'aria-label': 'Preset name',
        'data-focus-key': 'preset_name',
      },
      on: {
        input: (event) => {
          state.new_preset_name = event.target.value;
        },
        keydown: (event) => on_preset_input_keydown(state, event),
      },
    });
    input.value = state.new_preset_name;
    const save_button = make_element('button', {
      class_name: 'launch_preset_save',
      text: 'Save',
      attrs: { type: 'button', 'data-action': 'save_preset', 'data-focus-key': 'save_preset' },
      on: { click: () => save_new_preset(state) },
    });
    const cancel_button = make_element('button', {
      class_name: 'launch_preset_form_cancel',
      text: 'Cancel',
      attrs: { type: 'button', 'data-focus-key': 'preset_form_cancel' },
      on: { click: () => close_new_preset_form(state) },
    });
    form.append(input, save_button, cancel_button);
    return form;
  }

  // Enter saves. Escape cancels this input only; the page itself is never closed by Escape.
  function on_preset_input_keydown(state, event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      save_new_preset(state);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close_new_preset_form(state);
    }
  }

  function open_new_preset_form(state) {
    if (state.closed || state.loading) return;
    state.new_preset_open = true;
    state.new_preset_name = '';
    set_message(state, '', '');
    render(state);
    focus_by_key(state, 'preset_name');
  }

  function close_new_preset_form(state) {
    if (state.closed) return;
    state.new_preset_open = false;
    state.new_preset_name = '';
    render(state);
    focus_by_key(state, 'new_preset');
  }

  async function refresh_presets(state) {
    const result = await load_presets();
    if (state.closed) return;
    state.presets = result.presets;
    if (result.failed) set_message(state, `Could not load presets: ${result.error_message}`, 'error');
  }

  async function save_new_preset(state) {
    if (state.closed || state.loading || state.saving) return;
    const name = String(state.new_preset_name || '').trim();
    if (name === '') {
      set_message(state, 'Type a name for the preset first.', 'error');
      render(state);
      focus_by_key(state, 'preset_name');
      return;
    }
    state.saving = true;
    try {
      await window.hub.presets.save({ name, seats: state.lineup.slice() });
      if (state.closed) return;
      state.new_preset_open = false;
      state.new_preset_name = '';
      set_message(state, '', '');
      await refresh_presets(state);
      if (state.closed) return;
      render(state);
      focus_by_key(state, 'new_preset');
    } catch (error) {
      if (state.closed) return;
      set_message(state, `Could not save preset: ${error_text(error)}`, 'error');
      render(state);
    } finally {
      state.saving = false;
    }
  }

  async function delete_preset(state, preset_id) {
    if (state.closed || state.loading) return;
    try {
      await window.hub.presets.remove(preset_id);
      if (state.closed) return;
      if (state.selected_preset_id === preset_id) state.selected_preset_id = null;
      set_message(state, '', '');
      await refresh_presets(state);
      if (state.closed) return;
      render(state);
      focus_by_key(state, 'new_preset');
    } catch (error) {
      if (state.closed) return;
      set_message(state, `Could not delete preset: ${error_text(error)}`, 'error');
      render(state);
    }
  }

  // Replaces the lineup with the preset's installed seats. Uninstalled agents are skipped.
  function apply_preset(state, preset) {
    if (state.closed || state.loading) return;
    const usable = preset.seats.filter((agent_id) => is_installed(state, agent_id)).slice(0, MAX_SEATS);
    if (usable.length === 0) {
      set_message(state, 'None of the agents in this preset are installed.', 'error');
      render(state);
      return;
    }
    const skipped = preset.seats.length - preset.seats.filter((agent_id) => is_installed(state, agent_id)).length;
    state.lineup = usable;
    sync_models(state);
    state.selected_preset_id = preset.id;
    if (skipped > 0) {
      set_message(state, `Skipped ${skipped} seat(s) with agents that are not installed.`, 'notice');
    } else {
      set_message(state, '', '');
    }
    render(state);
    focus_by_key(state, `preset:${preset.id}`);
  }

  // ---- agents ----

  function build_agent_section(state) {
    const section = make_element('section', { class_name: 'launch_section' });
    section.appendChild(make_element('h3', { class_name: 'launch_section_title', text: 'Agent' }));
    if (state.loading) {
      section.appendChild(make_element('p', { class_name: 'launch_loading', text: 'Checking installed agents…' }));
      return section;
    }
    const grid = make_element('div', { class_name: 'launch_agent_grid' });
    const selected_id = common_agent_id(state.lineup);
    for (const agent of catalog()) {
      grid.appendChild(build_agent_button(state, agent, selected_id));
    }
    section.appendChild(grid);
    const missing_row = build_missing_row(state);
    if (missing_row) section.appendChild(missing_row);
    const install_hints = build_install_hints(state);
    if (install_hints) section.appendChild(install_hints);
    const custom = make_element('details', { class_name: 'launch_custom' });
    custom.appendChild(make_element('summary', { text: 'Run another CLI agent' }));
    const form = make_element('form', { class_name: 'launch_custom_form' });
    const command = make_element('input', {
      class_name: 'launch_api_input',
      attrs: { type: 'text', placeholder: 'Executable or command, e.g. aider', 'aria-label': 'Custom CLI command', maxlength: '2048', required: '' },
    });
    const name = make_element('input', {
      class_name: 'launch_api_input',
      attrs: { type: 'text', placeholder: 'Display name (optional)', 'aria-label': 'Custom CLI name', maxlength: '60' },
    });
    const run = make_element('button', { class_name: 'launch_api_save', text: 'Run CLI', attrs: { type: 'submit' } });
    form.append(command, name, run);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = command.value.trim();
      if (state.closed || state.launched || !value || /[\r\n\0]/.test(value)) return;
      state.launched = true;
      call_callback(state.on_launch, [[{
        agent_id: 'custom', label: name.value.trim() || value.slice(0, 60), command: value,
      }], { use_worktree: state.is_repo && state.use_worktree }], 'launch failed');
    });
    custom.appendChild(form);
    section.appendChild(custom);
    return section;
  }

  function build_agent_button(state, agent, selected_id) {
    const installed = is_installed(state, agent.id);
    const selected = agent.id === selected_id;
    const classes = ['launch_agent_button'];
    if (selected) classes.push('selected');
    if (!installed) classes.push('unavailable');
    const button = make_element('button', {
      class_name: classes.join(' '),
      attrs: {
        type: 'button',
        'data-agent-id': agent.id,
        'data-focus-key': `agent:${agent.id}`,
        'aria-pressed': String(selected),
        title: `${installed ? agent.command : `${agent.command} is not installed`}${agent.note ? ` · ${agent.note}` : ''}`,
      },
      on: { click: () => choose_agent(state, agent.id) },
    });
    button.disabled = !installed;
    button.append(
      build_mark(agent, 'agent'),
      make_element('span', { class_name: 'launch_agent_label', text: agent.label })
    );
    return button;
  }

  function build_missing_row(state) {
    const missing = catalog().filter((agent) => !is_installed(state, agent.id));
    if (missing.length === 0) return null;
    const row = make_element('div', { class_name: 'launch_missing' });
    row.appendChild(make_element('span', { class_name: 'launch_missing_title', text: 'Not installed yet:' }));
    for (const agent of missing) {
      if (agent.install_command) {
        const button = make_element('button', {
          class_name: 'launch_install_button',
          attrs: {
            type: 'button',
            'data-action': INSTALL_ACTION,
            'data-install-agent-id': agent.id,
            'data-focus-key': `install:${agent.id}`,
          },
          on: { click: () => install_agent(state, agent.id) },
        });
        button.append(
          make_svg('launch_install_icon', '0 0 12 12', DOWNLOAD_SHAPES),
          build_mark(agent, 'small'),
          make_element('span', { text: `Install ${agent.label}` })
        );
        row.appendChild(button);
      } else {
        const chip = make_element('span', { class_name: 'launch_missing_chip' });
        chip.append(build_mark(agent, 'small'), make_element('span', { text: agent.label }));
        row.appendChild(chip);
      }
    }
    return row;
  }

  // Choosing an agent sets every seat to it. Agent-model choices are reset (they named the old agent);
  // third-party endpoint choices remain valid because they only set env vars.
  function choose_agent(state, agent_id) {
    if (state.closed || state.loading || !is_installed(state, agent_id)) return;
    state.lineup = state.lineup.map(() => agent_id);
    state.models = state.models.map((selection) => (selection && selection.startsWith('p:') ? selection : MODEL_DEFAULT));
    state.selected_preset_id = null;
    set_message(state, '', '');
    render(state);
  }

  // ---- model & third-party APIs ----

  // Keeps the per-seat model list the same length as the lineup.
  function sync_models(state) {
    const next = [];
    for (let index = 0; index < state.lineup.length; index += 1) {
      next.push(typeof state.models[index] === 'string' ? state.models[index] : MODEL_DEFAULT);
    }
    state.models = next;
  }

  // Seat model value encoding: '' (agent default), 'm:<model>' (agent's own models) or 'p:<id>:<model>'.
  function model_options_for(state, agent_id, selection) {
    const agent = find_catalog_agent(agent_id);
    const select = make_element('select', {
      class_name: 'launch_seat_model',
      attrs: { 'aria-label': 'Model or API', 'data-focus-key': `model:${agent_id}` },
      on: { change: (event) => set_seat_model(state, agent_id, event.target.value) },
    });
    const default_option = make_element('option', { text: 'Default model', attrs: { value: MODEL_DEFAULT } });
    select.appendChild(default_option);
    if (agent && Array.isArray(agent.models)) {
      if (agent.models.length > 0) {
        const group = make_element('optgroup', { attrs: { label: `${agent.label} models` } });
        for (const model of agent.models) {
          group.appendChild(make_element('option', { text: model, attrs: { value: `m:${model}` } }));
        }
        select.appendChild(group);
      }
    }
    for (const provider of state.providers) {
      const group = make_element('optgroup', { attrs: { label: provider.name } });
      for (const model of provider.models) {
        group.appendChild(
          make_element('option', { text: model, attrs: { value: `p:${provider.id}:${model}` } })
        );
      }
      select.appendChild(group);
    }
    select.value = typeof selection === 'string' ? selection : MODEL_DEFAULT;
    if (select.selectedIndex === -1) select.value = MODEL_DEFAULT;
    return select;
  }

  function set_seat_model(state, agent_id, selection) {
    if (state.loading) return;
    // A model belongs to the seat's agent: only apply it to seats that run that agent.
    state.models = state.lineup.map((lineup_agent_id, index) => {
      if (lineup_agent_id !== agent_id) return state.models[index];
      return typeof selection === 'string' ? selection : MODEL_DEFAULT;
    });
    set_message(state, '', '');
    render(state);
  }

  // Builds the env vars one seat launches with, from its model/API choice and the stored providers.
  // Claude speaks ANTHROPIC_*; other agents get an <AGENT>_MODEL hint. Third-party endpoints use the
  // provider's kind: anthropic -> ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN, openai -> OPENAI_*.
  function model_env_for_seat(state, agent_id, selection) {
    const env = {};
    const value = typeof selection === 'string' ? selection : MODEL_DEFAULT;
    if (value === MODEL_DEFAULT) return env;
    const agent = find_catalog_agent(agent_id);
    if (value.startsWith('m:')) {
      const model = value.slice(2);
      if (!agent || !Array.isArray(agent.models) || !agent.models.includes(model)) return env;
      const key = agent_id === CLAUDE_AGENT_ID ? 'ANTHROPIC_MODEL' : `${agent_id.toUpperCase()}_MODEL`;
      env[key] = model;
      return env;
    }
    if (!value.startsWith('p:')) return env;
    const rest = value.slice(2);
    const separator = rest.indexOf(':');
    if (separator <= 0) return env;
    const provider = state.providers.find((item) => item.id === rest.slice(0, separator));
    if (!provider) return env;
    const model = rest.slice(separator + 1);
    if (provider.kind === 'anthropic') {
      env.ANTHROPIC_BASE_URL = provider.base_url;
      if (provider.api_key) env.ANTHROPIC_AUTH_TOKEN = provider.api_key;
      if (model && model !== MODEL_DEFAULT) env.ANTHROPIC_MODEL = model;
    } else {
      env.OPENAI_BASE_URL = provider.base_url;
      if (provider.api_key) env.OPENAI_API_KEY = provider.api_key;
      if (model && model !== MODEL_DEFAULT) env.OPENAI_MODEL = model;
    }
    return env;
  }

  // The section: header row with a manage toggle, then the stored APIs, then the add/edit form.
  function build_api_section(state) {
    const section = make_element('section', { class_name: 'launch_section' });
    const head = make_element('div', { class_name: 'launch_api_head' });
    head.appendChild(make_element('h3', { class_name: 'launch_section_title', text: 'Model & API' }));
    const manage = make_element('button', {
      class_name: state.managing_apis ? 'launch_api_toggle selected' : 'launch_api_toggle',
      text: state.managing_apis ? 'Done' : 'Manage APIs',
      attrs: { type: 'button', 'data-action': 'toggle_apis' },
      on: { click: () => toggle_manage_apis(state) },
    });
    head.appendChild(manage);
    section.appendChild(head);
    if (state.providers_failed && state.providers.length === 0) {
      section.appendChild(make_element('p', { class_name: 'launch_loading', text: 'Third-party APIs could not load; only agent models are listed.' }));
      return section;
    }
    if (state.managing_apis) {
      section.appendChild(build_api_manager(state));
    } else {
      section.appendChild(
        make_element('p', {
          class_name: 'launch_api_note',
          text: state.providers.length === 0
            ? 'Pick a model per seat below, or add an OpenAI/Anthropic-compatible endpoint with "Manage APIs".'
            : `${state.providers.length} third-party endpoint(s) are listed in the model menus of each seat. Use "Manage APIs" to change them.`,
        })
      );
    }
    return section;
  }

  function build_api_manager(state) {
    const wrap = make_element('div', { class_name: 'launch_api_manager' });
    if (state.providers.length > 0) {
      const list = make_element('div', { class_name: 'launch_api_list' });
      for (const provider of state.providers) {
        list.appendChild(build_api_row(state, provider));
      }
      wrap.appendChild(list);
    } else {
      wrap.appendChild(make_element('p', { class_name: 'launch_api_note', text: 'No endpoints stored yet.' }));
    }
    if (state.api_draft_open) {
      wrap.appendChild(build_api_form(state));
    } else {
      const add = make_element('button', {
        class_name: 'launch_api_add',
        text: '+ Add endpoint',
        attrs: { type: 'button', 'data-action': 'add_api' },
        on: { click: () => open_api_form(state, null) },
      });
      wrap.appendChild(add);
    }
    return wrap;
  }

  function build_api_row(state, provider) {
    const row = make_element('div', { class_name: 'launch_api_row', attrs: { 'data-provider-id': provider.id } });
    const name = make_element('span', { class_name: 'launch_api_name', text: provider.name });
    name.title = provider.name;
    const kind = make_element('span', { class_name: 'launch_api_kind', text: provider.kind });
    const url = make_element('span', { class_name: 'launch_api_url', text: provider.base_url || '(no base URL)' });
    url.title = provider.base_url || '';
    const count = make_element('span', {
      class_name: 'launch_api_models',
      text: `${provider.models.length} model${provider.models.length === 1 ? '' : 's'}`,
    });
    const edit = make_element('button', {
      class_name: 'launch_api_edit',
      attrs: { type: 'button', 'aria-label': `Edit ${provider.name}` },
      on: { click: () => open_api_form(state, provider.id) },
    });
    edit.appendChild(make_svg('launch_api_icon', '0 0 12 12', EDIT_SHAPES));
    const remove_button = make_element('button', {
      class_name: 'launch_api_remove',
      attrs: { type: 'button', 'aria-label': `Remove ${provider.name}` },
      on: { click: () => remove_api(state, provider.id) },
    });
    remove_button.appendChild(make_svg('launch_api_icon', '0 0 12 12', TRASH_SHAPES));
    const left = make_element('span', { class_name: 'launch_api_left' });
    left.append(name, kind, url, count);
    row.append(left, edit, remove_button);
    return row;
  }

  function build_api_form(state) {
    const draft = state.api_draft || { editing_id: null, name: '', kind: 'openai', base_url: '', api_key: '', models_text: '' };
    const form = make_element('div', { class_name: 'launch_api_form' });
    const name_input = make_element('input', {
      class_name: 'launch_api_input',
      attrs: {
        type: 'text', placeholder: 'Name (e.g. SigOpenRouter)', maxlength: '60',
        'aria-label': 'Endpoint name', 'data-focus-key': 'api_name',
      },
      on: { input: (event) => { state.api_draft.name = event.target.value; } },
    });
    name_input.value = draft.name;
    const kind_select = make_element('select', {
      class_name: 'launch_api_kind_select',
      attrs: { 'aria-label': 'Endpoint protocol' },
      on: { change: (event) => { state.api_draft.kind = event.target.value; } },
    });
    for (const kind of ['openai', 'anthropic']) {
      const option = make_element('option', { text: kind === 'openai' ? 'OpenAI-compatible' : 'Anthropic-compatible', attrs: { value: kind } });
      kind_select.appendChild(option);
    }
    kind_select.value = draft.kind === 'anthropic' ? 'anthropic' : 'openai';
    const url_input = make_element('input', {
      class_name: 'launch_api_input',
      attrs: {
        type: 'text', placeholder: 'Base URL (e.g. https://openrouter.ai/api/v1)',
        'aria-label': 'Base URL', 'data-focus-key': 'api_url',
      },
      on: { input: (event) => { state.api_draft.base_url = event.target.value; } },
    });
    url_input.value = draft.base_url;
    const key_input = make_element('input', {
      class_name: 'launch_api_input',
      attrs: {
        type: 'password', placeholder: 'API key (stored on this machine only)',
        'aria-label': 'API key', 'data-focus-key': 'api_key_input', autocomplete: 'off',
      },
      on: { input: (event) => { state.api_draft.api_key = event.target.value; } },
    });
    key_input.value = draft.api_key;
    const models_input = make_element('input', {
      class_name: 'launch_api_input',
      attrs: {
        type: 'text', placeholder: 'Models, comma separated (e.g. gpt-4o, deepseek-v3)',
        'aria-label': 'Models served by the endpoint', 'data-focus-key': 'api_models_input',
      },
      on: { input: (event) => { state.api_draft.models_text = event.target.value; } },
    });
    models_input.value = draft.models_text;
    const save_button = make_element('button', {
      class_name: 'launch_api_save',
      text: state.api_saving ? 'Saving…' : 'Save endpoint',
      attrs: { type: 'button', 'data-action': 'save_api' },
      on: { click: () => save_api(state) },
    });
    save_button.disabled = state.api_saving;
    const cancel_button = make_element('button', {
      class_name: 'launch_api_form_cancel',
      text: 'Cancel',
      attrs: { type: 'button', 'data-focus-key': 'api_form_cancel' },
      on: { click: () => close_api_form(state) },
    });
    const note = make_element('p', {
      class_name: 'launch_api_form_note',
      text: 'The env vars ANTHROPIC_*/OPENAI_* below are set inside the session, nothing is sent anywhere else.',
    });
    form.append(name_input, kind_select, url_input, key_input, models_input, note);
    const actions = make_element('div', { class_name: 'launch_api_actions' });
    actions.append(save_button, cancel_button);
    form.appendChild(actions);
    return form;
  }

  async function refresh_providers(state) {
    try {
      const providers = await window.hub.providers.list();
      if (state.closed) return;
      state.providers = Array.isArray(providers) ? providers : [];
      state.providers_failed = false;
      state.providers_error = '';
    } catch (error) {
      if (state.closed) return;
      state.providers_failed = true;
      state.providers_error = error_text(error);
    }
  }

  function toggle_manage_apis(state) {
    if (state.closed) return;
    state.managing_apis = !state.managing_apis;
    state.api_draft_open = false;
    state.api_draft = null;
    set_message(state, '', '');
    render(state);
  }

  function open_api_form(state, editing_id) {
    if (state.closed) return;
    const existing = editing_id ? state.providers.find((provider) => provider.id === editing_id) : null;
    state.api_draft_open = true;
    state.api_draft = existing
      ? { editing_id: existing.id, name: existing.name, kind: existing.kind, base_url: existing.base_url, api_key: existing.api_key, models_text: existing.models.join(', ') }
      : { editing_id: null, name: '', kind: 'openai', base_url: '', api_key: '', models_text: '' };
    render(state);
    focus_by_key(state, 'api_name');
  }

  function close_api_form(state) {
    if (state.closed) return;
    state.api_draft_open = false;
    state.api_draft = null;
    render(state);
  }

  async function save_api(state) {
    if (state.closed || state.api_saving) return;
    const draft = state.api_draft || {};
    const models = String(draft.models_text || '')
      .split(',')
      .map((model) => model.trim())
      .filter((model) => model !== '');
    const payload = {
      id: draft.editing_id || null,
      name: String(draft.name || '').trim(),
      kind: draft.kind === 'anthropic' ? 'anthropic' : 'openai',
      base_url: String(draft.base_url || '').trim(),
      api_key: String(draft.api_key || '').trim(),
      models,
    };
    if (!payload.name) {
      set_message(state, 'Give the endpoint a name first.', 'error');
      render(state);
      return;
    }
    if (!/^https?:\/\/.+/i.test(payload.base_url)) {
      set_message(state, 'The base URL must start with http:// or https://.', 'error');
      render(state);
      return;
    }
    state.api_saving = true;
    render_footer(state);
    try {
      await window.hub.providers.save(payload);
      if (state.closed) return;
      await refresh_providers(state);
      if (state.closed) return;
      state.api_draft_open = false;
      state.api_draft = null;
      set_message(state, '', '');
      render(state);
    } catch (error) {
      if (state.closed) return;
      set_message(state, `Could not save endpoint: ${error_text(error)}`, 'error');
      render(state);
    } finally {
      state.api_saving = false;
    }
  }

  async function remove_api(state, provider_id) {
    if (state.closed) return;
    try {
      await window.hub.providers.remove(provider_id);
      if (state.closed) return;
      await refresh_providers(state);
      if (state.closed) return;
      set_message(state, '', '');
      render(state);
    } catch (error) {
      if (state.closed) return;
      set_message(state, `Could not remove endpoint: ${error_text(error)}`, 'error');
      render(state);
    }
  }

  // Install hands the install command to on_launch as a single seat. The caller then destroys the page.
  function install_agent(state, agent_id) {
    if (state.closed || state.launched) return;
    const agent = find_catalog_agent(agent_id);
    if (!agent || !agent.install_command) return;
    const seat = { agent_id: INSTALL_ACTION, label: `Install ${agent.label}`, command: agent.install_command };
    state.launched = true;
    call_callback(state.on_launch, [[seat], { use_worktree: false }], 'launch failed');
  }

  // Install command of each agent that is not installed and has one, with a Copy button.
  // The text is shown in full so it can also be copied by hand.
  function build_install_hints(state) {
    const agents = catalog().filter((agent) => !is_installed(state, agent.id) && agent.install_command);
    if (agents.length === 0) return null;
    const list = make_element('div', { class_name: 'launch_install_hints' });
    for (const agent of agents) {
      const copied = state.copied_agent_id === agent.id;
      const row = make_element('div', {
        class_name: 'launch_install_hint',
        attrs: { 'data-install-hint-agent-id': agent.id },
      });
      const command = make_element('code', {
        class_name: 'launch_install_command',
        text: agent.install_command,
      });
      const copy_button = make_element('button', {
        class_name: copied ? 'launch_copy_button copied' : 'launch_copy_button',
        text: copied ? 'Copied' : 'Copy',
        attrs: {
          type: 'button',
          'data-action': 'copy_install',
          'data-install-agent-id': agent.id,
          'data-focus-key': `copy:${agent.id}`,
          'aria-label': `Copy the install command of ${agent.label}`,
        },
        on: { click: () => copy_install_command(state, agent.id) },
      });
      row.append(make_element('span', { class_name: 'launch_install_hint_label', text: `${agent.label}:` }), command, copy_button);
      list.appendChild(row);
    }
    return list;
  }

  async function copy_install_command(state, agent_id) {
    if (state.closed) return;
    const agent = find_catalog_agent(agent_id);
    if (!agent || !agent.install_command) return;
    try {
      await window.hub.clipboard.write_text(agent.install_command);
    } catch (error) {
      if (state.closed) return;
      set_message(state, `Could not copy: ${error_text(error)}`, 'error');
      render(state);
      return;
    }
    if (state.closed) return;
    state.copied_agent_id = agent_id;
    window.clearTimeout(state.copy_timer);
    state.copy_timer = window.setTimeout(() => {
      state.copy_timer = 0;
      if (state.closed || state.copied_agent_id !== agent_id) return;
      state.copied_agent_id = null;
      render(state);
    }, COPY_FEEDBACK_MS);
    render(state);
  }

  // Git worktree option, only for a workspace that is a git repository. Off by default.
  function build_worktree_section(state) {
    if (state.loading || !state.is_repo) return null;
    const section = make_element('section', { class_name: 'launch_section' });
    section.appendChild(make_element('h3', { class_name: 'launch_section_title', text: 'Git' }));
    const label = make_element('label', { class_name: 'launch_worktree' });
    const checkbox = make_element('input', {
      class_name: 'launch_worktree_check',
      attrs: { type: 'checkbox', 'data-action': 'toggle_worktree', 'data-focus-key': 'worktree' },
      on: {
        change: (event) => {
          state.use_worktree = event.target.checked === true;
        },
      },
    });
    checkbox.checked = state.use_worktree;
    label.append(checkbox, make_element('span', { text: 'Isolate each agent in its own git worktree' }));
    section.appendChild(label);
    section.appendChild(
      make_element('p', {
        class_name: 'launch_worktree_note',
        text: 'Each session gets its own folder and branch. A clean worktree is removed when its pane closes; one with changes is kept.',
      })
    );
    return section;
  }

  // ---- how many / will launch ----

  function build_count_section(state) {
    const section = make_element('section', { class_name: 'launch_section' });
    section.appendChild(make_element('h3', { class_name: 'launch_section_title', text: 'How many' }));
    const row = make_element('div', { class_name: 'launch_count_row' });
    for (const count of COUNT_CHOICES) {
      const active = count === state.lineup.length;
      const button = make_element('button', {
        class_name: active ? 'launch_count_button selected' : 'launch_count_button',
        text: String(count),
        attrs: {
          type: 'button',
          'data-count': String(count),
          'data-focus-key': `count:${count}`,
          'aria-pressed': String(active),
        },
        on: { click: () => set_count(state, count) },
      });
      button.disabled = state.loading;
      row.appendChild(button);
    }
    section.appendChild(row);
    return section;
  }

  // Growing copies the last seat (and its model choice); shrinking removes from the end.
  function set_count(state, count) {
    if (state.closed || state.loading) return;
    const next = state.lineup.slice(0, count);
    while (next.length < count) {
      next.push(next[next.length - 1] || TERMINAL_AGENT_ID);
    }
    state.lineup = next;
    const next_models = state.models.slice(0, count);
    while (next_models.length < count) {
      next_models.push(next_models[next_models.length - 1] || MODEL_DEFAULT);
    }
    state.models = next_models;
    state.selected_preset_id = null;
    set_message(state, '', '');
    render(state);
  }

  function build_seat_section(state) {
    const section = make_element('section', { class_name: 'launch_section' });
    section.appendChild(make_element('h3', { class_name: 'launch_section_title', text: 'Will launch' }));
    if (state.loading) return section;
    const list = make_element('ol', { class_name: 'launch_seat_list' });
    state.lineup.forEach((agent_id, index) => {
      list.appendChild(build_seat_row(state, agent_id, index));
    });
    section.appendChild(list);
    return section;
  }

  function build_seat_row(state, agent_id, index) {
    const agent = find_catalog_agent(agent_id);
    const row = make_element('li', { class_name: 'launch_seat_row', attrs: { 'data-seat-index': String(index) } });
    row.appendChild(make_element('span', { class_name: 'launch_seat_index', text: String(index + 1) }));
    row.appendChild(build_mark(agent, 'seat'));
    sync_models(state);
    const agent_select = make_element('select', {
      class_name: 'launch_seat_select',
      attrs: { 'aria-label': `Seat ${index + 1} agent`, 'data-focus-key': `seat:${index}` },
      on: { change: (event) => set_seat(state, index, event.target.value) },
    });
    for (const option_agent of installed_agents(state)) {
      agent_select.appendChild(make_element('option', { text: option_agent.label, attrs: { value: option_agent.id } }));
    }
    agent_select.value = agent_id;
    row.appendChild(agent_select);
    row.appendChild(model_options_for(state, agent_id, state.models[index]));
    return row;
  }

  function set_seat(state, index, agent_id) {
    if (state.closed || state.loading || !is_installed(state, agent_id)) return;
    const next = state.lineup.slice();
    next[index] = agent_id;
    state.lineup = next;
    state.selected_preset_id = null;
    // The model choice may not fit the new agent: keep provider choices with all seats, reset agent models.
    const previous_selection = String(state.models[index] || MODEL_DEFAULT);
    state.models[index] = previous_selection.startsWith('p:') ? previous_selection : MODEL_DEFAULT;
    set_message(state, '', '');
    render(state);
  }

  function build_message(state) {
    const element = make_element('div', { class_name: 'launch_message', attrs: { role: 'status' } });
    if (state.message_kind === 'error') element.classList.add('is_error');
    if (state.message_kind === 'notice') element.classList.add('is_notice');
    element.textContent = state.message_text;
    element.hidden = !state.message_text;
    return element;
  }

  // ---- launch / close ----

  // Fires on_launch once. A second click (or a click after launch) does nothing.
  function launch_lineup(state) {
    if (state.closed || state.loading || state.launched) return;
    sync_models(state);
    const seats = [];
    state.lineup.forEach((agent_id, index) => {
      const agent = find_catalog_agent(agent_id);
      if (!agent || !is_installed(state, agent_id)) return;
      const env = model_env_for_seat(state, agent_id, state.models[index]);
      const seat = { agent_id: agent.id, label: agent.label, command: agent.command };
      if (Object.keys(env).length > 0) seat.env = env;
      seats.push(seat);
    });
    if (seats.length === 0) {
      set_message(state, 'Choose an installed agent first.', 'error');
      render(state);
      return;
    }
    state.launched = true;
    render_footer(state);
    // The second argument is new; a callback that takes only seats keeps working.
    call_callback(state.on_launch, [seats, { use_worktree: state.is_repo && state.use_worktree }], 'launch failed');
  }

  function request_close(state) {
    if (state.closed || state.launched) return;
    call_callback(state.on_close, [], 'close failed');
  }

  function call_callback(callback, args, label) {
    try {
      callback(...args);
    } catch (error) {
      console.error(`${label}: ${error_text(error)}`);
    }
  }

  async function start_loading(state) {
    const [availability_result, presets_result, is_repo] = await Promise.all([
      load_availability(),
      load_presets(),
      load_repo_flag(state.workspace.path),
    ]);
    if (state.closed) return;
    state.availability = availability_result.availability;
    state.presets = presets_result.presets;
    state.is_repo = is_repo;
    state.loading = false;
    state.lineup = [default_agent_id(state)];
    state.models = [MODEL_DEFAULT];
    if (availability_result.failed) {
      set_message(state, 'Could not check installed agents. Only Terminal is available.', 'error');
    } else if (presets_result.failed) {
      set_message(state, `Could not load presets: ${presets_result.error_message}`, 'error');
    }
    render(state);
    await refresh_providers(state);
    if (state.closed) return;
    if (state.providers_failed) set_message(state, `Could not load APIs: ${state.providers_error}`, 'error');
    render(state);
  }

  function destroy_page(state) {
    if (state.closed) return;
    state.closed = true;
    window.clearTimeout(state.copy_timer);
    state.root.remove();
  }

  window.mount_launch_page = function mount_launch_page(options) {
    const opts = options || {};
    if (!opts.container || typeof opts.container.appendChild !== 'function') {
      throw new Error('mount_launch_page needs a container element');
    }
    const workspace = opts.workspace || { id: '', name: 'Workspace', path: '' };
    const state = create_state({
      container: opts.container,
      workspace: { ...workspace, name: workspace.name || 'Workspace' },
      on_launch: typeof opts.on_launch === 'function' ? opts.on_launch : () => {},
      on_close: typeof opts.on_close === 'function' ? opts.on_close : () => {},
    });
    build_page(state);
    opts.container.appendChild(state.root);
    render(state);
    start_loading(state);
    return {
      destroy: () => destroy_page(state),
    };
  };
})();
