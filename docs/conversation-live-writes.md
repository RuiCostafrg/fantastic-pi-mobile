# B03b — transactional live conversation projection

Status: **complete in source/isolated fixtures — 2026-10-20; not deployed**.
B03c is now complete: **8/8 new, 37/37 combined focused, 111/111 bridge**;
[bounded read protocol/evidence](conversation-bounded-reads.md). B03 is complete in
source/fixtures; stop before B04. No HTTP,
protocol, Android or shared attachment capability was added. Prior evidence:
[B03a staging](conversation-transition.md), [B02 baseline](conversation-baseline-storage.md).
Roadmap: [next-steps.md](next-steps.md).

## Promotion and storage

`bridge/src/conversation-live.js` explicitly promotes the version-1 staged
projection in the existing pre-resume binding/B02 transaction. Before promotion it
**repeats B03a reconciliation**, including intervening status/result/recovery and
new records/bindings. Changed unobserved state produces only `snapshot.reset`, not
fabricated semantic history. Promotion and prepared live heads commit atomically.
Unchanged promotion adds no event. Reopen validates live evidence and authoritative
sources; untracked changes after promotion fail closed, rather than pretending an
unobserved interval was live or automatically repairing it.

Existing staged snapshots, records, reset events, B02 baselines and original
Jobs/Reviews/task inputs/entries remain retained. Existing owner/generation,
message/run/operation/project IDs and ordinals survive. `stagedSequence` records
the immutable migration boundary. `sourceDigest` on an old pointer is retained
staging evidence, not a live source digest. `ProjectionState` and conversation
pointers explicitly change `mode` from `staged` to `live` in the same transaction.
New live conversations receive one generation and admission-assigned ordinals.

One new supported Durable document family, `pocket.live-records` (version 1,
session scope), holds heads keyed by `[conversationId, kind, recordId]`.
Conversation pointers carry ordered turn/review IDs. Each changed record creates
an immutable `pocket.projection-records` revision and ordered
`pocket.projection-events` envelope at the same conversation sequence. Events pin
kind/record/revision/ordinal plus owner/conversation/project/generation. Existing
staged record keys and references are reused; no all-history snapshot copy or
canonical all-history source scan occurs on each progress update. Startup performs
full validation, including retained staged snapshots and live event references.
No pruning, separate task model, database owner or polling sidecar.

## Mutation coverage

`projectMutation(tx, bindings, kind, source, type)` uses the caller's supported
Durable transaction; it never commits afterwards or performs an external action.
It checks project identity, immutable accepted input, prior head/revision and
ordinal, suppresses identical state, then prepares revision + event + head/pointer.

| Existing store write | Evidence in its same transaction |
| --- | --- |
| `submit` job/task/input admission + binding | `turn.accepted` |
| `update`: running, preparation/workspace, notification/tool progress, assistant answer, raw dialog open/clear/legacy response | `run.status`, `run.progress`, `run.result`, `run.pending` |
| `complete`: final answer, failure, abort, dispatched recovery + result entry + Durable terminal outcome | `run.done`, `run.failed`, `run.cancelled`, `run.interrupted` |
| `reviewAction`: binding/task/admission | `review.accepted` |
| review running and `finishReview`: result/failure/abort/recovery + terminal outcome | `review.running`, `review.done`, `review.failed`, `review.cancelled`, `review.interrupted` |

Each event references the complete immutable observed source revision, so a tool
progress/answer event also preserves its simultaneous pending clear. There is one
user and one assistant/result message per run, revised rather than appended per
RPC message. Duplicate request/operation admission returns the existing record
without another task, message or event. Unchanged observations emit nothing.
Project registry registration alone is not a conversation mutation; it creates no
binding, task or transcript. Existing bindings are still authoritative and reads
still do not bind or prepare a worktree.

Original `memo('dispatched')` remains before external work in both task paths.
Recovery uses existing execution rules: undispatched work may execute once;
dispatched uncertainty becomes interrupted without another provider/Git action.

