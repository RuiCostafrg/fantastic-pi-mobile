# B10 handoff — isolated cross-client continuity only

This file is a next-session task, not evidence of B10 completion. Execute only when
explicitly asked to follow it. B09 is complete; stop before B11.

## Read first

In `~/projects/fantastic-pi-mobile`, read:

- `PROGRESS.md`
- `docs/next-steps.md` (especially B10 and safety rules)
- `docs/shared-conversation-design.md`
- `docs/conversation-api.md`
- `docs/conversation-history-import.md`
- `docs/android-shared-conversations.md`
- `docs/terminal-conversations.md`

Inspect current Git state and fixture seams; preserve every existing uncommitted
change. Implement B10 only, with bounded fixes required by its acceptance tests.

## Acceptance

Use actual headless Android processes/SQLite, the real B09 terminal client in
separate processes, an independent disposable HTTP/Durable owner, fake RPC workers
and two disposable projects. A Node mock is not Android storage/client evidence.

Prove Android sends in project A; terminal opens that exact chat and sends the next
turn, then detaches while backend work continues. Android stays absent until
completion, then reopens and reconciles catalogue/cursor/ordered transcript/result/
approval state once. Keep project B independently active.

Separate cases must cover simultaneous sends, offline/client-process loss,
duplicate pages, lost Send/approval responses, approval races, exact run-scoped Stop,
orderly owner reopen, undispatched recovery and dispatched coding/review/approval
uncertainty without replay.

Assert original owner/chat/run/project/operation IDs, dispatch counts, context and
worktree markers—not just matching UI text. Verify source HEAD/staging, worktree/
branch/manifest identity, Android drafts/pairing/organization, saved review JSON and
operation IDs remain intact. Retain original-ID recovery, strict capability/schema/
owner checks, inert historical evidence and no uncertain shared-to-legacy fallback.
Terminal EOF/Ctrl-C remain detach, never cancellation.

## Authorized boundary

- Disposable fixture owners/fake workers only; keep normal-app and production data
  untouched. Credentials stay out of argv, URLs, logs and Git.
- Build/install/run only isolated reliability APKs for headless B10 tests. Verify
  exact APK/runner identity and prior fixture package presence before installation;
  restore prior fixture package presence afterward.
- No normal-app install/data access/migration/launch, visible UI tests, production
  bridge operation/restart, deployment, real-provider work, phone-setting changes,
  commit or push.

## Completion

Run relevant process/data/regression/build/lint gates with bounded timeouts. Update
progress/evidence with actual commands, results, failures, preservation checks and
limitations. If a required gate is unavailable, record B10 as blocked rather than
claiming completion. Clean up only disposable fixtures created for this work.

**Stop before B11. No production rollout or real-provider smoke.**
