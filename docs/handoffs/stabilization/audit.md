# AgentSense — confirmed issues and verification gaps

Code: `main`, `94257b1`. Reviewed: 2026-11-03.

Priority P1: affects the main usage flow or must be handled before a public beta.
P2: functional/sync bugs or risks to handle before stable. P3: missing conveniences/process.
The **reproduced** label means a separate check was run; **source** means the mechanism was confirmed from code;
**inconclusive** means the symptom is real but the cause is not yet determined.

## Layout requirements settled from user feedback

- Each agent has a fixed area, and panes can be viewed at the same time.
- Clicking a pane, a tab or an agent in the sidebar only changes focus/highlights the corresponding pane.
- Clicking to check on an agent does not maximize it, hide other agents or rearrange the layout.
- Drag the dividers to grow/shrink; save ratios and positions per workspace.
- Open files in one preview/editor area with tabs, avoiding an extra split for every file.

## UI and layout

1. **[P1, reproduced] Selecting an agent can swap in a pane that takes the whole work area.**
   Tabs only shows one pane with FULL_RECT; while zoomed, select_tab moves the zoom state to the newly selected pane.
   Normal split, not zoomed: the click check shows sizes unchanged. The jump depends on the
   Tabs/zoom state the app keeps; the current interaction does not fit the user's fixed-layout requirement.
   Code: `src/renderer/terminal_grid.js:1355`, `:1500`, `:1641`.

2. **[P1, reproduced] Split ratios are lost after reload/restart.**
   Dragged two panes to about 595/335 px; reload returns them to about 465/465 px.
   save_ui only saves the file panel, panel width and mode, not the split tree, ratios, positions, open files or the selected pane.
   Code: `src/renderer/terminal_grid.js:46`, `:1400`.

3. **[P1, reproduced] Opening many files splits panes until they are unusable.**
   Each new file splits below the selected pane. Opening six files in a row creates areas about
   174, 84, 39, 16 and 5 px tall. The size limit when dragging dividers does not prevent inserting a new split below the minimum.
   Code: `src/renderer/terminal_grid.js:1092`, `:1250`.

4. **[P2, source] Tabs/Split mode is shared state for every workspace.**
   Changing the mode in one workspace updates the others; the value is saved and used on the next app launch.
   Users do not get a fully independent layout configuration per project.
   Code: `src/renderer/terminal_grid.js:364`, `:410`.

## Agent sessions, models and worktrees

5. **[P1, reproduced at record level] Per-session model/API is not kept across restore/restart.**
   env_extra is used on the first launch but dropped from the session record. Restart does not pass the chosen env again either.
   Tried make_record with a sample model and endpoint: the result no longer has env_extra.
   Code: `src/main/session_store.js:38`, `src/main/pty_manager.js:193`,
   `src/renderer/terminal_grid.js:1878`.

6. **[P1, reproduced] A worktree can fail to Restart after a renderer reload.**
   to_info does not return worktree/base_cwd; reattach creates a pane missing that metadata. When that session has exited and the user Restarts,
   close_terminal cleans up the clean worktree and then the renderer launches with the cwd that was just removed.
   Actual result: `cwd does not exist`; the clean worktree folder was removed, with no dirty-file deletion bug in this test.
   Code: `src/main/pty_manager.js:101`, `src/renderer/terminal_grid.js:204`, `:1878`.

7. **[P1, source] A failed restore drops the saved record automatically.**
   If relaunching fails, for example because the folder is temporarily inaccessible, the renderer calls sessions.discard.
   There is no flow that keeps the failed session for Retry/Locate folder; recovery info is dropped even though the user never chose to forget the session.
   Code: `src/renderer/terminal_grid.js:1824`.

8. **[P2, source + earlier observation] Restoring a pane is not conversation resume for each CLI.**
   The app has a resume argument specific to Claude; the other CLIs are rerun with the saved command,
   with no per-agent resume mechanism. A Claude session in the real profile earlier reported its session ID as not found.
   Code: `src/main/pty_manager.js:143`, `src/renderer/terminal_grid.js:1847`.

