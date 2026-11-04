# Codex review round 3 — CHANGES_REQUESTED

2026-11-03, Asia/Saigon. Branch `fix/workbench-stability`; HEAD `28102e32ab41b74dbd7219d823d6697528984395`. New implementation `e6e3d86`, review diff `c0c5e37..28102e3`.

**R1–R8 PASS in the old cases; C1 no longer reproduces in the current mobile smoke run. R9 [P1] remains — the conflict buffer is lost on quit — so no push/PR yet.** Working tree clean at the start; the review only adds fixtures/evidence/docs, with no implementation changes, commit, push, PR, merge or release.

## R9 — [P1] Quit skips files already in conflict

**Code:** `src/renderer/terminal_grid.js:1442–1457`, especially line 1450; `main.js:139–151`. Related to preserving buffers through conflicts and native app close from R2/R8/T28a.

`flush_dirty_editors` has `if (file.conflict || !file.dirty || file.editable === false) continue`. A file already in conflict is not added to pending and does not set `blocked` to true. Main receives `{ok:true}`, sets `flush_complete` and closes the window, even though the buffer is unsaved, not discarded by the user and has no recovery persistence. Avoiding overwriting the external file is correct, but skipping the conflict to allow quitting loses the edit.

**Independent reproduction on native Windows:** open a fixture file containing `original`, type `UNSAVED BUFFER TO KEEP`, change the file externally to `EXTERNAL DISK VERSION`. Wait for the UI to show `conflict`, confirm the editor still has the buffer. Close the native BrowserWindow via a normal `.close()`. **FAIL:** the `closed` event fires, the disk only has the external version; the unsaved buffer is lost, with no user discard. The harness only ends the process after recording the native close; no PTY or real data.

Fixture: `scripts/codex_review_conflicted_quit.js`, **exit 1**, SETUP PASS/R9 FAIL, no harness error. Evidence: `evidence/codex-review-conflicted-quit-28102e3-1793706463362.json`.

**For Grok:** dirty/conflict buffers must count toward the close decision. While not resolved/discarded, keep the window and the buffer and show which file needs attention; or have genuinely durable recovery before closing. Never auto-overwrite the external file and never treat seeing a conflict as consent to discard. Only after explicit handling may the next close proceed.

**Acceptance:** conflict existing before quit, a new conflict during flush, write error, a normal dirty file, multiple files/workspaces clean/dirty/conflict. With a conflict, close is blocked and the buffer stays intact unless the user actively discards or the data has been preserved recoverably. With only normal dirty files, save correctly and allow exit.

**Fix the test gap:** `codex_review_editor_lifecycle.js` creates conflict A in R7 and keeps it open while running R8. R8 only asserts that B is written when the app closes, not that A is preserved, so it PASSes even though A is lost. If quit is blocked correctly, the old fixture may time out because A is unresolved. Split R7 and normal-close R8 into independent apps/profiles, or use an explicit resolve/discard action before normal close. Keep the known-conflict quit case R9 separate. Do not drop the preservation assertion or skip the conflict to pass the old test.

## Independent verification

| Check | Result |
| --- | --- |
| `npm run check` | 27 PASS, exit 0 |
| `scripts/codex_review_regressions.js` via Electron | R1–R6 PASS, exit 0 |
| `scripts/codex_review_editor_lifecycle.js` via Electron | CONTROL/R7/R8 PASS, exit 0; gap in checking A as above |
| `scripts/codex_review_conflicted_quit.js` via Electron | SETUP PASS, **R9 FAIL, exit 1** |
| Workbench smoke | All checks passed, exit 0 |
| Mobile smoke | All checks passed, exit 0, no AttachConsole/native exception |
| `scripts/lifecycle_cycles.js` via Electron | 20/20 PASS, live 0, exit 0 |
| JS syntax of this round's diff and the new fixture; `git diff --check` | PASS before the documentation update |

Electron scripts are run with `node node_modules/electron/cli.js <script>`. Profiles/files/git/worktrees are all temporary. Additional evidence: `evidence/codex-review-regressions-28102e3-1793706436211.json`, `evidence/codex-review-editor-28102e3-1793706427751.json`, `evidence/codex-review-mobile-28102e3.log`. Historical evidence not altered.

C1: read the DLL/non-DLL paths of the local node-pty dependency; `useConptyDll:true` avoids the console-list helper of the earlier kill path. Native smoke/lifecycle this run were clean, which does not replace a soak/clean Windows.

Build/package/install/clean Windows/30-minute soak/real CLI-provider-phone and other PARTIAL acceptance checks were not re-run; public release is still NOT_READY. Earlier matrices/evidence stay as history; not every requirement is turned into VERIFIED.

Grok continues locally on this branch, keeps the new review files, fixes R9 and splits the lifecycle tests as above. Run the old regressions and the new case, record the new SHA/evidence, hand back for Codex review. No push/PR/merge/release in the fix pass.
