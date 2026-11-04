# AgentSense — detailed tasks T01–T28

Assigned: 2026-11-03. Audit baseline: `94257b12aabe4dcb2ec48e1c2c6a74a37c71e1fa`.
Reference repo: `quanw12/AgentSense`. Suggested local branch: `fix/workbench-stability`.
Implementer: Grok 4.7. Final gate: Codex review. **Not yet allowed to push/merge/publish.**

## 0. Acceptance rules

- Read `grok-4.7-prompt.md` and `stabilization-plan.md` before starting.
- T01–T28 map 1:1 to the 28 findings in `docs/handoffs/stabilization/audit.md`.
- The code locations below are starting points for searching; re-verify at the HEAD you are working on, do not fix by hard-coded line numbers.
- Each item needs: root cause; change; before/after check; log/screenshot paths; status; what is still not met.
- Only use FIXED_VERIFIED when every criterion has been verified. Do not treat NOT_RUN/BLOCKED as PASS.
- Testing the source build and the packaged build are two different things. Reloading the renderer and quitting/reopening the app are also two different things.
- Do not touch real data/profiles/agents; fixtures must have a temporary root that is checked before cleanup.
- Every app/dev/exe run for testing uses its own `AGENT_HUB_USER_DATA` in the child process; never the default profile.
- During long work, update `stabilization-results.md`. Local commits may be split by phase,
  but items must not be dropped or requirements quietly reduced.

## Phase A — fixed panes

### T01 — Selecting an agent only changes focus [P1]

**Problem:** Tabs and zoom use FULL_RECT for the selected pane and hide the other panes, contrary to the need to view them at the same time.
**Starting code:** `src/renderer/terminal_grid.js`: place_pane, select_tab, toggle_zoom, focus_session_in_grid;
`src/renderer/sidebar.js`; `src/renderer/terminal_grid.css`.

- [ ] Separate the selected/focused pane from layout/geometry. Clicking the terminal body, a tab, the sidebar and Ctrl+Tab only change focus.
- [ ] Remove fullscreen-switch and double-click maximize from the default flow; selection must not re-enable the old zoom.
- [ ] Migrate `agentsense.workbench` with mode=tabs/zoom to a safe fixed split mode; do not delete the user's workspaces/sessions.
- [ ] Do not use scrollIntoView in a way that scrolls the whole workbench or jolts the screen when the pane is already visible.
- [ ] Keep divider dragging, clipboard, input, keyboard navigation and PTY resizing.

**Acceptance:** with 2/4/6 panes, click and switch focus at least 20 times through the navigation paths;
no pane's bounds change by more than 1 CSS px, the number of visible panes does not drop; no PTY is recreated and no
navigation keys are sent into the shell. Selecting an agent in another workspace only switches to that workspace and keeps its saved layout.
Double-clicking a header does not make a terminal take the whole area either. Run the case with legacy mode=tabs from a fixture profile.

### T02 — Save the layout per workspace [P1, depends on T01]

**Code:** terminal_grid.js: save_ui, create_view, start_divider_drag; storage/session identity.

- [ ] Save the split tree, ratios, slot/order, logical session identity, file area and open tabs/files; do not rely on pane_serial or PIDs that change easily.
- [ ] Restore after renderer reload and app relaunch; old/corrupt/missing-file data must fall back clearly without breaking other sessions.
- [ ] When the window is smaller, apply min sizes/adaptive layout without losing the ratios the user saved.

**Acceptance:** a 70/30 layout and nested splits keep their ratios after reload, app close/reopen and workspace switch;
file tabs that still exist are restored, missing files get feedback; terminal IDs/geometry are not mis-assigned.
Two workspaces with different configurations do not overwrite each other. No API keys in UI state.

### T03 — One file area with multiple tabs; no endless pane splitting [P1, depends on T01–T02]

**Code:** terminal_grid.js: mount_file_pane, open_file_in_grid, insert_into_layout; file_panel.js.

