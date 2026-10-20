# Small next steps

Project: `~/projects/fantastic-pi-mobile`.

**Goal:** first use the app to code safely in different projects; then use that
coding app to build our durable personal agent with multiple chats and clients.
The product direction lives at the top of [PROGRESS.md](../PROGRESS.md).

## How to run one step

Short prompt:

> In ~/projects/fantastic-pi-mobile, read docs/next-steps.md and do step 01 only.

Or:

> Read docs/next-steps.md and do the next unfinished step only.

Read this procedure, the safety rules and the selected step. Load other documents
only when that step needs them. Implement **one step**, verify its completion
criterion, update its status/evidence below, and stop. If blocked, record the
blocker rather than expanding into the next step. Split a step further if actual
code inspection shows it is still too large.

At completion, record changed files, tests actually run and their results, any
migration/compatibility effect, and the next step. Summarize in PROGRESS.md without
copying the whole plan. Commit/push only when requested; report whether work is
local or published. A checked box needs evidence, not just an implementation claim.

## Safety and compatibility

- Discover current Git/runtime state; historical PIDs, ports and readiness are not
  current evidence. Preserve unrelated changes and existing chats/worktrees.
- Keep each incremental change backward-compatible with existing clients or
  explicitly gated until its client is ready. Unsupported project requests fail
  clearly; they never run in the configured default repository by accident.
- Existing chats retain their repository, request IDs and worktree identity.
  Project selection cannot silently rebind a chat or an accepted request.
- Use disposable repositories for tests. Keep original checkouts/staging safe;
  explicit review/commit/merge and uncertain-action non-replay remain intact.
- Back up private state before real migrations/deployment. Agree visible phone
  tests and bridge interruption with the user; source changes alone do not justify
  restarting production. Keep tokens/history/backups out of public commits.
- SQLite preserves state; a live independently owned bridge executes work.
  Closing a client should not stop it. Host death requires reconciliation, not
  automatic replay of uncertain external actions.

## Milestone A — code in different projects

Execute in order. **Steps 01–09 are complete** (2026-10-20).
Step 08's headless Android/independent-worker lifecycle harness passed twice.
Step 09 deployed normal 0.7.0 and passed the agreed two-project visible smoke;
see [deployment evidence](project-deployment.md). No next milestone has started.
Design and focused test plan: [multi-project-design.md](multi-project-design.md).

### 01 — Inspect and choose the smallest design

- [x] Trace the current flow: Android chat → HTTP submission → Durable request →
  workspace preparation → review/test/merge. Locate the global `PI_WORKSPACE` use.
- [x] Write a short `docs/multi-project-design.md`: project identity, chat binding,
  legacy mapping, request/review routing and the smallest compatible rollout.
- **Done:** every routing/migration point has an identified source location and a
  focused test plan. Explain any changes needed to steps 02–09. No runtime/code
  change, installation or phone test in this step.

### 02 — Store a trusted project registry

- [x] Implement only project registration/lookup persistence and validation at the
  seam chosen in 01. Support an explicit local default branch without a remote.
- [x] Test reopen persistence, invalid/non-Git paths and duplicate/alias handling.
- **Done:** trusted projects have stable identities; selecting/registering one
  cannot execute work or change existing chat routing. Existing default behavior
  still passes its regressions. UI and multi-project execution stay out of scope.

### 03 — Persist immutable chat/request bindings

- [x] Bind a conversation and its accepted requests to a registered project.
  Preserve the existing default-project behavior and saved legacy workspaces.
- [x] Test restart recovery, legacy mapping, same-ID retries and rejection of a
  conflicting project/chat/request binding, including while work is active.
- **Done:** accepted work cannot be silently retargeted. No production migration
  or UI change; multi-project execution remains gated until step 04 passes.

### 04 — Route execution and review to the bound project

- [x] Resolve the bound project for worktree preparation and every review/test/
  commit/merge path, rather than relying on one global workspace manager.
- [x] Use two disposable repositories to test isolated worktrees, simultaneous
  chats, legacy reuse and correct review/test/merge targets without cross-writes.
- **Done:** backend tests prove both coding and review use the binding. Original
  checkout/staging protections remain green. No Android UI or production restart.

### 05 — Expose the minimal authenticated project interface

- [x] Add project listing/explicit registration and bound-conversation interaction
  needed by the app, using the contract from 01. Registration requires deliberate
  user action and validation, not arbitrary model-provided path execution.
- [x] Test authentication, validation, old-client compatibility and unsupported
  capability handling. Reuse an existing route if 01 selected it; avoid duplicates.
- **Done:** an isolated HTTP test can discover/select two projects and submit a
  bound request safely. No real provider or device action required.

