# Changes review and local integration

Implemented in Android/bridge version 0.5.0, health protocol v4.

## Workflow

Open **Δ** (accessible label: Review changes) or **⋮ → Changes** in a chat. This screen is scoped to that chat's existing worktree; read requests never create or reset a checkout.

- **Working changes:** tracked modifications, additions/deletions, and non-ignored untracked files. Selection is initially empty. Tap a filename to inspect its diff.
- **Committed changes vs local default:** changes introduced by the branch since its merge base with the recorded local default branch. These are separate from work that still needs committing.
- **Branch information:** checkout directory, branch, HEAD, and ahead/behind counts against the local default. This is not a claim that the remote has been refreshed or updated.
- **Diff viewer:** monospace, colored additions/removals/headers, selectable text, Copy, and a scrollable view. New text files are previewed; untracked binary files show size/hash; symlinks show their link target without reading the destination.

### Selected-file commits

Select files, tap Commit selected, enter a message, and confirm. The action includes the entire current contents/mode of those files, not selected hunks or only the currently staged portions. It does not include unrelated files that were already staged.

The implementation validates every selection against the current file list, passes literal path arguments after `--`, stages only those files, and uses `git commit --only`. Hooks and GPG signing are disabled for app-made commits/merges so these do not trigger interactive prompts or implicitly run project hooks. Configure a Git identity yourself and explicitly run required checks. There is no amend, discard, reset, force-push, or automatic commit operation.

If Git fails after staging, selected files may remain staged; refresh and inspect. App actions do not promise rollback of Git, hook/filter, filesystem, or external-process side effects.

### Test evidence

Run tests prompts for an exact command, including the permission warning. It executes through `bash -c` in the chat's configured project subdirectory, with the same permissions as Termux. It is not an allowlisted test runner or sandbox: only run commands you understand.

The bridge records the actual command, start/finish time, exit code, bounded output, timeout flag, and revision fingerprint. Output is kept privately in Durable storage, not diagnostic logs. A two-minute timeout terminates the process group; Stop test command cancels it. Detached work can escape the group and prior side effects are not undone.

The UI never treats an assistant's statement that tests passed as evidence. It distinguishes not run, running, failed exit code, completed exit zero, stale, cancelled, interrupted, and a failure to record a result. A completed review task can contain a nonzero test exit code: task completion and test success are different states.

Revision fingerprints bind repository/worktree identity, HEAD, tracked/untracked current bytes, permissions and index diff. A later edit or commit makes old evidence stale; changed-during-run or unreviewable special-file/submodule states are also conservative/stale. Ignored files, installed dependencies, environment variables, services and provider behavior are not fully fingerprinted. Exit zero proves that command succeeded for the recorded source revision, not universal correctness or an unchanged environment.

### Explicit local integration

Merge into local `<default>` integrates **all committed work** from the chat, not just the files last selected in the UI. The confirmation explicitly says it updates the original checkout's working files. It never pushes or opens a PR.

Guards:

1. The chat must have no working/untracked changes and no unfinished Git operation.
2. The original checkout must be on the recorded local default branch, clean, and without an unfinished merge/rebase/cherry-pick/revert.
3. No Pi requests may be active anywhere in the bridge when integration is admitted.
4. Review state must still match the confirmed revision.
5. `git merge-tree --write-tree` checks merge conflicts without modifying the target checkout. Conflicts are reported for manual resolution.
6. Incoming target paths are inspected for ignored/untracked local collisions and symlink ancestors. Do not rely solely on `--no-overwrite-ignore`: a regression probe demonstrated that Git's no-fast-forward merge path can overwrite an ignored file despite that flag. The explicit path guard prevents this.
7. State is checked again, then an explicit local `git merge --no-ff` runs with hooks/signing disabled. Unexpected failures are not followed by an automatic reset/abort; inspect the original checkout before trying a new action.

Git worktrees share repository metadata and are not OS isolation. Avoid external edits, Git operations and cross-checkout model actions during review. Native Git locks and revision checks do not create a universal filesystem transaction against unrelated processes.

## Persistence, admission and uncertain responses

Repository actions are separate Pi Durable tasks with a document journal. An operation ID is bound to the session and normalized action input; a repeated identical ID returns its existing operation, while different input gets a conflict.

Admission is atomic with model-job admission. Only one repository action is admitted at a time. It blocks new model requests; existing requests in unrelated chats may continue during tests/commits, but merging requires all model work to finish. Committing/testing underneath a running request in the same chat is rejected.

Dispatch intent is committed before invoking Git or a test process. A restart after intent is uncertain: the action becomes interrupted and is never automatically replayed. Git actions cannot be cancelled after dispatch; only test actions expose Stop.

The Android app saves the confirmed body and UUID before submission. After an uncertain response, Refresh queries that exact operation ID; explicit Retry uses the same confirmed ID. It never silently creates a new action ID or retries uncertain external work under a new ID.

A read can overlap a very fast action. The bridge compares action/model state around snapshot construction and sets `refreshRequired` / `repositoryBusy` when these changed. The screen keeps mutation controls disabled and polls again rather than leaving an old revision actionable. Independent external edits are still checked again at execution time.

Archive/finish flags remain Android-local organization state. Archived chats are read-only in this screen until restored; the bridge does not implement archive as authorization or deletion.

## Bounded/mobile behavior

- At most 300 working files and 300 committed changed files per snapshot.
- Changed file content is limited to 16 MiB per file and 32 MiB total; large Git diff frames are also bounded.
- Preview/output text is bounded to 200,000 characters. The UI labels truncated previews/output; inspect the full files manually when needed.
- Special files/submodule working-state changes are not selected for mobile commits. Conflict resolution, hunk staging, signed/hook-driven integration, PR creation, remote pushing, and worktree cleanup remain manual.
- History, output and operation journals currently have no automatic retention policy. They may contain secrets if your test commands print them. Do not publish runtime data or private backups.

## Verification

Bridge tests use real temporary repositories, real Git commands, Durable SQLite, fake RPC peers and harmless shell commands. Coverage includes staging isolation, literal filenames, deletion/symlink/binary previews, stale/mode/repository-bound revisions, actual test evidence, test cancellation, admission conflicts, restart non-replay, clean local integration, dirty/default-branch guards, conflict preservation, ignored-file protection, HTTP authentication/privacy and the fast-action snapshot race.

Android instrumentation verifies evidence-state wording, conservative freshness and colored diff text in addition to existing history/drawer tests. On-device pi-droid tests exercised a full workflow against an ignored disposable repository: a real Pi request edited files; native controls ran failing/passing tests, committed only selected files while preserving unrelated staging, marked pre-commit evidence stale, stopped a long test, committed remaining files, reran checks, and merged into the disposable local default. Relaunch preserved the displayed results. The normal bridge/pairing was restored afterward; no test merge touched the actual project default branch.
