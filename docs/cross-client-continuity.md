# B10 — isolated cross-client continuity and recovery

**Complete in source/disposable fixtures — 2026-10-21. Stop before B11.**
No normal-app installation, data access, migration or launch; no visible UI tests,
production bridge operation/restart, deployment, real provider, phone-setting change,
commit or push. All pre-existing uncommitted source changes retained. This is not
production rollout, actual Pi/provider context replay or host/Doze survival evidence.

Related: [handoff](b10-handoff.md), [roadmap](next-steps.md),
[design](shared-conversation-design.md), [API](conversation-api.md),
[Android client](android-shared-conversations.md), [terminal client](terminal-conversations.md).

## Added test seams; no runtime/protocol/schema changes

One existing B08 test, `SharedConversationsTest.kt`, receives a bounded completion
wait instead of three fixed refreshes; its original assertions and behavior remain.

- `app/src/androidTest/java/dev/fantasticpimobile/CrossClientContinuityTest.kt`:
  nine headless phases using the actual `History`/SQLite, encrypted `Connection`,
  `ConversationCache` and `SharedConversations` implementation. No Activity launch.
- `scripts/check-cross-client.py`: exact APK/runner and prior-package gates,
  independent disposable owner plus real B09 terminal processes, two Git projects,
  phase orchestration and identity/preservation assertions. A previously installed
  reliability package causes refusal rather than replacement of its state.
- `bridge/test/b10-owner-fixture.js`: real locked Durable/HTTP owner, authenticated
  proxy with actual offline/socket-loss and two-request rendezvous controls. Requests
  from both clients arrive before either is forwarded in Send/approval race cases.
- `bridge/test/b10-rpc-worker.js`: separate fake RPC processes through the real
  `runPi` adapter, writing only disposable worktree dispatch/context/reply markers.
- `bridge/test/b10-recovery-fixture.js` and `cross-client-recovery.test.js`: separate
  journal seed and successive independent owner processes, supported Durable APIs,
  actual SQLite, fake RPC and injected non-provider/non-shell review executor.

New fixtures generate random private bearer credentials outside Git. Token files
and B09 configs are 0600 beneath 0700 disposable directories. The Android credential
is transferred through stdin with `adb shell run-as` into only the fixture's private
files, then saved through the real encrypted Connection. Tokens are not passed in
argv, URLs, logs, saved evidence or source. Existing B08 regressions retain their
pre-existing synthetic fixture token; no real credentials/configuration are read.

## Actual acceptance evidence

### Primary Android → terminal → Android

1. Android sends `ANDROID_A` in exact chat `b10-chat-a`, explicitly project A.
   Waits for both canonical cache and local outbox completion, persists original
   request ID/cursor, saved title/draft/pin/finish/archive state, pairing identity
   and saved review JSON/operation ID.
2. The instrumentation exits; the harness force-stops **only** the reliability
   package and checks `pidof` reports no fixture process. B09 runs in a separate
   Node process and opens the exact Android chat/run, not an Android-shaped mock.
3. Project B starts `HOLD_B` in its own chat/project/worktree. Terminal submits
   `TERMINAL_A`, then explicit detach exits 0 while that run is still running.
4. HTTP goes offline. A separate Android offline-reopen phase retains its exact
   saved SQLite evidence; it exits and is force-stopped again. Only then does the
   harness release the RPC worker. Both clients are absent, and HTTP remains offline
   until canonical completion is proved through fixture-only control metadata.
5. Android reopens in another actual process and discovers the completed terminal
   turn via catalogue/feed, retaining owner/chat/project/request IDs, two ordered
   turns/results once and empty/non-actionable approval state. The remote run is
   **not** inserted into the legacy/local outbox. Repeated refreshes retain the same
   records and cursor. B stays running independently, with its own exact project.
6. Exact explicit B Stop quiesces the owner; idle close/reopen retains stable owner,
   IDs, worktrees, branches, HEADs and manifest **bytes**. An actual HTTP snapshot
   page is applied twice to the real Android cache: the second apply reports
   `duplicate`, retaining cursor and records. This is page replay, not an invalid
   wire page containing repeated items.

Worktree markers assert `ANDROID_A\nTERMINAL_A\n` exactly once, and the second RPC
worker observes previous context **exactly `ANDROID_A\n`**. A's worktree identity is
unchanged across turns; B's path and dispatch markers are distinct. This proves
fixture context/workspace selection through the real RPC path, not a claim that
fake workers exercised provider reasoning or actual Pi transcript/session loading.

### Separate loss/race cases

- Android prepares a stable original Send ID before HTTP; the proxy drops the
  **entire accepted response after commit**. The Android process exits/is stopped.
  A new process reopens the same real SQLite database and GET-recovers that ID:
  one submission, one dispatch, one displayed turn/result, no replacement ID.
