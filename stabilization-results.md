# AgentSense — implementation results and review handoff

Implementers: Grok 4.7 and Codex. The latest review history and remote decision are in section 8; older sections keep the evidence as it was at the time.

## 1. Metadata

- HANDOFF_STATE: READY_FOR_CODEX_REVIEW
- IMPLEMENTATION_STATUS: PARTIAL
- PUBLIC_RELEASE_READINESS: NOT_READY
- CODEX_REVIEW_STATE: VERIFIED_FOR_PR
- Date: 2026-11-03
- Repo root: `C:\StudyBase\AgentSense`
- OS / CPU: Windows 10.0.26300, x64. Node v24.11.1, npm 11.6.3, Electron 44.9.0
- Local branch: `fix/workbench-stability`
- Local commits: `03dda35`, `78f9e35`, `0260de4`, `4edad8c`, `53a24d5`, `c0c5e37`, `e6e3d86`, `28102e3`, `b03fed0`, `34b7ce3`, `cbc555d`, `521e51c`, `146576b`
- HEAD at start: `94257b12aabe4dcb2ec48e1c2c6a74a37c71e1fa` (`main`, matches the audit baseline)
- BASE_SHA used for review: `94257b12aabe4dcb2ec48e1c2c6a74a37c71e1fa`
- Git status before starting: `main` clean apart from untracked handoff files (`grok-4.7-prompt.md`, `stabilization-*.md`, `codex-review-prompt.md`, `docs/handoffs/stabilization/`)
- Remote operations performed: NONE

The statuses below are not a public-release PASS. `FIXED_VERIFIED` is only used when the item's criteria have evidence. Everything else is `IMPLEMENTED_NOT_VERIFIED`, `NOT_RUN` or `BLOCKED`.

## 2. Matrix

