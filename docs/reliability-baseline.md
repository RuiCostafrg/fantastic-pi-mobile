# Reliability: foreground status and interruption baseline

## Implemented in 0.6.1

This increment makes **foreground status trustworthy**; it does not keep Termux alive.
Notifications, a foreground service, and automatic bridge startup are **not implemented**.

- Saved `sending`/`queued`/`running` values retain admission and exact-ID recovery semantics, but are not live confirmation.
- Each foreground interval starts at **Checking status**. Evidence is per request, held only in memory, and expires after 10 seconds without a successful refresh.
- Connection/HTTP failures show **Status unknown**, not failed/done/running or a currently actionable saved approval. Work may still be executing. HTTP 429 is separately shown as waiting for a bridge slot.
- The drawer moves unverified requests to Needs attention with explicit checking/unknown/waiting labels. It does not imply that another chat's successful connection proves this chat is running.
- Approval dialogs/buttons require current evidence for that request. Backgrounding, connection failure, evidence expiry, a changed pending-dialog ID or a terminal result dismisses an old dialog. The action handler rechecks evidence and the pending ID before sending.
- A visibility/connection epoch prevents responses from before backgrounding/re-pairing from updating history or reviving approvals. Pairing changes reset evidence even at the same URL.
- Terminal results stay terminal; `interrupted` explicitly says to inspect changes and that work was not replayed. An unavailable bridge does not itself justify declaring a dispatched job interrupted.
- No database migration, new job/action UUID, automatic replay of dispatched work, background polling/service, or automatic model execution was added. A still-`sending` request retains the existing same-ID admission retry.

Implementation: `RequestObservations.kt`, `MainActivity.kt`, `SessionDrawer.kt`. Request observation is UI-thread owned. History remains the durable record; observation is not stored in progress text or inferred by parsing old connection errors.

## Verified (2026-10-16)

- **38 bridge tests passed.** New tests durably accept a real HTTP submission and deliberately lose its response; identical-ID retry dispatches only once. Listener loss preserves an approval; reopening the bridge interrupts both chats, expires the approval and does not replay either job.
- **24 Android tests passed** on the isolated APK: 18 existing tests, four observation/presentation tests, one drawer regression and one real activity/HTTP/history/accessibility test. The UI test starts with a saved approval, holds the first response, verifies Checking status with no approval, returns HTTP 503 and verifies Status unknown with no approval, then verifies a live approval and its removal on an interrupted result. It uses deterministic fake responses, not a model/provider extension.
- The UI test initially failed because it matched `Allow` but Android exposed `ALLOW`. Changing only the test to a case-insensitive match made it pass against the unchanged APK. No runtime workaround was added for that test issue.
- Isolated and normal `assembleDebug assembleDebugAndroidTest lintDebug` builds passed with the existing Termux ARM AAPT2 override. Logs: `~/.local/android-sdk/pocket-reliability-build.log` and `pocket-reliability-release-build.log`.
- Installed normal app **0.6.1 / versionCode 7**, launched with pi-droid and observed the preserved blank chat, Ready status and paired Send control. No live request was submitted. Before/after private backups compared exact logical jobs/sessions/drafts plus selected-chat and encrypted-pairing preferences: unchanged. The app had zero saved active requests before upgrade. Backups are ignored under `bridge/data/pre-reliability-backup/`.
- The original bridge was **not restarted**; authenticated health still reported protocol v4/eight slots. No microphone, keyboard, font, battery, network or security setting was changed. The two isolated test packages were uninstalled afterward to avoid duplicate launcher entries.

## Lifecycle matrix: evidence and limitations

The earlier baseline had two complete phone runs passing background completion, app force-stop/relaunch, listener offline/online, graceful bridge restart with parallel jobs/pending approval, and repository-action restart. These used real Durable storage/worktrees and a deterministic fake Pi child, not provider inference.

