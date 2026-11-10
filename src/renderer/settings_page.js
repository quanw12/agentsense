// Appearance page. It covers the workbench and does not unmount terminals, files, or the squad.
(function settings_page_module() {
  const MODES = [
    { id: 'dark', label: 'Dark', detail: 'The current look. Black workbench, light text.' },
    { id: 'light', label: 'Light', detail: 'White workbench and dark text.' },
    { id: 'system', label: 'Windows', detail: 'Follows the Windows color mode.' },
  ];

  let overlay = null;
  let return_focus = null;
  let color_timer = 0;

  function el(tag, class_name, text) {
    const node = document.createElement(tag);
    if (class_name) node.className = class_name;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function api() {
    return window.agentsense_appearance || null;
  }

  function close_settings() {
    window.clearTimeout(color_timer);
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    if (return_focus && typeof return_focus.focus === 'function') return_focus.focus();
    return_focus = null;
  }

  function sync_controls(root, pref) {
    const mode_inputs = root.querySelectorAll('input[name="appearance_mode"]');
    for (const input of mode_inputs) input.checked = input.value === pref.mode;
    const swatches = root.querySelectorAll('.set_swatch');
    for (const swatch of swatches) {
      const on = swatch.dataset.hex === pref.accent;
      swatch.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const picker = root.querySelector('.set_color');
    if (picker && /^#[0-9a-fA-F]{6}$/.test(pref.accent)) picker.value = pref.accent;
  }

  function commit(root, patch) {
    const appearance = api();
    if (!appearance) return;
    const next = appearance.write(Object.assign({}, appearance.read(), patch));
    sync_controls(root, next);
  }

  function build() {
    const appearance = api();
    const root = el('div', 'set_overlay');
    root.tabIndex = -1;
    const dialog = el('div', 'set_dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'set_title');

    const head = el('div', 'set_head');
    const titles = el('div', 'set_titles');
    titles.append(
      el('h2', 'set_title', 'Appearance'),
      el('p', 'set_lead', 'Colors only. Open terminals, files, and chats stay where they are.')
    );
    const close_btn = el('button', 'set_close', 'Close');
    close_btn.type = 'button';
    close_btn.addEventListener('click', () => close_settings());
    head.append(titles, close_btn);

    const mode_block = el('fieldset', 'set_block');
    mode_block.append(el('legend', 'set_legend', 'Mode'));
    const modes = el('div', 'set_modes');
    for (const mode of MODES) {
      const label = el('label', 'set_mode');
      const input = el('input');
      input.type = 'radio';
      input.name = 'appearance_mode';
      input.value = mode.id;
      const copy = el('span', 'set_mode_copy');
      copy.append(el('span', 'set_mode_label', mode.label), el('span', 'set_mode_detail', mode.detail));
      label.append(input, copy);
      input.addEventListener('change', () => {
        if (input.checked) commit(root, { mode: mode.id });
      });
      modes.append(label);
    }
    mode_block.append(modes);

    const color_block = el('div', 'set_block');
    color_block.append(el('h3', 'set_legend', 'Accent'));
    const swatches = el('div', 'set_swatches');
    const presets = appearance ? appearance.presets : [];
    for (const preset of presets) {
      const button = el('button', 'set_swatch', preset.label);
      button.type = 'button';
      button.dataset.hex = preset.hex;
      button.style.setProperty('--swatch', preset.hex);
      button.addEventListener('click', () => commit(root, { accent: preset.hex }));
      swatches.append(button);
    }
    const custom = el('label', 'set_custom');
    const picker = el('input', 'set_color');
    picker.type = 'color';
    picker.value = appearance ? appearance.read().accent : '#5b8def';
    picker.addEventListener('input', () => {
      const value = picker.value;
      window.clearTimeout(color_timer);
      color_timer = window.setTimeout(() => commit(root, { accent: value }), 80);
    });
    custom.append(picker, el('span', '', 'Custom'));
    swatches.append(custom);
    color_block.append(swatches);

    const preview = el('div', 'set_preview');
    preview.append(
      el('span', 'set_preview_bar', 'Preview'),
      el('span', 'set_preview_text', 'Workbench text'),
      el('span', 'set_preview_muted', 'Secondary text')
    );
    const accent_chip = el('span', 'set_preview_accent', 'Accent');
    preview.append(accent_chip);

    const note = el(
      'p',
      'set_note',
      'A bot screen in Squad stays dark so its terminal text stays readable. The choice is saved on this PC only.'
    );

    const reset = el('button', 'set_reset', 'Reset to dark');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      if (!appearance) return;
      commit(root, { mode: 'dark', accent: appearance.default_accent });
    });

    dialog.append(head, mode_block, color_block, preview, note, reset);
    root.append(dialog);

    root.addEventListener('click', (event) => {
      if (event.target === root) close_settings();
    });
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close_settings();
    });
    if (appearance) sync_controls(root, appearance.read());
    return root;
  }

  function open_settings() {
    if (!api()) return;
    if (overlay) {
      overlay.focus();
      return;
    }
    return_focus = document.activeElement;
    overlay = build();
    document.body.append(overlay);
    overlay.focus();
  }

  window.open_settings = open_settings;
})();