| ID | Scope | Status | Test/evidence | Still missing |
| --- | --- | --- | --- | --- |
| T01 | Focus does not change geometry | IMPLEMENTED_NOT_VERIFIED | smoke: 3 panes, 20 clicks + double-click, bounds drift ≤ 1px, Tab view button gone | Not run separately for 2/4/6 panes, not proven that PTYs are not recreated, `mode=tabs` fixture profile not loaded |
| T02 | Per-workspace layout | IMPLEMENTED_NOT_VERIFIED | R4 fixture in the same process: two panes cold-restore `0.7026` vs `0.7` | No real app close/reopen with 2/4/6 panes, no two workspaces with different layouts, no file group across relaunch |
| T03 | One file area, multiple tabs | IMPLEMENTED_NOT_VERIFIED | Smoke: text + image use one `.tg-file-pane` | 20 files not opened, overlap not captured |
| T04 | State separated per workspace | IMPLEMENTED_NOT_VERIFIED | A new workspace still opens Files while the other workspace has the panel hidden | Not dragged divider A then compared B after relaunch |
| T05 | Model/provider id, no stored secret | IMPLEMENTED_NOT_VERIFIED | `npm run check`: record drops `api_key`/`env_extra`; fake key not in providers.json | No mock CLI printing the model after relaunch. Real provider NOT_RUN |
| T06 | Keep worktree on restart | IMPLEMENTED_NOT_VERIFIED | R6: after `exit` then Restart, `pty.list_terminals()` and `sessions.json` have the same path/branch/repo/base_commit. No new worktree created | No dirty worktree, no renderer reload and app relaunch after restart |
| T07 | Keep sessions whose restore failed | IMPLEMENTED_NOT_VERIFIED | A failed restore does not call discard; Forget exists | No fixture for a missing folder / missing CLI that comes back |
| T08 | Per-CLI resume | IMPLEMENTED_NOT_VERIFIED | Capability table; only Claude has a known `--resume` | Real conversation NOT_RUN. No invented flags for other CLIs |
| T09 | Presets with full seats | IMPLEMENTED_NOT_VERIFIED | Seat object includes model/provider/worktree; duplicate names rejected in code | No UI save/load/relaunch |
| T10 | File tree follows the worktree | IMPLEMENTED_NOT_VERIFIED | R5: mousedown in a worktree terminal switches `.fp-title` to the right worktree | No two worktrees with different `src/foo.js`; no Ctrl+Tab/sidebar/quick-open/Open/Reveal |
| T11 | Drop to the correct relative path | IMPLEMENTED_NOT_VERIFIED | Smoke: worktree does not create `brief (1).txt`; outside files go to `.agentsense-import` | Not enough accents/spaces/target closed mid-way |
| T12 | CLI matrix | IMPLEMENTED_NOT_VERIFIED | Contract: 14 ids match `cli_capabilities.js`. Codex does not accept a guessed model env | No real CLI launch/chat |
| T13 | Editor does not keep stale content | IMPLEMENTED_NOT_VERIFIED | R1/R2/R7/R8 PASS. R9: quitting with a conflict is blocked, buffer still has `UNSAVED BUFFER TO KEEP`, disk keeps the external version | No app relaunch to re-read the file. Discard is a separate button, not closing the banner |
| T14 | Watch the file tree | IMPLEMENTED_NOT_VERIFIED | `files:watch` debounced, skips `node_modules`/`.git` | Burst not measured |
| T15 | Keep expansion | IMPLEMENTED_NOT_VERIFIED | `refresh_preserve` keeps scroll/selection in code | No 3-level test |
| T16 | Import never truncates silently | IMPLEMENTED_NOT_VERIFIED | check: 101 items all ok; 250 items reject the whole batch, nothing copied | Counts not compared against the UI |
| T17 | IO does not block main | IMPLEMENTED_NOT_VERIFIED | copy/list/search use fs.promises | Event loop not measured |
| T18 | Sealed API keys | IMPLEMENTED_NOT_VERIFIED | R3: codec unavailable, rename rejected, legacy file keeps `api_key`. Node check: deleting another provider and a throwing seal also do not overwrite the file | Real safeStorage failure NOT_RUN. No plaintext fallback |
| T19 | Junctions cannot escape the root | IMPLEMENTED_NOT_VERIFIED | check: an outward junction is rejected by `read_file` | No symlink inside the root; no Open/Reveal |
| T20 | One owner of PTY size | IMPLEMENTED_NOT_VERIFIED | Mobile resize is not applied while a desktop window exists | No 2 WebSockets and no real device |
| T21 | Per-source rate limit | IMPLEMENTED_NOT_VERIFIED | check: A locked, B not. Mobile smoke: same source still locks after 3 wrong tokens | No token rotate + expiry over HTTP |
| T22 | Mobile LAN/VPN | IMPLEMENTED_NOT_VERIFIED | UI/state says loopback and LAN, does not claim internet/TLS. APPROACH: no cloud | Real LAN/VPN NOT_RUN |
| T23 | ConPTY lifecycle | IMPLEMENTED_NOT_VERIFIED | `146576b`: 4 workbench, 4 mobile, 4 harness `app.exit`, 4 product `app.quit` all exit 0. 20 cycles, live 0. No more `0xC0000005` / `0xC0000409` in that set | Soak NOT_RUN. Not every way a user can close the window |
| T24 | Single build source | IMPLEMENTED_NOT_VERIFIED | `scripts/build_app.mjs` stages then swaps, writes `BUILD.json` | `npm run dist` not run |
| T25 | Installer with rollback | IMPLEMENTED_NOT_VERIFIED | `install.ps1` stage/swap, refuses `%APPDATA%` | No install/upgrade/uninstall in a temp folder |
| T26 | Release | see subitems | local only | Not FIXED_VERIFIED |
| T27 | `npm run dev` on Windows | IMPLEMENTED_NOT_VERIFIED | `node scripts/dev.js` with a temp `AGENT_HUB_USER_DATA` spawned Electron | No `npm start` and no packaged exe |
| T28 | Editor / quick-open / coverage | see subitems | new UX smoke passes | Missing clean machine and real CLIs |

### T26

