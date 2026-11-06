# B08 — foreground Android shared-conversation reconciliation

**Complete in source and isolated device fixtures — 2026-10-21. Stop before B09.**
The user authorized B08 and a final live phone check. The announced phone check used
only the isolated reliability app and disposable real Node/Durable/HTTP owners with
fake coding execution plus one harmless real `printf B08_REVIEW_OK` review test
command in a disposable worktree, not the normal app or production bridge. No normal installation,
normal-data access/migration, deployment, production bridge operation, real provider,
commit or push. Existing uncommitted/untracked work retained.

Related: [roadmap](next-steps.md), [design](shared-conversation-design.md),
[B05 HTTP](conversation-api.md), [B06 historical evidence](conversation-history-import.md),
[B07 cache and real SQLite evidence](android-conversation-cache.md).

## Interfaces and write boundary

- `SharedConversationPolicy.kt`: strict capability/owner/catalogue validation,
  canonical run presentation, bounded manifests and exact answer receipt validation.
- `SharedConversations.kt`: foreground coordinator over real `History`,
  `ConversationCache` and injected HTTP. No provider/executor, Activity dependency,
  journal access, second owner or background service. The HTTP seam is shared by
  actual Activities and headless data tests, not a separate mocked implementation.
- `MainActivity.kt`: foreground/connection refresh, remote discovery and native
  transcript/drawer projection, shared Send/exact approval/Stop. Old bridge mode
  keeps supported existing behavior, but not for shared-marked uncertain work.
- `ChangesActivity.kt`: owner-gated existing review reads/action/recovery transport;
  saved operation JSON stays unchanged. No new repository action API or execution.
- `Connection.kt`: frozen endpoint plus encrypted-credential identity, shared
  headers and fixed-length POST streaming (no hidden buffered POST retry).
- `History.kt`: new remote session identities may receive initial local organization
  and proved project bindings. Existing title/draft/pin/finish/archive flags stay
  untouched. Remote turns are **not** inserted as local jobs. `Job` can carry the
  current owner occurrence ID in the read projection; legacy SQLite columns did
  not change. `SessionDrawer.kt` surfaces archived/finished chats with remote active
  work without clearing their saved flags. `ProjectPicker.kt` also invalidates
  same-URL credential changes across its request chain.

Database helper remains **schema 5**. No B08 schema upgrade or new table: coordinator
metadata uses separate logical lanes in the B07 cache table under the reserved
non-wire `android-client` namespace. Wire owners remain UUIDs and cannot overlap it.
Endpoint keys are hashes, not credentials. Lanes retain endpoint owner pins,
validated catalogue entries, original shared Send targets, stable export IDs,
answer intents/receipts and shared review operation targets. B07 cache/conflict
transactions and inert evidence semantics remain unchanged.

Local request creation + shared target identity commit together, before HTTP.
Existing local jobs can receive an exact-ID accepted response through the existing
transactional `History.acceptResponse`; remote-only turns remain cache records.
Existing chats/projects cannot be rebound to conflicting evidence. Only newly
created remote session rows get fallback titles. Drafts and selected-chat preference
are never taken from remote callbacks; discovering another chat never selects it.
Pending review JSON/operation IDs and encrypted pairing preferences are not rewritten.

## Reconciliation and action rules

1. Require authenticated numeric protocol 6, literal core/project/history
   capabilities, event/history schema 1 and UUID owner. A first supported old
   protocol 3–5 can use legacy mode; malformed/shared capability claims fail closed.
   Pin the first shared owner per endpoint. A changed owner or downgrade after a
   pin requires explicit reconciliation, never automatic re-adoption or Send.
2. Freeze endpoint/credential identity and lifecycle generation. Check before and
   after each HTTP call and under the commit lock before local application. Stop/
   background invalidates live proofs and dialogs, not backend work. Old legacy
   callbacks/dispatch chains cannot continue after switching to shared mode.
3. Read the history-aware bounded catalogue on every refresh, not just active local
   requests. Validate owner/schema, keyset order, continuation and project proof.
   Discover empty, completed and remote-active executable chats. Historical-only
   entries get history reads, never a fake executable snapshot or project fallback.
4. Use exact saved snapshot/feed/history tokens. Resume incomplete pinned reads;
   use feed cursors only after complete snapshots. Apply each page/cursor through
   B07's transaction. Reset/gap cases can rebuild from a supported fresh snapshot;
   unknown schemas and identity/content conflicts never partially advance. Keep
   original conflicting local/remote evidence. No pruning or truncation added.
5. Export legacy local evidence in ordered batches of at most 100 rows/65536 UTF-8
   bytes. Persist exact manifest/digest/import ID before POST. Recover a lost receipt
   by GET of that original ID. Durable conflict receipts remain blocked across
   reopen. Imported pending/unknown rows are never submitted by reconciliation;
   cached approval JSON stays inert. Definitely rejected local rows stay local
   (the history wire contract has no `rejected` status). Backend references suppress
   duplicate display cards; canonical status wins over older local evidence.
