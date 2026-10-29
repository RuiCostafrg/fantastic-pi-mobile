# Small next steps

**Current checkpoint — 2026-10-27: C01 design complete; stop before C02a.**
[Personal-chat design](personal-chat-design.md) traces current Git assumptions,
selects explicit immutable chat identity, Git-free bootstrap, opt-in client views
and a constrained conversation-only Pi launch. Tool enforcement has source/doc
support but has not been runtime-tested. C02/C03 are split into smaller steps below.
Recommend **C02a only**, after design approval; no runtime implementation yet.
B11 remains complete; its deployment/evidence and coding behavior are the baseline,
not a fresh runtime observation. Publication is a separate scope decision.

**Previous checkpoint — 2026-10-23: B11 complete.**
Normal app deployed; actual real-provider Android → B09 terminal → detach while
running → Android continuity passed with two ordered unique turns, same worktree
and remembered context. All original 29 Android jobs/28 bridge tasks/232 saved file
hashes preserved; eight additive legacy bindings validated. One healthy protocol-6
owner, zero active work, admissions open. Gboard/settings unchanged. No commit/push.
Recovered 159/159 bridge, normal build/unit/test-APK/lint and controller gates passed;
no heavy rerun or source modification needed. No screen-off/host-death claim.
[Full evidence, preservation and limitations](b11-deployment.md).

**Previous checkpoint — 2026-10-21: B11 plan agreed; readiness blocked.**
Fresh controller status is unavailable/storage-lock-missing, not proof of idle.
Phone readiness requests manual unlock; preflight reports screen off. Gboard stays
unchanged. No normal-app data/backup/install/migration/launch, bridge startup or
provider work; no tests/builds rerun. B11 remains unchecked. Ask user to wake/unlock
and leave the phone on, then rediscover all gates.
[Actual evidence and next gates](b11-deployment.md).

**Previous checkpoint — 2026-10-21: B10 complete in isolated cross-client fixtures;
stop before B11.** Actual Android/SQLite and real B09 terminal processes proved
same-chat next-turn context, detached/offline completion, ordered reconciliation,
simultaneous Sends/approvals, original-ID response-loss recovery, duplicate pages,
exact Stop and owner/task recovery without replay. **9 new + 30 regression headless
Android, 36 JVM, 159 bridge** tests passed; reliability-only build/lint and isolated
tmux passed. Prior work retained; no production/normal-app/visible UI/provider/
deployment action. [Actual commands, failures, preservation and limits](cross-client-continuity.md).

**Previous checkpoint — 2026-10-21: B09 complete in source/disposable process fixtures.
Stop before B10.** Minimal HTTP-only terminal list/open/read/Send, exact approvals,
confirmed run-scoped Stop and detach. Private owner/cursor/outbox/response IDs are
persisted before dispatch; original-ID recovery, strict capability/schema/owner/
credential checks and no legacy fallback. **10/10 process, 158/158 full bridge tests
passed** with disposable independent owners/clients, fake workers and actual HTTP
loss. No Android/device operation, production data/runtime, provider, deployment,
commit or push. Earlier uncommitted work retained.
[Client usage, evidence, failures and limitations](terminal-conversations.md).

Project: `~/projects/fantastic-pi-mobile`.

**Goal:** first use the app to code safely in different projects; then use that
coding app to build our durable personal agent with multiple chats and clients.
The product direction lives at the top of [PROGRESS.md](../PROGRESS.md).

## How to run one step

Short prompt:

> In ~/projects/fantastic-pi-mobile, read docs/next-steps.md and do the explicitly authorized step only.

**Previous checkpoint — 2026-10-21: B08 complete in source/isolated fixtures.
Stop before B09.** Shared foreground catalogue/cache/import/outbox reconciliation
and native remote transcript/activity discovery, strict owner/credential/lifecycle
gates, exact persisted approval IDs/Stop and existing Changes recovery are wired.
**36/36 JVM, 148/148 bridge, 35/35 Android**, normal/fixture build/test-APK/lint and
isolated real-tmux controller passed. Announced live fixture discovery, Send, exact
Stop, lost approval response/reopen and legacy UI regressions passed. Only verified
previously absent isolated APKs installed, then removed. No normal installation/
data access/migration, production bridge operation, real provider, deployment,
commit or push. Existing local work preserved. [B08 evidence](android-shared-conversations.md).

Previous checkpoint — B07 storage and Android SQLite verification complete:
Stop before B08 at that checkpoint. Additive schema 5 cache/outbox reconciliation has no
Activity/UI or transport integration. Separately authorized headless data tests on
actual Android SQLite: **19/19 passed** — ConversationCacheTest 9, HistoryTest 7,
ProjectHistoryTest 3, no failures/skips. Device rediscovered and exact fixture APK/
runner target identities verified before installation; both previously absent
fixtures removed afterward. No code fix needed; fixture build/test-APK/lint passed
again. Prior **33/33 JVM (11 new), 148/148 bridge**, isolated real-tmux and normal
build/lint evidence remains, not a new bridge run. [Storage/evidence](android-conversation-cache.md).
No normal-app installation/data access/migration, Activity/visible UI test,
production bridge operation, deployment, provider work, commit or push.

Previous checkpoint — B01–B06 complete; stop before B07:
B06 source/synthetic fixtures: bounded historical-only import, exact digest/receipts,
immutable conflicts and non-executing read pages in the same owner. **13/13 new,
45/45 combined, 148/148 bridge**, isolated real-tmux and source/doc checks passed.
[Import contract/evidence](conversation-history-import.md). No production data
access/import/deployment/restart, app installation, commit or push. B07 not started.

Previous B05 checkpoint:
B05 is source/fixture-only: protocol-6 authenticated shared interface, bounded
reads, exact receipt/Stop adapters and strict controller checks. **6/6 new,
32/32 focused, 135/135 bridge, 22/22 JVM**, isolated real-tmux and source/doc checks
passed. [B05 contract/evidence](conversation-api.md). No production runtime/data
access, deployment/restart, app install, commit or push. B06 was not started.

Previous B04 checkpoint:
B04b adds durable exact-answer receipts and serialized Stop: **10/10 new,
129/129 full bridge tests**, 22/22 JVM tests, normal build/lint and isolated tmux
controller checks passed. The later user request explicitly authorized continuation
and a live phone test: privately backed up idle state, started the compatible
protocol-5 bridge and passed real normal-app coding/diff/Changes-test/reopen/Stop.
Original 14 Android chats/27 jobs, 25 bridge task rows and 227 saved files preserved.
[Contract, full evidence and limits](approval-response-delivery.md). No shared HTTP
capability or Android upgrade; B05–B11 remain pending. Earlier dated no-deployment
and stop-before-B04b entries below describe their earlier checkpoints.

Or:

> Read docs/next-steps.md and do the next unfinished step only.

Read this procedure, the safety rules and the selected step. Load other documents
only when that step needs them. Implement **one step**, verify its completion
criterion, update its status/evidence below, and stop. If blocked, record the
blocker rather than expanding into the next step. Split a step further if actual
code inspection shows it is still too large.

At completion, record changed files, tests actually run and their results, any
migration/compatibility effect, and the next step. Summarize in PROGRESS.md without
copying the whole plan. Commit/push only when requested; report whether work is
local or published. A checked box needs evidence, not just an implementation claim.

## Safety and compatibility

- Discover current Git/runtime state; historical PIDs, ports and readiness are not
  current evidence. Preserve unrelated changes and existing chats/worktrees.
- Keep each incremental change backward-compatible with existing clients or
  explicitly gated until its client is ready. Unsupported project requests fail
  clearly; they never run in the configured default repository by accident.
- Existing chats retain their repository, request IDs and worktree identity.
  Project selection cannot silently rebind a chat or an accepted request.
- Use disposable repositories for tests. Keep original checkouts/staging safe;
  explicit review/commit/merge and uncertain-action non-replay remain intact.
- Back up private state before real migrations/deployment. Agree visible phone
  tests and bridge interruption with the user; source changes alone do not justify
  restarting production. Keep tokens/history/backups out of public commits.
- SQLite preserves state; a live independently owned bridge executes work.
  Closing a client should not stop it. Host death requires reconciliation, not
  automatic replay of uncertain external actions.

## Milestone A — code in different projects

Execute in order. **Steps 01–09 are complete** (2026-10-20).
Step 08's headless Android/independent-worker lifecycle harness passed twice.
Step 09 deployed normal 0.7.0 and passed the agreed two-project visible smoke;
see [deployment evidence](project-deployment.md). Milestone B is decomposed below; B01 characterization and B02 baseline storage are
complete in source/fixtures. B03a staging and B03b live writes are also complete;
B03c bounded consistent reads is now complete in its separate fresh session;
37/37 combined focused and 111/111 bridge tests passed. Stop before B04.
No B deployment has occurred.
Design and focused test plan: [multi-project-design.md](multi-project-design.md).

### 01 — Inspect and choose the smallest design

- [x] Trace the current flow: Android chat → HTTP submission → Durable request →
  workspace preparation → review/test/merge. Locate the global `PI_WORKSPACE` use.
- [x] Write a short `docs/multi-project-design.md`: project identity, chat binding,
  legacy mapping, request/review routing and the smallest compatible rollout.
- **Done:** every routing/migration point has an identified source location and a
  focused test plan. Explain any changes needed to steps 02–09. No runtime/code
  change, installation or phone test in this step.

### 02 — Store a trusted project registry

- [x] Implement only project registration/lookup persistence and validation at the
  seam chosen in 01. Support an explicit local default branch without a remote.
- [x] Test reopen persistence, invalid/non-Git paths and duplicate/alias handling.
- **Done:** trusted projects have stable identities; selecting/registering one
  cannot execute work or change existing chat routing. Existing default behavior
  still passes its regressions. UI and multi-project execution stay out of scope.

### 03 — Persist immutable chat/request bindings

- [x] Bind a conversation and its accepted requests to a registered project.
  Preserve the existing default-project behavior and saved legacy workspaces.
- [x] Test restart recovery, legacy mapping, same-ID retries and rejection of a
  conflicting project/chat/request binding, including while work is active.
- **Done:** accepted work cannot be silently retargeted. No production migration
  or UI change; multi-project execution remains gated until step 04 passes.

### 04 — Route execution and review to the bound project

- [x] Resolve the bound project for worktree preparation and every review/test/
  commit/merge path, rather than relying on one global workspace manager.
- [x] Use two disposable repositories to test isolated worktrees, simultaneous
  chats, legacy reuse and correct review/test/merge targets without cross-writes.
- **Done:** backend tests prove both coding and review use the binding. Original
  checkout/staging protections remain green. No Android UI or production restart.

### 05 — Expose the minimal authenticated project interface

- [x] Add project listing/explicit registration and bound-conversation interaction
  needed by the app, using the contract from 01. Registration requires deliberate
  user action and validation, not arbitrary model-provided path execution.
- [x] Test authentication, validation, old-client compatibility and unsupported
  capability handling. Reuse an existing route if 01 selected it; avoid duplicates.
- **Done:** an isolated HTTP test can discover/select two projects and submit a
  bound request safely. No real provider or device action required.

### 06 — Persist project selection in the Android client

- [x] Extend the client/history representation for the project identity and request
  contract. Preserve existing chats and exact IDs; distinguish unbound new chats
  from legacy chats with an established repository.
- [x] Test database upgrades, selection/request persistence and old/offline bridge
  behavior in an isolated app sandbox.
- **Done:** data/client tests and build/lint pass; no visible picker or normal-app
  database migration yet. A missing capability cannot misroute a request.

### 07 — Add a small new-chat project picker

- [x] Let the user choose/register a project for a new coding chat, show the selected
  project before Send and keep the established binding visible after reopening.
- [x] Existing chats show their binding instead of a control that silently changes
  it. Handle empty/error/offline states clearly; preserve existing chat navigation.
- **Done:** focused UI/fixture tests and build/lint pass. Keep the native design;
  no broad redesign or installation over the normal app in this step.
- **Verified:** 3 fixture UI tests passed twice after user authorization. Fixed a
  test-only cold-launch accessibility-readiness race; no app change needed. Host
  policy tests (22/22), normal/fixture build and lint, and bridge regressions (67/67)
  passed. Temporary fixtures removed; normal app unchanged. See [project-picker.md](project-picker.md).

### 08 — Verify reconnect and client-close behavior

- [x] Test sending to each project, dropped responses, same-ID retry, client-close/
  reopen and restored selection/results. Run the relevant existing regressions.
