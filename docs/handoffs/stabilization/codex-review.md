# Codex review and follow-up work for Grok

- Review date: 2026-11-03, Asia/Saigon.
- Branch: `fix/workbench-stability`.
- Baseline: `94257b12aabe4dcb2ec48e1c2c6a74a37c71e1fa`.
- HEAD reviewed: `4edad8c880b1f0d23f0f15b2bb77fd0c42172b37`.
- Verdict: **CHANGES_REQUESTED**, implementation **PARTIAL**, public release **NOT_READY**.
- Working tree clean at the start of the pass. No push, PR, merge, release or visibility change.
- This review only adds documentation, verification fixtures and evidence; Grok's implementation was not changed and no commit was created.

The user allowed push/PR creation if the review passes. That condition is not met because of the six reproducible bugs below. Missing certificates or real devices is not the main reason for keeping the branch local: there are functional bugs and data loss right now.

## Findings and required fixes

### R1 — [P1] Autosave overwrites the file with the truncated preview

**Code:** `src/renderer/terminal_grid.js:1275–1293`; `src/main/ipc_files.js:135–142,314–342`. Related to T13/T28a.

`read_file` only reads 512 KiB and returns `truncated:true`. The renderer still creates an editable textarea and then autosaves the whole textarea via `write_text`. The "showing the first part" label does not protect the unread part of the file.

**Independent reproduction:** open `large.txt` of 614400 bytes, append `EDIT`, wait for autosave. The file on disk is now only **524292 bytes**, losing 90112 bytes of original content. Only temporary fixture files were used.

**For Grok:** a truncated preview must be read-only, or the editor must load the full content within the supported limit before allowing edits. Do not treat a preview chunk as the whole document. Protect the backend too where needed; do not blindly append the tail, since that does not preserve edit/revision semantics.

**Acceptance:** files under/over 512 KiB, multibyte UTF-8 at the boundary, files over the limit, read-only. Valid edits lose no bytes at the tail; supported BOM/line endings must be kept. A truncated preview never triggers a write.

### R2 — [P1] A conflict buffer is replaced with disk content when switching tabs

**Code:** `src/renderer/terminal_grid.js:1223–1230,1265–1279,1334–1358`. Related to T13/T28a.

Every activation calls reload; `load_file_content` resets `file.mtime`, `file.disk` and the textarea from disk, ignoring `file.dirty`/`file.buffer`. The conflict branch says "Your edits are still in the editor" but does not preserve the buffer on tab switch. The save timer shared by the whole pane and closing the last tab also need checking.

**Independent reproduction:** edit A to `MY UNSAVED EDIT`, replace A externally with `EXTERNAL DISK UPDATE`, wait for the UI to show `conflict`, open B then return to A. The editor shows **EXTERNAL DISK UPDATE**, with no edit left for the user to resolve.

**For Grok:** store buffer/revision/save state per file, re-render the dirty buffer on activate, only auto-refresh clean files. Provide a clear conflict-resolution flow; keep the buffer through errors and block unintended discards. Save uses a suitable snapshot/version so old responses do not mark newer edits as saved. Check closing a tab/the app before the debounce and the timer between two files.

**Acceptance:** conflict → switch tab → return still keeps the edit; editing A then B within 600ms does not cancel A's save; switching/closing a tab before the debounce loses no content; typing while a write is in flight does not falsely report saved; external updates are never silently overwritten.

### R3 — [P1] Editing provider metadata deletes the legacy key when encryption is unavailable

**Code:** `src/main/providers_store.js:151–155,194–215` and `to_disk`/`remove_provider`. Related to T05/T18.

Migration keeps `pending_plain` in RAM when the codec is unavailable. However, saving metadata without a new key still sets `pending_plain:''`, and then `write_stored` drops the plaintext key entirely with no replacement ciphertext. A remove/update of another provider can also serialize the remaining legacy providers via `to_disk`.

**Independent reproduction:** a legacy provider with a fake key, codec injected with `available:()=>false`, rename without entering a key. Save **does not reject**, the record becomes `secret_status:'empty'`, with no plaintext or ciphertext key left. This is a module test with a fake codec simulating the unavailable condition; it does not verify a real safeStorage failure and reads no real credentials.