- [ ] The first file opens/reveals the file area at its saved position/size; subsequent files become tabs in the same area.
- [ ] Switching files/closing tabs does not change terminal geometry; clicking a file again reuses its tab, no duplicates.
- [ ] Apply realistic minimum sizes and handle narrow windows; no pane only a few px tall.

**Acceptance:** open 20 files alternating text/image/PDF; the number of split areas does not grow with the number of files;
terminals stay put once the file area is open. No pane below the published min size; closing tabs/the file area
and reloading does not break terminals or lose ratios. Includes bounds/overlap checks and real app screenshots.

### T04 — Separate per-workspace configuration [P2, depends on T01–T02]

- [ ] Remove a single shared mode/layout variable applied to every view; keep truly app-wide preferences separate from per-workspace layout.
- [ ] The Files panel stays on the right; visibility/width/active context are defined and saved consistently.

**Acceptance:** changing the divider/panel in workspace A does not change B; switching A→B→A and relaunching stays correct.
If the old Tabs mode is removed per T01, do not recreate it just to keep the old UI.

## Phase B — sessions, models, worktrees

### T05 — Keep model/provider across restart/restore [P1, coordinated with T18]

**Code:** `src/main/session_store.js`, `pty_manager.js`, `ipc_terminals.js`, launch_page.js, terminal_grid.js.

- [ ] Store the model selection/provider ID and explicitly typed options; the main process resolves env/args on launch/restart/restore.
- [ ] Do not fix it by writing the whole env_extra/API key into sessions.json, presets, localStorage or logs.
- [ ] Migrating old records keeps the default; a deleted/undecryptable provider must report that action is needed, not silently switch provider/model.

**Acceptance:** a mock CLI prints the correct non-sensitive model/endpoint after launch, Restart, renderer reload,
app relaunch and preset; the fixture token never appears in plain text in any state/log/artifact file.
Check that env does not leak between two panes with different providers; real-provider tests are recorded separately, missing accounts recorded as NOT_RUN.

### T06 — Preserve worktree ownership on reattach/restart [P1]

**Code:** pty_manager.js: to_info/close_terminal; terminal_grid.js: attach_info_to_view/restore_spec/restart_pane;
`src/main/worktree.js`.

- [ ] Return/keep the full base_cwd, worktree path, repo, branch and ownership in the contracts that need them.
- [ ] Restart keeps the current worktree context when valid; separate restarting the process from destroying the session/worktree.
- [ ] Never delete a folder the new process is about to use; do not create a new branch to replace the old context on a plain Restart.
- [ ] Never force-remove a worktree with changes, untracked files or its own commits.

**Acceptance:** clean/dirty/committed worktrees, renderer reload then process exit/Restart, app relaunch and
phone-created sessions all keep the correct cwd/branch/context. The audit case `cwd does not exist` no longer occurs.
Actively closing a clean worktree still cleans up safely; dirty/committed worktrees are kept and reported correctly.

### T07 — Keep failed restores for retry [P1]

**Code:** terminal_grid.js: restore_saved_in_grid; `src/main/ipc_sessions.js`.

- [ ] Do not call discard just because a spawn/restore failed temporarily. Keep the metadata and the failure reason.
- [ ] Offer Retry, choosing a suitable folder again, and an explicit Forget; only Forget removes the record, by explicit action.
- [ ] One session failing must not block the others or lose the failed session's model/provider/worktree.

**Acceptance:** temp folder missing/permission denied/CLI missing and then back; the record remains and Retry works.
App relaunch can still show the error/recovery options. Do not silently create another conversation in place of the saved session.

### T08 — Resume according to each CLI's capability [P2, depends on T05–T07 and T12]

- [ ] Declare resume/restart/new-session capability and supported versions for each agent.
- [ ] Agents with a session ID/official resume mechanism: use a proper adapter, test args/session identity.
- [ ] Agents that do not support it or are unverified: state clearly that only the terminal/command is restored; do not present it as continuing the conversation.
- [ ] Claude session ID does not exist: keep the info, explain it and let the user actively open a new session.

