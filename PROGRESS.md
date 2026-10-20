# Fantastic Pi Mobile recovery and progress

## Run one small step at a time

For implementation sessions, read [docs/next-steps.md](docs/next-steps.md).
It splits the first coding milestone into nine bounded steps with completion
criteria. **Steps 01–09 completed — 2026-10-20:** source trace and smallest compatible
multi-project design are in [docs/multi-project-design.md](docs/multi-project-design.md).
Step 02 added the trusted registry. Step 03 adds immutable chat/job/review bindings,
project metadata in accepted task inputs, a frozen default and atomic legacy mapping
before Durable resume. Legacy manifests (including manifest-only chats and incomplete
preparation) and saved workspace metadata are checked without repair/reset; ambiguous
or foreign evidence blocks startup. Existing IDs/worktree paths/branches/dirty state
and dispatched-action non-replay remain intact. Default configuration cannot silently
change after reopen. Invalid bootstrap branch/remote policy now fails at startup.
Step 04 now routes coding and every review/test/commit/merge path through the same
binding-aware adapter (`bridge/src/project-workspaces.js`), with revalidated cached
managers per registered project. Removed the internal non-default execution gate;
reopen accepts valid non-default bindings without rewriting their identities.
Step 05 adds authenticated project listing/explicit registration, immutable chat
binding lookup and optional job `projectId` forwarding/validation. Existing review
routes carry accepted project identity. Registration requires explicit trusted
source/policy confirmation and cannot execute work. Protocol 5 advertises
`projectBindings: true`; unsupported stores reject selected-project requests with
426. The contract, including mandatory client preflight against old bridges, is in
[docs/project-api.md](docs/project-api.md) and README's API table.
**Step 06 is complete; isolated Android database verification now passed.**
`History.kt` now has schema-4 project identity/state migration source and transactional
selection/request/binding persistence; new `ProjectRequests.kt` drives the actual
Main/Changes Activities' capability gates and strict response ownership checks.
Unbound new chats cannot silently select default; upgraded history/drafts remain
legacy-unresolved until backend evidence proves a binding. Saved job/operation IDs,
legacy review JSON, drafts, lifecycle and pairing identities are retained. Proved
legacy targets are persisted before dispatch and attached explicitly to transport
payloads; a lost response cannot retarget a retry to a replacement default. The
connection helper also freezes endpoints across multi-call proof/POST sequences. Wrong
project data cannot become a current result/approval or silently retarget a retry.
Permanent new-submission project errors stop automatic polling; accepted uncertain
work is not treated as stopped. Step 06 did not include a picker (step 07 below).
Added 15 headless JVM policy tests plus fixture-only Android data tests for upgrade,
reopen and conflict rollback; updated v1/v2 history and fixture protocol expectations.
Both normal and `-PreliabilityTests=true` builds passed `testDebugUnitTest`,
`assembleDebug`, `assembleDebugAndroidTest`, `lintDebug` with the existing native AAPT2
override; **15/15 host tests passed**. `cd bridge && npm test` **67/67 passed**;
`git diff --check` passed. After the user returned and authorized continuation,
secure Wireless debugging rediscovery reconnected the paired phone. Native Termux ADB
bypassed the earlier incompatible SDK ADB; fresh metadata and actual AAPT2 badging
verified only `.reliability` / `.reliability.test` APK identities. Installed those
previously absent fixtures and ran ONLY headless `HistoryTest` (7),
`ProjectHistoryTest` (3), `RequestStatusTest` (4): **OK (14 tests)**, covering actual
Android SQLite v1/v2/v3 upgrades, identity persistence/reopen, conflict rollback and
status handling. No code fix was needed. Fixture packages were removed afterward.
The fixture build/lint passed again; `testDebugUnitTest --rerun` actually reran all
**15/15 host tests**, and `cd bridge && npm test` reran **67/67 passing tests**.
Normal app versionCode 7 / 0.6.1 and install timestamp were unchanged; no normal
database/history/pairing read or migration, Activity test, production journal access,
bridge restart or provider action. Fresh localhost:8787 probe: ECONNREFUSED. Only
evidence docs changed on this continuation; earlier local work is preserved, all
uncommitted, nothing pushed.
**Step 07 complete — 2026-10-20:** added a small native
new-chat project picker, manual trusted-source registration with policy review and
explicit confirmation, and persistent project identity/details for established chats.
Existing/submitted/archived chats cannot switch projects. Empty legacy drafts need
backend absence proof; missing/conflicting bindings, old/offline bridges and empty
registries never fall back to default. No job is sent by selection/registration.
Dialog/lifecycle/endpoint guards reject stale responses. Reused schema 4 without a
new migration. Added 7 host policy tests (now **22/22 passed**) and 3 fixture-only UI
tests. After the user explicitly said “run them”, verified secure ADB/device and
actual isolated APK identities, installed only previously absent fixtures, and ran
only `ProjectPickerUiTest`: **OK (3 tests)** twice. Initial run exposed a test-only
cold-launch race (native button present but accessibility root null); reproduced it,
fixed the bounded fixture-owned target wait, removed probe instrumentation, then
passed both full reruns. No app runtime code fix needed. Both normal/fixture unit/
build/test-APK/lint passed again; final host task actually reran **22/22**. Earlier
bridge tests **67/67 passed**; diff checks clean. Both fixtures removed; normal app
version/update metadata unchanged. No normal history/pairing access, normal Activity
launch, production migration/restart, provider action or phone setting change.
**Step 08 complete — 2026-10-20:** added a separate-process fixture bridge/fake RPC
worker, real dropped-acceptance-response proxy and four headless Android lifecycle
phases using actual Connection/ProjectRequests/History. Two projects retain exact
job/project IDs, results, selected chat/draft/pairing across offline/client-process
closure; B completes with no Android client and HTTP offline. Wrong results and
approval targets fail; cancelling a third chat leaves A's approval live. Saved review
JSON/operation ID survives response loss and recovers/retries once without duplicate
dispatch. Per-worktree markers/source-staging checks prove no cross-writes/replay.
The full Android lifecycle harness **passed twice**, plus **14/14 data/status**,
**22/22 JVM**, **68/68 bridge** tests and normal/fixture build/test-APK/lint.
An existing isolated real-tmux regression caught the controller still requiring
protocol 4; reproduced `health-unverified` / protocol 5, allowed numeric 4/5 without
weakening owner/idle/backup checks, and reran the same harness **PASS**. No app runtime
or schema change. Temporary fixtures removed; normal package metadata unchanged.
No normal history/pairing access/migration, Activity launch, production journal,
bridge start/restart, provider, phone settings or screen-off scenario. Evidence:
[docs/project-lifecycle.md](docs/project-lifecycle.md). Diff checks clean.
**Step 09 complete — 2026-10-20:** after the user requested deployment/smoke,
backed up private bridge/Android state and checked idle work. Initial legacy
startup correctly failed on four old job snapshots lacking only repositoryRoot.
Added a red/green regression and allowed that absent redundant field only after
manifest/real-tree proof; conflicts/core omissions still fail, snapshots unchanged.
Deployed normal **0.7.0 (versionCode 8)** and independently owned protocol-5 bridge.
Actual schema **3→4** migration and final smoke checks preserved all original
**12 sessions / 25 jobs**, pairing, **21 bridge tasks / 217 saved files** and all
main/disposable-source HEAD/staging. Two native-selected disposable projects ran
real Pi coding requests; matching one-file diffs inspected, explicit Changes tests
returned **STEP09_A_TEST_OK / STEP09_B_TEST_OK**, exit 0/current revision.
Home/reopen and completed-client force-stop/relaunch preserved B selection/result/
binding/check; A remained independently selectable. Legacy messages/default binding
reopened read-only (no new legacy request). **69/69 bridge**, **22/22 JVM**, normal
build/test-APK/lint and diff checks passed. App reopened; final bridge verified,
ready, admissions unpaused, jobs/reviews/active tasks 0, 25 terminal tasks.
No commits/merges/pushes, screen-off/host-death test, history deletion or settings
change. Private backups/test chats/worktrees retained. Full evidence:
[docs/project-deployment.md](docs/project-deployment.md).
Next: **stop — Milestone A complete**. Agree/decompose the next milestone separately.
Implementation/test details: [docs/project-picker.md](docs/project-picker.md).
Step-06 data evidence: [docs/android-project-state.md](docs/android-project-state.md);
full step log: [docs/next-steps.md](docs/next-steps.md). Step-09 normal deployment
is now verified; future disruptive deployment/tests still need agreement.
All changes remain local/uncommitted,
nothing pushed. The roadmap below is context, not one
large work request.

