# Pi Pocket recovery and progress

Updated: 2026-10-16

## Trustworthy foreground request status (0.6.1) — complete increment

- Saved request state no longer implies live execution or a current approval. Foreground entry/re-pairing starts at Checking status; per-request evidence expires after 10 seconds. Connection failure shows Status unknown; HTTP 429 shows waiting for a bridge slot. Unverified chats move to Needs attention with explicit labels.
- Cached approvals are hidden/dismissed until the exact request is freshly verified. Action handlers recheck freshness/dialog identity. Late responses from earlier visibility/connection epochs cannot update history or revive dialogs. Interrupted results explicitly explain non-replay. Durable IDs, admission, drafts, history, review operations and the existing UI design remain intact; no database migration.
- `RequestObservations.kt` owns ephemeral evidence/presentation. It is not persisted as progress text, and one chat's response never proves another is running. Poll results apply on the UI thread after epoch/endpoint checks.
- Added an opt-in separate fixture APK (`-PreliabilityTests=true`), fake-Pi/Durable/worktree lifecycle harness and real-activity HTTP/accessibility regression. The focused UI test verifies checking → unavailable → verified approval → interrupted without cached approval leakage. Its initial Allow/ALLOW mismatch was fixed in the test, not worked around in runtime code.
- **38 bridge tests passed; 24 Android tests passed** on the isolated APK. Isolated and normal `assembleDebug assembleDebugAndroidTest lintDebug` succeeded with the existing native AAPT2 override. Logs: `~/.local/android-sdk/pocket-reliability-build.log` and `pocket-reliability-release-build.log`.
- Installed normal **0.6.1 / versionCode 7** after backing up app state and verifying zero saved active requests. A before/after comparison confirmed unchanged logical jobs/sessions/drafts, selected chat and encrypted pairing. Private backups under ignored `bridge/data/pre-reliability-backup/`. Pi-droid observed the preserved blank chat, Ready status and paired Send control. The live bridge was not restarted and remains healthy at protocol v4/eight slots.
- Isolated test packages removed after verification to avoid duplicate launcher entries. No microphone, IME, font, battery, network or lock changes. Phone tests must be announced: the user found the earlier repeated opening/closing disruptive.
- **Not complete:** notifications, background services/process survival, secure lock testing, abrupt Termux death and provider-internet loss. The revised full lifecycle harness has not been rerun: an earlier offline failure exposed a server-state/app-observation synchronization assumption. Do not call the full matrix green. Exact evidence, reproduction and remaining checks: [docs/reliability-baseline.md](docs/reliability-baseline.md).

## Human-readable coding review and calmer UI (0.6.0) — complete