### 06 — Persist project selection in the Android client

- [x] Extend the client/history representation for the project identity and request
  contract. Preserve existing chats and exact IDs; distinguish unbound new chats
  from legacy chats with an established repository.
- [x] Test database upgrades, selection/request persistence and old/offline bridge
  behavior in an isolated app sandbox.
- **Done:** data/client tests and build/lint pass; no visible picker or normal-app
  database migration yet. A missing capability cannot misroute a request.

### 07 — Add a small new-chat project picker

- [x] Let the user choose/register a project for a new coding chat, show the selected
  project before Send and keep the established binding visible after reopening.
- [x] Existing chats show their binding instead of a control that silently changes
  it. Handle empty/error/offline states clearly; preserve existing chat navigation.
- **Done:** focused UI/fixture tests and build/lint pass. Keep the native design;
  no broad redesign or installation over the normal app in this step.
- **Verified:** 3 fixture UI tests passed twice after user authorization. Fixed a
  test-only cold-launch accessibility-readiness race; no app change needed. Host
  policy tests (22/22), normal/fixture build and lint, and bridge regressions (67/67)
  passed. Temporary fixtures removed; normal app unchanged. See [project-picker.md](project-picker.md).

### 08 — Verify reconnect and client-close behavior

- [x] Test sending to each project, dropped responses, same-ID retry, client-close/
  reopen and restored selection/results. Run the relevant existing regressions.
- [x] Verify approval/cancellation/review state remains scoped to the right request
  and project. Use isolated deterministic workers, not real external side effects.
- **Done:** project bindings/IDs/results persist, no duplicate dispatch or crossed
  project writes, and closing a client does not cancel a live independent worker.
  This is not a claim of survival after Android kills Termux.
- **Verified:** actual headless Android client processes, a separate Node bridge and
  deterministic fake RPC peers; complete job/review acceptance responses really
  dropped at a proxy. All 4 phases and dispatch/worktree checks passed twice;
  14 Android data/status, 22 JVM and 68 bridge tests passed. Isolated real-tmux
  regression reproduced/fixed controller protocol-5 verification, then passed.
  No normal deployment or new visible UI scenario. See [project-lifecycle.md](project-lifecycle.md).

### 09 — Deploy and do one agreed pi-droid coding smoke test

- [x] Agree the visible test and any needed idle bridge restart with the user.
  Discover live work, back up private state and inspect APK identity before upgrade.
- [x] Use two disposable projects in the real app: choose, send harmless coding
  requests, inspect changes/test evidence and close/reopen. Verify migrated legacy
  chats still work. Keep real project default branches and unrelated staging safe.
- **Done:** record actual per-project outcomes and preservation evidence; leave
  the normal app/bridge healthy and report any limits. Ask before extending to
  disruptive screen-off tests, publishing external work or deleting test history.
- **Verified:** normal 0.7.0 / schema 3→4 deployment; 12 original sessions, 25 jobs,
  pairing, 21 original bridge tasks and 217 saved files preserved. Real A/B coding,
  one-file diffs and native Changes tests passed with separate markers; client
  Home/relaunch and force-stop/relaunch retained B/result/binding/check. Legacy
  chat reopened read-only. Bridge verified/idle. Narrow missing-root historical
  snapshot compatibility fix: 69/69 bridge, 22/22 JVM, normal build/lint and diff
  checks pass. See [project-deployment.md](project-deployment.md).

## After Milestone A — plan these in smaller steps when ready

These are direction markers, **not instructions to implement them during A**.
Decompose each into separately verifiable steps before starting it.

1. **Shared conversation core:** canonical IDs/events/approvals, Android cache
   reconciliation and a minimal terminal/Pi integration. Prove Android → terminal
   → Android continuity against one owner before PC/web expansion.
2. **Personal chats:** general assistance without mandatory Git; explicit personal
   workspace/tool policy, independent chats and a clear agent identity.
3. **Knowledge:** search approved history with source links; explicit Remember this;
   scoped facts/preferences, corrections and open loops. Trial pi-para in isolation.
4. **Research/capture:** one search backend, source snapshots/citations, document
   extraction, then Android share-to-inbox. Imported content remains untrusted data.
5. **Background usefulness:** remaining lifecycle evidence, persistent notification
   delivery and bounded CI/reminder events. Reliability defects encountered during
   coding are addressed when found, not deferred behind all personal-chat features.
6. **Later reach:** PC/web clients, explicit SSH offload and scoped Discord/Slack
   adapters; event deduplication, authentication and per-action permissions.

Detailed idea/reference material:
[pi-phone research](pi-phone-ideas-research.md),
[reliability evidence](reliability-baseline.md),
[rename/migration limits](repository-rename.md).

