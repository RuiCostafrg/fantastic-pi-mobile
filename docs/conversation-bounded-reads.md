# B03c — bounded consistent internal conversation reads

Status: **complete in source/isolated fixtures — 2026-10-20; not deployed**.
B03a/b/c are complete. No HTTP route, health/protocol/capability, Android or
approval-action change. Stop before B04. Prior evidence: [staging](conversation-transition.md),
[live writes](conversation-live-writes.md), [baseline](conversation-baseline-storage.md).
Roadmap: [next-steps.md](next-steps.md). Design: [shared-conversation-design.md](shared-conversation-design.md).

## Supported capture and storage

`bridge/src/conversation-reads.js` exposes internal functions through `openStore`:

- `readConversationSnapshot(id, {token?, limit?, maxBytes?})`
- `readConversationEvents(id, {after?, token?, limit?, maxBytes?})`

Each call runs inside the **same supported Durable `root.commit` interface** used
by authoritative mutations. Snapshot capture reads the conversation high-water and
heads, validates immutable bodies and pins their revisions **inside that transaction**.
It stores a version-1 `pocket.read-snapshots` session-family document keyed by JSON
`[conversationId, sequence]`: identity scope, sequence and ordered kind/id/ordinal/
revision references only. No all-history body copying on updates or captures.
Repeated captures at an unchanged high-water reuse the immutable manifest. Snapshot
continuations never consult mutable heads. They load only their candidate immutable
bodies. The journal remains owned by the existing exclusive store; no private SQL,
second database owner, polling sidecar or extra task/run machine.

Capture is non-executing: it creates only reference evidence, not tasks, bindings,
Jobs/Reviews changes, worktree preparation/repair, events, cursor resets or approvals.
Unknown reads are 404 before conversation document lookup. Existing B02 evidence,
B03a staged snapshots/resets and B03b immutable revisions/events remain retained,
including across startup. Nothing is pruned. Capture scans ordered references and
validates heads once; manifests are O(history references), not O(transcript bytes).
This is a bounded **response** protocol, not a promise of constant capture time or
bounded total retained storage. Startup still validates existing historical/live
evidence via B03a/b. No restore, compaction or generation-rewind API was added.

## Page protocol

All responses have schema version 1, owner/conversation/project/generation scope,
`internalOnly:true`, `consistentRead:true`, `liveWrites:true` and
`approvalEvidence:"raw-pending-not-action-proof"`. Tokens are detached structured
JSON values for internal use, not bearer capabilities, cryptographic signatures or
approval claims. Any future transport must authenticate and authorize separately.
Server identity scope is checked against Owner, live projection and immutable
Bindings. No wall/client clock orders turns.

Snapshot response:

- `snapshot`: replay token for offset zero of this immutable snapshot;
- `highWater`: captured sequence;
- `items`: ordered `{kind,id,ordinal,revision,record}` entries (turns then reviews,
  each preserving its own assigned ordinals);
- `next`: `kind:"snapshot-page"` token with scope, sequence and next offset, or null;
- `after`: usable `kind:"feed-cursor"` with scope and sequence equal to high-water.

Apply **all** snapshot pages before adopting `after`. A turn item contains one user
and one assistant/result message with stable role-qualified IDs. Revisions replace
that run's card, not append another card. Reviews are separate operation records.
Changing page bounds can change page partitioning, not captured contents. Replaying
the same token with the same bounds is deterministic even after later writes/reopen.

Feed starts with `{after: snapshot.after}` or a previously applied feed `after`.
The first call pins the committed current sequence as `upper`. Responses include:

- `page`: replay token for this page, with `kind:"feed-page"`, start sequence and upper;
- `items`: contiguous `{event,record}` immutable revisions, or `{event,snapshot}`
  for an explicit retained `snapshot.reset`;
- `next`: another feed-page token with the **same upper**, or null;
- `after`: feed-cursor at the last returned sequence (unchanged on an empty page).

Continue with `{token: response.next}`; replay even the first page using
`{token: response.page}`. New writes cannot extend a page chain's upper bound.
Once next is null, poll with `{after: response.after}` to capture a new upper bound.
The initial mutable query itself is not a replay token: re-polling its old `after`
may intentionally discover later events. Snapshot continuations and feed cursors
are distinct kinds and cannot be interchanged. Duplicate pages are idempotent when
clients upsert by kind/id/revision and atomically persist page application/cursor.
These server reads do not implement the future client cache transaction.

A reset requires reading its `snapshot` token through the snapshot method; it pins
the retained staged source revision, not today's heads. Finish that historical
snapshot then consume subsequent ordered events. Unobserved intervals have only
snapshot.reset, never invented semantic history. Capturing a live snapshot directly
and consuming events after its high-water is the normal race-free attach path.

## Limits and explicit failures

