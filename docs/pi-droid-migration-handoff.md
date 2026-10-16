# Local reliability scripts into pi-droid

## Implementation update: first extraction increment

Implemented on the user's subsequent request; the original handoff below is
historical. Pi-droid now exports read-only host identity and passive power
observation helpers with exact-transport pinning and structured evidence-loss
outcomes. Details and limits: `~/projects/pi-droid/docs/local-reliability-helpers.md`.
Pocket's optional external adapter is documented in
[plugins/pi-droid-pocket/README.md](../plugins/pi-droid-pocket/README.md).
Its start/pause/resume/stop actions require approval and explicit confirmation;
its heartbeat/unload never manage production. Dedicated tmux names are now
configurable, retaining the original defaults.

Validation: pi-droid lint/build and 585 CI-safe tests; Pocket adapter contract,
42 bridge tests, and isolated real-tmux harness passed. No production restart,
plugin activation, pairing, physical screen-off test, UI/settings mutation,
commit or push. Admission, backup and exact-ID non-replay remain in Pocket.
The standalone controller is retained. Generic tmux lifecycle, pairing and
replacement of the physical harness observer are deferred; concurrent edits to
that observer were detected and deliberately left untouched. Physical acceptance
and APK lifecycle limitations are not resolved by this extraction.

---

## Intent and priority

The user asked for a handoff so the local automation can later be migrated into pi-droid. **This is notes only; no pi-droid migration has been implemented.** Finish the current Pi Pocket background-reliability increment first. Keep the accepted app UI and durable exact-ID/non-replay behavior.

Source checkout: `~/projects/pi-pocket`. Target checkout: `~/projects/pi-droid`. Read the target repository's current instructions, README, PLUGINS.md and actual exports before designing/implementing; paths/interfaces below are starting points, not a committed API design.

## What actually ran

This work was a mix, not pi-droid alone:

| Part | Current implementation | Later destination |
|---|---|---|
| Screenshot reading, device discovery, secure reconnect attempts, app foreground observation | Existing pi-droid tools plus saved-screenshot reader | Reuse existing tools; no duplicate screenshot/ADB stack |
| Pairing after the user supplied a fresh screenshot | Local Python subprocess driving `adb pair` with private FIFO/stdin | Consider an explicit-consent secure pairing operation; never conflate pairing with reconnect |
| Bridge start/status/pause/resume/stop | `scripts/bridge-work` + `scripts/bridge-work.mjs` | App-specific optional adapter/plugin over reusable host process/tmux helpers, if appropriate |
| Admission gate/global job and review counts | `bridge/src/store.js`, `bridge/src/server.js` | Remains Pi Pocket server responsibility; a plugin may invoke it |
| Disposable tmux/restart/screen-off harness and detached same-phone sampler | `scripts/check-bridge-work.py`, `scripts/power_observer.py`, `scripts/test_power_observer.py` | Generic passive power/transport observation can move to pi-droid; keep Pocket fixture/journal assertions app-specific |
| Bridge/maintenance integration tests | `bridge/test/maintenance.test.js`, existing bridge suite | Retain in Pocket; add target-package contract tests for extracted helpers |
| One-word gym launcher | `~/.pi/agent/bin/gym`, built on the user's zsh work/tmux setup | User convenience, not automatically part of Android automation core |

No pi-droid source/build/config change was made for this request. The rejected manual pairing wizard is scratch material, not migration source.

## Source behavior to preserve

### Host-side tmux bridge control

The shell launcher changes into `bridge/`, loads its existing private `.env` with Node's native env-file support and calls the management module. The module targets existing session `work`, named window `pocket-bridge`, preserves other panes, disables renaming on its own window and retains its exited pane. The bridge binds loopback only. Controller/server output goes to private diagnostics, not terminal history. No automatic restart/boot mechanism.

Status validates storage-lock PID, cwd, Node executable, server entry point, `/proc` process start ticks and HTTP health owner; queries SQLite read-only for all nonterminal Durable tasks. Stop pauses admissions, requires all model AND review operations idle and every Durable task terminal, backs up private state, rechecks identity/idleness/gate, SIGTERMs, and waits for lock release. It never deletes a lock, force-kills, opens a competing Durable harness, or authorizes external-action replay.

Backups use SQLite's online backup plus private config, Pi sessions and worktree files/manifests. Old backups/logs/fixtures are not recursively copied. Special files/symlinks make the existing copy fail closed. Worktree .git files reference the original Git metadata; these are not independent disaster-recovery repository archives.

