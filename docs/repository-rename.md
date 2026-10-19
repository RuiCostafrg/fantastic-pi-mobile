# Fantastic Pi Mobile: identifiers and migration

## Active names

- GitHub: https://github.com/RuiCostafrg/fantastic-pi-mobile
- Local entry point: `~/projects/fantastic-pi-mobile`.
- Android application ID and Kotlin namespace: `dev.fantasticpimobile`.
- Isolated Android fixture: `dev.fantasticpimobile.reliability`.
- App display name: **Fantastic Pi Mobile**; theme: `Theme.FantasticPiMobile`.
- Kotlin sources: `app/src/main/java/dev/fantasticpimobile/`.
- Android database: `fantastic-pi-mobile.sqlite`; Keystore alias: `fantastic-pi-mobile-token`.
- Logcat tag: `FantasticPiMobile`.
- Gradle project: `fantastic-pi-mobile`; Node package: `fantastic-pi-mobile-bridge`.
- Pairing variable: `FANTASTIC_PI_MOBILE_TOKEN`.
- Controller overrides: `FANTASTIC_PI_MOBILE_TMUX_SESSION`, `FANTASTIC_PI_MOBILE_TMUX_WINDOW`.
- Default dedicated tmux window: `fantastic-pi-mobile-bridge`.
- Optional plugin directory: `plugins/pi-droid-fantastic-pi-mobile`; package:
  `@pi-droid/plugin-fantastic-pi-mobile`; plugin/action prefix: `fantastic-pi-mobile`.
- CI artifact template: `fantastic-pi-mobile-debug`; CI remains a template, not enabled.
- Continuation notes: `~/.pi/agent/handoffs/fantastic-pi-mobile-gym.md`.

## Completed Android migration — 2026-10-19

The user explicitly chose to preserve chats while changing the package identity.
The new app was built and installed alongside the old `dev.pipocket` app, which
remains installed, stopped and disabled as a rollback option. Disabling hides its
identical launcher label and prevents accidental sends; it does not remove data.
An explicitly approved rollback can re-enable it with `adb shell pm enable dev.pipocket`.
Do not use both apps for the same requests. No old-app data was cleared or old
package uninstalled.

- Migrated and verified **11 original chats and 21 original messages**, including
  chat IDs, request IDs, titles, drafts, pinned/finished/archive state and review
  preferences. All seven archived chats remain present.
- The old app had one request still marked `sending` while the bridge was stopped.
  Its ID, text and history were retained, but the destination status was explicitly
  quarantined as `interrupted`, never silently replayed. The old source is unchanged.
- Copied only app history/UI state. Old Keystore ciphertext was not reused. The
  trusted local bridge token was transferred via pipes/app-private storage and
  encrypted by the new package's own Android Keystore key. Temporary plaintext
  input was deleted. The test-only import APK was removed after verification.
- Private source/target backups and verification evidence live under ignored
  `bridge/data/maintenance-backups/android-package-migration-*/`. They contain
  private history and are not publication artifacts.
- The initial pairing-file transfer failed safely; the pipe transport was corrected,
  independently verified byte-for-byte, and the explicit import passed. Final
  database comparison verified the imported records before normal app use.

The migration helper is `scripts/migrate-android-package.py`. It requires an exact
ADB serial and explicit confirmation, refuses a populated target and uncertain
requests by default, and never uninstalls either app. `--quarantine-pending` is an
explicit non-replay choice. It expects the newly installed normal app and matching
test APK, not the fixture variant. A partial migration is not automatically retried
or overwritten: inspect the private backup and target before proceeding.

## Validation

- **48/48 bridge tests**, including a red/green regression for management commands
  launched through the symlinked checkout. CLI detection now resolves the entry
  point before comparing module paths; it no longer silently does nothing. The
  server CLI has the same independently red/green-tested symlink fix.
- **2/2 optional plugin tests**, **10/10 observer regressions** and the isolated real
  tmux backup/restart/non-replay harness passed after identifier changes.
- New-package normal app/test APK assembly and Android lint passed.
- **24/24 Android checks** passed in `dev.fantasticpimobile`: history, status, drawer,
  review and layout (including 280dp drawer branding at 100%/200% font).
- Actual pi-droid interaction opened the new package, displayed migrated history
  and all seven archives, created a new chat and sent a tools-free request through
  the real Send button. The real provider returned exactly
  `FANTASTIC_PI_MOBILE_MIGRATION_OK` with **PI · DONE**. The result and pairing
  persisted after force-stop/relaunch.
- Fresh pre-start checks found no bridge/RPC owner or listener and all 17 saved
  tasks terminal; a private backup preceded the explicit bridge start. All 17
  original task records remained identical afterwards. A separate fresh user Test
  and the labelled smoke test added two terminal jobs. No uncertain request replay.
- The old app's saved files remained byte-identical to the migration source.
  A migrated draft subsequently sent by the user was verified against its new
  message rather than mistaken for lost draft content.

These checks establish this foreground migration/smoke test, not new voice,
physical screen-off, Doze or background-survival guarantees.

## Deliberately preserved saved identities and remaining folder migration

Changing the package does not require rewriting opaque conversation/request IDs.
Existing `pocket` session IDs, Durable journal kinds, stored Pi session filenames,
Git worktree branch names and historical evidence markers remain stable to keep
existing conversations and dispatch records connected. They are saved identities,
not the Android application/package/plugin names. Never blindly replace them in
private journals or transcripts.

The new local entry point is still a symlink to the physical `~/projects/pi-pocket`
checkout. `bridge/src/workspaces.js` hashes the real absolute Git common directory
and validates saved worktree paths. Physical relocation is **not completed**: it
needs a separately tested migration of repository identity, Git worktree links,
workspace manifests, journal metadata, session paths and private configuration.
Inventory idle production state and take private backups before doing that work;
validate existing dirty worktrees/session continuity and rollback in a disposable
repository first. An old-name path or historic session is not permission to replay
an uncertain external action.
