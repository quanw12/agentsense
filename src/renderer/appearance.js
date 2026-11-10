// Theme preference for the workbench. Dark stays the default so an existing window looks the same.
// Light and the Windows color mode only swap the tokens in styles.css. Nothing here starts a process.
(function appearance_module() {
  const STORAGE_KEY = 'agentsense.appearance';
  const DEFAULT_ACCENT = '#5b8def';
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const ACCENT_PRESETS = [
    { id: 'blue', label: 'Blue', hex: '#5b8def' },
    { id: 'green', label: 'Green', hex: '#3fb950' },
    { id: 'amber', label: 'Amber', hex: '#d9a441' },
    { id: 'violet', label: 'Violet', hex: '#c678dd' },
  ];

  function normalize(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const mode = source.mode === 'light' || source.mode === 'system' ? source.mode : 'dark';
    const accent = typeof source.accent === 'string' && HEX.test(source.accent.trim())
      ? source.accent.trim().toLowerCase()
      : DEFAULT_ACCENT;
    return { mode, accent };
  }

  function resolved_theme(pref, system_is_light) {
    if (!pref || pref.mode !== 'system') return pref && pref.mode === 'light' ? 'light' : 'dark';
    return system_is_light ? 'light' : 'dark';
  }

  function read() {
    try {
      return normalize(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null'));
    } catch (error) {
      return normalize(null);
    }
  }

  function system_is_light() {
    try {
      return window.matchMedia('(prefers-color-scheme: light)').matches;
    } catch (error) {
      return false;
    }
  }

  // Writes the attributes styles.css already understands. Terminals listen for the event and recolor in place.
  function apply(pref) {
    const next = normalize(pref);
    const root = document.documentElement;
    root.dataset.theme = next.mode;
    root.dataset.themeResolved = resolved_theme(next, system_is_light());
    root.style.setProperty('--accent', next.accent);
    document.dispatchEvent(new CustomEvent('agentsense:appearance'));
    return next;
  }

  function write(pref) {
    const next = normalize(pref);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      // The choice still applies for this window when storage is blocked.
    }
    return apply(next);
  }

  try {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const on_system = () => {
      if (read().mode === 'system') apply(read());
    };
    if (typeof media.addEventListener === 'function') media.addEventListener('change', on_system);
  } catch (error) {
    // Without a media query the saved mode still applies once, below.
  }

  try {
    apply(read());
  } catch (error) {
    console.error('appearance apply failed:', error);
  }

  window.agentsense_appearance = {
    normalize,
    resolved_theme,
    read,
    write,
    apply,
    presets: ACCENT_PRESETS,
    default_accent: DEFAULT_ACCENT,
    storage_key: STORAGE_KEY,
  };
})();
