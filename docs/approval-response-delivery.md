# B04b — approval claims, receipts and serialized Stop

Completed locally on 2026-10-21. B04a/b are complete; B05 and later remain pending.
At the user's explicit request, the backwards-compatible bridge source through B04b
was started on the phone after private backup and idle checks, and the normal
Android 0.7.0 app passed the live smoke below. No new HTTP capability is advertised.
Earlier dated source-only/no-deployment statements describe their earlier checkpoints.

## Interface and durable delivery contract

`bridge/src/approval-responses.js` adds `pocket.approval-responses` (session document,
version 1) inside the existing locked Durable journal. Items are indexed by response
ID and retain exact owner/conversation/project/run/occurrence, normalized answer,
claim time and `delivery: unknown | attempted`.

Internal `store.answerApproval({ownerId, conversationId, projectId, runId,
approvalId, responseId, answer})` checks the exact B04a occurrence and current
live sender. In **one transaction**, it records an initially unknown receipt,
expires the pending observation, adds its response-ID back-reference, clears the
Job's pending pointer and projects the Job's `approvalResponse` plus ordered event.
Only after commit does it attempt one RPC response. The same response ID and
normalized target/answer return the stored receipt, even after completion/reopen;
a different answer/target conflicts. A new response ID cannot reclaim the expired
occurrence. Startup validates receipts/back-references, scope, normalized answers,
unique occurrence claims and the Job's latest receipt before resume. Missing or
corrupt evidence fails closed; no receipt recovery sends a response.

A successful local pipe callback updates receipt + Job + projection atomically to
`attempted`. This is **not a Pi acknowledgement or exactly-once external-effect
proof**. Failure before/after writing, a lost live sender, process death, or a
failed receipt commit leaves `unknown`, without retry. The RPC sender now rejects
a closed/non-writable pipe and bounds the callback wait to five seconds. The prompt
write also handles rejection instead of creating an unhandled promise.

A per-run gate spans durable claim, pipe attempt and receipt update, and also covers
pending replacement, progress/result, terminal completion and Stop. Gates for other
runs are independent. Stop records `stopRequested` and expires controls before
calling the existing exact task abort; it releases the gate before the abort's
terminal callback to avoid deadlock. Late frames cannot restore pending controls;
terminal Stop is harmless. Admission stays blocked until the old task terminates.
Client disconnect never calls Stop. Recovery still uses the original dispatched
memo before any provider/worktree execution.

Internal `store.stopRun({ownerId, conversationId, projectId, runId})` verifies exact
targets. Existing `/v1/jobs/:id/cancel` keeps its legacy run-scoped shape. Existing
`respond` and `/ui` translate a raw ID **only if it occurred exactly once in that
run and is still current**, then use the same durable claim path. Reused raw IDs
are deliberately rejected, not guessed. Existing Android cannot answer such an
ambiguous repeated raw ID; exact transport/client exposure remains B05/B08.
The B04a inspector remains diagnostic/non-actionable; no new HTTP route, protocol
version, client outbox or shared-conversation capability was added here.

## Verification

- New `approval-responses.test.js`: **10/10** passed, including concurrent opposite
  answers, durable exact-ID retry/content conflict, stale/crossed/repeated raw IDs,
  all four dialog methods/cancellation, legacy first-answer safety, both Stop/answer
  orders, queued replacement, another independently pending run, pre/post-write
  uncertainty and reopen non-replay, missing sender/startup invalidation, fault
  after prepared claim rollback and missing/foreign/invalid receipt startup refusal.
- Initial tracer was red (`answerApproval is not a function`), then green. Additional
  cases were added incrementally; this was not exclusively red-before-green for
  every assertion. Logs: `$TMPDIR/b04b-red.log`, `b04b-green-first.log`,
  `b04b-receipt-final.log`.
- Full bridge suite: **129/129** passed, no failures/skips; final log
  `$TMPDIR/b04b-bridge-suite.log`.
