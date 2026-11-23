# Milestone B — shared conversation core, one bridge owner

**Current update — 2026-10-21: B10 complete in isolated fixtures; stop before B11.**
Actual Android/SQLite and real B09 terminal processes prove same-ID next-turn
continuity, offline completion with both clients absent, ordered reconciliation,
Send/approval races and original-ID response-loss recovery. Separate owner processes
prove undispatched resume once and dispatched coding/review/approval non-replay.
**9 new + 30 existing headless Android, 36 JVM, 159 bridge** tests, reliability-only
build/lint and isolated real-tmux passed. Real worktree context/dispatch/reply and
manifest/branch/HEAD preservation assertions; no normal app/production/visible UI/
provider/deployment action. [Actual evidence and limits](cross-client-continuity.md).
Earlier uncommitted work retained. B11 not started.

**Previous update — 2026-10-21: B09 complete in source/disposable process fixtures;
stop before B10.** HTTP-only JSON-lines terminal adapter with private durable
owner/cursor/original Send and approval IDs, strict gates and no legacy fallback.
Exact approval/confirmed run Stop; EOF/Ctrl-C/detach never cancel backend work.
**10/10 process and 158/158 full bridge tests passed** with fake workers and actual
response loss. No executor/journal/Pi-session access, production operation, normal
app data/install, real provider, phone test, deployment, commit or push.
[Usage, actual evidence and limits](terminal-conversations.md). B10 not started.

**Previous update — 2026-10-21: B08 complete in source/isolated fixtures; stop before
B09.** B07's actual Android SQLite gate passed 19/19. B08 now wires foreground
catalogue/cache/import/outbox reconciliation into the native client, remote activity
and completed-turn discovery, exact fresh approvals/Stop and owner-scoped existing
Changes recovery. Strict owner/endpoint/credential/lifecycle proof and persisted
same-ID recovery preserve historical/non-executing evidence and local organization.
**36/36 JVM, 148/148 bridge, 35/35 Android**, normal/fixture build/test-APK/lint and
isolated real-tmux passed. Announced live fixture native Send/discovery/approval/
Stop/reopen passed; only verified previously absent fixtures installed and removed.
No normal-app installation/data access/migration, production operation/restart,
deployment, real provider, commit or push. [B08 implementation/evidence/limits](android-shared-conversations.md);
[B07 storage/SQLite evidence](android-conversation-cache.md).

Previous B06 update — 2026-10-21: B01–B06 complete. B06 implements the narrow
historical evidence lane in the existing owner: immutable manifests/receipts,
explicit conflicts, non-executing historical/unresolved rows, bounded pinned reads
and gated catalogue opt-in. No Jobs/Bindings/event-cursor rewrite or Android/client
rollout. **13/13 new, 45/45 combined, 148/148 bridge** and isolated real-tmux checks
passed. [Import contract and evidence](conversation-history-import.md). No production
access/import/deployment/restart/install, commit or push. **Stop before B07.**

Previous B05 update: B01–B05 complete. B05 exposes the
source-only protocol-6 shared HTTP contract with owner/schema/capability gates;
**6/6 new, 32/32 focused, 135/135 bridge, 22/22 JVM** and isolated real-tmux
controller checks passed. [Final API/compatibility/evidence](conversation-api.md).
No B05 production operation/deployment/install, commit or push. Stop before B06;
no historical import/client rollout yet.

Previous B04 update: B01–B04 complete. B04b's durable receipts,
serialized Stop and explicitly authorized compatible-bridge live smoke are recorded
in [approval response delivery](approval-response-delivery.md). B05 and later remain
pending; protocol stays 5, no shared HTTP/client capability yet. Older source-only
status and authorization statements below describe their earlier checkpoints.

