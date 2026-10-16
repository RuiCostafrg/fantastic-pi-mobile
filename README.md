# Pi Pocket ✦

A voice-first personal assistant for Android, written in **Kotlin**, with local **SQLite** history and a **Pi Durable** bridge.

> Early MVP. The app and bridge are separate processes. Model inference is provided by your configured Pi provider, not an offline model. Review a dictated request before tapping **Send**.

## How it works

```text
Android speech service → editable draft → Kotlin app
                                            │ bearer-authenticated HTTP on localhost
                                            ▼
                               Node bridge inside Termux
                                            │
                             Pi Durable + SQLite task journal
                                            │
                                  Pi coding-agent RPC
                                            │
                          coding tools · extensions · pi-droid
```

The app uses Android's built-in SQLite API (no hosted database). Pi Durable commits request IDs, task intent, status, extension dialogs, and results to a second SQLite database in Termux. Pi keeps a separate persistent conversation session for each chat. There is no second “router model” and no second set of model credentials: actual work goes through your existing Pi CLI.

### Included

- Voice input using Android's installed speech activity; typing works without it.
- Review/edit before Send; no hot microphone or automatic execution.
- SQLite request history, retained across app restarts.
- Independent persistent Pi conversations, code editing, and installed Pi extension discovery.
- Slide-out chat drawer with New chat, title search, lifecycle sections, rename, pins, and running/approval badges.
- Explicit user-finished tasks, reversible archiving, and a separate searchable archive view.
- Per-chat drafts, transcripts, approvals, and Stop; up to eight chats can work simultaneously by default (configurable 1–32).
- A persistent Git worktree and dedicated branch per chat, based on the current default branch.
- Native **Changes** screen: working/committed file lists, colored diffs, selected-file commits, recorded test commands/results, and explicit local merges.
- Extension confirmation, selection, input, and editor dialogs.
- Tool progress, completed assistant messages, cancellation, and connection errors.
- Stable client request IDs: reconnecting after a lost HTTP response does not create a second job.
- Durable restart handling: **an externally dispatched action is never automatically replayed**.
- Keystore-encrypted pairing token; loopback-only HTTP server; authenticated endpoints.
- Gradle wrapper and a GitHub Actions template for APK builds, Android lint, and bridge integration tests.

## 1. Build / get the Android app

Open this repository in Android Studio, use **JDK 17**, and build `app`.

Or use a Linux/macOS build machine with Android SDK 35:

```sh
./gradlew assembleDebug lintDebug
# app/build/outputs/apk/debug/app-debug.apk
```

The Actions template is at `ci/build-and-test.yml`. **It is not active yet:** the GitHub token used to create this repo lacked the `workflow` scope. Once authorized, move it to `.github/workflows/ci.yml` and push. It builds a debug-signed APK on each push. Download **pi-pocket-debug** from the successful **Build and test** run. Debug builds are for personal development, not Play Store release.

To authorize and enable it from your own terminal:

```sh
gh auth refresh -h github.com -s workflow
mkdir -p .github/workflows
git mv ci/build-and-test.yml .github/workflows/ci.yml
git commit -m "Enable Android and bridge CI"
git push
```

**Verification so far (2026-10-16):** all 34 bridge/diagnostics/session/worktree/review tests and 12 Android instrumentation tests pass. `assembleDebug assembleDebugAndroidTest lintDebug` passes locally in Termux. On-device tests cover preserved legacy history/pairing, drawer create/switch/rename/pin/search, independent drafts, simultaneous real Pi requests, scoped cancellation, and per-chat context recall. A full on-phone Changes workflow also passed against a disposable repository: selected commits preserved unrelated staging, real test failures/successes/stale results/cancellation were shown, and an explicitly confirmed local merge updated only the disposable default branch. Earlier tests also exercised pi-droid's read-only `android_screen_state` and the unpaired-state regression. Voice input, extension dialogs on-device, and background-process survival remain unverified. See [PROGRESS.md](PROGRESS.md) for the local build workaround and test results.

