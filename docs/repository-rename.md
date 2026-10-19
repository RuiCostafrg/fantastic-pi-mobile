# Fantastic Pi Mobile: rename and next steps

## Current naming

- GitHub repository: https://github.com/RuiCostafrg/fantastic-pi-mobile
- Local entry point: `~/projects/fantastic-pi-mobile`.
- App display name: **Fantastic Pi Mobile** (takes effect after a future APK build/install).
- Gradle project: `fantastic-pi-mobile`; private Node package: `fantastic-pi-mobile-bridge`.
- CI artifact template: `fantastic-pi-mobile-debug`. CI is still a template, not enabled by this rename.
- Local continuation notes: `~/.pi/agent/handoffs/fantastic-pi-mobile-gym.md`.

## Validation — 2026-10-19

- Bridge integration tests: 46/46; optional adapter tests: 2/2; observer regressions: 10/10.
- Normal and isolated Android app/test APK assembly and lint succeeded in Termux.
- Actual Android isolated fixture: 24/24 history, request-status, drawer, review UI
  and layout tests passed. The rename regression checks the application label and
  drawer branding at 280dp with 100% and 200% font scaling.
- First combined instrumentation run hit one activity-launch timeout in an existing
  layout test; the layout class alone and the complete rerun passed unchanged.
  This is a recorded intermittent test failure, not a diagnosed/fixed defect.
- Normal app data/pairing and bridge runtime were not migrated or restarted.
  The normal renamed APK was built, not installed. Production end-to-end and
  background reliability are not newly verified by these checks.

## Compatibility retained deliberately

The local entry point is a symlink to `~/projects/pi-pocket`, which remains the
physical checkout. `bridge/src/workspaces.js` hashes the real absolute Git common
directory to derive repository/worktree identity and validates saved paths against
it. Merely moving the directory, even with an old-name symlink, changes `realpath`
and can prevent saved chats from reusing their worktrees. No runtime data, saved
sessions, configuration secrets, existing worktrees or Git history were rewritten.

These are stable technical identifiers, not missed branding replacements:

- Android namespace/application ID `dev.pipocket`, isolated fixture IDs, source
  package directories, `PocketUi.kt`, `PocketColors`, theme and `PiPocket` Logcat tag.
  Keeping the application ID preserves the existing installation's history/pairing.
- `PI_POCKET_TOKEN`, `PI_POCKET_TMUX_SESSION`, `PI_POCKET_TMUX_WINDOW`.
- Plugin path `plugins/pi-droid-pocket`, package `@pi-droid/plugin-pocket`, plugin
  ID/actions `pocket.*`, and existing tmux window `pocket-bridge`.
- Existing `pocket/...` branches and historical evidence filenames/markers.

Old local paths remain valid. The old local handoff filename is retained as a
symlink for existing continuation prompts. Historical notes are not live evidence;
rediscover processes and bridge readiness before taking operational action.

## Next steps

1. Continue reliability work from `PROGRESS.md`, `docs/reliability-baseline.md` and
   `docs/pi-droid-migration-handoff.md`, using the new local entry point. Agree any
   visible phone scenario with the user; no phone test or bridge restart is part
   of this rename.
2. Before physically moving the checkout, design an explicit migration for stable
   repository identity, Git worktree links, workspace manifests, persisted job
   metadata, Pi session paths and private configuration. Inventory actual current
   state first and require all model/review operations idle plus a private backup.
3. Validate that migration against a disposable repo with existing chats/worktrees:
   same branch, edits, session context and exact request IDs after relocation;
   uncertain dispatched actions remain non-replayed. Include restart/rollback
   coverage before scheduling a user-approved production migration.
4. Normal and isolated APK build/lint and narrow-width/large-font drawer checks
   are complete. A normal-app upgrade/install and production smoke test remain
   separate user-approved steps; only disposable fixture APKs were installed.

Physical relocation and renaming compatibility identifiers are **not completed**
by this change. Treat them as migrations, not blind search-and-replace work.
