// Turns a pane's raw output into the text a person sees on its screen. Agents redraw constantly with cursor
// moves, so the stream itself cannot be shown in a chat: it is replayed into a headless xterm and the visible
// rows are read back. Each call is one short-lived terminal; a pane keeps at most 200 KB of replay buffer.
const MAX_BLANK_RUN = 1;

// Trailing spaces go, and long blank runs collapse: a phone has no room for a mostly empty TUI.
function compact_rows(rows) {
  const result = [];
  let blank_run = 0;
  for (const row of rows) {
    const text = row.replace(/\s+$/, '');
    if (text === '') {
      blank_run += 1;
      if (blank_run > MAX_BLANK_RUN) continue;
    } else {
      blank_run = 0;
    }
    result.push(text);
  }
  while (result.length > 0 && result[0] === '') result.shift();
  while (result.length > 0 && result[result.length - 1] === '') result.pop();
  return result.join('\n');
}

// Resolves with { text, bracketed_paste }. bracketed_paste says whether the pane's program asked for it.
function render_screen(buffer, cols, rows) {
  const { Terminal } = require('@xterm/headless');
  const term = new Terminal({
    cols: Number.isInteger(cols) && cols > 0 ? cols : 80,
    rows: Number.isInteger(rows) && rows > 0 ? rows : 24,
    scrollback: 0,
    allowProposedApi: true,
  });
  return new Promise((resolve) => {
    term.write(typeof buffer === 'string' ? buffer : '', () => {
      const active = term.buffer.active;
      const lines = [];
      for (let index = 0; index < term.rows; index += 1) {
        const line = active.getLine(active.baseY + index);
        lines.push(line ? line.translateToString(true) : '');
      }
      const result = { text: compact_rows(lines), bracketed_paste: term.modes.bracketedPasteMode === true };
      term.dispose();
      resolve(result);
    });
  });
}

module.exports = { render_screen, compact_rows };
