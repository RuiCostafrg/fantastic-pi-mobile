# Pi Pocket recovery and progress

Updated: 2026-10-16

## Task-organized sidebar (0.3.0) — complete

- Sidebar hierarchy is now **New chats → Needs attention → Working → Finished**. Pins prioritize only within a section. Working titles use muted grey instead of looking disabled; selection remains visible.
- Requests awaiting approval and completed Pi replies belong in Needs attention. Failures, interruptions and cancellations also stay available for review.
- **Mark finished** is an explicit user action, separate from request `done`. Finished tasks show **✓ Finished by you**, can be reopened explicitly, and reopen automatically when another message is sent.
- **Archive chat** is available only for inactive, user-finished tasks. Archive hides them from the main list without deleting history/context. **Archive (N)** opens a separate searchable archive list. Archived chats are read-only until **Restore chat**, which returns them to Finished.
- SQLite v3 adds local `finished` / `archived` flags without erasing old data. Lifecycle edits are transactional with request admission; running/approval-waiting work cannot be marked finished or archived. No bridge API or Pi session IDs changed.
- `assembleDebug assembleDebugAndroidTest lintDebug`: **BUILD SUCCESSFUL**; log `~/.local/android-sdk/pocket-lifecycle-build.log`.
- Final installed APK: **0.3.0**. Android instrumentation: **OK (9 tests)**. Coverage includes v1/v2 migration, persistent lifecycle flags, archive/admission guards, grouping, muted working labels, and archive/main filtering. Bridge suite remains **11 passed**.
- On-device pi-droid checks: marked test A finished, archived it, verified absence from main list, verified archive/history after force-stop/relaunch, restored it into Finished. Old history and pairing remain intact.
- Ran a harmless `sleep 45` request to visually verify Needs attention above muted Working above Finished. Request completed as SIDEBAR_READY. Explicit Reopen and automatic reopen by sending another message both passed.
- Private pre-upgrade backup: ignored `bridge/data/pre-lifecycle-backup/android-data.tar`. No microphone activated. Existing workspace/device-sharing caveats still apply.

## Multi-chat release (0.2.0) — complete

- Researched Gemini Android's documented menu/pin/search/rename pattern and Android's navigation drawer guidance; sources and rationale are in `docs/session-navigation-research.md`.
- Added native AndroidX modal drawer, new chat, title search, pinned/recent sections, rename/long-press menus, selected highlight, and running/approval badges.
- SQLite v2 additive migration retains old jobs in Main chat. Each chat persists its own draft, title, pin, transcript, progress and pending approval. Selected chat survives relaunch.
- Pi Durable admits one active request per chat and a configurable global cap (default 3, range 1–8). Each chat has a stable, independent Pi session; rename never changes its context. Legacy API submissions still target `pocket`.
- All active chats are polled, not just the visible one. Completion never changes selection; approvals and Stop are scoped to their request/chat. Pi processes close before completion permits the next turn.
- Protocol v2 health exposes the parallel cap; old bridge versions cannot silently mix new chats into the old context.
- Files, provider settings, tools and the physical phone remain shared: model-context separation is not a sandbox or privacy boundary.

### Final verification

- `npm test`: **11 passed**, 0 failed, including real Durable storage with concurrent fake-RPC children, atomic admission, cap, session-aware idempotency, approval/cancellation isolation, protected flags, legacy compatibility and restart non-replay.
- `assembleDebug assembleDebugAndroidTest lintDebug`: **BUILD SUCCESSFUL**. Log: `~/.local/android-sdk/pocket-sessions-build.log`.
- Installed version 0.2.0 and test APK; instrumentation: **OK (4 tests)**, including legacy migration and independent drafts/history/pins.
- Preserved private pre-upgrade app/bridge backups under ignored `bridge/data/pre-sessions-backup/`. Existing pairing and Main chat history survived upgrade.
- Real phone/provider test via pi-droid: created/renamed A/B, pinned A, filtered titles, and switched between independent unsent A/B drafts.
- Started harmless `sleep 90` in A and `sleep 25` in B concurrently. Stopped A: A became CANCELLED and `sleep 90` was gone while B's `sleep 25` remained running. B completed successfully.
- Follow-up A recalled MAPLE; follow-up B recalled OCEAN. A fresh third chat returned NO_WORD without tools, verifying ordinary conversation-context separation. No microphone was activated.
- Force-stop/relaunch retained selected B, its transcript, pairing and successful context. Read-only UI assertions passed for A/B/third-chat answers. Drawer screenshot visually checked for insets, selected highlight, pin sections and readable controls.
- Updated `scripts/check-ui.py` for separate message cards: checks the last visible Pi card, not an older card.
- Test-created chats remain clearly identifiable on the device; cancellation entries are intentional. No deletion UI was added.

## Original recovery — completed

