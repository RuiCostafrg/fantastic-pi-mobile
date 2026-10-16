# Explicit bridge management in the existing tmux work session

Implemented workflow; **production migration and foreground app verification are complete**. Phone background/screen-off acceptance is still pending. This does not change the Android UI/APK, tmux configuration, shared wake-lock hooks, pairing token or automatic-replay policy.

From the repository root:

```sh
scripts/bridge-work status
scripts/bridge-work start
scripts/bridge-work pause
scripts/bridge-work resume
scripts/bridge-work stop
```

`start` requires the existing `work` session and creates a detached, dedicated `pocket-bridge` window. It does not select or replace an existing pane. The window keeps its name and remains after exit so failures are inspectable. The foreground pane controller launches the same Node server from `bridge/`, loading the existing ignored `.env`; output goes to private `bridge/data/bridge.log` (or the configured data directory). No token is passed in command arguments or titles. No automatic restart, boot hook, session recreation or wake-lock command is added.

The Termux shell launcher uses this phone's Termux interpreter path and Node's native `--env-file`. It is not a general Linux service installer. `PI_DATA_DIR`, `PI_WORKSPACE`, `PORT` and the existing other bridge settings retain their meanings. Avoid overriding these in your calling shell: Node environment variables take precedence over `.env`. A different configuration is not a migration of the same bridge.

## Safe stops after migration

- Authenticated `GET /v1/maintenance` reports the admission flag plus **global model and review** queued/running counts.
- Authenticated `POST /v1/maintenance` with `{ "paused": true }` pauses new model/review IDs, serialized with admission transactions. New admissions get HTTP 429. Previously admitted exact IDs remain retrievable/retryable with their original content; approval responses and cancellation still work. Pausing does not cancel tasks or discard approvals.
- `stop` first pauses admissions. If any operation is active it **refuses to stop** and leaves admissions paused. Wait for completion/approval, then retry stop; use `resume` explicitly if deferring maintenance. The Android app may hold original-ID submissions waiting for admission; they are not cancelled by this flag.
- The controller additionally queries SQLite **read-only**, refusing if *any* Durable task is nonterminal, including pending, waiting or completing. It never opens a second Durable harness.
- Before signalling it validates lock PID, Node executable, bridge cwd, server entry point, process start ticks and HTTP owner PID; takes an idle private backup; then rechecks idle/identity and the admission gate.
- Only SIGTERM is used. It waits up to ten seconds for the server to release its storage lock. It never escalates to SIGKILL or deletes a lock. Errors leave the state for inspection.

Health remains protocol v4, with additive `processId`. The maintenance flag is intentionally process-local: an explicit start begins accepting again. Stable IDs and Durable restart recovery remain authoritative; maintenance does not authorize replay.

Backups are created under ignored `bridge/data/maintenance-backups/<timestamp>-<pid>/` with a consistent SQLite online backup, the private `.env`, Pi sessions and existing worktree/manifest files. Prior backups/logs/disposable fixtures are not recursively copied. Special files/symlinks in those trees make backup fail closed. These backups contain secrets/conversations/source and must never be published. Worktree `.git` files point to the original repository's shared Git metadata; **this is not an independent repository disaster-recovery archive**. Keep the original repository, Git metadata and worktree paths intact. No restore/delete/prune command is automated.

## First migration from the pre-maintenance bridge

This is an explicit exception, not a way around active-task checks:

1. Ask the user to stop new app submissions and confirmed review actions. Keep them paused through verification. Account for saved uncertain/sending IDs; do not assume health or an empty selected chat proves global idleness.
2. Run `scripts/bridge-work status`. Confirm the storage owner is the original bridge, authenticated health succeeds, `maintenance` is null (old endpoint returns 404), and `storage.idle` is true. Recheck read-only tmux/pane metadata and worktree identity. Do not inspect unrelated pane histories/environments.
3. After that user acknowledgement only:
   ```sh
   scripts/bridge-work stop --legacy-submissions-paused
   scripts/bridge-work start
   scripts/bridge-work status
   ```
   The legacy flag asserts the human submission pause; it cannot enforce it against the old server. It still requires all Durable tasks terminal, backs up private state, validates identity and rechecks immediately before SIGTERM. It refuses this flag on a server that supports maintenance. If the human pause or idle evidence cannot be established, **defer**.
