# New-chat project picker — step 07

2026-10-20: **step 07 complete**. Implementation, host verification and the three
fixture UI tests passed. The user explicitly authorized visible fixture execution.
Only temporary isolated APKs were installed and then removed; the normal app was
not replaced and no production bridge was started/restarted.

## Native workflow

The chat screen has a wrapping project button above its existing conversation.
New chats say **Choose project before Send**. Tapping opens a scrollable native
picker, listing registered names, absolute sources, local-branch/remote-default
policies and opaque IDs. Selection is explicit and saved with `History.selectProject`;
no project is automatically selected. The label shows identity before Send and
refreshes name/source/policy metadata on foreground entry and chat switching. Offline
reopen still displays the persisted project ID; cached metadata is not binding proof.

The first saved request locks selection, even if its response is lost or rejected.
Established and archived chats show project details, not replacement controls. Use
New chat for another repository. Existing navigation/drafts/approval handling remain
in place. Project dialogs close when switching chats or leaving the foreground;
endpoint/generation checks prevent late responses from adopting another chat's data.
Each call in a multi-call sequence checks ownership and freezes the endpoint.

Discovery requires protocol 5 plus literal `projectBindings: true`. It reads the
registry and the exact session's binding without executing work. A verified binding
is adopted through the existing history conflict checks. Only an empty legacy draft
with a proved binding 404 can become selectable; submitted unresolved history stays
locked for exact-ID reconciliation. A missing established binding or conflicting
identity is an error, never permission to choose the current default.

Register trusted project opens manual name/path/policy fields. Local branches work
without remotes; remote policy takes an explicit remote name. Review registration
shows source and exact policy plus the host-permissions warning. Only **Confirm
trusted registration** adds literal confirmation and POSTs registration. Registration
does not select a project, send a chat, prepare a worktree, fetch, commit or merge.
A failed/lost registration response offers read-only rediscovery, not automatic
POST retry. Offline, unsupported, empty and malformed-registry states are explicit;
selection/draft/request identities are preserved and no default fallback exists.

## Changed code and tests

- `ProjectCatalog.kt`: injectable discovery/binding/registration policy.
- `ProjectPicker.kt`: native UI, explicit confirmation and guarded adoption.
- `MainActivity.kt`: persistent project control, lifecycle integration and the empty
  legacy-draft Send gate.
- `ProjectCatalogTest.kt`: 7 headless JVM tests, alongside 15 existing request tests.
- `ProjectPickerUiTest.kt`: 3 fixture-only Activity tests covering selection/reopen/
  immutable binding, empty/old/unavailable bridges, and registration confirmation
  without sending. **Passed twice: OK (3 tests)** on the authorized phone, using
  only `dev.fantasticpimobile.reliability` / `.reliability.test`.

No additional SQLite migration, pairing change, bridge route or production data
access. Existing schema-4 persistence is reused; the normal installed app is unchanged.

## Actual verification

Both normal and `-PreliabilityTests=true` variants passed:

```sh
ANDROID_HOME=$HOME/.local/android-sdk ./gradlew \
  :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug \
  -Pandroid.aapt2FromMavenOverride=$HOME/.local/android-sdk/aapt2-source/build/aapt2
```

Add `-PreliabilityTests=true` for the isolated fixture variant. JUnit reports:
**22/22 passed** (7 catalog + 15 request policy tests). The final normal build ran
after adding the UI test source; fixture compilation/lint also passed. Logs:
`$TMPDIR/step07-build.log`, `step07-fixture-build.log`,
`step07-final-normal-build.log`. `cd bridge && npm test`: **67/67 passed**,
`$TMPDIR/step07-bridge.log`. `git diff --check`: passed. Localhost:8787 probe
returned HTTP `000`/connection failure; no bridge was launched.

## Completed visible fixture verification

After the user said “run them”, native Termux ADB found one already-authorized secure
Wireless debugging device (ASUS_I003D). Readiness checks confirmed an awake/reachable
phone; the inactive ADBKeyboard warning was irrelevant because instrumentation uses
accessibility text actions, not that IME. No input/security/network setting changed.

Before installation, package listing showed only the normal app. Rebuilt fixture
artifacts; output metadata AND native AAPT2 badging proved the exact separate fixture
IDs. Installed only those APKs and ran this class-filtered command with the fresh
verified serial (never all instrumentation classes):

```sh
adb -s "$SERIAL" shell am instrument -w \
  -e class dev.fantasticpimobile.ProjectPickerUiTest \
  dev.fantasticpimobile.reliability.test/androidx.test.runner.AndroidJUnitRunner
```

Initial execution: 2 passed, 1 failed before its first click. The focused empty/old/
offline test reproduced the failure. A narrowly scoped launch probe confirmed the
native project button was shown/clickable while accessibility's active root was
still null. Fixed only the test click helper: wait boundedly for a visible/clickable
control in the fixture package's active window. Removed all temporary probe logs.
No app code fix was needed. Full class then returned **OK (3 tests)** twice
(5.163 s and 5.084 s). Tests exercise explicit choice/persistence/reopen/locking,
empty/old/unavailable bridge behavior, and registration confirmation without Send.

Fixture build/unit/test-APK/lint passed after that test-only fix. Final normal build/
test-APK/lint also passed, with `:app:testDebugUnitTest --rerun` actually rerunning
**22/22** host tests. Existing 67/67 bridge results above are from implementation;
no bridge code changed and that suite was not rerun during device verification.
Logs: `$TMPDIR/step07-ui-device.log` (initial failure),
`step07-ui-empty-repro.log`, `step07-ui-probe.log`, `step07-ui-final-build.log`,
`step07-ui-final.log`, `step07-ui-repeat.log`, `step07-ui-normal-final.log`.

Both previously absent fixture packages were uninstalled successfully. Package
listing again showed only the normal app. Normal versionCode/versionName/install
update timestamp compared identical before/after; normal history/database/pairing
were not accessed or migrated. No normal Activity launch, production journal access,
bridge restart, real provider action, job submission or phone setting change.
Final localhost:8787 probe returned HTTP 000/connection failure. Diff checks passed.

For reproduction, rebuild **fixture** artifacts first (final current artifacts are
normal), rediscover device/serial and recheck actual APK identities. Preserve any
pre-existing fixtures; uninstall only those installed for that run. Step 08 subsequently passed its separate headless
lifecycle verification: [project-lifecycle.md](project-lifecycle.md). Production
deployment/real-provider smoke work remain step 09, not started.
Work is local/uncommitted; nothing pushed.
