# B11 — deployed and visible continuity smoke verified

## Completion — 2026-10-23

**B11 complete. Stop after Milestone B.** The user explicitly requested continuation
of the recovered interrupted B11 work. No commit/push or later milestone was begun.
Earlier dated blocked/no-deployment statements below describe their checkpoints,
not the current deployment.

### Recovered interrupted work

The October 23 05:46 UTC session prepared private backups and launched fresh gates.
Android killed processes with `Trimming phantom processes`; the recovery session
confirmed bridge **159/159**, normal build/unit-test/test-APK/lint exit **0**, and
isolated controller exit **0**. It installed the normal APK with `adb install -r`
without data clearing, started protocol 6, paused admissions and opened the app.
It then created the disposable smoke source, but registration failed because its
script looked for the wrong credential environment names. Subscription quota ended
that session before retry. These are recovered log results, not newly rerun tests.

APK hash recorded at installation:
`23fbdb8b2b20617187c7d0553c11c04635c11cdd73ac6012510a656a013029f5`.
Both APK signing-certificate SHA-256 digests matched before that installation.
Installed package rediscovered as `dev.fantasticpimobile`, version 0.7.0; private
Android database is schema 5 with integrity `ok`. No reinstall was needed today.

### Fresh recovery gates and single owner

- Initial controller: `unverified / owner-process-missing`, stale lock PID 6118.
  `/proc`/same-UID process metadata found no bridge/execution worker; loopback 8787
  refused connections, the old PID was absent, all **28** Durable tasks were terminal
  and byte-for-byte row-identical to the private pre-deployment backup. SQLite
  integrity was `ok`. No uncertain task was resubmitted or lock blindly deleted.
- Original **232** Pi/worktree/config/manifest file hashes matched. Private fresh
  SQLite online backup and Android tar were saved before recovery. Verified stale
  lock was moved into the private evidence directory, preserving it for diagnosis.
- Explicit `scripts/bridge-work start`, then `pause`, established one verified owner
  PID 27168 under `work:fantastic-pi-mobile-bridge`; protocol 6, event/history schema 1,
  eight slots and stable owner `988c437d-4945-4f78-a129-9323f6363106`. No owner pin reset.
  Earlier owner disappearance was not reproduced or diagnosed by this smoke test.
- Readiness: screen on, ADB authorized, storage available. Only inactive ADBKeyboard
  failed preflight. Gboard stayed unchanged; ASCII `adb shell input text` provided
  the announced prompt without changing the IME. No phone settings were modified.
- Project registration retried successfully using the protected
  `FANTASTIC_PI_MOBILE_TOKEN` in memory/Authorization header. No secret was printed,
  placed in argv/URLs or added to Git. Terminal config/state/output are private.

### Actual normal-app / real-provider continuity

Disposable source was pre-seeded on local branch `trunk`, outside the real checkout.
Project: `3d85b8f9-c3e7-4e8d-9a8c-8670036b1f26` (B11 Continuity Smoke).
Conversation: `a533a235-f928-4059-94c7-ec5162ad1dd7`.

1. Actual Android new-chat/project picker selected that project. Actual Send submitted
   first run `7c579e91-9690-47d0-8342-33fe79b3a62f`: remember `ORCHID_7429`, replace
   only `hello.txt` with `B11_ANDROID_OK\n`, execute `sh check.sh`, report cwd.
   Real provider completed with the exact check marker; B09 `list`/`open` discovered
   the exact chat and completed first turn.
2. Android went Home before the second Send. The actual B09 executable
   `node scripts/conversation-client.mjs --config <private-path>` opened the exact
   conversation, sent run `7aec8c90-b2bb-4419-8318-ebeda6b3cab0`, then detached.
   Client exited **0** in **0.69 s** after queued acceptance. A subsequent exact-ID
   HTTP read showed **running / tool_execution_start: bash** after client exit.