4. Verify one owner under the new pane, protocol v4/eight slots (or the configured limit), matching token/config, saved task records and worktree manifests, and the original panes' unchanged IDs/PIDs. Verify normal app pairing/history using an agreed, announced observation; do not submit production work as an implicit test.
5. Only then allow submissions again. Do not treat a pending exact-ID request as permission to issue a new ID.

## Inspecting and recovering the dedicated window

```sh
tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index} #{pane_id} #{pane_pid} #{pane_current_command} #{pane_dead}'
```

Use normal tmux switching/detach/reattach to visit the dedicated window. Do not send keys to the user's other Pi/Node panes. The normal controller prints only startup/exit information; diagnostics stay in the private log.

After a successful graceful stop the dedicated pane remains dead. `start` refuses to replace an existing named window. Confirm **only** that window's pane is dead and storage has been released; close that dead window explicitly with `tmux kill-window -t work:pocket-bridge`, then run `start`. Never use kill-window as the bridge stop workflow, or while another process occupies that window.

If Android kills Termux, the phone reboots, or the server crashes: reopen Termux, inspect the bridge owner and possible surviving Pi/test/external children, and inspect uncertain job/action IDs and Git/device side effects. A stale lock blocks automatic start. There is **no automatic stale-lock cleanup**; remove a lock manually only after proving no owner/child remains and accounting for interrupted external work. Preserve databases and worktrees. Do not restore an old database over live work or resend uncertain actions with new IDs. Recreate/attach `work` deliberately if Android removed the tmux server; its existing hooks manage the shared wake lock. This workflow never calls wake-unlock.

## Later pi-droid migration

The current implementation mixes pi-droid tools with local host/ADB scripts. [pi-droid-migration-handoff.md](pi-droid-migration-handoff.md) inventories the source, extraction boundaries, test evidence and safety requirements for a later migration. That migration is not implemented and does not replace the current reliability acceptance work.

## Verification and remaining acceptance

```sh
cd bridge && npm test
cd .. && python scripts/check-bridge-work.py
```

The isolated test copies the launcher/server into a temporary checkout, creates its own `.env`, fake RPC peer, local repository and **separate tmux socket with an empty config**. It never reads production `.env`, uses the live tmux socket or touches phone UI/wake-lock hooks. It checks real tmux ownership, unchanged existing pane, duplicate refusal, pending-approval and running-review stop guards, pause/resume, private backup, graceful restart, unchanged persisted tasks/workspace and same-operation-ID shell non-replay.

Observed in this implementation session:

- Production checkout started clean at `a94ac05`. Before migration the original bridge was PID 25933, parent 1, with 14 terminal model tasks and zero nonterminal tasks. Authenticated health reported protocol v4/eight slots; the old server had no maintenance endpoint.
- After the user acknowledged the submission pause, rediscovery showed only the original `work` pane (`%0`, PID 28952); the earlier `2` session was already absent. All tasks were terminal and the bridge had no direct child processes. A mode-0600 private identity snapshot was saved at ignored `bridge/data/pre-tmux-state.json`. The legacy guarded stop created `bridge/data/maintenance-backups/2026-10-16T15-12-47.048Z-12372/` and released its lock gracefully.
- Production then started as PID 12431 under controller/pane PID 12416, pane `%2`, window `work:pocket-bridge` (`@2`). Authenticated health/owner matched at protocol v4/eight slots. All 14 exact saved task records and 85 state/session/worktree/config file hashes matched the pre-migration snapshot; the original pane ID/PID was unchanged. Effective configuration values, including the token, matched the original launcher configuration without printing them. Admissions were paused during verification and explicitly resumed afterward; zero active jobs/reviews remained.
- An announced pi-droid foreground check observed the preserved blank New chat, Ready when you are, and paired Send control. No request/microphone input was submitted. The only failed preflight check was inactive ADBKeyboard; Gboard was left unchanged because typing was unnecessary. The held Termux partial wake lock was observed again after migration.
- Existing `work` and `2` pane metadata were read only; no pane history was captured. Configuration/effective hooks still use session-created wake-lock and last-session-closed wake-unlock.
- Android `dumpsys power` explicitly reported `PARTIAL_WAKE_LOCK 'com.termux.app.TermuxService'`, UID 10226, and activity-services evidence showed the Termux foreground service. This proves a held lock **at that observation**, not perpetual ownership or survival.
- 42 bridge tests passed; isolated real-tmux workflow passed. No Android rebuild/install, visible lifecycle loop, screen-off test or security/battery/IME change was made.