## Step evidence log

Append one small entry after working on a step:

```text
Step NN — done / blocked / in progress — date
Changed: files or design decisions
Verified: exact commands/results or observed device evidence
Compatibility/data: what was preserved or migrated
Publication: local / commit hash and pushed status
Next: step NN or a specific blocker
```

### Step 01 — done — 2026-10-20

Changed: `docs/multi-project-design.md` traces source routing/migration points and
selects a persisted trusted registry, immutable bindings and shared workspace adapter.
Updated this checklist and `PROGRESS.md`. Steps 02–09 retain their order; focused
clarifications/tests are recorded in the design, including pre-resume legacy
migration, accepted review bindings and old-bridge capability gating.
Verified: `cd bridge && npm test` — 48/48 passed, exit 0; Git/source inspection;
fresh localhost:8787 check returned ECONNREFUSED (no bridge started).
Compatibility/data: design only; no code/runtime/configuration change, installation,
phone test, private-state migration or saved identity rewrite.
Publication: local, uncommitted; no push requested.
Next: step 02 only — trusted project registry persistence/validation, no routing.

### Step 02 — done — 2026-10-20

Changed: `bridge/src/projects.js`, `bridge/src/store.js`,
`bridge/test/projects.test.js`, this checklist and `PROGRESS.md`. Added a version-1
`pocket.projects` document inside the existing Durable owner and internal
`registerProject`/`listProjects`/`getProject` methods. Opaque UUIDs, canonical source/
root/common-dir/subdirectory, immutable branch policy and local filesystem repository
identity persist. Symlink aliases deduplicate; conflicting policies, checkout/subdir
aliases sharing a common directory and managed chat sources fail clearly. Local
branches need no remote; remote policy validation does not contact the network.
Lookup revalidates source identity and policy without creating worktrees.
Verified: `cd bridge && node --test test/projects.test.js` — 5/5 passed;
`cd bridge && npm test` — 53/53 passed, exit 0; `git diff --check` — passed.
Disposable Git tests cover concurrent duplicate registration/reopen, independent
clones, missing/non-Git/bare/unborn sources, invalid/missing branches/remotes,
missing/replaced repository identities, managed worktree rejection and unchanged
legacy execution target after registering another repository. Initial focused run
exposed Durable proxies rejecting structuredClone; JSON value copies fixed it before
both passing runs. First full-suite redirection used unavailable `/tmp`; rerun under
`$TMPDIR` actually executed the passing suite. Fresh localhost:8787 health probe:
ECONNREFUSED; no bridge started or restarted.
Compatibility/data: additive registry only, initially empty; no automatic default
registration, legacy binding migration, saved job/task/ID/worktree rewrite, routing,
HTTP capability or Android change. Repository device/inode identity rejects local
replacement at the same path; moving/restoring registered repositories needs future
explicit operator resolution (not a new update endpoint). Original source/staging
and private state untouched; no deployment, real provider or phone test.
Publication: local, uncommitted; no push requested. Preserved step-01 local docs.
Next: step 03 only — immutable chat/request bindings and legacy mapping.

### Step 03 — done — 2026-10-20

Changed: `bridge/src/bindings.js`, `bridge/src/store.js`,
`bridge/test/bindings.test.js`, `bridge/test/projects.test.js`,
`bridge/test/bridge.test.js`, `bridge/test/sessions.test.js`,
`bridge/test/worktrees.test.js`, this checklist and `PROGRESS.md`.
Added version-1 `pocket.bindings` in the existing Durable owner: frozen default,
immutable session bindings and an atomic pre-resume legacy migration marker.
Job/review acceptance stores the project in both record and task input within the
same transaction. Internal submission accepts an optional project ID; conflicting
chat/request/action IDs fail, omitted-project retries retain accepted identity.
Task recovery resolves legacy inputs through migrated records and checks equality;
the existing dispatched-memo check remains first, preserving uncertain-action
non-replay. Non-default work fails with 426 before acceptance until step 04 routes
both coding and review; no multi-project HTTP capability was added.
Verified: `cd bridge && node --test test/bindings.test.js test/projects.test.js`
— 12/12 passed; final `cd bridge && npm test` — 60/60 passed, exit 0;
`git diff --check` — passed. Disposable repositories/isolated journals only.
Coverage includes atomic admission/conflicts while active and idle, exact-ID retry,
restart/non-replay, persisted job/review task project inputs, review reopen,
implicit legacy pocket, undispatched legacy task recovery, manifest-only chats,
dirty worktree reuse, incomplete preparation without repair, conflicting saved
workspace evidence, foreign historical manifests, failed-migration retry, and
changed default source/branch-policy rejection. Earlier full run found six failures:
registry tests assumed no seeded default/allowed a conflicting default policy,
restart tests treated running as proof of worker dispatch, and invalid-branch setup
expected a late job failure. Updated those expectations; final runs above pass.
Fresh localhost:8787 health probe returned ECONNREFUSED; no bridge was started.
Compatibility/data: migration code is additive and runs before resume under the
existing exclusive owner lock; no production journal was opened or migrated.
Manifest paths/hashes/branches, task kinds, request/session IDs, Pi session identities,
dirty files and original checkout/staging stay unchanged. Saved workspace evidence
must match the verified default; foreign/ambiguous historical repositories require
operator resolution, not a guessed binding. The default is now seeded at open;
invalid bootstrap branches/remotes fail before admission rather than during worktree
setup. Failed opens close storage and release the lock. No installation, deployment,
real provider, phone test, HTTP/UI change or non-default execution routing.
Publication: local, uncommitted; no push requested. Preserved step-01/02 changes.
Next: step 04 only — route execution and every review path to the bound project.

