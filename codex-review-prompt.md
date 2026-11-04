# Review prompt after Grok's handoff

Review and verify Grok's local changes to AgentSense against:

- `stabilization-tasks.md`: the T01–T28 contract.
- `stabilization-results.md`: the evidence recorded by the implementer.
- `docs/handoffs/stabilization/audit.md`: findings from before the fixes, not the current results.

Only review/verify in this pass. **Do not push, merge, create a PR, tag, release, deploy or change visibility**,
even if the review has no findings left. An APPROVED_FOR_PUSH verdict is a review result; it does not mean you push.

## Sequence

1. Read the repo guidelines, git status, branch, base/head SHA and local commits. Do not reset/clean/overwrite changes.
   Verify the real base SHA; the old audit baseline `94257b12aabe4dcb2ec48e1c2c6a74a37c71e1fa` is only a reference point.
2. Read the diff and the related call paths; do not rely only on Grok's summaries or FIXED_VERIFIED labels.
   Check both uncommitted changes and new files. Do not run new scripts before reading them to understand their impact.
3. Review each of T01–T28 and the T26/T28 subtasks. Record a separate reviewer verdict for each: VERIFIED / PARTIAL /
   FAILED / NOT_RUN / BLOCKED. Check migration, backwards compatibility and data-loss risk.
4. Reproduce independently on a temporary fixture/profile/repo/worktree. Do not stop, read transcripts of, or change real agent data.
5. Verification priorities: a click only changes focus and does not change bounds; divider resize + restore;
   one file area with tabs; correct model/provider across restart; worktrees are never wrongly deleted;
   preview/editor uses the right root and content; conflict-safe save; no secret leaks; junction boundary;
   correct drop target; cleanup/native lifecycle; source/dist/payload come from the same build.
6. Read and run the meaningful regression/smoke tests. Check there are no mocks/suppressions/raised timeouts hiding failures,
   tests that only check the implementation, or tests that keep old UX expectations. Verify deadlines/teardown and that real test failures exit nonzero.
7. Check the clean-machine/real CLI/provider/device/soak evidence: source, date, versions and results.
   Do not turn mock results or missing devices/accounts into PASS. Missing signing/public hosting must not be recorded as released.
8. Check the installer, rollback, permissions, artifact manifest and bundled data without publishing anything.

## Review handoff

- Findings by impact, with current file/line, trigger, impact and how to verify.
- A complete reviewer matrix for T01–T28 + subtasks, clearly marking what Grok reported done without enough evidence.
- Commands run, results, environment and limits.
- Separate verdicts: local code quality; verified scope; public release readiness.
- Update the Codex section of `stabilization-results.md`, stating which HEAD was reviewed.
- Set CHANGES_REQUESTED if regressions/bugs or misreported statuses remain.
  Only set APPROVED_FOR_PUSH when the code matches the agreed scope and every remaining gap is stated clearly,
  without hiding an unfinished requirement. A functional requirement that is still broken must be CHANGES_REQUESTED/PARTIAL,
  not dropped from scope to approve. APPROVED_FOR_PUSH does not mean APPROVED_FOR_PUBLIC_RELEASE.
- Stop at the review verdict; do not push or release.