3. Real Pi session records prove one `sleep 45` dispatch, 12:19:56.525–12:20:41.635 UTC,
   followed by one replacement with `B11_TERMINAL_OK\n` and successful `sh check.sh`.
   The answer recovered context `ORCHID_7429` without repeating it in the second
   prompt. Both runs reported the same isolated worktree/branch/base/source.
4. Android reopened only after completion and visibly showed **PI · DONE**, the
   terminal check marker, correct cwd and remembered context. Home/reopen again
   retained the result. Two repeated terminal snapshots were identical: exactly
   **two unique ordered completed turns / four canonical messages**, not duplicate
   dispatches. SQLite cache has the exact chat/project and canonical revisions;
   remote terminal work correctly lives in shared cache rather than a new local job.
5. Actual Changes/diff view showed only `hello.txt`, `B11_SEED → B11_TERMINAL_OK`.
   No files selected, review command submitted, commit or merge performed. The old
   B04b chat visibly retained completed/cancelled history and its separate locked
   project. Its Changes screen retained prior test evidence and disabled merge
   while the original checkout was dirty; no review action was replayed.

### Final preservation and runtime

- **29/29 original Android job rows exactly unchanged**, including pending/review
  JSON/status; one new Android-origin smoke job. Original **15/15 sessions** retain
  IDs/title/draft/organization/timestamps. Only eight legacy `projectId/projectState`
  pairs changed from unresolved to bound; all eight matched fresh bridge session
  project responses. One new smoke session (16 total). Android integrity `ok`.
- Pairing and all preferences unchanged except expected `chat-ui.xml:selected`.
  All **28/28 original bridge task rows unchanged**; exactly two added smoke model
  tasks, **30 terminal tasks / zero active**. Original **232/232** saved file hashes
  still match; expected new smoke session/worktree/cache/history-import state retained.
- **157/157** pre-existing source inventory hashes matched before documentation
  updates; HEAD remains `f7fb2cda051f2f69cf9212c6f97261688bba06d6`, staged diff remains
  identical/empty. Disposable source stays clean on trunk; only its isolated
  worktree `hello.txt` is modified. No real default branch was merged or committed.
- Final controller: one verified healthy protocol-6 owner, **zero jobs/reviews/active
  tasks**, admissions **open deliberately** after the smoke hold. User may submit
  again. Existing source changes and all private backups/history/worktrees retained.
- No new heavy build/test rerun: source matched the recovered passing-gate inventory.
  `git diff --check` passed before and after evidence updates. Future heavy gates
  should run sequentially because the earlier parallel run triggered process trimming.

Private evidence/consistent backups:
`~/.local/state/fantastic-pi-mobile/b11-20261023-075053/`, with fresh recovery/final
artifacts in `resume-20261023/`. Contains credentials/history; never commit/publish.
Raw terminal transcript, canonical snapshots, after-detach running job, Android
before/final snapshots, exact legacy bindings and real tool dispatch records are
retained there. Do not overwrite live accepted work with these older snapshots.

**Limits:** foreground/client-detach continuity is proven, not force-stop/process-death,
screen-off, Doze, overnight survival, external-client networking, arbitrary disk fault
or approval-race behavior under a real provider. Earlier isolated B10 tests cover
separate deterministic cases. No runtime auto-restart or replay guarantee added.

---

## Scope and authorization — 2026-10-21

After reviewing the B11 maintenance/backup/preservation/deployment/visible-smoke/
rollback plan, the user replied “please xontinue”. This authorizes that bounded
plan, not screen-off/host-death tests, phone-setting changes, history deletion,
commit/merge/push, remote expansion or unrelated provider work. B10 remains
complete in isolated fixtures; B11 is **incomplete**.

## Actual evidence in this continuation

- `git status --short --branch`: main, same pre-existing modified/untracked work;
  no source/index operation. HEAD previously inspected in this session:
  `f7fb2cda051f2f69cf9212c6f97261688bba06d6`. Preparation observed 18 modified
  tracked files, 56 untracked files and an empty staged diff. This continuation
  intentionally adds this document and checkpoint notices only.