| Subitem | Status | Result | Evidence | Still missing |
| --- | --- | --- | --- | --- |
| T26a | IMPLEMENTED_NOT_VERIFIED | Version in the toolbar via `app:info`; CHANGELOG; manifest at build time | `main.js`, `CHANGELOG.md`, `scripts/build_app.mjs` | Packaged UI not checked |
| T26b | NOT_RUN | Local workflow is `workflow_dispatch` only, `contents: read`, no publish. REMOTE_CI=NOT_RUN | `.github/workflows/windows-check.yml` | Not pushed, so not run |
| T26c | NOT_RUN | PUBLICATION=NOT_AUTHORIZED. Repo private, visibility unchanged | this section | Repo owner decides the download channel |
| T26d | BLOCKED | SIGNING=BLOCKED. Manifest records `unsigned` | no cert | Certificate |
| T26e | NOT_RUN | No auto-updater. Install/upgrade is still the manual installer. AUTO_UPDATE_PRODUCTION=NOT_RUN | `install.ps1` | Documentation is not an updater |
| T26f | NOT_RUN | APPROACH/SCOPE: Windows x64 only. macOS/Linux not announced | `BUILD.json` platform `win32-x64` | No clean machine |

### T28

| Subitem | Status | Result | Evidence | Still missing |
| --- | --- | --- | --- | --- |
| T28a | IMPLEMENTED_NOT_VERIFIED | R7–R10. Discard bumps `save_epoch` so queued snapshots are not written | discard-pending evidence after the fix commit | Not measured across several workspaces at once in the UI |
| T28b | IMPLEMENTED_NOT_VERIFIED | Quick-open reads the current root while typing, does not capture the root when the overlay is created | `open_quick_open` | Ctrl+P not pressed after switching worktree |
| T28c | IMPLEMENTED_NOT_VERIFIED | Workbench/mobile smoke and lifecycle still pass. Fixtures R1–R6 exit 0 after the fix | timestamped evidence below. Original FAIL evidence untouched | Does not cover all of T01–T27 |
| T28d | NOT_RUN | | | Clean Windows, Vietnamese-character path, upgrade between two artifacts |
| T28e | NOT_RUN | | | Real CLI/auth, phone, sleep/wake, soak |

## 3. What changed

- Fixed panes: Tab view and double-click maximize removed. `select_tab` only changes focus. `scrollIntoView` removed.
- Layout and the file panel are stored per workspace in `localStorage` key `agentsense.workbench` version 2. Old `mode=tabs` is ignored; sessions are not deleted.
- Files open in one tab group. No new split per file.
- Sessions store `model_id`, `provider_id`, `base_cwd`, `resume_mode`, `last_error`. No env/API keys stored.
- Providers are sealed. List returns `has_secret`, not the key. The real codec is `safeStorage`; tests use a fake codec.
- Restart closes the pane with `keep_worktree` and relaunches in the same `cwd`, without creating a new worktree.
- Failed restores keep the record, with Retry (the Restart button) and Forget.
- Drops inside the repo map by relative path. Existing files are not overwritten. Outside files go to `.agentsense-import`.
- `resolve_inside` uses the real path. Outward junctions are rejected (run).
- Rate limit per address. Mobile does not resize the PTY while the desktop is visible.
- `npm run dev` is `node scripts/dev.js`.
- Build and installer stage first, then replace the old version.

## 4. Commands run

| Command | Result | Boundary |
| --- | --- | --- |
| `node scripts/check_stability.js` | exit 0, 27 PASS | Node, no ConPTY. Adds legacy key, throwing seal, 600 KiB file, UTF-8, BOM/CRLF, truncated preview, conflict |
| `node node_modules/electron/cli.js scripts/smoke_workbench.js` run 1 | 1 FAIL on textarea textContent, then process exit `0xC0000005` | Electron + ConPTY + temp profile |
| same command run 2, after the smoke reads `value` and pty is set to null on exit | exit 0, all checks passed | same boundary |
| `node node_modules/electron/cli.js scripts/smoke_mobile.js` | exit 0 | HTTP/WS loopback + one powershell |
| `node node_modules/electron/cli.js scripts/lifecycle_cycles.js` | 20/20 PASS, exit 0, live 0 | ConPTY create/close, no soak |
| `node scripts/dev.js` with a temp `AGENT_HUB_USER_DATA` | Electron process appeared, then closed | Default profile untouched |
| Soak ≥ 30 minutes | NOT_RUN | |
| `npm run dist`, sandbox install/uninstall | NOT_RUN | |
| Real CLI/provider/phone/VPN | NOT_RUN | |

