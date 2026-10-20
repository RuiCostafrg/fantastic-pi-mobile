# Project reconnect and client-close verification — step 08

**Complete — 2026-10-20.** Isolated deterministic HTTP/RPC and actual headless Android
client-process tests passed. Step 09 (normal deployment and agreed real-app/provider
smoke) has not started. No new production migration, normal installation or bridge
restart was performed.

## What was tested

The test seams are the existing authenticated HTTP interface, real Durable store /
per-project worktrees, and the same Android `Connection`, `ProjectRequests`, `History`
and review-request preferences used by Activities. No alternate request-routing
implementation is substituted. Test orchestration is separate from application code.

- Two disposable local Git repositories, explicit `trunk` policy, no remotes or
  provider. The same relative `file.txt` is edited in separate chat worktrees.
  Unrelated source staging is retained byte-for-byte; original tracked files stay
  unchanged. A third chat in project B exercises cancellation independently.
- A separate Node process owns the fixture bridge/store. It spawns deterministic
  fake RPC peers with the existing `runPi` transport, not a model. The peer writes
  only fixture files and markers. Release/cancel/approval gates are explicit, not
  dependent on a model or a guessed sleep duration.
- A loopback HTTP proxy forwards the complete job admission, consumes its accepted
  response, then destroys the downstream socket for project A. It similarly drops
  accepted review responses. Drop mode remains enabled until explicitly cleared,
  including any HttpURLConnection transport retries. This is real response loss,
  not throwing before dispatch or pretending the POST never reached the bridge.
- Android saves exact job IDs, text and selected projects before submission. The
  lost A response leaves its saved job `sending`. B is observed running. The
  instrumentation invocation ends, and only the fixture Android package is stopped;
  `pidof` verifies that client process is absent. The independently owned worker
  stays alive. The proxy is put offline and B is released using stdin control.
  B finishes while no Android client or HTTP polling connection is present, while
  A stays running with its exact pending approval.
- A fresh headless Android process checks offline failures preserve saved state.
  Another fresh process reconnects, resubmits the same saved A ID/project/text,
  adopts B's result and retains the selected chat, unsent draft and pairing.
  No replacement request ID, default-project omission or new worker dispatch occurs.
- A response with another project/request cannot update history or import its
  approval. Sending A's approval to B and a foreign dialog ID to A returns 409.
  Cancelling the third request leaves A **running with the same approval** and B
  done. Only then is A's actual approval answered (deny), allowing completion.
- A project-B test/review operation is persisted with its operation ID, project,
  revision and exact command before POST. Its acceptance response is lost; saved
  pending JSON survives another client-process boundary unchanged. GET and an
  explicit retry of that exact operation recover its real exit-0 output. Wrong-chat
  retrieval is 404; project/session ownership checks reject foreign data. A marker
  proves the harmless shell command ran once, only in B's worktree.
- Final states: A done / `RESULT_CONFIRM_A`, B done / `RESULT_HOLD_B`, third job
  cancelled. Each fake RPC peer dispatches exactly once in its own worktree; the
  review dispatch marker contains exactly one entry. Source files and staging are
  unchanged. All fixture workers are gracefully closed before disposable state is
  removed.

## Added fixtures

- `bridge/test/project-lifecycle-pi.js`: deterministic write/approval/release/cancel
  RPC peer, no model/device access.
- `bridge/test/project-lifecycle-fixture.js`: disposable store, backend, response-loss
  proxy and stdin-only control. Never loads production `.env` or state.
- `bridge/test/project-lifecycle.test.js`: black-box child-process/HTTP regression,
  included in `npm test`.
- `app/src/androidTest/java/dev/fantasticpimobile/ProjectLifecycleTest.kt`: four
  **headless** instrumentation phases (`submit`, `offline`, `recover`, `verify`).
  Package guard permits only `dev.fantasticpimobile.reliability`; no Activity launch.
- `scripts/check-project-lifecycle.py`: orchestrates the above against an explicit
  authorized serial. Only the fixture package may be stopped. It retains disposable
  diagnostics on failure and removes its temporary state after successful shutdown.

## Regression found and fixed

The existing isolated real-tmux workflow initially failed at startup. A focused
rerun with allowlisted fixture metadata showed `reason: health-unverified`,
`protocolVersion: 5`: `scripts/bridge-work.mjs` still accepted **only 4**, despite
step 05 adding protocol 5. This was a verification mismatch, not proof the fixture
bridge had failed to start.

