// Mobile access overlay: turn remote access on, pair the phone with the QR / link, and choose how far the
// server reaches. Covers the main area (right of the sidebar), same pattern as dashboard.js. Classic script.
// Contract: window.init_mobile_panel({ on_toggle }) -> { open(), close(), is_open(), toggle() }.
// State comes from hub.mobile.get_state(); every change is one hub.mobile call, then the state re-renders.
// While open, the state is polled every 2 s, so the connected-phone count and the URLs stay current.
(function mobile_panel_module() {
  const OVERLAY_ID = 'mobile_panel_overlay';
  const CONFIRM_TIMEOUT_MS = 4000;
  const POLL_MS = 2000;
  const CLOSE_ICON =
    '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">' +
    '<path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>';

  function create_element(tag, class_name, text) {
    const element = document.createElement(tag);
    if (class_name) element.className = class_name;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  // A labelled switch row. The checkbox carries the state; the label text explains what it does.
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

  function init_mobile_panel(options) {
    const opts = options || {};
    const on_toggle = typeof opts.on_toggle === 'function' ? opts.on_toggle : () => {};

    const state = {
      open: false,
      root: null,
      confirm_pending: false,
      confirm_timer: null,
      poll_timer: null,
      return_focus: null,
      last_state: null,
      busy: false,
    };

    // Lives in its own module; a missing one only hides the section.
    const telegram = typeof window.init_telegram_section === 'function'
      ? window.init_telegram_section({ request_render: () => render() })
      : null;

    async function call_hub(action) {
      if (state.busy) return;
      state.busy = true;
      try {
        state.last_state = await action();
      } catch (error) {
        console.error('mobile panel call failed:', error);
        window.alert(`Mobile access failed: ${error && error.message ? error.message : error}`);
      } finally {
        state.busy = false;
        render();
      }
    }

    async function refresh() {
      try {
        state.last_state = await window.hub.mobile.get_state();
      } catch (error) {
        console.error('mobile state failed:', error);
        return;
      }
      if (telegram) await telegram.refresh();
      render();
    }

    function clear_confirm() {
      if (state.confirm_timer !== null) {
        window.clearTimeout(state.confirm_timer);
        state.confirm_timer = null;
      }
      state.confirm_pending = false;
    }

    function on_rotate_click() {
      if (!state.confirm_pending) {
        // First click arms the button, like the dashboard's "Close idle".
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
      call_hub(() => window.hub.mobile.rotate_token());
    }

    function copy_url(url) {
      try {
        window.hub.clipboard.write_text(url);
      } catch (error) {
        console.error('copy failed:', error);
      }
    }

    function build_url_row(entry) {
      const row = create_element('div', 'mobile_url_row');
      const text = create_element('div', 'mobile_url_text');
      const label = entry.label || 'Network';
      text.append(create_element('span', 'mobile_url_label', entry.in_qr ? `${label} · in the QR code` : label));
      const code = create_element('code', 'mobile_url_value', entry.url);
      code.title = entry.url;
      text.append(code);
      const copy = create_element('button', 'mobile_url_copy', 'Copy');
      copy.type = 'button';
      copy.title = 'Copy the pairing link';
      copy.addEventListener('click', () => copy_url(entry.url));
      row.append(text, copy);
      return row;
    }

    // Shown instead of the QR and links while the server only listens on this PC: a phone could not use them.
    function build_loopback_callout() {
      const callout = create_element('div', 'mobile_callout');
      callout.setAttribute('role', 'status');
      callout.append(
        create_element('p', 'mobile_callout_title', 'Your phone cannot connect yet'),
        create_element(
          'p',
          'mobile_callout_text',
          'Mobile access is listening on this computer only. Turn on “Reachable from other devices” below to get a QR code and links for your phone.'
        )
      );
      return callout;
    }

    function build_pairing(body, snapshot) {
      const urls = Array.isArray(snapshot.urls) ? snapshot.urls : [];
      if (snapshot.qr_svg) {
        const pair = create_element('div', 'mobile_pair');
        const qr = create_element('div', 'mobile_qr');
        qr.innerHTML = snapshot.qr_svg; // trusted: generated locally by the qrcode package
        pair.append(qr);
        const hint = create_element('div', 'mobile_pair_hint');
        const fallback = urls.length > 1 ? ' If it does not connect, open another link below.' : '';
        hint.append(
          create_element(
            'p',
            'mobile_pair_text',
            `Scan with your phone on the same network. The QR code uses ${snapshot.qr_label || 'the first link'}.${fallback} The links contain the pairing token.`
          )
        );
        pair.append(hint);
        body.append(pair);
      } else if (urls.length > 0) {
        body.append(
          create_element(
            'p',
            'mobile_note',
            'None of these addresses looks reachable from a phone, so there is no QR code. Connect this PC to Wi-Fi or Tailscale, or try a link below.'
          )
        );
      } else {
        body.append(create_element('p', 'mobile_note', 'No network address found yet — connect to Wi-Fi or Tailscale.'));
      }

      if (urls.length > 0) {
        const list = create_element('div', 'mobile_urls');
        for (const entry of urls) list.append(build_url_row(entry));
        body.append(list);
      }
    }

    function build_body(snapshot) {
      const body = create_element('div', 'mobile_body');

      const enable_row = create_element('div', 'mobile_enable_row');
      enable_row.append(
        build_switch('mobile_enabled', snapshot.enabled, 'Enable mobile access', (value) => {
          clear_confirm();
          call_hub(() => window.hub.mobile.set_enabled(value));
        })
      );
      if (snapshot.enabled && snapshot.running) {
        enable_row.append(
          create_element(
            'span',
            'mobile_running',
            `Running on port ${snapshot.port} · ${snapshot.clients} connected`
          )
        );
      } else if (snapshot.enabled) {
        enable_row.append(create_element('span', 'mobile_running', 'Starting…'));
      }
      body.append(enable_row);

      if (!snapshot.enabled) {
        body.append(
          create_element(
            'p',
            'mobile_note',
            'Pair your phone to watch and drive the sessions on this PC from its browser. ' +
              'The QR code and link only work while mobile access is on.'
          )
        );
        return body;
      }

      if (snapshot.running) {
        if (snapshot.scope === 'loopback') body.append(build_loopback_callout());
        else build_pairing(body, snapshot);
      }

      const toggles = create_element('div', 'mobile_toggles');
      toggles.append(
        build_switch(
          'mobile_bind_all',
          snapshot.bind_all,
          'Reachable from other devices (Wi-Fi / Tailscale)',
          (value) => {
            clear_confirm();
            call_hub(() => window.hub.mobile.set_bind_all(value));
          }
        ),
        build_switch('mobile_keep_awake', snapshot.keep_awake, 'Keep the PC awake while mobile access is on', (value) => {
          clear_confirm();
          call_hub(() => window.hub.mobile.set_keep_awake(value));
        })
      );
      body.append(toggles);

      const rotate = create_element('button', 'mobile_rotate');
      rotate.type = 'button';
      const confirming = state.confirm_pending;
      rotate.classList.toggle('confirming', confirming);
      rotate.textContent = confirming ? 'Confirm: rotate token' : 'Rotate pairing token';
      rotate.title = 'Invalidates the old QR and link; every phone has to pair again';
      rotate.addEventListener('click', on_rotate_click);
      body.append(rotate);

      body.append(
        create_element(
          'p',
          'mobile_note',
          (snapshot.scope_note || 'Mobile access stays on this LAN or a VPN. It is not a public internet service.') +
            ' First start may ask to allow AgentSense through Windows Firewall — allow it on private networks. ' +
            'Away from home, install Tailscale on this PC and your phone and keep “Reachable from other devices” on; ' +
            'do not port-forward this page to the internet.'
        )
      );
      return body;
    }

    function render() {
      const root = state.root;
      if (!root) return;
      const focused = document.activeElement;
      const focus_key = focused && root.contains(focused) && focused.dataset ? focused.dataset.focus_key : undefined;

      const snapshot = state.last_state || {
        enabled: false,
        running: false,
        port: null,
        bind_all: false,
        keep_awake: false,
        token: '',
        urls: [],
        qr_svg: null,
        clients: 0,
      };

      const header = create_element('header', 'mobile_header');
      const inner = create_element('div', 'mobile_header_inner');
      const title_wrap = create_element('div', 'mobile_title_wrap');
      title_wrap.append(create_element('h2', 'mobile_title', 'Mobile access'));
      inner.append(title_wrap);
      const close_button = create_element('button', 'mobile_close');
      close_button.type = 'button';
      close_button.dataset.focus_key = 'close';
      close_button.title = 'Close (Esc)';
      close_button.setAttribute('aria-label', 'Close mobile access panel');
      close_button.innerHTML = CLOSE_ICON;
      close_button.addEventListener('click', () => close());
      inner.append(close_button);
      header.append(inner);

      const body_wrap = create_element('div', 'mobile_body_wrap');
      body_wrap.append(build_body(snapshot));
      if (telegram) body_wrap.append(telegram.build());

      root.replaceChildren(header, body_wrap);

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

    function start_polling() {
      stop_polling();
      state.poll_timer = window.setInterval(() => {
        if (!state.busy) refresh();
      }, POLL_MS);
    }

    function stop_polling() {
      if (state.poll_timer !== null) {
        window.clearInterval(state.poll_timer);
        state.poll_timer = null;
      }
    }

    function open() {
      if (state.open) {
        refresh();
        return;
      }
      state.open = true;
      state.return_focus = document.activeElement;
      const root = create_element('div');
      root.id = OVERLAY_ID;
      root.className = 'mobile_overlay';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-label', 'Mobile access');
      root.tabIndex = -1;
      state.root = root;
      document.body.append(root);
      document.addEventListener('keydown', on_key_down, true);
      refresh();
      start_polling();
      root.focus();
      on_toggle(true);
    }

    function close() {
      if (!state.open) return;
      state.open = false;
      clear_confirm();
      stop_polling();
      document.removeEventListener('keydown', on_key_down, true);
      if (state.root) state.root.remove();
      state.root = null;
      const previous = state.return_focus;
      state.return_focus = null;
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus();
      on_toggle(false);
    }

    function toggle() {
      if (state.open) close();
      else open();
    }

    return { open, close, is_open: () => state.open, toggle };
  }

  window.init_mobile_panel = init_mobile_panel;
})();