- [x] Verify approval/cancellation/review state remains scoped to the right request
  and project. Use isolated deterministic workers, not real external side effects.
- **Done:** project bindings/IDs/results persist, no duplicate dispatch or crossed
  project writes, and closing a client does not cancel a live independent worker.
  This is not a claim of survival after Android kills Termux.
- **Verified:** actual headless Android client processes, a separate Node bridge and
  deterministic fake RPC peers; complete job/review acceptance responses really
  dropped at a proxy. All 4 phases and dispatch/worktree checks passed twice;
  14 Android data/status, 22 JVM and 68 bridge tests passed. Isolated real-tmux
  regression reproduced/fixed controller protocol-5 verification, then passed.
  No normal deployment or new visible UI scenario. See [project-lifecycle.md](project-lifecycle.md).

### 09 — Deploy and do one agreed pi-droid coding smoke test

- [x] Agree the visible test and any needed idle bridge restart with the user.
  Discover live work, back up private state and inspect APK identity before upgrade.
- [x] Use two disposable projects in the real app: choose, send harmless coding
  requests, inspect changes/test evidence and close/reopen. Verify migrated legacy
  chats still work. Keep real project default branches and unrelated staging safe.
- **Done:** record actual per-project outcomes and preservation evidence; leave
  the normal app/bridge healthy and report any limits. Ask before extending to
  disruptive screen-off tests, publishing external work or deleting test history.
- **Verified:** normal 0.7.0 / schema 3→4 deployment; 12 original sessions, 25 jobs,
  pairing, 21 original bridge tasks and 217 saved files preserved. Real A/B coding,
  one-file diffs and native Changes tests passed with separate markers; client
  Home/relaunch and force-stop/relaunch retained B/result/binding/check. Legacy
  chat reopened read-only. Bridge verified/idle. Narrow missing-root historical
  snapshot compatibility fix: 69/69 bridge, 22/22 JVM, normal build/lint and diff
  checks pass. See [project-deployment.md](project-deployment.md).

## Milestone B — one conversation core, Android → terminal → Android

**B01, B02 and B03a/b/c are complete in source/fixtures (2026-10-20).
B04a/b are now complete and the compatible bridge passed the explicitly authorized
live smoke; B05–B10 are complete in source/isolated fixtures; B11 remains incomplete.**
[B05 final API and evidence](conversation-api.md). Source trace,
smallest compatible design, ownership/identity/interface, migration and recovery
rules: [shared-conversation-design.md](shared-conversation-design.md). Read that
contract before a B step. The existing locked Durable bridge remains the only
executor; retain the real Pi RPC environment and existing review/worktree modules.
A minimal terminal HTTP client is the first terminal/Pi integration, not stock Pi
`--resume` and not a second owner. PC/web and Pi extension work are deferred.

Execute in order, **one bounded step per request**, then update evidence and stop.
If an individual step is too large after inspection, split it before implementation;
do not bundle client rollout, real migration or deployment into backend work.
**B03c complete in its fresh session: 8/8 new, 37/37 combined focused,
111/111 full bridge tests**; [bounded read evidence](conversation-bounded-reads.md).
The later continuation authorizes **B04a only**, then stop. B03b passed **11/11 new,
29/29 combined focused and 103/103 full bridge tests**;
[live-write evidence](conversation-live-writes.md). B03 was split before implementation into transition
staging (a), transactional live writes (b) and bounded reads (c). B03a passed
**8/8 focused and 92/92 full bridge tests**; see [transition evidence](conversation-transition.md).
The user subsequently explicitly approved B03b in a fresh Pi coding session, then
B03c in another fresh session, then stop. Keep each independently verified and
recorded. That B03 sequence is complete; the later continuation now authorizes
B04a only, not B04b/deployment. All earlier safety limits remain.
No production runtime status, deployment or new capability is claimed by this plan.

### B01 — Characterize the existing contract in isolated fixtures (complete)

- [x] Add focused characterization tests/fixture inventory using the existing
  `openStore`/HTTP interface: exact session/request/project/operation/task identity,
  legacy `pocket`, same-ID/content conflict, simultaneous same-chat admission,
  per-chat Pi session args, approval/Stop isolation and dispatched non-replay.
- [x] Cover representative saved Jobs/Reviews/Bindings plus Android v4 history
  shapes: backend-only, Android-only historical/uncertain rows, binding-only chats,
  dirty worktrees, pending review JSON and unresolved legacy projects. Use synthetic
  fixtures only; preserve source order and identify future comparison assertions.
- **Done:** focused fixture tests plus existing bridge regressions pass; inventory
  records what is authoritative, absent or uncertain. No new storage schema,
  protocol, route, core implementation, Android behavior or production-state access.
  Do not add failing assertions for future features to the default suite.
- **Verified:** new `bridge/test/conversation-contract.test.js` **5/5 passed**;
  `cd bridge && npm test` **74/74 passed**. Synthetic v4 JSON plus ownership/absence/
  uncertainty comparison inventory: [conversation-contract-baseline.md](conversation-contract-baseline.md).
  Real disposable Git/Durable/HTTP/fake-RPC and shell-marker cases only; no phone,
  production state or runtime change. Initial test-only task-ID type assumption
  corrected: existing Durable `taskId` is numeric; client IDs remain strings.
- **Next:** B02 only when requested. Stop; this step does not authorize later steps.

### B02 — Add owner identity and non-destructive conversation baseline (complete)

- [x] Add versioned owner/conversation projection storage in the existing journal
  through supported Durable transactions; retain lock, tasks and all old documents.
  Adopt `conversationId == sessionId`, `runId == requestId`; stable role-qualified
  message IDs and deterministic marked-legacy order. Keep execution/bindings in
  Jobs/Reviews/Bindings rather than introducing a second mutable run model.
- [x] Before resume, idempotently inventory backend-known jobs/reviews/bindings and
  build baseline snapshots/cursors with an atomic migration marker. Include chats
  without jobs; no invented tool events or automatic workspace preparation.
- **Done:** isolated old-journal fixtures migrate/reopen twice with identical
  canonical IDs/order and unchanged old task inputs/entries, Pi files, manifests,
  branches and dirty state. Conflict/failure rolls back; no extra dispatch. Cover
  undispatched and uncertain dispatched legacy work separately. No new advertised
  capability, HTTP route, Android migration or production journal access.
- **Verified:** `bridge/src/conversations.js` adds Durable singleton/keyed baseline
  documents; `store.js` initializes them in the binding transaction before resume.
  Internal historical inspection only; old Jobs/Reviews/Bindings remain execution
  authority. New `conversations.test.js`: **10/10 passed**; full bridge **84/84**.
  [Evidence/layout/limits](conversation-baseline-storage.md). No deployed migration.
- **Next:** B03 only when requested. Stop. B02 baseline is immutable/historical;
  B03 must cover all writes made since capture before any live attachment.

### B03 — Project existing writes into atomic ordered events (a/b/c complete)

The migration/reset, every live mutation path, and bounded snapshot/event protocol
are distinct verification scopes. Record and verify **each substep separately**;
the later explicit user approval permits fresh coding sessions for B03b then B03c.
B03a–c have now all passed independently. No HTTP capability during any B03 substep.

#### B03a — Stage the B02→projection transition (complete)

- [x] In the pre-resume transaction, reconcile current Jobs/Reviews/Bindings,
  including B02-era new chats/turns and changed recovery/results, into staged
  projection records. Keep immutable B02 evidence, owner/message/run/project IDs,
  baseline generations and existing ordinals. Append new ordinals after existing
  ones; mark reconstructed ordering, never infer order from client clocks.
- [x] Persist immutable revision/snapshot references and an explicit `snapshot.reset`
  event for initial capture or unobserved changes, not invented past run/tool/
  approval events. Unchanged reopen is idempotent. Corruption/conflict/failure
  refuses or rolls back the whole transition before dispatch.
- **Done:** isolated tests prove post-capture inclusion, stable IDs/order/generations,
  retained old snapshots, repeat reopen, rollback/corrected retry and non-replay;
  bridge regressions pass. Internal inspector is explicitly `stagedOnly`; no live
  freshness/current approval claim, legacy write-path instrumentation, HTTP/Android
  change or production migration.
- **Verified:** `conversation-transition.test.js` **8/8** and full bridge **92/92**,
  zero failures/skips. Includes initial B02/project rollback, retained-body refusal,
  wrong reset identity/schema and real fake-RPC pending recovery/non-replay.
  [Layout/evidence/limits](conversation-transition.md). B03a completed before B03b;
  continuation into B03b/B03c is a later explicit authorization, not scope creep.

#### B03b — Make all existing writes transactional with live projection/events (complete)

- [x] Before promotion, repeat/validate B03a reconciliation for all intervening
  writes/recovery. Then route existing admission, progress/result, completion/
  abort/recovery, raw approval-pending changes and review status through transaction-
  aware projection helpers; state + projection + ordered event share one commit.
- [x] Duplicate request/operation IDs add no messages/events/tasks. Keep one result
  card per run, stable ordinals, review references and original dispatch guards.
- **Done:** tests prove every old-route mutation/recovery is visible once, atomic
  rollback/fault points and duplicate-admission safety; no untracked write after
  promotion, crossed project state or replay. Bridge regressions pass. No durable
  approval claim/receipt yet (B04); do not expose shared attachment capability.
- **Verified:** 11/11 new, 29/29 B02/B03a/B03b focused and 103/103 full bridge
  tests passed, zero failures/skips; syntax/diff/local Markdown link checks passed.
  [Layout, commands, mutation audit and limits](conversation-live-writes.md).

#### B03c — Add consistent bounded internal snapshot/event reads (complete)

- [x] Add bounded count/byte pagination with immutable snapshot/high-water tokens;
  subsequent committed events bridge snapshot races. Validate owner/conversation/
  generation/schema/sequence, explicit gap/future/foreign-cursor errors, duplicate
  pages and no silent truncation or pruning. Do not return the staging inspector
  as a current client snapshot.
- **Done:** tests cover concurrent snapshot/feed writes, full multi-page history,
  stable revisions/one result card, reconnect/duplicate pages, reset transitions,
  review/recovery events and non-replay. Existing cap/review/project guards remain
  green. B03 is now complete; HTTP exposure and approvals wait for B04/05.
- **Verified:** 8/8 new read tests, 37/37 combined B02/B03a/b/c and 111/111
  full bridge tests passed, zero failures/skips. Supported Durable capture pins
  immutable revisions/high-water; separate snapshot/feed tokens and pinned feed
  upper bound; count 1–200/default 50, entire UTF-8 JSON envelope bytes
  1024–1048576/default 262144, explicit oversized-item/gap/identity errors.
  [Protocol, exact commands/evidence and limits](conversation-bounded-reads.md).
  No HTTP/health/capability change, production access, provider, deployment or phone
  test. All earlier uncommitted work preserved. Stop; B04 is not authorized.

### B04 — Serialize exact approvals and explicit Stop (split before implementation)

B04a/b are separate safety scopes. The current continuation authorizes **B04a
only**, then verification/evidence and stop. B04 remains incomplete until both pass.
No shared approval capability, deployment or production migration is authorized.

#### B04a — Persist approval occurrence lifecycle (complete)

- [x] Add owner/run/conversation/project-scoped durable occurrence identities for
  observed live RPC questions, including fresh identity for each replacement even
  when raw dialog IDs/payloads repeat. Preserve raw Pi wire IDs and old Android
  fields. Pending pointer/lifecycle and job/projection change share one transaction.
- [x] Expire observations on clear/replacement/terminal/recovery; saved pending or
  observed status alone never proves a live sender or authorizes an answer.
  Validate/expire old ledger evidence before resume, preserving historical records,
  IDs/bindings/worktrees and dispatched-action non-replay. Conflicts fail closed.
- **Done:** isolated store/fake-RPC fixtures cover replacement/raw-ID reuse,
  clear/terminal/recovery expiry, atomic rollback, repeat reopen and exact scoped
  identities. Prior bridge regressions pass. A clearly internal non-actionable
  inspector may expose evidence; no new answer/Stop path, claims/receipts, HTTP
  route/capability or Android integration. Stop before B04b.