### Step 04 — done — 2026-10-20

Changed: `bridge/src/project-workspaces.js`, `bridge/src/store.js`,
`bridge/src/bindings.js`, `bridge/test/project-routing.test.js`,
`bridge/test/bindings.test.js`, this checklist and `PROGRESS.md`.
Added one binding-aware workspace adapter shared by command execution and
`createReview`, with cached managers per project, registered source/subdirectory/
branch-policy resolution and repository revalidation even on cache hits. Unbound
reads return no worktree without binding or creating one. Removed the internal
non-default admission gate and default-only task/reopen restrictions; accepted
job/action/task identities still have to agree with the immutable chat binding.
Default bootstrap and pre-resume legacy inventory remain separate from routed
execution, preserving existing storage keys and migration order. No HTTP project
selection, capability advertisement, route or Android change (step 05 is next).
Verified: `cd bridge && node --test test/project-routing.test.js
 test/bindings.test.js test/review.test.js` — initial focused run 28/28 passed;
`cd bridge && node --test test/project-routing.test.js` — final routing tests
4/4 passed after adding identical-clone/global-guard coverage; final
`cd bridge && npm test` — 64/64 passed, exit 0; `git diff --check` — passed.
Disposable repositories and isolated journals only. New tests prove two live
workers edit the same relative filename in different project worktrees, selected
subdirectories are used for coding/tests, summaries/diffs are chat-scoped, identical
clones have distinct revisions, cross-project review revisions fail, selected
commits preserve unrelated staged files, dirty target merges fail, and explicit
local merges affect only the bound source. Reopen retains non-default jobs/actions/
bindings/worktrees and exact-ID results without re-dispatch. Legacy manifests remain
byte-identical with dirty edits intact. Cached managers reject replaced repositories,
switched branches and missing worktrees without default-checkout fallback. Existing
global review/admission and merge-vs-live-model guards remain intact across projects.
Fresh localhost:8787 health probe returned ECONNREFUSED; process inspection found no
matching bridge server/controller. No bridge was started or restarted.
Compatibility/data: additive source-only routing change; registry/binding document
versions, request/session IDs, Pi session names and worktree hash/path/branch identity
are unchanged. Default/legacy clients continue using the frozen default or established
binding. No production journal access/migration, deployment, installation, real
provider, phone test, actual-source test merge or unrelated staging change. Internal
multi-project execution is enabled; client discovery/selection remains unadvertised
and must be implemented/verified in step 05 before client rollout.
Publication: local, uncommitted; no push requested. Preserved step-01/02/03 changes.
Next: step 05 only — minimal authenticated project interface and HTTP compatibility.

### Step 05 — done — 2026-10-20

Changed: `bridge/src/server.js`, `bridge/src/store.js`,
`bridge/test/project-http.test.js`, `bridge/test/sessions.test.js`,
`bridge/test/review.test.js`, `docs/project-api.md`, `README.md`, this checklist and
`PROGRESS.md`. Added authenticated GET/POST `/v1/projects` and GET
`/v1/sessions/:sessionId/project`. Registration requires literal
`confirmRegistration: true` with an explicitly supplied trusted source/name/branch
policy; validation is reused from the registry, with no model-produced source
execution. Listings/registration responses omit filesystem inode/device and Git
common-directory internals. POST jobs now validates/forwards optional `projectId`;
job/action results retain accepted IDs, and review summary/snapshot/diff responses
include project identity. Existing review routes are reused. Health advertises
protocol 5 and `projectBindings: true` only for the binding-aware store; an unsupported
store receives no selected-project submission (426 rather than silent forwarding).
Verified: `cd bridge && node --test test/project-http.test.js test/sessions.test.js
 test/review.test.js` — 26/26 passed; `cd bridge && npm test` — 67/67 passed, exit 0;