## Current product goal and coding-first roadmap — 2026-10-19

**This section is the current priority order.** Older dated plans, PIDs, package names,
“next” steps and uncommitted-work statements below are historical unless explicitly
reconfirmed. This is a roadmap, not a claim that the unchecked features exist.

### Goal: my own durable personal agent, with T3 Code-like coding workflows

Build one personal agent with multiple independent conversations: general chat,
research, personal knowledge and project coding. Android, a terminal/Pi CLI
integration, a future website, and eventually Discord/Slack mentions are different
clients of that agent, not separate bots that copy histories between themselves.

**User-selected order: make the app useful for coding in other projects first;
then use that working coding app to build the richer chat/personal-agent experience.**
Keep the accepted mobile UI and existing review/approval/non-replay safeguards.
Use T3 Code as a workflow reference, not as a requirement to clone its entire UI.
Current deployment is local on the existing Android phone/Termux; the earlier
“iPhone” wording was not a verified iOS deployment. Actual iPhone-local hosting
would require a separately scoped design and platform checks.

### Durability contract: stored state is not a running process

- SQLite/Pi Durable persist accepted work, stable IDs, dispatch intent and results;
  they do not keep Android/Termux alive or execute jobs while every host is stopped.
- The bridge/worker must have an independently owned lifecycle: closing Android UI,
  disconnecting a terminal, or closing a future CLI client must not stop admitted
  work while the bridge and its required processes remain alive.