6. Preserve canonical turn ordinals and one result card per run across revisions.
   Keep unmatched local/historical cards explicitly historical/unresolved/read-only;
   do not invent a total chronology between separate historical and execution lanes.
   Remote activity surfaces in the main drawer even for saved archived chats; known
   active work blocks lifecycle changes. A historical-only/unproved chat cannot Send.
7. Shared Send saves request ID + owner/endpoint/chat/project/text with the local
   outbox row before dispatch. Recover GET by exact ID before any same-ID POST.
   Shared markers never fall back to legacy, including after re-pairing/downgrade.
   Admission 409/429 preserves that ID and still refreshes remote activity. A remote
   run takes precedence over a waiting local outbox item as the Stop target. Text/
   project conflicts are not accepted as the local request's response.
8. Approval controls require a recently refreshed canonical run (10-second bounded
   proof), exact occurrence/pending identity and no prior local intent. Re-preflight
   and GET the exact run before action. Save response ID/answer before POST. Any
   saved/uncertain attempt suppresses another answer/new ID; recover the exact
   owner receipt from later canonical `approvalResponse` evidence without replay.
   Server B04 live-sender/occurrence serialization remains final authority.
9. Stop re-preflights and verifies the exact current owner/chat/project/run, then
   uses shared cancel headers/body. It never targets an unresolved historical row
   or cancels on detach. Existing review operation IDs gain supplemental owner/
   endpoint markers before shared POST; GET recovery and cancel validate those
   markers too, without changing original saved JSON.

## Test seams agreed with the user

- Host client-policy boundary: capabilities/owner refusal, catalogue schema/order/
  unproved execution and ordered bounded original-ID export.
- Real Android SQLite + real disposable HTTP/Durable owner: not Robolectric or a
  host database substitute. Lifecycle, credential and malformed-page injections
  occur at the HTTP boundary around actual responses.
- Real native fixture Activity: accessibility-driven interactions with actual
  `MainActivity`, real SQLite/HTTP and disposable fake-execution owner. Legacy
  picker/status regressions use their existing explicit loopback fixtures.

## Actual results

**36/36 JVM tests**, zero failures/errors/skips: 3 new policy tests plus prior 33.
An explicit `:app:testDebugUnitTest --rerun-tasks` executed all 22 Gradle tasks;
normal/fixture build passes also ran or checked the unit task. JUnit XML is under
`app/build/test-results/testDebugUnitTest/`.

Normal **and** `-PreliabilityTests=true` builds passed:

```sh
ANDROID_HOME=$HOME/.local/android-sdk ./gradlew \
  -Pandroid.aapt2FromMavenOverride=$HOME/.local/android-sdk/aapt2-source/build/aapt2 \
  :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug
# Repeat with -PreliabilityTests=true; normal APKs are compiled, NEVER installed.
```

**148/148 bridge tests passed**, zero failures/skips (`cd bridge && npm test`).
`python scripts/check-bridge-work.py` **PASS**, only its isolated tmux socket,
throwaway checkout/config/state and fake worker: owner/idle/backup/restart,
exact-ID non-replay and untouched fixture pane. No production controller operation.

Authorized ASUS_I003D rediscovered over secure Wireless debugging, native Termux
ADB, Android 12. Screen readiness checked for the announced UI run. ADBKeyboard
was installed but inactive; its preflight warning was irrelevant to accessibility
and native fixture text entry. Gboard/IME and all phone settings stayed unchanged.

```sh
python scripts/check-android-shared.py --serial "$SERIAL" --ui
```

**Final full run: 35/35 Android tests passed, no failures/skips**:

| Classes | Count | Actual boundary |
| --- | ---: | --- |
| ConversationCacheTest, HistoryTest, ProjectHistoryTest | 19 | Existing Android SQLite upgrade/rollback/reopen/data regressions |
| SharedConversationsTest (each method against a fresh owner) | 11 | Actual SQLite + real HTTP/Durable + malformed/stale boundary injections |
| SharedConversationsUiTest | 1 | Native discovery/Send/approval/Stop/reopen and preservation |
| ProjectPickerUiTest | 3 | Existing legacy picker, persistence/locking and capability errors |
| LiveStatusUiTest | 1 | Legacy cached-approval checking/unavailable/fresh/interrupted behavior |

Headless cases prove completed remote discovery, archived activity without changed
organization, lost acceptance/import/approval responses, exact-ID reopen recovery,
no local-only execution or duplicate cards/dispatch, wrong/downgraded owner and
same-URL re-pairing refusal, stale callback non-adoption, unknown-schema cursor
retention/recovery, both-side semantic conflict retention, competing remote/local
admission, exact Stop isolation and immutable import conflict persistence. The
additional review case saves original operation JSON, really loses the accepted
action response, reopens and recovers the exact operation ID/result with one POST,
exit 0/output `B08_REVIEW_OK` and byte-identical saved JSON; no new operation ID or
resubmission is needed.

Visible B08 flow passed repeatedly: selected a remote completed chat/result once,
reopened with the same selection/result, returned to a preserved local draft and
sent a harmless request via native Send, found the active archived remote chat in
the main drawer, stopped exactly that run, selected/answered the fixture approval
with its response really dropped after owner delivery, and reopened with the result
once. Preserved synthetic pairing identity, draft/title/pin/finish/archive flags,
original local IDs and unrelated saved review operation JSON. These are fixture
assertions, **not a comparison/read of normal app data**.

