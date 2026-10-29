# B05 — authenticated shared conversation HTTP contract

B05 completed in source/isolated fixtures, 2026-10-21. **Not deployed.**
The later B06 source-only [history import contract](conversation-history-import.md)
adds a separately gated evidence lane and opt-in catalogue. It preserves these
execution snapshots/event tokens; historical-only chats are not executable records.
B06/B07 are complete in source/fixtures, including actual
[Android SQLite verification](android-conversation-cache.md). B08 now adds
[foreground Android shared-client wiring and isolated live phone evidence](android-shared-conversations.md).
Stop before B09; no normal-app rollout or production bridge upgrade.
The B05 checkpoint/evidence below is historical.
This exposes B03's bounded projection and B04's exact approval/Stop implementation
inside the existing exclusively locked `openStore`/Durable owner. No new executor,
database, dependency, Pi session writer, Android schema or terminal client.

Related contracts: [design](shared-conversation-design.md),
[bounded reads](conversation-bounded-reads.md),
[approval delivery](approval-response-delivery.md), [projects](project-api.md).

## Preflight and scope

All routes require the existing `Authorization: Bearer <token>` and return JSON
with `Cache-Control: no-store`. Keep credentials in protected configuration, not
argv, URLs or logs. Loopback HTTP/remote HTTPS policy is unchanged.

Authenticated `GET /health` on a supported live store adds:

```json
{"ok":true,"protocolVersion":6,"conversationCore":true,"eventSchemaVersion":1,"ownerId":"<stable-journal-UUID>","projectBindings":true,"processId":1234}
```

Other existing health fields remain. `ownerId` is durable identity, **not** PID.
A project-only store still advertises protocol 5; a legacy store protocol 4. A
staged-only fixture cannot advertise this capability. New clients must require
numeric protocol **6**, literal `conversationCore: true`, numeric event schema
**1**, and a valid owner identity before shared reads/writes. Unknown/future schemas
are not permission to partially apply data. This step provides the server contract
and refusal tests, not a new Android/terminal client implementation.

Every shared request must also carry:

```text
X-Conversation-Schema: 1
X-Conversation-Owner: <ownerId from authenticated health>
```

A missing/wrong schema or unavailable capability returns 426, for example
`{"error":"CONVERSATION_CORE_UNAVAILABLE","requiredProtocol":6,"eventSchemaVersion":1}`.
A missing/wrong owner returns 409 `FOREIGN_OWNER`. Optional body `ownerId` must agree.
Freeze endpoint/owner across preflight/action; an owner change requires explicit
reconciliation, never automatic resubmission to a different journal. Create/Send
also recheck owner within the acceptance transaction; approval/Stop use B04's
transactional exact-target checks.

## Routes and examples

### Catalogue, create and open

- `GET /v1/conversations?limit=50&maxBytes=262144[&token=<JSON>]`
- `POST /v1/conversations` with
  `{"conversationId":"chat-a","projectId":"<registered-project>"}`
- `GET /v1/conversations/chat-a?limit=50&maxBytes=262144[&token=<JSON>]`

Create is an idempotent, immutable binding/empty projection transaction. It returns
`{"schemaVersion":1,"ownerId":"...","conversationId":"chat-a","projectId":"..."}`.
It creates **no task, provider process, worktree or invented historical messages**.
A new create needs an explicit registered project; no default fallback. Reusing a
bound chat with a different project is 409. Unknown projects are 404; invalid IDs
400. New creates respect the existing admission pause (429). Existing chats,
including `pocket`, keep their exact IDs/bindings. Unknown open is 404 and does
not establish a binding. GET has no execution/worktree effects; snapshot capture
may persist an immutable pagination reference manifest in the same journal.

Catalogue example:

```json
{"schemaVersion":1,"ownerId":"...","items":[{"conversationId":"chat-a","projectId":"...","sequence":7,"currentRun":{"runId":"request-0001","status":"done","approvalId":null}}],"next":null}
```

`currentRun` is the latest accepted turn summary (including completed turns), or
null for an empty chat. Catalogue pages use a distinct owner-scoped
`catalogue-page` token with `lastId`, in exact lexicographic ID order. They are a
bounded **refreshable keyset view**, not an immutable catalogue snapshot: newer
chats before the key require a refresh from the beginning. Refresh on reconnect
and periodically, including when the client has no locally active jobs. Never use
a transcript/feed token as a catalogue token.