`cd bridge && node --test test/project-http.test.js` — 3/3 passed; `git diff --check`
— passed. New isolated HTTP tests use two disposable repositories/deterministic
workers, not a provider. They prove authenticated discovery/explicit registration,
no execution/worktree creation during registration/binding lookup, alias dedup,
per-project writes/review/test targets and response identities, same-ID/reopen
recovery without dispatch, conflicting-project rejection, omitted-project legacy
behavior, malformed/unknown IDs, invalid paths/policies, confirmation/body-size/auth
checks, unsupported-store gating and metadata-only HTTP logs. Original source
checkouts remain clean with unchanged file contents. Existing routing, legacy,
review/merge/staging and non-replay regressions remain green. Initial runtime check:
localhost:8787 ECONNREFUSED; no matching bridge server/controller observed. No bridge
started or restarted outside isolated ephemeral-port test servers.
Compatibility/data: additive HTTP/response contract; no new database schema or
migration beyond the already implemented binding setup in disposable journals.
Opaque IDs, default/established omitted-project routing, worktrees and existing
approvals/cancellation/review URLs stay unchanged. README corrects its legacy-session
label to the actual opaque `pocket` ID (documentation only, no rename). No production
journal access/migration, installation, deployment, Android change or phone test.
A true old bridge can ignore project fields; clients must verify protocol >= 5 and
`projectBindings === true` before POST and never drop the selected ID to retry.
That Android persistence/capability/error handling is step 06, not implemented here.
Registration confirmation is operator intent, not protection against a malicious
bearer client; the API contract documents trust and privacy limits explicitly.
Publication: local, uncommitted; no push requested. Preserved step-01 through 04 work.
Next: step 06 only — Android project/request persistence and isolated upgrade tests,
without a picker, normal-app migration or deployment.

### Step 06 — earlier blocked checkpoint (resolved below) — 2026-10-20

Changed: `app/src/main/java/dev/fantasticpimobile/History.kt`, `ProjectRequests.kt`,
`MainActivity.kt`, `ChangesActivity.kt`, `Connection.kt`; `app/build.gradle.kts` (test-only JUnit/JSON
libraries); `app/src/test/java/dev/fantasticpimobile/ProjectRequestsTest.kt`;
`app/src/androidTest/java/dev/fantasticpimobile/ProjectHistoryTest.kt`, `HistoryTest.kt`,
`LiveStatusUiTest.kt`, `ReliabilityFixtureTest.kt`; `docs/android-project-state.md`,
`docs/project-api.md`, `README.md`, this checklist and `PROGRESS.md`.
Schema-4 migration source adds session/job project IDs and explicit unbound,
legacy-unresolved, selected and bound states without changing existing IDs. Selection
is saved before request creation and is immutable once a request is saved; accepted
binding/result adoption is transactional. New unbound chats cannot silently use a
default (no picker yet). The actual Activities now use a headless-testable request
policy: protocol-5/literal capability gate before selected-project POST, exact legacy
ID recovery and proved chat-binding lookup before retry, identity persisted BEFORE
legacy retry dispatch and explicitly attached to the wire payload, persisted selection
retained offline, strict job/review identity checks and permanent POST-404 handling. Identity
mismatches remain uncertain, not falsely rejected/completed; cached approvals are not
made current. Saved legacy review operation JSON/IDs remain unchanged; retry transport copies
attach the durably proved project rather than executing against an unknown default.
Review response adoption also checks foreground/endpoint epochs; endpoint-frozen
HTTP requests prevent a multi-call proof/POST sequence crossing a re-pairing. See the focused state/continuation document.
Verified: with `ANDROID_HOME=$HOME/.local/android-sdk` and the existing native
`-Pandroid.aapt2FromMavenOverride=$HOME/.local/android-sdk/aapt2-source/build/aapt2`,
`./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest
 :app:lintDebug` passed for the normal configuration; the same command with
