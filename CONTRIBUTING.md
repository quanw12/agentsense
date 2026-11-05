# Contributing to AgentSense

## Branch model

One branch per task, merged into `main` with `--no-ff` so every feature reads
as one merge commit:

| Prefix   | Use for                                   |
| -------- | ----------------------------------------- |
| `feat/`  | new functionality                          |
| `fix/`   | bug fixes                                  |
| `docs/`  | README, guides, screenshots                |
| `build/` | packaging, CI, dependencies                |
| `chore/` | refactors and repo housekeeping            |

```bash
git checkout -b feat/my-task main
# ... work, commit ...
git checkout main && git merge --no-ff feat/my-task
```

## Commits

Conventional commits, lowercase, imperative:

```
feat(panes): add per-pane git worktree isolation
fix(pty): survive conpty teardown on fast exit
docs(readme): document build from source
build(electron): pin electron 44.9
```

Scope names follow the folder: `panes`, `sidebar`, `launch`, `worktrees`,
`hooks`, `state`, `electron`, `repo`.

## Local checklist before opening a PR

```bash
npm install
npm run start     # app opens, terminal panes spawn
npm run check
npm run check:pty  # final output, concurrent exit/close, resume and shutdown admission
npm run check:stability  # repeated native smoke processes; checks real exit codes
npm run build:app  # rebuild and verify the installer payload
```

No linter is wired up yet — keep the existing code style (plain CommonJS in
the main process, classic scripts in the renderer, sentence comments).

## Using the agent kit on this repo

`/agentsense:lead` follows this file. A few things are specific to this repo:

- A worker's worktree has no `node_modules`. `npm run check` needs only Node, so
  workers run it. The lead runs `check:pty`, `check:stability` and the `smoke:*`
  scripts one at a time after merging.
- When you run `check:pty` from inside a Claude Code session, clear
  `NoDefaultCurrentDirectoryInExePath` first. Otherwise cmd.exe skips the mock
  `claude.cmd` and the check times out at "mock Claude launch".
- When you start the app to test it, point `AGENT_HUB_USER_DATA` at a temporary
  folder so your real profile is not touched.