Open returns B03's consistent version-1 envelope: owner/conversation/project,
generation, `consistentRead`, `liveWrites`, `approvalEvidence`, `snapshot`,
`highWater`, feed cursor `after`, `items`, and snapshot-page `next` or null.
Each item is `{kind,id,ordinal,revision,record}`. Turn records include `runId`,
stable role-qualified `messages`, and immutable job `source` with status/text/
answer/progress/pending/approval occurrence/receipt evidence. Review records carry
`operationId` and existing review state, not a second repository-action API.
HTTP omits internal inspector labeling and `record.source.taskId`; old job wire
shapes are unchanged. Empty created conversations have high-water 0 and no items.

### Bounded events and continuation

- `GET /v1/conversations/chat-a/events?after=<JSON-feed-cursor>&limit=50`
- Continue snapshot **or** feed pagination with `?token=<JSON-next-token>`.

Query tokens are URL-encoded JSON objects returned by the owner. Do not extract
just their sequence, synthesize them, swap snapshot/feed/catalogue kinds, or reuse
them across owners/chats/projects/generations. For example, construct query strings
with `URLSearchParams({after: JSON.stringify(snapshot.after), limit: '50'})`.

Snapshot continuation pins immutable record revisions/high-water, even if another
client writes meanwhile. After applying **all** snapshot pages, read events from
its `after` cursor. Feed responses return `upper`, `page`, ordered `items`, `next`
and advancing `after`; feed continuations pin the initial upper bound. After the
last continuation, poll again using the returned `after`. Duplicate pages are
safe: upsert stable record/message IDs and advance the cursor atomically. Do not
append a new assistant card per revision. `snapshot.reset` entries carry a snapshot
token and require rebuilding from that snapshot, not guessing missing events.

Limits cover the **whole serialized successful response**, not just text:
count default 50, range 1–200; bytes default 262144, range 1024–1048576. If the next
item cannot fit, the read fails 413 `ITEM_TOO_LARGE` rather than skipping history.
The envelope alone may fail `ENVELOPE_TOO_LARGE`. Transport only removes internal
fields, so cannot enlarge the already bounded envelope. No retention/pruning.
Query token text is additionally limited to 8192 characters. Unknown/duplicate
query keys, combining `token` with `after`, or malformed numeric/JSON options fail;
`after` is allowed only on events. POST body limit remains 65536 bytes.

### Shared Send reuses jobs

`POST /v1/jobs`, with the shared headers and:

```json
{"requestId":"request-0001","conversationId":"chat-a","projectId":"<registered-project>","text":"Make the requested change"}
```

Returns 202 with the existing accepted job shape (`id == runId == requestId`,
`sessionId == conversationId`). No separate submission queue/model is introduced.
Create is optional: Send may atomically bind a new chat with the explicit project.
Optional `sessionId` must equal `conversationId`. Missing shared project/chat is
400, never an omitted-project default. Same-ID/content/chat/project retry returns
the accepted job; conflicting reuse is 409. On response loss, recover exact ID with
existing `GET /v1/jobs/:runId`, then retry only the same saved request if needed.
A disconnect does not Stop. Catalogue discovers terminal/remote turns even after
they complete without a client present.

### Exact approval receipt

`POST /v1/conversations/chat-a/approvals/:approvalId/response`, shared headers:

```json
{"runId":"request-0001","projectId":"<registered-project>","responseId":"response-0001","answer":{"confirmed":true}}
```

Use `encodeURIComponent(approvalId)` for the **opaque owner occurrence ID** from
`record.source.approvalOccurrenceId`, never the raw Pi dialog ID. Persist the
response ID before POST. Input/select/editor answers use B04's normalized answer
shapes. Optional body conversation/approval IDs must agree with the URL.

200 returns the durable receipt directly: exact owner/chat/project/run/occurrence,
response ID, normalized answer, `claimedAt`, and `delivery: "attempted" | "unknown"`.
Same response ID/target/answer returns its saved receipt, including after reopen;
changed payload/target is 409. Only the exact current live sender can win a new
claim. Competing answers, replacement, completion, recovery and Stop share the
existing per-run gate/transaction rules. `unknown` must **not** trigger a new
external delivery or a fresh response ID retry. `attempted` is a pipe callback,
not acknowledgement of an external effect. Snapshot/raw pending evidence is never
permission to bypass server-side validation. No historical approval auto-answer.

### Run-scoped Stop reuses cancel

`POST /v1/jobs/request-0001/cancel`, shared headers:

```json
{"conversationId":"chat-a","projectId":"<registered-project>"}
```