`-PreliabilityTests=true` passed for the fixture configuration, including the final
fixture build. JUnit XML: 15 tests, zero failures/errors/skips. Final APK metadata:
`dev.fantasticpimobile.reliability` and `.reliability.test` only. Host tests cover
selected-ID/payload retention, capability refusal, offline/dropped response, legacy
exact-ID and omission-contract recovery, unbound refusal, conflicting/malformed
identities, review ownership, proof persistence failure blocking POST, replacement-
owner default refusal after lost legacy acceptance, and permanent-vs-uncertain errors.
`cd bridge && npm test` — 67/67 passed, exit 0; `git diff --check` — passed.
Blocker: native `adb devices -l` returned no connected device; mDNS services query
reported unsupported host service. A fixture-only, class-filtered
`:app:connectedDebugAndroidTest` attempt failed before test execution/install with
`Could not create ADB Bridge` / `Could not determine adb version` for the SDK ADB.
Android SQLite migration/reopen tests (v1/v2/v3), database conflict rollback and
request-status instrumentation are compiled but NOT RUN. No runtime data-test pass
is claimed. Logs: `$TMPDIR/step06-normal-build.log`, `step06-final-fixture.log`,
`step06-device-tests.log`, `step06-bridge.log`; host test XML under
`app/build/test-results/testDebugUnitTest/`. The earlier 10- and 13-test host passes were followed
by a 15-test passing run after proof-before-dispatch and replacement-owner guards.
A fresh final localhost:8787 probe returned ECONNREFUSED.
Compatibility/data: source-only schema/client change; neither normal nor fixture APK
was installed, and the normal app database/pairing/history were not opened or migrated.
No bridge restart, production journal access, provider, visible phone test, picker,
commit or push. Older accepted legacy jobs can still be read without inventing a
project; unsupported new submissions fail closed, never dropping a selected ID.
Existing local changes from steps 01–05 are preserved.
Publication: local, uncommitted; nothing pushed.
Next: finish step 06 only — restore authorized native ADB, recheck fixture APK/device
identity and run ONLY `HistoryTest`, `ProjectHistoryTest`, `RequestStatusTest` in the
separate fixture sandbox. The continuation document includes the native ADB runner
command (avoid incompatible SDK ADB). Fix any failures and record actual results
before checking the remaining box or starting step 07. Ask separately before visible
Activity tests, normal-app migration/installation or production deployment.

### Step 06 — done (device verification resumed) — 2026-10-20

Changed: completion/evidence updates only in `docs/android-project-state.md`,
`docs/project-api.md`, `README.md`, this checklist and `PROGRESS.md`. The previous
step-06 implementation did not need a code change after device verification.
Verified: secure Wireless debugging rediscovery reconnected the already-paired
ASUS_I003D using native Termux ADB and an explicit fresh serial. Before installation,
`pm list packages` found only the normal app; build output metadata and actual native
AAPT2 `dump badging` identified only `dev.fantasticpimobile.reliability` and
`dev.fantasticpimobile.reliability.test` fixture APKs. Installed those APKs only.
`adb -s "$SERIAL" shell am instrument -w -e class
 dev.fantasticpimobile.HistoryTest,dev.fantasticpimobile.ProjectHistoryTest,dev.fantasticpimobile.RequestStatusTest
 dev.fantasticpimobile.reliability.test/androidx.test.runner.AndroidJUnitRunner`
— **OK (14 tests)**, no failures: HistoryTest 7, ProjectHistoryTest 3,
RequestStatusTest 4. Actual Android SQLite v1/v2/v3 upgrade/reopen, selection/request
persistence, immutable binding/conflict rollback, legacy mapping, draft/lifecycle/
pending operation preservation and request-status tests now pass in the separate
sandbox. No Activity, live-status UI, pairing import or other instrumentation class
was invoked. Both temporary fixture packages were uninstalled successfully afterward.
`ANDROID_HOME=$HOME/.local/android-sdk ./gradlew -PreliabilityTests=true
 -Pandroid.aapt2FromMavenOverride=$HOME/.local/android-sdk/aapt2-source/build/aapt2
 :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug`
— BUILD SUCCESSFUL (existing build/test tasks mostly up to date); a separate
`:app:testDebugUnitTest --rerun` with the same environment/flags actually reran
**15/15 passing host policy tests** (zero failures/errors/skips in JUnit XML).
`cd bridge && npm test` — **67/67 passed**, exit 0; `git diff --check` — passed.
Fresh localhost:8787 probe: ECONNREFUSED. Resumed logs:
`$TMPDIR/step06-data-device.log`, `step06-resume-build.log`,
`step06-resume-unit.log`, `step06-resume-bridge.log`.
Compatibility/data: normal package remained the only installed project package after
cleanup. Its versionCode 7 / versionName 0.6.1 and lastUpdateTime
`2026-10-19 22:19:58` matched before/after. No normal app database/history/pairing was
opened, read, migrated or replaced. Only disposable fixture state was exercised.
No bridge restart, production journal access, real provider, picker, visible Activity
test, legacy TCP/IP debugging, SDK replacement, settings/security change or production
deployment. SDK ADB incompatibility was bypassed, not fixed, by native ADB; the earlier
blocked checkpoint remains above as historical evidence, not current status.
Publication: local, uncommitted; nothing pushed. Preserved all earlier local work.
Next: step 07 only — small new-chat picker and immutable established binding display.
Stop before it; normal-app installation/migration and agreed real-app smoke tests
remain step 09, not authorized by this verification run.