UI screenshots: not saved. No secrets in the logs.

## 5. CLIs and devices

Every real CLI row: Launch NOT_RUN, provider NOT_RUN, resume NOT_RUN. Mock/contract: the capability table and catalog are compared in `npm run check`. Terminal/powershell is a smoke process, not an agent conversation.

Real phone and VPN: NOT_RUN. Desktop + simulated client only has the single-machine mobile smoke.

## 6. Artifact

Not packaged. No new exe, nothing uploaded. On build, `scripts/build_app.mjs` writes `app/BUILD.json` and `dist/BUILD.json` with version, commit, sha256, `signing: unsigned`, `platform: win32-x64`.

## 7. For Codex

- Review: `git diff 94257b12aabe4dcb2ec48e1c2c6a74a37c71e1fa...HEAD`
- Re-run: `npm run check`, then Electron `scripts/smoke_workbench.js`, `scripts/smoke_mobile.js`, `scripts/lifecycle_cycles.js`. Set `AGENT_HUB_USER_DATA` if you open the app yourself.
- Public release: NOT_READY. Missing signing, clean machine, soak, real CLIs, auto-update.
- For the latest review/remote state see section 8 and `docs/handoffs/stabilization/codex-final.md`.

## 8. For Codex

- CODEX_REVIEW_STATE: VERIFIED_FOR_PR
- Final runtime commit: `332b6ed968cc9e2e91adb021ad035fba3dafede5`, dated 2026-11-03. The documentation/build commits after it do not change runtime.
- The user asked Codex to fix the remaining bugs itself and then commit/push, while keeping the PR permission from the original request. Decision: push the branch and open a PR with the verification limits stated clearly; no merge or release.
- Current report: [codex-final.md](docs/handoffs/stabilization/codex-final.md). R1–R10, 12/12 native runs, concurrent exit/close, CLI resume mock, editor-format UI and the sandbox installer passed. Upgraded/pinned upstream node-pty containing the mutex fix; full T01–T28 still has PARTIAL/NOT_RUN, public release NOT_READY.
- Reviewer report, T01–T28/subtask matrix and the follow-up fix prompt for Grok: [codex-review.md](docs/handoffs/stabilization/codex-review.md).
- The first FAIL evidence `codex-review-regressions.json` and earlier rounds are kept as history. Final native confirmation evidence is in `docs/handoffs/stabilization/evidence/final-release-check/results.json`.

## 9. Fixes after review

- Implementation: `53a24d5d29bd65d3a34bb43e420bc2e210931b92` on `fix/workbench-stability`.
- R1: files within the 4 MiB limit are read in full before editing. Larger files get no editor. `write_text` refuses when the loaded copy is shorter than the current file and the mtime is unchanged.
- R2: dirty/conflict buffers are per file. Activating does not read over that buffer. Save keeps a generation so an old response does not mark later typing as saved.
- R3: `write_stored` does not run while `pending_plain` exists. Changing metadata, deleting another provider, or a throwing seal all leave the file untouched.
- R4: the record id is kept on restore. The layout is only written after panes are attached and the tree is re-applied. Same-process fixture measured 653.7/276.7, ratio 0.7026.
- R5: every `set_active_pane` syncs the explorer. File tabs do not change the root. Quick-open asks for the root at event time.
- R6: process exit does not delete the saved record. Restart uses that record, `use_worktree:false`, and does not accept a worktree invented by the renderer.
- Original FAIL evidence kept: `docs/handoffs/stabilization/evidence/codex-review-regressions.json`.
- Passing run after the fix: `docs/handoffs/stabilization/evidence/codex-review-regressions-4edad8c-1793704241034.json`. R1–R6 PASS, exit 0. R2 `statusBeforeSwitch` is `conflict`.
- Intermediate run, before the mtime check was moved earlier: `codex-review-regressions-4edad8c-1793704056937.json`. R1–R6 still PASS but R2 reported `error` because the on-disk file was longer than the loaded copy. Not used as the final result.
- Still NOT_RUN: real app close/reopen with 2/4/6 panes, reload after restart, dirty worktree, `src/foo.js` on two worktrees, soak, dist/install/uninstall, CLI/provider/phone/LAN/VPN, real safeStorage, clean machine, signing.
- Public release: NOT_READY. Not pushed, not merged, not released.

