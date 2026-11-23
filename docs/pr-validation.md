# Recovered shared-conversation milestone: publication validation

Date: 2026-10-29. Base: `f7fb2cd` on `main`.

## Scope

Publish the previously uncommitted Milestone B implementation, fixtures and
evidence, plus the C01 personal-chat design. This is not C02a implementation:
C02a and later Personal-chat work remain unchecked in `next-steps.md`.

The recovered changes include the shared Durable conversation projection and
bounded reads/imports, approval occurrences and durable answer receipts,
protocol-6 HTTP interface, additive Android schema-5 cache and client integration,
HTTP-only terminal attachment, and cross-client recovery fixtures. Existing coding
project/worktree identity and non-replay safeguards remain design requirements.

No private runtime data, credentials, databases, logs, saved session transcripts,
worktrees, recovery snapshots, APKs or dependency directories are included. The
machine-specific clone recovery handoff remains local and is not part of this PR.
`.clone-recovery/` is explicitly ignored to protect future clones as well.

## Fresh publication checks

- `git fetch origin`: remote `main` still at `f7fb2cd`; no existing open PR found.
- `npm ci --ignore-scripts --prefix bridge`: succeeded; audit reported no vulnerabilities.
- `git diff --check`: passed before publication.
- Source recovery separately verified all 158 original nonignored files matched
  the old checkout before publication-only ignore/validation documentation changes.
- Bridge runtime: Node 26.3.1 in the local Termux/proot environment, newer than
  the Node 24 configuration in `ci/build-and-test.yml`.
- First `npm test --prefix bridge` attempt: interrupted by the 180-second tool
  deadline; it is not a passing run.
- Full retry of the same command: completed after approximately 513 seconds;
  **159 tests, 148 passed, 6 failed, 5 cancelled, 0 skipped**.
- `python3 scripts/check-bridge-work.py`: failed in its isolated fixture restart
  at `run_ok('start')`, reporting `storage-lock-missing` / unverified startup.
- No fresh Android compilation, host JVM tests, device tests or live smoke were
  performed for this publication. Earlier dated results in milestone documents
  are historical evidence, not a claim that these checks were rerun today.

### Bridge tests not passing in the fresh full run

- B06 synthetic Android inventory preservation.
- B10 separate-owner original task recovery / dispatched non-replay.
- Concurrent bound-project coding/review/merge isolation across reopen.
- Changes snapshot automatic fresh-read behavior.
- Seven B09 terminal child-process scenarios: remote discovery, lost Send/EOF,
  competing approvals, exact Stop/detach, schema/owner/downgrade handling,
  duplicate pages/feed, and historical-only read-only evidence.

The combined list includes failures and cancellations. Several diagnostics are
explicit process/test timeouts; this alone does not prove an environment-only
cause. Do not weaken timeouts/assertions or claim the branch is green without
fresh evidence. Detailed local logs remain private and are not committed.

## Merge gates

This work should be published as a **draft PR** until the failed/cancelled bridge
cases and isolated controller restart are diagnosed and passing, and relevant
Android build/unit/lint gates are rerun. Review the additive SQLite/Durable
migration and deployment compatibility before enabling it elsewhere.

Source rollback is possible, but older binaries must not be assumed safe against
new persisted schema/documents. Production deployment/rollback requires explicit
maintenance, a verified private backup and preservation checks; reverting a commit
alone is not a database downgrade plan. Publication did not start/restart a
production bridge, relocate live state, access the normal app, install APKs, run a
provider, change phone settings, commit to `main`, or merge anything.