**Acceptance:** valid resume ID, missing ID, unsupported CLI version; no silent fallback to a new conversation.
Mock contract tests and real conversation checks are recorded separately. Do not invent resume flags.

### T09 — Presets keep the full configuration [P2, depends on T02/T05/T18]

- [ ] The preset schema has slots/agent/model/provider reference/worktree choice and a suitable layout.
- [ ] Migration of old presets with only agent IDs, missing agents/providers and duplicate preset names are handled clearly.
- [ ] Custom CLIs are kept when presets support them; do not lose the command/label while reporting a successful save.

**Acceptance:** save/load/relaunch of a mixed lineup and a custom CLI reproduces the configuration exactly; no secrets;
one missing agent does not shift a model/provider onto another slot.

### T10 — File tree/preview follows the right worktree [P2, depends on T06]

- [ ] A clear root/context: the base workspace or the selected agent's worktree; name/branch/path visible to the user.
- [ ] Changing focus may change the file context but not terminal geometry; file tabs keep their own root identity.
- [ ] Do not merge two files with the same relative path in two worktrees into one tab with the wrong content.

**Acceptance:** the base repo and two worktrees have `src/foo.js` with three different contents; the file tree, preview/editor,
Open/Reveal and file tabs always point at the right root. A cleaned-up root shows a missing-source state and never reads another root by mistake.

### T11 — Drag files with the right context and paths [P2, depends on T06/T10/T19]

- [ ] The file payload has root/file identity; the target is determined by session ID and actual cwd, not whichever pane happens to have focus.
- [ ] Repo/worktree files with a corresponding path map to the right file in the target worktree, keeping the `src/foo.js` structure.
- [ ] If the source differs or the target does not have it yet, do not silently overwrite or create `foo (1)` at the root;
  have clear behaviour for referencing the source file or importing an attachment. External drops use staging with collision handling.
- [ ] Paste with bracketed paste when the CLI supports it; no Enter, never auto-run a prompt/command. Report a target that exited/closed during the copy.

**Acceptance:** tree/tab/Explorer drops; files with accents, spaces, quotes, multiple files and two roots;
the target worktree gets the right file/content. Only the target receives input; no newline-submit; no overwriting data being edited.
Test the target closing during import, retries not creating endless copies, and per-file errors being fully reported.

### T12 — CLI capability/compatibility matrix [P2]

**Code:** agents.js, launch_page.js, command_check.js and the launch path in main/mobile.

- [ ] Build a table of all 14 current options + custom: executable, version/prerequisites, launch, model, provider,
  resume and actual support status; each adapter uses help/official docs as its source.
- [ ] Block incompatible provider/model configurations; do not assume every CLI accepts `<AGENT>_MODEL` or OPENAI_*.
- [ ] Distinguish installed, prerequisite missing, auth needed, unsupported capability, unverified and ready.
- [ ] The shared catalog/capabilities between desktop/mobile must not drift.

**Acceptance:** contract tests for each mapping, missing executable/old CLI version/invalid config;
the matrix states clearly which real CLIs were launched, which real providers were chatted with, or mock only. 14 cards are not 14 verified agents.

## Phase C — files and performance

### T13 — Preview/editor never shows stale content [P1, coordinated with T28a]

- [ ] Reopening a tab checks for changes on disk; the preview updates automatically when the file changes.
- [ ] An editor with an unsaved buffer: detect external changes/conflicts, never auto-overwrite or lose the buffer.
- [ ] Handle rename/delete/files too large, selection/scroll and old responses racing after newer ones.

**Acceptance:** replace a file with a simulated agent, reopen/switch tabs; the new content appears.
External edit + unsaved edit keeps enough data to resolve the conflict; slow reads never show the result of an old root/tab.

### T14 — Sync the file tree [P2, depends on T10]

