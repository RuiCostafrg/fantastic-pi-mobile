# Android project/request persistence — step 06

**Step 06 is complete — 2026-10-20.** Host policy/build/lint and isolated Android
database runtime tests passed. No picker, normal-app installation/migration,
production restart or visible Activity test is included. The normal installed app
has not been changed. This document records step-06 evidence; step-07 picker source
and host verification now pass, and its separately authorized 3 fixture UI tests
passed twice: [project-picker.md](project-picker.md).

## Persisted identity (History schema 4)

Both `sessions` and `jobs` gain nullable `projectId` and non-null `projectState`:

- `UNBOUND`: genuinely new local chat, no selected project. Send cannot silently
  choose the bridge default. Step 07 adds the deliberate picker described separately.
- `LEGACY_UNRESOLVED`: every upgraded v1/v2/v3 row, including empty drafts. Neither
  titles nor today's default are repository evidence. Existing IDs/text/results/
  progress/dialogs/organization remain untouched.
- `SELECTED`: deliberate project choice persisted before a new request is saved.
- `BOUND`: the project's identity has been verified from an accepted backend record
  or a chat-scoped binding/review response. This describes project identity, not
  whether a new local `sending` job has already been accepted.

`History.selectProject` only edits an unbound/selected chat before any saved request.
`History.add` snapshots its project identity with the exact UUID/text/session in the
same transaction that clears the sent draft. A proved legacy target is also saved
transactionally before retry dispatch, without claiming that work was accepted. After a saved request exists, choosing
another repository requires a new chat. `acceptResponse` revalidates current
persisted request/chat/project identity and stores binding/result atomically; it
does not stamp other legacy jobs with a guessed project. New requests in an already
bound chat inherit the binding.

The existing v1→v2→v3 migrations run first, then v4 adds identity columns and marks
old rows unresolved. No ID, SQLite filename, Pi session/worktree name or preferences
key is renamed. Encrypted pairing and review preferences are not migrated. Existing
saved review operation JSON remains unchanged; new confirmed operations include the
snapshot's project ID before their operation ID/payload is saved.

`resolveEmptyDraft` is a narrowly scoped local transition for step 07: its caller
must first prove that the backend binding is absent, and it refuses any chat with
submitted local history. A submitted legacy chat needs exact-ID reconciliation,
not an empty-draft/default shortcut.

## Request seam and recovery

`ProjectRequests` owns capability, payload and identity checks without an Activity;
it receives an injectable HTTP function for headless tests. Activities use the same
policy, not a test-only substitute.

- Selected/known-project submission requires fresh protocol >= 5 and literal
  `projectBindings: true` before POST. The persisted project is always included.
  Old/missing/false capability never triggers an omitted-project fallback.
- A legacy unresolved `sending` row first GETs its exact saved ID. If accepted, its
  result can be recovered without resubmission. If absent, a protocol-5 chat-binding
  lookup must prove its established project, and a required persistence callback
  freezes that identity before POST. The exact same request ID/text/session is sent
  with the proved project explicitly attached; a lost acceptance response cannot
  make a later retry choose a replacement owner's default. Unknown bindings or a
  failed identity save stop without POST; no new ID is created.
- Old-bridge accepted legacy jobs can still be polled without inventing project
  identity. A selected/known-project response must carry the matching project.
- Responses must match request and session IDs as well as project identity; unknown
  statuses are rejected. Identity failures are **not** definite admission rejections:
  no answer, status or approval is adopted, and saved work stays uncertain.
- Sending-state 400/404/409/413/426 errors stop automatic submission polling as
  rejected, retaining the original ID/text/project. Network/401/429/5xx failures
  remain uncertain/waiting. A GET 404 for already-accepted work is not evidence that
  external work stopped, so accepted work is not automatically marked failed.
- Review snapshots/diffs/action responses validate the same project; nested operation
  ownership is checked too. Known-project action POSTs require capability. A saved
  legacy operation without a project field must prove the current backend session
  binding before POST and persist the proof. Its saved ID/JSON is not rewritten:
  the transport uses a copy enriched with the proved project ID. This prevents a
  replacement bridge from treating an old operation as new default-project work.
- Missing binding/capability/identity blocks automatic pending-review polling while
  retaining uncertain operation IDs for explicit reconciliation/retry. Definitive
  submission validation failures may clear the unsent pending operation as before.
- Foreground/endpoint epochs guard adoption, including review/diff responses.
  Multi-call submission policy also checks ownership before each call; Connection's
  endpoint-frozen request helper cannot POST to a newly paired endpoint after a
  health/binding proof from another one. Wrong
  project data cannot make a cached approval current or clear an unrelated operation.