**For Grok:** while any secret needing migration has not been sealed successfully, never rewrite the file in a way that loses it. Fail the whole operation with a message, or design a transaction that preserves data; do not add a plaintext fallback/backup. Applies to update/remove/create and every provider in the file.

**Acceptance:** unavailable, encrypt throwing midway across several providers, decrypt failure, renaming/deleting another provider, relaunch/retry. Credentials that could not be migrated must stay intact in the original file; successful changes must be atomic and contain only ciphertext.

### R4 — [P2] Cold restore drops the 70/30 split

**Code:** `src/renderer/terminal_grid.js:709,1394–1460,2140–2205`. Related to T02/T04.

`apply_saved_layout` only runs when attaching live terminals. When the app has just started and there are no live panes, there are no leaves to match. Saved sessions are mounted afterwards but the tree is not re-applied. The new record ID after restore also does not match the old key. The file group is opened after apply, so it must be handled in the same restore lifecycle.

**Independent reproduction:** seed two valid saved sessions and a tree with matching record keys, sizes `[0.7,0.3]`, no live PTY; create the view and call restore following the app flow. Both panes are restored but widths are **465.2/465.2**, i.e. **50/50**. This is a same-process cold-restore fixture, not evidence of relaunching the executable twice.

**For Grok:** have a stable layout identity or an old/new ID mapping; apply the tree once the required terminal/file panes are ready. Do not overwrite the saved tree with a half-restored tree. Keep root identity and handle missing files/sessions clearly.

**Acceptance:** real app close/reopen with 2/4/6 panes, 70/30 split, with/without a file group; two workspaces with different layouts. A renderer-reload test with live PTYs must be separate from the app-restart test.

### R5 — [P2] Clicking in a terminal does not switch the explorer to the selected worktree

**Code:** `src/renderer/terminal_grid.js:982,1941–1975`. Related to T10/T11/T28b.

The pane's mousedown calls `set_active_pane`, but only `select_tab` calls `sync_file_context`. Clicking directly in a terminal is the normal way to select a pane, so agent focus and the explorer root can diverge.

**Independent reproduction:** create a terminal in a real git worktree, dispatch mousedown on that pane. `.fp-title.title` still points to the base repo, not `workspace.worktrees/<branch>`. Users may open/edit files in the base repo while working in the worktree agent.

**For Grok:** sync the context through a single pane select/focus path used by mouse, keyboard and sidebar; without changing geometry. File tabs must keep their own file's root. Review quick-open, since its event listeners currently capture `root` from the first time the overlay is created; context changes must use the current root.

**Acceptance:** base repo + two worktrees with different `src/foo.js`; click terminal body/tab/sidebar, Ctrl+Tab; tree/editor/quick-open/Open/Reveal point at the right root and terminal bounds are kept.

### R6 — [P2] Restart after process exit loses worktree metadata in main and the saved record

**Code:** `src/renderer/terminal_grid.js:2225–2236`; `src/main/pty_manager.js:200,215–217,318`. Related to T06/T07.

Process exit deletes the saved record. Restart passes the `restore_record_id` of the deleted record with `use_worktree:false`, so main has no source for the worktree metadata. The renderer keeps the old value via a fallback, which hides the bug until the next reload.

**Independent reproduction:** terminal in a real worktree → type `exit` → click Restart. `cwd` is still correct, but both `pty.list_terminals()` and `sessions.json` of the new terminal have **worktree:null**. This loses branch/repo identity across reload/restore and leaves the worktree cleanup path unaware of which worktree the terminal owns.

**For Grok:** preserve main-owned context before removing the session/record, or keep the record with an exited lifecycle state so restart can resolve it. Do not trust an arbitrary worktree object from the renderer in place of main-side verification. Keep the current worktree instead of creating a new one to hide the bug.

**Acceptance:** exit/restart with clean and dirty worktrees; compare path/branch/repo/base_commit in main and on disk; renderer reload + app relaunch after restart; close only cleans up owned and clean worktrees, never deletes dirty ones.