- Replaced always-visible Δ with **Review N changed files**, shown only for actual working/committed changes in the selected chat. Changes is also conditional in the chat menu. Committed files stay discoverable until integration; active/uncertain repository actions remain reachable even when clean, preserving Stop/exact-ID recovery.
- Added read-only `GET …/changes?summary=1`: chat-scoped, deduplicated counts without file-content hashing, remote fetching or checkout creation. Large files/symlink targets are not read. Selected-chat polling rejects late results for another chat/endpoint; returning/switching invalidates old availability. Older v4 bridge full snapshots remain compatible.
- New Catppuccin Mocha-inspired native theme: softer dark surfaces, lavender accent, clear contrast, vector toolbar icons with 48dp touch targets, roomier gutters and padded dialog inputs. Finish is quieter; Stop is hidden when no chat request is active. No database migration or request-ID changes.
- File-first review: whole filenames wrap, folders/status labels are separate, porcelain codes become Added/Modified/Deleted/Conflict. Worktree IDs/paths/hashes move under Branch & folder details. Checks/local integration are scrollable sections; commit is a single adaptive-height primary action. Archived review omits mutation controls.
- Full-screen, one-column code diffs: before/after line-number gutters, +/− signs, red/green full-line backgrounds, hunk separators, selectable text, horizontal scrolling for long logical lines, exact Raw patch / Copy patch. Filenames wrap instead of being capped at three lines; no full editor/hunk-staging claim.
- Investigated official VS Code source-control docs, GitHub diff-review guidance, Android accessibility/font scaling and Catppuccin's official palette. Successfully fetched sources and application choices are recorded in `docs/mobile-review-design.md`; failed guessed URLs are explicitly not treated as evidence. No background browser/research agent was available.
- Reproduced the empty-chat Changes bug with an ADB assertion. A native test against installed **0.5.0** also failed on the actual review merge button's fixed 48dp height. Text actions now use wrap-content height and 48dp minimums, rather than clipping long/large-font labels. No broad UI-text logging added.
- `npm test`: **36 passed**. Instrumentation: **OK (18 tests)**. New coverage includes actual screen action sizing, long paths at 320dp/font scale 2.0, full-screen long-line scrolling/raw-patch exactness, navigation rules, diff line arithmetic and honest test evidence. `assembleDebug assembleDebugAndroidTest lintDebug`: **BUILD SUCCESSFUL**, log `~/.local/android-sdk/pocket-human-ui-build.log`.
- Full pi-droid/provider phone check in an isolated disposable repo: ordinary answer UI_THEME_READY left Changes hidden; real Pi edits to two nested Kotlin files exposed Review 2 changed files. Long filename, two hunks, red/green before/after code, Raw patch toggle and sideways scrolling were inspected. Native tests recorded UI_READABLE_PASS, selected commits moved files into Already committed and kept Changes visible, post-commit evidence was stale until rerun, and confirmed local integration produced All caught up and removed the action.
- Integration verification checked both actual fixture files, clean target, fresh exit-0 evidence, zero remaining working/committed changes, and no remote configured. No test merge touched the actual project default. Demo chat archived; fixture/worktrees retained privately.
- Original bridge restored and verified idle with protocol v4/eight slots, lightweight summaries and old worktree identity. Installed **0.6.0**. An existing archived production worktree was inspected read-only at normal and actual **200% system font size**. Font scale restored to 1.0, Gboard restored, blank chat selected, no microphone activated.
- Private pre-upgrade backups under ignored `bridge/data/pre-human-ui-backup/`; test runtime under ignored `bridge/data/review-ui-fixture/`. Pairing/history/worktrees preserved. Existing permission, stale-revision, durable ID, no-replay, commit/merge and no-automatic-push safeguards remain unchanged.

## Changes review and explicit integration (0.5.0) — complete

- Added native **Δ / ⋮ → Changes** per chat: directory/branch/HEAD and local ahead/behind counts, separate working/committed file lists, checkboxes, colored selectable diff previews, Copy, and empty/read-only states.
- **Commit selected** confirms the message and exact whole files. Literal path validation plus `git commit --only` excludes unrelated pre-staged files. App Git actions skip hooks/GPG signing; no automatic commit, reset, discard, remote push or PR creation.
- **Run tests** confirms an exact shell command with the full-Termux-permissions warning. Records actual exit code, bounded output and revision evidence; supports a two-minute timeout and scoped Stop. UI distinguishes not-run/pass/fail/stale/cancelled/interrupted/unknown. Assistant claims are not evidence. Source/index/mode/HEAD changes conservatively invalidate old results; identity fingerprints prevent transfer between identical clones/worktrees.
- **Merge into local default** requires a clean chat, clean correctly checked-out local target, no unfinished Git operations and no active model requests. A merge-tree preview catches conflicts without changing the target; explicit path checks protect ignored/untracked local files and symlink ancestors. No automatic rollback or push.
- `bridge/src/review.js` owns snapshots/diffs/actions. Pi Durable journals repository operation IDs and dispatch intent separately from model jobs. Identical request IDs are idempotent, mismatches conflict, new model admissions wait during review actions, and uncertain dispatched operations are never replayed after restart. Git actions cannot be cancelled once dispatched.
- Android persists confirmed request IDs before submission. Uncertain responses are resolved by GET of the exact ID; explicit retry reuses it rather than creating another action.
- Fixed a phone-discovered snapshot race: an action could complete after code state was read but before operation state was fetched. The bridge now marks overlapping reads `refreshRequired`; UI disables mutations and automatically refreshes. A deterministic Durable regression test covers the interleaving.
- Fixed an ignored-file safety edge case before deployment: a minimal Git probe showed `--no-overwrite-ignore` protects fast-forward merges but not the tested no-fast-forward merge path. An explicit incoming-path collision check now rejects this before changing the target; regression test passes. No debug/probe files remain in the source tree.
- `npm test`: **34 passed**. Android instrumentation: **OK (12 tests)**. `assembleDebug assembleDebugAndroidTest lintDebug`: **BUILD SUCCESSFUL**; log `~/.local/android-sdk/pocket-changes-build.log`. Installed version **0.5.0**; health protocol v4 advertises `changesReview: true` and eight slots.
- Full pi-droid phone test used an ignored disposable repo, not the actual project target: real Pi modified hello.txt/extra.txt; native colored diff showed before/after; selected commit changed only hello while an unrelated keep.txt stayed staged and extra stayed untracked. Native tests recorded real exit-1 and exit-0 results, pre-commit evidence became stale, a long sleep test was stopped, remaining files were explicitly committed, fresh checks passed with recorded output, and native Merge locally integrated into disposable trunk. Target was clean with zero commits left to integrate and no remote configured.
- App force-stop/relaunch retained selected chat, test evidence and completed merge. Demo bridge restart preserved earlier actions; Durable fixture coverage verifies interrupted-action non-replay. The original bridge and pairing were restored afterward; production review reads an existing archived worktree in read-only mode. Normal keyboard restored, blank chat selected. No microphone activated.
- Original app/bridge backups: ignored `bridge/data/pre-changes-backup/`. The stopped disposable server, fixture repositories/worktrees, logs and history remain private under ignored `bridge/data/review-ui-fixture/`. Its clearly named UI test chat is archived. No test merge changed the actual project default branch.
- Scope/limits and safety details: `docs/changes-review.md`. Hunk staging, conflict-resolution UI, signed/hook-driven workflows, remote push/PR creation, retention and safe destructive cleanup remain follow-up work.