- Reopening a client must recover conversations, drafts/selection as appropriate,
  runs, results and current approval/status evidence without submitting a new job.
- If the bridge dies, saved history must survive. Recovery reconciles persisted
  intent with actual execution: undispatched work may resume; uncertain dispatched
  shell/device/network/repository actions remain interrupted/unknown until checked.
  Never advertise “exactly once external effects” or silently replay uncertain work.
- A deliberately user-closed CLI conversation is not permission to cancel another
  client's run; cancellation targets an explicit run ID. Stopping the host/Termux
  is different from disconnecting a client.
- One active owner executes against a local Durable journal. Do not sync/copy a
  live SQLite database between devices or open it as multiple executing harnesses.
  PC/web clients initially connect to that owner; offline multi-writer sync is not
  part of the first milestone. Phone hosting must be reachable/alive for remote use.

### Milestone 1 — coding-ready across projects (next implementation priority)

Existing capabilities to reuse: multiple chat IDs, one active job per chat,
configurable concurrency, isolated per-chat worktrees, Changes/diffs, explicit
selected-file commits, recorded test evidence and guarded local merges. These
already exist; the next increment connects them to an intentional project workflow.

- [ ] **Project selection per conversation.** Register/select a trusted local Git
  repository, show its identity/location/default branch and bind the chat to it.
  Today the bridge is configured around one global `PI_WORKSPACE`; do not pretend
  multi-project selection already exists. A configured offline local repository
  remains valid; a GitHub remote is not mandatory.
- [ ] Persist the project binding alongside accepted requests. Preserve legacy chats
  by assigning their existing repository/worktree without changing request IDs or
  copying their work into a different checkout. Unknown bindings fail clearly.
- [ ] New chats can select another project; existing chats cannot silently switch
  repositories under a running job, pending approval or unresolved review action.
  Show which project/branch a coding request will operate on before Send.
- [ ] Preserve per-chat worktree isolation and original-checkout safety. Concurrent
  projects/chats must not share working files or transplant approvals/context.
  Missing repositories, changed branches and absent dependencies fail explicitly;
  there is no automatic fallback to an arbitrary shared directory.
- [ ] Make code review practical on the phone: discover changes, inspect readable
  diffs, run an exact approved test command, inspect actual exit/output/revision,
  commit selected files and explicitly integrate. Reuse existing controls; improve
  only proven friction. Committing, merging, pushing and creating a PR are distinct
  actions; no automatic publishing from a normal chat response.
- [ ] Keep runtime state/secrets outside public Git changes and disposable worktrees.
  Document that a worktree does not automatically inherit ignored `.env` files or
  installed dependencies, and that filesystem/tools/phone remain shared resources.
- [ ] **Code the app using the app, safely.** Develop in an isolated branch/worktree,
  build/test away from the serving runtime, review then explicitly promote/install.
  A model must not replace its own live bridge or restart production mid-task.
  Enable/verify the existing CI template only after checking workflow permissions;
  a CI watcher/release/install flow follows, not an unapproved auto-update loop.
- [ ] **Acceptance:** use two disposable local repositories and separate chats;
  edit/test/review in each, verify no cross-project writes, preserve unrelated
  staging, close/reopen the Android client and recover the same IDs/results. Also
  verify old migrated chats still find their existing worktrees. Run deterministic
  regressions first, then one announced pi-droid actual-app scenario. No test merge
  should touch the real project default branch.

### Milestone 2 — one durable conversation core, Android + terminal

- [ ] Define the small shared interface for listing/opening conversations, sending
  messages with idempotency keys, reading/streaming events, answering an exact
  approval and stopping a run. Keep client-specific rendering out of execution.
- [ ] Decide and implement canonical ownership: the core owns conversation/message
  IDs, ordering, project bindings, run state and approval records; Android history
  becomes a reconciled cache plus appropriate local UI state. Current Android
  SQLite, Durable task journal and per-chat Pi CLI session files are not yet this
  unified model. Migrate existing data with backups and comparison tests.
- [ ] Add a minimal terminal client or explicit Pi extension integration against the
  same core. Standard Pi CLI does not automatically attach to a Durable conversation;
  distinguish live attachment from session import/export or handoff. Do not replace
  the functioning real-Pi tool environment just to make the diagrams simpler.
- [ ] Persist/reconcile event cursors, messages and approvals so reconnects do not
  duplicate a Send, lose results or revive obsolete approval controls. Receiving
  the same external event twice must not create two runs.
- [ ] **Acceptance:** start a coding conversation on Android, continue it through
  the terminal integration, disconnect that client while work runs, reopen Android
  and see the same conversation/result exactly once. Test simultaneous sends,
  offline reconnect, orderly restart and uncertain dispatch handling separately.

### Milestone 3 — richer personal chat, knowledge and research

After the coding foundation is useful, build these features through that app:

- [ ] Personal conversations without a mandatory Git repository. Use an explicitly
  designed personal workspace/tool policy, not a shared-checkout fallback for failed
  coding setup. Keep multiple independent chats and an understandable agent identity.
