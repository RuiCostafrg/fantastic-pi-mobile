# Project-bound coding conversations — step 01

Design only, 2026-10-20. Inspected checkpoint: `8b79257`.
No multi-project implementation or production migration is included here.

## Decision

Keep one bridge, Durable journal, admission policy and Pi session per chat.
Add a trusted project registry and immutable conversation/request bindings inside
that owner. Route execution **and review** through the same binding-aware workspace
module. Reuse `openWorkspaces` and `createReview`; do not create a second runner,
per-project bridge or cross-client conversation architecture in this milestone.

## Current source trace

Paths below are relative to this checkout; function names are the navigation anchors.

| Stage | Actual source and behavior | Required change |
| --- | --- | --- |
| New chat/history | `app/src/main/java/dev/fantasticpimobile/History.kt`: `createSession`, `add`, `onUpgrade`; database version 3, sessions/jobs have no project field | Add explicit unbound/legacy/bound representation and persist accepted project on requests without changing IDs |
| Send/retry/recovery | `MainActivity.kt`: `submit` stores a UUID and text; `refresh` checks health, POSTs `requestId`, `text`, `sessionId` while sending, otherwise GETs the same job; validates returned session | Persist selection before Send; check project capability, send/validate binding, preserve exact-ID recovery |
| Transport | `Connection.kt`: bearer-authenticated HTTP, localhost-only cleartext, redirects disabled | Reuse transport and safe logging; project paths are not model command input |
| Global configuration | `bridge/src/server.js`: CLI calls `openStore` once with `PI_WORKSPACE`, `PI_DEFAULT_BRANCH`, `PI_GIT_REMOTE` | Seed/freeze the legacy default project; these remain bootstrap compatibility settings, not per-request routing |
| HTTP admission | `server.js`: `makeServer`, POST `/v1/jobs`; authenticated `/health` advertises protocol 4; currently ignores extra JSON fields | Validate explicit project requests and advertise capability only after routing works; an old bridge can silently ignore `projectId`, so client gating is mandatory |
| Durable acceptance | `bridge/src/store.js`: `Jobs`, `Reviews`, `submit`, `root.commit`; dedup compares text/session; task input contains id/text/session | Atomically bind session, job and task; include project in dedup/conflict checks and persisted accepted metadata |
| Execution/recovery | `store.js`: `Command.execute`, `dispatched` memo, `spaces.forSession`; runner receives worktree cwd and persistent `pocket[-<session>]` session ID | Resolve accepted project, never current global default; preserve dispatch non-replay and Pi session identities |
| Worktree identity | `bridge/src/workspaces.js`: `openWorkspaces`, `prepare`, `existing`, `forSession`; real Git common-dir hash + session hash, version-1 manifest, subdirectory derived from configured cwd | Keep paths, branches and manifests byte-compatible; validate registered repo identity and retain configured project subdirectory |
| Review reads | `store.js`: `changesSummary`, `changes`, `diff`; `review.js`: `summary`, `snapshot`, `diff` call `workspaces.existing` | Resolve bound project even without a recent active job; reads never create/rebind a worktree |
| Repository actions | `store.js`: `reviewAction`, `ReviewAction.execute`, `getReview`, `cancelReview`; `review.js`: `execute` | Persist project in action/task; validate binding and revision before any side effect; preserve same-ID recovery |
| Test/commit/merge targets | `review.js`: `execute` uses workspace cwd for tests, worktree path for commits and repositoryRoot for local merge; snapshot hashes include root/path | Supply only the bound manager; retain selected-file/index guards, stale revisions, merge preview and clean/default-branch checks |
| Android review | `ChangesActivity.kt`: session route, `queueAction`, `sendAction`, persisted `pending-<session>` operation ID | Display binding, validate project on responses; keep pending operation IDs and test preferences; no user-selectable retarget on review |
| Approvals/cancel | `store.js`: `respond`, `cancel`, `cancelReview`; `MainActivity.kt`: fresh per-request dialog checks | Keep exact request/dialog ownership; project lookup must not transplant approvals or cancellation |

`rpc.js` remains the process/protocol adapter: project selection belongs before
runner invocation, not inside RPC. Session drawer/lifecycle state remains local UI
state, not a new backend conversation sync implementation.

## Identity and persistence

Proposed new `bridge/src/projects.js` owns registration/validation, not execution.
Use a versioned Durable document in the existing journal for registry entries;
pass its transaction-owned records to validation/lookup helpers rather than opening
a second SQLite owner. Step 02 may add registration/lookup methods to `openStore`,
without wiring submissions to them yet.