Status: **B01/B02 and B03a/b/c complete in source/fixtures; B04–B11
remain incomplete** (2026-10-20). B03c: **8/8 new, 37/37 combined focused,
111/111 bridge tests**; [bounded read protocol/evidence](conversation-bounded-reads.md).
No shared HTTP capability or deployment; stop before B04. B03b passed **11/11 new, 29/29 combined focused,
103/103 bridge tests**; [live-write evidence](conversation-live-writes.md). B03a passed **8/8 focused, 92/92 full bridge tests**;
[staging evidence and limits](conversation-transition.md). Milestone A is complete. B02's **10/10** focused
and **84/84** bridge tests/layout are in [conversation-baseline-storage.md](conversation-baseline-storage.md);
B01's prior evidence is in [conversation-contract-baseline.md](conversation-contract-baseline.md).
B02 is source/fixture-only, not deployed. This design
does not authorize deployment, a bridge restart, private-state access, provider
actions or phone tests. Execution checklist: [next-steps.md](next-steps.md).

## Outcome and smallest compatible choice

Start a coding chat on Android, open that **same ID** in a terminal client, send the
next turn, disconnect the terminal while the independently owned bridge works,
and reopen Android to discover that turn/result once, in order, in the same project
and worktree. Approvals and Stop address the exact run, not the selected client.

Add a deep conversation module **inside the existing `openStore`/Durable owner**.
Keep the real Pi RPC runner, task definitions, project registry, immutable bindings,
worktree adapter and review implementation. Its interface hides transactional
admission, transcript projection, ordering, event recovery and exact action targets.
Android and a small terminal client are the two client adapters. HTTP is transport,
not a second executor. Do not introduce a second database owner, replace Pi with a
new SDK runtime, or make a terminal process the parent/lifetime owner of the bridge.

Use bounded event polling first, not token streaming/WebSockets. Reuse the existing
job request as the coding turn/run; do not add a separate message submission queue.
The new transcript is a durable projection of accepted jobs and observed results,
not another independently mutable run-state machine. Old routes use the same write
path. No dual-write best-effort sidecar or post-hoc polling of jobs to invent events.

## Inspected flows and gaps

Paths are relative to the repository; symbols are the inspection anchors.

| Flow | Current source / behavior | Required increment |
| --- | --- | --- |
| Chat catalogue and transcript | `History.kt`: SQLite schema 4, `sessions`, `jobs`, UUID creation, `add`, `acceptResponse`, drafts/organization. `MainActivity.kt`: `submit`, `render`, `refresh`; only locally known active jobs are polled every 1.5 s while visible. | Owner catalogue and transcript reads; Android must discover terminal-created chats/turns, including already completed ones, not merely poll its own active rows. |
| Request acceptance | `ProjectRequests.kt:fetch` freezes proved project before legacy retry and checks health/IDs. `server.js` POST `/v1/jobs` -> `store.js:submit`. `root.commit` binds project, checks request content/session, single-flight/cap/review guards, creates task and job, appends `pocket.input`. | Reuse exact acceptance transaction for canonical user message and event. A duplicate accepted request returns its original result without new entries/tasks. |
| Execution/context | `store.js:Command.execute` commits `dispatched` memo before worktree/process; uses `projectWorkspaces.forSession`. `rpc.js:runPi` launches real Pi, serializes selected RPC events, waits for child exit before releasing a turn. Pi args select `pi-sessions`, ID `pocket` or `pocket-<sessionId>`. | Preserve this execution/context path byte-for-byte where possible. Clients never open or write these Pi session files. |
| Events/results | `rpc.js` forwards completed `message_end`, tool start/end, extension UI requests; no token deltas. `store.js:update` overwrites job answer/progress/pending; `complete` appends `pocket.result`. All tasks are admitted through one Durable root; current app session IDs are not dedicated Durable conversation IDs. No public catalogue, ordered per-chat event feed or cursor. | Add a per-app-conversation projection/event log in the same journal. Do not equate Durable root/task ownership with the public conversation identity or rewrite old journal entries. |
| Approval | `Command.onEvent` persists raw dialog in `job.pending`. `respond` checks raw ID and process-local `clients` map, clears pending, then writes an RPC reply. It has no durable answer receipt/serialized claim across two clients; raw dialog IDs can repeat between runs. | Owner-generated approval instance + atomic first-answer claim/receipt, explicit uncertain delivery state. A saved dialog is not evidence of a live sender. |
| Stop | `cancel(id)` aborts exactly that Durable task; abort records cancelled and clears pending. `MainActivity` sends the selected run ID. | Keep exact-run semantics; serialize approval/stop races and never implement cancel-on-client-disconnect. |
| Review | `ChangesActivity.kt` persists exact operation JSON in `review-requests/pending-<sessionId>` before POST; recovers GET by operation ID. `store.js:reviewAction/getReview/cancelReview`; `review.js` binds tests/commits/merges to snapshot revisions. | Retain URLs, operation IDs, saved JSON, project/revision validation and global guards. Expose review status/reference events, not automatic approval or a second repository-action implementation. |
| Identity/worktrees | `bindings.js:bindSession/legacyEvidence`, `project-workspaces.js`, `workspaces.js`: frozen default, immutable bindings, verified manifests, hash-derived tree paths/branches. Startup migration precedes `harness.resume`. | Canonical chat ID is existing `sessionId`; preserve `pocket`, project IDs, paths, branches, dirty state and manifests. Conversation reads cannot create/rebind/repair a worktree. |
| Persistence/lifetime | `store.js:openStore` exclusively locks `bridge.lock`, opens `assistant.sqlite`, resumes Durable; `close` closes harness. `scripts/bridge-work.mjs` independently owns the server via tmux, verifies owner/idle and backs up before stop. | Same single owner/lock/journal; no client opens a harness. Stable owner identity for cache scoping, distinct from process PID. Controller compatibility must be tested if health protocol changes. |