- [ ] **Search yesterday:** opt-in retrieval across approved app/Pi conversations,
  project docs and notes, returning exact source/session links. Start with lexical
  full-text search, identifiers and recency; evaluate semantic retrieval later.
- [ ] **Remember this:** explicit scoped memory with source, verification state,
  correction/deletion and user-visible proposed text. Separate user preferences,
  observed facts, model inferences and stale operating evidence. Do not inject every
  private conversation into every chat or treat a wiki page as trusted instructions.
- [ ] Trial `pi-para` in an isolated config/wiki/RPC session before implementing a
  second knowledge engine. Check Android native dependencies, Pi API compatibility,
  eight-process concurrency and scheduler lifecycle. No global install/automatic
  capture/production dependency bump as a side effect of research.
- [ ] Research pipeline: one explicit search backend initially, primary-source
  fetching, bounded downloads/conversion, immutable source snapshots, citations,
  contradictions and uncertainty. Local-first retrieval must not silently upload
  a private query to a public provider. Add PDF/document conversion on a tested corpus.
- [ ] Android share inbox: text/URLs first, then user-shared screenshots/files with
  URI permissions and import limits. Offer Save/Explain/Compare/Extract tasks/Research;
  receiving content creates a draft, not automatic execution of its instructions.
- [ ] Open loops and decision receipts: source-linked unresolved questions, next
  checks and evidence-based completion. Add failure-to-runbook proposals, stale-doc
  contradiction reports and a lightweight project cockpit before a full task board.
- [ ] Improve response rendering/streaming, attachments and optional interactive
  reports/checklists/calculators. Use sanitized/constrained artifacts; no arbitrary
  generated JavaScript-to-native shell bridge. Voice/TTS remain opt-in and voice
  needs a user-present microphone test.
- [ ] **Acceptance:** a 20-question evidence set including known facts, contradictions
  and unanswerable questions; measure answer/source correctness, abstention, latency
  and prompt cost. Test actual share/search/save flows with pi-droid. Model confidence
  and a recently edited page are not substitutes for evidence.

### Milestone 4 — background usefulness and safe event-driven work

Background reliability supports the coding milestones too; do not postpone observed
correctness defects until all chat features exist. Agree disruptive phone scenarios
one at a time; never force-stop Termux from the same-phone testing agent.

- [ ] Finish the revised complete lifecycle matrix and awake sampler-lifetime
  diagnosis. Obtain independent Asleep evidence before claiming instrumented
  screen-off success; test longer/parallel/approval scenarios, abrupt loss and
  provider-network failure within explicitly agreed scopes. Prior short manual
  screen-off success is not Doze/all-night survival proof.
- [ ] Persistent completion/failure/approval notifications that open the correct
  conversation, with deduplication/reconciliation after reconnect/restart and private
  lock-screen defaults. Notification delivery is separate from keeping Termux alive.
- [ ] Event inbox and bounded CI watchers/reminders: deadlines, stable delivery IDs,
  visible cost and Stop. Event arrival must not authorize a deploy/send/install.
  “Build while I am away” first means notify and let the user review/install.
- [ ] Later opt-in capture/morning briefs and “done when this approved check passes”
  loops. Bound rounds/time/spend, scope tool permissions, record failures, and do not
  move a successful-capture watermark merely because capture was submitted.
- [ ] Research Android/Termux constraints before promising foreground-service or
  startup behavior. A service in this app does not inherently protect another
  package's Termux worker. Retain one shared wake-lock owner; no competing unlocks.

### Later clients and infrastructure — designed for, not immediate scope

- [ ] PC Pi/terminal and website clients connect to the same authenticated core;
  decide explicit host migration versus remote execution. Show where commands/files
  live. SSH offload is useful for heavy builds/indexing; loss is unknown execution
  state, not permission to run the command again somewhere else.
- [ ] Discord/Slack adapters map a thread/channel mention to a scoped conversation
  and authenticated person. Deduplicate platform event IDs; restrict bot loops,
  attachments and spend. A mention is not blanket execution approval, and shared
  channels must not expose private chats, wiki scopes or provider secrets.
- [ ] Backup/export/restore drills, history/index/log retention, release signing,
  installable releases, remaining lint/icon/translations and later conflict/PR/push
  workflows. Reuse existing capabilities rather than building every feature at once.
- [ ] Physical repository-folder relocation remains a separate tested migration
  (`docs/repository-rename.md`), not a prerequisite for coding in other repositories.
  Do not blindly rewrite opaque saved session/journal/branch IDs for cosmetic naming.
- [ ] Do not adopt an SDK-28 bundled runtime, rewrite the native UI, build dozens of
  search adapters or launch autonomous agent teams as shortcuts to this roadmap.
  Consider any runtime experiment separately with licensing/security/rollback checks.

### Research and evidence to carry forward