The app targets Android 15 and supports Android 8+ (API 26). The bridge is intended to run in Termux on the same physical device. This checkout does not contain an Android SDK/JDK; the tested Termux environment uses separately installed tools and a locally rebuilt ARM-native AAPT2 (see [PROGRESS.md](PROGRESS.md)).

## 2. Run the bridge in Termux

Requirements: Node **22.19+** with `node:sqlite` support (Node 24 recommended), Git with worktree support, a committed Git repository, and your already-installed, authenticated Pi CLI. Non-Git directories are rejected rather than silently sharing a checkout.

First make sure your Pi can run from your chosen project:

```sh
cd /path/to/your/trusted/project
pi
# Log in/configure your model and trust your own project resources.
# Confirm coding tools and pi-droid work here, then exit.
```

Configure the bridge:

```sh
cd /path/to/pi-pocket/bridge
npm ci --ignore-scripts
cp .env.example .env
# Edit .env:
# PI_WORKSPACE=/absolute/path/to/your/trusted/project
# PI_BIN=pi (or an absolute executable path)
# PI_POCKET_TOKEN=<random secret generated below>
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the generated token into `.env`, then run:

```sh
node --env-file=.env src/server.js
```

Keep Termux running. Android battery optimizations may stop background processes: use Termux's wake lock and your device's battery settings if needed. The app does **not** start Termux, install Pi, configure ADB, or grant device permissions on your behalf.

The bridge binds **127.0.0.1:8787 only**. It does not expose an unauthenticated LAN command runner.

## 3. Pair and talk

1. Open **Pi Pocket → ☰ → Settings** (also available under the chat's **⋮** menu).
2. Leave the URL as `http://127.0.0.1:8787`.
3. Paste the **same** pairing token from the bridge's `.env`.
4. Save; use **Test** in Settings to check the saved connection.
5. Tap **Talk**, dictate, edit the draft, and tap **Send**.
6. Answer any extension approval dialogs; use **Stop** to cancel work.

Examples:

- “Inspect this project's code and propose the next small improvement.”
- “Implement the improvement and run the tests. Don't commit until I review it.”
- “Use pi-droid to check which app is on screen.”

Device actions require pi-droid and its ADB/device setup to already work in the **bridge's Pi environment**. The Android APK itself does not bypass Android's sandbox.

For an emulator with a bridge on your workstation, forward the port with `adb reverse tcp:8787 tcp:8787` and keep the app's localhost URL. Remote hosts require a properly authenticated HTTPS tunnel/reverse proxy; plain HTTP to non-localhost hosts is deliberately blocked by the app.

## Multiple chats

Tap **＋** in the top bar or **☰ → New chat**. The drawer groups chats in this order:

1. **New chats** — conversations without a submitted message, including unsent drafts.
2. **Needs attention** — requests awaiting feedback/approval, completed Pi replies ready for review, and stopped/failed/interrupted requests.
3. **Working** — connecting/queued/running requests, with muted grey labels. Approval requests move up to Needs attention.
4. **Finished** — tasks you explicitly marked finished, with **✓ Finished by you**.

Search filters titles within the current view. Pins order chats **within** a lifecycle section; they never move running/finished tasks above attention items. Use **⋮** beside a chat (or long-press it) to rename or pin it. Drafts and selected chat survive normal app restarts. Completion in another chat does not switch your selection, and **Stop** targets only the current chat's request.

### Finish, archive and restore

A **completed Pi reply is not a finished task**. Review it and continue the conversation, or tap **Mark finished** (also in **⋮**). Only you mark a task finished; running/approval-waiting requests cannot be finished or archived. Finished chats remain visible at the bottom with a checkmark.

Use **⋮ → Archive chat** on a finished chat to remove it from the main sidebar. **Archive (N)** opens the separate archive list; history and Pi context are preserved. Open an archived chat to read it and tap **Restore chat** to bring it back into Finished. **Reopen chat** returns it to Needs attention; sending a new message from a finished chat also reopens it automatically. Archived chats cannot send requests until restored. Archive/finish state is local to this Android installation, not a bridge-side deletion or cross-device sync.

Each chat has its own model conversation: a new chat does not automatically receive another chat's messages. Renaming a chat does not reset its context. Existing pre-upgrade history stays in **Main chat**.