## 10. Codex review round 2

- HEAD `c0c5e37`: 27 Node checks, R1–R6, workbench smoke and 20 lifecycle cycles PASS. New R1–R6 evidence in `docs/handoffs/stabilization/evidence/codex-review-regressions-c0c5e37-1793705137624.json`.
- New fixture `scripts/codex_review_editor_lifecycle.js`: control close/save PASS, R7 conflict on close FAIL and R8 native app close before autosave FAIL; exit 1. Evidence `docs/handoffs/stabilization/evidence/codex-review-editor-c0c5e37-1793705277414.json`.
- Mobile smoke assertions PASS/exit 0 but `AttachConsole failed` from a native helper, repeated even when run alone. Log `docs/handoffs/stabilization/evidence/codex-review-mobile-c0c5e37.log`. Not yet determined whether it is a product or test/helper bug; needs investigation, not to be treated as a clean teardown.
- CHANGES_REQUESTED, no push/PR/merge/release. No implementation changes or commits in this review. Work handed over via `codex-review-round2.md`.

## 11. Fixes after review round 2

- Implementation: `e6e3d86ee10d3bd85ed81d5d3fb018a2b59c1cac`. The evidence below was recorded with HEAD at that commit. The documentation commit after it does not change runtime.
- R7: closing a tab awaits the save. A conflict or write error keeps the tab and buffer. The control case of closing a dirty tab with no external edit still writes `SAVED ON CLOSE`.
- R8: the `BrowserWindow` `close` is held until the renderer finishes flushing. The just-typed file is written before the `closed` event. A conflict raised during that flush cancels the close. A tab already in conflict is not overwritten and does not block quitting.
- C1: the cause is `pty.kill()` on non-DLL ConPTY. node-pty forks `conpty_console_list_agent.js`, the helper calls `AttachConsole` after the console has been destroyed, after the smoke process already exited 0. Product fix: Windows spawn sets `useConptyDll: true`, so the kill path does not create that helper. The mobile smoke tracks the helper if it is still forked and treats a nonzero exit as FAIL; stderr is not swallowed. Clean log: `docs/handoffs/stabilization/evidence/codex-review-mobile-e6e3d86.log` has `ALL CHECKS PASSED` and no `AttachConsole`.
- R1–R6 re-run on this commit: `docs/handoffs/stabilization/evidence/codex-review-regressions-e6e3d86-1793706200146.json`, exit 0.
- R7/R8: `docs/handoffs/stabilization/evidence/codex-review-editor-e6e3d86-1793706192197.json`, exit 0. Original round-2 FAIL evidence kept.
- Still NOT_RUN: soak, dist/install/uninstall, CLI/provider/phone/LAN/VPN, real safeStorage, clean machine, signing, app close/reopen with 2/4/6 panes.
- Public release: NOT_READY. Not pushed, not merged, not released.

## 12. Codex review round 3

