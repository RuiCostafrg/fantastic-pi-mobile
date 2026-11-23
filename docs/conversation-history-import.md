# B06 — historical client evidence, never execution

**B06 complete in source/synthetic fixtures — 2026-10-21.** B07's
[Android reconciliation storage and actual SQLite gate](android-conversation-cache.md)
are complete. B08 adds [foreground reconciliation and isolated native phone tests](android-shared-conversations.md).
**Stop before B09.** No production import, deployment, bridge operation or normal-app
installation; only authorized isolated fixture APKs were installed and removed.
The B06 checkpoint below is historical. Related:
[shared design](shared-conversation-design.md), [B05 API](conversation-api.md),
[B01 synthetic inventory](conversation-contract-baseline.md).

## Chosen seam and invariants

History evidence uses new supported Durable documents in the **same exclusively
locked owner/journal**, not Jobs, Tasks, Pi sessions, executable projection records
or a second database. Imports neither call task creation/resume nor prepare a
worktree, register/bind a project, answer a dialog or retry a repository action.

- Existing accepted request ID + conversation + text + proved project must agree.
  Backend run/result/status/approval state remains authoritative. A stale local
  answer/status/dialog is retained as evidence, never applied to that job.
- A matching accepted request is a `backend-reference`, with **no display messages**
  in the evidence view. Display the canonical B05 cards once, not a second imported
  copy. Import receipts link the exact `canonicalRunId`.
- Local-only terminal-looking rows are `historical-unverified`, with original
  request IDs, user/assistant text, source order, timestamps and provenance. They
  are display evidence, not backend completion or proof of external effects.
- `sending`, `queued`, `running`, `interrupted` and `unknown` local-only rows are
  `unresolved-outbox`. Import is not admission/retry/acknowledgement of their work.
  Original status and pending/progress strings remain evidence only.
- Every evidence card has `actionable: false`, `executionAuthority: false`. Cached
  pending JSON is an uninterpreted string, never a current approval control.
- Only existing immutable Bindings prove project identity. A registered/selected
  client project claim alone is **not** proof. Unproved histories have no binding,
  project/worktree or executable snapshot. They stay read-only, including literal
  `pocket` and empty selected drafts. Conflicting non-null project claims conflict
  even when neither claim has backend proof; neither becomes a binding.
- Imported local-only request IDs are reserved against **all** Send routes. A new
  Send cannot turn a historical/uncertain imported ID into a task, even in an
  already-bound chat. Create/Send/new review actions cannot silently bind an
  unproved imported conversation to today's default or a newly selected project.
  Existing accepted job/review exact-ID recovery still works. This step provides
  no automatic mechanism to release these reservations or resolve unknown targets.

This is intentionally a separate evidence lane. It does not rewrite B05's event
schema/cursors, append fictional past execution events, combine source clocks into
backend turn ordering, or implement Android cache/UI adoption. Those clients must
explicitly reconcile evidence in B07/B08 and render it distinctly in B09.

## Authenticated capability and routes

B05 protocol remains **numeric 6**, event schema remains **1**. Authenticated health
adds literal `historyImport: true` and numeric `historySchemaVersion: 1` only on a
supported shared store. Clients must preflight these fields and freeze owner and
endpoint. Every history request requires the existing bearer auth plus:

```text
X-Conversation-Schema: 1
X-Conversation-Owner: <stable owner UUID>
X-History-Schema: 1
```

Unsupported/missing history capability or history header/schema is 426
`HISTORY_IMPORT_UNAVAILABLE`; wrong owner is 409. B05 schema/owner gates still
apply. A history-aware header also marks job traffic shared, preventing a missing
shared target from silently falling back to legacy Send.

| Method | Route | Result |
| --- | --- | --- |
| POST | `/v1/conversations/:id/history/imports` | Validate/import one bounded manifest; durable receipt, or durable conflict receipt |
| GET | `/v1/conversations/:id/history/imports/:importId` | Exact immutable original manifest and receipt, including conflicts |
| GET | `/v1/conversations/:id/history` | Bounded immutable-revision evidence/receipt pages |
| GET | `/v1/conversations` with `X-History-Schema: 1` | Opt-in catalogue includes historical-only chats and evidence revision summaries |