- **Verified — 2026-10-21:** `approval-lifecycle.js`, additive `store.js` integration,
  7 real-journal lifecycle tests plus 1 partial-index transaction-double regression.
  **8/8 new, 45/45 focused, 119/119 full bridge**, zero failures/skips. Logs:
  `$TMPDIR/b04a-focused.log`, `b04a-bridge-suite.log`; explicit partial-index red
  (0/1) in `b04a-partial-red.log`, then green. Earlier fixture cleanup timeouts and
  narrow B03b repeated-question/recovery expectation changes are documented, not
  hidden. `node --check` all source/test JS and `git diff --check` passed; local
  changed/untracked Markdown file/anchor validation **91 links passed**. Static log:
  `$TMPDIR/b04a-static-checks.log`. [Storage, startup ordering, evidence and limits](approval-occurrence-lifecycle.md).
  No source commit/index manipulation, production state/runtime, provider, phone,
  dependencies, deployment or other agent. Previous B01–B03 work preserved.
  B04a observations are NOT answer permission; legacy reply/Stop semantics remain
  for B04b. B04 overall remains incomplete. **Stop now; B04b requires later scope.**

#### B04b — Serialize claims/receipts, legacy answers and exact Stop (complete)

- [x] Persist approval occurrence IDs and normalized response-ID receipts; require
  exact run/conversation/project, current pending occurrence and live RPC sender.
  Atomically claim first answer before pipe dispatch; never retry a claimed/unknown
  external delivery. Expire controls on replacement/terminal/recovery.
- [x] Make old `/ui` use the same claim path; translate raw IDs only when unambiguous,
  failing closed on reused raw IDs. Serialize Stop/answer/replacement races; Stop
  targets one run and terminal Stop is harmless. Disconnect never calls Stop.
- **Done:** concurrent opposite answers produce at most one RPC response attempt;
  same response ID returns the same receipt, changed payload conflicts; stale,
  crossed and repeated-dialog answers fail. Fault before/after pipe write returns
  uncertainty without replay; restart invalidates saved approvals. Both race orders
  with Stop are tested. Existing single-client UI/review safety regressions pass.
- **Verified — 2026-10-21:** 10/10 new receipt/race/fault/recovery tests, **129/129
  bridge**, **22/22 JVM**, normal build/lint, isolated real-tmux controller and
  syntax/whitespace/Markdown checks passed. Actual normal-app coding, one-file diff,
  native `sh check.sh` -> **B04B_CHECK_OK** / exit 0, reopen and live Stop passed.
  Private backup and exact original-state comparisons passed; compatible bridge is
  verified/idle. No app/schema upgrade or new HTTP capability. Live approval races
  were fixture-tested, not induced against production. [Detailed evidence](approval-response-delivery.md).
  Changes remain local/uncommitted/unpushed. Stop before B05.

### B05 — Expose the small authenticated conversation interface (complete)

- [x] Add catalogue/create/open snapshot/event reads and exact approval response
  mapping from the design; reuse job Send/Stop and existing project/review routes.
  Validate exact targets, bounds/auth/schema and stable owner identity.
- [x] Document request/response/error examples and mixed-version behavior. Gate with
  an explicit conversation capability/event version (proposed protocol 6); update
  the controller's strict numeric allowlist and isolated owner/backup regressions.
- **Done:** isolated HTTP tests cover old clients/routes, new-client refusal of
  unsupported capability, pagination/cursor errors, auth/size/identity checks,
  acceptance-response loss and catalogue discovery of completed remote turns.
  Metadata-only logs stay private. Real-tmux fixture passes; production is untouched.
- **Verified — 2026-10-21:** **6/6 new HTTP/transport, 32/32 focused, 135/135 full
  bridge, 22/22 JVM**, isolated real-tmux controller, syntax/whitespace/local Markdown
  checks passed. Protocol 6 + conversation capability/event schema/owner gates;
  existing routes preserved. Exact socket-dropped acceptance retry dispatches once;
  pinned pages/events, completed remote discovery, approval receipts and scoped Stop
  tested. Strict numeric 4/5/6 controller retains ownership/idle/backup checks and
  rejects malformed metadata. [Contract, files, commands and limits](conversation-api.md).
  No production access/deployment/restart, installation, commit or push. All changes
  remain local; existing uncommitted work preserved. **Stop before B06.**

### B06 — Import historical-only client evidence without execution (complete)

- [x] Add a narrow versioned, size-bounded, per-conversation history import with
  import ID/digest/acknowledgement. Backend evidence wins for accepted run state;
  matching IDs deduplicate; content/project conflicts return explicit evidence.
- [x] Preserve original Android-only historical request IDs/order/provenance as
  display-only records, never runnable Jobs/tasks. Uncertain/sending local-only
  rows remain unresolved, approvals non-actionable and unproved projects read-only.
  This is neither Pi session import nor a Send endpoint.
- **Done:** synthetic inventory/import/reopen/retry tests prove no task creation,
  provider/worktree action, inferred success or default rebinding; partial/failing
  imports roll back, changed manifests conflict and acknowledgement loss deduplicates.
  Pending review JSON/operation IDs are not rewritten. No production data import.
- **Verified — 2026-10-21:** **13/13 new, 45/45 combined, 148/148 full bridge**,
  isolated real-tmux controller and syntax/whitespace/local Markdown checks passed.
  Evidence-only documents in the existing owner; bounded history reads and opt-in
  catalogue with separate history capability/schema, immutable manifest/digest/
  receipt/conflict records and pinned revisions. No executable projection/cursor
  rewrite. Local-only IDs cannot become tasks; unproved chats cannot default-bind.
  Fixtures prove order/provenance, actual lost HTTP acknowledgement, atomic faults,
  competing Send/import, stale live approval isolation and fail-closed corruption.
  Original synthetic preferences/review JSON and actual fixture jobs/reviews/tasks/
  bindings, dirty trees/Pi files and source staging preserved. [Contract/files/
  commands/limits](conversation-history-import.md). No production access/import,
  deployment/restart, app installation, commit or push. **Stop before B07.**

### B07 — Add Android cache/outbox reconciliation storage (complete in source/isolated fixtures)

- [x] Add an additive schema upgrade for owner scope, transcript projection/cursors,
  import acknowledgements and existing outbox linkage. Preserve all old IDs,
  titles/drafts/organization, selection/pairing and review preferences exactly.
- [x] Add headless policy/cache operations: apply snapshot/page and cursor in one
  transaction, upsert by stable IDs, reconcile remote runs with local requests,
  preserve conflicting evidence, reject wrong-owner/schema/project data. Accepted
  or uncertain sends retain IDs; adoption is not resubmission.
- **Done:** host tests and build/lint pass; fixture-only database upgrade/reopen and
  rollback tests cover supported old versions through v4, repeated pages/process
  closure, historical-only import and unresolved outbox rows. Device data tests
  require explicit agreement before installation; record blocked if unavailable.
  No Activity behavior change, normal-app migration or visible phone test.
- **Source/host verified:** schema 5 adds only cache/conflict tables; immutable
  generation-scoped revisions, staged snapshots, atomic heads/cursors, pinned history,
  bounded manifest/digest/receipt storage and original-ID inert outbox links. Wrong
  owner/schema/project/identity and gaps/conflicts retain evidence without partial
  adoption or legacy writes. **33/33 JVM, 148/148 bridge**, isolated real-tmux and
  normal/fixture APK/test-APK/lint passed. [Full contract/evidence](android-conversation-cache.md).
- [x] **Android SQLite completion gate passed — 2026-10-21:** separately authorized
  fixture-only ConversationCacheTest **9/9**, HistoryTest **7/7**, ProjectHistoryTest
  **3/3**, **OK (19 tests)**, no failures/skips. Actual supported v1–v4 upgrades,
  reopen/rollback, cache/cursor/import/outbox and preference preservation assertions
  passed on Android 12. Exact fixture APKs/runner target verified before installation;
  both previously absent packages removed afterward. No code fix needed; fixture
  build/lint passed. No normal-app data access, Activity or production operation.
  **Stop before B08.**

### B08 — Reconcile Android through the shared interface (complete in source/isolated fixtures)

- [x] Wire catalogue/snapshot/event refresh and history inventory/acknowledgements
  into actual foreground/lifecycle/connection flows. Discover terminal-only chats
  and already completed turns, not just local active jobs. Preserve native UI and
  client-local organization; remote active work must remain discoverable even in
  a locally finished/archived chat. Keep drafts and selection stable.
- [x] Persist send/answer IDs before dispatch; keep exact-ID uncertain recovery,
  strict capability/owner/endpoint/visibility guards, fresh approval evidence and
  existing Changes JSON/operation recovery. Old bridges retain supported legacy
  behavior but cannot silently receive shared-mode uncertain sends as fallback.
- **Done:** deterministic client-policy tests cover old/offline/replaced owner,
  event/schema gaps, stale callbacks, duplicate result cards, import conflicts,
  remote busy/admission and approval/Stop freshness. Build/lint plus separately
  agreed isolated UI fixtures pass. No normal installation or bridge restart.
- **Verified — 2026-10-21:** **36/36 JVM, 148/148 bridge, 35/35 actual Android**
  (19 prior SQLite data + 11 new headless real HTTP/SQLite + 1 new visible native
  flow + 4 legacy UI). Normal/fixture build/test-APK/lint and isolated real-tmux
  controller passed. Live fixture discovery/Send/Stop/approval/reopen passed;
  original IDs/organization/drafts/pairing/review JSON and disposable source HEAD/
  staging preserved. Fixed real hidden POST retries, transaction conflict retention
  and busy-admission discovery, with red/green evidence. Schema remains 5. Only
  isolated verified fixture APKs installed; previously absent and removed afterward.
  [Full implementation, failures and limits](android-shared-conversations.md).
  No normal data/install, production operation, provider, deployment, commit/push.
  **Stop before B09.**

### B09 — Minimal terminal attachment, not a new executor (complete in source/fixtures)

- [x] Implement only authenticated list/open/read/send, exact approval, explicit
  Stop and detach against B05. Persist private owner/cursor/outbox/response IDs;
  handle acceptance loss/reconnect with same IDs. Token never in argv/logs.
- [x] Preserve real Pi execution on the owner. Terminal startup cannot launch a
  bridge/provider, open a journal/Pi session, or change project/worktree identity.
  EOF/Ctrl-C closes the client; Stop is separately confirmed and run-scoped.
- **Done:** process-level fixture tests show existing Android-shaped conversation
  open/continue, remote-created discovery, duplicate-page safety, lost responses,
  approval races and disconnect with no cancellation/duplicate dispatch. Old owner
  capability and wrong-owner errors fail closed. No Pi extension required.
- **Verified — 2026-10-21:** **10/10 new terminal process tests, 158/158 full bridge**
  passed, zero failures/skips. Independent disposable Node/Durable owners and clients,
  fake workers, actual lost Send/approval responses, duplicate pages/feed replay,
  historical read-only evidence, owner/schema/downgrade refusal, exact old/later-run
  Stop isolation and EOF/Ctrl-C/detach with no cancellation/duplicate dispatch.
  Private atomic IDs inspected before forwarding HTTP. No new executor or legacy
  transport; no production/normal-app/provider/phone/deployment operation. Existing
  uncommitted work retained. [Contract, usage, failures and limits](terminal-conversations.md).
  **Stop before B10.**

### B10 — Prove cross-client continuity and recovery independently

- [x] Extend the isolated separate-owner/fake-RPC lifecycle harness: headless Android
  sends in project A; terminal opens exact chat and sends next turn, then exits
  while it runs; Android absent until completion, reopens and reconciles catalogue,
  cursor, transcript/result/approval once. Keep project B independently active.
- [x] Separate cases for simultaneous sends, offline/client-process loss, duplicate
  pages, dropped acceptance/approval responses, exact Stop isolation, orderly idle
  reopen, undispatched recovery and dispatched coding/review/approval uncertainty.
- **Done:** actual headless Android and terminal process evidence plus dispatch/
  context/worktree markers prove the same IDs, next-turn context and no crossed
  writes/replay. Old source HEAD/staging, tree/branch/manifest identities, drafts,
  pairing and review IDs survive. Full relevant regressions/build/lint pass.
  Not a real-provider, screen-off or Termux-death guarantee. Device fixture runs
  need agreement; do not substitute a Node mock for Android SQLite evidence.