Termux `/proc/PID/exe` quirk observed: resolve the **readlink target** before comparing with Node; direct fs.realpath on the proc symlink unexpectedly resolved to linker64. Preserve a regression at that platform seam if generalizing.

### Pocket maintenance API

Authenticated protocol v4 health has additive `processId`.

- `GET /v1/maintenance`: admissionsPaused, global queued/running model count, global review count, idle.
- `POST /v1/maintenance` with `{paused: boolean}`: serializes pause/resume with new-ID admission. Paused new IDs get 429. Original IDs still recover their saved results; approvals/cancellation remain available.
- Pause is ephemeral and an explicit start accepts again. If stop is refused because work is active, it leaves admissions paused for an explicit resume or later stop.

This gate belongs beside the actual server admission transaction; a host plugin cannot recreate its safety from a cached status check.

### Isolated test and passive screen-off observer

`check-bridge-work.py` copies the launcher/server to a temporary checkout, provides its own synthetic config/token, fake RPC peer, local Git repository, node_modules symlink and **separate tmux socket/empty config**. No production .env or production tmux hooks are used. It checks other-pane identity, exclusive launch, approval/review stop guards, backup, graceful restart, unchanged tasks/workspace and same-operation-ID shell non-replay.

Opt-in flags: `--screen-off-serial SERIAL --off-seconds 30 --report PRIVATE_JSON`.

The screen-off branch prepares two parallel fake pending approvals, waits at most five minutes for user screen-off, parses read-only `dumpsys power` for Asleep and a held Termux partial wake lock, then executes a harmless real shell action in the third fixture worktree. It requires sampled Asleep/wake-lock evidence for the target interval, gaps under eight seconds, shell exit zero/completion marker while off, approvals preserved, then the normal restart/non-replay checks. BOOTTIME is used for interval/gap timing. User handles secure unlock; no power/lock/setting actions during measurement.

Limits to fix or carry explicitly during extraction:

- Report retention is now fixed: the final JSON carries observation metrics forward across later fixture/restart phases. Missing/unknown/stale/gapped evidence is inconclusive, distinct from positive work/assertion failures.
- Continuous ADB sampling was replaced after two waiting-phase transport failures. `power_observer.py` launches a detached, bounded Android-shell sampler through the explicit authorized serial, then reads a unique same-phone shared-storage trace locally. Only boot uptime/wakefulness/Termux wake-lock presence is shared, never raw dumps or credentials. A 420-second deadline and stop-file shutdown bound it; confirmed exit archives privately/removes shared files, uncertain exit reports pending cleanup. A remote ADB host cannot assume this topology.
- The sampler streams large power dumps into awk. A regression that emulates Android's external printf reproduced its >128 KiB single-argument failure before this fix. Eight deterministic observer tests and a real awake-phone detached-sampler smoke test pass; the latter keeps reading after all subsequent ADB calls are forced to fail. Normal fixture and 42 bridge tests passed again. A real screen-off outcome is still pending.
- Never silently retarget a measurement or conceal observation gaps across reconnects.
- ADB failure before any Asleep evidence is not a screen-off result. A short polled/held-wake-lock test is not Doze, battery pressure, all-night, app reconnect or real-provider evidence.
- Existing full fixture-APK lifecycle matrix has separate unresolved synchronization/retest limitations; this host-only harness does not make that matrix green.

## Secure ADB and secret handling lessons

The user switched from home to gym Wi-Fi and back. Addresses and secure debugging ports changed; wireless debugging was also disabled at one point. A changed address alone does not prove pairing expired. Discover and **verify** reconnect before asking to re-pair. Discovery output alone is not an authorized connection. TCP reachability is not a successful TLS/authenticated ADB session.

pi-droid already documents `android_wifi auto` using adb mDNS then multicast-dns `_adb-tls-connect._tcp.local` fallback, secure authorized transport verification and bounded recovery. Reuse/review that implementation rather than copying a second discovery mechanism. Legacy `adb tcpip 5555` remains excluded.

Fresh user-consented pairing succeeded locally with a temporary code from the requested screenshot. A subprocess read the code via a mode-0600 FIFO in a private directory, removed the FIFO, and passed the code to `adb pair` stdin. No code in subprocess argv, runtime logs or retained files. Do not migrate screenshots, real codes, adb private keys, tokens or credential-bearing fixtures into the repository. User screenshots/chat may already contain the one-time code; do not repeat it in summaries.