200 returns `{runId,status,stopRequested}` from B04's exact-target gate. Optional
body `runId` must equal the URL. Wrong owner/chat/project conflicts; unknown run
is 404. Terminal Stop is harmless, never cancels a later run or another chat.
Stop cannot undo an already attempted approval's possible effects. No cancel on
client disconnect/EOF/Activity destruction, and no host-lifetime promise.

## Errors and mixed versions

- 401: authentication fails before private reads or body processing.
- 400: malformed JSON/object/IDs/answer/options/token, invalid bounds.
- 404: unknown conversation/run/project or route.
- 409: binding/owner/approval conflict, foreign token, wrong generation, future
  cursor, unsupported token schema, history gap/missing immutable reference.
- 413: body/token/envelope/item exceeds its explicit bound; no silent truncation.
- 426: missing/unsupported shared capability/schema, no legacy shared fallback.
- 429: paused admissions or existing concurrency/review guards.

Bounded-reader codes are returned in `error` (for example `FOREIGN_TOKEN`,
`WRONG_GENERATION`, `FUTURE_CURSOR`, `UNSUPPORTED_SCHEMA`, `HISTORY_GAP`). On cursor
failure obtain a fresh snapshot, not a new Send. No private raw exception on 500.

All existing `/v1/jobs`, `/ui`, `/cancel`, `/v1/sessions/...`, project and review
routes/wire shapes remain. Legacy requests without shared fields/headers retain
frozen-default/established binding behavior and participate in the same committed
projection. Legacy `/ui` still uses B04's fail-closed unambiguous raw-ID translation.
Shared fields or headers mark a job request as shared; missing capability/schema
cannot silently dispatch it via legacy semantics. New clients must not downgrade
uncertain shared outbox work to legacy transport. Android cache/import/terminal
implementation is deferred to B06 onward.

Controller status retains strict numeric allowlist 4/5 and adds 6. Protocol 6 also
requires literal conversation/project capabilities, numeric event version 1 and
UUID owner identity. PID/storage ownership, maintenance/idle/backup and owner
rechecks are unchanged. String/unknown versions or malformed capability metadata
remain unverified; accepting protocol 6 does not authorize a production restart.

## Implementation and actual evidence

Changed: `bridge/src/conversation-interface.js`, `store.js`, `server.js`, the
bounded-read helper exports and empty-chat live validation; new
`conversation-http.test.js` and `conversation-http-bounds.test.js`; B02/session/
project HTTP health expectations; controller and isolated controller harness;
README, controller/design/roadmap/progress docs and this contract.

Executed locally (no provider/normal app/production data access):

- New HTTP/transport tests: **6/6 passed**. Real disposable Git/Durable/loopback
  HTTP checks auth, body limits, capability/owner/schema refusal, create/reopen
  without execution/worktree creation, old route writes, catalogue completed-turn
  discovery, pinned snapshot pagination during writes, ordered/duplicate event
  pages, cursor errors, bounded bytes and exact approval/Stop targeting.
- Lost acceptance uses a real HTTP socket destroyed after owner admission; exact-ID
  retry yields one runner dispatch and one turn. Opposite HTTP approvals yield one
  receipt/pipe attempt; same receipt survives Stop/reopen without another reply.
- Focused new HTTP + B03c/B04 lifecycle/receipt/partial tests: **32/32 passed**.
- Full `cd bridge && npm test`: **135/135 passed**, no failures/skips. Initial full
  run found only two historical protocol-5/no-capability expectations; updated to
  the explicitly authorized B05 protocol/gating behavior and reran green.
- `python scripts/check-bridge-work.py`: **PASS**, isolated real tmux socket,
  disposable checkout/data/port/fake Pi only. Numeric 4/5/6 accepted; string/unknown
  protocol, malformed capabilities/schema/owner rejected. Existing auth/port/owner,
  approval/review idle guards, admission pause, private backup/restart/exact-ID
  non-replay and untouched original fixture pane checks passed.
- Actual rerun `testDebugUnitTest --rerun-tasks`: **22/22 JVM passed**, all 22
  Gradle tasks executed. No Android source/schema change; no device/instrumentation
  test or app installation. Syntax/whitespace and local Markdown links checked.

Temporary logs: `$TMPDIR/b05-http.log`, `b05-focused.log`, `b05-full.log`,
`b05-controller.log`, `b05-jvm.log`. Source fixture checks retain original source
HEAD/staging; existing worktree/ID/binding/non-replay suites remain green. No claim
of production upgrade, normal-state migration, live provider approval races,
Android/terminal continuity, screen-off or host-death testing. Existing uncommitted
work remains local; no commit/push, production bridge operation or installation.
**B05 complete; B06 remains unimplemented and was not started.**