- HEAD `28102e3`: 27 Node checks, R1–R8, workbench/mobile smoke and 20 lifecycle cycles PASS. Mobile smoke had no native exception in this run.
- **R9 [P1] FAIL:** a file already in conflict is skipped by `flush_dirty_editors`; native close is allowed and the unsaved buffer is lost, with no user discard.
- Fixture `scripts/codex_review_conflicted_quit.js`; evidence `docs/handoffs/stabilization/evidence/codex-review-conflicted-quit-28102e3-1793706463362.json`; exit 1.
- The old R8 fixture only checked that B was saved, not conflict buffer A on quit; normal-close and known-conflict must be split into independent cases, not skip the conflict to pass the old test.
- CHANGES_REQUESTED. No implementation/commit/push/PR/merge/release in the review. Work handed over via `docs/handoffs/stabilization/codex-review-round3.md`.

## 13. Fixes after review round 3

- Quit no longer skips `conflict` files. Flushing does not overwrite external files. If a conflict, write error or unsaved copy remains, the window stays open and a banner names the file. Only the `Discard my edits` button is an active discard; after that the next close is allowed.
- R8 is separated from R7's conflict: the fixture clicks Discard, checks that A on disk is still the external version, and only then closes the window with B dirty.
- Implementation: `b03fed05e9c42adf2dc3311ff1504a4aaa5f4fd3`. Evidence recorded with HEAD at that commit.
- R9: `docs/handoffs/stabilization/evidence/codex-review-conflicted-quit-b03fed0-1793706961388.json`, the window does not close, the buffer is intact. Original round-3 FAIL evidence kept.
- R7/R8 after an explicit Discard: `docs/handoffs/stabilization/evidence/codex-review-editor-b03fed0-1793706965739.json`.
- R1–R6: `docs/handoffs/stabilization/evidence/codex-review-regressions-b03fed0-1793706974267.json`.
- Public release: NOT_READY. Not pushed, not merged, not released.

## 14. Codex review round 4

- HEAD `34b7ce3`: known-conflict quit R9, explicit discard/normal close R7/R8, R1–R6, 27 Node checks and mobile smoke PASS. Lifecycle 20/20 PASS.
- R10 [P2] FAIL: Discard does not invalidate a queued save snapshot. The slow-IO fixture auditing successful writes recorded `OLD AUTOSAVE TWO` being written after Discard before the autosave wrote back the external version; final contents are correct but there is a temporary overwrite, not a claim of permanent data loss in this case.
- `scripts/codex_review_discard_pending.js`, evidence `docs/handoffs/stabilization/evidence/codex-review-discard-pending-34b7ce3-1793707417778.json`, exit 1.
- The first workbench smoke timed out at `test shells exit`; the separate confirmation run passed. The lifecycle at timeout needs investigating/recording; not to be treated as soak verified.
- CHANGES_REQUESTED. No implementation/commit/push/PR/merge/release in the review. Work handed over via `docs/handoffs/stabilization/codex-review-round4.md`.

## 15. Fixes after review round 4

- Discard bumps `save_epoch` and clears the timer. A queued task that sees an old epoch does not call write. The response of an in-flight write is also dropped if the epoch changed, so it does not overwrite the just-reloaded buffer.
- Implementation: `cbc555df37e239a5a3933224e73f00276dc58706`.
- R10 on that commit: `docs/handoffs/stabilization/evidence/codex-review-discard-pending-cbc555d-1793707930795.json`. `writesAfterDiscard` empty, `writeCount` stops at 1, disk and editor are still `EXTERNAL VERSION TO PRESERVE`. Original round-4 FAIL evidence kept.
- Workbench: the combined run died with `0xC0000005` after the UI checks passed, before the "all checks passed" line. The separate run after it exited 0. Four terminals were still `alive:true` right before sending `exit`. No timeout increase. Soak still NOT_RUN.
- Public release: NOT_READY. Not pushed, not merged, not released.

## 16. Codex review round 5