- `scripts/bridge-work status`: `state: unavailable`, `ready: false`,
  `reason: storage-lock-missing`; owner/health/maintenance/storage all null,
  window empty and tmuxAvailable null. This does **not** prove global idleness,
  child absence, the cause of any prior exit, or permission for blind startup.
- Read-only tmux pane metadata showed only the existing `work:node` pane `%0`
  (pane PID 11768), not a dedicated bridge window. No pane histories/environments
  were captured. Process metadata was inspected without printing argv or secrets.
- `ss -ltn` reported `Cannot open netlink socket: Permission denied`; it is not
  evidence that the configured bridge port is free. No authenticated health probe
  or journal read was performed beyond the controller's missing-lock refusal.
- Native ADB and pi-droid discovered one connected ASUS_I003D. No pairing,
  insecure TCP/IP mode, or phone-setting change was performed.
- Initial screen-state output was inconsistent/incomplete (screen off, locked
  false, foreground unknown). It was not accepted as readiness proof.
- `android_ensure_ready` returned: **Device remains locked; unlock it manually
  before automation**. No app package was supplied or launched.
- `android_preflight`, 2026-10-21T17:34:14.969Z: ready false; ADB connectivity,
  authorization, installed ADBKeyboard and storage passed; screen-on and active
  ADBKeyboard failed. Gboard remains active. Do not apply the suggested IME fix:
  phone-setting changes are outside this authorization. No phone UI was read.

The readiness attempt is not a screen-off experiment or survival evidence.
No tests/builds were rerun, no normal-app data was accessed, no backup was created,
no APK was installed, no migration/provider job was started, and no bridge was
started/stopped/restarted. B10 and older deployment results are historical only.

## Next gate

Ask the user to wake/unlock the phone manually and leave it on. Rediscover readiness
and the production owner/state afresh; do not reuse the absent-lock result as idle
proof. Use user typing or a no-settings-change input method if needed.

Then follow the agreed order:

1. Maintain the human submission/review-action hold; prove owner/child/port/task
   state and account for uncertain Android/review IDs. Defer unknown/live work.
2. Make and verify private consistent bridge/Android/Pi/worktree/configuration/APK
   backups plus a usable old-runtime/source snapshot outside Git, restricted to
   owner access. SQLite integrity and inventory comparisons are mandatory.
3. Fresh isolated test/build/controller gates; exact normal APK identity, hash and
   signing compatibility. Install without uninstall/data clearing. Verify the
   additive Android migration, protocol-6 owner/capabilities/schema, and original
   state before smoke. New start accepts admissions by default: retain the human
   hold and pause immediately during verification.
4. In an agreed pre-seeded disposable project, Android first turn; real B09 terminal
   opens the exact chat, sends the second turn, detaches while it is running;
   Android is away, then visibly reopens to the canonical ordered result once.
   Verify exact IDs/project/worktree/context and old chats/review safety read-only.
5. Compare original rows/IDs/preferences/review JSON, Pi/worktree bytes and manifests,
   source HEAD/index/staging; enumerate expected additive smoke/cache/import changes.
   Retain history/backups/worktrees; verify one healthy owner and deliberate
   admission state. Record failures and unavailable gates, not inferred passes.

Credentials only through protected files/memory/stdin, never argv, URLs, logs or
Git. Terminal output containing transcript is private too. Worktree backups depend
on original shared Git metadata; copied Android ciphertext does not back up Keystore
keys. No blind old-APK downgrade across schema versions. After migration/import/new
writes, pause and reconcile explicitly rather than overwrite live state or erase
accepted work with an old snapshot. No second owner or automatic uncertain replay.

References: [B11 checklist](next-steps.md), [maintenance/backup](bridge-work.md),
[shared contract](shared-conversation-design.md), [prior deployment](project-deployment.md),
[terminal client](terminal-conversations.md), [B10 limits](cross-client-continuity.md).