- Android and real B09 terminal Send simultaneously into an established empty chat.
  Two distinct original durable request IDs reach the rendezvous; only one job/run
  is admitted/dispatched. The other original intent is retained, not retargeted or
  replaced. Exact winner Stop does not claim the rejected intent was accepted.
- Terminal loses an accepted Send response, detaches/reopens and recovers its
  original private outbox ID by GET, with one POST/dispatch. Android discovers its
  live approval. Stopping the old completed Android run in the **same chat** leaves
  this later run running.
- Android and terminal race opposite answers to that exact owner/chat/project/run/
  occurrence. Both persisted response IDs reach the rendezvous. One wins; its HTTP
  response is actually dropped after durable claim/delivery. One RPC reply marker,
  two answer POSTs, two distinct original response IDs. Subsequent Android and
  terminal process reopen/recovery produces no extra POST or pipe reply. Pending
  state expires on completion rather than reappearing as a cached approval control.

### Independent owner/task recovery

New Node process test seeds an accepted **undispatched** task using supported
Durable transaction APIs, closes that seed process, then opens the real owner.
Original task/run/chat/project identity resumes once, with one worktree dispatch.
A new owner process reopens idle: stable owner, original task ID, same result/markers.

Separate live dispatched coding, fake review and answered-but-unfinished approval
runs persist dispatch/response evidence. The fake approval worker writes its reply
marker but deliberately never reports completion: `delivery: attempted` is not
external-effect completion. After orderly owner process exit and **two fresh owner
processes**, all three recover interrupted without replay. Assertions retain exact
task/run/review operation/project IDs, normalized review input, owner receipt,
worktree/branch/HEAD/manifest identity and marker bytes. Coding/review launch logs
and the one approval reply remain unchanged; fresh answer IDs are refused. Exact
saved review operation recovery returns its original operation, never executes again.
This is deliberately separate from terminal detach and is not a host-kill guarantee.

## Commands and results actually run

From repository root (only isolated reliability APKs built/installed):

```sh
timeout 240s env ANDROID_HOME=$HOME/.local/android-sdk ./gradlew \
  -PreliabilityTests=true \
  -Pandroid.aapt2FromMavenOverride=$HOME/.local/android-sdk/aapt2-source/build/aapt2 \
  :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug
# Also executed the same gates with --rerun-tasks: all 74 tasks executed.
timeout 300s python scripts/check-cross-client.py --serial "$SERIAL"
timeout 360s python scripts/check-android-shared.py --serial "$SERIAL"
timeout 180s python scripts/check-bridge-work.py
cd bridge
timeout 75s node --test test/cross-client-recovery.test.js
timeout 240s npm test
```

- **9/9 new actual Android process phases passed**, no failures/skips. Final private-
  credential run: `$TMPDIR/b10-cross-last-reconnected.log`, evidence directory
  `$TMPDIR/b10-evidence-gcioqy4n/` (per-phase instrumentation, original-ID snapshots,
  request/dispatch/reply counts, worktree identities and summary).
- **30/30 existing headless Android tests passed**: 19 SQLite data/migration tests
  plus 11 B08 real HTTP/cache/response-loss/review/gating regressions; no UI flag.
  Latest run: `$TMPDIR/b10-android-last-reconnected.log`, per-case evidence
  `$TMPDIR/b08-android-evidence-ei7t4m4s/`. Earlier full 30/30 also passed;
  the load-sensitive failed rerun and bounded test-wait correction are below.
- **36/36 JVM**, zero failures/errors/skips. Explicit full task rerun:
  `$TMPDIR/b10-final-build.log` (**74/74 tasks executed**, build/lint successful).
  Latest build/lint after credential transfer and bounded test-wait changes:
  `$TMPDIR/b10-build-last.log`, successful (7 executed, 67 up-to-date).
- **159/159 full bridge tests passed**, including the new recovery process test
  and all 10 B09 terminal process regressions; no failures/cancellations/skips.
  Latest full run after new fixture credential delivery:
  `$TMPDIR/b10-bridge-private-final.log` (127.8 seconds). Earlier full 159/159
  (`b10-bridge-final.log`, 124.7 seconds) and 158/158 also passed in this session.
  Focused recovery rerun **1/1 passed**, 16.9 seconds: `b10-recovery-private.log`.
- Isolated real-tmux controller **PASS**: `$TMPDIR/b10-controller.log`, numeric
  protocol/capability/owner, idle/backup/restart/exact-ID non-replay checks. Only
  disposable socket/config/state/fake worker; never the production controller.
- Syntax, whitespace, **167 local Markdown file links** and initial-source
  preservation audit passed: `$TMPDIR/b10-static-preservation.log`.

Authorized ASUS_I003D / Android 12, native Termux ADB. Initially already connected;
when its secure debugging port later changed, read-only rediscovery reconnected the
already-paired device without phone-setting/security changes (see failure 7). APK metadata
and native AAPT2 badging verified exact reliability IDs; manifest verified
`androidx.test.runner.AndroidJUnitRunner` targets only that fixture. Final installed
APK SHA-256 values:

