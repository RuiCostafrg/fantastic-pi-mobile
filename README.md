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

The app uses Android's built-in SQLite API (no hosted database). Pi Durable commits request IDs, task intent, status, extension dialogs, and results to a second SQLite database in Termux. Pi keeps its own persistent conversation session. There is no second “router model” and no second set of model credentials: actual work goes through your existing Pi CLI.

### Included

- Voice input using Android's installed speech activity; typing works without it.
- Review/edit before Send; no hot microphone or automatic execution.
- SQLite request history, retained across app restarts.
- Persistent Pi conversation, code editing, and installed Pi extension discovery.
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

**Verification so far:** the bridge integration suite passes locally. The Android APK has not been compiled or tested on-device yet; an Android SDK/JDK is not installed in the development Termux environment.

The app targets Android 15 and supports Android 8+ (API 26). The bridge is intended to run in Termux on the same physical device. This checkout does not contain an Android SDK/JDK or promise native Android builds directly in Termux.

## 2. Run the bridge in Termux

Requirements: Node **22.19+** with `node:sqlite` support (Node 24 recommended), Git, and your already-installed, authenticated Pi CLI.

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

1. Open **Pi Pocket → Settings**.
2. Leave the URL as `http://127.0.0.1:8787`.
3. Paste the **same** pairing token from the bridge's `.env`.
4. Save; the app tests the connection.
5. Tap **Talk**, dictate, edit the draft, and tap **Send**.
6. Answer any extension approval dialogs; use **Stop** to cancel work.

Examples:

- “Inspect this project's code and propose the next small improvement.”
- “Implement the improvement and run the tests. Don't commit until I review it.”
- “Use pi-droid to check which app is on screen.”

Device actions require pi-droid and its ADB/device setup to already work in the **bridge's Pi environment**. The Android APK itself does not bypass Android's sandbox.

For an emulator with a bridge on your workstation, forward the port with `adb reverse tcp:8787 tcp:8787` and keep the app's localhost URL. Remote hosts require a properly authenticated HTTPS tunnel/reverse proxy; plain HTTP to non-localhost hosts is deliberately blocked by the app.

## Extension compatibility

The bridge launches the **real installed Pi executable** in RPC mode from `PI_WORKSPACE`, without disabling extensions, skills, MCP, or built-in coding tools. It uses your Pi credentials/settings, user extensions, and trusted project resources.

Optional `PI_ARGS` in `.env` is a JSON array of additional CLI flags, for example explicit `-e` extension paths. This is trusted local configuration, not input the app or model can change.

**Not every terminal UI feature is portable.** Pi RPC supports confirm/select/input/editor dialogs and notification/status updates. Custom terminal components, themes, terminal input hooks, and full TUI widgets do not render in Android. Image tool results are usable by Pi where supported, but this MVP does not render attachments/screenshots in the conversation. Native pi-durable extensions and coding-agent extensions are different APIs: existing coding-agent extensions run inside Pi RPC rather than being imported into Durable.

## Durability and safety

- One active job and one configured workspace at a time. Requests share one Pi conversation.
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

Integration tests use real Pi Durable SQLite storage and a deterministic fake RPC child, with no model costs or device actions. They cover persistence/reopen, duplicate admission, conflicting IDs, concurrent-job rejection, approval responses, cancellation, provider failures, handled extension commands, HTTP auth/validation, timeouts, and interrupted-command non-replay.

### Layout

- `app/src/main/java/dev/pipocket/` — Kotlin activity, SQLite history, HTTP client and Keystore token storage.
- `bridge/src/store.js` — Durable task definition and persisted request state.
- `bridge/src/rpc.js` — isolated Pi subprocess and JSONL protocol.
- `bridge/src/server.js` — authenticated loopback API.
- `bridge/test/` — deterministic integration suite.
- `ci/build-and-test.yml` — ready-to-enable Android build/lint/APK artifact and bridge tests.

### API

Every route requires `Authorization: Bearer <token>`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Authenticated liveness |
| POST | `/v1/jobs` | Submit `{requestId, text}`; returns persisted job |
| GET | `/v1/jobs/:id` | Poll status, answer, tool progress, pending dialog |
| POST | `/v1/jobs/:id/ui` | Respond with matching dialog `id` and `confirmed`, `value`, or `cancelled` |
| POST | `/v1/jobs/:id/cancel` | Stop a task; no rollback |

Statuses: `queued`, `running`, `done`, `failed`, `cancelled`, `interrupted`. The app also stores `sending` before server acknowledgement and `rejected` for invalid/conflicting admission. Results are bounded; full coding-agent history lives in Pi's session files. The MVP retains request history indefinitely; retention/export controls and multi-workspace conversation management are follow-up work.

## Next milestones

- On-device end-to-end coverage with actual voice and pi-droid actions.
- Streaming committed partial output, screenshot attachments, and optional text-to-speech.
- Multiple conversations/projects, searchable history, and data deletion/export.
- A foreground-service integration and clearer per-action approval policies.
- Release signing and installable GitHub Releases.

## License

MIT. Pi and its extensions retain their own licenses.