## Verification run

Environment: Windows x64 in the user's workspace; Node v24.11.1, npm 11.6.3, Electron 44.9.0. The profile, git repo, files, worktree and fake key in the regression are all temporary fixtures.

| Command | Independent review result |
| --- | --- |
| `npm run check` | Exit 0, 18 PASS; the legacy preset check in the script only reads a fixture and compares strings, without calling the store normalizer |
| `node node_modules/electron/cli.js scripts/smoke_workbench.js` | Exit 0, all checks passed |
| `node node_modules/electron/cli.js scripts/smoke_mobile.js` | Exit 0, all checks passed |
| `node node_modules/electron/cli.js scripts/lifecycle_cycles.js` | Exit 0, 20 cycles PASS, live 0; not a full soak/restart/reload |
| `node --check` for all changed JS/MJS and the new review fixture | PASS |
| `git diff --check` | PASS at the time of checking |
| `node node_modules/electron/cli.js scripts/codex_review_regressions.js` | **Exit 1, R1–R6 all FAIL**, no harness error |

New evidence: `docs/handoffs/stabilization/evidence/codex-review-regressions.json`. New fixture: `scripts/codex_review_regressions.js`. Old audit evidence was not altered to become PASS.

Not run in this review: build/package/install/upgrade/uninstall, a 30-minute soak, clean Windows, real CLI/provider/auth, real safeStorage failure, phone/LAN/VPN/sleep-wake or remote CI. Smoke PASSes do not replace those acceptance checks. No new UI screenshots.

## Reviewer matrix

VERIFIED is only used for scope with sufficient evidence; PARTIAL means code/partial checks exist but not all acceptance criteria are met. FAILED has an independent bug above. Grok's original implementation labels are not turned into PASS.

