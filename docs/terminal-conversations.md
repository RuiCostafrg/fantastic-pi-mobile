# B09 — minimal terminal HTTP attachment

**Complete in source/disposable process fixtures — 2026-10-21. Stop before B10.**
No production bridge operation/restart, normal-app installation/data access/migration,
deployment, real-provider execution, phone test, commit or push. Earlier uncommitted
work is retained. This is not an Android/terminal cross-client acceptance run.

Related: [roadmap](next-steps.md), [shared design](shared-conversation-design.md),
[HTTP contract](conversation-api.md), [history evidence](conversation-history-import.md),
[Android source/previous device evidence](android-shared-conversations.md).

## Interface and private configuration

Run with Node >=22.19.0:

```sh
node scripts/conversation-client.mjs --config "$HOME/.config/fantastic-terminal/config.json"
```

This command **only starts the client**. It does not start/check/manage a bridge
process. An independently managed, compatible HTTP owner must already exist.
The config path is not a credential. Do not put credentials into the command line,
URLs, shell history, environment/debug output or source checkout.

Create a dedicated private directory (mode **0700**) outside **every Git checkout**.
Use a private editor to create its `config.json` (mode **0600**), containing:

```json
{"endpoint":"http://127.0.0.1:8787","token":"REPLACE_IN_PRIVATE_EDITOR","pageSize":50}
```

The displayed token is a placeholder, not a functioning credential. Do not copy real
config into documentation, tests or Git. HTTP is allowed only for loopback hosts;
remote endpoints require HTTPS. Userinfo, URL paths beyond `/`, query strings,
fragments and redirects are refused. Both file/directory ownership and private
modes are checked. Final symlink files/directories are refused; resolved ancestry is
checked for `.git`, including worktree `.git` files. Token is read only from this
protected config and sent only in the Authorization header. Diagnostics use fixed
codes, never raw exceptions, URLs, headers, prompts or server error bodies.

The UI is deliberately **JSON lines**, not a full-screen Pi CLI or shell. Type one
object per line; each command emits `{ok,result}` or `{ok:false,error}`. Startup
emits `{ready:true}`. Successful results contain private transcript/approval data:
do not pipe or save stdout into public logs. Untrusted transcript text is JSON-
escaped, not executed or rendered as terminal escape sequences.

Examples (replace IDs with exact IDs from list/open; never put tokens in commands):

```json
{"command":"list"}
{"command":"open","conversationId":"existing-chat"}
{"command":"read","conversationId":"existing-chat"}
{"command":"send","conversationId":"existing-chat","text":"Continue this chat"}
{"command":"recover"}
{"command":"answer","conversationId":"existing-chat","projectId":"EXACT-PROJECT","runId":"EXACT-RUN","approvalId":"EXACT-OWNER-OCCURRENCE","answer":{"confirmed":true}}
{"command":"stop","conversationId":"existing-chat","projectId":"EXACT-PROJECT","runId":"EXACT-RUN","confirm":"EXACT-RUN"}
{"command":"detach"}
```

- `list` refreshes the complete bounded history-aware catalogue, including completed
  remote runs and historical-only chats. It never guesses a list from local jobs.
- `open` rebuilds a consistent, paginated snapshot of an **existing** executable
  chat. Historical-only chats use the evidence lane and return `readOnly:true`.
  No create/register/project picker/default-binding behavior was added.
- `read` refreshes the catalogue/history and consumes the saved exact feed cursor
  (or initially opens a snapshot). Repeat explicitly to poll; no background service,
  automatic timer, streaming or implicit selection. `open` is also the explicit
  recovery for a reset/gap/generation error. Neither command submits work.
- `send` resolves the established project from a supported fresh read. It cannot
  send to historical-only chats or import/release unresolved historical requests.
  A pending uncertain local outbox item blocks a second Send in that chat.
- `answer` requires fresh GET proof of the exact run/current occurrence. Use only
  normalized `{confirmed:boolean}`, `{value:string}` or `{cancelled:true}` answers,
  matching the live dialog method/options. Extra fields are rejected. No cached
  historical pending JSON becomes actionable.
- `stop` requires chat/project/run and an explicit confirmation **equal to that run
  ID**. It does not infer “current work”. Stopping an old terminal run is harmless
  even if a newer run is now working in the same chat.
