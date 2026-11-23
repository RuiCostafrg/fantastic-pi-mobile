# B04a — durable approval observation lifecycle

**Later update — 2026-10-21:** [B04b](approval-response-delivery.md) is now complete,
including durable answer receipts, serialized Stop and the explicitly authorized
compatible-bridge live regression smoke. The source-only/no-claim/stop statements
below document the earlier B04a checkpoint, not current B04b behavior. Its inspector
is still diagnostic/non-actionable; exact HTTP/client exposure remains B05/B08.

Status: **complete in source/disposable fixtures — 2026-10-21; not deployed**.
B04 overall and B04b remain incomplete. No answer claim/receipt, serialized Stop,
HTTP route/capability, Android change or approval delivery guarantee is added.
Roadmap: [B04a](next-steps.md#b04a--persist-approval-occurrence-lifecycle-complete).
Contract: [approval races/non-replay](shared-conversation-design.md#approval-and-stop-races--non-replay).
Prior evidence: [live writes](conversation-live-writes.md),
[bounded reads](conversation-bounded-reads.md).

## Storage and authority

`bridge/src/approval-lifecycle.js` uses supported Durable session documents in the
existing exclusive store owner/journal, never private SQL or a second task machine:

- `pocket.approval-index`: schema/owner and unique sorted observed run IDs;
- `pocket.approval-runs`: keyed JSON `[ownerId, runId]`, exact conversation/project
  scope, positive occurrence count and one nullable current observation pointer;
- `pocket.approval-occurrences`: individually keyed JSON `[ownerId, runId, ordinal]`.
  Immutable `observation` contains exact scope, ordinal, observation timestamp and
  detached original raw Pi event (including raw `id`, method, options and extra
  Android fields); a canonical SHA-256 digest validates that body. Mutable state
  is only `observed`/`expired`, reason and expiry timestamp. The digest is internal
  corruption detection, **not** authentication or an approval capability.

The authoritative Job adds `approvalOccurrenceId` outside its unchanged raw
`pending` object. Every observed question frame (confirm/select/input/editor) gets
its next durable ordinal, even if the entire wire event repeats. Replacement
expires the previous observation. Raw IDs are never occurrence IDs. Ordinals and
keys are allocated in the same caller transaction as the raw pending update,
Job pointer, immutable B03 source revision and event. Occupied identity keys are
never overwritten. There is no process-local identity allocator or ledger-only
execution authority: Jobs/Reviews/Bindings still control execution and scope.

`transitionApproval` validates existing scope, index/run/occurrence identity,
ordinal/state/digest/current-pointer/pending agreement before applying a patch.
It expires on replacement, pending clear (including existing legacy respond,
tool and assistant result), and completion/failure/cancel/interruption. Original
observation data is retained. Duplicate tool/results remain projection no-ops.
Current implementation validates a run's retained occurrences on each update;
this is not a constant-time or bounded-total-storage promise. No pruning.

## Startup ordering and compatibility

Inside the original binding/B02 startup transaction, **before `harness.resume`**:

1. B02 validates/initializes its historical owner/baseline.
2. B03 validates original authoritative Jobs against live revisions, or reconciles
   and promotes the historical staged interval. Approval expiry must not precede
   this comparison and hide untracked source corruption.
3. B04a validates/initializes its ledger, validates all indexed evidence against
   current Jobs and exact immutable Bindings, then expires formerly observed
   occurrences with `startup`, clears Job occurrence pointers and projects those
   changes in that same transaction.

First migration does **not** fabricate an occurrence from pre-B04 saved raw
pending. It remains historical until original recovery clears it. Subsequent
reopen expires observed ledger evidence before resume, retaining raw pending as
history until recovery. Unchanged expired evidence is idempotent: no new identity,
ordinal, generation, reset or expiry timestamp. Existing coding/review
`memo('dispatched')` guards remain before external action. Dispatched uncertainty
still becomes interrupted without RPC/provider/repository replay.

The existing B03a `initializeProjection: stageConversations` fixture injection
remains staged-only; neither startup nor its synthetic question updates create
live observations. Normal stores always initialize live projection first.
Fail-closed validation never repairs a corrupt index/run/pointer or adopts an
occupied unindexed known-run identity. Supported transaction reads address keyed
records via their indexes; this does not introduce a raw storage-table orphan
scanner. Immutable body creation also rejects an occupied next occurrence key.

## Internal inspection is NOT an action interface

`store.inspectApprovalEvidence(runId)` runs a read-only supported transaction,
derives owner/run/conversation/project from existing authoritative evidence and
returns detached JSON with `internalOnly:true`, **`actionable:false`** and
`approvalEvidence:"observation-only-not-answer-permission"`. Unknown run returns
null before any per-run ledger document lookup and cannot bind/create/dispatch.
A saved current pointer or `observed` state never proves a live RPC sender.
There is no HTTP route, health advertisement or answer endpoint for observations.

**Legacy `respond` and `cancel` delivery/race semantics deliberately remain.**
Legacy raw-ID reuse is not made safe by these observations. No concurrent
first-answer safety, exact delivery, delivery receipt or Stop serialization is
claimed; those are [B04b](next-steps.md#b04b--serialize-claimsreceipts-legacy-answers-and-exact-stop-complete).

## Verification and actual red/green evidence

```sh
cd bridge
node --test test/approval-partial.test.js test/approval-lifecycle.test.js test/conversation-reads.test.js test/conversation-live.test.js test/conversation-transition.test.js test/conversations.test.js
npm test
```

- New tests: **8/8** (7 real disposable Git/Durable/store tests, one narrow
  transaction-double partial-index regression).
- Combined new + B02/B03a/b/c: **45/45**, no failures/skips (~24.36 s),
  `$TMPDIR/b04a-focused.log`.
- Full bridge: **119/119**, no failures/skips (~96.93 s),
  `$TMPDIR/b04a-bridge-suite.log`.
- Explicit new red: partial known-run evidence missing from the index was accepted;
  `approval-partial.test.js` failed **0/1** with “Missing expected rejection” in
  `$TMPDIR/b04a-partial-red.log`. Added unindexed known-run/first-occurrence empty
  checks; green in the 45/45 and 119/119 runs above.
- Implementation preceded the first lifecycle integration run; this was **not**
  a fully red-before-green session. Initial integration attempt timed out because
  the fixture runner ignored close/abort (`b04a-initial.log`); added fixture signal
  rejection. New integration tests then passed **7/7** (`b04a-new-initial.log`).
- The old B03b identical-question assertion assumed raw payload equality meant no
  new occurrence. Its initial attempt also hung in cleanup after that assertion
  (`b04a-b03-red.log`). Narrowly changed it to require a new revision, made its
  fixture abort-aware, and changed recovery's expected sequence increment from
  one to two (startup pointer expiry, then original interrupted result). No test
  removed. New tests explicitly retain duplicate tool AND assistant-result safety.

Cases include distinct repeated raw payload observations and original wire fields;
read detachment/non-actionability/unknown lookup; legacy reply/tool/result/terminal
expiry; cancellation/failure; pre-B04 historic pending; startup fault after prepared
expiry and repeated reopen without replay; post-occurrence/pointer/projection fault
rollback and occupied next-key refusal; corrupt owner/index/run/chat/project,
ordinal/state/missing observation/current pointer rejection before dispatch.
Existing suite retains task/input/entry/worktree/project/source-staging assertions.

Final `node --check` for all bridge source/test JavaScript and `git diff --check`
passed; changed/untracked Markdown local file/anchor check: **91 links passed**.
Static log: `$TMPDIR/b04a-static-checks.log`; current pointers:
[PROGRESS.md](../PROGRESS.md) and [next-steps.md](next-steps.md).
Fixtures use temporary journals/repositories/fake executors only. No production
state/config/history access, runtime probe/start/stop/restart/migration, provider,
phone/ADB, install/deployment, dependencies, source index/HEAD manipulation,
commit/push or other agent. All B01–B03 local work is preserved. Stop before B04b.