- [ ] Watch/invalidate per root with debouncing/batching and disposal; exclude loops/heavy node_modules/.git by a clear policy.
- [ ] Track create/modify/rename/delete from agents or external apps; a changed/missing root does not leak watchers.

**Acceptance:** file events show up correctly after debounce, repeatedly switching workspace/root does not multiply watchers;
a burst of many files causes no render storm and terminal input/output keeps working.

### T15 — Refresh keeps the browsing context [P2, depends on T14]

- [ ] Keep expanded folders, selection, scroll and keyboard focus on refresh/import/watch updates.
- [ ] Vanished files/folders are removed correctly, without orphaned cache or collapsing the whole tree.

**Acceptance:** open three folder levels then refresh/import and rename/delete one branch;
the other branches keep their state, selection is correct and scroll does not jump to the top.

### T16 — Import never drops items silently [P2]

- [ ] Do not slice past the limit and then report partial success as if everything was processed.
- [ ] Either reject the whole batch before copying or split into batches with progress; every item must have a result/explicit rejection.
- [ ] Collisions, failed files and cancel are recorded clearly; partially successful copies stay consistent.

**Acceptance:** 0/1/100/101/250 items; accepted+failed+skipped+cancelled equals the total requested;
UI and backend agree on the counts, duplicate files are not overwritten.

### T17 — Heavy file IO does not block main; progress/cancel [P2]

- [ ] Move heavy list/read/copy work to async/workers with suitable concurrency/backpressure.
- [ ] Progress/cancel/cleanup for import; reasonable size/volume limits, never read an entire large file just to decide on a preview.
- [ ] Never clean up old/out-of-root files on cancel; temp files have clear ownership.

**Acceptance:** fixtures with many files and large files, with sizes/durations recorded;
terminals still get input/output, IPC/mobile do not hang, cancel stops the task and leaves no orphan task.
Measure response time/event loop instead of just saying it feels smooth.

## Phase D — data, file boundaries, mobile

### T18 — Protect API keys [P1 before public release, depends on T05 migration]

- [ ] Use the OS secret store/Electron safeStorage with availability/backend checks; no plaintext fallback when encryption is unavailable.
- [ ] State/presets/sessions/UI only keep references and metadata; the renderer never gets the full API key back via list after saving.
- [ ] Migrate old providers.json safely and atomically with suitable recovery; do not create new backups/logs containing plaintext.
- [ ] Decrypt/migration errors are shown in an actionable way; never auto-delete credentials or use the wrong provider.

**Acceptance:** the fixture token never appears in plain text in JSON/logs/screenshots/artifacts; try unavailable/decrypt failure,
interrupted migration, remove/update provider and relaunch. Use fake credentials, never read real profile keys.

### T19 — Block junctions/symlinks escaping the root [P2]

- [ ] Verify the canonical/real path of root and target; file and directory traversal follow the same contract.
- [ ] Check main-determined roots, path traversal, sibling prefixes, Windows drive/UNC and links outside the root.
- [ ] External import is a separate operation with a user-chosen source; do not break valid drag-drop from outside the workspace.
- [ ] Never return a file URL/Open/Reveal/document conversion for targets outside the allowed root via links.
- [ ] The new editor/save in T28a applies the same boundary to files and parent directories, with no write path out through junctions.

**Acceptance:** the audit's out-of-root junction/symlink test is rejected; in-root symlinks work per policy;
list/read/preview/document/Open/Reveal/import cannot bypass the boundary. Valid workspace/worktree roots still work.

### T20 — One owner of the PTY size [P2]

- [ ] Define the desktop as size owner while the pane is visible; the phone may take over when appropriate under a clear policy.
- [ ] Send/sync terminal dimensions to the remaining viewers; avoid resize ping-pong, resizing a dead PTY, and changing layout just because focus changed.

**Acceptance:** desktop + at least two WebSocket clients with different viewports;
attach/detach/background/rotate/reconnect do not make the size oscillate. Simulated integration tests and two real devices recorded separately.

### T21 — Rate limiting does not lock out valid users collectively [P2]

