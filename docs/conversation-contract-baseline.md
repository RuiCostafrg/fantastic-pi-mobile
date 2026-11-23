# B01 — conversation contract characterization baseline

Status: **complete — 2026-10-20**. This is fixture/source evidence, not a production
inventory or an implementation of the shared core. Design:
[shared-conversation-design.md](shared-conversation-design.md). B02 is now complete:
[storage/migration evidence](conversation-baseline-storage.md). Next: **B03 only**
in [next-steps.md](next-steps.md), when requested.

## Test seam and isolation

`bridge/test/conversation-contract.test.js` exercises the existing `openStore` and
HTTP interface. It uses real Durable SQLite, project/binding/worktree modules,
loopback HTTP servers on ephemeral ports, Git repositories and RPC child processes.
The only substituted external executor is the existing deterministic `fake-pi.js`
peer; no provider, phone or production bridge is involved. Repository-action
uncertainty uses one real harmless shell marker in a disposable worktree.

Every case creates its own temporary source/state directory. Git fixture commits
initialize only those disposable repositories; there is no project commit/push.
Each case preserves/asserts source HEAD, unrelated staged diff/content, a real
manifest-only binding, its exact manifest bytes and its dirty worktree file. Cleanup
closes only fixture servers/stores/children and deletes only its temporary directory.
Tests never read `.env`, `bridge/data`, Android app storage or a production journal.

The fixture seam and limits were selected in B01: characterize current behavior,
not proposed schemas or future interface behavior. No test opens a second harness
or queries Durable's private tables. Task inputs/legacy undispatched recovery have
existing lower-level coverage in `bindings.test.js`; this new suite verifies public
job/operation `taskId` stability without depending on journal table layout.

## Executed characterization cases

| Case | Current observable contract | Future regression/comparison |
| --- | --- | --- |
| Legacy/concurrent acceptance | Omitted chat means exact `pocket`; project/task identity preserved; simultaneous same request returns one task; different content/chat/project conflicts; same-chat different IDs admit one winner, loser has no record/binding; retries/reopen never redispatch accepted work. | B02/B03 must preserve exact IDs, binding, admission and dispatch count while adding projection/events. |
| Equal raw dialogs/Stop | Separate runs can both have raw `dialog`; bad ID/type rejected; Stop B clears B but leaves A pending; answer A completes only A; next A turn uses same worktree/branch and `pocket-chat-a` Pi session. A sequential duplicate legacy reply expires (409), not a durable response receipt. | B04 adds occurrence identity/receipts and racing-answer serialization. Current test does not claim two-client approval safety. |
| Pending dialog at reopen | Close/reopen marks dispatched run interrupted with pending null, same task/project/workspace and dirty effect; stale answer fails; second reopen and accepted-ID retry do not dispatch again. | B02–B04 must not revive cached approvals or infer external delivery/success. Orderly fixture close is not abrupt host-death evidence. |
| Repository operation | Saved operation JSON/ID is retryable with same task/project/revision/command; changed command/wrong chat conflicts; real shell writes one marker, then owner closes mid-action; reopen returns interrupted/not replayed, same operation and no second marker. | B03/B06–B08 must preserve operation references and exact saved JSON; import/events cannot create another action or erase uncertainty. |
| Mixed history inventory | Backend completed run differs from Android stale cached status/dialog; another completed backend turn is absent from local jobs; Android-only historical and sending IDs remain absent from backend; selected local draft and unresolved projects do not acquire bindings; binding-only chat has no job but retains a proved project. | B02 inventory cannot depend only on jobs; B06 import cannot create execution; B07/B08 must reconcile completed remote turns and preserve local evidence. |

`taskId` is currently a **positive numeric Durable ID**, distinct from the opaque
string request/operation IDs. The first focused test incorrectly assumed a string
and failed; corrected the assertion to characterize actual behavior. No runtime
fix was made. Future schemas must not stringify/replace existing execution identity
accidentally or expose it as the canonical client run ID.

The RPC tests verify the exact `--session-dir` in the disposable state directory
and the literal mappings `pocket`, `pocket-chat-a`, `pocket-chat-b`. They do not
claim real-provider context recall: `fake-pi.js` does not persist a model transcript.
Milestone A lifecycle evidence is separate; cross-client actual Android testing is B10.

## Synthetic Android v4 comparison inventory

Fixture: `bridge/test/fixtures/conversation-history-v4.json`. This is JSON describing
SQLite row/preference shapes from `History.kt`, not an Android SQLite database.
`sourceRowid` is extra comparison evidence, not a proposed new jobs column. Times,
contents, preference values and IDs are synthetic. Connection token/IV values are
explicitly invalid placeholders: no Keystore encryption/pairing test is claimed.