A later run with stronger setup assertions passed background and force-stop, then failed offline: local history still said `queued` while the test expected `running`. Server dispatch is not proof that the app has received a running status. The harness now waits for repeated app-only GET observations; Python readiness uses the fixture's stdin protocol so it cannot accidentally satisfy the app-observation condition. **The revised full lifecycle matrix has not been rerun**; do not call it deterministic or fully green on 0.6.1. The obsolete assertion that a connection error is persisted in progress was removed: freshness is now intentionally ephemeral and checked by the dedicated UI test instead.

The enhanced repository-action case waits for a real shell dispatch marker, restarts the fixture and checks that same-operation-ID retry does not append it again. **This enhancement has not yet run.** Existing bridge repository-action non-replay tests still pass.

Secure pattern lock was detected, so lock/unlock was skipped; no credential or security setting was changed. Abrupt Termux/process death, Doze/battery pressure, provider-internet loss, real-provider lifecycle work, notification delivery and foreground-service behavior remain unverified. Listener loss tests specifically local HTTP reachability, not provider connectivity. A graceful fixture restart is not a force-kill test.

Failure state is retained privately at `/data/data/com.termux/files/usr/tmp/pocket-lifecycle-__o2m73q`; do not publish its databases/logs. Cleanup stopped the fixture processes. Do not delete a journal/lock merely to tidy a failed run.

## Reproduction and phone-test etiquette

**Announce disruptive phone tests before running them.** The user found the rapid lifecycle loop's starts/stops confusing. Prefer fresh pi-droid observation and deliberately scoped interactions; do not resume the full loop automatically. The test APK has the normal visible app label, despite its separate application ID.

Build with the README/PROGRESS toolchain, adding `-PreliabilityTests=true` to `assembleDebug assembleDebugAndroidTest lintDebug`. Inspect package identity before installing **both** APKs. This opts into separate packages `dev.pipocket.reliability` and `.test`; fixture tests refuse to seed/reset the production package. Default builds remain `dev.pipocket`. APK output paths are shared, so rebuild without the property before normal deployment.

Focused real UI check and normal regression suite:

```sh
adb -s <authorized-serial> shell am instrument -w \
  -e class dev.pipocket.LiveStatusUiTest,dev.pipocket.RequestStatusTest,dev.pipocket.HistoryTest,dev.pipocket.LayoutTest,dev.pipocket.ReviewUiTest,dev.pipocket.SessionDrawerTest \
  dev.pipocket.reliability.test/androidx.test.runner.AndroidJUnitRunner
```

Only after agreeing visible lifecycle transitions with the user:

```sh
python scripts/check-reliability.py --serial <current-authorized-serial> --scenario offline
# Other scenarios: background, force-stop, restart, review-restart, all
```

The matrix creates a disposable Git repository and localhost bridge using fake Pi RPC. It never reads production `.env`, changes production pairing, or restarts the normal bridge. It force-stops only the fixture APK; instrumentation also terminates that app at phase boundaries. Temporary state is removed on success and retained on failure. No models, microphone or system-setting changes. Lock testing is explicitly opt-in and only appropriate after confirming there is no secure lock; the current phone requires user assistance instead. Never force-stop Termux from this same-phone harness: it also hosts the agent/live bridge.

## Next increment: use the existing tmux + Termux wake-lock setup

**Update:** explicit management tooling and admission-paused graceful-stop tests are implemented; **production migration, foreground verification and a user-assisted actual-app screen-off/recovery test are complete**. A single real `sleep 120` job was running before the user's off interval, completed once with its expected marker and same UUID, and showed DONE in Pi Pocket after return. Independent continuous Asleep instrumentation and longer/Doze/stress scenarios remain unverified. See [bridge-work.md](bridge-work.md) for exact evidence, commands, the initial legacy-server migration gate and recovery. After user confirmation, the idle bridge was privately backed up and gracefully migrated to a new dedicated `work:pocket-bridge` window, preserving all 14 task records, 85 state/config/session/worktree file hashes and the existing work pane. Actual Termux wake-lock ownership was observed before and after migration. Existing tmux configuration/hooks were unchanged. The findings and sequence below record the original proposal.

**User-selected direction; not verified for survival.** Prefer building on the existing Termux setup before introducing another Android background mechanism. Notifications remain a separate proposed increment.