9. **[P2, source] Presets only save the list of agents.**
   Presets do not keep the model, provider, worktree choice or layout/ratios; users have to choose these again.
   Code: `src/renderer/launch_page.js:539`.

10. **[P2, source] The file tree uses the base workspace even when the agent runs in a worktree.**
    Files the agent edits in the worktree are not the files shown in the base repo's tree/preview.
    There is no file context per selected worktree, so it is easy to look at the wrong version of a file.
    Code: `src/renderer/terminal_grid.js:589`.

11. **[P2, source + earlier drop test] Dragging a base-repo file into a worktree creates a copy at the cwd root.**
    Relative folder paths are not mapped. For example `src/foo.js` can become `<worktree>/foo.js`,
    or a name with `(1)` on collision. That is attachment staging, not selecting the worktree's own `src/foo.js`.
    Code: `src/renderer/terminal_grid.js:775`, `src/main/ipc_files.js:213`.

12. **[P2, verification gap] CLI integration lacks full adapters/tests for each agent.**
    Availability only checks for the executable on PATH. Model/API are mostly passed via generic environment variables;
    there is no compatibility table and per-agent provider validation, login check or CLI version check.
    It cannot be inferred that all 14 options have run real conversations just from the PowerShell smoke test.
    Code: `src/main/command_check.js`, `src/renderer/launch_page.js:765`, `src/renderer/agents.js`.

## Files and performance

13. **[P1, reproduced] The preview keeps stale content after the file on disk changes.**
    Open a file, change its content externally, click to open it again: the old content is still shown because the app only focuses the existing pane.
    In an app where AI edits code, this makes users misjudge the latest result.
    Code: `src/renderer/terminal_grid.js:1098`, `:1183`.

14. **[P2, reproduced] The file tree does not update when an agent creates a file.**
    A new file created on disk does not appear until Refresh/import. There is no watcher or automatic sync on changes.
    Code: `src/renderer/file_panel.js:90`, `:395`.

15. **[P2, source] Refresh/import loses the state of open folders.**
    load_root_rebuild clears the cache and children_open; the folder tree is rebuilt from the root.
    Code: `src/renderer/file_panel.js:90`.

16. **[P2, reproduced] Imports over 100 items are silently truncated.**
    Sent 101 sample files: only 100 successful results, with no separate result/warning for item 101.
    Code: `src/main/ipc_files.js:217`.

17. **[P2, source/risk] Synchronous IO and no progress/cancel for large file operations.**
    List/stat/read/copy run synchronously in the main process; folder copies use fs.cpSync.
    Heavy operations can block the main process, affecting IPC/terminals/mobile. The size threshold causing slowness on other machines is not measured.
    Code: `src/main/ipc_files.js:72`, `:132`, `:233`.

## Data, file boundaries and mobile

18. **[P1 before public release, source] API keys are stored as plain JSON.**
    providers.json contains api_key directly, without using the OS secret store.
    Code: `src/main/providers_store.js:55`.

19. **[P2, reproduced] Path checks do not prevent junctions pointing outside the workspace.**
    In a temporary fixture, the junction `<workspace>/linked-outside` points to another folder;
    files.read could read the sentinel file outside. The current check only looks at the path string, not the real path.
    This is a bug against the workspace constraint the module describes; the test read no personal data and does not prove a remote attack.
    Code: `src/main/ipc_files.js:47`, `:132`.

20. **[P2, source] Desktop and mobile both resize the same PTY, with no size-owner mechanism.**
    Both UIs send resizes to the same terminal; there is no contract choosing which viewport controls the process size.
    This can cause mismatched wrap/reflow between screens. Not reproduced with two physical devices.
    Code: `src/main/mobile_server.js:428`, `src/main/ipc_terminals.js:20`.