[pi-phone ideas research](docs/pi-phone-ideas-research.md) captures the full source-
linked comparison, high-leverage experiments and caveats: knowledge/wiki reuse,
search/fetch/documents, open questions, share capture, screenshot-to-knowledge,
contradiction radar, decision/runbook capture, two-sided research, CI events,
interactive artifacts, remote offload, bounded goals and opt-in morning briefs.
Their named Pi Pocket upstream is not this repository; do not treat it as a safe
upstream upgrade. The source review did not run upstream code or prove its claims.

For implementation, start with **Milestone 1: project-bound coding conversations**.
This documentation update does not implement multi-project support, change the
running bridge, grant new permissions, install packages or authorize unannounced
phone tests. Current completed functionality/evidence follows below.

## Android package and chat migration — completed, 2026-10-19

- Built, installed and now running **`dev.fantasticpimobile`**, with matching Kotlin source packages, theme, database filename, Keystore alias and Logcat tag. Plugin/package/action names, private config variable names and dedicated tmux window also renamed.
- Migrated **11 original chats / 21 original messages**, preserving IDs/content/organization/UI preferences and all **7 archived chats**. Re-encrypted pairing under the new package's Keystore key via private pipes/files; temporary import test APK removed. Source `dev.pipocket` retained, stopped, disabled to avoid duplicate launcher/accidental sends, and its saved files verified unchanged.
- One source request was `sending` while the bridge was unavailable. Imported it as **interrupted**, retaining ID/text/history without replay. A migrated draft subsequently sent by the user was checked against its corresponding new message. Private backups and exact comparisons remain ignored under `bridge/data/maintenance-backups/android-package-migration-*/`.
- Fresh process/listener/idle checks plus private backup preceded explicit bridge start. Verified ready/protocol v4/eight slots/zero active jobs. All **17 original task records unchanged**; a fresh user Test and the announced tools-free smoke request added two terminal tasks (19 total).
- Actual **pi-droid foreground test PASS** in the new package: existing chats and archive visible, new chat Send returned **PI · DONE / FANTASTIC_PI_MOBILE_MIGRATION_OK**, force-stop/relaunch retained pairing/selection/result. New-package Android tests: **24/24** (20 history/status/drawer/review + 4 layout), plus explicit pairing import **1/1**. No voice or new screen-off/background guarantee claimed.
- Host validation: **48/48 bridge tests**, **2/2 plugin tests**, **10/10 observer regressions**, real isolated tmux backup/restart/non-replay harness PASS, normal APK/test-APK build and lint PASS. Fixed symlink entry-point CLI detection with a red/green regression; renamed plugin token-environment filtering retains its privacy contract.
- Physical checkout relocation remains separate: the new local entry point is still a symlink. Opaque saved session IDs/journal kinds/historical branches are not blindly rewritten. See `docs/repository-rename.md`.

## Earlier branding-only rename validation — superseded by the package migration above

- Fresh validation: **46/46 bridge tests**, **2/2 optional adapter tests**, **10/10 observer regressions**; normal and isolated APK/test-APK builds plus Android lint passed.
- On-device isolated fixture: **24/24 instrumentation tests passed**, covering history upgrades, request status, drawer navigation, review UI and layout. Added a rename regression for the application label and drawer branding at 280dp / 100% and 200% font. First combined run had one existing activity-launch timeout; the layout class alone (4/4) and a complete repeat (24/24) passed without code changes. Timeout cause remains unestablished.
- At that earlier stage, normal `dev.pipocket` APK/history/pairing were not replaced; no bridge restart or model request. The renamed normal APK is built but not installed; no claim of a new full production end-to-end or background-survival test.

The project is now **Fantastic Pi Mobile**, repository `RuiCostafrg/fantastic-pi-mobile`.
Use `~/projects/fantastic-pi-mobile` locally. This is a symlink to the retained
physical checkout: moving that checkout needs a separate saved-workspace migration.
See [rename and next steps](docs/repository-rename.md). Earlier dated entries below
are historical evidence, not current production status or current commit state.

Updated: 2026-10-16 (reliability history below)

## Scoped repository-action restart — passed, 2026-10-16 21:29 UTC

- User explicitly authorized the next review-restart scenario. Verified isolated APK identities, installed only fixture packages and ran `scripts/check-reliability.py --scenario review-restart`: **PASS**. A real shell wrote one dispatch marker; after graceful fixture close/reopen, the same operation ID returned interrupted and did not append a second entry. No new RPC dispatch after restart. Final fixture instrumentation verified state/IDs/selection/draft/pairing. No app/harness fix needed.
- All **five production app database/preferences files byte-identical**, all **17 exact production task records unchanged** (fresh baseline was already 17), same live bridge PID16072/protocol v4/eight slots/admissions open/idle. Normal bridge never restarted and no production request submitted.
- Removed both fixture packages and reopened normal Pocket; foreground verified. Authorized secure wireless ADB auto-reconnected on its current port; no re-pairing, IME, lock, battery or network setting changes. Private scenario output/comparison artifacts under ignored `bridge/data/review-restart-lifecycle-20261016T212920Z/`.
- This completes the enhanced scoped review-restart check, not the full matrix or abrupt process/Termux death. Older pending-review-restart notes below are historical. Remaining: revised full matrix, independent Asleep evidence, abrupt-loss/provider-network and longer/stress scenarios; notifications still unimplemented. Changes remain uncommitted/unpushed.