- `dev.fantasticpimobile.reliability`:
  `d22a64048a481dd302313cf007facd33d8caab802ce41b8276a196f3fa786838`
- `dev.fantasticpimobile.reliability.test`:
  `1a6e21b34a6eac0efb964825b0f7c6c998c4adc54fc4c19b4fcb528517943daa`

Both packages were absent before every B10 install and restored absent afterward,
including failed invocations. No normal package was installed, launched or queried
for data. Fixture cleanup closes only created child owners/clients, removes only
created repositories/private credentials, and retains non-secret fixture evidence.

## Failures and corrections, not hidden by final passes

1. First primary run tried to mark the chat finished once cache completion appeared,
   while the local outbox still said running. The fixture now waits for **both**;
   no runtime lifecycle guard was loosened. `b10-cross-first.log` red, second run green.
2. Initial race extension left a proxy experiment duplicating snapshot **items**,
   an invalid envelope rightly rejected by a fresh Android cache. Existing cache
   instances had consumed feeds, so the earlier primary pass was not duplicate-page
   evidence. Removed that malformed injection and explicitly replayed the identical
   real HTTP page through Android SQLite, asserting `duplicate`/unchanged cursor.
   `b10-cross-races.log` red; `b10-cross-races2.log` passed that phase and Send race.
3. First approval-race assertion failed on the expected loser HTTP **409** because
   the test caught IO/shared-policy errors but not `BridgeException`. It now accepts
   **only 409** for that case; owner delivery/count assertions remain mandatory.
   `b10-cross-races2.log` red; `b10-cross-races3.log` all seven then-current phases green.
4. First independent recovery test compared the fake review launch file as soon as
   durable status said running, before the fake executor's marker append completed.
   Added an explicit marker condition before recording the pre-reopen evidence.
   `b10-recovery-first.log` red; second and final focused/full tests green. No
   dispatch guard, review logic or owner recovery behavior changed.
5. Final safety audit replaced new fixed synthetic fixture tokens with random
   private files/stdin transfer. Latest new Android/recovery runs passed with this
   delivery; no credential value is in checked-in B10 source or evidence.
6. Repeating existing Android regressions concurrently with the full bridge suite
   exposed `competingRemoteAdmissionRemainsDiscoverableWhileSameIdOutboxWaits`:
   after three refreshes its local result was still running, not done. Owner counts
   proved one dispatch of the original ID; fixed-refresh timing was not completion
   proof. The bounded test-only fix waits up to 50 refreshes/100 ms sleeps for local
   completion, retaining all final ID/count assertions. Failure:
   `b10-android-private-final.log`, counts in `b08-android-evidence-4omdk20w/`.
   Final 30/30 and all nine new phases pass after the fix; runtime code is unchanged.
7. A final rerun failed at `adb get-state` **before installation**: old secure ADB
   endpoint offline (`b10-android-last.log`). Native `adb mdns services` also failed
   because this ADB server does not implement that service. `android_wifi auto`
   rediscovered the already-paired secure endpoint, then all 30 + 9 headless tests
   passed. No legacy TCP/IP mode or phone setting change; no tests claimed for the
   offline attempt. Fixture package presence was absent after the preceding failed
   load-sensitive test and after both final successful harness invocations.

## Preservation and limits

Initial checkpoint: `$TMPDIR/b10-initial-preservation.json` hashes all **149**
pre-existing tracked/untracked files plus source HEAD/index identity;
`b10-initial-tracked.patch` retains the initial tracked diff. Only `PROGRESS.md`,
`docs/next-steps.md`, `docs/shared-conversation-design.md` and the bounded wait in
`SharedConversationsTest.kt` are intentionally updated existing files. Other **145**
initial files remain byte-identical, retaining earlier Android/bridge/client/
controller work. Reversing only the bounded test-wait delta reproduces the initial
`SharedConversationsTest.kt` SHA-256 exactly. Source HEAD/index identity is unchanged.
No staging/commit/push operation.
Disposable source HEAD/staging/context bytes and worktree/branch/manifest comparisons
are assertions in both new harnesses; Android pairing/drafts/organization/review
JSON comparisons are synthetic fixture assertions, **not normal-app data reads**.

No new client executor, schema/dependency/protocol migration or uncertain shared-to-
legacy fallback. Existing strict owner/schema/capability/credential and historical
inertness tests remain green. Full B09 regression covers EOF/Ctrl-C/explicit detach,
strict schema/owner refusal and historical evidence; only confirmed exact Stop can
cancel work. New process tests use orderly owner closes, not arbitrary host/disk
faults. Process loss is exact fixture force-stop/absence between phases after
intent persistence, not proof of every instruction-level crash window. No screen-
off/Doze, Termux death, all-night survival, real-provider execution, production
upgrade or deployment claim. **B10 complete in isolated fixtures; stop before B11.**
