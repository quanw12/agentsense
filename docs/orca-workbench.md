# AgentSense workbench — comparison with Orca

Checked on 2026-11-02, starting from `origin/main` at `b114352`.
Uses the structure of [stablyai/orca](https://github.com/stablyai/orca) at
`c05ce970eb8bd147360db9ae5f948d195df6202b` and three user-provided screenshots as reference.
The existing dark UI is kept; everything is implemented with AgentSense's own Electron,
vanilla JS, xterm.js and node-pty stack. No framework or Orca source code is brought into the app.

| Feature in the screenshots | AgentSense after this change | Usage / limits |
| --- | --- | --- |
| File tree on the right, toggle button on the right edge | Implemented | Files / Ctrl+Shift+E; drag the divider to resize; state is remembered across reload/restart |
| Clicking a file opens it in the workspace next to the terminals | Implemented | A new file splits below the selected pane; clicking again reuses the existing tab |
| Switching between files and agents with tabs | Implemented | Tab view / Split view; Ctrl+Tab, Ctrl+Shift+Tab; arrow keys/Home/End when the tab bar has focus |
| Split, resize and maximize terminals | Kept and wired to tabs | Drag a header to rearrange panes, drag a divider to resize, double-click a header to maximize; tab switching still works while maximized |
| Many preconfigured CLI agents | 14 entries + custom CLI command | Claude, Codex, Gemini, Copilot, Pi, Hermes, Cursor, Droid, OpenCode, DeepSeek Harness, Grok, Kimi, Antigravity, Terminal |
| Drag files to the matching agent | Adjusted | Drag from the file tree, a file tab or Explorer onto the receiving agent pane/tab; only the path is pasted, no prompt is sent |
| Files outside the workspace / images from Explorer | Yes | Copied into the receiving session's cwd, then the path is pasted; images are supported by path, without promising each CLI's own image-clipboard protocol |
| Agents in their own worktree | Fixed copy target and paths | Uses the session's real cwd; no longer copies into the root workspace by mistake. Source files outside the cwd are copied into the cwd root, with `(1)`, `(2)` appended on name clashes |
| Hidden files | Yes | Dotfiles appear in the file tree |
| Viewing text, images, PDF, media, Word | Available, works with the new tabs | Text is a read-only preview; PDF/media/docx use the existing viewers |
| VS Code-style editor and autosave like Orca | Not yet | This version uses previews; Open launches the default app to edit the file. Not advertised as a Monaco editor or autosave |
| Quick-open and repo-wide search like Orca | Names and text | Ctrl+P finds a file name. Ctrl+Shift+F finds a line of text and skips dependency and build folders. There is no separate project index |
| Mobile and agent status | Unchanged | Mobile has a smoke test; detailed status hooks are Claude-only for now, other agents show process status |

## CLIs and install commands

The CLI entries are built into the catalog, while the executables and logins/subscriptions
belong to the user's environment. Install commands only run when you click Install; this
change never installs or signs in to agents on its own.

The added entries were checked against their official documentation:

- [Gemini CLI](https://github.com/google-gemini/gemini-cli): `npm i -g @google/gemini-cli`.
  Current docs mention Enterprise Code Assist/API; Google personal plans use Antigravity.
- [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli):
  `npm i -g @github/copilot`; Node.js 22+, PowerShell 6+ on Windows.
- [Pi](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md):
  docs now point to `@earendil-works/pi-coding-agent`, Node.js 22.19+.
- [Hermes on Windows](https://hermes-agent.nousresearch.com/docs/user-guide/windows-native):
  `hermes` executable, NousResearch's official PowerShell installer.

Custom CLI: open **New session → Run another CLI agent**, enter the executable/command
and a display name, then click **Run CLI**. A worktree can be enabled before launching.
The session is saved/restored like any other terminal; custom CLIs are not yet available as catalog presets.

## Verification

- `npm install`.
- `npm run start`: open the Windows app and check the real UI.
- `npm run smoke:workbench`: real renderer + real preload/IPC + PowerShell/ConPTY,
  with a temporary profile, repository, files and worktree. Covers launch, the right-side
  file tree, dotfiles, previews, tab reuse, Tab/Split, maximize, shortcuts, resize/refit,
  drag/drop to the right agent/cwd, preserving duplicate filenames, external attachments,
  reload, reattach and custom CLIs. Uses no agent accounts or personal data.
- `npm run smoke:mobile`: HTTP/WebSocket auth, attach/input, create/close sessions.
- `npm run dist`: Windows x64 package.

Real conversations with each AI service were not tested: that needs the CLIs installed and
the user's accounts. An old Claude session in the current profile reported its session ID
as not found; Restart opens a new session. A failed restore does not automatically switch
to a new conversation.
