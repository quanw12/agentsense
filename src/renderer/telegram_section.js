// Telegram section of the mobile access panel. Classic script.
// Contract: window.init_telegram_section({ request_render }) -> { refresh(), build() }.
// The panel re-renders every 2 s, so the token field is one kept element: its text and focus survive each render.
(function telegram_section_module() {
  const CONFIRM_TIMEOUT_MS = 4000;

  function create_element(tag, class_name, text) {
    const element = document.createElement(tag);
    if (class_name) element.className = class_name;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function build_button(label, class_name, on_click) {
    const button = create_element('button', class_name, label);
    button.type = 'button';
    button.addEventListener('click', on_click);
    return button;
  }

  function build_switch(id, checked, label, on_change) {
    const row = create_element('label', 'mobile_switch_row');
    row.htmlFor = id;
    const input = create_element('input', 'mobile_switch');
    input.type = 'checkbox';
    input.id = id;
    input.checked = Boolean(checked);
    input.addEventListener('change', () => on_change(input.checked));
    row.append(input, create_element('span', 'mobile_switch_label', label));
    return row;
  }

  function init_telegram_section(options) {
    const request_render = options.request_render;
    const state = { snapshot: null, busy: false, armed: null, armed_timer: null, error: null };

    const token_input = create_element('input', 'telegram_token_input');
    token_input.type = 'password';
    token_input.placeholder = '123456789:AA…';
    token_input.autocomplete = 'off';
    token_input.spellcheck = false;
    token_input.dataset.focus_key = 'telegram_token';
    token_input.setAttribute('aria-label', 'Bot token from BotFather');

    async function call(action) {
      if (state.busy) return;
      state.busy = true;
      state.error = null;
      try {
        state.snapshot = await action();
      } catch (error) {
        // Electron prefixes invoke errors with the channel; only the reason is for the user.
        state.error = String(error && error.message ? error.message : error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      } finally {
        state.busy = false;
        request_render();
      }
    }

    async function refresh() {
      if (state.busy) return;
      try {
        state.snapshot = await window.hub.telegram.get_state();
      } catch (error) {
        console.error('telegram state failed:', error);
      }
    }

    // First click arms a destructive button, like "Rotate pairing token".
    function arm_or_run(id, action) {
      if (state.armed_timer !== null) window.clearTimeout(state.armed_timer);
      state.armed_timer = null;
      if (state.armed === id) {
        state.armed = null;
        call(action);
        return;
      }
      state.armed = id;
      state.armed_timer = window.setTimeout(() => {
        state.armed = null;
        state.armed_timer = null;
        request_render();
      }, CONFIRM_TIMEOUT_MS);
      request_render();
    }

    function save_token() {
      const value = token_input.value;
      call(async () => {
        const next = await window.hub.telegram.set_token(value);
        token_input.value = '';
        return next;
      });
    }

    function build_token_form(section) {
      const steps = create_element('ol', 'telegram_steps');
      steps.append(
        create_element('li', '', 'In Telegram, open @BotFather and send /newbot.'),
        create_element('li', '', 'Paste the token it gives you here.')
      );
      const row = create_element('div', 'telegram_token_row');
      row.append(token_input, build_button('Save', 'mobile_url_copy', save_token));
      section.append(steps, row);
    }

    function status_text(snapshot) {
      if (snapshot.state === 'online') return `Online as @${snapshot.username || 'bot'}`;
      if (snapshot.state === 'connecting') return 'Connecting…';
      if (snapshot.state === 'error') return snapshot.error || 'Not connected';
      return 'Off';
    }

    function build_pairing(section, snapshot) {
      if (snapshot.paired) {
        const row = create_element('div', 'telegram_paired_row');
        row.append(create_element('span', 'mobile_switch_label', `Paired with ${snapshot.owner_name || 'your account'}`));
        const armed = state.armed === 'unpair';
        const button = build_button(armed ? 'Confirm: unpair' : 'Unpair', 'mobile_rotate', () =>
          arm_or_run('unpair', () => window.hub.telegram.unpair())
        );
        button.classList.toggle('confirming', armed);
        row.append(button);
        section.append(row);
        return;
      }
      if (snapshot.pair_code) {
        const command = `/pair ${snapshot.pair_code}`;
        const row = create_element('div', 'mobile_url_row');
        const text = create_element('div', 'mobile_url_text');
        text.append(
          create_element('span', 'mobile_url_label', 'Send this to your bot in Telegram. It works once, for 10 minutes.'),
          create_element('code', 'mobile_url_value', command)
        );
        row.append(
          text,
          build_button('Copy', 'mobile_url_copy', () => {
            try {
              window.hub.clipboard.write_text(command);
            } catch (error) {
              console.error('copy failed:', error);
            }
          })
        );
        section.append(row);
        return;
      }
      if (snapshot.state === 'online') {
        section.append(build_button('Get pairing code', 'mobile_rotate', () => call(() => window.hub.telegram.new_pair_code())));
      }
    }

    function build() {
      const section = create_element('section', 'mobile_body telegram_section');
      section.append(create_element('h3', 'telegram_title', 'Telegram bot'));
      section.append(
        create_element(
          'p',
          'mobile_note',
          'Control your panes from Telegram on any network, without a VPN. This PC has to stay on, online and running AgentSense.'
        )
      );

      const snapshot = state.snapshot;
      if (!snapshot) return section;

      if (!snapshot.has_token) {
        build_token_form(section);
      } else {
        const enable_row = create_element('div', 'mobile_enable_row');
        enable_row.append(
          build_switch('telegram_enabled', snapshot.enabled, 'Enable Telegram bot', (value) => {
            call(() => window.hub.telegram.set_enabled(value));
          })
        );
        if (snapshot.enabled) enable_row.append(create_element('span', 'mobile_running', status_text(snapshot)));
        section.append(enable_row);

        if (snapshot.enabled) build_pairing(section, snapshot);

        const toggles = create_element('div', 'mobile_toggles');
        toggles.append(
          build_switch('telegram_notify', snapshot.notify, 'Notify me when an agent finishes or needs me', (value) => {
            call(() => window.hub.telegram.set_notify(value));
          }),
          build_switch('telegram_keep_awake', snapshot.keep_awake, 'Keep the PC awake while the bot is on', (value) => {
            call(() => window.hub.telegram.set_keep_awake(value));
          })
        );
        section.append(toggles);

        const armed = state.armed === 'remove';
        const remove = build_button(armed ? 'Confirm: remove token' : 'Remove bot token', 'mobile_rotate', () =>
          arm_or_run('remove', () => window.hub.telegram.clear_token())
        );
        remove.classList.toggle('confirming', armed);
        section.append(remove);
      }

      if (state.error) {
        const error = create_element('p', 'telegram_error', state.error);
        error.setAttribute('role', 'alert');
        section.append(error);
      }

      section.append(
        create_element(
          'p',
          'mobile_note',
          'Whoever is paired can run anything on this PC through your agents. Screens, diffs and files you open pass through ' +
            'Telegram’s servers and are not end-to-end encrypted, so avoid this for code or secrets that must stay private. ' +
            '/cat refuses common credentials files, but agent output and diffs are not filtered.'
        )
      );
      return section;
    }

    return { refresh, build };
  }

  window.init_telegram_section = init_telegram_section;
})();
