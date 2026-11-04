# Codex review round 2 — CHANGES_REQUESTED

2026-11-03, Asia/Saigon. Branch `fix/workbench-stability`, HEAD checked `c0c5e371face5474490a1cf47f6114f98e6b45e3`. New implementation diff: `4edad8c..c0c5e37`, mainly commit `53a24d5`.

**All of the old R1–R6 PASS when Codex re-ran them independently. However, push/PR conditions are not met because of two lost-edit bugs R7/R8 and the native teardown issue C1 below.** No push, PR, merge or release in this round. No implementation changes or commits; only fixtures/evidence added and reports updated.

## What passes

- R1: the 614400-byte file is read in full, autosave produces 614404 bytes after appending `EDIT`.
- R2: after conflict → switch tab → return, `MY UNSAVED EDIT` is still there, and the state before switching was `conflict`.
- R3: a metadata edit while the codec is unavailable is rejected and keeps the fake legacy key. The Node check also covers removing another provider and a throwing encrypt.
- R4: the cold-restore fixture keeps a 0.70258 ratio instead of 50/50.
- R5: mousedown in a worktree terminal updates the explorer to the correct root.
- R6: exit/Restart keeps worktree metadata in main and sessions.json.

New evidence tied to the current HEAD: `evidence/codex-review-regressions-c0c5e37-1793705137624.json`. Grok's PASS evidence from before the commit is named `4edad8c` so it is not used as evidence for the new HEAD; this independent result re-confirms the committed version.

## R7 — [P1] Closing a tab drops the buffer before the async save detects a conflict

**Code:** `src/renderer/terminal_grid.js:1211–1229,1371–1392`. Related to T13/T28a, continuing R2's close-before-debounce acceptance.

`close_file_at` only blocks if `file.conflict` is already known. When the file is dirty but the 600ms debounce has not elapsed, it calls `flush_editor` fire-and-forget and then splices/removes the pane immediately. The save then returns a conflict, but the tab/buffer is already gone from the UI. The banner still says "Your edits are still in the editor", which does not match the actual state.

**Reproduction on real UI/IPC/files:** open A → type `UNSAVED CONFLICT BUFFER` → change A externally to `EXTERNAL CHANGE` → click close tab before the debounce → reopen A. The tab is not kept, the editor only shows `EXTERNAL CHANGE`; the unsaved edit has no recovery path in the UI. The control case of closing a dirty tab with no external change still saves successfully, so this is a bug in handling a failed result on close.

**For Grok:** close must await the flush/save result and only remove the tab when the save succeeds or the user actively discards. Conflicts/write errors must keep the tab and buffer intact, with the correct state. Serialize or manage in-flight saves per file; do not let old responses or concurrent close actions lose the newer generation. Calling an async function is not proof of saving.

**Acceptance:** close before debounce with save success/conflict/write error; close while a write is in flight; last file/not last file; both the file tab close button and the titlebar. A failed result never makes unsaved content disappear.

## R8 — [P1] Closing the app window before autosave loses just-typed content

**Code:** `src/renderer/terminal_grid.js:1351–1378`; `main.js:138,188–195`. Related to T28a/T23.

Edits only live in RAM and are scheduled to save after 600ms. Native close has no flush handshake/dirty-buffer preservation; when the last window closes, the app quits and the renderer/timer are destroyed. `will-quit` currently only stops mobile/PTY.

**Reproduction:** open B containing `original B` → type `EDIT JUST BEFORE WINDOW CLOSE` → close the native BrowserWindow via the normal close path. After the `closed` event, the file is still **original B**. The fixture does not use `app.exit` to trigger the close; it only sets the exit code after the native close/quit has happened. No PTY or real user data in this fixture.

**For Grok:** native close/quit must coordinate with the renderer to flush all dirty buffers and wait for writes to complete before destroying the window. On conflict/write error, cancel the close, keep the buffer and let the user decide explicitly. Cover app quit and related windows; do not use a forced timeout or always discard to exit. Only add recovery drafts with clear ownership, without writing secrets or user documents into evidence.

**Acceptance:** type → close immediately → relaunch keeps the right content; multiple dirty files, an in-flight save, conflict and write failure; close is blocked when saving fails. Tested on native Windows/app lifecycle, not just by calling the save function directly.

## C1 — [P2, needs investigation] Mobile smoke exits 0 despite a native exception

**Related code:** `scripts/smoke_mobile.js:158,193–195`, `src/main/pty_manager.js` close/kill lifecycle. Related to T23/T28c.

Both runs in this review printed `ALL CHECKS PASSED`/exit 0 but had **two `Error: AttachConsole failed` stack traces** from `node-pty/lib/conpty_console_list_agent.js:13`. The first run was alongside the lifecycle test; the separate confirmation run still had the same error, so it cannot be blamed on parallel tests. The product vs helper/test teardown impact is not yet determined; no claim that the app crashed.

Log of the separate run: `evidence/codex-review-mobile-c0c5e37.log`.

**For Grok:** determine the root cause and ownership of the helper/PTY on kill and on app exit, waiting on the lifecycle in the right order. The harness must turn related native exceptions into failures instead of relying only on assertions before teardown. Do not suppress stderr/AttachConsole, do not kill processes machine-wide and do not raise timeouts to hide failures. State clearly whether the product or the harness was fixed, with a clean native rerun and exit code.

## Verification this round

Environment: Windows x64; Node launcher v24.11.1, npm 11.6.3, Electron 44.9.0. The native helper in the stack trace reports Node v24.22.0 (the helper's runtime), not the same as the Node launcher. All fixtures use temporary profiles/files/git/worktrees; no real API keys read.

| Check | Result |
| --- | --- |
| `npm run check` | 27 PASS, exit 0 |
| `node node_modules/electron/cli.js scripts/codex_review_regressions.js` | R1–R6 PASS, exit 0 |
| `node node_modules/electron/cli.js scripts/smoke_workbench.js` | All checks passed, exit 0 |
| `node node_modules/electron/cli.js scripts/smoke_mobile.js` | Assertions PASS/exit 0 but native AttachConsole exceptions, not assessed as clean |
| `node node_modules/electron/cli.js scripts/lifecycle_cycles.js` | 20/20 PASS, live 0, exit 0; not a soak |
| `node node_modules/electron/cli.js scripts/codex_review_editor_lifecycle.js` | Control PASS; **R7/R8 FAIL, exit 1**, no harness error |
| `node --check` for changed JS/MJS and the new fixture | PASS |
| `git diff --check` | PASS before this round's documentation update |

R7/R8 evidence: `evidence/codex-review-editor-c0c5e37-1793705277414.json`. Independent fixture: `scripts/codex_review_editor_lifecycle.js`. Subsequent runs write evidence files by HEAD/timestamp, without overwriting historical results.

Scope of the verdict: R1–R6 pass in the cases run; T28a is still FAILED because of R7/R8, T23/T28c still have C1. Other PARTIAL/NOT_RUN rows in the `codex-review.md` matrix do not automatically become VERIFIED. Build/package/install/clean Windows/30-minute soak/real CLI-provider-phone are still not run this round; public release is still NOT_READY.

## Handed back to Grok

Continue on the current branch, keeping the new review/evidence files. Fix R7/R8 first and investigate C1. Do not change assertions to hide failures, do not rewrite FAIL evidence history, do not touch production data. Re-run both the R1–R6 regression and editor-lifecycle, smoke/native teardown; record the new SHA and new evidence. Keep NOT_RUN for acceptance checks not run. Local commits are allowed; no push/PR/merge/release yet. Hand back to Codex to review the push/PR conditions the user has allowed.