## Scoped Android offline lifecycle rerun — passed, 2026-10-16 21:11 UTC

- User explicitly approved the isolated offline/reconnect scenario. Rebuilt fixture APK/test APK with `-PreliabilityTests=true`; assemble/test-assemble/lint succeeded. Verified isolated package identities before installation; normal APK was not replaced.
- Revised `scripts/check-reliability.py --scenario offline` **PASS** on actual Android: saved state, stable IDs, pending approval, parallel job, selected chat, draft, pairing and no duplicate RPC dispatch through listener offline/online. No application/harness fix was necessary for this scoped rerun.
- Private before/after comparison: **five production app database/preferences files byte-identical and all 16 exact production task records unchanged**. Live bridge retained PID16072/eight slots/zero active work; no restart or model request. Both fixture packages removed; normal dev.fantasticpimobile reopened to original Screen-off reliability test chat with DONE markers.
- No microphone/IME/security/network/battery changes. Gboard remained active; preflight ADBKeyboard warning was irrelevant. Private evidence: ignored `bridge/data/offline-lifecycle-20261016T211120Z/`; build log `~/.local/android-sdk/pocket-offline-fixture-build.log`.
- This completes the scoped offline rerun, not the full lifecycle matrix, enhanced review-restart, provider-internet loss or background survival. Next agree the review-restart scenario; no new screen-off test armed. This and the diagnostics increment remain uncommitted/unpushed.

## Reliability diagnostics increment — 2026-10-16 20:05 UTC

- Kept production running without restart or new requests. Read-only checks verified PID16072/protocol v4/eight slots, zero active jobs/reviews and 16 terminal tasks. Existing shared tmux wake-lock hooks unchanged. Authorized ADB was available; no pairing/network/security changes.
- Historical log inspection had no usable bridge-exit event. The earlier unexplained bridge exit and sampler disappearance **remain undiagnosed**; no attribution to Android, screen-off or ADB lifecycle is justified.
- Real awake probes: sampler advanced about 11 and 15.5 seconds after launch-client exit with no subsequent ADB sampling, showing Awake and held Termux wake lock. Both stopped/cleaned successfully. This is not physical screen-off or adbd-restart survival evidence.
- Reproduced and fixed a narrower evidence bug: a known-completed sampler could still return its last fresh power row. `SharedPowerObserver.read()` now refuses a done marker immediately. The bounded shell sampler records allowlisted exit reasons (requested stop/deadline/sample limit, catchable signals and write/sleep failures); close archives only the allowlisted reason privately. SIGKILL/process-tree loss can still leave no reason/marker.
- Added deterministic regressions plus actual Android-shell TERM probe against only the uniquely identified disposable sampler. Initial process-name matching failed closed with no signal; corrected basename matching and remote exact-script-argument recheck then proved signal-term metadata, live-evidence rejection and confirmed cleanup. Private metadata under ignored `bridge/data/observer-awake-diagnosis-*` and `observer-signal-probe-*`.
- Added metadata-only `bridge.listening`, `bridge.shutdown` (SIGINT/SIGTERM) and `bridge.closed` events, tested against the real isolated server via the tmux harness. No secrets/config/prompts/raw errors logged. **Source change only:** production was not restarted to activate these events. Missing events do not establish a particular crash cause.
- Validation: **46/46 bridge tests**, **10/10 observer regressions**, isolated real-tmux lifecycle/backup/restart/non-replay **PASS**, diff checks clean. Both new diagnostic assertions were seen failing before their fixes. No full Android lifecycle matrix or new screen-off scenario run. No commit/push for this increment yet.
- Next: one announced/agreed isolated APK lifecycle scenario, starting with the previously failing offline case; enhanced review-restart next. Further independent screen-off measurement still needs agreement and must not be represented as fixed by these diagnostics. Notifications remain unimplemented.

## Explicit bridge recovery — 2026-10-16 19:57 UTC

- User authorized recovery and then commit/push. Fresh checks found no bridge/controller/RPC process, no configured-port listener, no owner lock and all 16 persisted tasks terminal. Existing work pane was preserved.
- Created ignored private `bridge/data/maintenance-backups/pre-explicit-recovery-20261016T195743Z/` with online SQLite backup, config and saved sessions/worktrees, plus a private pre-start task/hash snapshot. No secrets/runtime evidence is included in Git.
- Explicit `scripts/bridge-work start` restored detached `work:fantastic-pi-mobile-bridge`. Post-start status: **verified / ready**, protocol v4, eight slots, admissions open, zero jobs/reviews/nonterminal tasks. Server PID 16072 under pane controller 16057 (historical; rediscover before signalling).
- Verified **all 16 exact task records and 143 saved session/worktree file hashes unchanged** after start. No new job submitted or old external command replayed. No Android UI/security/network setting changed. This supersedes the unavailable observation below; cause of the earlier bridge exit remains unknown.

