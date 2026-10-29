# B07 — additive Android conversation cache and outbox evidence

**B07 complete in source and isolated Android SQLite fixtures — 2026-10-21.
Stop before B08 at that checkpoint.** The separately authorized verification ran only headless
`ConversationCacheTest`, `HistoryTest` and `ProjectHistoryTest`: **19/19 passed**,
zero failures/skips. Only verified isolated fixture APKs were installed, then removed
because both packages were absent before this session. No Activity/client rollout,
normal-app installation/data access/migration, production bridge operation,
deployment, provider work, visible UI test, commit or push occurred.

Later **B08 is complete in source/isolated fixtures**: foreground/client integration,
35/35 Android tests including an announced live fixture UI check. No normal rollout;
**stop before B09**. [B08 contract, commands and evidence](android-shared-conversations.md).
The B07 storage boundary and checkpoint below remain historical evidence.

Related: [design](shared-conversation-design.md), [B05 wire contract](conversation-api.md),
[B06 history contract](conversation-history-import.md), [roadmap](next-steps.md).

## Storage boundary

`History.kt` advances its SQLite helper from **4 to 5**. Creation and the additive
`oldVersion < 5` upgrade add only two tables:

- `conversation_cache(owner, chat, lane, key, body)`, primary key
  `(owner, chat, lane, key)`;
- `conversation_cache_conflicts(owner, chat, digest, body)`, primary key
  `(owner, chat, digest)`.

There is no rewrite, renumbering, deletion, backfill or recreation of the existing
`sessions`/`jobs` tables in the v4→v5 step. Earlier supported v1/v2/v3 upgrades still
use the existing ordered migrations before adding these tables. SQLiteOpenHelper's
upgrade transaction covers the schema/version change. No local row is automatically
assigned an owner or marked accepted/imported by upgrading or reopening.

`ConversationCache.kt` is a separate internal headless storage adapter over the
same `History` connection. It has **no Connection, Activity, UI, provider, worktree,
preference or execution dependency**. It never calls `History.add`, `update`,
`acceptResponse`, project confirmation or any transport. Existing title/draft/
organization, job text/status/answer/pending/progress/ID/project/order, selection,
pairing and pending review JSON/operation IDs remain outside its write set.
There are no changes to existing automatic legacy request behavior in B07; shared
transport/lifecycle integration and its freshness/retry gates belong to B08.

The expected `Scope(ownerId, conversationId, projectId)` is explicit on each call.
Future B08 callers must derive it from authenticated capability/owner/project
preflight and freeze endpoint/visibility epochs. This storage API does not perform
network preflight or adopt a new owner at an existing URL automatically. Two owners
have separate records, receipts, cursors and links even for the same chat/request ID.
The cache retains an immutable per-owner/chat expected project scope (including
null); reads and writes cannot silently switch it. An expected selected project can
receive historical pages with no proved project; non-null claims must still agree.
A historical claim is never promoted to a proved binding. A null historical scope is not a binding or
permission to choose today's default. This step provides no scope-rebinding API.

## Logical lanes and atomic application

The version-1 B05/B06 validator is `ConversationCachePolicy.kt`. It checks numeric
schema/version/sequence fields, expected owner/chat/project and token scope/kind/
generation, stable role-qualified message IDs and source identity. It accepts
legacy `pocket` projection sources with an omitted redundant session ID or empty
answer, as the bridge does. Unknown event types and `snapshot.reset` require a
fresh snapshot; they never advance the current cursor. No partial unknown-schema
application, project fallback, token synthesis or integer-only cursor exists.

Logical lanes within the additive table:

| Lane | Purpose |
| --- | --- |
| `scope`, `project-claim` | Immutable expected scope and agreeing historical claims, neither backend binding authority |
| `page` | Canonical original successful envelopes keyed by lane/exact start token |
| `record` | Immutable original turn/review revisions (generation-scoped), history rows and receipts |
| `stage-snapshot`, `stage-history` | Incomplete pinned read; not visible as a complete transcript |
| `head`, `history-head` | Derived stable-ID views, separate execution and historical evidence |
| `state` | Full execution/history continuation tokens, pin and feed cursor |
| `outbox-evidence`, `link-evidence`, `outbox-link` | Original local request snapshots and inert comparisons using existing IDs |
| `manifest`, `import-inventory`, `ack` | Exact saved bounded export, original local inventory and immutable acknowledgement by original import ID |

`apply(scope, lane, envelope, requestedToken)` handles snapshots, feed pages and
history pages. It copies input before validation. The entire page is validated
before a SQLite transaction adopts it. The transaction compares local project and
request identity, retains immutable bodies, upserts derived stable-ID heads/links,
and saves the continuation/cursor together. A fault before commit rolls everything
back. Storage exceptions remain errors, not a successful adoption.