21. **[P2, source] The mobile rate limit locks out every new connection collectively.**
    Three wrong tokens lock the server for 30 seconds; users with the right token cannot make new connections during that time either.
    This is a limit of the shared rate-limit design, not an authentication bypass.
    Code: `src/main/mobile_server.js:200`, `:205`, `:269`, `:325`.

22. **[Operational limit, source] Mobile uses HTTP/WS and a token in the URL.**
    Fits the LAN/VPN model the README describes; there is no HTTPS/identity infrastructure for a public remote service.
    Code: `src/main/mobile_server.js:134`, `src/main/ipc_mobile.js:30`.

## Testing, packaging and release

23. **[P1, cause inconclusive] A workbench smoke run timed out during cleanup/session close.**
    The earlier release audit run got through 25 checks and then stopped at the 120-second limit; the final check did not complete.
    The mobile test passes but logs AttachConsole failed from the node-pty helper at teardown.
    Not enough data to conclude a native bug, an app lifecycle bug or a test bug; needs investigation and a regression test.

24. **[P1 before release, reproduced by hash] The `app/` payload is older than source/dist.**
    Source and dist contain terminal_grid.js with the same hash, app/ has a different hash. The installer reads app/;
    taking the zip from this folder could ship stale code by mistake.
    Code: `install.ps1:84`, `scripts/build_app.mjs`.

25. **[P2 before stable, source] Upgrades have no atomic rollback.**
    The installer uses robocopy /MIR directly into the installation; no staging of the new version + backup/swap/restore.
    Building the payload also deletes app/ before copying finishes. Power loss/low disk mid-copy not tested.
    Code: `install.ps1:115`, `scripts/build_app.mjs:20`.

26. **[Release gap] No complete pipeline/tag/artifact and download channel yet.**
    The checkout has no .github/workflows, CHANGELOG or git tag. The tested exe is not code-signed;
    no auto-updater, auto-generated checksums/release notes or version/build info in the UI.
    The GitHub connector in the release audit round confirmed the repo is private.
    Only a Windows build exists; macOS/Linux have not been ported/tested to announce support.

27. **[P3, reproduced] npm run dev fails on Windows.**
    The script assigns env using Unix syntax; running it reports `'AGENT_HUB_DEVTOOLS' is not recognized`.
    Code: `package.json:19`.

28. **[Missing features/coverage] Preview and smoke tests do not yet meet the full target experience.**
    No editor/autosave/quick-open as in the reference screenshots. Not tested on clean Windows,
    long-running multiple real CLIs, sleep/wake, network loss/change, crash/recovery or upgrades between two real releases.
    The test suite still asserts that switching tabs hiding other panes is correct: it checks the design as written,
    not the new requirement of keeping a fixed layout. The acceptance criteria need fixing together with the interaction design.

## Suggested order of work

1. Settle the fixed-pane interaction, one file area with tabs, dragging dividers to resize; save splits per workspace.
2. Fix saving/restoring model/provider and worktree metadata; keep failed sessions for retry.
3. Sync tree/preview with the right worktree; fix drop path mapping and import feedback.
4. Investigate teardown, long-running tests, heavy IO handling and protecting data/API keys.
5. Package from one verified source, add a version/release pipeline and trial a beta on a clean machine.

## Evidence and scope

- `audit-workbench.cjs` / `audit-workbench-results.json`: real renderer + main, short-lived cmd terminals,
  temporary repo/worktree/profile; reproduces click/zoom, resize then reload, stale preview, new file not appearing,
  a ~5 px tall pane and the worktree restart reporting a missing cwd.
- `audit-files.cjs` / `audit-files-results.json`: synthetic file fixture, 101-item import and a sample session record.
- `release-readiness-2026-11-03.md`: fresh install/upgrade/uninstall results, dependency audit and distribution status.
- No product code was changed in this review. The main working tree was kept clean.
