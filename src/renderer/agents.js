// Agent catalog for the launch page. Classic script: defines window.AGENT_CATALOG and
// window.find_agent. Entries: { id, label, command, install_command, glyph, logo } (SPEC.md Phase 2c).
// logo is a path relative to index.html, or null when no real logo is available (glyph is used then).
// Optional launch_command is the full command line a pane starts with; terminal_grid.js uses launch_command || command.
// command stays the bare executable name that agents:check looks up.
(function () {
  if (window.AGENT_CATALOG) return;

  window.AGENT_CATALOG = [
    { id: 'claude', label: 'Claude Code', command: 'claude', install_command: 'npm i -g @anthropic-ai/claude-code', glyph: 'CC', logo: 'assets/agents/claude.svg' },
    { id: 'codex', label: 'Codex', command: 'codex', install_command: 'npm i -g @openai/codex', glyph: 'CX', logo: 'assets/agents/codex.svg' },
    { id: 'cursor', label: 'Cursor Agent', command: 'cursor-agent', install_command: null, glyph: 'CU', logo: 'assets/agents/cursor.svg' },
    { id: 'droid', label: 'Droid', command: 'droid', install_command: null, glyph: 'DR', logo: 'assets/agents/droid.svg' },
    { id: 'opencode', label: 'OpenCode', command: 'opencode', install_command: 'npm i -g opencode-ai', glyph: 'OC', logo: 'assets/agents/opencode.svg' },
    { id: 'deepseek', label: 'DeepSeek Harness', command: 'dsh', launch_command: 'dsh web --port 0', install_command: null, glyph: 'DS', logo: 'assets/agents/deepseek.svg' },
    { id: 'grok', label: 'Grok Build', command: 'grok', install_command: null, glyph: 'GR', logo: 'assets/agents/grok.svg' },
    { id: 'kimi', label: 'Kimi Code', command: 'kimi', install_command: null, glyph: 'KI', logo: 'assets/agents/kimi.svg' },
    { id: 'antigravity', label: 'Antigravity CLI', command: 'agy', install_command: 'powershell -NoProfile -Command "irm https://antigravity.google/cli/install.ps1 | iex"', glyph: 'AG', logo: 'assets/agents/antigravity.svg' },
    { id: 'terminal', label: 'Terminal', command: 'powershell.exe', install_command: null, glyph: 'PS', logo: 'assets/agents/terminal.svg' },
  ];

  window.find_agent = function find_agent(agent_id) {
    const found = window.AGENT_CATALOG.find((agent) => agent.id === agent_id);
    return found || null;
  };
})();