A project record contains an opaque generated `projectId`, display name, canonical
source directory, repository root, real Git common directory, relative project
subdirectory, and explicit branch policy (`local` branch or named remote discovery).
Identity is not a mutable label, GitHub URL or array index. A symlink alias for the
same canonical source returns the same registration; conflicting policy is rejected,
not overwritten. Reject a second registration for another source checkout/subdir
sharing the same common directory in this first slice: the current worktree key
cannot isolate multiple project definitions within one repository. Separate clones
remain separate projects. A later monorepo interface is a separate design.

Registration validates a committed non-bare Git checkout, canonical paths and branch/
remote syntax without executing a model, creating a worktree, fetching or merging.
Revalidate repository identity at use; deleted/replaced paths fail closed. Reject
unregistered managed chat worktrees as new project sources. Keep identity/branch
policy immutable initially; no move/delete/update endpoint in this milestone.
Registration uses deliberate user-controlled paths, never shell interpolation.

Store conversation bindings in another versioned Durable document keyed by the
existing `sessionId`. The external seam stays small: register/list projects and
submit a request with an optional project ID. First acceptance binds an unbound
conversation inside the **same root transaction** that creates its job/task.
Jobs, command task inputs, review records and review task inputs record `projectId`.
No operation may resolve an unknown explicit project to the default. No existing
bound chat can switch projects, even when idle: create a new chat instead.

## Legacy migration before resume

Add an idempotent migration after harness/root initialization and **before
`harness.resume()`**, under the existing exclusive store lock. Do not rewrite
opaque `pocket` document/task kinds, session IDs, Pi session filenames, manifest
hashes or branches. Back up production private state before deploying this later.

1. Inventory existing Jobs, Reviews and version-1 workspace manifests (including
   chats with manifests but no current job). Validate manifests against their Git
   common directory, branch/path and recorded workspace metadata without creating
   or resetting worktrees. A path alone is not proof of repository identity.
2. Seed a persisted legacy default from the verified configured source/subdirectory
   and branch policy. Preserve the existing real-common-dir hash; project UUIDs
   must **not** replace worktree storage keys. Persist the default once; a later
   `PI_WORKSPACE` change cannot redirect old chats.
3. Bind each evidenced legacy session to its established repository. If manifests,
   saved job metadata or configuration conflict, stop migration with an actionable
   error; do not choose the newest job or assume the current cwd. If a historical
   repository lacks sufficient source/policy evidence, require explicit operator
   resolution rather than fabricating it. Truly pre-worktree jobs may map to the
   verified legacy default only where no conflicting repository evidence exists.
4. Add missing project metadata to compatible job/review records atomically with
   bindings and a migration marker. Existing Durable task inputs cannot simply be
   assumed rewritten: legacy tasks resolve through their migrated job/action record
   and binding, checking any already-present task project for equality. Preserve
   the dispatched memo check first: uncertain external actions become interrupted,
   never run merely to validate a new binding. Undispatched legacy work needs a
   proved binding before workspace preparation.
5. On reopen, validate persisted default identity and reject conflicting bootstrap
   configuration rather than reassigning it. Retry after a partial migration must
   not duplicate entries, regenerate IDs or touch dirty worktrees.

Android-only empty drafts have no backend binding evidence. Do not infer their
project from their title or blindly stamp every Android row with today's default.
Step 06 marks upgraded rows as legacy-unresolved; reconcile submitted chats using
backend binding/job evidence, and require deliberate selection for genuinely new,
unbound chats. Preserve draft text, history, pairing and pending request/operation
IDs. A legacy same-ID retry without project can recover its original stored result;
an explicit conflicting project must receive 409.

## Workspace and review seam

Implement a binding-aware adapter with the existing workspace interface:
`forSession(sessionId, signal)` and `existing(sessionId, signal)`. It resolves the
immutable binding, validates the registered repository and caches an `openWorkspaces`
manager per project. Supply this **same adapter** to command execution and
`createReview`. Review tasks additionally compare their accepted project with the
binding before execution. No review path uses a request-supplied filesystem path.

Keep one global review/admission lock and current global concurrency limit for now.
Do not loosen merge blocking to per-project concurrency during this change. The
underlying manager already serializes preparation; reject aliases as above so two
managers cannot mutate the same common directory. Missing/switched worktrees and
unregistered paths continue failing without shared-checkout fallback.

## Minimal HTTP/client rollout

Step 05 adds authenticated `GET /v1/projects` and deliberate `POST /v1/projects`
registration, plus `GET /v1/sessions/:id/project` to reconcile existing bindings
without creating worktrees. POST `/v1/jobs` gains validated optional `projectId`;
responses for jobs, project binding and review carry the accepted project identity.
Keep current session review URLs; do not add project-scoped duplicates.