## Resumed interrupted validation — 2026-10-16

- Recovered session `01a14531-31c6-76c7-b19d-83132990ccbe`; its last event was a validation tool call without a saved result. Preserved all prior local edits and observer scripts.
- Completed structured read-only controller status and adapter readiness validation. Missing/stale/wrong ownership stays unavailable/unverified, never assumed idle. Adapter withholds partial metadata and unknown reason strings. Updated the older maintenance assertion to expect the intentional `OWNER_PROCESS_MISSING` code instead of raw `ENOENT`.
- Fresh validation: **46/46 bridge tests**, **2/2 optional adapter tests**, **8/8 observer regressions**, isolated real-tmux workflow **PASS** (including wrong auth/port, missing tmux session, backup/restart and exact-ID non-replay); `git diff --check` clean. No new physical screen-off result is claimed.
- Current production inspection differs from historical notes below: `scripts/bridge-work status` reports **unavailable / storage-lock-missing**, with owner/storage unknown; only the current `work:node` pane was listed, no dedicated bridge window. This is not proof that every previous external child stopped. No production restart, signal, lock cleanup, job submission or replay was performed. Recovery requires fresh process/listener/task inspection and a private backup, not reuse of historical PID 16784.
- Documented the new status contract in `docs/bridge-work.md` and the optional adapter README. No commit/push. Remaining reliability work: sampler lifetime diagnosis while awake, independent Asleep evidence, and agreed longer/parallel/approval scenarios.

## Explicit tmux bridge workflow — migrated; real-app manual screen-off/recovery verified

- **Actual installed Fantastic Pi Mobile test passed with user-assisted screen-off (0.6.1).** Created the visible chat **Screen-off reliability test**. The first 60-second request completed during setup while awake and is not counted as background evidence. Then sent one new 120-second sleep request through the app's actual Send control, verified its saved UUID/server running state, `tool_execution_start: bash` and real sleep process, and instructed the user to turn off for 150 seconds. On their return the exact request was done and the real app showed **PI · DONE / POCKET_SCREEN_OFF_120_OK**.
- Persisted real Pi session evidence: exactly one matching bash dispatch (`sleep 120; echo POCKET_SCREEN_OFF_120_OK`), successful tool output, timestamps **19:34:12.832Z → 19:36:12.903Z** (~120.071 s), before user return. One terminal Durable task for that UUID; bridge retained PID 16784, eight slots, zero active work. Test worktree clean. All original 14 task records and 85 saved file hashes preserved; two explicitly authorized test requests are additional history (16 terminal tasks total). Kept the test chat/result visible; no automatic archive or history deletion.
- Private real-app evidence: ignored `bridge/data/real-app-screen-off-20261016-213400/` (request, before/after job, real sleep metadata, verified tool evidence and user-return metadata); earlier awake setup under `real-app-screen-off-20261016-212347/`. Input used ASCII ADB key events without changing Gboard, APK, lock/security/battery settings or restarting the bridge. No uncertain request replay.
- **Scope:** successful bounded actual-app job execution and recovery across the user's reported screen-off interval, not continuous independent Asleep proof, Doze/all-night/memory-pressure/provider-network guarantees, or a fix for the separate sampler lifetime issue. Older observer failures below remain inconclusive, not retroactively passed. No commit/push.

### Earlier implementation and observer history

- Prior detached-sampler attempt (`bridge/data/screen-off-check-20261016-211140/`) is **inconclusive**: detached sampler recorded 126 Awake samples, then became stale before any Asleep sample; the harmless-shell-completion phase was never reached. After user-reported screen-off/unlock, the production bridge retained PID 16784, all 14 exact task records and 85 saved file hashes matched. This is limited bridge-survival evidence, not a full instrumented screen-off pass.
- Secure ADB later reconnected on another port. Authorized device process inspection found the exact sampler absent and no done marker, so its bounded script/shared directory were removed after archiving the metadata privately; result.json records cleanup. Exact stop cause is unresolved. The detached design avoids per-sample ADB calls but **has not demonstrated survival across actual adbd/transport lifecycle changes**. Mocked ADB-call failure/awake smoke do not prove that. No further sampler loop was started; the later actual-app manual scenario above is separate.

- Fixed the observer after a second physical attempt lost ADB before Asleep evidence (`bridge/data/screen-off-check-20261016-205510/`; inconclusive, not a screen-off pass). New `scripts/power_observer.py` launches a bounded passive Android-shell sampler once, then reads same-phone uptime/wakefulness/wake-lock metadata locally; no continuous wireless ADB dependency. No raw power dumps/secrets retained. Stale/gapped evidence is inconclusive; confirmed stop archives the trace privately and cleans the shared temporary directory. Reports now retain metrics across final phases.
- **Eight observer regressions passed**, including post-start ADB loss and Android external-printf >128 KiB dump failure (fixed by streaming into awk). Real awake-phone smoke passed with advancing samples while all later ADB calls were forced to fail; sampler cleanup confirmed. Normal isolated tmux harness and **42 bridge tests** passed again. Physical screen-off acceptance is still pending.
- Later extraction notes saved at `docs/pi-droid-migration-handoff.md`; no pi-droid code was migrated. Original reliability work remains the priority.