### Read-only findings from this session

- `~/.tmux.conf` uses zsh, mouse support, a 20,000-line history and one-based window/pane indexes.
- Sessions `work` and `2` were present, each with one attached window and a Node foreground command. Pane contents were **not** read; do not assume which Node process each runs.
- Both configuration and effective tmux hooks showed `session-created` calling `termux-wake-lock` and `session-closed` calling `tmux has-session 2>/dev/null || termux-wake-unlock`.
- The configuration warns that Termux's wake lock is shared: do not introduce competing per-Pi unlock wrappers.
- Actual wake-lock ownership/held state was **not checked**. Hooks alone do not prove it is held, especially for sessions that existed before the hooks were loaded.
- The PID in `bridge/data/bridge.pid` was verified against the bridge cwd and `src/server.js` command. Its parent was PID 1, rather than a tmux pane. This is already detached execution; moving it into tmux primarily adds discoverability/management, not immunity from Android process death.
- No tmux configuration, pane, process, bridge launcher or wake-lock state was changed. Session names and process identity must be rediscovered next time; do not hardcode a past PID or wireless ADB address.

### Implementation/validation plan

1. Recheck the current tmux configuration/effective hooks and discover process identity, active operations and device readiness. Inspect metadata only; do not capture terminal history, environment secrets or pane contents.
2. Verify whether the existing shared Termux wake lock is actually held using suitable read-only Android/Termux evidence. Distinguish configured intent from observed ownership. Do not automatically disable battery optimization/security settings or clear the phone lock.
3. Design a single explicit bridge launch/status/stop workflow in a clearly named **dedicated tmux window**, preferably under the user's `work` session. Do not replace its existing window or interrupt existing Pi/Node panes. Preserve cwd, ignored configuration, loopback binding and the exact production data/worktree directories. Do not put tokens in command arguments, window titles or logs. Never start a second bridge against the same storage.
4. Before migrating the production bridge, stop new app submissions, verify **all model and review operations idle**, back up idle private state, validate the PID/cwd/command, terminate gracefully and wait for the storage lock to clear. Start the same bridge under tmux, then verify authenticated health, pairing and saved worktree identity. Do not delete a lock to force startup. If idle cannot be proven, defer migration.
5. Do not add automatic restart/replay casually. A supervisor/relaunch does not establish that a previously dispatched external action is safe to rerun. Retain Durable interrupted-state/exact-ID recovery and account for possible surviving children after a crash.
6. Agree one visible device scenario at a time: detach/reattach, switch apps, short screen-off with the user handling the secure lock, then a longer screen-off period. Use an isolated fixture and harmless work first. Check completion, pending approvals, parallel jobs and test actions without duplicate dispatch. Fix/validate the revised lifecycle harness before treating it as a reliable oracle.
7. Record observed outcomes and limits; verify normal app/bridge/pairing/worktrees afterward. Do not claim that a short screen-off success proves Doze, memory-pressure, provider-network or all-night survival. Do not force-stop Termux from the same-phone agent/harness, since that would terminate the testing agent/live bridge too.

**Acceptance:** one identifiable bridge instance in its dedicated tmux window; existing work panes unaffected; observed wake-lock evidence; authenticated health and unchanged saved state; documented agreed background/screen-off outcome; stable IDs and no replay; clear recovery procedure if Android stops Termux.

**Limits:** tmux preserves terminal sessions and the wake lock can help keep the CPU awake, subject to Android restrictions. Neither guarantees survival if Android kills Termux, the device reboots or the user force-stops Termux. A Pi Pocket foreground service would not inherently protect the separate Termux process either. Research current official Android/Termux constraints before choosing further measures.

## Previous session

The originating handoff was written in local Pi session `01a14391-7662-719a-bf60-4710d05638e1`. Its device workflow used `android_ensure_ready`, `android_preflight`, fresh `android_look` and selector-based `android_find_and_tap`, with explicitly scoped installs/instrumentation. Preserve that deliberate interaction style, the accepted 0.6.0 design and the normal app's data.