Advertise a new protocol version and `projectBindings: true` only when binding,
routing and HTTP tests pass. New clients must refuse a selected-project Send to
an older bridge **before POST**, because today's server ignores unknown fields.
A selection never disappears from a retry payload. Old clients may omit project:
existing chats resolve their binding, new legacy-client chats bind the frozen
default. Invalid explicit values return 400, unknown projects/bindings 404 and
binding/idempotency conflicts 409; unsupported client capability is shown as an
upgrade requirement (426 locally, consistent with current UI handling). Update
Android handling so permanent 404 project failures do not poll forever as transient
connectivity failures. Auth/body-size validation and metadata-only logs still apply.

Project registration trusts local code/resources and is not a sandbox. Display its
source, branch policy and explicit confirmation. Do not log private paths, request
text or credentials. Preserve localhost/auth policy; no discovery of arbitrary
phone directories and no automatic global resource installation.

## Focused test plan and remaining step adjustments

| Step | Completion evidence to add (not claimed implemented) |
| --- | --- |
| 02 | New `bridge/test/projects.test.js`: register/reopen with stable IDs, symlink dedup, same-common-dir alias rejection, invalid/non-Git/bare/uncommitted roots, missing source, local branch with no remote, conflicting policy. Assert no worktrees or model calls. Registry stays disconnected from routing. |
| 03 | Extend `sessions.test.js`, `worktrees.test.js`, `review.test.js`: atomic first-bind races, same-ID retries/conflicts, job/task/action project persistence, legacy manifests/jobs including no-current-job and incomplete preparation, changed PI_WORKSPACE, ambiguous evidence, idempotent migration, dispatched non-replay. New-project execution remains gated until 04. |
| 04 | Two disposable repos with identical filenames and local `trunk`: commands edit only their bound worktree; reopen reuses dirty state; review/diff/tests/selected commits/merge use the right root, preserve unrelated staging and reject cross-repo revisions. Keep existing global admission guards. |
| 05 | Extend `bridge.test.js`/`sessions.test.js` HTTP tests: auth, registry/binding routes, invalid and unknown projects, conflicting IDs, omitted-project legacy behavior, response project identity and capability advertisement. No real provider/device required. |
| 06 | Extend Android `HistoryTest.kt`, `RequestStatusTest.kt`, `LiveStatusUiTest.kt`: upgrade v1/v2/v3 fixtures, unresolved legacy reconciliation, selected/request project persistence, wrong-project response rejection, old-bridge refusal before POST, offline selection retained, permanent project errors. Isolated fixture only. |
| 07 | Extend `SessionDrawerTest.kt`, `LayoutTest.kt`, `ReviewUiTest.kt`: new-chat selection, visible binding before Send/after reopen/in review, no existing-chat rebinding, deliberate register confirmation and empty/error/offline/large-font states. |
| 08 | Extend `reliability.test.js` and Android fixtures: lost acceptance/operation response, same-ID retries, client close/reopen, two projects, scoped approvals/Stop/review and no duplicate dispatch. |
| 09 | Only after separate deployment approval: private backup, pre-resume migration audit and real-app two-disposable-project pi-droid smoke test; compare legacy IDs/history/worktrees and restore evidence. No real default-branch test merge. |

The nine-step order remains valid. Clarifications above belong inside their
existing steps: 02 does not silently enable routing; 03 includes reviews and the
pre-resume legacy resolver; 05 includes binding reconciliation/capability; 06
includes permanent-error handling. Split further if those slices prove too large.
No personal-chat mode, shared terminal protocol, physical checkout move, background
service or production restart belongs in 01–08.

## Evidence for this design-only step

- `git status --short --branch`: clean `main...origin/main` at inspection;
  local HEAD `8b79257`. This is local tracking evidence, not a fresh remote fetch.
- `pwd -P`: public entry point still resolves to physical `~/projects/pi-pocket`.
- Read-only process/tmux listing observed Node in the current session, not proof
  of a bridge. A fresh unauthenticated GET to `127.0.0.1:8787/health` returned
  `ECONNREFUSED`. `ss -ltn` was unavailable (netlink permission denied). No claim
  about other ports/hosts or persisted tasks; no tokens/private journals read.
- `cd bridge && npm test`: **48 tests passed, 0 failed/skipped/cancelled**, exit 0
  (about 52 seconds). Existing disposable Git/fake-RPC fixtures only; no real
  provider or phone automation. This baseline does not prove multi-project support.
- No runtime/code/configuration change, installation, bridge start/restart, phone
  test, database migration, commit or push. Next: **step 02 only**.