## Isolated worktrees and higher concurrency (0.4.0) — complete

- Default active-request limit raised from 3 to **8**; `PI_MAX_CONCURRENT` now accepts **1–32**. Saved chats are not limited. More active Pi children use more memory/provider capacity; no claim of 32-provider stress testing.
- Every chat, including legacy `pocket`, gets its own persistent worktree and `pocket/<repo-key>/<chat-key>` branch on its first new request. Pi launches with that checkout as cwd. Later turns, restore and bridge restart reuse it without resetting commits/uncommitted edits.
- New trees discover/fetch the current remote default branch (`PI_GIT_REMOTE=origin`). Explicit `PI_DEFAULT_BRANCH` selects a local branch for offline/local-only use. The current feature branch and dirty/untracked/ignored source files are never copied.
- `bridge/src/workspaces.js` owns preparation, deterministic repository/chat identity, atomic private manifests, recovery and branch/cwd checks. Preparation is serialized; model execution stays parallel. Setup failures, missing trees or manually switched branches fail closed, never run in the original checkout, and never delete/reset changes.
- Durable stores workspace metadata with each job. Pi receives a workspace-specific appended system instruction; the user prompt stays unchanged so extension slash commands still work. Diagnostics record created/reused/failure metadata without paths, prompts, Git stderr or remote credentials.
- Health protocol v3 advertises `worktreeIsolation: true`; the Android app rejects older bridges for new submissions. **⋮ → Workspace details** shows selectable directory, branch, base branch/commit. Sidebar warns that phone/Git history remain shared.
- Finishing/archiving does not remove worktrees or automatically commit/merge/push. Worktrees prevent ordinary simultaneous working-file overwrites, not later merge conflicts or explicit cross-checkout access. Dependencies/ignored local config may need separate setup in a checkout. No OS sandbox was added.
- `npm test`: **18 passed**. Real temporary Git repositories cover non-default/dirty source checkouts, two same-file edits, fresh remote default tips/default-branch changes, offline behavior, worktree reuse and recovery, branch/missing-tree checks, real RPC cwd/metadata integration, legacy isolation and failure non-fallback. Nine concurrent fake-RPC children reached independent pending dialogs with a configured limit of 12.
- `assembleDebug assembleDebugAndroidTest lintDebug`: **BUILD SUCCESSFUL**; log `~/.local/android-sdk/pocket-worktrees-build.log`. Installed version **0.4.0**; Android instrumentation **OK (9 tests)**.
- Phone/provider test via pi-droid: two concurrent fresh chats wrote TREE_A/TREE_B to the same relative `.pi-pocket-worktree-smoke.txt` in distinct worktrees/branches based on `main`. Both completed with their own content; the original checkout had no such file. Follow-up A and a further request after clean bridge restart retained TREE_A and the same branch. Workspace details dialog verified on-device.
- Live authenticated health reports eight slots and isolation enabled. Private pre-upgrade backups are ignored under `bridge/data/pre-worktrees-backup/`; worktrees, manifests, model sessions and logs remain ignored/private. Test worktrees are retained, not deleted.

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