The old manual pairing wizard/window was rejected by the user and closed while still awaiting input. Preference: agent runs commands, reads feedback and asks only for necessary consent/input. Do not recreate a manual wizard without asking.

## Separation and consent gates for a future implementation

- Distinguish host Termux operations from device ADB operations. A remote/multi-device pi-droid host need not share the phone's `/proc`, filesystem, UID or tmux server. Detect capabilities rather than assuming this same-phone topology.
- Generic pieces may be host process/tmux identity and passive device power evidence; Pocket database/schema/token/state remain an adapter. Exact names/API/plugin placement require target repo review.
- Make mutating operations explicit and approval-gated. Status/preflight must not quietly pair, wake/unlock, stop production, delete locks or replay side effects. No autonomous plugin cycle that restarts a bridge.
- Reuse the user's shared Termux tmux wake-lock hooks. Never add competing wake-unlock ownership. Configure session/window names rather than hardcoding work/gym in a general library.
- Keep credentials in trusted local storage/in-memory/stdin, outside schema examples, argv/titles/diagnostic output. Define private backup permissions/retention and cancellation behavior.
- A stale lock or unknown owner causes a structured refusal, not forced cleanup. Validate instance identity again immediately before mutation. Treat active/unknown model OR review work as a stop blocker.
- Before adding Android background mechanisms or survival guarantees, research current official Android/Termux restrictions. Preserve secure lock and user-controlled unlock. Never force-stop Termux from this same-phone agent.

## Physical sampler finding to carry into migration

The actual detached-sampler screen-off attempt (`bridge/data/screen-off-check-20261016-211140/`) remained inconclusive: 126 Awake samples, then stale data, no Asleep interval and no shell-completion phase. On reconnect with a changed ADB port the exact sampler process was absent and its done marker was absent. After verifying absence, its script/shared directory were cleaned and trace retained privately. Production retained the same PID, all 14 task records and 85 saved file hashes unchanged across the user's reported screen-off/unlock interval. Record that limited evidence separately from the failed measurement.

**Do not advertise detached sampling as robust to actual adbd service/transport restarts.** Tests forcing subsequent host ADB calls to fail prove only that reads no longer call ADB; the awake smoke proves ordinary shell detachment, not lifecycle survival. The actual sampler death cause is unresolved. Diagnose while awake before another disruptive loop; compare authorized shell child/process-group lifetime and consider an explicitly scoped fixture-APK PowerManager recorder if the shell seam cannot survive. Any change needs fresh consent, isolated tests, no privileged battery/security changes, and evidence preserving observation-versus-work failures.

## Evidence and current continuation

42 Pocket bridge tests passed; standalone real-tmux harness passed; synthetic power-parser/control-flow checks passed. The first physical screen-off observer failed on unavailable wireless ADB before Asleep evidence, so no valid physical outcome was established. Production was later found absent; its stop cause is unknown. Saved 14 task records and 85 state/config/session/worktree hashes matched; no related process/listener remained, fresh private backup preceded explicit recovery. Do not attribute that absence to screen-off.

At handoff creation, current production was explicitly recovered and authenticated healthy, protocol v4/eight slots, admissions open, zero active jobs/reviews, 14 terminal tasks. Rediscover all PIDs, addresses and paths; no hardcoded live values are acceptance evidence. Existing current-state handoff: `~/.pi/agent/handoffs/pi-pocket-gym.md`. Main implementation/evidence: `docs/bridge-work.md`, `PROGRESS.md`, `docs/reliability-baseline.md`.

Original reliability work remains the immediate next step. Keep the Wi-Fi fixed for an agreed short physical observation, record its actual outcome, then decide whether to undertake this separate migration. No commit/push or implementation migration is authorized by this notes file.

## Future-session prompt

Read docs/pi-droid-migration-handoff.md in ~/projects/pi-pocket. First confirm the current reliability increment's actual evidence and dirty checkout. Then inspect ~/projects/pi-droid's current instructions, secure reconnect, command execution, tools and plugin APIs. Propose a small extraction boundary for the reusable local helpers, leaving Pocket admission/journal logic in Pocket. Preserve explicit consent, secret handling, one storage owner, shared wake-lock ownership and exact-ID non-replay. Add isolated contract tests before replacing working scripts; do not restart production or commit/push without approval.
