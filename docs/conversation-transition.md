# B03a — staged conversation transition

Status: **complete in source/isolated fixtures — 2026-10-20; not deployed**.
B03 was split before implementation: **a** transition staging, **b** transactional
live writes, **c** bounded consistent reads. **B03b is now complete** (11/11 new,
29/29 combined focused, 103/103 bridge); [live-write evidence](conversation-live-writes.md).
B03c is now complete (8/8 new, 37/37 combined focused, 111/111 bridge);
[bounded read protocol/evidence](conversation-bounded-reads.md). B03 is complete in
source/fixtures; stop before B04. The sections below describe the
historical B03a/staged-only contract; production source now promotes explicitly.
Roadmap: [next-steps.md](next-steps.md). Baseline: [conversation-baseline-storage.md](conversation-baseline-storage.md).

## Contract and layout

`bridge/src/conversation-projection.js` stages the current Jobs/Reviews/Bindings
inside the existing pre-resume startup transaction, after B02 validation. It uses
supported Durable documents only. No tasks, executing conversations, external
processes or worktrees are created by staging. Original execution records remain
authoritative. Baseline capture/evidence is untouched.

Version-1 session documents:

- `pocket.projection-state`: owner, mode **staged**, sorted conversation IDs.
- `pocket.conversation-projections`: exact conversation/project/owner, generation,
  latest sequence and canonical source digest. This is only a revision pointer.
- `pocket.projection-snapshots`: immutable keyed `[conversationId, sequence]`
  manifests with ordered turn/review references and ordering provenance.
- `pocket.projection-records`: immutable keyed
  `[conversationId, kind, recordId, revision]` bodies; stable public message/run/
  operation IDs, ordinal, source evidence and message projection. Unchanged bodies
  are referenced again rather than copied into each later snapshot.
- `pocket.projection-events`: immutable keyed `[conversationId, sequence]` reset
  evidence. Only **snapshot.reset** exists in B03a, with `requiresSnapshot: true`,
  pinned snapshot sequence and reason `initial-stage` or `unobserved-changes`.
  There are no fabricated historical run/tool/approval events.

Existing baseline conversations reuse their B02 generation and ordinal order. New
conversations get one persistent generation. Existing turn/review ordinals are
preserved; new records append, ordered by saved time then exact ID within the new
batch (missing dates last). Old turns with missing dates are not moved behind
later admissions. Ordering remains explicitly reconstructed, not client chronology.
Stable role-qualified message IDs and legacy sorting are shared helpers in
`conversations.js`, with no change to the B02 baseline contract.

Canonical key-order-independent source digests distinguish actual source changes
from object property insertion order. Initial capture emits sequence 1/reset; each
changed capture advances once. Unchanged reopen validates evidence and emits
nothing. Snapshots/bodies/reset records are immutable and retained, with no pruning.
A conflict in any later conversation or failure after preparing the reset rolls
back all staged changes together; on a first migration it also rolls back B02 and
legacy project enrichment in that transaction. No automatic repair/overwrite.

## Internal inspector — deliberately not a live interface

`store.getStagedConversation(id[, sequence])` reads latest or an exact retained
snapshot. Responses explicitly carry:

- `stagedOnly: true`, `liveWrites: false`;
- `approvalEvidence: "historical-only"`;
- owner/conversation/project/cursor, ordered turn/review bodies and reset evidence.

Unknown chat returns null without binding/creating a tree. Malformed ID/sequence
returns 400; unknown/future snapshot returns 409. Missing/corrupt pinned bodies,
reset identity/schema/generation or ordinals fail closed, including old snapshots;
no null/partial transcript is silently returned. Returned data is detached.
This is non-paginated migration inspection, not B03c's client snapshot/event reader.
No health capability, owner field, HTTP route, protocol or Android change.

**At B03a, live writes were intentionally not tracked yet.** A newly sent turn after startup
will not appear here until a later capture. Similarly, startup captures a pending
run before existing recovery marks it interrupted; the following reopen records
that unobserved change as a reset, not a fictional interruption event. Cached
pending dialogs are historical only and cannot authorize a response. The original
dispatched memo remains first; no replay is introduced.

B03b must reconcile all intervening source/recovery changes and instrument **every**
existing write in the same transaction before promoting out of staged mode. B03c
must implement bounded snapshot/event pagination, byte/count limits and cursor/race
validation. Neither was implemented by B03a; both are now implemented separately. No shared
capability may use this historical inspector as current evidence.

## Verification

`bridge/test/conversation-transition.test.js`: **8/8 passed** (~14.34 s).
`cd bridge && npm test`: **92/92 passed** (~81.38 s), zero failures/skips.

Cases cover B02-era new turns/results/reviews and binding-only chats; stable owner/
generation/message IDs/ordinals; old snapshot retention and key-order idempotency;
atomic source/pointer/revision/reset rollback; later-chat conflict/corrected retry;
missing historical body refusal; real fake-RPC pending/restart interruption with
one dispatch marker and unchanged worktree manifest/dirty effect/source staging;
first-time B02/project migration rollback; foreign reset schema/generation and
changed accepted post-baseline input refusal without fabricated reset.

Red before implementation: missing staged inspector. A subsequent missing-old-body
assertion failed until retained-snapshot validation was added. Logs in `$TMPDIR`:
`b03a-red-transition.log`, `b03a-green-transition.log`, `b03a-reset-rollback.log`,
`b03a-red-retained-snapshot.log`, `b03a-focused.log`, `b03a-bridge-suite.log`.
Syntax, whitespace and local documentation checks are recorded with step evidence.

Only disposable repositories/journals and isolated fake executors were used.
No production data/config read, runtime probe/restart, provider call, Android build/
phone test, deployment, commit or push. B03a alone is not cross-client attachment,
current approval safety, live event delivery or host-survival evidence.