### Step 07 — implemented; visible fixture verification pending — 2026-10-20

Changed: new `ProjectCatalog.kt`, `ProjectPicker.kt`, `ProjectCatalogTest.kt`,
`ProjectPickerUiTest.kt`; integrated the picker and established-project display into
`MainActivity.kt`. Added `docs/project-picker.md` and updated progress/state docs.
Explicit local/remote-policy registration has a review/confirmation gate; selection
and registration cannot send work. Submitted/established/archived chats stay locked.
Legacy empty drafts require backend absence proof. Capability, endpoint and lifecycle
guards preserve identity/drafts without silent default fallback.
Verified: normal and `-PreliabilityTests=true` Gradle tasks `:app:testDebugUnitTest
 :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug` passed with
`ANDROID_HOME=$HOME/.local/android-sdk` and
`-Pandroid.aapt2FromMavenOverride=$HOME/.local/android-sdk/aapt2-source/build/aapt2`.
Final normal build also passed after adding fixture test source. JUnit XML: **22/22**
passing host tests (7 catalog + 15 request policy); `cd bridge && npm test`: **67/67**
passed; `git diff --check`: passed. The 3 new fixture Activity tests compiled but
**were not executed**: visible phone testing requires separate agreement.
Logs: `$TMPDIR/step07-build.log`, `step07-fixture-build.log`,
`step07-final-normal-build.log`, `step07-bridge.log`. Localhost:8787 HTTP probe returned
000/connection failure; no bridge was launched.
Compatibility/data: reused schema 4; no new database migration, installation, normal
history/pairing read, production journal access/restart, provider action or phone
settings change. Preserved all existing local work. No step-08 scenario run.
Publication: local, uncommitted; nothing pushed.
Next: finish step 07 only after agreement to visibly execute fixture-only
`ProjectPickerUiTest`, with fresh device/APK checks. Keep the completion gate open
until actual UI results pass; do not advance to step 08 or production deployment.

### Step 07 — done (authorized visible fixture tests) — 2026-10-20

Changed: `ProjectPickerUiTest.kt` click helper now waits for a visible/clickable
fixture-owned accessibility control on cold launch. Updated completion/evidence in
`docs/project-picker.md`, `docs/android-project-state.md`, this checklist and
`PROGRESS.md`. No app runtime code fix needed.
Verified: user explicitly authorized running the 3 UI tests. Native secure ADB found
one authorized ASUS_I003D; device awake/reachable. Only normal package present before
install. Rebuilt fixtures and verified output metadata plus native AAPT2 badging for
`.reliability` / `.reliability.test`. Installed only those fixtures. Exact class filter
`dev.fantasticpimobile.ProjectPickerUiTest` via native `adb -s "$SERIAL" shell am
instrument -w ... dev.fantasticpimobile.reliability.test/androidx.test.runner.AndroidJUnitRunner`.
Initial 2/3 pass; focused test reproduced first-click failure. Probe proved native
button shown/clickable with null accessibility root. Bounded fixture-owned target
wait fixed test synchronization; removed probe. Full suite **OK (3 tests)** twice
(5.163 s / 5.084 s). Covers choice/persistence/reopen/locking, empty/old/unavailable
bridge and explicit registration confirmation without a job POST.
Fixture build/unit/test-APK/lint passed after test fix. Final normal build/test-APK/
lint passed; `:app:testDebugUnitTest --rerun` actually reran **22/22 host tests**.
Existing 67/67 bridge regression result remains from implementation (not rerun in
this device-only continuation; no bridge code changed). `git diff --check` passed;
no temporary debug markers remain. Logs: `$TMPDIR/step07-ui-device.log`,
`step07-ui-empty-repro.log`, `step07-ui-probe.log`, `step07-ui-final-build.log`,
`step07-ui-final.log`, `step07-ui-repeat.log`, `step07-ui-normal-final.log`.
Compatibility/data: both previously absent temporary fixture packages removed;
package listing again only normal app. Its versionCode/versionName/lastUpdateTime
matched before/after. Normal history/database/pairing not accessed/migrated, no
normal Activity launched, production journal opened, bridge restarted or real
provider invoked. No IME/security/network/phone setting changed; inactive ADBKeyboard
warning was irrelevant to accessibility instrumentation. Localhost:8787 HTTP 000 /
connection failure after tests. No new migration or normal installation.
Publication: local/uncommitted; nothing pushed; previous work preserved.
Next: step 08 only, not started. Step 09 deployment still needs separate agreement.