- **Verified — 2026-10-21:** 9/9 new actual Android process phases, 30/30 existing
  headless SQLite/HTTP tests, 36/36 JVM, 159/159 bridge (including 1 new independent
  owner recovery test and 10 B09 process tests); reliability-only APK/test-APK
  build/lint and isolated real-tmux controller passed. Two disposable projects,
  actual HTTP loss/offline/rendezvous, separate fake RPC workers and real B09 client;
  original IDs/context/dispatch/reply markers, manifest bytes/branch/HEAD, source
  staging and Android drafts/pairing/organization/review JSON preserved. New fixture
  credentials private files/stdin only; exact APK/runner/prior-presence gates, fixture
  packages absent after cleanup. No runtime/schema/protocol change or production/
  normal-app/visible UI/provider action. [Evidence, failures, commands and limits](cross-client-continuity.md).
  **B10 complete; stop before B11.**

### B11 — Separately agreed deployment and one visible continuity smoke

- [x] Ask before normal install/migration, idle bridge restart or visible testing.
  Rediscover owner/live work, back up private bridge/Android/Pi/worktree state and
  compare inventories; retain explicit rollback/reconciliation limits after writes.
- [x] In disposable projects, start on Android, continue through terminal, detach
  terminal while work runs, reopen Android: same chat/run/project/worktree and one
  result. Inspect old migrated chats/IDs and review safety without replaying work.
- **Done:** record actual outcomes/preservation comparisons and limitations; leave
  the one owner healthy. No default-branch merge, commit/push, screen-off/host-kill
  scenario, history deletion or remote host expansion is implicit. Stop after B.
- **Verified — 2026-10-23:** normal app protocol-6 deployment recovered from interrupted
  session; fresh single-owner recovery, real Android/B09/real-provider smoke passed.
  Two ordered unique turns, remembered context, identical worktree, actual 45-second
  tool completion after terminal exit, visible Android result/reopen and read-only
  diff/old-review inspection. Original state/source/index preserved; admissions open,
  no active work, no commit/push. [Full evidence and limits](b11-deployment.md).

## Milestone C — personal chats without mandatory Git (planned; not started)

**Outcome:** deliberately create a Personal chat, send general-assistance messages
without registering/selecting a repository, and continue that same conversation
through Android and the existing HTTP-only terminal client. Coding chats retain
project selection, immutable bindings, isolated worktrees and existing Changes flows.
Both modes use the same independently owned bridge, canonical conversation history,
original-ID recovery, exact approvals and run-scoped Stop; no second executor.

**Approval boundary:** C01 was separately authorized and completed as documentation
only on 2026-10-27. No C02a–C07 work is authorized by that completion. Execute one
separately approved step at a time, record
actual evidence and stop. Split further if a step cannot be verified independently.
No implementation, test execution, provider use, runtime/private-state access,
deployment or phone changes are needed to approve the plan. Any later publication
request is separate from execution/deployment approval.

### Decisions and safety rules

- **Explicit mode, no inferred fallback.** Plan an immutable `coding` / `personal`
  discriminator and versioned personal workspace/tool policy. Personal is an
  affirmative choice, not a null/missing/invalid project, failed Git lookup or
  failed migration. Reject contradictory mode/project/request identities before
  admission. Do not reinterpret old chats as personal or convert an accepted chat;
  changing mode means a new chat. Unknown legacy evidence stays unresolved/read-only.
- **Preserve coding exactly.** Proven pre-C chats stay coding with the same owner,
  chat/job/run/task/Pi-session IDs, project IDs, worktree paths/branches, dirty files,
  manifests, review JSON/operation IDs and accepted-input evidence. Keep existing
  omitted-mode coding contracts, project capability checks and old-client routes.
  Never rewrite historical request inputs just to add a discriminator. C01 must
  define how omitted mode on a known personal chat is handled without letting old
  clients submit new work to it.
- **Real non-Git workspace.** Use a private, stable per-chat directory under an
  explicitly configured personal root, outside source checkouts, coding worktrees,
  provider configuration and the journal. No `git init`, fake project registration,
  dummy binding, branch, fetch or worktree preparation. Validate canonical paths,
  symlink escape/replacement and ownership before use; missing/changed established
  paths fail closed, never fall back to process cwd or a default repository. This
  directory is execution context, not a memory database or an OS sandbox.
- **Smallest tool policy: conversation only.** First personal release has no shell,
  file, Git, device, network/search or extension-provided action tools. Enforce the
  effective tool/extension surface at the worker boundary, not by a system-prompt
  promise or hidden UI. Inspect inherited Pi config, skills/extensions, auto-loaded
  project instructions and session restore paths before claiming enforcement. If
  a tool-free launch cannot be proved, stop and request a policy/design decision;
  never silently enable full Termux permissions. Tool expansion requires a later
  explicit policy/version and approval. A prompt asking for tools cannot grant them.
- **Clear identity and scope.** Show Personal versus Coding consistently in creation,
  chat details and terminal metadata. Personal uses the same agent/backend with
  independent per-chat context; no repository or Changes/commit/merge controls.
  Backend review/test/commit/merge routes must reject personal targets too. Do not
  market independent sessions as privacy isolation or import shared memory/history
  automatically. No new persona framework or cross-chat retrieval in C.
- **Fail closed across clients.** Advertise an explicit personal capability and
  schema/policy support before clients create or Send personal work. Older bridges
  disable personal creation/Send with a clear explanation; no downgrade to coding.
  Old clients must not mistake a personal entry for coding or make it actionable;
  use compatible filtering/read-only refusal as selected in C01. Validate mode and
  workspace identity through persistence, request acceptance and response adoption,
  alongside existing owner/endpoint/schema/ID checks.
- **Keep B's durability rules.** One owner and one active run per chat; atomically
  persist accepted identity and original outbox IDs before dispatch. Reconnect,
  duplicate pages, lost responses and detach must not resubmit work or change mode.
  Retain exact fresh approval/Stop scoping and uncertain-dispatch non-replay. Host
  death/screen-off survival is not newly guaranteed. Do not replay old work to test.
- **Non-destructive rollout.** Preserve drafts/titles/pins/finished/archive state,
  selection, pairing, cached history/cursors/import evidence and pending operations.
  Additive transactional migrations must retain conflict evidence without partial
  adoption. Test only disposable journals/directories/repositories; never open the
  production journal in a second harness. Backup/idle/rollback and phone gates remain
  mandatory before any separately agreed deployment. Keep secrets/history out of Git.

### C01 — Trace the seams and settle the contract (complete; docs only)

- [x] Trace chat creation → bindings/admission → journal/projection/API → workspace
  preparation → Pi launch/restore/tool configuration → Android/terminal adoption
  and every review entry point. Read the installed Pi docs only as needed to prove
  supported launch/tool controls. Inspect source, not production state.
- [x] Write `docs/personal-chat-design.md` with exact file/function seams, proposed
  mode/workspace/policy representation, old-data classification, capability/version
  and old-client behavior, personal-root requirements, tool enforcement, migration
  and focused test matrix. Explicitly resolve whether a truly Git-free owner can
  start with no configured repository; personal-only setup must not bootstrap Git,
  while existing coding configuration/startup validation remains unchanged.
- **Done:** every new field/route/write/launch gate has a location and test; explain
  how no-repository startup and tool-free execution are proved. Record unanswered
  questions as blockers, revise later step bounds if needed, and stop for approval.
  No runtime source/schema/config change, build, test run, provider or device action.

- **Verified — 2026-10-27:** source and installed Pi 1.4.0 documentation inspection;
  [contract, exact seams, startup/tool controls and test matrix](personal-chat-design.md).
  No runtime/source/schema/config change, builds/tests, live state access, provider,
  device or deployment operation. Tool policy remains a future process-test gate.
  Existing local work retained; no commit/push. **Stop before C02a.**

### C02a — Coding identity sidecar only (recommended next)

- [ ] Add the design's versioned `chatKind` identity document and additive pre-resume
  coding classification/validation from proved existing bindings. Do not rewrite
  old jobs/task inputs/baselines, add personal rows or change public projections.
- [ ] Use disposable inventories to prove repeat reopen, rollback, manifest-only
  coding chats, conflicting/unproved evidence refusal and original record/input
  preservation. Run focused and relevant existing coding regressions.
- **Done:** proved coding identity persists with no change to coding routing,
  worktrees/review/non-replay or public protocol. No personal creation/execution,
  production state access, Android/device, provider or deployment. Stop before C02b.

### C02b — Internal personal identity and mode-aware validation

- [ ] Add explicit personal identity/workspace reservation and pre-resume baseline/
  live/approval/history validation selected in C01. Keep immutable coding history,
  generations/cursors and task inputs unchanged; no dummy project bindings.
- [ ] Prove transactional rollback, same-ID/mode/policy/workspace conflicts, empty
  repository-free store shape, mixed inventory reopen and historical-null refusal
  in disposable internal fixtures. Personal tasks cannot dispatch yet.
- **Done:** authoritative internal state can represent both kinds safely, without
  publishing personal capability/create/Send or executing personal work. Existing
  coding regressions pass. Stop before C03a.

### C03a — Directory adapter and Git-free bootstrap

- [ ] Add private root/per-chat directory validation and reserved/preparing/ready
  recovery. Add the explicit no-repository startup path; unchanged configured coding
  startup validation must still reject broken sources and changed frozen defaults.
- [ ] Test with Git unavailable, root/path escape/replacement, partial preparation,
  missing established directories and attempts to reopen a coding journal as
  personal-only. No default cwd, Git init, registration or checkout fallback.
- **Done:** internal personal directory preparation needs no Git; original coding
  tree/index/manifest bytes survive. Personal execution remains unavailable. Stop
  before C03b; no production filesystem/configuration changes.

### C03b — Personal dispatch and enforced conversation-only Pi launch

- [ ] Route validated personal work to its directory and constrained CLI profile;
  coding retains existing adapter/args. Preserve dispatched-memo-first non-replay.
  Reject arbitrary personal PI_ARGS, inherited executable resources and unsupported
  binary/policy. No personal action tools or extension approvals.
- [ ] Use fake workers for argv/env/cwd and the actual supported Pi executable with
  a disposable local fake model provider to prove absent tool declarations and
  forbidden-tool non-execution, including restored tools and hostile fixture
  resources. Test independent personal contexts plus concurrent coding and recovery.
- **Done:** actual process evidence, not prompt text or fake-worker assertions alone,
  proves the no-tool contract; coding regressions/context/dispatch guards survive.
  Failed proof blocks capability publication. No real provider/device/production
  action. Remain gated from clients; stop before C04.

### C04 — Capability-gated shared API and minimal terminal support

- [ ] Expose mode/policy metadata and deliberate personal create/Send through the
  existing authenticated shared interface. Extend the B09 HTTP-only terminal just
  enough to create/open/continue Personal chats and display their identity; no new
  worker, journal access or automatic host startup.
- [ ] Test owner/schema/capability/mode conflicts, old-client/old-bridge behavior,
  catalogue and bounded-page reconciliation, response loss and original-ID recovery,
  concurrent Send, detach and exact Stop. Review routes reject personal IDs even
  when called directly; no personal retry is forwarded to a legacy coding endpoint.
- **Done:** disposable independent HTTP/terminal processes prove one ordered shared
  transcript and no duplicate dispatch; existing coding API/client tests pass. No
  Android UI, real provider or production restart. Stop before C05.

### C05 — Android storage and explicit new-chat choice

- [ ] Add only necessary additive local mode/policy persistence and capability gates,
  then a small explicit Personal / Coding new-chat choice. Coding retains its current
  picker and binding display; established chats cannot switch modes. Show Personal
  identity and hide repository actions without affecting coding Changes recovery.
- [ ] Verify host policy tests and normal/fixture build/lint first. Test actual SQLite
  upgrade/reopen/rollback and visible choice/old-chat flows only with separately
  authorized isolated fixture APKs and announced phone interaction.
- **Done:** drafts/selection/pairing/history/review/outbox IDs survive; personal Send
  needs no project, unsupported/offline cases fail safely and stale callbacks cannot
  adopt another mode's data. Compiled-but-unrun device tests are not a pass. Stop
  before C06; no normal-app installation/migration implied.

### C06 — Cross-client and coding-preservation completion gate

- [ ] In disposable independent-owner/fake-worker fixtures, Android starts Personal,
  terminal continues the exact chat and detaches while running; Android reopens and
  adopts ordered results once. Include two independent personal contexts and coding
  project A/B, lost responses, duplicate pages, offline/reopen, owner replacement,
  racing sends, exact Stop and interrupted-dispatch non-replay.