- EOF, Ctrl-C and `detach` close only this client. They never send Stop/cancel,
  close the owner or kill a worker. EOF during a request drains that bounded request;
  Ctrl-C closes the local process/socket immediately. Uncertain intents remain saved.

## Ownership, persistence and uncertainty

`scripts/conversation-client.mjs` imports only Node filesystem/path/crypto/readline
APIs. Its network interface is HTTP `fetch`. It imports **no bridge/store/Durable/
RPC/provider module**, launches no subprocess, reads no `.env`, journal, Android
file or Pi session, and cannot become an executor or session writer.

The private config directory also contains:

- `conversation-state.json` (0600): versioned endpoint and credential hash, pinned
  stable owner, chat/project/generation records with full opaque cursors, original
  Send request IDs/text/targets, exact answer response IDs/targets/normalized answers
  and recovered receipts. It contains private history, but no bearer token.
- `conversation-client.lock` (0600): exclusive local single-writer lock. A second
  client using the same state refuses rather than racing the outbox. Use separate
  private directories for genuinely independent terminal clients.

State is written to a unique private file, fsynced, atomically renamed and followed
by directory fsync. Owner identity commits before shared requests; outbox/answer
intent commits before dispatch. Send recovery also re-persists before proceeding,
so a previous local save failure is never permission to dispatch unsaved work.
Snapshot records/cursor adopt together only after the entire pinned read; interrupted
snapshots restart without advancing a cursor. Feed records and each continuation
cursor commit together. Stable record/message IDs upsert revisions, not extra cards.
Repeated pages/replayed feed do not create turns or send requests.

Every command preflights numeric protocol **6**, literal core/project/history
capabilities, numeric event/history schema **1**, UUID owner, and pins endpoint plus
credential identity. Every HTTP request carries schema/owner/history headers;
server transactional checks remain final authority. Owner replacement, credential/
endpoint changes, downgrade, unknown schemas, foreign tokens/pages, missing event
sequences, conflicting same-revision bodies and invalid targets fail closed. Tokens
are retained whole, not synthesized from sequence numbers. Pages/continuations are
checked for scope, kind, high-water/upper bounds, order and loops. Reads enforce a
1 MiB response limit. **There is no legacy transport or fallback path at all.**

`recover` GETs an uncertain Send's **original request ID** first. Only an explicit
404 allows POST of that original saved body/ID; other errors remain uncertain.
An accepted job must match ID/chat/project/text. A lost approval response is recovered
from the exact run's canonical `approvalResponse` only when its original response ID,
owner/chat/project/run/occurrence/answer all match. Recovery never POSTs an answer
again or invents a replacement response ID. `unknown`/`attempted` delivery receipts
are not proof of an external effect; the owner keeps its non-replay authority.
Historical evidence preserves classification/order/provenance and is always inert.

## Actual verification

Added `bridge/test/terminal-client.test.js`: **10/10 process tests passed**, zero
failures/skips/cancellations. Each uses a fresh disposable Git checkout, an independent
Node/Durable/HTTP owner process with injected **fake execution**, separate client
processes/private directories, and real HTTP socket loss or boundary mutation.
The existing `android-shared-fixture.js` is reused only as a disposable Node owner;
no Android runtime/app/device is involved. New test-runner proxies exist only inside
the disposable fixture lifetime. Original disposable checkout staging is compared
before/after. All fixtures are removed in cleanup; no production paths/config read.

Coverage:

1. Discover a remote **completed** run with no local jobs, open/reopen it once,
   stable transcript and persisted private cursor, owner and 0600 state.
2. Real lost Send acceptance after admission: exit/reopen, GET exact original ID,
   one POST/one dispatch and two ordered turns in the same established chat.
3. Two independent terminal processes race opposite exact approvals: one owner
   pipe attempt, winner's HTTP response actually dropped, original-ID receipt
   recovery after reopen and no answer replay.
4. Missing/wrong Stop confirmation, cross-chat refusal, exact cancellation, active
   other chat preserved, harmless old Stop while a **later same-chat** run remains
   running. EOF after terminal Send, Ctrl-C and explicit detach do not cancel work.
5. Old protocol/changed owner/unknown event schema/foreign page/malformed feed
   cursor retain saved outbox/cursor; no fallback/new POST. The proxy inspects the
   real client's saved owner/outbox ID **before** forwarding Send.