Relevant existing regression anchors: `bridge.test.js`, `sessions.test.js`,
`bindings.test.js`, `project-routing.test.js`, `project-http.test.js`,
`review.test.js`, `reliability.test.js`, `project-lifecycle.test.js`,
`check-bridge-work.py`, `check-project-lifecycle.py`, Android `HistoryTest`,
`ProjectHistoryTest`, `RequestStatusTest`, and JVM project policy tests.
The initial planning session did not rerun tests. The B01 continuation reran the
full bridge suite (74/74 including five new cases); it did not run Android or
standalone controller/lifecycle scripts. B02 then passed 10 new migration cases and
84/84 full bridge regressions; [storage evidence](conversation-baseline-storage.md).
No Android/standalone controller script or production-runtime claim is implied.

## Ownership and identity contract

- **Owner:** a persisted opaque `ownerId` in the existing journal, returned by
  authenticated health/new reads. PID remains process diagnostics only. Caches,
  event cursors and unsent operations are scoped to owner + conversation. Endpoint
  and visibility epochs still guard late responses. A changed owner at the same
  URL requires explicit reconciliation; never resubmit saved work to it by default.
- **Conversation:** `conversationId == sessionId`, including literal `pocket`.
  Existing clients may propose a UUID for a new chat; the owner validates/adopts it
  without remapping. Opening/creating a record cannot execute or prepare a tree.
  A new coding chat needs an explicit registered project for shared Send. Existing
  legacy omitted-project requests retain frozen-default behavior on old routes.
  Once established, a binding cannot change. Local empty drafts may remain local.
- **Run:** `runId == requestId == existing job.id`. Keep Durable `taskId` private
  execution identity, not a replacement run ID. Review `operationId` is separate.
  Idempotency key is the existing request ID; equality includes conversation, text
  and accepted project. Different content/target with the same key is 409.
- **Messages:** stable role-qualified IDs derived from the run ID (for example the
  tuple `[runId, user]` / `[runId, assistant]`), never a replacement for it. One
  user card and one assistant/result card per coding turn match current Android.
  Completed assistant messages may revise that one result card; its final state
  follows job completion. Do not append a new visible card for every `message_end`
  or duplicate the final answer. Keep current answer limits and status/error text.