### Isolated coding worktrees

On its **first request**, each chat (including old chats after upgrade) gets a dedicated Git worktree and `pocket/<repo-key>/<chat-key>` branch. The bridge launches Pi **inside that worktree**. Later messages, reopen, restore and bridge restarts reuse it without resetting/rebasing, preserving commits and uncommitted edits.

By default, a new worktree discovers the configured remote's current default branch (`PI_GIT_REMOTE=origin`), fetches its latest tip, and starts a new branch there. The original checkout may be on another branch or dirty: neither is copied or modified. Git/network/setup failures fail the request; there is **no fallback to the shared checkout**. Existing worktrees need no fetch to continue.

For an offline/local-only repository, explicitly set `PI_DEFAULT_BRANCH=main` (or your actual local default branch). This selects the current committed **local** tip instead of discovering/fetching a remote. Uncommitted/ignored files, `.env`, installed dependencies, build outputs and untracked project-local extensions are **not copied**. Install dependencies separately in a worktree as needed. Global Pi extensions/settings remain available; project resources must be committed and trusted at their new location, or configured via trusted absolute `PI_ARGS` paths.

Worktrees and private identity/base manifests live under `bridge/data/worktrees/` by default. Workspace metadata (`cwd`, branch, base branch and base commit) is persisted with each bridge job; open **⋮ → Workspace details** to view/copy it. Finishing/archiving a chat does **not** delete its worktree, commit, merge, or push anything. To integrate work, review its diff and explicitly merge/cherry-pick the branch. Concurrent worktree edits no longer overwrite each other's working files, but merging changes to the same lines can still conflict. Do not remove/prune worktrees while the bridge is using them; missing or manually switched worktrees fail closed rather than being reset.

**Worktrees are not security sandboxes.** Git objects/configuration/remotes, provider credentials, tools and the physical phone remain shared. A tool can explicitly access other checkouts or private history if filesystem permissions allow; a workspace instruction discourages this but cannot enforce an OS boundary. Concurrent device actions, shared services/ports and Git-wide operations can still conflict.

The bridge admits one active request per chat and **eight** across chats by default. Configure `PI_MAX_CONCURRENT=1` through `32` in `.env` and restart the idle bridge to adjust this. This limits **active requests**, not the number of saved chats/worktrees. Higher limits consume more RAM/CPU, provider quota and money; the former limit of three was a conservative phone default, not a Pi limit. Additional app requests wait/retry with their original IDs. Keep Termux alive; this feature does not add an Android foreground service. There is no chat deletion/export UI yet.

Research and design rationale: [docs/session-navigation-research.md](docs/session-navigation-research.md).

## Review and integrate code

Open **Δ** in a chat’s header or **⋮ → Changes**. The screen shows the worktree/branch, HEAD, ahead/behind counts against the **local** default branch, working files, and committed changes. Tap a file for a colored, selectable diff with Copy. New chats without a worktree show an empty-state explanation; opening Changes never creates a checkout.

1. Review working files. Check only the files you intend to commit; nothing is preselected.
2. **Run tests** asks for an exact shell command. It runs in the chat’s project directory with full Termux permissions, has a two-minute timeout, and can be stopped. The app records the actual exit code/output; assistant prose is not test evidence. A changed revision—including a commit—marks older evidence stale.
3. **Commit selected** asks for a message and confirmation. It commits each selected file’s **whole current content**, not selected hunks. Unrelated pre-staged files are excluded. App-made commits/merges skip Git hooks and GPG signing; run required checks explicitly. Nothing is pushed.
4. After committing all working changes, **Merge into local `<default>`** asks for confirmation. The original checkout must be clean, on that branch, with no unfinished Git operation. All Pi requests must finish. Merge conflicts and local ignored/untracked path collisions are checked before updating the target. This changes the **local original checkout**, not the remote. Unexpected failures are left for inspection, never automatically reset or aborted.

