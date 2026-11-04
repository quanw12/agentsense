# Codex review round 5 — CHANGES_REQUESTED

2026-11-03, Asia/Saigon. Branch `fix/workbench-stability`; HEAD `521e51c4c061a5c2932dc19a2ba0a2476a460f70`, new implementation `cbc555d`. This round's diff `34b7ce3..521e51c`. Working tree clean at the start. The review does not change the implementation, commit, push, create a PR, merge or release; it only adds evidence/docs.

**R10 now PASSES, and R1–R9 show no regression in the re-run cases. The native shutdown bug recorded last round still reproduces, so push/PR is not approved. This continues the T23/C2 investigation; it is not a new editor bug.**

## R10 confirmed

Read the epoch guard before the task/write and after the response, along with Discard bumping the epoch/clearing the timer. Re-ran the original slow-IO fixture: `writeCount:1`, `writesAfterDiscard:[]`; editor/disk keep the external version. Evidence `evidence/codex-review-discard-pending-521e51c-1793708112146.json`, exit 0. The transient-write assertion was not weakened and results were not mocked.

## C2/T23 — [P1] Native shutdown still crashes even though assertions pass

**Code/paths to investigate:** `src/main/pty_manager.js:245,319,384,460`; `main.js:209`; `scripts/smoke_workbench.js:193–225`; `scripts/smoke_mobile.js:213–216`.

Workbench ran four times on exactly the current HEAD:

| Run | Process exit | Result |
| --- | --- | --- |
| 1 | 0 | All checks passed |
| 2 | **-1073741819 = 0xC0000005** | UI assertions pass, log stops after `shells before exit`, never reaches `all checks passed` |
| 3 | 0 | All checks passed |
| 4 | **-1073741819 = 0xC0000005** | Same phase as run 2 |

Runs 2–4 ran back to back, not rerun just to turn a failure into a PASS. Separate logs `evidence/codex-review-workbench-521e51c-1.log` to `-4.log`; exit codes for runs 2–4 in `evidence/codex-review-workbench-521e51c-runs.json`. The first run was a separate tool process with a checked exit 0.

The mobile smoke printed **ALL CHECKS PASSED** this time, but the tool process returned **-1073740791 = 0xC0000409**. Log `evidence/codex-review-mobile-521e51c.log` and exit metadata `evidence/codex-review-mobile-521e51c-exit.json`. No `AttachConsole` in the log does not mean native teardown succeeded. The old C1 helper exception and the current native exit codes must be kept apart.

**Scope of the verdict:** proven that the Electron/native smoke processes exit with errors during the shutdown lifecycle. The root cause — product/node-pty/native runtime or the harness's teardown — is not determined; no claim that the user app's native close definitely crashes. 20 create/close cycles passing do not cover shutdown/reload/multiple panes in the workbench.

**For Grok, prioritize this before handing back:**

1. Reproduce on the same HEAD/Windows logging the **actual exit code**, not relying on the PASS line. Instrument exit/kill/native worker/conout cleanup and the moment the process quits; log terminal IDs, state, PID/child ownership at failure. If a native dump/stack is needed, collect it only on fixtures, never transcripts/secrets/user processes.
2. Compare normal native BrowserWindow close/app quit with the harness's `app.exit`/`process.exit`, multiple panes and renderer reload. Separate product/native defects from harness defects with an independent control case. Do not conclude from an empty Map or `alive:false` alone: the app flips these flags itself before native cleanup has definitely finished.
3. Review `close_terminal`/`kill_all`: the promise currently resolves on the JS/worktree work, not proving the native process/socket/worker has drained. Main `will-quit` does not wait for `kill_all`; the workbench calls kill_all then app.exit; mobile awaits kill_all then process.exit. These are points to verify, **not a confirmed root cause**. Also review the `useConptyDll` change from the previous round and onExit handling.
4. Fix ownership and teardown order correctly, idempotent/race-safe. If only the harness is wrong, fix the harness and prove the native product close is clean; if the product is wrong, fix the product with a regression. Do not suppress stderr/exceptions, swallow nonzero exits, kill machine-wide or add arbitrary long sleeps/timeouts to report PASS.
5. Acceptance: bounded repetition of many workbench/mobile runs and native product close, recording every pass/fail/exit and owned child/process/handle counts before/after. After the fix there are no unexplained native error exits and no orphans; re-run R1–R10/Node checks/lifecycle. Soak not run stays NOT_RUN.

## Other checks

| Check | Result |
| --- | --- |
| `npm run check` | 27 PASS, exit 0 |
| `scripts/codex_review_regressions.js` via Electron | R1–R6 PASS, exit 0; R2 in the conflict state |
| `scripts/codex_review_editor_lifecycle.js` via Electron | CONTROL/R7/R7_DISCARD/R8 PASS, exit 0 |
| `scripts/codex_review_conflicted_quit.js` via Electron | SETUP/R9 PASS, exit 0 |
| `scripts/codex_review_discard_pending.js` via Electron | Control/R10 PASS, exit 0 |
| `scripts/lifecycle_cycles.js` via Electron | 20/20 PASS, live 0, exit 0 |
| JS syntax of this round's diff; `git diff --check` | PASS before the report update |

Electron scripts are run with `node node_modules/electron/cli.js <script>`. The R1–R10 JSONs tagged with HEAD `521e51c` are in the evidence folder. Historical FAIL evidence not altered. Profiles/files/repos/worktrees are all temporary fixtures.

Build/package/install/clean Windows/30-minute soak/real CLI-provider-phone were not run in this review; public release is still NOT_READY. Grok continues locally, records the new SHA and full evidence and then hands back to Codex; no push/PR/merge/release in the fix pass.