| ID | Reviewer verdict | Evidence / still missing |
| --- | --- | --- |
| T01 | PARTIAL | Focus/double-click and bounds pass in the existing smoke; not yet 2/4/6 panes + legacy profile |
| T02 | FAILED | R4: cold restore loses the ratio; file tabs/selection across relaunch not sufficient |
| T03 | PARTIAL | One file group with text/image passes; not yet 20 files/overlap |
| T04 | PARTIAL | Files visibility per workspace passes; split persistence fails R4 |
| T05 | PARTIAL | IDs/secret stripping pass in Node; model/provider through a CLI and relaunch not tested, migration has R3 |
| T06 | FAILED | R6: worktree metadata lost after exit/restart |
| T07 | PARTIAL | Code keeps restore errors and has Forget; missing folder/CLI then Retry not tested; needs review against R6 |
| T08 | PARTIAL | Capability only accepts Claude conversations; no real conversation/resume. Review the session ID path through exit/restart, do not self-report verified |
| T09 | PARTIAL | Store seat object exists in code; the legacy preset test does not check the normalizer; lineup save/load/relaunch not tested |
| T10 | FAILED | R5: directly selecting a pane leaves the explorer on the old root |
| T11 | PARTIAL | Drop target/worktree/external smoke passes; root focus R5, files with accents/quotes and the target-close race not sufficient |
| T12 | PARTIAL | 14 IDs match capabilities; most model/provider/resume unsupported/unverified. The UI still has options to reconcile with main-side rejection; real CLIs NOT_RUN |
| T13 | FAILED | R1/R2: editor truncates files and loses the conflict buffer |
| T14 | PARTIAL | Watcher/debounce/ignore code exists; burst and disposal across many roots not measured |
| T15 | PARTIAL | Refresh-preserve code exists; three levels/relaunch/root switch not verified |
| T16 | PARTIAL | 101/250 have results/whole-batch reject passing in Node; UI accounting/cancel/collision incomplete |
| T17 | PARTIAL | Copy/list/search async; read/path canonicalization still sync; progress/cancel UI and event-loop latency not accepted |
| T18 | FAILED | R3: unavailable migration + metadata edit deletes the key |
| T19 | PARTIAL | Junction-outside read reject passes; not the full write/preview/Open/Reveal/import/in-root link/UNC matrix |
| T20 | PARTIAL | Desktop-owner code exists; mobile smoke does not assert dimension arbitration with 2 clients + desktop |
| T21 | PARTIAL | Node A lock/B not locked and HTTP wrong-token lock pass; rotate/expiry/HTTP+WS from two sources incomplete |
| T22 | PARTIAL | LAN/loopback scope text, no-store/no-referrer code; loopback auth smoke passes; real LAN/VPN NOT_RUN |
| T23 | PARTIAL | 20 create/close and 2 smokes exit 0; root cause of the earlier crash lacks evidence, multi-pane restart/reload/resources/30-minute soak not run |
| T24 | PARTIAL | Stage/swap and manifest exist in code; no source→dist→app/build provenance pipeline yet. The script takes the current commit and stamps an existing payload, not proving the payload matches the commit |
| T25 | PARTIAL | Stage/swap/rollback code exists; install/upgrade/uninstall and failure injection NOT_RUN |
| T26a | PARTIAL | Version UI/CHANGELOG/manifest code; actual artifact provenance/version not confirmed |
| T26b | PARTIAL | Manual-only workflow, contents:read permission; remote CI NOT_RUN, no build/artifact validation in the current workflow |
| T26c | NOT_RUN | No new release package/checksum, no download channel chosen; nothing published |
| T26d | BLOCKED | Grok reports no signing certificate; the review did not check real credentials/signing |
| T26e | PARTIAL | Manual update only; no end-to-end integrity/signature/rollback, no production updater |
| T26f | PARTIAL | Windows x64 scope recorded; clean-machine artifact NOT_RUN |
| T27 | PARTIAL | The new dev runner has valid syntax; npm dev/start/packaged app not re-run in this review |
| T28a | FAILED | R1/R2, plus R5 for the correct root |
| T28b | PARTIAL | Search/overlay code exists; quick-open context/root needs checking per R5, keyboard navigation not accepted |
| T28c | FAILED | Smokes pass but miss all six regressions; review fixtures with a real nonzero exit added |
| T28d | NOT_RUN | Clean Windows, artifact upgrade, Vietnamese-character path, rollback not run |
| T28e | NOT_RUN | Real CLI/auth/provider/phone/LAN/VPN/sleep-wake/crash/soak not run |

## Prompt handed back to Grok

Continue on `fix/workbench-stability` from review HEAD `4edad8c`. Read this report, `stabilization-tasks.md` and `stabilization-results.md`. Keep the new review files in the working tree; do not reset/clean or alter historical FAIL evidence to hide failures.

1. Fix R1/R2/R3 first because they lose data; then R4/R5/R6. Each bug needs a meaningful regression, keeping tests that check user behaviour; do not mock away failure paths, drop assertions, flip wrong expectations to correct or raise timeouts to get a PASS.
2. Run the R1–R6 review fixture; after the fixes all must pass and exit 0. Do not overwrite this review's original evidence to rewrite the past. The harness keeps the first evidence file and writes files with their own SHA/timestamp on subsequent runs.
3. Review every PARTIAL row, especially CLI model/provider UI/main compatibility, Claude session ID across restart, import progress/cancel, watcher disposal, stale payload/manifest. Do not narrow an unfinished requirement to report completion. Every remaining gap needs a status and a clear way to test it.
4. Re-run the Node check, workbench/mobile smoke, lifecycle; add cold relaunch, dirty buffer/conflict and real worktree exit/restart/reload. Build/package + sandbox install/upgrade/rollback only on fixtures with correct ownership. Soak/real integrations missing preconditions stay NOT_RUN/BLOCKED, never fake PASS.
5. Separate local commits that are easy to review; update the results tied to the new base/head and evidence. No push/merge/PR/tag/release/deploy in this fix pass. Hand back for Codex review; the user has allowed Codex to push/create a PR once results genuinely pass.

There is no direct Grok channel in this Codex session; this is a work package to bring into the Grok session doing the work, not a confirmation that Grok received/ran it.
