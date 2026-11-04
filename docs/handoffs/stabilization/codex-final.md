# Codex — final fixes and confirmation before push

2026-11-03, Asia/Saigon. Branch `fix/workbench-stability`, starting from `a93c76d4f5b785044f470196379e083929d7649a`. The user asked Codex to fix the remaining bugs itself, commit and push; the PR permission from the earlier request still applies. No merge or release.

Final runtime commit: `332b6ed968cc9e2e91adb021ad035fba3dafede5`. The build/CI/evidence commits after it do not change the verified runtime.

**VERIFIED_FOR_PR within the fixes/workflows verified below. PUBLIC_RELEASE_READINESS is still NOT_READY.** PARTIAL/NOT_RUN rows of the original matrix do not automatically become VERIFIED.

## Final changes

- Confirmed that the global `ptyHandles` race in native node-pty 1.1.0 still crashes despite the JS patch. Pinned upstream **1.2.0-beta.17** containing the mutex fix [#922](https://github.com/microsoft/node-pty/pull/922), described in [issue #921](https://github.com/microsoft/node-pty/issues/921) and the [release notes](https://github.com/microsoft/node-pty/releases/tag/v1.2.0-beta.13). This is an exactly pinned prerelease dependency, not claimed as stable. No manual binary/native code edits in node_modules.
- Kept waiting on the watcher/worker, handled the new node-pty async connection, never report a terminal ready with PID 0. Failed launches are cleaned up; concurrent close calls share one promise covering both native cleanup and worktree handling.
- Shutdown blocks admission first, waits for accepted launches, then cleans up every terminal. Main also stops the mobile/hook listeners and waits for cleanup before quitting. The production lifecycle uses a trace buffer instead of printing PIDs to the console continuously.
- Main resolves the Claude resume ID from the saved record when Restart sends no ID; a mock executable checked argv `--resume <saved-id>`, without real Claude/auth.
- The editor serializes using the original file's CRLF and keeps the BOM. Mixed/legacy line endings or non-UTF-8 bytes open read-only with a notice; data is never silently normalized. Tested through the real UI instead of only the backend with a ready-made CRLF string.
- `npm run build:app` always runs electron-builder first, compares source/JS/native files and dependency versions with the tested build, records hash/version/dirty flag, then stages/swaps. Dependency package metadata is normalized by the builder, so versions are checked first and the packaged metadata is hashed; non-runtime debug/linker artifacts are not part of the comparison.
- The installer checks BUILD.json, the exe and resource checksums before swapping; it refuses the APPDATA root too, and does not recursively remove a new folder expected to be empty. A broken sandbox upgrade leaves the old installation intact.
- pull_request CI with contents:read runs Node/PTY/editor regressions, repeated native suites, build and the sandbox installer. Remote CI is not considered run before the push/PR.

## Verification

Environment: Windows x64, Node launcher v26.13.0, Electron 44.9.0, node-pty 1.2.0-beta.17. CI uses Node 24. All fixtures/profiles/repos/worktrees/shortcuts live in temporary locations; no real profiles or transcripts were changed.

| Check | Result |
| --- | --- |
| `npm run check` | 27 PASS, exit 0 |
| R1–R6 | PASS; R1 must wait for the save to finish and compare the full content, R2 must actually be in the conflict state |
| R7/R8, R9, R10 | PASS; Discard has no stale write, a conflict blocks close, normal close flushes the file |
| `npm run check:pty` | PASS: four final-output cases, four concurrent natural exits, resume argv mock, concurrent close, child process cleanup, shutdown admission/in-flight launch |
| `scripts/check_editor_format.js` | PASS: UI autosave keeps BOM/CRLF, mixed lines and invalid UTF-8 are read-only/byte-identical |
| `npm run check:stability` | **12/12 PASS**: 4 workbench + 4 mobile + 4 native main.js product quit, every process exit 0, no timeout/orphan |
| `scripts/lifecycle_cycles.js` | 20/20 PASS, live 0, exit 0 |
| Packaged resources + native main shutdown | PASS, exit 0, orphans [] |
| Build/source/native hash verification | PASS; verify source and actual tested native runtime dependencies before app/ replacement |
| Sandbox install/reinstall/corrupt upgrade/uninstall | PASS; bad upgrade rejected before replacing the old exe, unrelated sentinel unchanged |
| JS/MJS syntax, `git diff --check` | PASS |
| `npm audit --omit=dev` | 0 reported vulnerabilities; does not cover dev tooling or constitute a full security audit |

Main native evidence: `evidence/final-release-check/results.json` and the 12 process logs. The file records the SHA256 of main.js, pty_manager.js and package.json; checked to match the final runtime. `evidence/final-verified` is the earlier 12/12 run. The new sandbox uses `evidence/final-install-upstream.json`. The new regression JSONs are tagged with parent `a93c76d` because they ran on the working tree before the commit, not pretending to be the original commit content; the final version is tied by source hashes and the commit about to be created.

## Failures kept in history and how they were handled

- `final-native-pass/workbench-3.log` records a 0xC0000005 crash before the dependency upgrade. The JS patch of the old version is not considered to solve the mutex race.
- Some workbench runs had no font-cell metrics yet because the launcher hid the window. The fixture actively shows the window and waits for the correct fit state, without raising deadlines to hide failures.
- Once the window actually renders, PowerShell sends CPR/focus replies into other terminals. Diagnostics confirmed `ESC[5;1R` and `ESC[I`, not dropped input. The assertion only excludes exactly these protocol replies and still requires the path at the right target and no newline.
- Ctrl+C/exit into a shell containing a pasted path without Enter is not a reliable teardown protocol. The smoke uses the product close API and checks cleanup. Natural concurrent exit still has its own test with four clean shells, without dropping native exit coverage.
- The initial build validation caught metadata differences because electron-builder normalizes package.json and debug PDBs are excluded. The final policy checks the corresponding metadata/version and every required runtime file, without requiring debug artifacts. The old app/ is kept when verification fails.
- The first installer run was blocked by the execution policy and is not counted as PASS. The final fixture uses a separate process with the same `-ExecutionPolicy Bypass` as the repo launcher, without changing the machine policy; asserts check the actual exe/shortcut/exit.

## Limits still stated

Not yet run: a 30-minute soak, clean Windows/another account, real conversations/auth/provider/phone/LAN/VPN, sleep/wake and upgrades between two different artifact versions. Sandbox reinstall/rollback of the same artifact does not replace all of T25/T28d. Signing and production auto-update do not exist yet. CLI/model/provider adapters remain limited per the capability matrix. The local build is unsigned; nothing released and visibility unchanged. These limits are stated in the PR, which does not record all of T01–T28 as complete.