Actions bind to a review revision; changed files/branch state require a refresh and new confirmation. A repository action temporarily blocks new model admissions (existing unrelated requests may continue, except a merge cannot start while any are active). Operations have persisted IDs and Durable dispatch-intent records: reconnect checks an uncertain ID, an explicit retry uses the same ID, and a dispatched action is not replayed after restart. Archived chats are read-only in the Android Changes UI until restored.

**Not a sandbox or a guarantee of code quality:** a test command can alter files or access anything Termux can; recorded success means that command exited zero for the recorded Git working revision, not that every possible test passed or that the environment is unchanged. Avoid external editors/Git commands during review actions. Previews/output are bounded; large changes, submodules/special files, conflicts, interactive signing/hooks, PR creation, remote pushing, hunk staging and destructive cleanup require manual work. Full details: [docs/changes-review.md](docs/changes-review.md).

## Extension compatibility

The bridge launches the **real installed Pi executable** in RPC mode from the chat’s worktree derived from `PI_WORKSPACE`, without disabling extensions, skills, MCP, or built-in coding tools. It uses your Pi credentials/settings, user extensions, and trusted project resources.

Optional `PI_ARGS` in `.env` is a JSON array of additional CLI flags, for example explicit `-e` extension paths. This is trusted local configuration, not input the app or model can change.

**Not every terminal UI feature is portable.** Pi RPC supports confirm/select/input/editor dialogs and notification/status updates. Custom terminal components, themes, terminal input hooks, and full TUI widgets do not render in Android. Image tool results are usable by Pi where supported, but this MVP does not render attachments/screenshots in the conversation. Native pi-durable extensions and coding-agent extensions are different APIs: existing coding-agent extensions run inside Pi RPC rather than being imported into Durable.

## Durability and safety

- One active job per chat, with bounded parallelism and a separate persistent Git worktree/branch per chat. Requests in the same chat reuse only that chat's Pi conversation and checkout.
- HTTP acceptance means persisted/queued, **not completed**.
- If an app request loses its response, it retries the **same UUID and text**.
- A job not yet dispatched can resume after a bridge restart.
- Once dispatch intent is committed, a restart marks uncertain work **interrupted**, rather than executing it again. Inspect Git diffs/device state before manually issuing a new request.
- There is an unavoidable crash window between committing dispatch intent and launching Pi; even a command that never started may be marked interrupted. This chooses safety over automatic replay.
- Cancellation terminates the Pi process group; it **does not undo** prior edits, sends, purchases, or device actions. Detached/external work may outlive it.
- Provider/tool failures are displayed as failures. Inspect changes before retrying.
- The bridge enforces an exclusive storage lock. If it crashes, verify no bridge/Pi child is still running before deleting `bridge/data/bridge.lock` and restarting. Never open the same storage with multiple bridge processes.

**This is a powerful local agent, not a sandbox.** The Send button authorizes a request, and extensions may ask for approvals, but there is no universal per-tool approval gate. Pi has the permissions of your Termux user and configured tools. Do not use it on untrusted projects, expose the port publicly, or dictate secrets.

Speech recognition is handled by your installed speech provider and may use its cloud services. Conversations may be sent to your Pi model provider. SQLite history/session files are local but **not encrypted**. Tokens are Keystore-encrypted in the app; bridge secrets stay in the ignored `.env`. App backups are disabled. No credentials, conversations, APK signing keys, or private project files belong in this public repository.

## Development

```sh
cd bridge
npm ci --ignore-scripts
npm test
```

Integration tests use real Pi Durable SQLite storage and a deterministic fake RPC child, with no model costs or device actions. They cover persistence/reopen, duplicate admission, conflicting IDs, atomic per-chat admission, bounded parallelism, session isolation/legacy compatibility, approval responses, cancellation, provider failures, handled extension commands, HTTP auth/validation, timeouts, and interrupted-command non-replay. Repository-review tests use real temporary Git repositories and shell commands to cover selected commits, staging isolation, stale revisions, real test evidence, dirty-target/conflict/ignored-file guards, snapshot races, and action non-replay.

### Diagnostics and on-device checks

Android diagnostics use the `PiPocket` Logcat tag:

```sh
adb logcat -s PiPocket:I
```