Without the history header, B05 catalogue remains execution-only with its existing
shape. Opt-in catalogue entries add `historyEvidence: {revision, readOnly: true,
executionAuthority: false}`; history-only chats have `executionAvailable: false`,
`projectId: null`, `sequence: null`, `currentRun: null`. Known executable chats retain
their real current run/project and may also have evidence. Poll this catalogue on
reconnect/periodically: ordinary execution events do **not** announce imports.
Opt-in keyset pages use `history-catalogue-page` tokens, not B05 `catalogue-page`.
Switching views with the wrong token fails rather than skipping evidence.

B05 open/events still operate on executable conversations only. Opening a
history-only chat through B05 returns 404: use the gated history read, not a fake
execution snapshot/cursor. Empty manifests can preserve draft/title/organization
but cannot establish a coding project or cause a Send.

## Manifest schema and digest

One manifest covers exactly one conversation, at most **100 rows** and **65536
UTF-8 serialized bytes** including digest. HTTP also retains its existing 65536-byte
body limit before parsing. Larger history must be explicitly exported as ordered
bounded batches with distinct stable import IDs; there is no implicit truncation.

Example (digest and owner placeholders must be replaced by real values):

```json
{
  "schemaVersion": 1,
  "ownerId": "<stable-owner-UUID>",
  "conversationId": "history-only",
  "importId": "android-import-0001",
  "digest": "<64 lowercase SHA-256 hex characters>",
  "projectId": null,
  "provenance": {"kind": "android-v4", "sourceId": "private-export-0001"},
  "session": {"title": "Old chat", "draft": "Local draft", "finished": true, "archived": true},
  "rows": [
    {"requestId": "original-request-id", "ordinal": 1, "text": "Original question", "answer": "Original answer", "clientStatus": "done", "projectId": null, "sourceRowid": 12, "createdAt": 1200, "pending": "", "progress": ""}
  ]
}
```

Digest algorithm: remove only top-level `digest`; recursively sort JSON object keys
lexicographically, preserve arrays/source row order, serialize compact JSON with
ordinary JSON string escaping and no whitespace, then SHA-256 its UTF-8 bytes.
The digest covers schema/owner/conversation/import IDs, provenance, session and all
rows. `historyDigest` in `bridge/src/conversation-history.js` is the executable
reference. Object-key order changes are harmless; text is not Unicode-normalized or
trimmed. Digest mismatch is 400 before writes. The digest is integrity/idempotency
metadata, **not** authentication or proof that client history is true.

Required fields are those in the example, except the optional session properties
and row source metadata. Unknown fields fail rather than accidentally introducing
execution/import of arbitrary Pi files or review actions.

- Conversation/project/source IDs: existing 1–80 opaque ID syntax; project claims
  must explicitly be an ID or null. `sourceId` identifies private export provenance,
  not an endpoint/credential/device serial or proof of owner identity.
- Import/request IDs: 8–80 letters, numbers or hyphens, retained exactly. Import IDs
  are owner-global; reusing one for another chat or changed content is 409.
- Provenance: exactly `{kind: "android-v4", sourceId}`. Pi session import unsupported.
- Session evidence permits `title`, `draft`, `projectState` strings; `pinned`,
  `finished`, `archived` booleans; nonnegative safe-integer `created`/`updated`.
  This records evidence only, not cross-client organization synchronization.
- Each row requires `requestId`, positive strictly increasing source `ordinal`,
  `text`, `answer`, `clientStatus`, `projectId`. Request IDs are unique per manifest.
  Optional `projectState`, `progress`, `pending` are strings; `createdAt`/`sourceRowid`
  are nonnegative safe integers. Source ordinals can span bounded batches; they are
  **not** backend turn ordinals. Retain provenance/ordinal when reconciling batches.