- [ ] Compare original IDs, drafts/pairing/organization, review operation JSON, source
  HEAD/index, dirty worktrees/manifests and Pi session evidence before/after. Run
  relevant full bridge/JVM/build/lint/controller regressions; actual Android fixture
  execution needs separate agreement, not a mock substituted for SQLite evidence.
- **Done:** all new cases and existing coding/project/review/B-continuity gates pass
  with recorded commands/results and honest limits. Git-free personal-only fixture
  startup and forbidden-tool refusal are demonstrated. Source completion is distinct
  from deployment; stop and request C07 approval, never infer it.

### C07 — Separately approved deployment and minimal visible smoke

- [ ] Only after explicit approval, rediscover the live owner/work, take private
  bridge/Android/Pi/worktree inventories/backups and document reconciliation/rollback
  limits after new personal writes. Agree install/migration/restart and visible test.
- [ ] Use a clearly named new Personal chat: harmless real-provider first turn on
  Android, terminal continuation/detach, Android reopen/context/result once, no Git
  setup or tool action. Read-only check existing coding binding/Changes and original
  inventories; do not replay old jobs/reviews. Any new coding mutation smoke needs
  its own agreed disposable scope.
- **Done:** record actual visible outcome, preservation comparison and limits; one
  healthy owner, no unexpected active work and no phone-setting change. Stop after C.
  No commit/push, deletion, automatic memory, background delivery, host-kill scenario
  or remote-host expansion is implied by deployment approval.

### Milestone completion criteria

C is source/fixture-complete only after C01–C06 evidence: explicit immutable modes;
Git-free personal-only operation; private stable independent contexts; enforced
no-tool policy and clear identity; Android/terminal continuity without duplication;
capability-safe failures; unchanged coding/project/worktree/review and recovery
contracts; preserved existing data and passing regressions. C07 is a separate live
completion gate, not evidence that can be inferred from builds or old B11 results.
Any unproved policy/migration/device gate remains blocked, not checked complete.

**Recommended next authorization:** “Approve the C01 design and do C02a only:
coding identity sidecar plus disposable migration/rollback/reopen tests. No personal
creation/execution, Android/device, provider, production state, deployment, commit
or push. Stop after C02a evidence.”

## After Milestone C — direction only

These are direction markers, not instructions to expand C.

1. **Personal tool expansion:** separately approved, enforceable scoped tools only
   after the conversation-only policy has real evidence; no silent broadening.
2. **Knowledge:** search approved history with source links; explicit Remember this;
   scoped facts/preferences, corrections and open loops. Trial pi-para in isolation.
3. **Research/capture:** one search backend, source snapshots/citations, document
   extraction, then Android share-to-inbox. Imported content remains untrusted data.
4. **Background usefulness:** remaining lifecycle evidence, persistent notification
   delivery and bounded CI/reminder events. Reliability defects encountered during
   coding are addressed when found, not deferred behind all personal-chat features.
5. **Later reach:** explicit Pi extension, PC/web clients, SSH offload and scoped
   Discord/Slack adapters; event deduplication, auth and per-action permissions.

Detailed idea/reference material:
[pi-phone research](pi-phone-ideas-research.md),
[reliability evidence](reliability-baseline.md),
[rename/migration limits](repository-rename.md).

## Step evidence log

### C01 — done (design only) — 2026-10-27

Changed: new `docs/personal-chat-design.md`, this roadmap and `PROGRESS.md`.
Traced startup/binding/admission/projection/import/approval/review/Pi launch and
Android/terminal seams. Selected immutable `chatKind` sidecar, explicit Git-free
bootstrap, versioned opt-in personal views and constrained no-tool CLI profile;
split C02/C03 into independently approved a/b steps.
Verified: read-only source and installed Pi 1.4.0 docs/source inspection;
`git diff --check -- PROGRESS.md docs/next-steps.md` passed; Python local-file
Markdown link checks for all three changed docs and new-file whitespace check
passed. No builds/tests or
runtime/tool-enforcement claim. No production state/config access or runtime probe.
Compatibility/data: docs only; existing implementation/local changes, coding data,
project/worktree behavior and deployed B11 baseline unchanged. No phone/provider,
installation, migration, bridge operation or deployment.
Publication: local/uncommitted; no commit or push.
Next: design approval, then C02a only; do not start C02b or personal execution.

Append one small entry after working on a step:

```text
Step NN — done / blocked / in progress — date
Changed: files or design decisions
Verified: exact commands/results or observed device evidence
Compatibility/data: what was preserved or migrated
Publication: local / commit hash and pushed status
Next: step NN or a specific blocker
```

### Step 01 — done — 2026-10-20

Changed: `docs/multi-project-design.md` traces source routing/migration points and
selects a persisted trusted registry, immutable bindings and shared workspace adapter.
Updated this checklist and `PROGRESS.md`. Steps 02–09 retain their order; focused
clarifications/tests are recorded in the design, including pre-resume legacy
migration, accepted review bindings and old-bridge capability gating.
Verified: `cd bridge && npm test` — 48/48 passed, exit 0; Git/source inspection;
fresh localhost:8787 check returned ECONNREFUSED (no bridge started).
Compatibility/data: design only; no code/runtime/configuration change, installation,
phone test, private-state migration or saved identity rewrite.
Publication: local, uncommitted; no push requested.
Next: step 02 only — trusted project registry persistence/validation, no routing.

### Step 02 — done — 2026-10-20

Changed: `bridge/src/projects.js`, `bridge/src/store.js`,
`bridge/test/projects.test.js`, this checklist and `PROGRESS.md`. Added a version-1
`pocket.projects` document inside the existing Durable owner and internal
`registerProject`/`listProjects`/`getProject` methods. Opaque UUIDs, canonical source/
root/common-dir/subdirectory, immutable branch policy and local filesystem repository
identity persist. Symlink aliases deduplicate; conflicting policies, checkout/subdir
aliases sharing a common directory and managed chat sources fail clearly. Local
branches need no remote; remote policy validation does not contact the network.
Lookup revalidates source identity and policy without creating worktrees.
Verified: `cd bridge && node --test test/projects.test.js` — 5/5 passed;
`cd bridge && npm test` — 53/53 passed, exit 0; `git diff --check` — passed.
Disposable Git tests cover concurrent duplicate registration/reopen, independent
clones, missing/non-Git/bare/unborn sources, invalid/missing branches/remotes,
missing/replaced repository identities, managed worktree rejection and unchanged
legacy execution target after registering another repository. Initial focused run
exposed Durable proxies rejecting structuredClone; JSON value copies fixed it before
both passing runs. First full-suite redirection used unavailable `/tmp`; rerun under
`$TMPDIR` actually executed the passing suite. Fresh localhost:8787 health probe:
ECONNREFUSED; no bridge started or restarted.
Compatibility/data: additive registry only, initially empty; no automatic default
registration, legacy binding migration, saved job/task/ID/worktree rewrite, routing,
HTTP capability or Android change. Repository device/inode identity rejects local
replacement at the same path; moving/restoring registered repositories needs future
explicit operator resolution (not a new update endpoint). Original source/staging
and private state untouched; no deployment, real provider or phone test.
Publication: local, uncommitted; no push requested. Preserved step-01 local docs.
Next: step 03 only — immutable chat/request bindings and legacy mapping.

### Step 03 — done — 2026-10-20

Changed: `bridge/src/bindings.js`, `bridge/src/store.js`,
`bridge/test/bindings.test.js`, `bridge/test/projects.test.js`,
`bridge/test/bridge.test.js`, `bridge/test/sessions.test.js`,
`bridge/test/worktrees.test.js`, this checklist and `PROGRESS.md`.
Added version-1 `pocket.bindings` in the existing Durable owner: frozen default,
immutable session bindings and an atomic pre-resume legacy migration marker.
Job/review acceptance stores the project in both record and task input within the
same transaction. Internal submission accepts an optional project ID; conflicting
chat/request/action IDs fail, omitted-project retries retain accepted identity.
Task recovery resolves legacy inputs through migrated records and checks equality;
the existing dispatched-memo check remains first, preserving uncertain-action
non-replay. Non-default work fails with 426 before acceptance until step 04 routes
both coding and review; no multi-project HTTP capability was added.
Verified: `cd bridge && node --test test/bindings.test.js test/projects.test.js`
— 12/12 passed; final `cd bridge && npm test` — 60/60 passed, exit 0;
`git diff --check` — passed. Disposable repositories/isolated journals only.
Coverage includes atomic admission/conflicts while active and idle, exact-ID retry,
restart/non-replay, persisted job/review task project inputs, review reopen,
implicit legacy pocket, undispatched legacy task recovery, manifest-only chats,
dirty worktree reuse, incomplete preparation without repair, conflicting saved
workspace evidence, foreign historical manifests, failed-migration retry, and
changed default source/branch-policy rejection. Earlier full run found six failures:
registry tests assumed no seeded default/allowed a conflicting default policy,
restart tests treated running as proof of worker dispatch, and invalid-branch setup
expected a late job failure. Updated those expectations; final runs above pass.
Fresh localhost:8787 health probe returned ECONNREFUSED; no bridge was started.
Compatibility/data: migration code is additive and runs before resume under the
existing exclusive owner lock; no production journal was opened or migrated.
Manifest paths/hashes/branches, task kinds, request/session IDs, Pi session identities,
dirty files and original checkout/staging stay unchanged. Saved workspace evidence
must match the verified default; foreign/ambiguous historical repositories require
operator resolution, not a guessed binding. The default is now seeded at open;
invalid bootstrap branches/remotes fail before admission rather than during worktree
setup. Failed opens close storage and release the lock. No installation, deployment,
real provider, phone test, HTTP/UI change or non-default execution routing.
Publication: local, uncommitted; no push requested. Preserved step-01/02 changes.
Next: step 04 only — route execution and every review path to the bound project.

### Step 04 — done — 2026-10-20

Changed: `bridge/src/project-workspaces.js`, `bridge/src/store.js`,
`bridge/src/bindings.js`, `bridge/test/project-routing.test.js`,
`bridge/test/bindings.test.js`, this checklist and `PROGRESS.md`.
Added one binding-aware workspace adapter shared by command execution and
`createReview`, with cached managers per project, registered source/subdirectory/
branch-policy resolution and repository revalidation even on cache hits. Unbound
reads return no worktree without binding or creating one. Removed the internal
non-default admission gate and default-only task/reopen restrictions; accepted
job/action/task identities still have to agree with the immutable chat binding.
Default bootstrap and pre-resume legacy inventory remain separate from routed
execution, preserving existing storage keys and migration order. No HTTP project
selection, capability advertisement, route or Android change (step 05 is next).
Verified: `cd bridge && node --test test/project-routing.test.js
 test/bindings.test.js test/review.test.js` — initial focused run 28/28 passed;
`cd bridge && node --test test/project-routing.test.js` — final routing tests
4/4 passed after adding identical-clone/global-guard coverage; final
`cd bridge && npm test` — 64/64 passed, exit 0; `git diff --check` — passed.
Disposable repositories and isolated journals only. New tests prove two live
workers edit the same relative filename in different project worktrees, selected
subdirectories are used for coding/tests, summaries/diffs are chat-scoped, identical
clones have distinct revisions, cross-project review revisions fail, selected
commits preserve unrelated staged files, dirty target merges fail, and explicit
local merges affect only the bound source. Reopen retains non-default jobs/actions/
bindings/worktrees and exact-ID results without re-dispatch. Legacy manifests remain
byte-identical with dirty edits intact. Cached managers reject replaced repositories,
switched branches and missing worktrees without default-checkout fallback. Existing
global review/admission and merge-vs-live-model guards remain intact across projects.
Fresh localhost:8787 health probe returned ECONNREFUSED; process inspection found no
matching bridge server/controller. No bridge was started or restarted.
Compatibility/data: additive source-only routing change; registry/binding document
versions, request/session IDs, Pi session names and worktree hash/path/branch identity
are unchanged. Default/legacy clients continue using the frozen default or established
binding. No production journal access/migration, deployment, installation, real
provider, phone test, actual-source test merge or unrelated staging change. Internal
multi-project execution is enabled; client discovery/selection remains unadvertised
and must be implemented/verified in step 05 before client rollout.
Publication: local, uncommitted; no push requested. Preserved step-01/02/03 changes.
Next: step 05 only — minimal authenticated project interface and HTTP compatibility.

### Step 05 — done — 2026-10-20