The bridge writes JSON metadata to stderr: HTTP route category/status/duration, job IDs/state transitions, and Pi subprocess acceptance/completion. Redirect stderr to a private, ignored local file if needed. The local test deployment uses `bridge/data/bridge.log`. Diagnostics deliberately omit tokens, Authorization headers, arbitrary URLs, prompts, answers, and raw exception messages. These are troubleshooting logs, not a full audit trail; existing SQLite/Pi session history still contains conversation content. Log files currently need manual retention/rotation.

With the main app screen visible, read-only ADB checks are available:

```sh
# Before pairing (does not unpair or erase existing settings):
python scripts/check-ui.py unpaired
# After the latest request completes (checks latest, not an older answer):
python scripts/check-ui.py done --contains Benfica
# After stopping the latest request:
python scripts/check-ui.py cancelled
```

These scripts require Python and authorized ADB; `ANDROID_SERIAL` selects a device when needed. They never print the UI tree or conversation contents. The unpaired screen offers **Pair bridge** and labels saved active work **WAITING FOR PAIRING**. New unpaired submissions open Settings rather than adding another undeliverable job. Existing pending requests keep their IDs and resume after pairing.

### Layout

- `app/src/main/java/dev/pipocket/` — Kotlin activity, SQLite history, HTTP client and Keystore token storage.
- `bridge/src/store.js` — Durable task definition and persisted request state.
- `bridge/src/rpc.js` — isolated Pi subprocess and JSONL protocol.
- `bridge/src/workspaces.js` — stable per-chat Git worktrees and validation.
- `bridge/src/review.js` — repository snapshots, diffs, selected commits, test commands, and guarded local integration.
- `app/src/main/java/dev/pipocket/ChangesActivity.kt` — native review/confirmation screen.
- `bridge/src/server.js` — authenticated loopback API.
- `bridge/test/` — deterministic integration suite.
- `ci/build-and-test.yml` — ready-to-enable Android build/lint/APK artifact and bridge tests.

### API

Every route requires `Authorization: Bearer <token>`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Authenticated liveness, `protocolVersion: 4`, `worktreeIsolation: true`, `changesReview: true`, `maxConcurrent` |
| POST | `/v1/jobs` | Submit `{requestId, text, sessionId}`; returns persisted job. Omitting `sessionId` uses legacy `pocket` |
| GET | `/v1/jobs/:id` | Poll status, answer, tool progress, pending dialog |
| POST | `/v1/jobs/:id/ui` | Respond with matching dialog `id` and `confirmed`, `value`, or `cancelled` |
| POST | `/v1/jobs/:id/cancel` | Stop a task; no rollback |
| GET | `/v1/sessions/:sessionId/changes` | Revision-bound file/branch snapshot, last operation and test evidence; `refreshRequired` means read again before acting |
| GET | `/v1/sessions/:sessionId/diff?revision=…&scope=working\|committed&path=…` | Bounded diff for a listed file |
| POST | `/v1/sessions/:sessionId/actions` | Persist `{operationId, revision, action}`; `commit` also takes `paths,message`, `test` takes `command`, `merge` needs no extra fields |
| GET | `/v1/sessions/:sessionId/actions/:operationId` | Resolve an uncertain request using its exact saved ID |
| POST | `/v1/sessions/:sessionId/actions/:operationId/cancel` | Stop a test action only; no rollback |

Statuses: `queued`, `running`, `done`, `failed`, `cancelled`, `interrupted`. The app also stores `sending` before server acknowledgement and `rejected` for invalid/conflicting admission. Results are bounded; full coding-agent history lives in Pi's session files. The MVP retains request history indefinitely; retention/export controls and multi-workspace conversation management are follow-up work.

## Next milestones

- On-device end-to-end coverage with actual voice and pi-droid actions.
- Streaming committed partial output, screenshot attachments, and optional text-to-speech.
- Multi-repository selection, conflict-resolution/PR/push and safe worktree cleanup UI, full-text history search, and data deletion/export.
- A foreground-service integration and clearer per-action approval policies.
- Release signing and installable GitHub Releases.

## License

MIT. Pi and its extensions retain their own licenses.
