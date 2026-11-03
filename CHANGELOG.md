# Changelog

## Unreleased

- Pin node-pty 1.2.0-beta.17 with the upstream ConPTY handle synchronization fix; wait for native terminal cleanup during close and quit.
- Reject new launches during shutdown, share concurrent close completion, and recover the saved Claude conversation ID on restart.
- Preserve BOM/CRLF when editing; preview unsupported encodings and mixed line endings without rewriting them.
- Rebuild and verify source/native payload hashes before staging app/, and verify installer checksums before replacing an existing installation.
- Add Windows PR checks for editor regressions, native lifecycle, repeated process exits, build and sandbox install/rollback.

## 1.0.0

- Fixed workbench: agent panes stay visible, focus does not resize them, and files open as tabs in one region.
- Session restore keeps model and provider ids. API keys are sealed with the OS secret store.
- Windows package is built from one verified payload. Signing and automatic updates are not part of this build.