Changed: `bridge/src/server.js`, `bridge/src/store.js`,
`bridge/test/project-http.test.js`, `bridge/test/sessions.test.js`,
`bridge/test/review.test.js`, `docs/project-api.md`, `README.md`, this checklist and
`PROGRESS.md`. Added authenticated GET/POST `/v1/projects` and GET
`/v1/sessions/:sessionId/project`. Registration requires literal
`confirmRegistration: true` with an explicitly supplied trusted source/name/branch
policy; validation is reused from the registry, with no model-produced source
execution. Listings/registration responses omit filesystem inode/device and Git
common-directory internals. POST jobs now validates/forwards optional `projectId`;
job/action results retain accepted IDs, and review summary/snapshot/diff responses
include project identity. Existing review routes are reused. Health advertises
protocol 5 and `projectBindings: true` only for the binding-aware store; an unsupported
store receives no selected-project submission (426 rather than silent forwarding).
Verified: `cd bridge && node --test test/project-http.test.js test/sessions.test.js
 test/review.test.js` — 26/26 passed; `cd bridge && npm test` — 67/67 passed, exit 0;
`cd bridge && node --test test/project-http.test.js` — 3/3 passed; `git diff --check`
— passed. New isolated HTTP tests use two disposable repositories/deterministic
workers, not a provider. They prove authenticated discovery/explicit registration,
no execution/worktree creation during registration/binding lookup, alias dedup,
per-project writes/review/test targets and response identities, same-ID/reopen
recovery without dispatch, conflicting-project rejection, omitted-project legacy
behavior, malformed/unknown IDs, invalid paths/policies, confirmation/body-size/auth
checks, unsupported-store gating and metadata-only HTTP logs. Original source
checkouts remain clean with unchanged file contents. Existing routing, legacy,
review/merge/staging and non-replay regressions remain green. Initial runtime check:
localhost:8787 ECONNREFUSED; no matching bridge server/controller observed. No bridge
started or restarted outside isolated ephemeral-port test servers.
Compatibility/data: additive HTTP/response contract; no new database schema or
migration beyond the already implemented binding setup in disposable journals.
Opaque IDs, default/established omitted-project routing, worktrees and existing
approvals/cancellation/review URLs stay unchanged. README corrects its legacy-session
label to the actual opaque `pocket` ID (documentation only, no rename). No production
journal access/migration, installation, deployment, Android change or phone test.
A true old bridge can ignore project fields; clients must verify protocol >= 5 and
`projectBindings === true` before POST and never drop the selected ID to retry.
That Android persistence/capability/error handling is step 06, not implemented here.
Registration confirmation is operator intent, not protection against a malicious
bearer client; the API contract documents trust and privacy limits explicitly.
Publication: local, uncommitted; no push requested. Preserved step-01 through 04 work.
Next: step 06 only — Android project/request persistence and isolated upgrade tests,
without a picker, normal-app migration or deployment.

### Step 06 — earlier blocked checkpoint (resolved below) — 2026-10-20

Changed: `app/src/main/java/dev/fantasticpimobile/History.kt`, `ProjectRequests.kt`,
`MainActivity.kt`, `ChangesActivity.kt`, `Connection.kt`; `app/build.gradle.kts` (test-only JUnit/JSON
libraries); `app/src/test/java/dev/fantasticpimobile/ProjectRequestsTest.kt`;
`app/src/androidTest/java/dev/fantasticpimobile/ProjectHistoryTest.kt`, `HistoryTest.kt`,
`LiveStatusUiTest.kt`, `ReliabilityFixtureTest.kt`; `docs/android-project-state.md`,
`docs/project-api.md`, `README.md`, this checklist and `PROGRESS.md`.
Schema-4 migration source adds session/job project IDs and explicit unbound,
legacy-unresolved, selected and bound states without changing existing IDs. Selection
is saved before request creation and is immutable once a request is saved; accepted
binding/result adoption is transactional. New unbound chats cannot silently use a
default (no picker yet). The actual Activities now use a headless-testable request
policy: protocol-5/literal capability gate before selected-project POST, exact legacy
ID recovery and proved chat-binding lookup before retry, identity persisted BEFORE
legacy retry dispatch and explicitly attached to the wire payload, persisted selection
retained offline, strict job/review identity checks and permanent POST-404 handling. Identity
mismatches remain uncertain, not falsely rejected/completed; cached approvals are not
made current. Saved legacy review operation JSON/IDs remain unchanged; retry transport copies
attach the durably proved project rather than executing against an unknown default.
Review response adoption also checks foreground/endpoint epochs; endpoint-frozen
HTTP requests prevent a multi-call proof/POST sequence crossing a re-pairing. See the focused state/continuation document.
Verified: with `ANDROID_HOME=$HOME/.local/android-sdk` and the existing native
`-Pandroid.aapt2FromMavenOverride=$HOME/.local/android-sdk/aapt2-source/build/aapt2`,
`./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest
 :app:lintDebug` passed for the normal configuration; the same command with
`-PreliabilityTests=true` passed for the fixture configuration, including the final
fixture build. JUnit XML: 15 tests, zero failures/errors/skips. Final APK metadata:
`dev.fantasticpimobile.reliability` and `.reliability.test` only. Host tests cover
selected-ID/payload retention, capability refusal, offline/dropped response, legacy
exact-ID and omission-contract recovery, unbound refusal, conflicting/malformed
identities, review ownership, proof persistence failure blocking POST, replacement-
owner default refusal after lost legacy acceptance, and permanent-vs-uncertain errors.
`cd bridge && npm test` — 67/67 passed, exit 0; `git diff --check` — passed.
Blocker: native `adb devices -l` returned no connected device; mDNS services query
reported unsupported host service. A fixture-only, class-filtered
`:app:connectedDebugAndroidTest` attempt failed before test execution/install with
`Could not create ADB Bridge` / `Could not determine adb version` for the SDK ADB.
Android SQLite migration/reopen tests (v1/v2/v3), database conflict rollback and
request-status instrumentation are compiled but NOT RUN. No runtime data-test pass
is claimed. Logs: `$TMPDIR/step06-normal-build.log`, `step06-final-fixture.log`,
`step06-device-tests.log`, `step06-bridge.log`; host test XML under
`app/build/test-results/testDebugUnitTest/`. The earlier 10- and 13-test host passes were followed
by a 15-test passing run after proof-before-dispatch and replacement-owner guards.
A fresh final localhost:8787 probe returned ECONNREFUSED.
Compatibility/data: source-only schema/client change; neither normal nor fixture APK
was installed, and the normal app database/pairing/history were not opened or migrated.
No bridge restart, production journal access, provider, visible phone test, picker,
commit or push. Older accepted legacy jobs can still be read without inventing a
project; unsupported new submissions fail closed, never dropping a selected ID.
Existing local changes from steps 01–05 are preserved.
Publication: local, uncommitted; nothing pushed.
Next: finish step 06 only — restore authorized native ADB, recheck fixture APK/device
identity and run ONLY `HistoryTest`, `ProjectHistoryTest`, `RequestStatusTest` in the
separate fixture sandbox. The continuation document includes the native ADB runner
command (avoid incompatible SDK ADB). Fix any failures and record actual results
before checking the remaining box or starting step 07. Ask separately before visible
Activity tests, normal-app migration/installation or production deployment.

### Step 06 — done (device verification resumed) — 2026-10-20

Changed: completion/evidence updates only in `docs/android-project-state.md`,
`docs/project-api.md`, `README.md`, this checklist and `PROGRESS.md`. The previous
step-06 implementation did not need a code change after device verification.
Verified: secure Wireless debugging rediscovery reconnected the already-paired
ASUS_I003D using native Termux ADB and an explicit fresh serial. Before installation,
`pm list packages` found only the normal app; build output metadata and actual native
AAPT2 `dump badging` identified only `dev.fantasticpimobile.reliability` and
`dev.fantasticpimobile.reliability.test` fixture APKs. Installed those APKs only.
`adb -s "$SERIAL" shell am instrument -w -e class
 dev.fantasticpimobile.HistoryTest,dev.fantasticpimobile.ProjectHistoryTest,dev.fantasticpimobile.RequestStatusTest
 dev.fantasticpimobile.reliability.test/androidx.test.runner.AndroidJUnitRunner`
— **OK (14 tests)**, no failures: HistoryTest 7, ProjectHistoryTest 3,
RequestStatusTest 4. Actual Android SQLite v1/v2/v3 upgrade/reopen, selection/request
persistence, immutable binding/conflict rollback, legacy mapping, draft/lifecycle/
pending operation preservation and request-status tests now pass in the separate
sandbox. No Activity, live-status UI, pairing import or other instrumentation class
was invoked. Both temporary fixture packages were uninstalled successfully afterward.
`ANDROID_HOME=$HOME/.local/android-sdk ./gradlew -PreliabilityTests=true
 -Pandroid.aapt2FromMavenOverride=$HOME/.local/android-sdk/aapt2-source/build/aapt2
 :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug`
— BUILD SUCCESSFUL (existing build/test tasks mostly up to date); a separate
`:app:testDebugUnitTest --rerun` with the same environment/flags actually reran
**15/15 passing host policy tests** (zero failures/errors/skips in JUnit XML).
`cd bridge && npm test` — **67/67 passed**, exit 0; `git diff --check` — passed.
Fresh localhost:8787 probe: ECONNREFUSED. Resumed logs:
`$TMPDIR/step06-data-device.log`, `step06-resume-build.log`,
`step06-resume-unit.log`, `step06-resume-bridge.log`.
Compatibility/data: normal package remained the only installed project package after
cleanup. Its versionCode 7 / versionName 0.6.1 and lastUpdateTime
`2026-10-19 22:19:58` matched before/after. No normal app database/history/pairing was
opened, read, migrated or replaced. Only disposable fixture state was exercised.
No bridge restart, production journal access, real provider, picker, visible Activity
test, legacy TCP/IP debugging, SDK replacement, settings/security change or production
deployment. SDK ADB incompatibility was bypassed, not fixed, by native ADB; the earlier
blocked checkpoint remains above as historical evidence, not current status.
Publication: local, uncommitted; nothing pushed. Preserved all earlier local work.
Next: step 07 only — small new-chat picker and immutable established binding display.
Stop before it; normal-app installation/migration and agreed real-app smoke tests
remain step 09, not authorized by this verification run.

### Step 07 — implemented; visible fixture verification pending — 2026-10-20

Changed: new `ProjectCatalog.kt`, `ProjectPicker.kt`, `ProjectCatalogTest.kt`,
`ProjectPickerUiTest.kt`; integrated the picker and established-project display into
`MainActivity.kt`. Added `docs/project-picker.md` and updated progress/state docs.
Explicit local/remote-policy registration has a review/confirmation gate; selection
and registration cannot send work. Submitted/established/archived chats stay locked.
Legacy empty drafts require backend absence proof. Capability, endpoint and lifecycle
guards preserve identity/drafts without silent default fallback.
Verified: normal and `-PreliabilityTests=true` Gradle tasks `:app:testDebugUnitTest
 :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug` passed with
`ANDROID_HOME=$HOME/.local/android-sdk` and
`-Pandroid.aapt2FromMavenOverride=$HOME/.local/android-sdk/aapt2-source/build/aapt2`.
Final normal build also passed after adding fixture test source. JUnit XML: **22/22**
passing host tests (7 catalog + 15 request policy); `cd bridge && npm test`: **67/67**
passed; `git diff --check`: passed. The 3 new fixture Activity tests compiled but
**were not executed**: visible phone testing requires separate agreement.
Logs: `$TMPDIR/step07-build.log`, `step07-fixture-build.log`,
`step07-final-normal-build.log`, `step07-bridge.log`. Localhost:8787 HTTP probe returned
000/connection failure; no bridge was launched.
Compatibility/data: reused schema 4; no new database migration, installation, normal
history/pairing read, production journal access/restart, provider action or phone
settings change. Preserved all existing local work. No step-08 scenario run.
Publication: local, uncommitted; nothing pushed.
Next: finish step 07 only after agreement to visibly execute fixture-only
`ProjectPickerUiTest`, with fresh device/APK checks. Keep the completion gate open
until actual UI results pass; do not advance to step 08 or production deployment.

### Step 07 — done (authorized visible fixture tests) — 2026-10-20

