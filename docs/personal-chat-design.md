# Personal chats — C01 source trace and proposed contract

Status: **C01 design complete; C02 onward not implemented or authorized.**
Date: 2026-10-27. Scope: local source and installed Pi documentation inspection only.
No production journal/config/history inspection, runtime probe, build, test run,
provider request, device interaction, deployment, commit or push.

The B11 evidence remains the deployed baseline, not a fresh health observation.
See [roadmap](next-steps.md#milestone-c--personal-chats-without-mandatory-git-planned-not-started)
and [B11 evidence](b11-deployment.md). All representations below are proposals,
not descriptions of shipped fields or interfaces.

## 1. Decision

Add explicit immutable **Coding** and **Personal** chat identity inside the existing
locked Durable owner. Personal is conversation-only initially: an independent Pi
session, a private stable non-Git cwd, and no model-callable action tools. Reuse the
existing job/task lifecycle, HTTP transport, canonical history and terminal client;
do not build a second executor, memory system or client-side provider integration.

Keep coding's current project/worktree adapter and review implementation. A new
internal identity module owns classification/validation; a personal workspace
adapter owns directory preparation/validation. Callers should not scatter
`projectId == null` branches through admission, recovery and transport.

Choose a constrained Pi CLI subprocess profile for personal work, not an SDK worker
in this milestone. This retains `runPi`'s existing process ownership and settle/kill
semantics without adding a coding-agent dependency to the bridge. A no-tool SDK
worker remains a separately approved alternative if the CLI profile cannot pass
its verification gate. Never fall back to ordinary coding Pi arguments.

## 2. Source trace: current facts and change seams

Paths are relative to the repository; named symbols, rather than unstable line
numbers, are the implementation map.

| Stage | Current source/symbol | Required change and invariant |
|---|---|---|
| Startup configuration | `bridge/src/server.js`, executable entry block | Currently requires `PI_WORKSPACE`. Add an explicit personal-only configuration path; never substitute `process.cwd()`. Keep auth and bind-to-loopback rules. |
| Exclusive owner/startup | `bridge/src/store.js`, `openStore` | Opens lock, calls `openWorkspaces`, validates/seeds a default project and migrates bindings before `harness.resume()`. Make only the explicitly repository-free path skip Git bootstrap; validate persisted evidence before resume. |
| Coding identity | `bridge/src/bindings.js`, `bindSession`, `legacyEvidence` | `bindSession` currently falls back to frozen default. Require a mode check before every call; personal never enters it. Keep legacy manifest checks and coding inference unchanged. |
| Project lookup/checkout | `bridge/src/projects.js`, `validateProject`, `lookupProject`; `bridge/src/project-workspaces.js`, `projectWorkspaces().forSession/existing` | Coding retains revalidation on cached managers; personal uses a different adapter and never invokes Git. |
| Creation/catalogue | `bridge/src/conversation-interface.js`, `createConversation`, `listConversations`, `requireOwner` | Creation requires project ID; catalogue compares project binding. Add explicit personal creation and opt-in discovery, not a dummy binding. |
| Admission/idempotency | `bridge/src/store.js`, `submit` | Existing-ID branch calls `bindSession` before checking text/session; new branch binds, checks admissions/active runs and creates task/job plus projection in one transaction. Resolve exact chat kind first on both branches; retain existing coding accepted inputs. |
| Dispatch/recovery | `bridge/src/store.js`, `checkTaskBinding`, `Command.phases.execute` | Dispatched memo is checked first, then persisted before external work. Keep this non-replay guard first. Add identity-aware validation and mode-specific workspace/launch selection, never shared-cwd fallback. |
| Pi transport | `bridge/src/rpc.js`, `runPi` | Currently inherits process environment and sends prompt immediately after spawn. Personal needs explicit child environment/launch profile and verification discipline. Existing coding behavior stays unchanged. |
| Baseline evidence | `bridge/src/conversations.js`, `initializeConversations`, `checkRecord`, `checkSource` | Baseline and saved sources require projects. Validate existing coding evidence unchanged; do not insert personal chats into immutable B02 baseline inventory. Permit later personal jobs only through proved personal identity. |
| Live projection | `bridge/src/conversation-projection.js`, `stageConversations`; `bridge/src/conversation-live.js`, `initializeLiveConversations`, `projectMutation`, `validateLive` | Live inventory currently equals binding keys and mutation requires a truthy project. Include separate personal identity inventory; validate mode-specific source/scope. Do not rewrite old snapshots, sources, generations or cursors. |
| Bounded reads | `bridge/src/conversation-reads.js`, `readConversationSnapshot`, `readConversationEvents`, scope/token/record validation | Introduce personal scope in explicitly versioned personal envelopes; preserve pinned pagination, whole-envelope bounds and coding schema-1 tokens. |
| Imports | `bridge/src/conversation-history.js`, `initializeHistory`, `requireHistoryAdmission`, `importHistory`, `historyCatalogue` | Existing null-project local histories are inert evidence, not personal identity. Retain coding/history contracts. No personal history import in C; reject attempts rather than interpreting null as authorization. |
| Approval state | `bridge/src/approval-lifecycle.js`, `initializeApprovals`, `transitionApproval`, `inspectApprovalEvidence`; `bridge/src/approval-responses.js`, `initializeApprovalResponses`, `claimApproval`, `recordAttempt` | Validate personal jobs via explicit identity, not absent binding equality. No personal dialog/action approvals in policy v1. Reject unexpected personal pending/UI events and answer attempts; preserve coding occurrence/receipt semantics. |
| Stop | `bridge/src/store.js`, `cancel`, `stopRun`; `bridge/src/server.js`, jobs cancel handler | Scope personal Stop by owner/chat/kind/workspace/policy/run, never just null project. Legacy cancel must reject personal runs. Coding exact Stop stays unchanged. |
| Review reads | `bridge/src/store.js`, `changesSummary`, `changes`, `diff`, `getReview` | Add coding-only guards before accessing `review` or returning saved operations. Personal must not invoke `existing` or create a checkout. |
| Review mutations | `bridge/src/store.js`, `reviewAction`, `cancelReview`, `ReviewAction.phases.execute` | Guard new and repeated operation IDs, lookup/cancel and recovery, not just the POST handler. Never bind personal IDs through reviews. Preserve coding normalized JSON, operation IDs, staging/merge and dispatched guards. |
| HTTP validation | `bridge/src/server.js`, `makeServer` | Current global project validation/shared detection and create/Send/Stop/approval checks assume coding. Route through negotiated explicit mode rules; protect legacy job GET/cancel/UI and project/review routes as well. |
| Terminal | `scripts/conversation-client.mjs`, `preflight`, `list`, `read`, `record`, `job`, `recoverSend`, `exact`, `command` | Strict protocol-6/project/schema-1 assumptions; extend deliberately, including private create intent, mode-aware outbox/cursors and exact recovery. No journal/Pi access or executor startup. |
| Android local state | `app/src/main/java/dev/fantasticpimobile/History.kt`, `ChatSession`, `Job`, `onUpgrade`, `createSession`, `ensureRemoteSession`, `add`, `acceptResponse` | Schema currently 5; add explicit kind/policy/workspace persistence and local unresolved classification. Preserve every old column/ID/organization value. Personal cannot pass through coding `confirmProject`. |
| Android shared flow | `SharedConversations.kt`, `preflight`, `scope`, `catalogue`, `execution`, `canSend`, `prepareSend`, `recoverSend`, `freshJob`, `stop`, `requestScoped` | Currently Send requires project; persist personal target before dispatch and enforce kind on all adoption/restore paths. Keep lifecycle tickets and endpoint/owner checks. |
| Android validation/cache | `SharedConversationPolicy.kt`, `owner`, `catalogue`, `job`; `ConversationCachePolicy.kt`, `Scope`; `ConversationCache.kt`, `validateScope`, `apply`, `saveImport`, `acknowledgeImport` | Add negotiated personal scope without conflating history-null with personal. Separate schema-2 cache/cursors; preserve schema-1 coding bodies and conflict evidence. |
| Android creation/actions | `MainActivity.kt`, `newChat`, `openChanges`, `showWorkspace`; `ProjectPicker.kt`, `show`, `label`; `SessionDrawer.kt`; `ChangesActivity.kt`, `onCreate`, `refresh`, `queueAction`, `sendAction` | Explicit new-chat choice and Personal identity; do not show picker/Changes for Personal. Guard direct Changes Activity entry too. Keep coding picker and pending operation recovery. |
| Transport/maintenance | `Connection.kt`, `requestAt`; `scripts/bridge-work.mjs`, health verification and backup inventory; `scripts/check-bridge-work.py` | Preserve endpoint freezing/no hidden POST retries. Extend strict health allowlist and private backup inventory only when new protocol/paths are implemented and tested. No live controller operation in C01. |

## 3. Proposed identity and persistence contract

Use `chatKind`, **not `mode`**: projections already use `mode: live/staged`, and
Android shared connection state has another Mode. Avoid overloading either.

Add a version-1 `pocket.chat-identities` document in the existing owner, with
migration marker and entries keyed by exact chat/session ID:

- Coding: `{ chatKind: "coding", projectId: <existing opaque ID> }`.
- Personal: `{ chatKind: "personal", workspaceId: <opaque UUID>,
  toolPolicy: "personal-conversation-v1" }`. No project binding or project ID in
  this authoritative identity record.
- Workspace details live in a separate version-1 personal-workspace document,
  keyed by workspace ID, scoped to owner/chat, with reserved canonical target,
  personal-root identity and preparation state. Absolute paths are private state,
  not required in catalogue, diagnostics or ordinary client outbox.

Suggested identity module seam: initialize/validate inventory in a caller-owned
transaction, resolve a chat identity, and require an exact accepted target. Coding
still delegates repository binding to existing `bindSession`; personal dispatch
cannot call it. Do not replace Jobs/Reviews/Bindings as execution authority with a
second set of tasks.

For new personal jobs/task inputs, atomically freeze `chatKind`, `workspaceId` and
`toolPolicy` with existing IDs/text; use `projectId: null` only in new personal wire/
projection records where a common envelope needs it. Null never proves personal.
For coding, retain legacy task inputs and old job/baseline/source bytes; derive kind
from validated sidecar identity when an old input lacks it. Do not add fields to old
immutable records or recompute digests just to normalize shapes.

No in-place conversion. Create another chat to change kind. New Personal creation
requires an explicit personal-aware request, no project fields, supported policy,
original chat ID and creation ID persisted before dispatch. Same creation ID with
same target returns original receipt/identity; different input conflicts. Never
reserve another workspace UUID on retry after response loss. Reject unknown policy,
foreign owner and collisions with coding/history-only/unresolved identities.

### Legacy and unresolved data

- Before resume, validate B11 bindings/jobs/reviews/manifests as currently done;
  add coding identities for proved binding keys without mutating original records.
- All accepted coding/review evidence must agree. Missing or conflicting evidence
  blocks startup/admission; no guessed repair and no classification as personal.
- Android pre-C rows retain their existing project state. An additive local kind
  can mean `legacy-unresolved` until authority is proved; a new deliberate empty
  draft can remain `unselected`. Neither is a third executable backend mode.
- Imported local-only history remains read-only/unverified or unresolved-outbox.
  No personal execution rights are granted by import acknowledgement.
- Commit identities, migration marker and mode-aware projection validation together
  before resume. Fault injection must prove rollback, retained original evidence
  and no task creation/partial adoption. Repeat reopen emits no spurious events.
- Old binaries are not a supported writable downgrade after personal state exists.
  They must remain fail-closed on incompatible state; never delete new documents to
  make old startup pass. Rollback after admitted writes requires reconciliation,
  not restoration of a stale backup over accepted work.

## 4. Git-free owner startup and personal workspace

**Decision: support a genuinely repository-free owner**, not merely bypass worktree
creation in a bridge that still requires a default Git repository.

Configuration proposal: `PI_PERSONAL_ROOT` explicitly enables personal operation.
With it set and `PI_WORKSPACE` absent, fresh storage may start with an empty project
registry, `defaultProjectId: null`, and an explicitly recorded personal-only bootstrap
state. Do not call `resolve(undefined)`, validateProject, openWorkspaces, legacy Git
inventory or auto-registration on that path. Missing both configurations is an error.

With `PI_WORKSPACE` supplied, preserve current validation/frozen default behavior,
including failing on missing/replaced source or changed branch policy. Adding a
personal root does not excuse a broken configured coding source. An existing coding
journal cannot be reopened personal-only by unsetting its workspace. Startup must
inspect its authoritative coding evidence before admitting work and refuse the
configuration change. Restoring original configuration is an operator action.

The personal-only profile does not support coding registration/execution yet:
project routes report coding unavailable, with no opportunistic default bootstrap.
Switching an established personal-only owner into mixed mode is outside C. An
empty project registry is a supported condition, not an exception swallowed as
personal fallback. Health may advertise project-binding *protocol support* while
`codingAvailable: false`; clients must gate coding actions on availability, not just
presence of the capability. Existing mixed/coding owners retain their current
project behavior.

Directory adapter proposal: `prepare(identity, signal)` and `existing(identity)`
return validated cwd/identity; they do not know about project selection or Git.

- Root is canonical, private (0700), owned by executing UID, and outside registered
  source trees, coding worktrees, journal directory and provider config. Reject
  overlap in either direction. Compare path ancestors, not string prefixes.
- Derived target uses opaque workspace ID, not title or model-supplied path.
  Reject symlinks and changed owner/device/inode evidence, including root replacement.
- Reserve target in the journal before filesystem preparation. Track
  reserved/preparing/ready plus private owner/chat/workspace manifest. Create new
  directory exclusively; do not adopt an existing unproved directory. A crash during
  creation requires matching manifest/preparation proof or a clear blocked state,
  not delete/recreate/guess. Journal and filesystem are not one atomic transaction.
- Once ready, a missing/replaced directory or manifest is an error, never permission
  to regenerate it. Revalidate before every dispatch. No auto-cleanup on archive.
- Keep per-chat Pi session identity and path stable in private session storage,
  disjoint from coding session lookup. Choose a personal-prefixed session ID and
  personal session directory; verify header cwd and ID on restore. Never use
  continue/latest/fork or a remembered coding path. No context copy between modes.
- Permissions and path validation are defense in depth, not an OS sandbox against
  a hostile same-UID process racing filesystem checks. No new isolation guarantee.

## 5. Enforced conversation-only Pi launch

### Inspected documentation and source

Installed read-only reference:
`~/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/`.
Read `docs/sdk.md`, `docs/cli-integration.md`, `docs/cli.md`, `docs/configuration.md`,
`docs/settings.md`, `docs/security.md`, `docs/rpc.md`, and examples
`examples/sdk/12-full-control.ts`, `examples/rpc-client.ts`. Followed relevant
controls into `dist/core/sdk.js`, `dist/core/resource-loader.js`,
`dist/core/agent-session.js`, `dist/modes/rpc/rpc-mode.js`.
This is version-specific source evidence, **not proof of the production PI_BIN or
its runtime behavior**. The bridge depends on Durable/AI 1.0.4, not coding-agent;
`bin` is externally selected and must be explicitly verified before personal use.

Findings:

- `--no-tools` disables all tool classes; `--no-builtin-tools` and an empty
  `defaultTools` setting do not disable extension tools.
- `--no-extensions` still permits explicitly supplied `-e`; similarly skills and
  templates can be explicitly added despite discovery-disable flags.
- Context instructions load from ancestors/global agent directory regardless of
  trust unless disabled. `--no-context-files` is distinct from project trust.
- Resource loading resolves package paths even when extensions are disabled.
  Ordinary user settings/packages cannot be inherited safely just by appending flags.
- `--no-context-files` does not suppress SYSTEM/APPEND_SYSTEM discovery. Use an
  explicit controlled system prompt and appended prompt source, not ambient files.
- SDK creation with `noTools: "all"` produces an empty allowed tool selection;
  tool-registry and transcript-restoration code filters tools through that selection.
  Future tests must cover restored tool declarations, not just a fresh session.
- RPC `prompt` goes through session prompt preprocessing; disable extensions,
  skills and templates so slash text cannot invoke them. `get_state` does not
  expose an effective tools list. A successful state response is not tool proof.
- RPC has a separate explicit `bash` command independent of model tools. Never
  expose arbitrary RPC forwarding to HTTP/terminal clients. Existing bridge sends
  only prompt and validated extension answers; personal allows prompt only (plus
  strictly internal inspection/abort if implemented), and no extension answers.

### Proposed personal launch profile

Construct the whole personal argv from trusted constants and an allowlisted model/
thinking selection. Do not append arbitrary `PI_ARGS`: the current store only
forbids session overrides, which is insufficient for tool policy. Coding retains its
current arguments. Personal requires a verified compatible Pi executable/version;
an unknown/replaced binary or unsupported flag fails closed, without fallback.

Required controls together:

- `--mode rpc`, exact private session directory/ID;
- `--no-tools --no-extensions --no-mcp --no-skills --no-prompt-templates
  --no-themes --no-context-files --no-approve`;
- explicit controlled system/append prompt (identify Personal, same agent, no tools,
  independent conversation, no Git context; this text is identity, not enforcement);
- bridge-owned, private dedicated agent directory via `PI_CODING_AGENT_DIR` containing
  only approved model/auth material and minimal settings with no packages/resource
  paths, command-valued credentials or executable provider hooks;
- explicit child environment allowlist. Do not inherit arbitrary PI_* overrides,
  NODE_OPTIONS, loader injection or shell/resource configuration. Retain only
  required platform/runtime variables and narrowly scoped provider access. No
  credential in argv/URL/logs, and no automatic copy of the user's entire agent dir.

Pi/provider session persistence and provider traffic remain necessary. “No network
or file tools” is not “Pi never writes a session or calls the model provider”. It
also does not make personal conversations private from the executing OS account.

Provisioning the clean agent profile/credential access is a **future private
operator-approved deployment decision**, not permission to inspect/copy credentials
in C01. If production model authentication cannot be safely supplied without
executable config, stop C03/C07 rather than broaden the policy.

### Required proof before enabling personal capability

1. Fake worker verifies exact argv/env/cwd/session and that disallowed configuration
   cannot override them; coding args and original session identities remain intact.
2. Actual supported Pi executable against a disposable loopback fake model provider:
   capture effective outgoing tool declarations and injected tool-call responses;
   assert no forbidden tool runs or marker writes, including a restored transcript
   declaring old tools. No paid/real-provider call or user config needed.
3. Seed disposable global/project/ancestor instructions, extension/package/skill/
   template/MCP and SYSTEM files with marker attempts; prove they neither load nor
   execute and no package install/network is triggered. Exercise slash commands,
   prompt requests for tools and reconnect/reopen. Capture only fixture evidence.
4. Unexpected tool/UI events fail the personal run and stop its worker; this is an
   alarm, **not** a substitute for preventing tools before a model request.

These tests were **not run** in C01. Failure blocks capability publication. Do not
hide UI buttons and claim enforcement, or turn on full tools to make tests pass.

## 6. Versioned HTTP/client contract

Keep numeric bridge protocol **6** and existing coding event/history schemas **1**
for compatible coding behavior; advertise an additional literal `personalChats:
true`, `personalSchemaVersion: 1`, and supported `personalToolPolicies` only after
the implementation gates pass. New clients require all existing owner/shared gates
plus these fields before personal operations. Unsupported/unknown policy means 426
or a clear unavailable state, never dropping personal fields to retry coding.

Use opt-in `X-Personal-Schema: 1`, alongside current owner/shared headers, as the
personal-aware view. Advertise personal-aware envelope schema **2** separately
(e.g. `personalEventSchemaVersion: 2`); do not change eventSchemaVersion 1 globally.

- Existing unopted catalogue/read/history behavior stays coding/history-only with
  original schema-1 envelope/token shapes. Filter personal IDs **before** pagination
  and generate tokens for the filtered view. Old clients never discover personal
  entries as project-less coding chats.
- Personal-aware catalogue uses schema 2 and a distinct token kind/view. Entries
  include explicit `chatKind`; Personal has workspace/policy plus projectId null.
  Coding entries retain project ID. Historical-only entries remain explicitly
  execution-unavailable and are not described as personal.
- Personal reads/events use schema 2 with owner/chat/kind/workspace/policy/generation
  in tokens/envelopes, not filesystem paths. Coding reads remain schema 1; attach
  coding identity to the opted-in catalogue/creation receipt rather than rewriting
  old immutable records. Reject tokens from another view/mode/policy/workspace.
- Reuse `POST /v1/conversations` for deliberate personal create with creation ID;
  `POST /v1/jobs` for Send with exact explicit personal target, original request ID
  and text. No project field (including null) in create/Send personal inputs.
  Both require opt-in and exact supported kind/policy. Coding keeps existing shape.
- On an established personal ID, **omitted kind or missing opt-in is rejected** on
  every actionable route, including same-ID retries. It is never inferred from null
  project or looked up and silently accepted as a new-format request. Preserve old
  omitted-kind default-project coding behavior only for unknown/proved coding IDs.
- Gate direct personal job GET, snapshot/feed, legacy cancel/UI and session/project/
  review paths too; guessing an ID must not bypass client capability checks.
  Personal review routes return a stable PERSONAL_REVIEW_UNAVAILABLE error before
  lookup/preparation; no hidden commit/test/merge endpoint remains actionable.
- Personal Stop uses owner/chat/kind/workspace/policy/exact run and existing abort
  machinery. An old run cannot stop later work. No personal approvals in policy v1;
  reject action requests rather than relaxing coding's project-scoped receipts.
- No personal import in C. Existing coding/history import receipts, schema and
  original manifests stay unchanged. Personal history comes from accepted canonical
  jobs; local drafts/outbox are not auto-imported as executable context.

Android adds necessary schema-6 local columns/identity sidecar transactionally,
keeping cached coding schema-1 JSON/cursors intact. A personal scope includes
workspace/policy and schema; null project alone is insufficient. Persist exact
create/Send target before HTTP. Refresh discovery on reconnect and GET the original
ID before retry. Do not downgrade a saved personal outbox to old-bridge routes.
Terminal stores mode-aware schema-2 state in its private atomic file while retaining
old coding state. Explicit creation cannot itself send a turn. Both clients display
Personal/Coding, preserve drafts/selection/organization and refuse mode switches.

## 7. Bounded implementation sequence and test matrix

Source trace shows C02 and C03 need smaller approval units. The roadmap is refined:

| Step | Bounded output | Completion/test surface (future execution only) |
|---|---|---|
| C02a | Coding sidecar identity initialization/validation only; no personal rows, jobs, projection changes or execution | Disposable old binding/job/review inventories, empty/manifest-only chats, exact byte/input preservation, ambiguity, reopen and rollback; existing coding regression suite. |
| C02b | Personal identity reservation plus mode-aware startup/projection validation, still no personal create/Send/dispatch exposed | Empty Git-free store and mixed-owner reopen; baseline/live inventories and immutable coding records retained; fault after staged identity/projection writes, reserved-path conflicts, unknown policy; internal personal fixtures cannot execute. |
| C03a | Directory adapter and explicit repository-free bootstrap validation; personal execution still unavailable | Git-free fixture with Git deliberately unavailable, no Git invocation, escaped/replaced/missing root/path/manifest, preparation crash, coding source failures still fail and coding journal cannot become personal-only. |
| C03b | Constrained personal Pi launch/dispatch and tool-policy proof | Fake-worker argv/env plus actual Pi/local fake-provider proof above, restored sessions, independent Personal A/B plus coding, unknown binary/config refusal and dispatch recovery. Preserve memo-first non-replay. |
| C04 | Opt-in HTTP/terminal interface | Legacy/schema-2 catalogue pagination, auth/owner/view/ID conflict, no old-client action bypass, lost create/Send responses, duplicate pages, detach, exact Stop and direct review rejection. Add strict controller health/inventory support; isolated controller fixture only. |
| C05 | Android storage/policy then small explicit mode choice | JVM/build/lint first; supported v1–v5 SQLite upgrades and visible picker/direct Changes entry only in separately authorized isolated fixtures. Compare IDs/drafts/pairing/selection/review JSON; old bridge/offline/replaced owner/stale callbacks/response loss fail safely. |
| C06 | Independent cross-client preservation gate | Real headless Android + real terminal + separate disposable owner/fake worker; start/continue/detach/reopen, simultaneous sends, duplicate pages, old/later-run Stop, two contexts/coding projects and restart non-replay; full relevant bridge/JVM/build/lint/controller gates. Device execution separately agreed. |
| C07 | Separately approved live deployment/smoke | Fresh owner/idle proof, private bridge/Android/Pi/root/profile inventory/backups; harmless Personal Android→terminal→detach→Android/context smoke, original coding read-only comparison, one healthy owner; no automatic Git/provider-tool action or phone-setting change. |

For migration fixtures, assert source HEAD/index and dirty worktree/manifest/Pi
bytes, old record/task inputs and review operation IDs, not just display text. A
whole-directory hash containing expected new files is not a preservation proof;
compare the original inventory individually and report additive files separately.
No fixture, build or historical B11 result substitutes for live C07 evidence.

## 8. Completion, risks and next approval

C01 completion is this source trace, selected contract, seam map, compatibility
policy and future verification plan. The implementation/protocol names above require
the normal design approval before they become requirements in code.

Known implementation gates, not unresolved permission to widen scope:

- The inspected 1.4.0 CLI behavior must be proved for the selected personal binary;
  production binary/config/provider compatibility was deliberately not inspected.
- The clean agent profile/auth provisioning must not inherit executable resources;
  if it cannot be achieved, stop and propose an SDK worker separately.
- Journal/filesystem preparation is not atomic; unproved partial directories stay
  blocked. Same-UID filesystem races and hostile processes remain outside scope.
- Old writable-binary downgrade and mixed-mode promotion of a personal-only journal
  are not supported by C; no downgrade/repair endpoint is implied.
- Personal no-tool mode intentionally cannot search, capture files, manipulate the
  phone or remember facts across chats. Those require later scoped policy work.

**Next approval: C02a only**, the coding identity sidecar and disposable migration/
rollback/reopen tests. No personal execution or public capability, no Android/device,
provider, production state, deployment, commit or push. Stop after its evidence.
