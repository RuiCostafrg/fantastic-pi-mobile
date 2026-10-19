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

Execute in order. All steps below are **not started** as of this document's creation.

### 01 — Inspect and choose the smallest design

- [ ] Trace the current flow: Android chat → HTTP submission → Durable request →
  workspace preparation → review/test/merge. Locate the global `PI_WORKSPACE` use.
- [ ] Write a short `docs/multi-project-design.md`: project identity, chat binding,
  legacy mapping, request/review routing and the smallest compatible rollout.
- **Done:** every routing/migration point has an identified source location and a
  focused test plan. Explain any changes needed to steps 02–09. No runtime/code
  change, installation or phone test in this step.

### 02 — Store a trusted project registry

- [ ] Implement only project registration/lookup persistence and validation at the
  seam chosen in 01. Support an explicit local default branch without a remote.
- [ ] Test reopen persistence, invalid/non-Git paths and duplicate/alias handling.
- **Done:** trusted projects have stable identities; selecting/registering one
  cannot execute work or change existing chat routing. Existing default behavior
  still passes its regressions. UI and multi-project execution stay out of scope.

### 03 — Persist immutable chat/request bindings

- [ ] Bind a conversation and its accepted requests to a registered project.
  Preserve the existing default-project behavior and saved legacy workspaces.
- [ ] Test restart recovery, legacy mapping, same-ID retries and rejection of a
  conflicting project/chat/request binding, including while work is active.
- **Done:** accepted work cannot be silently retargeted. No production migration
  or UI change; multi-project execution remains gated until step 04 passes.

### 04 — Route execution and review to the bound project

- [ ] Resolve the bound project for worktree preparation and every review/test/
  commit/merge path, rather than relying on one global workspace manager.
- [ ] Use two disposable repositories to test isolated worktrees, simultaneous
  chats, legacy reuse and correct review/test/merge targets without cross-writes.
- **Done:** backend tests prove both coding and review use the binding. Original
  checkout/staging protections remain green. No Android UI or production restart.

### 05 — Expose the minimal authenticated project interface

- [ ] Add project listing/explicit registration and bound-conversation interaction
  needed by the app, using the contract from 01. Registration requires deliberate
  user action and validation, not arbitrary model-provided path execution.
- [ ] Test authentication, validation, old-client compatibility and unsupported
  capability handling. Reuse an existing route if 01 selected it; avoid duplicates.
- **Done:** an isolated HTTP test can discover/select two projects and submit a
  bound request safely. No real provider or device action required.

### 06 — Persist project selection in the Android client

- [ ] Extend the client/history representation for the project identity and request
  contract. Preserve existing chats and exact IDs; distinguish unbound new chats
  from legacy chats with an established repository.
- [ ] Test database upgrades, selection/request persistence and old/offline bridge
  behavior in an isolated app sandbox.
- **Done:** data/client tests and build/lint pass; no visible picker or normal-app
  database migration yet. A missing capability cannot misroute a request.

### 07 — Add a small new-chat project picker

- [ ] Let the user choose/register a project for a new coding chat, show the selected
  project before Send and keep the established binding visible after reopening.
- [ ] Existing chats show their binding instead of a control that silently changes
  it. Handle empty/error/offline states clearly; preserve existing chat navigation.
- **Done:** focused UI/fixture tests and build/lint pass. Keep the native design;
  no broad redesign or installation over the normal app in this step.

### 08 — Verify reconnect and client-close behavior

- [ ] Test sending to each project, dropped responses, same-ID retry, client-close/
  reopen and restored selection/results. Run the relevant existing regressions.
- [ ] Verify approval/cancellation/review state remains scoped to the right request
  and project. Use isolated deterministic workers, not real external side effects.
- **Done:** project bindings/IDs/results persist, no duplicate dispatch or crossed
  project writes, and closing a client does not cancel a live independent worker.
  This is not a claim of survival after Android kills Termux.

### 09 — Deploy and do one agreed pi-droid coding smoke test

- [ ] Agree the visible test and any needed idle bridge restart with the user.
  Discover live work, back up private state and inspect APK identity before upgrade.
- [ ] Use two disposable projects in the real app: choose, send harmless coding
  requests, inspect changes/test evidence and close/reopen. Verify migrated legacy
  chats still work. Keep real project default branches and unrelated staging safe.
- **Done:** record actual per-project outcomes and preservation evidence; leave
  the normal app/bridge healthy and report any limits. Ask before extending to
  disruptive screen-off tests, publishing external work or deleting test history.

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

No implementation step has been executed by creating this checklist.