- HEAD `521e51c`: 27 Node checks, R1–R10 and 20 lifecycle cycles PASS. R10 has no write after Discard (`writesAfterDiscard:[]`, writeCount 1).
- Native shutdown still fails: workbench runs 1/3 exit 0, runs 2/4 exit -1073741819 (0xC0000005). Mobile prints ALL CHECKS PASSED but the process exits -1073740791 (0xC0000409). A smoke is not called clean when the exit is nonzero.
- Logs/evidence `docs/handoffs/stabilization/evidence/codex-review-workbench-521e51c-*.log`, `codex-review-workbench-521e51c-runs.json`, `codex-review-mobile-521e51c.log`, `codex-review-mobile-521e51c-exit.json`.
- C2/T23 needs product/native/harness separated, lifecycle ownership and completion determined, then a rerun without failures. The root cause is not yet determined, nor is it claimed that the product's native close always crashes.
- CHANGES_REQUESTED; no implementation/commit/push/PR/merge/release in the review. Detailed work handed over via `docs/handoffs/stabilization/codex-review-round5.md`.

## 17. Fixes after review round 5

- Implementation: `146576beaaa5e165ba43daf469605c2ffb08670a`.
- Root cause pinned down by logs: the `node-pty` DLL `kill()` calls `ClosePseudoConsole` on an HPCON already passed to `ConptyReleasePseudoConsole`, then `TerminateProcess(hShell)`. The exit watcher closes `hShell` and clears the baton before entering JS. The workbench dies after `pty native exit` and before `pty socket exit` (`shutdown-wb-trace-2.log`, exit `-1073741819`). The live quit path also dies with the same code before the worker stops (`shutdown-control-quit-2.log`).
- Fix: do not call `proc.kill()`. If the process is still alive, `process.kill(pid)`. The native exit callback terminates the conout worker immediately, and `kill_all` waits on that promise. `will-quit` waits for `kill_all` before `app.quit()`. The workbench smoke does `await kill_all()` then `app.exit`. `alive:false` is not used as evidence that native work finished.
- Acceptance: 4 runs per suite, no failed runs dropped, on exactly the committed content (logs recorded right before `146576b`, no code changes in between): workbench exit 0/0/0/0 and "all checks passed"; mobile exit 0/0/0/0 and ALL CHECKS PASSED, no AttachConsole; harness `app.exit` exit 0 and `orphans:[]`; product quit exit 0. Table in `docs/handoffs/stabilization/evidence/c2-runs.json`.
- Re-run after the commit: Node check 27 PASS; R1–R6, R7/R8, R9, R10 PASS (R10 `writesAfterDiscard:[]`, writeCount 1); lifecycle 20/20, live 0. Evidence `codex-review-regressions-146576b-1793710520529.json`, `codex-review-editor-146576b-1793710526404.json`, `codex-review-conflicted-quit-146576b-1793710530439.json`, `codex-review-discard-pending-146576b-1793710537268.json`, `c2-rerun-lifecycle.log`.
- FAIL/AV evidence from round 5 and the investigation runs is kept. Soak, clean machine, real CLI/provider/phone still NOT_RUN. Public release: NOT_READY. Not pushed, not merged, not released.

## 18. Codex's final fixes per the commit/push request

- Runtime `332b6ed`: pin node-pty 1.2.0-beta.17 with the upstream mutex fix; block launches during shutdown, wait for accepted launches/native close, share the concurrent close promise; fall back to the saved Claude session ID. The editor keeps BOM/CRLF and opens unsupported encodings/line endings read-only.
- 27 checks, R1–R10, 20 lifecycle cycles, PTY/output/concurrent exit/child cleanup/admission and the actual editor-format UI all pass. Final native suites 12/12 exit 0, no orphans; production main.js quit verified directly.
- Build from source + verification of source/native hashes and dependency versions before stage/swap. Installer checksum validation before replacing the old version. Sandbox install/reinstall/corrupt upgrade/uninstall pass; a failed upgrade keeps the old exe and the sentinel unchanged.
- pull_request CI checks regression/native/build/install with minimal permissions; remote CI is not counted as PASS before the PR actually runs.
- Details, evidence, historical failures and limits are in `docs/handoffs/stabilization/codex-final.md`. VERIFIED_FOR_PR for the scope that was run; public release still NOT_READY, and PARTIAL requirements are not turned into complete.