- One old B03b test answered a deliberately repeated raw ID. Its initial failure
  was correct under B04b: retain the repeated-question coverage, assert legacy
  rejection, then answer its exact occurrence through the new store method. No
  test was deleted. An initial late-frame Stop regression found an ended runtime
  invocation; update now checks stopped/terminal state before entering runtime
  commit as well as inside the transaction.
- Existing native-RPC/HTTP tests, project/worktree/staging/review, startup/recovery,
  bounded reads and old single-client regressions remain in the full suite.
- Normal Android `testDebugUnitTest --rerun`, `assembleDebug`, `lintDebug` passed;
  XML totals **22/22 JVM tests**, no failures. No Kotlin/schema/APK install change.
- `python scripts/check-bridge-work.py` passed its isolated real-tmux ownership,
  idle/backup/restart/exact-ID non-replay checks. No screen-off scenario.
- All bridge source/test JavaScript syntax, `git diff --check` and changed/untracked
  Markdown local-file/anchor checks passed (final commands recorded in session).

## Live normal-app smoke and preservation

The user explicitly requested a live phone test. Discovery found no bridge lock or
running owner, and **25 terminal tasks**, with no active app job. Before startup,
created a private ignored backup at
`bridge/data/maintenance-backups/b04b-20261021T084854/`: SQLite backup, `.env`, all
saved worktrees/Pi-session files and Android databases/preferences. Tokens and
history stay private. No blind lock removal, live SQLite copy or forced host kill.

Started through `scripts/bridge-work start`, independently owned in the dedicated
tmux window. Existing state migrated through the additive B02–B04 startup path.
Protocol remains 5; the normal app remains versionCode 8 / 0.7.0, SQLite schema 4.

Registered a disposable trusted local `trunk` repository named **B04b Live Smoke**.
Selected it in the native new-chat picker and sent a real Pi/provider request:

1. Only isolated-worktree `hello.txt` changed from `BASE_B04B` to `B04B_LIVE_OK`.
2. Native Changes diff showed precisely that one-line change. Native **Run tests**
   ran `sh check.sh`, displayed **B04B_CHECK_OK**, exit 0, current revision.
3. Home/reopen retained chat, locked project, result and Changes state.
4. Sent a second real-provider request to run harmless `sleep 90`, left/reopened
   while it was running, and pressed the native **Stop button**. It became
   **CANCELLED**, with `stopRequested: true`; the first completed result remained.
   A text-selector initially matched the prompt's word “Stop”, not the button;
   fresh UI inspection followed by the actual button tap performed the cancellation.
5. Authenticated responses proved exact job/chat/project/status equality with the
   app's persisted rows. The source marker and unrelated staged `keep.txt` stayed
   unchanged. No source-checkout edit, commit, merge or push.

Private `preservation.json` and `live-evidence.json` prove:

- All original **14 Android sessions / 27 jobs** retained every original column;
  only one new smoke chat and two jobs were added (15 / 29 total).
- All **25 original bridge task rows** are byte/value-identical; three terminal
  tasks were added (coding, native Changes test, cancelled coding; 28 total).
- All **227 original saved worktree/Pi-session files** retain their hashes.
- Main source HEAD and staged patch are unchanged; pairing `connection.xml` is
  byte-identical. Android and bridge SQLite integrity checks are OK.
- Final bridge identity/health is verified, admissions unpaused, active jobs,
  reviews and tasks zero. Temporary ADB keyboard selection was restored to Gboard.
- Android's active phantom-process limit remains **128**.

Live approval-dialog races and pipe-failure injection were **not** performed
against the production app/provider; those guarantees are isolated-fixture evidence.
This is not a screen-off, overnight, host-death or full Android/terminal continuity
claim. No shared client exists yet. Test chats/worktrees and private backups remain;
nothing was committed or pushed. Next: **B05 only**, when requested.