- [x] MVP source committed at `9d94296` and published to GitHub.
- [x] Recovered prior local Pi session `01a14372-f8a0-74b2-95c6-6b7976f3e309`.
- [x] Built ARM-native AAPT2 compatible with the installed Termux Protobuf.
- [x] Fixed Android lint errors: explicit `includeSubdomains="false"` on loopback domains.
- [x] `assembleDebug lintDebug` passed (4 non-blocking lint warnings remain).
- [x] Installed the final rebuilt APK on the connected phone; cancellation history and enabled Send still pass the on-device check after installation.
- [x] Fixed misleading unpaired state and added a pairing action.
- [x] Added metadata-only Android and bridge diagnostics, plus log privacy coverage.
- [x] Bridge/diagnostics tests: 6 passed (`cd bridge && npm test`).
- [x] Started an authenticated localhost bridge; generated token in ignored mode-0600 `.env` and paired through the app's password field without printing the token.
- [x] Original queued Benfica question completed through the actual Pi provider, with its original request UUID.
- [x] Answer and pairing survived app force-stop/relaunch.
- [x] Read-only pi-droid tool invoked through the app: `android_screen_state` returned foreground `dev.pipocket`, unlocked. The persisted Pi session confirms a successful actual tool result.
- [x] App Stop cancelled a running harmless `sleep 45` tool command, restored Send, and left no sleep process.

## Reproduction and regression evidence

Before the fix, a fresh UI hierarchy assertion reported:

```text
unpaired=True pending_sending=True send_enabled=false
AssertionError: Unpaired request stuck in SENDING
```

The committed regression-check script also failed before the fix:

```sh
python scripts/check-ui.py unpaired
# AssertionError: Unpaired request misleadingly shown as SENDING
```

After the fix on the installed APK:

```text
PASS: unpaired
PASS: done    # latest answer includes Benfica
PASS: done    # after force-stop/relaunch
PASS: done    # latest answer includes dev.pipocket
PASS: cancelled
```

The unpaired screen now displays WAITING FOR PAIRING and an enabled Pair bridge button. Clicking it opens Settings; it does not insert another job. Saved active requests retain their IDs and resume after pairing. Startup no longer instructs an already-paired user to pair again.

## Local deployment and diagnostics

- App package: `dev.pipocket`.
- Bridge URL: `http://127.0.0.1:8787`, loopback only.
- Workspace: this repository (`~/projects/pi-pocket`).
- Private config: `bridge/.env` (ignored). Uses this recovery session's selected Pi provider/model, with low reasoning. `PI_ARGS` is local configuration, not in version control.
- Bridge started with `nohup node --env-file=.env src/server.js`, from `bridge/`.
- PID file: `bridge/data/bridge.pid`; logs: `bridge/data/bridge.log` (ignored).
- Android logs: `adb logcat -s PiPocket:I`.
- Diagnostics contain event categories, job IDs, status, HTTP timing/status, and subprocess lifecycle metadata. No prompts, answers, tokens, headers, arbitrary URLs, or raw exception messages are intentionally logged.
- Full SQLite/Pi conversation history still contains request/answer text as designed. Do not publish `bridge/data/`.
- Android IME was temporarily switched to ADBKeyboard for testing; Gboard was restored after the test run.

No auto-start/background survival guarantee: Android can kill Termux. Do not delete a storage lock until verifying no bridge or child is alive. Do not automatically replay an interrupted externally dispatched command.

## What interrupted the original build attempt

The prior session ends at a tool call compiling AAPT2, without a recorded result or session error. Its process-termination cause is unknown. The build itself was blocked by resource-tool incompatibility: the older compiler could not read SDK 35 resources, and a replacement binary could not resolve Protobuf's emulated-TLS symbol.

Resuming the source build reproduced the same undefined symbol during linking. The source's `cmake/CompilerFlags.cmake` forced `-femulated-tls`, while installed `libprotobuf.so` exports native TLS. Changing that local tool source to `-fno-emulated-tls` and rebuilding with two workers resolved it. Both `aapt2 version` and `aapt2 dump resources` on SDK 35's android.jar then succeeded. This tool change is outside the project repository.

## Rebuild on this phone

Prerequisites are installed under `~/.local/android-sdk` and Termux's OpenJDK 21 directory. Normal workstation/CI builds should use the README's standard build, not this override.

```sh
export JAVA_HOME="$PREFIX/lib/jvm/java-21-openjdk"
export ANDROID_HOME="$HOME/.local/android-sdk"
cd ~/projects/pi-pocket
./gradlew --no-daemon -Dorg.gradle.native=false \
  -Pandroid.aapt2FromMavenOverride="$ANDROID_HOME/aapt2-source/build/aapt2" \
  --max-workers=2 assembleDebug lintDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`.
Build log: `~/.local/android-sdk/pocket-build-resumed.log`.
Patched tool source: `~/.local/android-sdk/aapt2-source`.
If rebuilding that tool, use `ninja -C build -j2` from its source directory.

## Next steps / not yet verified

1. Voice input with the user present; do not activate microphone input unattended.
2. On-device extension approval/input dialogs (covered by fake-RPC bridge tests, not yet actual extension UI).
3. Phone/Termux background and battery-management behavior; foreground-service integration is not implemented.
4. Remaining lint warnings: backup/transfer rules, application icon, two translation warnings.
5. Markdown rendering, optional TTS and screenshot attachments (message cards/auto-scroll are now implemented).
6. Retention/rotation of bridge diagnostics and conversation history.
7. Keep `.env`, databases, local backups, logs, screenshots and Pi session files out of commits. Runtime history contains private conversation content even when diagnostics are metadata-only.
8. Optional CI: GitHub workflow permission was missing previously; workflow remains at `ci/build-and-test.yml`. Do not assume scopes have changed.