Changed: `ProjectPickerUiTest.kt` click helper now waits for a visible/clickable
fixture-owned accessibility control on cold launch. Updated completion/evidence in
`docs/project-picker.md`, `docs/android-project-state.md`, this checklist and
`PROGRESS.md`. No app runtime code fix needed.
Verified: user explicitly authorized running the 3 UI tests. Native secure ADB found
one authorized ASUS_I003D; device awake/reachable. Only normal package present before
install. Rebuilt fixtures and verified output metadata plus native AAPT2 badging for
`.reliability` / `.reliability.test`. Installed only those fixtures. Exact class filter
`dev.fantasticpimobile.ProjectPickerUiTest` via native `adb -s "$SERIAL" shell am
instrument -w ... dev.fantasticpimobile.reliability.test/androidx.test.runner.AndroidJUnitRunner`.
Initial 2/3 pass; focused test reproduced first-click failure. Probe proved native
button shown/clickable with null accessibility root. Bounded fixture-owned target
wait fixed test synchronization; removed probe. Full suite **OK (3 tests)** twice
(5.163 s / 5.084 s). Covers choice/persistence/reopen/locking, empty/old/unavailable
bridge and explicit registration confirmation without a job POST.
Fixture build/unit/test-APK/lint passed after test fix. Final normal build/test-APK/
lint passed; `:app:testDebugUnitTest --rerun` actually reran **22/22 host tests**.
Existing 67/67 bridge regression result remains from implementation (not rerun in
this device-only continuation; no bridge code changed). `git diff --check` passed;
no temporary debug markers remain. Logs: `$TMPDIR/step07-ui-device.log`,
`step07-ui-empty-repro.log`, `step07-ui-probe.log`, `step07-ui-final-build.log`,
`step07-ui-final.log`, `step07-ui-repeat.log`, `step07-ui-normal-final.log`.
Compatibility/data: both previously absent temporary fixture packages removed;
package listing again only normal app. Its versionCode/versionName/lastUpdateTime
matched before/after. Normal history/database/pairing not accessed/migrated, no
normal Activity launched, production journal opened, bridge restarted or real
provider invoked. No IME/security/network/phone setting changed; inactive ADBKeyboard
warning was irrelevant to accessibility instrumentation. Localhost:8787 HTTP 000 /
connection failure after tests. No new migration or normal installation.
Publication: local/uncommitted; nothing pushed; previous work preserved.
Next: step 08 only, not started. Step 09 deployment still needs separate agreement.

### Step 08 — done — 2026-10-20

Changed: new `bridge/test/project-lifecycle-pi.js`, `project-lifecycle-fixture.js`,
`project-lifecycle.test.js`, Android `ProjectLifecycleTest.kt`,
`scripts/check-project-lifecycle.py`, `docs/project-lifecycle.md` and progress docs.
Added a disposable independent bridge/fake-RPC worker, real accepted-response-drop
proxy and four fresh headless Android client phases. Tests preserve exact job/
project/operation IDs, saved review JSON, results, selected chat, draft and pairing;
reject crossed results/approvals, cancel a third chat without affecting A's pending
approval, and check per-worktree dispatch markers plus unchanged source staging.
The Android client is explicitly absent while B finishes with HTTP offline.
Regression fix: `scripts/bridge-work.mjs` still required protocol 4 exactly. Existing
real-tmux test failed; allowlisted diagnostic rerun proved health-unverified with
protocol 5. Now allow only numeric 4/5 (all owner/maintenance/backup checks remain).
`scripts/check-bridge-work.py` asserts v5/projectBindings and reports only safe
reason/version on fixture startup failure. The original harness then passed.
Verified: `cd bridge && node --test test/project-lifecycle.test.js` — 1/1 passed;
final `cd bridge && npm test` — **68/68 passed** after controller fix.
`python scripts/check-project-lifecycle.py --serial "$SERIAL"` — **all 4 Android
phases and worker/filesystem assertions passed twice**, each phase a separately
invoked headless instrumentation test, never an Activity/provider. Class-filtered
HistoryTest/ProjectHistoryTest/RequestStatusTest — **OK (14 tests)**. Real isolated
`python scripts/check-bridge-work.py` — **PASS** after red/repro/fix.
Normal and fixture Gradle `testDebugUnitTest`, `assembleDebug`,
`assembleDebugAndroidTest`, `lintDebug` passed with the existing native AAPT2
flags; final normal `:app:testDebugUnitTest --rerun` actually reran **22/22** host
tests. `git diff --check` passed. Detailed commands/logs in the lifecycle document.
Compatibility/data: native ADB/device and metadata/native AAPT2 badging verified
exact fixture IDs before install. Only normal app present before/after; previously
absent temporary fixtures removed. Normal versionCode/versionName/lastUpdateTime
unchanged; no normal database/history/pairing read or migration, Activity launch,
production journal access, bridge start/restart, provider or phone-setting action.
Production localhost:8787 remained connection failure/HTTP 000. Disposable workers
closed and state removed. Not a screen-off/Termux-death/real-provider/UI-deployment
claim; step-07 UI evidence remains separate.
Publication: local/uncommitted; nothing pushed; all earlier local changes preserved.
Next: step 09 only, after explicit agreement for deployment and one visible smoke.
Do not install the normal APK or restart production implicitly.

### Step 09 — done — 2026-10-20

Changed: `app/build.gradle.kts` version 8 / 0.7.0; `bridge/src/bindings.js` and
`bridge/test/bindings.test.js` narrow legacy missing-root compatibility regression;
`docs/project-deployment.md`, this checklist, README and PROGRESS.
Verified: private backup/idle checks before deployment; legacy regression RED then
GREEN; full bridge **69/69**, JVM **22/22**, normal app/test-APK build and lint,
`git diff --check`. Normal native upgrade and real provider A/B coding smoke:
separate locked projects/worktrees, exact one-file diffs, native Changes tests
`STEP09_A_TEST_OK` / `STEP09_B_TEST_OK`, exit 0/current revision. Home while B
worked, reopen, then completed-client force-stop/relaunch preserved results,
selection/binding/check. Legacy messages/binding read-only check passed.
Compatibility/data: actual schema 3→4 migration preserved original 12 sessions and
25 jobs; connection preferences byte-identical. All 21 old bridge tasks and 217
saved files unchanged; original/smoke source HEAD/staging unchanged. Missing root
allowed only when absent and independently verified; explicit conflicts/core
identity omissions still rejected, no snapshot repair or replay. Final normal
app reopened; bridge verified/ready/unpaused/idle, 25 terminal tasks. Private
backups and smoke history retained. No commit/merge/push, real-project edit,
phone-setting change, screen-off or host-death test. Full evidence and limits:
[project-deployment.md](project-deployment.md).
Publication: locally deployed, source uncommitted/unpushed; no external release.
Next at A completion: stop; Milestone A complete. The later planning entry below
supersedes this direction without starting implementation.

### Milestone B planning — done (implementation not started)

Changed: new `docs/shared-conversation-design.md`; B01–B11 bounded checklist here;
updated `PROGRESS.md` priority/first-step pointers. Traced actual Android sessions/
requests/status/approvals/review preferences, HTTP routes, Durable root admission/
execution/recovery, RPC event/session lifecycle, immutable project/worktree flows
and independent tmux owner/controller compatibility. Selected an additive projection
in the existing locked owner, bounded cursor polling, exact approval receipts,
non-executing historical reconciliation and a minimal terminal HTTP adapter.
Verified: source/Git inspection and documentation whitespace/local-link checks only;
no test suite, provider, runtime status probe or phone test run. Existing A results
remain historical evidence, not revalidated runtime claims.
Compatibility/data: docs only; no schema/code/runtime/config change, private-state
read/import/migration, bridge start/stop/restart, installation or deployment. Existing
IDs/chats/bindings/Pi session files/worktrees and uncertain-action non-replay are
explicit preservation gates. Historical-only and uncertain Android rows cannot
become executable via import; disconnect is never cancellation.
Publication: local/uncommitted; no commit or push.
Next at planning completion: B01 only — completed in the later evidence entry below.

### B01 — done — 2026-10-20

Changed: `bridge/test/conversation-contract.test.js`, synthetic
`bridge/test/fixtures/conversation-history-v4.json`,
`docs/conversation-contract-baseline.md`; updated design/roadmap/PROGRESS pointers.
Five tests characterize public store/HTTP identity, same-ID retries/conflicts,
concurrent admission, legacy pocket/Pi args, run-scoped dialog/Stop behavior,
post-dispatch coding/approval/review interruption without replay, binding-only dirty
worktrees, remote-completed turns absent from Android and unresolved local evidence.
Verified: `cd bridge && node --test test/conversation-contract.test.js` — **5/5 passed**;
`cd bridge && npm test` — **74/74 passed**, zero failures/skips. Initial focused test
incorrectly assumed string task IDs; corrected the test to actual positive numeric
Durable task IDs, no runtime fix. Source HEAD/staging, exact manifest/dirty-tree and
dispatch-marker assertions pass in disposable repositories. Documentation diff/link
and JavaScript/JSON syntax checks passed. Full commands/limits in baseline doc.
Compatibility/data: test/docs/fixture-only changes; existing store/HTTP seam and real
Git/Durable/RPC with fake Pi, one harmless real shell marker, isolated ephemeral
servers/journals. JSON is not Android SQLite/Keystore migration evidence. No schema,
route/protocol/core/Android behavior change; no production state/config/history read,
provider/device action, phone test, deployment or production bridge operation. No standalone
tmux test, Android build or instrumentation run. Earlier local plan edits preserved.
Publication: local/uncommitted; no commit or push.
Next at B01 completion: B02 only — completed in the later evidence entry below.

### B02 — done — 2026-10-20

Changed: new `bridge/src/conversations.js`, `bridge/test/conversations.test.js`;
`store.js` pre-resume initializer/internal read-only inspectors;
`docs/conversation-baseline-storage.md`, design/roadmap/PROGRESS/B01 pointers.
Added version-1 owner and keyed conversation/turn/review baseline records through
supported Durable transactions in the same locked journal. Stable opaque app IDs,
role-qualified message IDs, reconstructed timestamp/ID order, cursor generation/
sequence 0 and immutable historical source evidence. No extra executor/task/model.
Verified: red before implementation for missing inspector; corruption assertion
red then green after validation. Early missing explicit Durable family flag failed
closed and was corrected. Focused `cd bridge && node --test test/conversations.test.js`
**10/10 passed**; `cd bridge && npm test` **84/84 passed**, zero failures/skips.
Fixtures prove two reopen cycles, rollback after conflicts/after marker preparation,
corrected retry, old task inputs/entries/Pi files/worktree manifests/dirty content/
HEAD preservation, multi-project/binding-only/incomplete-preparation inventory,
undispatched resume once and dispatched coding/dialog/review interruption with zero
replay. Existing B01/regressions pass. Syntax/diff/local-doc-link checks passed.
Compatibility/data: additive Durable documents, old document versions/task kinds and
HTTP protocol 5 unchanged; no owner identity/new capability/routes over HTTP.
Baseline is historical, not current run/approval state; B03 explicitly reconciles
post-capture writes before live events. Existing dispatched memo remains first.
Only disposable journals/Git/HTTP/fake executors used; no production state/config
read/migration/probe, provider/device action, production bridge operation, Android
build/test, normal installation or deployment. No standalone tmux script run; no
survival claim.
Publication: local/uncommitted/unpushed; earlier local changes preserved.
Next at B02 completion: B03 — subsequently split and continued below.

### B03a — done — 2026-10-20

Changed: `bridge/src/conversation-projection.js`, `bridge/test/conversation-transition.test.js`,
pre-resume staging/internal inspector in `store.js`, shared canonical message/order
helpers in `conversations.js`; `conversation-transition.md`, design/baseline pointers,
roadmap and PROGRESS. B03 was split before implementation into a/b/c.
Verified: focused **8/8**, full bridge **92/92**, zero failures/skips. Red missing
inspector, then red retained-body gap, both fixed and green. Immutable revisions,
pinned snapshots and explicit snapshot.reset evidence preserve B02 generation,
ordinal/message/project/run IDs; changed captures advance once, unchanged captures
emit nothing. Fault/conflict rollback includes first-time baseline/project migration.
Real fake-RPC pending run recovers interrupted with one dispatch, retained dirty
worktree/manifest/source staging, and no actionable historical approval. Syntax,
whitespace and documentation checks recorded with source evidence.
Compatibility/data: stagedOnly/liveWrites:false inspector is not a live interface;
no legacy live-write instrumentation, HTTP/protocol/Android change or capability.
No production state/config access, bridge operation, provider execution via bridge,
deployment, phone test, normal installation, commit or push. Earlier work preserved.
Publication: local/uncommitted/unpushed.
Next at B03a completion: user explicitly approved B03b in a fresh Pi coding
session, then B03c in another fresh coding session, and stop. No B04 or deployment
authorization.