## Internal inspection and limits

`store.inspectLiveConversation(id)` is explicitly **internalOnly**, unbounded and
**consistentRead:false**. It exists for isolated diagnostics/tests, not clients.
It returns heads and event evidence with `liveWrites:true` and
`approvalEvidence:"raw-pending-not-action-proof"`. It has no HTTP route/capability.
`getStagedConversation` still refuses live mode; no caller substitutes staged data
for live evidence. Live startup uses the transaction-level
`validateRetainedStage` helper to validate historical snapshots/bodies/resets;
it never calls the staged inspector after promotion or treats that evidence as
current run/approval state.

For reproducible historical B03a fixtures, `openStore` accepts an injected internal
`initializeProjection` callback, analogous to its existing fake runner/review
injections. B03a tests explicitly inject `stageConversations`; normal construction
always uses `initializeLiveConversations`. Its staged helper branch refuses a live
conversation pointer. This does not expose a transport mode or capability.

B03c must implement bounded consistent snapshot/feed pagination, count/byte limits,
immutable high-water tokens and robust scoped cursor/gap/race validation. These are
**not implemented by B03b**, but are now supplied separately by
[B03c](conversation-bounded-reads.md). This inspector remains diagnostic-only.
B04 must add exact durable approval occurrences, claims
and receipts; raw dialogs/clears here do not prove current cross-client actionability
or serialized first-answer delivery. No approval replay, action retarget, worktree
repair, import execution or second execution owner was added.

## Verification

```sh
cd bridge
node --test test/conversation-live.test.js test/conversation-transition.test.js test/conversations.test.js
npm test
```

- New `conversation-live.test.js`: **11/11 passed**.
- Combined B03b/B03a/B02 focused command: **29/29 passed**, zero failures/skips
  (~19.24 s), `$TMPDIR/b03b-focused.log`.
- Full `cd bridge && npm test`: **103/103 passed**, zero failures/skips
  (~83.15 s), `$TMPDIR/b03b-bridge-suite.log`.
- `node --check` for all bridge source/test JavaScript: passed.
- `git diff --check`: passed.
- Local changed/untracked Markdown file/anchor link validation: **65 links passed**.
- Static check output: `$TMPDIR/b03b-static-checks.log`.

The eleven new cases cover every old-route coding mutation and pending reply,
duplicate identical observations, concurrent and terminal duplicate admissions,
Stop/failure, review admission/running/result/failure/abort/deduplication, repeated
staged-interval reconciliation and immutable old resets/bodies, post-preparation
coding/review rollback, admission task/input/binding rollback, promotion rollback,
repeated recovery/reopen without coding/review redispatch, fail-closed untracked
source/foreign old event corruption, and two real disposable Git project bindings.
Per-fixture source staging is compared before/after. Existing B02 regressions also
retain undispatched-once and old task/entry/baseline evidence assertions.

An initial live fixture run passed 7/8: a test used unsupported unscoped
`scanEntries({})`; corrected to the supported root conversation scope. Subsequent
focused/full commands above passed. Initial logs: `$TMPDIR/b03b-initial.log` and
`b03b-live-initial.log`. Fault tests intentionally prepare conflicting synthetic
journal evidence and use thrown callbacks; they do not claim power-loss/host-death
or exactly-once external effects. One admission fault retry uses a different chat
only after proving the original failed transaction admitted nothing.

Only disposable repositories/journals and fake executors/RPC fixtures were used.
No production state/config/history read, runtime probe/start/stop/restart/migration,
provider execution, Android/phone test, installation/deployment, dependency install,
source Git HEAD/index manipulation, commit or push. All earlier local/untracked
work remains present. At B03b completion the next step was B03c in another fresh
coding session. That separate session now completed B03c; stop before B04.
The historical B03b session did not start B03c or another agent.