The harness verifies metadata + native AAPT2 APK identities and runner target before
each installation. Final installed hashes:

- `dev.fantasticpimobile.reliability`: `d22a64048a481dd302313cf007facd33d8caab802ce41b8276a196f3fa786838`.
- `dev.fantasticpimobile.reliability.test`: `9a8b09d49e35f4ffe961df0651508be251085182d8c6ba41a4283060bca8b965`.

Both fixture packages were absent before this session and installed only for tests.
Harness `finally` restores each invocation's prior package presence. After the
installation timeout/retry, the final follow-up audit found the base fixture still
present (its fixture-only install timestamps were retained); it had been absent
before the overall session, so it was explicitly uninstalled, Success. The test
package was already absent. Two fresh package queries five seconds apart confirmed
both absent; `$TMPDIR/b08-final-cleanup.log` records the final removal/checks. No
normal package was queried for data or removed. Source HEAD/
staging in every disposable repository matched before/after. Fixture owner metadata
asserts unique dispatches/replies, no imported `old-*` dispatch, one actual POST for
the lost-acceptance case and one import for lost-ack recovery. No normal Activity
was launched, normal history read, production journal/config opened or provider run.

## Failures found and corrected (not hidden by final passes)

- First policy seam was red for missing implementation, then green; catalogue/
  export additions likewise had a red compilation gate before implementation.
- Actual lost-acceptance run unexpectedly appeared successful. A focused rerun
  recorded **two HTTP submissions with the same ID but one backend dispatch**:
  Android transparently retried the buffered POST. Fixed-length streaming stopped
  hidden retries. The proxy now proves an actual dropped response, explicit
  recovery, one POST and one dispatch with the original persisted ID.
- Semantic conflict regression was red for missing both-side retained evidence.
  Coordinator had wrapped the cache's rollback-and-retain operation in an outer
  SQLite transaction, rolling retained conflicts back too. Removed that wrapper;
  cache still owns atomic page/cursor transactions, and real SQLite regression passes.
- Competing admission regression was red: same-chat busy returns 409, while global
  capacity/review pause returns 429. Both now preserve the original outbox ID while
  allowing remote catalogue refresh and exact remote Stop, without treating every
  conflict as permission to submit a new request.
- Initial visible test timed out looking for case-sensitive `Allow`; Android's
  dialog accessibility label was uppercase. Case-insensitive fixture lookup fixed
  the test, not runtime approval checks. Full visible flow then passed repeatedly.
- Existing legacy status fixture lacked health metadata and held only the job GET.
  Added explicit protocol-4 fixture health and gated preflight as well, so CHECKING
  is a deterministic assertion rather than a transient accessibility timing race.
  Runtime still fails closed on malformed health. Final legacy UI regression passed.
- A final repetition timed out during streamed ADB installation before any tests.
  Its cleanup then tried uninstalling a test package that had never been installed.
  Fresh secure rediscovery/package queries confirmed both fixtures absent. Harness
  now checks actual presence and attempts cleanup independently for each initially
  absent package, and uses ADB `install --no-streaming`. Full 35-test retry passed.
  A subsequent overall-session presence audit removed the remaining base fixture
  rather than treating per-invocation preservation as final session cleanup (see
  above). Root cause of the one ADB timeout remains unknown, not an app failure.

## Evidence and limits

Final device artifacts: `$TMPDIR/b08-android-evidence-dlaqkvbf/` (per-class/method
runner logs and owner dispatch/import/drop counts); summary `$TMPDIR/b08-final-device.log`.
Other logs: `$TMPDIR/b08-final-{normal,fixture,jvm}.log`, `b08-bridge.log`,
`b08-controller.log`, `b08-policy-{red,green}.log`, `b08-catalogue-{red,green}.log`,
`b08-loss-repro.log`, `b08-conflict-{red,green}.log`, `b08-busy-{red,green}.log`,
`b08-live-{first,second}.log`, `b08-legacy-ui-final.log`.
Additional logs: `b08-review-{red,green}.log`, `b08-install-timeout.log`.
Static syntax/whitespace and **103 local Markdown file links passed**. Hash comparison
verified **124 pre-existing out-of-scope source files byte-identical** to the prior
verification snapshot; original unrelated bridge/controller/README work preserved.

This is **not** normal-app deployment/migration, a real-provider smoke, terminal
attachment/B09, B10 cross-client process-death proof, screen-off/Doze/host-death or
all-night survival evidence. Foreground refresh can be slow for large catalogues;
there is no background sync/service or cache pruning. Oversized single legacy rows
fail visibly rather than truncate; owner/import conflicts remain blocked pending
explicit reconciliation, not an automatic destructive reset. An uncertain saved
answer stays non-replayable even if the client cannot prove whether HTTP began.
Original local storage is preserved; backend cache adoption is not an assertion
that arbitrary Android historical claims are true. B09 and production rollout
remain separate later scopes. **Stop before B09.**
