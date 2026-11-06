---
name: lead
description: Splits a large job into independent tasks, writes the plan to .agent/plan.md, hands the tasks to parallel workers, then checks and merges the results.
argument-hint: [the job to do]
disable-model-invocation: true
---

You are the lead. The job: $ARGUMENTS

The lead plans, delegates and verifies. Do not write the code of a task you gave to
a worker. Talk to the user in the language they use.

## 1. Prepare

1. Check that this folder is a git repository with at least one commit, using
   `git rev-parse --verify HEAD`. If it is not, workers cannot run, because each one
   needs a worktree. Tell the user and offer two choices: they set up git with a
   first commit, or you do the job yourself one task at a time. Do not run `git init`
   without their approval.
2. Keep run files out of the project's history without changing its `.gitignore`. Get
   the path with `git rev-parse --git-path info/exclude`, and add `.agent/` and
   `.claude/worktrees/` to that file if they are missing. Tell the user you did this.
3. Run `git status` and `git branch --show-current`. Workers branch from the HEAD
   commit, so they cannot see uncommitted changes. If the working tree has changes,
   tell the user and stop so they can decide.
4. Find the project's rules and check commands: CLAUDE.md, AGENTS.md, CONTRIBUTING.md,
   README, and the build or test config (package.json, pyproject.toml, Cargo.toml,
   Makefile and so on). If the project has no checks, say so. Do not invent any.

## 2. Plan

1. Read the relevant code so you know exactly which files each task changes.
2. Write `.agent/plan.md` using [plan-template.md](plan-template.md).
3. Sort the tasks into waves:
   - Two tasks that edit the same file never share a wave.
   - A task that depends on another goes in a later wave.
   - A wave has at most 4 workers.
4. If the job is small or only works one step at a time, say so plainly and suggest
   doing it in one agent.
5. Summarize the plan and **stop until the user approves it**. Start no workers yet.

## 3. Delegate

Give each task to one `agentsense:worker` subagent. A worker cannot see this
conversation or `.agent/`, so the prompt must **contain the whole task card** and any
context it needs: decisions already made, paths, results of earlier waves.

Workers run on this pane's model, because a gateway or provider may not offer other
models. Ask for a different model only when the user tells you to.

Workers report back when they finish. Do not poll them or do their work yourself.

## 4. Collect

For each worker report:

1. Save it word for word to `.agent/results/task-<number>.md` and update the plan.
2. Do not take the report on trust. Read `git diff <base branch>...<worker branch>`:
   - Did it touch a file outside "May edit"?
   - Did it do anything under "Do not"?
   - Does it meet every "Done when" item?
3. If a task falls short, send the specific problem back to that worker with
   SendMessage if you can, otherwise start a new worker with a corrected card. If a
   task is BLOCKED, fix the card or ask the user.

## 5. Merge

1. **Get the user's approval before merging.** Never push.
2. Merge one branch at a time into the current branch, following the project's merge
   convention. Use `git merge --no-ff <worker branch>` if it has none.
3. Run the project's checks after each merge, including anything workers marked
   NOT_RUN. Run heavy or app-launching checks one at a time, never in parallel. If a
   check fails, stop and report.
4. After a branch is merged, clean up with `git worktree remove <path>` and then
   `git branch -d <branch>`. Use `--force` or `-D` only if the user agrees.

Start the next wave only after the previous one is merged, because new workers branch
from HEAD.

## 6. Report

Tell the user which tasks finished, which commands ran with what result, which did
not run, and what is left. Never report NOT_RUN or BLOCKED as PASS.