- Allowed client status strings: `sending`, `queued`, `running`, `done`, `failed`,
  `cancelled`, `interrupted`, `unknown`; none is proof of backend state.

Source equal-time row order is retained, including B01's deliberately nonlexical
`history-z-first` then `history-a-second`. History page references append in import
arrival/source order; they do not claim a total execution chronology across batches,
exports or canonical backend turns. Original manifests remain individually ordered.

Pending review JSON/operation IDs, pairing, selection and organization are not
rewritten or dispatched. Do not include connection credentials or review preference
blobs in this manifest; those remain client-local. No installed app is read by B06.

## Receipts, conflicts and atomicity

A successful POST returns 200 with:

```json
{"schemaVersion":1,"ownerId":"...","conversationId":"history-only","importId":"android-import-0001","digest":"...","revision":1,"outcome":"imported","executionAuthority":false,"projectEvidence":{"claimedProjectId":null,"provedProjectId":null,"state":"unproved"},"decisions":[{"requestId":"original-request-id","classification":"historical-unverified","deduplicated":false}],"conflicts":[]}
```

Same import ID and exact canonical manifest returns the **same saved receipt**,
including after reopening the owner. Retry never creates another row/revision/task.
A new import ID with identical existing rows deduplicates rows while retaining its
own original manifest and acknowledgement. Backend-reference manifests can retain
newer/different cached answer/status evidence without replacing canonical state.
Changed local-only row evidence or wrong text/chat/project is an explicit conflict.

Content/project conflicts commit an immutable `outcome: "conflict"` receipt and
original manifest and return **409**, for example `conflicts:
[{requestId: "...", fields: ["text"]}]`. No rows from that manifest are partially
adopted, no reservations are added from it, and `decisions` is empty. The source
content remains retrievable as conflict evidence; it is not silently overwritten,
bound, displayed as accepted or erased. A corrected attempt uses a new import ID;
the original conflict is retained. Malformed input/digest/schema/owner failures and
exceptions during the transaction roll back entirely without a new receipt.

Row writes, reservations, revision references, original manifest and receipt share
one supported owner transaction. Fixtures fault after prepared rows and after the
prepared receipt; both roll back all documents and allow a clean exact-ID retry.
Competing imports/Send serialize in this same owner: import-first reserves unresolved
work without execution; Send-first proves an admitted job and import references it
rather than submitting again. A disconnected importer owns no running process.

On acknowledgement loss, GET the exact import ID, or retry the same saved manifest
and ID. The HTTP fixture actually destroys the response socket **after commit** and
proves recovery of revision 1 without duplicate evidence. `outcome: imported` means
only evidence was stored, not that a request was accepted, executed or completed.

## Bounded reads, storage and recovery

History/receipt GETs use B03's count/whole-envelope-byte paginator: default count
50 (1–200), bytes 262144 (1024–1048576). Receipt GET returns one item containing
`manifest` and `receipt`; it may fail 413 if the requested byte bound cannot fit.
History GET permits `limit`, `maxBytes`, `token`; receipt GET only `limit`, `maxBytes`.
Use URL-encoded JSON `next` tokens, never integer-only offsets.

History envelopes include version/owner/conversation, pinned `revision`,
`readOnly: true`, `executionAuthority: false`, proved project ID or null, `items`,
and `next`. Items are either `kind: evidence` with original row/provenance,
classification, non-actionable flags and historical display messages, or
`kind: import` with the immutable receipt. Backend references have no messages.
Messages keep the stable role-qualified IDs derived from the original request ID.
Apply/deduplicate by those IDs, not by appending each page to the visible chat.

`history-page` tokens bind owner/chat/schema/revision/offset. Continuation pins
immutable references even during later imports; duplicated pages are identical.
Foreign/wrong-schema tokens fail 409, malformed/future offsets/revisions 400,
unknown evidence/import 404, oversized item/envelope 413. Nothing is silently
skipped. No pruning or cumulative-history quota is added by this step; bounds are
per manifest/read, not a claim of bounded total retained disk usage.

