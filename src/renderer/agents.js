// Agent catalog for the launch page (renderer) and the mobile UI (mobile_server.js serves this same file to
// the phone and the Electron main process require()s it to validate pane creation, so the data lives once).
// Classic script in the browser: defines window.AGENT_CATALOG and window.find_agent. In Node, module.exports
// is the catalog array. Entries: { id, label, command, install_command, glyph, logo } (SPEC.md Phase 2c).
// logo is a path relative to index.html, or null when no real logo is available (glyph is used then).
// Optional launch_command is the full command line a pane starts with; terminal_grid.js uses launch_command || command.
// command stays the bare executable name that agents:check looks up.
// Optional models lists the agent's own model options (ids are sent as <agent>_MODEL / ANTHROPIC_MODEL env).
(function (root, factory) {
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  if (!root) return;
  if (root.AGENT_CATALOG) return;
  root.AGENT_CATALOG = catalog;
  root.find_agent = function find_agent(agent_id) {
    const found = catalog.find((agent) => agent.id === agent_id);
    return found || null;
  };
})(typeof window !== 'undefined' ? window : null, function () {
  return [
    { id: 'claude', label: 'Claude Code', command: 'claude', install_command: 'npm i -g @anthropic-ai/claude-code', glyph: 'CC', logo: 'assets/agents/claude.svg', models: ['sonnet', 'opus', 'haiku'] },
    { id: 'codex', label: 'Codex', command: 'codex', install_command: 'npm i -g @openai/codex', glyph: 'CX', logo: 'assets/agents/codex.svg', models: ['gpt-5.1-codex', 'gpt-5.1', 'o4-mini'] },
    { id: 'gemini', label: 'Gemini CLI', command: 'gemini', install_command: 'npm i -g @google/gemini-cli', glyph: 'GE', logo: null, models: [], note: 'Enterprise Code Assist / API keys; personal Google plans use Antigravity CLI.' },
    { id: 'copilot', label: 'GitHub Copilot', command: 'copilot', install_command: 'npm i -g @github/copilot', glyph: 'GH', logo: null, models: [], note: 'Requires Node.js 22+ and PowerShell 6+ on Windows.' },
    { id: 'pi', label: 'Pi', command: 'pi', install_command: 'npm i -g --ignore-scripts @earendil-works/pi-coding-agent', glyph: 'π', logo: null, models: [], note: 'Requires Node.js 22.19+.' },
    { id: 'hermes', label: 'Hermes Agent', command: 'hermes', install_command: 'powershell -NoProfile -Command "iex (irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1)"', glyph: 'HE', logo: null, models: [] },
    { id: 'cursor', label: 'Cursor Agent', command: 'cursor-agent', install_command: null, glyph: 'CU', logo: 'assets/agents/cursor.svg', models: [] },
    { id: 'droid', label: 'Droid', command: 'droid', install_command: null, glyph: 'DR', logo: 'assets/agents/droid.svg', models: [] },
    { id: 'opencode', label: 'OpenCode', command: 'opencode', install_command: 'npm i -g opencode-ai', glyph: 'OC', logo: 'assets/agents/opencode.svg', models: [] },
    { id: 'deepseek', label: 'DeepSeek Harness', command: 'dsh', launch_command: 'dsh web --port 0', install_command: null, glyph: 'DS', logo: 'assets/agents/deepseek.svg', models: [] },
    { id: 'grok', label: 'Grok Build', command: 'grok', install_command: null, glyph: 'GR', logo: 'assets/agents/grok.svg', models: [] },
    { id: 'kimi', label: 'Kimi Code', command: 'kimi', install_command: null, glyph: 'KI', logo: 'assets/agents/kimi.svg', models: [] },
    { id: 'antigravity', label: 'Antigravity CLI', command: 'agy', install_command: 'powershell -NoProfile -Command "irm https://antigravity.google/cli/install.ps1 | iex"', glyph: 'AG', logo: 'assets/agents/antigravity.svg', models: [] },
    { id: 'terminal', label: 'Terminal', command: 'powershell.exe', install_command: null, glyph: 'PS', logo: 'assets/agents/terminal.svg', models: [] },
  ];
});
