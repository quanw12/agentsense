# Codex review round 4 — CHANGES_REQUESTED

2026-11-03, Asia/Saigon. Branch `fix/workbench-stability`; HEAD `34b7ce321ffd574d03dec7275bcc08bb25696e5c`. Implementation reviewed `b03fed0`, diff `28102e3..34b7ce3`. Working tree clean at the start. The review only adds fixtures/evidence/docs, with no implementation changes/commit/push/PR/merge/release.

**R9 passes:** a known conflict blocks native close and keeps the buffer. Explicit Discard keeps the external file in the case with no pending save. R1–R8 pass on re-run. Bug R10 remains in the new Discard flow, so push/PR is not approved.

## R10 — [P2] A queued save still writes the old edit after Discard

**Code:** `src/renderer/terminal_grid.js:1389–1392,1404–1409,1444–1455`.

`enqueue_save` keeps the snapshot/generation in each task's closure. Discard only resets conflict/dirty/loaded and reloads, without cancelling old snapshots in `save_tail`. `perform_save` uses the old snapshot but reads the new `file.mtime` when the task runs, so after the reload it can write the discarded snapshot over the valid external version. The generation is currently only checked after the write to schedule a new save, not to prevent the old write.

**Independent slow-IO fixture:** real renderer and file IO, temporary profile/files. After a known conflict, pause the first IPC write, keep typing and wait for the second debounce to queue. Click Discard, then release the first request. The test handler still calls the production `write_text`; it only adds a pause to control ordering, without faking write results or changing the implementation.

Results recorded after Discard:

1. Control: disk and editor have `EXTERNAL VERSION TO PRESERVE`.
2. The old task writes **OLD AUTOSAVE TWO** to disk; the fixture reads back and confirms this content right after the successful write.
3. The next autosave writes **EXTERNAL VERSION TO PRESERVE** back.

**This is a reproduced temporary overwrite, not a claim of permanent data loss in the test case.** Agents/file watchers/builds or other apps can observe/act on content the user discarded during that window; if the process stops between the two writes, the disk contains the discarded content. Correct final contents must not be taken as Discard being protected.

**For Grok:** synchronize Discard with queued/in-flight saves; invalidate snapshots from edits before the Discard before they are allowed to write, and make sure old responses do not replace the new metadata/buffer. You can safely wait for the in-flight operation and then reload, or use a suitable save epoch/cancellation. Keep the external-file revision check; never overwrite the external version and never rely on a later autosave to undo a stale write.

**Acceptance:** Discard with 0/1/many pending saves, slow IO, errors/conflicts, tab switch and close/quit during the process. After Discard, no successful write contains the discarded snapshot; the final buffer/disk is the external version. The test allows Discard to wait for in-flight IO; the gate is released independently of the reload timing, so it does not force the implementation to reload immediately.

Fixture `scripts/codex_review_discard_pending.js`, **exit 1**, control PASS/R10 FAIL, no harness error. Most complete evidence: `evidence/codex-review-discard-pending-34b7ce3-1793707417778.json`.

The first run's evidence `...1793707292657.json` only checked final contents so it PASSed, but lacked assertions on temporary writes. Run `...1793707338171.json` added the write audit showing the same bug; the final run added an independent release gate to support a drain-before-reload fix. All history is kept so a weak test is not turned into proof of safety.

## Verification this round

| Check | Result |
| --- | --- |
| `npm run check` | 27 PASS, exit 0 |
| `scripts/codex_review_regressions.js` | R1–R6 PASS, exit 0; R2 captured the `saving` state this time, while fixture R7 confirms a real conflict and keeps the buffer |
| `scripts/codex_review_editor_lifecycle.js` | CONTROL/R7/R7_DISCARD/R8 PASS, exit 0 |
| `scripts/codex_review_conflicted_quit.js` | SETUP/R9 PASS, exit 0 |
| `scripts/codex_review_discard_pending.js` | Control PASS, **R10 FAIL, exit 1** |
| Mobile smoke | All checks passed, exit 0; no native exception in the log |
| Workbench smoke | First run timed out at `test shells exit` in `scripts/smoke_workbench.js:194`; the separate confirmation run PASS/exit 0. The later PASS does not erase the earlier failure |
| Lifecycle | 20/20 PASS, live 0 |

Electron scripts are run with `node node_modules/electron/cli.js <script>`. The separate workbench run's log is at `evidence/codex-review-workbench-34b7ce3.log`; mobile at `evidence/codex-review-mobile-34b7ce3.log`. The R1–R9 JSONs in the evidence folder are tagged with HEAD `34b7ce3`. Historical evidence not altered.

**T23 follow-up:** the one-off shell-exit timeout is not yet attributed to product/native/harness. Grok needs to log terminal IDs, alive/status/lifecycle at the timeout and check the shutdown order. Do not suppress the error or just raise the timeout. One passing separate run does not prove stability; do not report soak/native lifecycle as complete.

Build/package/install/clean Windows/30-minute soak/real CLI-provider-phone and other PARTIAL acceptance checks were not re-run. Public release is still NOT_READY. Continue locally fixing R10, update meaningful regressions and evidence with the new SHA; no push/PR/merge/release in Grok's fix pass.