### B03b — done — 2026-10-20

Implemented `bridge/src/conversation-live.js`; `store.js` now reconciles and
promotes staged documents atomically before resume, then instruments every existing
coding/review admission, update, completion, abort, recovery and raw-pending/reply
mutation in its authoritative transaction. Retains original dispatch guards,
immutable B02/B03a evidence, identities/generations/ordinals and project authority.
No per-update all-history rescan; immutable revisions/events and keyed live heads.
No HTTP capability, durable approval claims or B03c reads. Staged tests explicitly
inject the historical initializer; production uses live promotion. New inspector
is internal/unbounded/non-consistent and raw pending is not current action proof.

**11/11 new tests; 29/29 combined focused; 103/103 full bridge tests passed**,
zero failures/skips. Syntax, whitespace and local changed-Markdown links passed.
Logs `$TMPDIR/b03b-focused.log`, `$TMPDIR/b03b-bridge-suite.log`.
[Complete evidence and limitations](conversation-live-writes.md). No production
access/operations, provider, deployment, phone tests, commit or push. Earlier local
work preserved. At B03b completion B03 overall remained incomplete, with B03c
next in another fresh session. That session now completed B03c below.

### B03c — done — 2026-10-20

Changed: `bridge/src/conversation-reads.js`, `bridge/src/store.js`,
`bridge/test/conversation-reads.test.js`, `docs/conversation-bounded-reads.md`,
current summary pointers in design/baseline/staging/live docs, this checklist and
`PROGRESS.md`. Supported Durable transaction capture stores immutable reference
manifests at high-water. Separate snapshot continuations/feed cursors/pinned-upper
feed pages; complete histories, whole-envelope count/byte bounds, explicit errors,
retained reset/revision evidence. No changes to production mutation paths.
Verified: 8/8 new, 37/37 combined B02/B03a/b/c focused, 111/111 full bridge,
zero failures/skips. JS syntax, `git diff --check` and local Markdown files/anchors
passed. Exact commands, logs, limits and test coverage:
[bounded read evidence](conversation-bounded-reads.md).
Compatibility/data: no HTTP/health/capability change, execution/task admission,
unknown-chat binding, tree preparation/repair or Jobs/Reviews mutation from reads.
Raw pending remains non-actionable evidence; B04 claims/receipts not implemented.
Only isolated disposable fixtures, no production state/config/runtime probes,
provider, phone, deployment, dependencies, source Git index/commit/push or agents.
Earlier uncommitted/untracked work preserved. Publication: local only.
B03a/b/c all passed; B03 complete in source/fixtures, not deployed.
Next: **stop before B04**, per explicit user authorization.

### B07 — source/host implemented; device database gate pending — 2026-10-21

Changed: additive schema **4→5** hooks in `History.kt`; new `ConversationCache.kt`,
`ConversationCachePolicy.kt`, host `ConversationCachePolicyTest.kt`, fixture-only
`ConversationCacheTest.kt`; [storage contract/evidence](android-conversation-cache.md)
and progress/design/API/import pointers. No Activity/UI or transport wiring.
Owner/chat/project-scoped immutable evidence, stable transcript IDs, snapshot
staging/final adoption and feed heads/cursors share SQLite transactions. Import
manifests/inventory/receipts and original outbox IDs are retained without changing
legacy jobs, submitting work or enabling cached approvals. Conflicts retain both
received and local evidence; foreign schemas/owners/projects and gaps fail closed.
Verified: **33/33 JVM** (11 new + 22 existing), no failures/errors/skips; final normal
`:app:testDebugUnitTest --rerun-tasks` executed all 22 tasks. Normal and fixture
`:app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug`
passed with the documented native AAPT2 override. Full bridge **148/148** and
isolated real-tmux controller **PASS**; whitespace/local Markdown file-link checks
passed. Logs `$TMPDIR/b07-{android,fixture-build,final-normal,jvm-rerun,bridge,controller}.log`.
Nine fixture-only Android SQLite tests compile, covering supported v1–v4 upgrades,
failed-upgrade/page/ack rollback, reopen, duplicate/gapped pages, historical-only
imports, unresolved outbox and synthetic preference preservation. **NOT EXECUTED**:
separate explicit fixture installation/headless device agreement remains pending.
No host mock or compilation result is claimed as Android SQLite verification.
Compatibility/data: v4 upgrade only adds two new tables; original legacy tables,
preferences, IDs/organization, pending review JSON/operation IDs, pairing/selection
and project/worktree bindings are not written by reconciliation. Earlier unrelated
uncommitted/untracked changes remain; no production state/config access/migration,
production bridge operation, deployment, app installation or phone test.
Publication: local/uncommitted; no commit/push. **At this implementation checkpoint,
B07 was not fully database-verified. The later authorized verification below resolves
the device gate; stop before B08.**

### B07 — done (authorized headless Android SQLite verification) — 2026-10-21

Changed: evidence/status only in `PROGRESS.md`, this checklist and
`docs/android-conversation-cache.md`. No storage/runtime/test code changes needed.
Verified: secure Wireless debugging rediscovery reconnected the already-paired
ASUS_I003D, Android 12; native Termux ADB used with explicit fresh serial. Fixture
packages absent before installation. Existing outputs identified as normal APKs were
not installed; rebuilt with `-PreliabilityTests=true` and the documented native
AAPT2 override, `:app:testDebugUnitTest :app:assembleDebug
:app:assembleDebugAndroidTest :app:lintDebug` — **BUILD SUCCESSFUL**, 74 tasks
(19 executed/55 up-to-date). Units up-to-date; prior 33/33 JVM and 148/148 bridge
results were not newly executed here. Build metadata and native AAPT2 badging
verified only `dev.fantasticpimobile.reliability` and `.reliability.test`; test
manifest verified AndroidJUnitRunner's exact fixture target before installation.
Only these APKs installed, both Success. Native class-filtered `am instrument -w -r`
ran only ConversationCacheTest (9), HistoryTest (7), ProjectHistoryTest (3):
**OK (19 tests), 0.482 s**, nineteen pass statuses, no failures/skips. Actual Android
SQLite v1–v4→v5 upgrade/reopen, failed-upgrade rollback/retry, page/ack transaction
rollback, duplicate/gapped/conflicting pages, stable unresolved outbox IDs,
historical-only inert adoption and synthetic preference preservation passed.
No Activity or visible UI tests, connected-test task or other test classes run.
Both previously absent fixtures removed in `finally`, Success; final fixture
package query empty. `git diff --check` and local Markdown file-link checks passed.
Logs: `$TMPDIR/b07-verification-{fixture-build,device-before,apk-identities,device}.log`;
full command, APK hashes and preservation limits in the storage evidence document.
Compatibility/data: only isolated fixture SQLite/preferences exercised; no normal
APK installed, normal data/history/pairing read/migration, normal Activity launch,
production bridge operation/restart, configuration/journal access, deployment,
provider work or phone settings changes. Existing uncommitted/untracked source
preserved; synthetic preservation assertions are not a production-state comparison.
Publication: local/uncommitted; no commit or push.
Next at B07 completion: **stop before B08**. The later explicit B08 authorization
and completed source/fixture verification below supersede that stop, not deployment.

### B08 — done (source + actual headless/visible isolated Android) — 2026-10-21

Changed: new `SharedConversations.kt`/`SharedConversationPolicy.kt`, host policy test,
headless/visible `SharedConversationsTest.kt`/`SharedConversationsUiTest.kt`, real
throwaway owner `bridge/test/android-shared-fixture.js` and identity/install/cleanup
harness `scripts/check-android-shared.py`. Wired `MainActivity`, `ChangesActivity`,
`Connection`, `History`, `SessionDrawer`, `ProjectPicker`; updated legacy status UI
fixture preflight/gate, progress/design/API/import/cache pointers and new
[Android shared-client evidence](android-shared-conversations.md).
Verified: **36/36 JVM** (3 new + 33 prior), explicit all-22-task unit rerun; normal
and reliability fixture unit/build/test-APK/lint passed with documented native
AAPT2 override. **148/148 bridge**, isolated real-tmux controller PASS. Final native
ASUS_I003D/Android 12 `python scripts/check-android-shared.py --serial "$SERIAL" --ui`
passed **35/35 Android tests**: 19 existing data, 11 headless real SQLite/HTTP,
1 B08 native UI and 4 legacy UI. No skips/failures in the final full run. Actual
complete responses dropped after owner commit/delivery for Send/import/approval/
review (one harmless disposable-worktree `printf B08_REVIEW_OK` test command);
original-ID recovery, no imported execution/duplicate dispatch/reply/cards, cursor
and both-side conflict retention, replaced/downgraded owner, same-URL re-pairing,
stale callbacks, remote busy/Stop isolation and reopened immutable conflicts pass.
Announced visible fixture flow discovered a completed remote chat once, reopened
selection/result, sent a harmless local request, discovered/stopped exact active
archived remote work, answered one fixture approval despite dropped response and
reopened without another answer. Native fixture state/IDs/drafts/organization/
pairing/review JSON preserved. Existing picker and legacy status/approval UI green.
Compatibility/data: schema 5 unchanged; B07 transaction ownership retained. Only
new remote session organization/binding and local accepted outbox proof are written
to legacy tables; remote-only turns remain cache records. Strict capability/owner/
endpoint/credential/visibility gating, stable shared request/answer IDs before HTTP,
non-actionable historical evidence and no shared-to-legacy uncertain retry fallback.
No normal app installation/data access/migration, normal Activity launch, production
configuration/journal access, bridge operation/restart, deployment, provider, phone
settings/security/IME change, commit or push. Device/APK/runner identities verified
before installation; both absent at session start and absent after final cleanup,
including explicit removal of a base fixture retained across the timeout/retry.
Existing local/untracked work retained. Disposable repository HEAD/staging unchanged.
Evidence: final per-method runner/count files `$TMPDIR/b08-android-evidence-dlaqkvbf/`;
logs `b08-final-{normal,fixture,jvm,device}.log`, `b08-bridge.log`,
`b08-controller.log`; regression reds/greens and limits in the new evidence doc.
Whitespace/syntax/local Markdown file-link checks passed. No claim of normal
production smoke, terminal/B09, B10 process-death continuity, screen-off/host survival
or destructive automatic owner/import-conflict resolution.
Publication: local/uncommitted/unpushed, fixture-tested only.
Next: **stop before B09**. No terminal client or production rollout started.

### B09 — done in source/disposable process fixtures — 2026-10-21

Changed: `scripts/conversation-client.mjs`, `bridge/test/terminal-client.test.js`,
`docs/terminal-conversations.md`, progress/roadmap/design status. HTTP-only private
JSON-lines client; atomic owner/cursor/outbox/response IDs, original-ID Send/approval
recovery, strict shared gates, no legacy transport. Confirmed exact-run Stop is
separate from EOF/Ctrl-C/detach. No bridge/provider/session/journal/executor access.
Verified: **10/10 new process tests**, **158/158 full bridge**, no failures/skips.
Real disposable HTTP/Durable owners and client child processes, fake workers,
actual acceptance/approval socket loss and pre-admission loss, remote completed
catalogue, bounded duplicate/replayed reads, reconnect, approval races, schema/owner
refusal and exact Stop isolation (other chat and later same-chat run). ID persistence
inspected before HTTP forwarding; EOF after terminal Send and signal/explicit detach
leave live work uncancelled. Test-local staging compared unchanged.
Failures/limits: corrected missing-history 404 assumption and stdin detach hang;
corrected test admission-vs-dispatch timing. Red/green regression fixed tentative
later-feed-page records leaking into the next save; final full 158/158 passed after
that fix. Syntax/whitespace and 91 local Markdown file links passed. Disposable
probe leftovers removed with no fixture/client processes remaining.
Explicit cursor rebuild; conservative
non-replayable uncertain answers and manual verified stale-lock handling. Full
commands/logs/security/usage are in [terminal-conversations.md](terminal-conversations.md).
Compatibility/data: no server/schema/protocol/Android/dependency change; original
uncommitted work retained. No normal-app install/data/migration, production runtime
operation/restart, deployment, real provider, device test, commit or push.
Publication: local/uncommitted/unpushed.
Next: **stop before B10**; no Android↔terminal continuity or production rollout run.