- **Ordering:** owner assigns a monotonic turn ordinal at acceptance and event
  sequence per conversation under the transaction. Client clocks are not order.
  Legacy order is a documented stable sort by saved `createdAt`, then exact ID;
  mark it reconstructed, not proof of historical interleaving. Preserve Android's
  original local order/evidence until reconciliation has compared it.
- **Approvals:** owner-issued instance identity includes run + occurrence ordinal;
  raw Pi dialog ID/method/options remain payload. Store run/conversation/project,
  state and response receipt. Completion, cancellation, replacement and recovery
  invalidate actionable pending controls; cached payloads remain history only.
- **UI state:** drafts, selection, pin, finish/archive flags and existing titles
  remain preserved Android-local organization for B. Core may hold an imported
  initial display title/fallback label; no cross-client rename/archive synchronization
  or deletion protocol in this milestone. A local archived/finished chat must not
  conceal a newly observed active run: surface its activity and block unsafe local
  lifecycle changes. Client-local archive is not an execution lock for other clients.

## Persistence and small interface

Introduce versioned conversation/projection, ordered event and approval/receipt
records through supported Durable documents/entries in **the same storage**. Exact
layout should be chosen against the installed Durable transaction facilities in
B02; don't write ad-hoc SQL into its private tables. Keep Jobs/Reviews/Bindings as
current authoritative execution/binding records, referenced by the projection.
Every relevant mutation and its projection/events must commit together (including
runtime commits). Shared helpers should work with the caller's transaction; a
wrapper that commits afterwards leaves an unacceptable crash gap.

**B02 layout chosen/implemented:** `pocket.owner` plus session-scoped keyed
`pocket.conversation-baselines`, `pocket.turn-baselines`, `pocket.review-baselines`;
version 1, no private-table writes or extra Durable conversations. Turn/review bodies
are keyed separately from catalogue references. Baseline snapshot is explicitly
`baselineOnly`, immutable migration evidence with generation/sequence 0, not current
run/approval state. [Exact layout/validation](conversation-baseline-storage.md).
B03 now atomically covers writes/recovery since capture, including newly bound
chats, with retained snapshot.reset evidence for the unobserved interval. B03c
adds supported transaction-pinned bounded reads; no shared capability may rely on
B02's historical inspector or B03b's non-consistent diagnostic.

The normal client interface is only:

1. `listConversations(page)` — bounded catalogue with exact IDs/project and current
   run summary; refresh on connection/reconnect and periodically while attached.
2. `openConversation(id[, create])` — consistent snapshot + high-water cursor,
   transcript/current run/approval and immutable project. Idempotent creation by
   proposed ID; unknown read is 404, conflict is 409. Reads have no side effects.
3. `send(id, {requestId, text, projectId})` — the existing admission semantics.
4. `readEvents(id, after, limit)` — resumable ordered committed events, bounded by
   count and bytes; polling timeout/backoff is client policy, not run ownership.
5. `answerApproval(id, runId, approvalId, {responseId, answer})` — exact target,
   durable deduplication/receipt, no implicit permission to retry external delivery.
6. `stopRun(id, runId)` — target verification then existing cancellation; completed
   run is an idempotent no-op/result. Never stop “whatever is running now”.

Reuse existing project/review reads and action routes; do not fold commit/merge into
Send or generic approvals. A narrowly scoped migration/import operation below is
not a general conversation editing or execution interface.

Suggested additive HTTP mapping: `/v1/conversations` for list/create,
`/v1/conversations/:id` for snapshot, `.../:id/events?after=...&limit=...`,
`.../:id/approvals/:approvalId/response` for answers. Send and Stop may continue to
use `/v1/jobs` and `/v1/jobs/:runId/cancel`, with the new adapter validating the
conversation target. Keep all existing `/v1/sessions/...` routes. Final request/
response examples and bounded error cases belong to B05's contract, not a route
rename. A numeric next protocol (proposed 6) plus literal `conversationCore: true`
and an explicit event-schema version gate new clients; advertise only after all
old writes project events and safe approval handling exists. Extend the controller's
explicit protocol allowlist/test, never loosen owner/idle/backup verification.