- [ ] Limit per source/connection with cleanup/bounds; wrong tokens from source A do not lock out source B with the right token.
- [ ] Only trust proxy headers when a proxy is explicitly configured; keep the timing-safe token check, token rotation and checks on every request/upgrade.
- [ ] Avoid rate-limit structures with unbounded memory growth or that let brute force through by changing headers.

**Acceptance:** source A with many wrong tokens, valid source B can still use HTTP/WS;
A stays limited; old tokens after rotation are rejected; expiry/cleanup and source limits are tested.

### T22 — Clear mobile LAN/VPN scope [operational limit]

- [ ] Keep safe defaults and state the LAN/VPN scope accurately; the UI distinguishes loopback from listening on the LAN.
- [ ] Do not claim remote internet/TLS/identity if not implemented. Avoid logging the token URL, add no-store/no-referrer as appropriate.
- [ ] Check auth for static/WS, bind changes, token rotation, reconnect and server shutdown; do not open router/firewall ports or change OS settings for the user.

**Acceptance:** topology tests show exactly which connections can reach it; wrong/missing tokens cannot read/control terminals;
stopping the server drops connections and leaves no listener. Record LAN/VPN as verified or NOT_RUN; no cloud service needs to be built in this task.

## Phase E — lifecycle and release source

### T23 — Investigate the timeout/ConPTY teardown [P1]

- [ ] Instrument each create/exit/kill/reload/cleanup step; reproduce the timeout after 25 checks, determine whether it is the test or the product/native side.
- [ ] Wait on the lifecycle in the right order, cancellation/race-safe, no resize/write into a closing session; idempotent cleanup.
- [ ] Do not fix it by raising timeouts indefinitely, suppressing the AttachConsole error or killing every electron/node process on the machine.
- [ ] Child helpers, hooks, sockets, timers, watchers and worktrees must be disposed according to ownership.

**Acceptance:** at least 20 open/close/restart/reload cycles with multiple panes and one soak run of at least 30 minutes;
record resource/process counts before/after, all test processes exit within the published deadline.
A native Windows test is required to mark FIXED_VERIFIED; mocks cannot replace it. No unexplained timeouts/exceptions remain.

### T24 — Single build source, never ship a stale payload [P1 before release]

**Code:** `package.json`, `scripts/build_app.mjs`, the installer and a new package script if needed.

- [ ] One command orchestrates a fresh build → verify source/version/hash → stage the payload → local package.
- [ ] Do not take an old app/ just because AgentSense.exe exists; add build provenance/a manifest tied to commit and version.
- [ ] The package excludes private profiles/tokens/logs, dev node_modules beyond need and runtime fixtures/audits.

**Acceptance:** deliberately create a stale app/ then run the pipeline; the artifact is the new build or fails clearly;
source/dist/payload/manifest match on version and key files. Do not upload artifacts to the remote.

### T25 — Upgrade/packaging with rollback [P2 before stable]

- [ ] Stage + verify the new version before replacing the running one; backup/swap/restore within ownership limits.
- [ ] Refuse while the app is running; every recursive delete/move verifies the absolute path is inside the install/staging root.
- [ ] Never touch `%APPDATA%\\AgentSense` data; binary rollback and schema/data compatibility are stated clearly.

**Acceptance:** fresh install, A→B upgrade, uninstall; inject failures mid-copy, low disk/permissions/verify failure;
the old version still runs or can be rolled back, sample data intact. Only test with temporary install/shortcut/profile.

### T26 — Version/release infrastructure; local preparation only [assessed per subitem]

- [ ] **T26a Version/provenance:** define prerelease/stable rules, show version/build in the UI, CHANGELOG and a local manifest/hash.
- [ ] **T26b CI:** prepare a workflow for lint/check/regression/native Windows/build/artifact validation; check the YAML/scripts locally.
  If not run remotely, record REMOTE_CI=NOT_RUN; do not push to try the workflow.
  CI checks use minimal permissions; no publish-on-push or mechanisms that auto push/merge/release bypassing the review gate.