`READ_LIMITS`: count default **50**, allowed integer **1–200**; UTF-8 JSON response
bytes default **262144**, allowed integer **1024–1048576**. Limits apply independently
to each response. Count means returned turn/review items for snapshots or event
items for feeds, not nested message count. No partial item, omitted field or null
placeholder is substituted. Byte accounting uses `Buffer.byteLength(JSON.stringify(
response), 'utf8')` on the **entire envelope including all tokens/metadata**, not
summed bodies. HTTP headers/transport encoding do not exist in this internal API.

Count/byte boundaries return a continuation, never truncate history silently.
If even an empty envelope cannot fit: `ENVELOPE_TOO_LARGE` (413). If the first next
whole item cannot fit: `ITEM_TOO_LARGE` (413); retry with a larger supported byte
budget. If an item exceeds the maximum budget, the caller must stop/report it;
this protocol does not silently skip it or claim a complete transcript. Errors
are thrown, not successful partial pages, and carry `code` plus `status`:

| Code | Status / meaning |
| --- | --- |
| `INVALID_LIMIT` | 400, noninteger/out-of-range/null limits or invalid options |
| `MALFORMED_CONVERSATION`, `MALFORMED_TOKEN` | 400, bad ID/token kind/sequence/offset/upper |
| `UNKNOWN_CONVERSATION` | 404, no binding/admission/tree creation |
| `FOREIGN_TOKEN` | 409, owner/conversation/project mismatch |
| `WRONG_GENERATION` | 409, stale or foreign generation |
| `UNSUPPORTED_SCHEMA` | 409, token/manifest/event schema unsupported |
| `FUTURE_CURSOR` | 409, sequence or upper beyond committed history |
| `HISTORY_GAP` | 409, missing/inconsistent manifest/event/sequence/identity/ordinal |
| `MISSING_IMMUTABLE_REFERENCE` | 409, missing/inconsistent pinned body/messages/source |
| `LIVE_READS_UNAVAILABLE` | 409, staged/non-live store cannot impersonate current reads |

No reset-on-error, automatic new Send, pruning or invented events. Raw pending,
pending clears and recovery are readable evidence, **not current cross-client
approval permission**. B04 must provide exact occurrences/claims/receipts. The old
`getStagedConversation` remains historical-only and refuses live mode;
`inspectLiveConversation` remains unbounded/non-consistent diagnostic-only.

## Verification

```sh
cd bridge
node --test test/conversation-reads.test.js test/conversation-live.test.js test/conversation-transition.test.js test/conversations.test.js
npm test
```

New read tests: **8/8**. Final combined B02/B03a/b/c: **37/37** (~20.76 s).
Final full bridge: **111/111** (~89.42 s; all prior 103 retained), zero
failures/skips. Logs: `$TMPDIR/b03c-focused.log`, `$TMPDIR/b03c-bridge-suite.log`.
`node --check` for every `bridge/src/*.js` and `bridge/test/*.js`: passed.
`git diff --check`: passed. Local changed/untracked Markdown file/anchor checks:
**81 links passed**. Static log: `$TMPDIR/b03c-static-checks.log`.

Execution provenance: after B03a, the supervisor launched a fresh persisted Pi CLI
coding session `b03b`, waited for completion and verified its source/test evidence,
then launched a different fresh session `b03c` (no inherited session history).
Both exited 0. The supervisor independently checked both session headers/exit
records, final test logs, roadmap completion, source syntax and whitespace.
Private session/log artifacts are under
`$TMPDIR/fantastic-pi-b03-sessions.eS1eYi/`; no raw session transcript was added to Git.
Extensions/MCP were disabled for both coding sessions. Neither was a production
bridge owner or attachment against application Pi session files.

Cases: full multi-page history/feed; whole-envelope byte and count bounds/invalid
limits; explicit oversized items; stable result IDs/ordinals/revisions; replay of
snapshot/feed pages after writes and startup; snapshot catch-up race; a paused
supported capture transaction with a concurrently queued authoritative write;
mid-feed writes beyond pinned upper; pending open/clear/recovery and review events;
retained reset historical snapshot references; foreign owner/chat/project,
generation/schema/future/kind errors; missing bodies/event gaps; no unknown-chat
admission/binding and two real disposable project isolation. B03b/B02 tests retain
fake-RPC/dispatch/worktree/task/input preservation and non-replay coverage.

Initial read test trials exposed fixture assumptions (raw start-of-feed was not an
oversized final item; review operation ID was shorter than the existing minimum;
an empty 1024-byte envelope can fit). Corrected assertions/IDs; no production
write-path refactor was needed. Only additive read methods in `store.js`.

Only disposable Git/Durable/fake executors and supported transaction fixtures.
No production state/config/history read, runtime probe/bridge operation, provider,
phone/ADB, dependency install, normal installation/deployment, source Git commit/
push/index manipulation or another agent. All earlier work remains local/preserved.
B03 complete in source/fixtures is **not** deployed shared-client attachment,
approval safety, host survival or a client rollout. Stop here, before B04.