### Event/cursor rules

Each envelope includes schema version, conversation ID, sequence, event type,
run/operation reference where applicable, and projection data. Types cover accepted
turn, result/progress revision, run status, approval opened/resolved/expired and
review state/reference. No raw token stream or complete private tool-output export.
Events are private history under the same bearer auth, not diagnostic log content.

Snapshot + high-water sequence must be read consistently. Events after that cursor
include every later committed change. A cursor is scoped to owner/conversation/log
generation, not simply an integer reusable elsewhere. Duplicate pages are safe;
missing/gapped, future, foreign or unsupported cursors fail explicitly and require
a fresh snapshot, never a new Send. Paginate a snapshot consistently if needed;
do not silently truncate history and advance past unseen rows. No retention/pruning
in B; layout must permit bounded reads without copying an unbounded transcript on
every poll. Explicit restore/rewind must invalidate affected cursor generations;
restore is not live SQLite copying or automatic host migration.

Android commits page application/upserts and cursor advancement in one local SQLite
transaction. Display uses message IDs/run IDs, not “append received text”. A crash
before cursor commit re-reads the same events harmlessly. Poll catalogue as well as
events: an event cursor in a known chat cannot discover a new terminal-created chat.
Old/unknown event schemas do not partially apply a page or enable action controls.

### Approval and Stop races / non-replay

Serialize an approval claim with pending replacement, terminal state and Stop in
owner transactions. First valid answer wins. Persist `responseId`, normalized
answer and dispatch intent **before** writing to the live RPC sender; concurrent
same-answer retries return that receipt, conflicting answers fail. A restart or
failure between durable claim and pipe write is **unknown delivery**, not permission
to send again. A receipt distinguishes claimed/attempted/unknown delivery from
observed run progress; it is not proof an external effect happened exactly once.
Never auto-answer a persisted dialog after restart. Require the exact current live
RPC sender and freshly verified pending instance before claim. If Stop wins, no
answer dispatch; if an answer has already won, Stop cannot undo its possible effects.

Legacy `/ui` must enter the same serialized claim path. It may translate an exact
raw dialog ID only while unambiguous for that run; a repeated raw ID cannot safely
identify an occurrence for an old client and must return a refresh/upgrade conflict,
not target a newer dialog. This is fail-closed compatibility, not silent approval
retargeting. New clients persist a response ID before POST; old-client duplicate
replies use a deterministic receipt for the same unambiguous instance/answer.

Do not move/remove `memo('dispatched')` in coding or review. Undispatched accepted
work can resume under existing rules. A dispatched task on reopen becomes
interrupted/unknown without another RPC/tool/repository action. Rebuild projection
and expire approvals in the same recovery path; do not emit a fictional success.
Observer disconnect, EOF, Ctrl-C and Android Activity destruction are detach only;
Stop is a separate explicit command. Host death still stops execution. Durable
history and tmux do not guarantee Android/Termux survival.

## Compatibility and non-destructive reconciliation

1. **Backend inventory before resume:** create owner/projection migration records
   once from existing Jobs, Reviews and immutable Bindings (including binding-only/
   manifest-only chats established in A). Snapshot existing text/answer/status;
   assign deterministic projection IDs/legacy ordering and a baseline cursor.
   Do not invent missing tool events, approval decisions or past delivery order.
   Old `pocket.input/result` entries stay untouched; they are not a complete feed.
   Migration creates no tasks and never calls workspace preparation or a provider.
   Compare/reject conflicting evidence atomically; a failed/retried migration
   cannot leave a partial projection or duplicate records. Recovery then uses the
   original dispatched guard. Test outstanding legacy review and pending approvals.