- Later home-Wi-Fi recovery: fresh secure pairing succeeded via private FIFO/stdin; ADB verified at `192.168.178.37:38681`. The previous bridge/lock/window were then found absent and the agent pane had been recreated. Cause remains unknown, not attributed to screen-off. No bridge process/RPC child/listener remained; all 14 exact task records and 85 saved file hashes matched. A fresh private `maintenance-backups/pre-explicit-recovery-*` backup preceded an explicit start. Latest server PID 16784/controller 16767, healthy protocol v4/eight slots, admissions open and zero active work. Older PIDs below are historical; rediscover before signalling. No uncertain work replayed.

- Added `scripts/bridge-work` for status/start/pause/resume/stop in a new detached `work:fantastic-pi-mobile-bridge` window. Existing panes and shared wake-lock hooks are not changed. No automatic restart, replay, wake-lock release, stale-lock deletion or forced kill.
- Added authenticated admission maintenance: global model/review idle counts; pause serialized with new admissions; original-ID recovery, approvals and cancellation preserved. Stop requires owner identity/HTTP PID, both live counts and all Durable tasks terminal, a private idle backup and rechecks before SIGTERM.
- **42 bridge tests passed**. `python scripts/check-bridge-work.py` passed against a temporary checkout/config/repository, fake Pi and isolated tmux socket: real ownership, untouched other pane, duplicate refusal, approval/review stop guards, backup, restart, unchanged tasks/workspace and no duplicate shell dispatch.
- Before migration: original bridge PID 25933/parent 1, protocol v4/eight slots, all 14 tasks terminal and no direct bridge children. Actual Android power evidence showed a held Termux partial wake lock, plus its foreground service.
- After user confirmation of the submission pause, guarded legacy stop made an idle backup at ignored `bridge/data/maintenance-backups/2026-10-16T15-12-47.048Z-12372/` and gracefully released storage. New bridge PID 12431 is under controller/pane PID 12416 in `work:fantastic-pi-mobile-bridge` (pane `%2`). Existing work pane `%0`/PID 28952 was preserved; the older `2` session was already absent when rediscovered. No tmux config/hook change.
- Authenticated health/owner, effective configuration/token, exact 14 saved task records and 85 session/worktree/config file hashes matched. Private before-state snapshot: ignored `bridge/data/pre-tmux-state.json`. Announced pi-droid check saw preserved blank New chat, Ready when you are and paired Send; no request was submitted. Gboard was not changed despite the ADBKeyboard preflight warning. Wake-lock ownership rechecked. Admissions explicitly resumed; zero active jobs/reviews.
- First agreed isolated screen-off run was armed but lost wireless ADB during the waiting phase, before any Asleep observation: **no valid screen-off result**. Fixture cleanup ran; production retained PID 12431/healthy/14 terminal tasks. Secure rediscovery briefly returned a changed port but subsequent checks found no connected device/service. Asked user to verify Wireless debugging; no repeat armed or settings changed. Evidence: ignored `bridge/data/screen-off-check-20261016-172151/`. Synthetic harness power-control-flow and normal isolated tmux tests passed, but are not physical survival evidence.
- **Remaining:** independent continuous Asleep evidence/sampler lifecycle diagnosis, longer or stress scenarios only by agreement; secure unlock remains user-controlled. The actual-app manual short scenario above is complete. No Android rebuild/install, microphone/IME/security/battery change, automatic replay, commit or push. See [docs/bridge-work.md](docs/bridge-work.md) for commands, private backups and recovery limits.

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
- [x] Read-only pi-droid tool invoked through the app: `android_screen_state` returned foreground `dev.fantasticpimobile`, unlocked. The persisted Pi session confirms a successful actual tool result.
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
PASS: done    # latest answer includes dev.fantasticpimobile
PASS: cancelled
```

The unpaired screen now displays WAITING FOR PAIRING and an enabled Pair bridge button. Clicking it opens Settings; it does not insert another job. Saved active requests retain their IDs and resume after pairing. Startup no longer instructs an already-paired user to pair again.

## Local deployment and diagnostics

- App package: `dev.fantasticpimobile`.
- Bridge URL: `http://127.0.0.1:8787`, loopback only.
- Workspace: this repository (`~/projects/fantastic-pi-mobile`).
- Private config: `bridge/.env` (ignored). Uses this recovery session's selected Pi provider/model, with low reasoning. `PI_ARGS` is local configuration, not in version control.
- Bridge started with `nohup node --env-file=.env src/server.js`, from `bridge/`.
- PID file: `bridge/data/bridge.pid`; logs: `bridge/data/bridge.log` (ignored).
- Android logs: `adb logcat -s FantasticPiMobile:I`.
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
cd ~/projects/fantastic-pi-mobile
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
