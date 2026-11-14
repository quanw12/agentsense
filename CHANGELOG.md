# Changelog

## Unreleased

- Add an Appearance page at the bottom of the sidebar: dark, light, or the Windows color mode, plus an accent color. Open terminals recolor in place.
- Show a squad bot above the chat. It sits ready, works as soon as a prompt is sent, and pauses when a bot needs approval.
- Add Squad chat: a roster, channels, and one computer per bot (git worktree, WSL shell, Docker shell, or the shared folder). A Claude lead is pointed at `/agentsense:lead` for multi-file jobs. WSL and Docker are labeled as shells. Docker drops capabilities and blocks new privileges. A bot stays bound to the terminal it started, and a model is passed only when that CLI has a verified model variable.
- Show output or quiet on every running pane. A Claude hook status still wins when the hub has one.
- Add Ctrl+Shift+F to search file text in the workspace. Ctrl+P still finds file names. Both skip dependency and build folders.
- Add a Telegram bot: drive panes from a chat on any network, with live screens, key buttons, notifications when Claude Code finishes or needs you, and `/diff`, `/ls`, `/cat`. It obeys one account paired by a one-time code, and the token is encrypted with DPAPI.
- Pin node-pty 1.2.0-beta.17 with the upstream ConPTY handle synchronization fix; wait for native terminal cleanup during close and quit.
- Reject new launches during shutdown, share concurrent close completion, and recover the saved Claude conversation ID on restart.
- Preserve BOM/CRLF when editing; preview unsupported encodings and mixed line endings without rewriting them.
- Rebuild and verify source/native payload hashes before staging app/, and verify installer checksums before replacing an existing installation.
- Add Windows PR checks for editor regressions, native lifecycle, repeated process exits, build and sandbox install/rollback.
- Reload the window after a renderer crash with terminals still running; a crashed or unresponsive window can always be closed.
- Offer Discard my edits when a save fails, so a read-only file can no longer block closing its tab or the app. A blocked close now shows the file it is waiting for.
- Open tabs follow changes on disk, keeping the caret and scroll position. Unsaved edits are never replaced, and saving no longer recreates a file that was deleted.
- Open file and page drops open a file from outside the workspace in place instead of copying it to `.agentsense-import`.
- A saved session that cannot be restored now shows its error and the Restart and Forget buttons instead of the launch page.
- Clicking a file opens it on a separate Files page, in a preview tab the next click replaces. Editing or double-clicking keeps the tab.
- Drag a tab or tree row to the edge of an open file to view files side by side, or onto another group to move it there. Groups and tabs survive a restart.
- The Mobile access panel no longer offers a QR code or links a phone cannot use. While "Reachable from other devices" is off it tells you to turn it on; when on, the QR code prefers Wi-Fi or wired addresses over virtual adapters, and every address stays listed.
- Add an agent kit to Claude panes in any folder: `/agentsense:lead` plans a job and runs its tasks in parallel workers, each in its own git worktree. Turn it off on the launch page.

## 1.0.0

- Fixed workbench: agent panes stay visible, focus does not resize them, and files open as tabs in one region.
- Session restore keeps model and provider ids. API keys are sealed with the OS secret store.
- Windows package is built from one verified payload. Signing and automatic updates are not part of this build.