- Snapshot continuations must equal the previously saved `next`. Records stage
  until the final page, when the complete view and high-water `after` cursor become
  visible together. Existing complete heads may remain visible while refreshing,
  but are always inert evidence. Turn/review ordinals must be complete and unique.
- Feed pages must start at the saved cursor/continuation, contain contiguous event
  sequences and respect their pinned upper bound. Revisions update one run/result
  card rather than appending messages. Each page commits its heads and `after`/
  `next` atomically. A partial snapshot cannot be followed by feed adoption.
- History pages have a separate pinned revision/token and separate heads/state;
  they cannot install an executable snapshot or feed cursor. Backend references
  have no duplicate display messages. Historical source ordinals/provenance and
  original pending strings remain in immutable evidence.
- Exact repeated pages are successful no-ops, even after reopen. Changed content
  for an already saved page or immutable record, changed run text/review input,
  wrong local request chat/text/project, gaps and rewinds are rejected. Existing
  accepted evidence and cursor remain unchanged.
- A rejected envelope/manifest/receipt is retained with its reason and the local
  inventory at rejection in the conflicts table, **after** rolling back any prepared
  adoption. Repeated identical rejection is idempotent. Nothing is silently merged
  into accepted heads or erased. Retained pages/revisions also preserve superseded
  cache evidence; this step adds no pruning or total-disk quota.

Every returned `Evidence` and outbox link explicitly reports `actionable: false`
and `executionAuthority: false`. Raw source pending JSON/approval occurrence IDs
remain uninterpreted private history, not controls. No fresh-live-approval proof,
approval response ID, Send payload or retry permission can be obtained here.

## Imports and stable outbox IDs

`saveImport` validates the bounded B06 manifest/schema/provenance/digest and compares
its rows to the existing local request inventory, then durably retains the original
manifest and import ID before any future transport. IDs are owner-global: reuse
with another chat or changed content is rejected, not overwritten. Exact saved
manifest/receipt retries are no-ops even if local status has changed since export;
the original inventory remains retained. Digest encoding
matches B06's recursive key sorting/JSON.stringify escaping/SHA-256, including
control characters, non-normalized Unicode and lone-surrogate escaping. No export
of credentials or preference blobs is added.

`acknowledgeImport` requires that exact saved import, digest, owner/chat/project
claim and compatible per-row decisions. Successful and conflict receipts are both
immutable evidence; an import conflict does not acknowledge any row as adopted.
Exact receipts survive reopen and deduplicate. Lost acknowledgement recovery can
look up `importManifest`/`importAcknowledgement` using the same import ID; this step
does not POST or GET anything itself.

Matching remote/historical rows link to **the original `jobs.id`**, never a new
request ID. Original local text/answer/status/pending/progress/project evidence is
retained. Remote backend references may describe accepted work, but never mutate a
local job into accepted/completed or authorize retry. `sending`, queued/running,
interrupted/unknown local-only history remains unresolved-outbox. A subsequent
history page cannot downgrade an existing backend-reference link. Unknown remote
runs/historical-only chats stay in the cache; no local session/job/binding is
manufactured. Unmatched local rows are untouched, not assumed absent/completed or
assigned replacement IDs. All links remain non-actionable regardless of receipt.

## Actual verification

Changed source/tests:

- `app/src/main/java/dev/fantasticpimobile/History.kt` (helper version + two creation hooks);
- new `ConversationCache.kt`, `ConversationCachePolicy.kt` in that directory;
- `app/src/test/java/dev/fantasticpimobile/ConversationCachePolicyTest.kt`;
- `app/src/androidTest/java/dev/fantasticpimobile/ConversationCacheTest.kt`.

Executed host gates:

- **33/33 JVM tests passed**, zero failures/errors/skips: **11 new wire-policy**
  plus existing 15 request/7 catalogue regressions. Tests cover scope/schema/token
  refusal, legacy sources, stable message identities, contiguous feeds/reset refusal,
  historical/unresolved inert evidence, receipt proof refusal and manifest digest/
  unsupported-field checks. A Unicode digest vector was independently computed
  with Node `JSON.stringify` + `crypto` before asserting it in Kotlin.
- Normal and `-PreliabilityTests=true` Gradle `:app:testDebugUnitTest`,
  `:app:assembleDebug`, `:app:assembleDebugAndroidTest`, `:app:lintDebug` passed with
  `ANDROID_HOME=$HOME/.local/android-sdk` and
  `-Pandroid.aapt2FromMavenOverride=$HOME/.local/android-sdk/aapt2-source/build/aapt2`.
  APK compilation is **not installation or database test execution**.
- Full `cd bridge && npm test`: **148/148 passed**, no failures/skips. Existing
  B03–B06 snapshot, approval, import, HTTP, worktree/project/review and non-replay
  fixtures remain green; no bridge source change for B07.
