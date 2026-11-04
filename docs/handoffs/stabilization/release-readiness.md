# AgentSense — release readiness assessment

Date: 2026-11-03. Code checked: `main`, commit `94257b1`.

## Conclusion

Suitable to continue internal testing. Not enough evidence yet to call it a stable build for a wide audience.
The points below should be fixed, then a Windows x64 prerelease shipped to a small group of testers.

## Actual test results

| Area | Result |
| --- | --- |
| Code update | Local main fast-forwarded to origin/main; working tree clean |
| Workbench | 25 checks passed; the new run timed out at 120 seconds after the renderer-errors check, during session cleanup/close; the final worktree-preservation check did not finish |
| Mobile | All HTTP/WebSocket, auth, attach/input and session create/close checks passed; AttachConsole failed logged from the node-pty helper at teardown |
| Fresh install | Passed, using the real Electron payload, with the install target and shortcuts in a temporary folder |
| Upgrade | Passed, leftover old files removed and sample profile data kept intact |
| Uninstall | Passed, app and shortcuts removed; sample data kept intact |
| Dependency audit | npm audit --omit=dev reports 0 advisories; this does not replace a full app audit |
| Windows binary | dist/win-unpacked/AgentSense.exe exists; digital signature: NotSigned |

The installation tests ran on the development machine with temporary folders/profiles, not on clean Windows.
The installed copy in use, personal data, GitHub visibility and releases were not changed.

## To handle before release

1. **Determine the timeout when closing sessions.** The suite passed in an earlier run, but this run did not complete.
   Need to separate a test cleanup bug from an app ConPTY lifecycle bug, then test repeated open/close.
2. **Keep the model/API configuration on restart.** `seat_spec` passes env_extra when creating a session,
   but session_store does not save this field; restore/restart does not rebuild the configuration.
   Confirmed by calling make_record with a sample env_extra: the field is dropped.
   The fix should save the model/provider choice and protect secrets appropriately, avoiding writing more plain API keys into session records.
3. **Sync the release payload.** The hash of terminal_grid.js in `app/` differs from source;
   the hash in `dist/win-unpacked/resources/app/` matches source. The installer takes its payload from `app/`.
   The release process must build fresh, sync the payload, check version/hash and only then create the zip.
4. **Standardize version and artifacts.** No .github/workflows, git tag or CHANGELOG in the checkout yet.
   Need a tag-driven build/test process, versioned artifact names, checksums and release notes.
   Upgrading today means downloading the new version and rerunning the installer; there is no auto-updater.
5. **Choose a public download location.** The GitHub connector confirms the repository is private.
   Need a distribution channel the target users can access; visibility was not changed.

## Before a stable release

- Test on clean Windows, a standard account, paths with spaces/Vietnamese characters,
  machines missing CLIs/Git, upgrades between two versions and session recovery after the app closes abnormally.
- Test real conversations with the main CLIs and run many agents over a long period.
- Protect API keys: providers_store currently writes api_key directly into providers.json.
- Consider code signing to improve the download/run experience on Windows.
- Trial via the `v1.0.0-beta.1`, `v1.0.0-beta.2` channel, then `v1.0.0` once stability criteria are met.

## Related code

- `scripts/smoke_workbench.js`, `scripts/smoke_mobile.js`
- `install.ps1`, `uninstall.ps1`, `scripts/build_app.mjs`, `package.json`
- `src/renderer/terminal_grid.js`: seat_spec, restore_saved_in_grid, restart_pane
- `src/main/session_store.js`: normalize_record, make_record
- `src/main/providers_store.js`: write_providers
