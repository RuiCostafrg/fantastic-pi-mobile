# B02 — owner identity and backend conversation baseline

Status: **implemented and verified in isolated fixtures — 2026-10-20; not deployed**.
B03a staging is now complete (**8/8 focused; 92/92 full bridge**);
[transition evidence](conversation-transition.md). B03b is now complete:
11/11 new, 29/29 combined focused and 103/103 full bridge tests;
[live-write evidence](conversation-live-writes.md). B03c is now complete:
8/8 new, 37/37 combined focused, 111/111 bridge tests;
[bounded read protocol/evidence](conversation-bounded-reads.md). Stop before B04.
The remainder of this document preserves historical B02 evidence/limitations.
Roadmap: [next-steps.md](next-steps.md).
Design: [shared-conversation-design.md](shared-conversation-design.md).
Prior characterization: [conversation-contract-baseline.md](conversation-contract-baseline.md).

## What changed

`bridge/src/conversations.js` adds version-1 application documents through the
installed Durable interface (`defineDoc`, `defineDocFamily`, transaction `doc`,
read-only `snapshot`). No private SQLite-table writes, dependency upgrade, second
harness, extra executing conversation or new task definition is involved.

`store.js` calls `initializeConversations` at the end of its existing project/
binding startup transaction, **before `harness.resume()`**. The binding migration
and baseline either commit together or neither does. B02 reads the original
Jobs/Reviews/Bindings/Projects; it does not rewrite tasks, old entries, Pi history,
worktree manifests or repository files. A's existing legacy project enrichment
still runs in that same transaction; B02 does not add another project mapping.

Existing coding/review admission, dispatch memo, runner, approvals, cancellation
and completion code are unchanged. No Android source/data change. HTTP still has
protocol 5/project bindings; it exposes neither owner identity nor conversation
capability/routes yet. Controller protocol behavior is unchanged.

## Storage and internal interface

All documents have session scope inside the existing exclusively locked journal.
Public app conversation IDs are opaque strings, **not Durable conversation IDs**.
Keyed families explicitly set Durable's required `family: true` flag.

| Document kind | Key / contents |
| --- | --- |
| `pocket.owner` | Singleton: random UUIDv4 `ownerId`, `baselineVersion: 1`, sorted captured conversation IDs. Written atomically as the migration marker, including for an initially empty journal. Identity is not a PID or pathname. |
| `pocket.conversation-baselines` | Key is exact session ID. Stores owner/project/conversation identity, random UUIDv4 cursor generation, sequence 0, explicit reconstructed ordering, ordered run-ID and review-ID references. Includes bound chats with no jobs. |
| `pocket.turn-baselines` | Key is JSON tuple `[conversationId, runId]`. Stores exact run ID, one-based ordinal, saved timestamp (null if absent), two stable role-qualified messages and a detached historical source job snapshot. |
| `pocket.review-baselines` | Key is JSON tuple `[conversationId, operationId]`. Stores the exact operation ID and historical source review snapshot, including the original normalized input/result/task reference. |

This separates transcript bodies into individually keyed turn/review records rather
than putting the full transcript into the catalogue document. B03 must still add a
bounded live snapshot/event reading strategy (now implemented separately in
[B03c](conversation-bounded-reads.md)); these baseline inspectors remain historical,
not the paginated client interface.

`openStore` adds two internal read-only methods, deliberately not HTTP routes:

- `getOwnerIdentity()` -> `{ ownerId, baselineVersion }`.
- `getConversationBaseline(sessionId)` -> detached historical snapshot with
  `baselineOnly: true`, schema version 1, owner/conversation/project, ordering,
  cursor, turns and reviews; unknown ID returns null, malformed ID returns 400.
  Reading unknown IDs does not bind or create a tree. Mutating a returned snapshot
  cannot alter the stored evidence.

Exact identity decisions:

- Conversation ID equals existing `sessionId`; absent legacy session stays mapped
  to literal `pocket` without rewriting the original task/job omission.
- Run ID equals existing request/job ID. Durable numeric task IDs stay execution
  references and are not converted into client run/message IDs.
- Message IDs are JSON tuples `[runId, "user"]` and `[runId, "assistant"]` encoded
  as strings. One result card per run, not one per observed RPC message.
- Saved `createdAt` ascending, then exact ID in code-unit order; missing/null dates
  sort last with exact-ID tie break. Label: `kind: reconstructed`. No claim of true
  historical interleaving, synthesized timestamp, or reordering Android-only rows.
- Review IDs have their own ordered references, not fabricated coding turns.
- Baseline cursor sequence is **0**: no fabricated past events or decisions.
  Owner/conversation/generation scope is reserved for later event handling.