- `python scripts/check-bridge-work.py`: **PASS**, isolated real tmux socket,
  disposable state/port/fake Pi; start/status/duplicate refusal, approval/review
  guards, pause/backup/fixture restart/exact-ID non-replay and untouched fixture
  pane. This is not a production bridge/controller invocation.
- Whitespace and documentation link checks are recorded in the final progress entry.

Logs: `$TMPDIR/b07-normal-build.log`, `b07-android.log`, `b07-fixture-build.log`,
`b07-final-normal.log`, `b07-jvm-rerun.log`, `b07-bridge.log`,
`b07-controller.log`, `b07-static.log`. The final normal unit rerun used
`--rerun-tasks`: all 22 Gradle tasks executed and all 33 tests passed.
JUnit XML: `app/build/test-results/testDebugUnitTest/`.

## Android SQLite device gate — passed (2026-10-21)

**Nine new fixture-only cache tests and ten existing data regressions ran and
passed on the rediscovered authorized ASUS_I003D, Android 12.** They cover real
SQLite v1/v2/v3/v4→v5 upgrade/reopen with original rowid/column-prefix/order checks,
failed-v4-upgrade transaction/version rollback and corrected retry, multi-page
snapshot/reopen/duplicate/cursor application, fault-after-prepared-page rollback,
remote completed-run discovery without local admission, stable unresolved outbox
links without legacy job/approval changes, feed result upsert/gap/duplicate conflict,
wrong-owner/schema/project refusal and both-side conflict retention, historical-only
read-only chats, import/ack rollback/loss/dedup/conflicts and synthetic selection/
pairing/review operation preference preservation.

No host SQLite mock/Robolectric substitute was used or reported as Android evidence.
The user explicitly authorized fixture installation and exactly these three data
classes. Secure Wireless debugging rediscovery (`android_wifi` auto) reconnected
the already-paired device; native Termux `adb devices -l` verified ASUS_I003D and
`getprop` verified Android 12. The pre-install fixture package query was empty.
Existing output APKs were normal-app builds and were **not installed**. Rebuilt:

```sh
ANDROID_HOME=$HOME/.local/android-sdk ./gradlew -PreliabilityTests=true \
  -Pandroid.aapt2FromMavenOverride=$HOME/.local/android-sdk/aapt2-source/build/aapt2 \
  :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug
```

**BUILD SUCCESSFUL**, 74 tasks: 19 executed, 55 up-to-date. Unit tests were up-to-date;
33/33 JVM remains the prior actually executed result, not a fresh unit rerun.
Before installation, output metadata **and native AAPT2 `dump badging`** verified
`dev.fantasticpimobile.reliability` and `dev.fantasticpimobile.reliability.test`.
Test manifest `dump xmltree` additionally verified AndroidJUnitRunner targets only
`dev.fantasticpimobile.reliability`. Verified APK SHA-256 values:

- Fixture: `c55731c4cfa355576748c3b0aa74cedb494a9fb444a1165c0bce1c87190b8ee8`.
- Test: `b867f3340f3d9b1dc6bf938883e1c7c3aae8734aca5a7d4c66eefd6aa238f15b`.

Installed only those two APKs using native `adb -s "$SERIAL" install`; both returned
Success. Executed exactly:

```sh
adb -s "$SERIAL" shell am instrument -w -r -e class \
  dev.fantasticpimobile.ConversationCacheTest,dev.fantasticpimobile.HistoryTest,dev.fantasticpimobile.ProjectHistoryTest \
  dev.fantasticpimobile.reliability.test/androidx.test.runner.AndroidJUnitRunner
```

**OK (19 tests), 0.482 s**: ConversationCacheTest **9/9**, HistoryTest **7/7**,
ProjectHistoryTest **3/3**. Raw runner output contains nineteen success statuses,
no failure/skip statuses and final `INSTRUMENTATION_CODE: -1` (runner success).
No failures and no storage/test code changes were needed. Existing host/bridge/
controller/normal-build evidence above was not rerun in this verification-only
continuation. No connected-test task, Activity or visible UI test was invoked.

Cleanup in `finally` uninstalled the test package then the fixture package (both
Success), solely because both were absent before this session; the final fixture
package query was empty. Normal-app data/preferences/history were never accessed,
read, migrated or replaced; no normal APK installed or normal Activity launched.
Synthetic fixture preferences are preservation evidence only, not a normal-data
comparison. No production configuration/journal access, bridge operation/restart,
deployment, provider action, settings change, commit or push. All prior local work
was preserved; only the three requested progress/evidence documents were edited.

Continuation logs under `$TMPDIR`: `b07-verification-fixture-build.log`,
`b07-verification-device-before.log`, `b07-verification-apk-identities.log`,
`b07-verification-device.log` (per-test output, installation and cleanup).
**B07 database gate complete; stop before B08.**