This is client-side safety, not a promise of host survival or exactly-once external
side effects. Existing bridge journal/non-replay behavior remains authoritative.

## Verification performed

With `ANDROID_HOME=$HOME/.local/android-sdk` and the existing native
`-Pandroid.aapt2FromMavenOverride=$HOME/.local/android-sdk/aapt2-source/build/aapt2`:

- `./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest
  :app:lintDebug` — normal build **passed**, including **15/15 headless policy tests**.
- Same tasks with `-PreliabilityTests=true` — **passed**, including fixture APK/test
  compilation and lint. Final artifacts' output metadata identifies only
  `dev.fantasticpimobile.reliability` and `dev.fantasticpimobile.reliability.test`.
- `cd bridge && npm test` — **67/67 passed** (isolated bridge regressions).
- `git diff --check` — passed.

Host policy tests cover capability refusal before POST, selected payload/ID retention,
offline/dropped-response retries, legacy exact-ID/binding recovery, unbound refusal,
wrong/missing/malformed identities, permanent vs uncertain errors, saved-review
ownership, durable proof-before-dispatch and lost legacy acceptance against a
replacement default. They do **not** execute Android SQLite or Activity UI.

Database/device tests now **passed: 14/14**, using the native Termux ADB runner and
only the separate fixture sandbox. `HistoryTest` (7 tests) covers v1/v2 upgrades;
`ProjectHistoryTest` (3) covers v3 migration, selection/request/accepted binding
reopen, conflict rollback, draft/lifecycle/operation preservation; `RequestStatusTest`
(4) covers freshness/approval regressions. No `LiveStatusUiTest` or Activity test ran.
On resumption, the fixture build/lint command passed again (up-to-date tasks),
`:app:testDebugUnitTest --rerun` actually reran **15/15 passing host tests**, and
`cd bridge && npm test` reran **67/67 passing bridge tests**. `git diff --check` passed.

## Resolved device blocker and reproducible data-test command

The earlier session had no native ADB device, an unsupported `mdns:services` query,
and a class-filtered Gradle instrumentation failure before install/test because SDK
ADB could not initialize (`Could not create ADB Bridge` / `Could not determine adb
version`). Those were blockers, not failed database test assertions.

On 2026-10-20, after the user returned to the phone and authorized continuation,
secure Wireless debugging rediscovery reconnected the already-paired ASUS_I003D.
No legacy TCP/IP debugging, SDK replacement, security setting change or UI navigation
was needed. Native ADB plus explicit verified serial bypassed incompatible SDK ADB.
Fresh metadata AND actual AAPT2 APK badging confirmed the separate fixture IDs;
both fixtures were absent before installation. The two fixture APKs were installed
only for the headless class-filtered run below, which returned `OK (14 tests)`.
They were both uninstalled afterward; only the normal app remained. Normal app
versionCode 7 / versionName 0.6.1 and `lastUpdateTime=2026-10-19 22:19:58` matched
before/after. No normal database or encrypted pairing was opened/read/migrated.
No production journal was accessed or bridge started/restarted; localhost:8787 was
ECONNREFUSED after verification. No claim of a real-provider or visible UI smoke test.

Logs for the resumed run are `$TMPDIR/step06-data-device.log`,
`step06-resume-build.log`, `step06-resume-unit.log`, `step06-resume-bridge.log`;
JUnit XML is under `app/build/test-results/testDebugUnitTest/`. This command is for
future reproduction only: rediscover the serial and verify fixture APK identities
before any installation, and never substitute the normal package:

```sh
adb -s "$SERIAL" shell am instrument -w \
  -e class dev.fantasticpimobile.HistoryTest,dev.fantasticpimobile.ProjectHistoryTest,dev.fantasticpimobile.RequestStatusTest \
  dev.fantasticpimobile.reliability.test/androidx.test.runner.AndroidJUnitRunner
```

Do not invoke all instrumentation classes: some open Activities or include explicitly
gated migration helpers. Agree any visible UI tests separately. Step 07's evidence
is now complete: picker implementation/host tests passed and its 3 separately
authorized visible fixture tests passed twice. Step 08 subsequently passed its
headless lifecycle verification ([project-lifecycle.md](project-lifecycle.md)); step
09 deployment is next, not started. Normal APK installation
and real history migration remain outside steps 06/07 and require private backups
and separate deployment agreement. All work remains local/uncommitted, nothing pushed.