### Step 08 — done — 2026-10-20

Changed: new `bridge/test/project-lifecycle-pi.js`, `project-lifecycle-fixture.js`,
`project-lifecycle.test.js`, Android `ProjectLifecycleTest.kt`,
`scripts/check-project-lifecycle.py`, `docs/project-lifecycle.md` and progress docs.
Added a disposable independent bridge/fake-RPC worker, real accepted-response-drop
proxy and four fresh headless Android client phases. Tests preserve exact job/
project/operation IDs, saved review JSON, results, selected chat, draft and pairing;
reject crossed results/approvals, cancel a third chat without affecting A's pending
approval, and check per-worktree dispatch markers plus unchanged source staging.
The Android client is explicitly absent while B finishes with HTTP offline.
Regression fix: `scripts/bridge-work.mjs` still required protocol 4 exactly. Existing
real-tmux test failed; allowlisted diagnostic rerun proved health-unverified with
protocol 5. Now allow only numeric 4/5 (all owner/maintenance/backup checks remain).
`scripts/check-bridge-work.py` asserts v5/projectBindings and reports only safe
reason/version on fixture startup failure. The original harness then passed.
Verified: `cd bridge && node --test test/project-lifecycle.test.js` — 1/1 passed;
final `cd bridge && npm test` — **68/68 passed** after controller fix.
`python scripts/check-project-lifecycle.py --serial "$SERIAL"` — **all 4 Android
phases and worker/filesystem assertions passed twice**, each phase a separately
invoked headless instrumentation test, never an Activity/provider. Class-filtered
HistoryTest/ProjectHistoryTest/RequestStatusTest — **OK (14 tests)**. Real isolated
`python scripts/check-bridge-work.py` — **PASS** after red/repro/fix.
Normal and fixture Gradle `testDebugUnitTest`, `assembleDebug`,
`assembleDebugAndroidTest`, `lintDebug` passed with the existing native AAPT2
flags; final normal `:app:testDebugUnitTest --rerun` actually reran **22/22** host
tests. `git diff --check` passed. Detailed commands/logs in the lifecycle document.
Compatibility/data: native ADB/device and metadata/native AAPT2 badging verified
exact fixture IDs before install. Only normal app present before/after; previously
absent temporary fixtures removed. Normal versionCode/versionName/lastUpdateTime
unchanged; no normal database/history/pairing read or migration, Activity launch,
production journal access, bridge start/restart, provider or phone-setting action.
Production localhost:8787 remained connection failure/HTTP 000. Disposable workers
closed and state removed. Not a screen-off/Termux-death/real-provider/UI-deployment
claim; step-07 UI evidence remains separate.
Publication: local/uncommitted; nothing pushed; all earlier local changes preserved.
Next: step 09 only, after explicit agreement for deployment and one visible smoke.
Do not install the normal APK or restart production implicitly.

### Step 09 — done — 2026-10-20

Changed: `app/build.gradle.kts` version 8 / 0.7.0; `bridge/src/bindings.js` and
`bridge/test/bindings.test.js` narrow legacy missing-root compatibility regression;
`docs/project-deployment.md`, this checklist, README and PROGRESS.
Verified: private backup/idle checks before deployment; legacy regression RED then
GREEN; full bridge **69/69**, JVM **22/22**, normal app/test-APK build and lint,
`git diff --check`. Normal native upgrade and real provider A/B coding smoke:
separate locked projects/worktrees, exact one-file diffs, native Changes tests
`STEP09_A_TEST_OK` / `STEP09_B_TEST_OK`, exit 0/current revision. Home while B
worked, reopen, then completed-client force-stop/relaunch preserved results,
selection/binding/check. Legacy messages/binding read-only check passed.
Compatibility/data: actual schema 3→4 migration preserved original 12 sessions and
25 jobs; connection preferences byte-identical. All 21 old bridge tasks and 217
saved files unchanged; original/smoke source HEAD/staging unchanged. Missing root
allowed only when absent and independently verified; explicit conflicts/core
identity omissions still rejected, no snapshot repair or replay. Final normal
app reopened; bridge verified/ready/unpaused/idle, 25 terminal tasks. Private
backups and smoke history retained. No commit/merge/push, real-project edit,
phone-setting change, screen-off or host-death test. Full evidence and limits:
[project-deployment.md](project-deployment.md).
Publication: locally deployed, source uncommitted/unpushed; no external release.
Next: stop; Milestone A complete. Agree/decompose the next milestone separately.
