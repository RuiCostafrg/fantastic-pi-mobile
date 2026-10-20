# Multi-project deployment and visible smoke — step 09

Completed 2026-10-20 after the user requested step 09. This is local deployment
of the normal Android app and independently owned bridge, not a published release.
Steps 01–09 of [the coding roadmap](next-steps.md) are now complete.

## Deployment and legacy compatibility

- Discovered native secure ADB/device, APK identity, Git state and runtime before
  maintenance. No live bridge worker/lock was present initially. All 21 saved
  bridge tasks were terminal; the app had no sending/queued/running requests.
- Created a private ignored backup under
  `bridge/data/maintenance-backups/step09-20261020T1702/`: SQLite backup, `.env`,
  saved worktrees/Pi sessions, installed APK, Android databases/preferences and
  package/configuration metadata. Do not publish that directory.
- Initial startup failed closed on legacy workspace evidence. Read-only inspection
  found four historical job snapshots missing only `workspace.repositoryRoot`.
  Their manifests and actual Git trees already proved that root; other identity
  and base fields matched. No migration repair or replay was performed.
- Added a failing regression, then a narrow fix in `bridge/src/bindings.js`:
  accept an *absent* redundant root only after manifest/real-tree verification.
  Explicit conflicting/null roots and absent core path/cwd/branch/base fields
  still fail. Saved snapshots are not rewritten. Regression in
  `bridge/test/bindings.test.js` covers preservation, reopen and non-replay.
- Built/inspected/installed normal `dev.fantasticpimobile` with `adb install -r`:
  versionCode **8**, versionName **0.7.0**, updated from 7 / 0.6.1.
  Actual schema **3 → 4** upgrade preserved all original columns in all **12
  sessions and 25 jobs**. Immediately after migration all preferences were
  byte-identical; after smoke, pairing `connection.xml` remained byte-identical,
  while selected-chat/review preferences changed as expected.
- Started the independently owned bridge with `scripts/bridge-work start`;
  admissions were paused for migration checks, then resumed for smoke.
  Final `scripts/bridge-work status`: verified/ready, protocol **5**,
  `projectBindings`, worktree isolation and changes review true, maxConcurrent 8,
  admissions unpaused, jobs/reviews/active tasks **0**, **25 terminal tasks**.
  The normal app was reopened and left on the completed B smoke chat.

## Actual normal-app/provider test

Created two disposable local repositories beneath `bridge/data/step09-smoke/`,
with local default branch `trunk`, no remote, a committed `check.sh`, and a
pre-existing unrelated staged `keep.txt`. Used native visible controls to register
and confirm each trusted source, select it in a separate chat, and Send a harmless
coding request. Requests prohibited commit/merge/push, other edits, source-checkout
writes and phone actions.

| Project | Result in isolated chat worktree | Native Changes evidence |
| --- | --- | --- |
| Step09_A | `hello.txt`: `BASE_A` → `STEP09_A_OK` plus newline; real Pi job done | One-file diff inspected; `sh check.sh` explicitly run and output inspected: `STEP09_A_TEST_OK`, exit 0, current revision |
| Step09_B | `hello.txt`: `BASE_B` → `STEP09_B_OK` plus newline; real Pi job done | One-file diff inspected; `sh check.sh` explicitly run and output inspected: `STEP09_B_TEST_OK`, exit 0, current revision |

Both model-run checks also reported the matching marker. The native Changes test
runs are separately persisted review operations, not just assistant claims.
No commit, merge or push was performed. Changes correctly disabled merge because
source checkouts contained the intentionally staged unrelated file.

Sent Home while B was active; independently owned work completed and reopening
showed its result. Also force-stopped/relaunched the normal Android client after
completion: B's selected chat, locked binding, result and current passed Changes
check survived. A remained independently selectable with its own result/diff/check.
This is not evidence of host death, Doze or screen-off survival.

Opened an existing migrated legacy chat read-only. Its saved messages remained
visible, and the project banner resolved to the locked configured default.
No fresh legacy provider request or legacy repository edit was submitted.

## Preservation and verification

Private `verify-final.py`/`final-evidence.json` in the backup directory prove:

- Both Android job IDs/session IDs/project IDs exactly match authenticated bridge
  responses; project identities differ and each Changes/review result matches
  its own chat/project. The worktree paths are distinct.
- Only `hello.txt` differs in each worktree. Worktree/source HEADs equal the
  recorded base commits (no smoke commits). Source `hello.txt` files still contain
  `BASE_A` / `BASE_B`. Both unrelated staged patches are byte-identical.
- The main project's HEAD/staged patch are unchanged. All **217 original saved
  worktree/Pi-session files** retain their hashes; all **21 original bridge task
  rows** and all original Android session/job columns are unchanged after smoke.
- Connection/pairing preferences remain byte-identical; SQLite integrity is OK.
  Test chats, project registrations, dirty smoke worktrees and private backups
  are deliberately retained, not deleted or archived automatically.

Tests actually run during step 09:

```sh
cd bridge && npm test
# 69/69 pass, zero failures (includes new legacy compatibility regression)

ANDROID_HOME=$HOME/.local/android-sdk ./gradlew \
  :app:testDebugUnitTest --rerun :app:assembleDebug \
  :app:assembleDebugAndroidTest :app:lintDebug \
  -Pandroid.aapt2FromMavenOverride=$HOME/.local/android-sdk/aapt2-source/build/aapt2
# BUILD SUCCESSFUL; JVM XML: 22 tests, zero failures/errors

git diff --check
# passed
```

Logs under `$TMPDIR`: `step09-legacy-red.log`, `step09-legacy-green.log`,
`step09-bridge.log`, `step09-normal-build.log`, `step09-final-evidence.log`.
Earlier 14 Android data tests and fixture lifecycle/UI runs remain evidence of
steps 06–08; they were not rerun against the normal installation in step 09.

## Limits and next scope

No screen-off/overnight/Termux-death test, legacy resubmission, real-project merge,
external publication, test-history deletion, device-setting change or new personal
agent feature was performed. Local installed app/bridge are healthy, but changes
remain **uncommitted and unpushed**. The next task is to agree/decompose a new
milestone; the post-Milestone-A direction markers are not executable instructions.