| Evidence | Authority now | Absent/uncertain | Preserve / later assertion |
| --- | --- | --- | --- |
| `shared-chat` / `b01-shared-job` | Backend get proves done, actual project, result, no pending; local row has older answer/status/dialog and unresolved project. | Android cached dialog is not live proof. | Same request/session IDs; later adoption replaces projection state, not by sending again. Original local conflict evidence remains available. |
| `b01-backend-only` | Existing store has a done turn in `shared-chat`. | Android JSON has no row and no active poll target for it. | Catalogue/snapshot/event reconciliation discovers it exactly once; active-job polling alone is insufficient. |
| `binding-only` | A real legacy manifest/tree seeded before store open is mapped by existing binding migration. | There is no job/task for this chat. | B02 includes it without creating a tree or executing work; manifest/path/branch/dirty content remain exact. |
| `history-only` | Android display evidence only; archived/finished, original title and draft. | No backend jobs/binding/project proof. | Keep two historical request IDs/text/answers, flags and draft; import is display-only and cannot assign today's default project. |
| Equal-time historical rows | Local `created=1200`, `sourceRowid=12/13`: `history-z-first` before `history-a-second`. | Backend has no accepted timestamps/order; lexical ID order is the reverse. | Retain source ordinal/order evidence. B02's reconstructed backend order is not permission to silently reorder local history in B06/B07. Explicit comparison/resolution is required. |
| `uncertain-chat` / `b01-local-uncertain` | Saved local request ID/text, status `sending`, unresolved project. | Backend GET is absent in this fixture; neither acceptance nor an external effect is proved. | Keep unresolved outbox ID; import cannot mark accepted/done or call Send. A 404 alone must not retarget it to a new/default owner. |
| `pocket` / `b01-legacy-interrupted` | Historical interrupted local record. | This fixture has no backend accepted job or proved binding. | Literal legacy ID, text and interruption survive; not replayed or rebound. |
| `selected-draft` | Local SELECTED project ID and unsent draft; no jobs. | Backend has no binding and may not recognize the synthetic selected project. | Preserve selected ID/text; inventory is not authorization to register/bind/send. |
| `review-requests/pending-shared-chat` | Exact legacy JSON, `b01-saved-review`, snapshot revision and command, no project field. | Backend operation absent; dispatch/acceptance unknown. | Preserve original string/operation ID; prove target before any separately authorized retry, enrich transport copy only. Import is not retry. |
| `chat-ui`, connection preferences | Local selected archived chat and synthetic pairing-shape bytes. | No real encryption/decryption/device evidence. | B07 actual fixture database/prefs tests must retain selection/pairing and drafts; JSON round-trip is not proof of Android upgrade safety. |

Runtime fixtures produce actual saved Jobs/Reviews/Bindings through existing public
writes/reopen, rather than seed guessed private document/table encodings. Static
Android evidence remains untouched and never enters an import/Send path. The tests
compare its identities/absence with runtime store reads; there is no new import
implementation. Future B02/B06 tests should reuse this comparison vocabulary but
must exercise real migration/import interfaces once they exist.

## Verification performed

From the repository:

```sh
cd bridge
node --test test/conversation-contract.test.js
npm test
```

- Focused suite: **5/5 passed**, zero failures/skips; ~16.95 seconds.
- Full bridge suite: **74/74 passed**, zero failures/skips; ~70.78 seconds
  (previous 69 + 5 new characterization cases).
- Initial test-only numeric-task-ID assumption failed, then corrected and rerun.
  Earlier focused slices passed 1/1, 2/2 and 4/4 before the full 5-case run.
- Logs: `$TMPDIR/b01-focused-initial.log`, `b01-focused-first.log`,
  `b01-focused-dialog.log`, `b01-focused-recovery.log`, `b01-focused.log`,
  `b01-bridge-suite.log` (all relative to `$TMPDIR`).

No Android build/instrumentation or standalone tmux harness was run. No production
readiness/idle claim is made; production was not probed, opened or restarted.
No core storage schema, task behavior, route, protocol, Android behavior, deployment
or private-state migration changed. All work remains local/uncommitted/unpushed.

B02's backend baseline storage was subsequently implemented/verified separately;
see [B02 evidence](conversation-baseline-storage.md). Remaining work starts with
B03's live transition/event atomicity. Response receipts, shared HTTP attachment/
import, Android reconciliation, terminal client and true cross-client acceptance
are deliberately **not implemented/proved** by these characterization tests.