- [ ] **T26c Download/release:** draft release notes, checksums, artifact names and download/install/upgrade/uninstall instructions.
  The repo is currently private: record the distribution options pending the repo owner's decision; do not change visibility or create a release.
- [ ] **T26d Signing:** prepare signing integration with result checks; do not invent certs/signatures.
  Missing certificate/secrets: record SIGNING=BLOCKED, do not record the exe as signed.
- [ ] **T26e Updates:** prepare an update design/code with integrity/signature checks and rollback,
  or keep a clearly published manual update for the beta. Untested production automatic updates stay NOT_RUN/BLOCKED;
  manual-update docs are not an implemented auto-updater.
- [ ] **T26f Platform:** only announce Windows x64 once tested; macOS/Linux are not part of this round's support promise.

**Acceptance:** every subitem has its own status and evidence. T26 cannot be FIXED_VERIFIED if a mandatory requirement
is still blocked. Items that can be completed by defining scope must record APPROACH/SCOPE separately; do not rename a missing feature as PASS.

### T27 — Fix the dev script on Windows [P3]

- [ ] Use a suitable cross-platform runner/env; keep devtools enabled only in dev, never leaking into packaged production.

**Acceptance:** npm run dev starts on Windows, npm start and the packaged exe still work normally;
tests do not need to open unrelated shells/windows or affect the app/profile in use.

### T28 — Editor/quick-open and closing verification gaps [assessed per subitem]

- [ ] **T28a Editor/autosave:** text editor in the shared file area, file tabs with the right root, debounced autosave and saved/saving/error states.
  Use revision/conflict checks; never overwrite external changes while the buffer is dirty; keep undo/buffer on errors.
  Preserve supported line endings/encodings, never auto-format the whole file or lose characters/BOM without notice.
  Binary/large/read-only files keep the preview or report clearly. Do not add a large framework by default if the existing solution is enough.
- [ ] **T28b Quick-open:** Ctrl+P finds files by root/context, including dotfiles; with limits/ignore policy,
  keyboard navigation and cancel; never scan the whole drive or block the main process.
- [ ] **T28c Acceptance tests:** drop the expectation that Tabs/zoom hiding panes is correct; add focus-only bounds tests,
  layout persistence, file-group tabs, conflict-safe save and the T01–T27 regressions.
- [ ] **T28d Clean-machine/install:** packaged build on clean Windows/a standard account, missing Git/CLI/Node where relevant,
  paths with spaces/Vietnamese characters, upgrade between two real artifact versions and rollback.
- [ ] **T28e Real integrations:** matrix of real CLIs + auth/providers, LAN/VPN/phone, sleep/wake,
  network loss/change, crash/recovery and multi-agent soak. Without the environment, record NOT_RUN/BLOCKED and how the repo owner can test it.

**Acceptance:** real UI tests and fixture data for editor/conflict/quick-open; native/physical/real-provider
tests with date, version, environment, duration and result. Each subitem has a status; missing verification must not be ticked as complete.

## Phase F — handoff for Codex review

- [ ] Every T01–T28 and each T26/T28 subtask has code/evidence/status; no empty rows or "done" labels without tests.
- [ ] Run the applicable scripts: `npm run smoke:workbench`, `npm run smoke:mobile`, new syntax/lint/check,
  `npm run dev`, local build/package and sandbox install/upgrade/uninstall. State which scripts were replaced and why.
- [ ] The git diff contains no secrets, personal fixtures, dist/app binaries or large audit output; keep the lockfile if dependencies changed.
- [ ] Report branch/base/head/local commits, a summary of changes, known issues, test logs/screenshots and reproduction steps for the reviewer.
- [ ] Record `HANDOFF_STATE=READY_FOR_CODEX_REVIEW`; public release status is assessed separately, never self-set to APPROVED.
- [ ] No push, no merge, no PR/tag/release/deploy. Stop and wait for the reviewer.