2. **Android inventory/import (separate bounded step):** backend cannot discover
   Android-only drafts/titles/old migrated messages. Use an explicit versioned,
   size-bounded, idempotent per-conversation history manifest from the paired app,
   with import ID/content digest and acknowledgement. Backend-known request/session/
   project identity must match; backend run state wins over stale Android status.
   Preserve conflicting local content as conflict evidence, never silently overwrite
   or duplicate it. Import historical-only rows as display records with provenance,
   original request IDs and saved order, **not Jobs/tasks eligible for execution**.
   Sending/uncertain local-only rows remain unresolved outbox records; import cannot
   turn them into admitted work, completed work or actionable approvals. Terminal
   labels historical/unverified rows distinctly. Missing project proof stays
   unresolved/read-only, never assigned today's default. Empty draft registration
   does not bind an old chat absent evidence. This is not Pi session import.
3. **Android schema/cache:** additive upgrade from v4 (and supported earlier
   fixtures) adds owner scope, message/event cache, cursor, import acknowledgements
   and outbox linkage; retains sessions/jobs IDs, drafts/organization/selection,
   encrypted pairing and pending review JSON/operation IDs. Compare inventory before
   marking imported/reconciled. No deleting/recreating old tables as the rollout.
   Prove terminal-only runs/results are discovered even when the app has no active
   jobs. Keep accepted/uncertain outbox IDs stable and do exact-ID lookup before
   retry, never generate replacement sends while adopting a remote message.
4. **Mixed versions:** old clients keep old wire shapes, Pi session identities and
   project behavior, but their writes participate in projection. New Android on an
   old bridge remains in supported legacy mode for existing chats; shared attach
   reports unavailable, no guessed catalogue or missing-capability Send fallback.
   Freeze owner/endpoint across proof + action. Refuse wrong-owner pages/actions.
   Do not switch an uncertain shared outbox item to legacy transport on downgrade.
5. **Backups/rollback:** source/fixture work never opens production state. Before
   any real upgrade, separately agree maintenance/idle/owner checks and private
   Android + bridge/Pi-session/worktree backups and logical comparison. Rollback
   must not erase post-upgrade accepted work or restore a live journal over another
   owner. Once new writes exist, stop and reconcile explicitly rather than blindly
   rolling files back. No new pruning, path relocation, branch reset or auto-repair.

## Terminal choice and acceptance

Implement a minimal authenticated terminal HTTP client first (list/open/read/send,
exact approval, explicit Stop, disconnect). Persist connection/owner/cursor/outbox
privately; token comes from protected config/input, never argv, shell history or
logs. Local HTTP only on loopback; remote access needs the existing HTTPS policy,
not a public listener/tunnel configured by this milestone. The client must not call
`openStore`, launch a provider, manage bridge lifetime or write Pi session files.
Standard Pi CLI `--resume` against those files is **not** attachment and risks a
second session writer. A future Pi extension can adapt the same interface, after
separately reading/verifying Pi integration documentation; it is not needed for B.
This keeps the real Pi tool environment on the owner intact.

Deterministic acceptance first: separate owner process, fake RPC, two disposable
projects; actual lost acceptance response; duplicate event pages; simultaneous
Android/terminal sends; competing approvals and Stop; terminal exits before result;
Android process absent while work completes. Reopen Android sees same conversation,
run/project IDs, user/result cards once, ordered next turn, exact worktree/context
selection and correct approval state. Assert dispatch markers, source HEAD/staging
and tree/manifest identities, not just matching UI text. Separately test idle/orderly
reopen, undispatched resume and dispatched coding/review/approval uncertainty with
no replay; don't combine these into a general host-survival claim.

Only after fixture/data/build gates pass, agree one normal deployment and visible
Android → terminal → Android smoke in disposable projects. No real default-branch
merge/commit/push is needed. Screen-off/Termux-kill/PC/web/offline multi-writer sync,
personal no-Git chats, knowledge, notifications and full Pi transcript/tool replay
are outside B.

**B01/B02/B03 are complete in source/fixtures, not deployed. B04 exact approval
claims/receipts remains unimplemented and is not authorized by B03 completion.
Stop after B03c. No production runtime action occurred.**