Changed the health check to an explicit allowlist `[4, 5]`. Unknown/string versions
remain unverified; owner PID/executable/cwd/start-tick matching, maintenance/idle
checks, private backup, no forced kill and no automatic replay are unchanged.
`scripts/check-bridge-work.py` now asserts protocol 5/project bindings against the
real copied fixture server, and emits only the reason/version on startup failure.
The same real-tmux command then passed start/status, untouched pane, duplicate
refusal, active approval/review stop guards, backup/restart, exact-ID non-replay and
lifecycle logging. This controller source fix was not used to start production.

## Actual results

- `cd bridge && node --test test/project-lifecycle.test.js`: **1/1 passed**, including
  a rerun after strengthening cancellation/approval coverage.
- `cd bridge && npm test`: **68/68 passed**, rerun after the controller fix.
- `python scripts/check-project-lifecycle.py --serial "$SERIAL"`: **all 4 Android
  phases + worker/filesystem assertions passed twice**. This is four one-test
  instrumentation invocations per run, not four UI tests. All fake dispatches occur
  only in disposable worktrees. No production default-branch merge.
- Class-filtered `HistoryTest`, `ProjectHistoryTest`, `RequestStatusTest`: **OK (14
  tests)** in the fixture sandbox. No Activity/UI, pairing import or migration
  helper class was invoked.
- `python scripts/check-bridge-work.py`: **PASS** after the reproduced protocol fix,
  on its own temporary checkout/config/SQLite/fake RPC and separate tmux socket.
- Fixture and normal `testDebugUnitTest`, `assembleDebug`,
  `assembleDebugAndroidTest`, `lintDebug`: **passed**, with existing SDK/native AAPT2
  override. Final normal `:app:testDebugUnitTest --rerun` actually reran **22/22**
  host tests (7 catalog + 15 request policy). `git diff --check`: passed.

Commands (rebuild/install fixture identities only after fresh device/APK checks):

```sh
ANDROID_HOME=$HOME/.local/android-sdk ./gradlew \
  :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug \
  -PreliabilityTests=true \
  -Pandroid.aapt2FromMavenOverride=$HOME/.local/android-sdk/aapt2-source/build/aapt2
python scripts/check-project-lifecycle.py --serial "$SERIAL"
```

The Python command requires both already installed fixture APKs. It does not install,
choose a serial, change phone settings or use the normal app. Final current build
artifacts are **normal**; rebuild the fixture before reproduction. Do not run all
instrumentation classes. The earlier step-07 UI tests were not repeated during this
headless step. The historical broader reliability matrix remains separately scoped.

Logs under `$TMPDIR`: `step08-fixture-build.log`, `step08-device.log`,
`step08-device-repeat.log`, `step08-data-regressions.log`, `step08-normal-build.log`,
`step08-bridge.log`, `step08-bridge-final.log`, `step08-bridge-owner.log` (initial
failure), `step08-owner-repro.log`, `step08-owner-final.log` (passing). Normal package
versionCode/versionName/lastUpdateTime comparison: `step08-normal-before.txt` and
`step08-normal-after.txt` (identical).

## Preservation and limits

Native secure Wireless debugging found the already-authorized ASUS_I003D. Readiness
confirmed reachable/awake; inactive ADBKeyboard was irrelevant to headless testing,
so Gboard stayed unchanged. Before installing, package listing showed only the normal
app. Both output metadata **and actual native AAPT2 badging** proved the exact
`.reliability` / `.reliability.test` APK identities. Installed only those previously
absent fixtures, then uninstalled both; package listing again showed only normal.
Normal package version/update metadata matched before/after. No normal history,
database, pairing or production journal was read/migrated, no normal Activity opened,
no production bridge restarted or real provider invoked. Final localhost:8787 probe
was connection failure/HTTP 000. No IME, battery, network, lock or wake-lock change.

This proves persisted identity and **independent worker execution across headless
client-process closure/reconnect** on the awake phone. It does not claim a new
MainActivity end-to-end Send test, normal-app migration/deployment, real provider,
Termux death, Doze, screen-off or overnight survival. Those are distinct scenarios;
step 09 still needs explicit deployment/visible smoke agreement. All work remains
local/uncommitted; nothing pushed.