### Opt-in short screen-off observation

After agreeing the visible step with the user, the isolated harness also supports:

```sh
python -u scripts/check-bridge-work.py \
  --screen-off-serial <current-authorized-serial> --off-seconds 30 \
  --report <private-result-path.json>
```

Run it independently of the interactive shell if returning to the user while it waits. It reports `waiting-for-screen-off` and waits up to five minutes for the **user** to turn the screen off. It never sends power/unlock keys or changes settings. After read-only Android power evidence reports Asleep, it runs a harmless real shell action in the disposable worktree while two parallel fake-RPC children retain approvals. It requires 30 seconds of sampled Asleep + held Termux wake-lock evidence, observation gaps under eight seconds, shell completion observed while off, preserved approvals, and the existing restart/exact-ID non-replay checks. Early screen-on fails the measurement. Missing, stale, replaced, unknown or gapped evidence is inconclusive rather than a survival claim. The current sampler does not require continuous wireless ADB.

`scripts/power_observer.py` starts one bounded Android-shell sampler over an explicitly authorized ADB connection. It then reads same-phone metadata locally, with no ADB calls during measurement. The detached sampler streams `dumpsys -t 3 power` into awk, recording only boot uptime, wakefulness and Termux wake-lock presence in a unique temporary `.pi-pocket-power-*` directory under shared Download storage. These non-confidential metadata files have shared-storage permissions: no raw dumps, UI, prompts, codes or tokens belong there. Same-phone visibility/freshness is verified before arming; remote-host topology fails closed. The sampler has a 420-second deadline, a sample cap, stop-file shutdown and self-removing remote script. After a confirmed exit, the trace is archived privately beside the report and the shared directory is removed. If exit is unconfirmed, leave the bounded sampler/metadata for later inspection and report the pending directory, not a forced kill. Final reports preserve observation metrics across later fixture/restart phases.

Eight deterministic observer tests cover stale/malformed/foreign-clock evidence, every intervening sample, wake/gap/wake-lock refusal, truncated traces, post-start ADB failure, final report retention, and a real large-dump shell regression. The latter caught Android external printf exceeding its single-argument size limit; streaming avoids it. A real awake-phone smoke test confirmed detached samples advance while all subsequent ADB calls are forced to fail; the sampler stopped and cleaned up. The normal real-tmux harness and all 42 bridge tests passed again. This is not yet a physical screen-off pass.

This is **bridge-only**, not an Android-app lifecycle or real-provider test. Power/HTTP sampling and a held wake lock make it unsuitable evidence for idle Doze or battery-pressure survival. Two earlier physical attempts (`bridge/data/screen-off-check-20261016-172151/` and `screen-off-check-20261016-205510/`) lost ADB during the waiting phase before any Asleep evidence: **no valid screen-off result**. Production status remained healthy when checked after each observer failure. Network changes/disabled wireless debugging were separately observed; the exact cause of each transport drop was not established. Later the prior bridge was found absent for an unknown reason and explicitly recovered after verifying idle state and unchanged saved records/files; see PROGRESS. Do not attribute that absence to screen-off.

Latest detached-sampler physical attempt: ignored `bridge/data/screen-off-check-20261016-211140/`, **inconclusive**. It recorded 126 Awake samples, then became stale before Asleep; the shell-completion phase was not reached. After the user's reported off/unlock interval, production retained PID 16784, all 14 exact task records and 85 saved file hashes matched. Authorized reconnect found the exact sampler process absent (no done marker); archived metadata and cleaned only its own script/shared directory. The changed ADB port/absent sampler do not establish the precise cause. Detachment and mocked ADB errors are not proof of surviving a real adbd lifecycle change. Further work should diagnose that seam while awake before another user screen-off repetition.

Still pending: one agreed background/screen-off scenario at a time (isolated harmless work first). Production migration and the normal foreground app check are complete. The phone's secure pattern stays unchanged; the user handles unlocking. Never force-stop Termux from this same-phone agent. Existing full phone lifecycle-matrix limitations in [reliability-baseline.md](reliability-baseline.md) still apply.

Tmux adds persistence/discoverability; the shared wake lock can keep the CPU awake subject to Android restrictions. Neither prevents Android killing/force-stopping Termux or device reboot. Short tests cannot establish Doze/memory-pressure/provider-network/all-night reliability. Notifications and further Android background mechanisms remain separate work requiring current official-platform research.