New document kinds (all version 1, same root/session scope):

- `pocket.history-index`: stable owner and conversation/request/import inventory.
- `pocket.history-chats`: per-chat revision/immutable reference inventory and
  non-authoritative project claim for conflict detection, never a Binding.
- `pocket.history-rows`: first adopted immutable source row and classification,
  keyed by original request ID; not an executable job/run.
- `pocket.history-imports`: original manifest, acknowledgement and receipt checksum,
  keyed by import ID, including conflicts.
- `pocket.history-versions`: retained pinned per-chat row/receipt reference lists.

Startup initializes/validates these documents before `harness.resume`, using the
existing owner transaction. It checks manifests/digests, owner/reference identity,
receipt checksums, source rows/classifications, accepted backend references, project
claims and all retained read versions. Corrupt/foreign/partial evidence refuses
startup; it is not silently repaired or converted to work. Existing Jobs/Reviews/
Bindings, migration evidence, task inputs, execution event sequences and Pi/session/
worktree files are unchanged by import. No private Durable SQL/table edits.

## Actual verification and limits

Changed: `bridge/src/conversation-history.js`; startup/store admission/read seams in
`store.js`; gated HTTP/health mapping in `server.js`; opt-in catalogue mapping in
`conversation-interface.js`; three new `conversation-history*.test.js` files; this
contract plus API/README/design/roadmap/progress documentation.

Executed locally:

- **13/13 new tests** (in the combined/full runs) cover the synthetic v4 inventory,
  exact IDs/order/provenance, stale backend cache, unresolved outbox, empty drafts,
  wrong content/chat/project, conflicting unproved claims, dedup/reopen/changed
  manifests, concurrent imports/Send, unexecutable reservations, fault rollback,
  real lost HTTP acknowledgement, auth/capability/schema/size/digest refusal,
  catalogue opt-in, bounded pinned history reads and fail-closed corrupted startup.
- A live **fixture** approval remains byte-identical/actionable at the owner after
  importing a cached local `done` status/dialog: no implicit reply/completion/expiry.
  Only a subsequent explicit exact B04 answer writes one RPC reply.
- **45/45 combined** B03c/B04/B05/B06 regressions passed, no failures/skips:
  `node --test test/conversation-history*.test.js test/conversation-http*.test.js
  test/conversation-reads.test.js test/approval-lifecycle.test.js
  test/approval-responses.test.js test/approval-partial.test.js` from `bridge/`.
- Full `cd bridge && npm test`: **148/148 passed**, no failures/skips.
- `python scripts/check-bridge-work.py`: **PASS**, isolated real tmux socket,
  disposable checkout/state/port/fake Pi only; numeric protocol/capability/owner,
  idle/approval/review guards, backup/reopen/exact-ID non-replay and untouched
  original fixture pane checks preserved. No production controller invocation.
- Syntax/whitespace and local Markdown file-link checks passed.

Synthetic inventory fixture bytes are unchanged, including titles/drafts/flags,
selection, pairing placeholders and saved pending review JSON/operation ID. Actual
fixture Jobs/Reviews/Bindings/task scans are equal before/after imports; an existing
real disposable review operation's accepted input/result remain identical. Original
source HEAD/staging and saved worktree manifests/dirty content/Pi fixture file bytes
are preserved. Local-only imports create no task, binding, worktree or runner call.

Logs: `$TMPDIR/b06-focused.log`, `b06-combined.log`, `b06-full.log`,
`b06-controller.log`. No production database/config access, production import,
provider action, deployment/restart, APK build/install, phone test, source commit or
push. These Node/synthetic fixtures are **not** Android SQLite upgrade/cache evidence.
B07 storage reconciliation, B08 client integration, B09 terminal and B10 cross-client
acceptance remain unimplemented. Existing local/untracked work was preserved.