## Failure, restart and the intentionally historical baseline

The complete inventory is validated before first capture. Invalid session/record
identity, status/date, missing project evidence or occupied conflicting baseline
records fail closed. Reopen validates marker/UUIDs, source identity and immutable
request/input/task/project/date fields, ordered references, role-qualified message
IDs, ordinals and ordering metadata. Missing/corrupt referenced records fail rather
than being regenerated. A failure leaves evidence intact and releases the store
lock via the existing failed-open cleanup; it does not repair/reset a worktree.

Snapshot **status/result/pending are source evidence**, not current run state or
permission to answer an approval. For example, a captured `running` dialog can
subsequently become `interrupted` in Jobs while its baseline source still records
the pre-resume dialog. `baselineOnly` is mandatory; no client capability is enabled.
Owner identity and baseline are immutable across repeated reopen.

The existing dispatched memo guard remains first in both task paths. Tests separate:

- previously undispatched legacy task: captured as queued, executes once under
  existing recovery, retains its original task input and request ID;
- previously dispatched coding/dialog and review tasks: captured before resume,
  become interrupted/pending-null through the original recovery, with zero new
  runner/review dispatches. Historical pending is never sent after reopen.

### Required B03 transition (not implemented here)

B02 captures **once**, including an empty journal; it does not make old routes write
live projection/events yet. New accepted work and newly bound chats after that
capture remain in the original Jobs/Reviews/Bindings and are deliberately absent
from the frozen baseline. Later state changes do not masquerade as baseline data.

Therefore B03 must atomically reconcile current records and **all B02-era writes**
into its live projection before enabling any attachment/event capability. Reuse
stable message/run IDs, preserve baseline evidence and cursor generations, and do
not claim historical events for the unobserved interval. Define a snapshot/reset
transition for that gap and validate it with acceptance/recovery fixtures. There
must be no best-effort sidecar or untracked live write once B03 is enabled.
B02's internal inspector must never be substituted for a current client snapshot.

This is not backup restore support. Copying a journal copies its owner identity;
cloned journals must not be executed as independent owners or merged. A future
explicit restore/rewind must invalidate affected cursor generations and reconcile
accepted work, never automatically replay it.

## Verification and limits

New `bridge/test/conversations.test.js`: **10/10 passed** (~12.82 s).
Full bridge regression suite: **84/84 passed** (~79.87 s), zero failures/skips.

```sh
cd bridge
node --test test/conversations.test.js
npm test
```

Tests use disposable local Git repositories/journals only. Old-state fixtures are
written using supported Durable commits; tasks/entries are compared using supported
transaction reads, never private-table SQL. They cover:

1. Exact IDs/messages/ordering and two reopen cycles, old Pi-file/manifest/dirty
   content/HEAD/branch identities, immutable returned snapshots and binding-only chat.
2. A later conversation conflict after earlier projection writes were prepared:
   entire binding/project/owner/baseline transaction rolls back; corrected retry works.
3. Persisted message-ID/ordinal corruption is refused without automatic repair.
4. Undispatched execution once, unchanged original task input/old entries, no new task.
5. Dispatched coding/dialog/review uncertainty: original task inputs, no redispatch.
6. Injected callback failure after preparing the marker: all new documents absent;
   retry publishes a fresh identity, not the aborted one.
7. Distinct fresh journals have different owners; same-journal lock remains exclusive;
   health/routes unchanged; post-baseline writes are not presented as baseline history.
8. Malformed source identity/status/date and partial owner fail closed; retry safe.
9. Already-migrated two-project/binding-only inventory retains exact project IDs,
   with no additional checkout prepared.
10. Incomplete legacy manifest-only preparation is captured without recreating a tree.

Red/green evidence: initial missing inspection method failed before implementation;
a persisted message-ID/ordinal corruption test then failed until validation was
added. An early implementation trial omitted Durable's explicit family flag and
failed closed; corrected before passing. Logs under `$TMPDIR`:
`b02-red-baseline.log`, `b02-green-baseline.log`, `b02-red-conflicts.log`,
`b02-green-conflicts.log`, `b02-recovery.log`, `b02-focused.log`,
`b02-bridge-suite.log`. JavaScript syntax and diff/document checks also pass.

No production journal/config/history access or runtime probe/restart, provider,
Android build/instrumentation/visible phone test, installation/deployment, standalone
tmux harness, commit or push. These fixture results do not claim abrupt host-death,
real-provider context, cross-client attachment, current approvals, event delivery or
Android migration. That was B02's historical boundary; B03a/b/c are now implemented
separately in source/fixtures. B04–B11 remain unimplemented. Stop after B03c.
