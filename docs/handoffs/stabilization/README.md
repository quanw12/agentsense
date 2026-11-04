# Input dossier for the AgentSense stabilization round

The files in this folder are evidence from the audit round, not results of Grok's completed fixes.
Code reference point: `94257b12aabe4dcb2ec48e1c2c6a74a37c71e1fa`, dated 2026-11-03.

- `audit.md`: 28 recorded issues/limits, labelled reproduced/source/inconclusive.
- `release-readiness.md`: the earlier installation and distribution assessment.
- `evidence/audit-workbench-results.json`: results of the temporary Electron/main/terminal fixture.
- `evidence/audit-files-results.json`: results of the file/junction/import/session record fixture.

Machine paths in the evidence are old fixture paths, not targets to fix/delete.
Reproductions must create new fixtures. Do not change the original results to show that a fix passes.

The implementation documents are at the repo root:

1. `grok-4.7-prompt.md`
2. `stabilization-plan.md`
3. `stabilization-tasks.md`
4. `stabilization-results.md`

Final rule: local branches/local commits are allowed; **no push/merge/PR/tag/release/deploy**.
Codex reviews the code and evidence before deciding the next remote step.
