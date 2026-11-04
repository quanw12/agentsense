# AgentSense — stabilization plan before review

Assigned: 2026-11-03. Implementer: Grok 4.7. Reviewer: Codex.
Audited baseline: `94257b12aabe4dcb2ec48e1c2c6a74a37c71e1fa` on `main`.

**Local only. No push, no merge, no PR, no tag/release/deploy.**
Suggested branch: `fix/workbench-stability`. If it already exists, check its origin and changes before continuing.

Goal: fixed agent panes, clicking only changes focus, dragging dividers resizes; fix the confirmed bugs,
and close the verification gaps with evidence or clearly record what is still blocked.

Read `stabilization-tasks.md` for the detailed requirements of each T01–T28.
Record progress and results in `stabilization-results.md`.

- [ ] **1. Prepare and reproduce.** Read the repo guidelines, record HEAD/base SHA and the initial state; create a branch with the right prefix; reproduce with a temporary fixture/profile. Verify: pre-fix results exist, real data is unaffected.
- [ ] **2. Fixed layout — T01–T04.** Separate focus from geometry; keep splits per workspace; one file area with multiple tabs. Verify: clicking/switching agents does not change bounds, divider resize works, reload keeps the ratios.
- [ ] **3. Sessions and context — T05–T12.** Store model/provider selections safely; preserve worktrees and failed sessions; normalize resume/drop/presets. Verify: regression tests with restart, reload, app relaunch and two worktrees with different content.
- [ ] **4. Files, data, mobile — T13–T22.** Sync files, imports with feedback, non-blocking IO, protect keys/paths and control of PTY size. Verify: tests per each item's criteria; do not assume behaviour of CLIs/services not tried.
- [ ] **5. Lifecycle and release source — T23–T28.** Investigate timeouts, reproducible packaging, rollback, dev script, editor/quick-open and coverage. Only prepare a local build/manifest; record BLOCKED/NOT_RUN when external conditions are missing.
- [ ] **6. Final verification and review handoff.** Run the test suite under the new UX contract, build the app, try install/upgrade/uninstall in a sandbox; record SHA/logs/screenshots and everything not yet passing. Stop at `READY_FOR_CODEX_REVIEW`, absolutely no push.

Steps are broken down further during the work. Do not lower the scope, drop IDs, change criteria to make tests green,
or treat mock tests as a substitute for native/real CLI tests.

Only the reviewer may conclude `APPROVED_FOR_PUSH`; Grok may only conclude that it is ready for review.