6. Multi-page snapshots/feed (`pageSize:1`), duplicate snapshot items, repeated
   opens, and replay after restoring only this disposable client's pre-commit
   state; records upsert once and no duplicate Send.
7. Synthetic Android-v4 historical and unresolved-outbox evidence shown distinctly;
   no executable snapshot, Send, cached approval answer or job dispatch.
8. Exact normalized approval intent inspected on disk **before** HTTP dispatch;
   non-normalized answer refused, actual lost response, reopen GET recovery only.
9. Real pre-admission socket loss: original durable ID survives exit, exact GET
   404 then one admitted POST/dispatch, never a replacement request ID.
10. Concurrent local state writer refuses without deleting the first lock; unsafe
    config permissions refuse with no credential/path disclosure in diagnostics.

Executed:

```sh
cd bridge
# Entire existing suite plus the 10 B09 tests; disposable fixtures/fake workers only.
timeout 180s npm test
# Final client-specific rerun after tightening validation and persistence checks:
timeout 115s node --test test/terminal-client.test.js
```

Full suite: **158/158 passed**, zero failures/skips/cancellations (repeated full
runs; final run after the page-rollback fix: **112.7 seconds**). Final focused rerun:
**10/10 passed** (48.7 seconds). Syntax, whitespace and **91 local Markdown file
links passed**. No fixture/client processes remained; three abandoned disposable
directories from the interrupted detach probes were removed after that check. Logs:
`$TMPDIR/b09-full.log`, `$TMPDIR/b09-full-final.log`, `$TMPDIR/b09-terminal-final.log`.
No new dependency, server/source protocol/schema, Android or controller change.
No Android build/test or real-tmux controller rerun needed/claimed for this step.

### Failures found, not hidden by final passes

- Initial 0/4 client tests: executable chats without history have no history page
  (404). Fetch history only when the catalogue advertises evidence; no legacy fallback.
- Initial expanded detach test hung: leaving the JSON-lines loop had not destroyed
  the stdin stream. Explicit detach now destroys stdin. Two bounded 30/40-second
  reproductions and the earlier aborted tool run are recorded in
  `b09-stop-debug{,2}.log` / `b09-terminal-second.log`. All detach tests then passed.
  Each new process test now has a 20-second deadline; suite commands have external
  deadlines too. This was a client detach bug, not backend cancellation or work loss.
- Final page-rollback audit found that a later feed continuation could mutate the
  in-memory object of an already committed page before cursor validation. A
  deliberately malformed second page reproduced leaked `running` revision evidence
  on the next preflight save (**red**: `b09-page-rollback-red.log`). Clone the working
  page before validating each continuation; rejected records/cursor now leave the
  previous committed page unchanged, including after the next command (**green**:
  final 10/10). No production data was involved.
- Expanded 9/10 test run: pre-admission recovery asserted worker dispatch immediately
  after durable admission (which is not dispatch proof). Wait for the fake canonical
  completion before counting the dispatch; no runtime execution change.

## Explicit limits / next boundary

- This is a small JSON-lines client for already-bound chats, not a full-screen TUI,
  Pi extension, new chat/project registration, history importer, review executor,
  background watcher, migration tool or destructive owner-reconciliation UI.
- Cursor reset/gap/generation errors need explicit `open`; owner/credential/endpoint
  conflicts require operator reconciliation. Do not delete state or reset an owner
  pin to make uncertain work dispatch elsewhere.
- A saved approval intent is permanently non-replayable here even if HTTP never
  began. If its receipt is no longer exposed on the current job (e.g. a later
  occurrence replaced that evidence), recovery remains blocked, not replayed.
- SIGKILL/host death can leave the local lock or a private temporary write file.
  There is deliberately no automatic stale-lock takeover. Verify the original
  client is absent before manually removing **only its local lock**; retain state.
  Client-state filesystem failures fail closed, not a claim of arbitrary disk-fault
  tolerance. No pruning or total retained-history disk quota was added.
- Tests prove separate terminal/owner processes and fake-worker behavior, not real
  provider tool effects, Pi context replay, Android cache/process lifecycle, actual
  Android↔terminal continuity, screen-off/Doze or host survival. Those B10/B11 gates
  remain separate and **were not started**. Source remains local/uncommitted/unpushed.
