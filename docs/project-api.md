# Project binding HTTP contract (protocol 5)

Step 05, source implementation only. No production deployment or Android project
picker is included. All routes require the existing bearer token, return JSON with
`Cache-Control: no-store`, and share the existing 64 KiB POST limit. The production
entry point still listens on loopback only. Do not expose it publicly.

## Capability check before Send

Authenticated `GET /health` on the binding-aware store advertises
`protocolVersion: 5` and `projectBindings: true`, retaining `worktreeIsolation`,
`changesReview`, `processId` and `maxConcurrent`.

A selected-project client **must require both protocol >= 5 and
projectBindings === true before POST**. Missing/false/older capability means an
upgrade is needed: retain the saved selection, text and exact request ID; do not
retry by dropping `projectId`. Older deployed servers can ignore unknown JSON
fields, so merely posting a selected project to one is unsafe. The new HTTP layer
also returns 426 rather than forwarding explicit project requests when attached to
a store without binding support. Android capability/persistence source and isolated Android database verification
are complete in step 06; see [android-project-state.md](android-project-state.md).
No normal-app/client deployment is claimed; the picker is still step 07.

## Discover and deliberately register

`GET /v1/projects` returns:

```json
{
  "projects": [{
    "projectId": "opaque-generated-id",
    "name": "My project",
    "source": "/absolute/trusted/checkout/subdirectory",
    "repositoryRoot": "/absolute/trusted/checkout",
    "subdirectory": "subdirectory",
    "branchPolicy": { "kind": "local", "branch": "trunk" }
  }]
}
```

The frozen default is included. Entries describe registered identities; listing
is not proof that every source is currently accessible. Admission and use revalidate
identity. Filesystem device/inode and Git common-directory internals are not exposed.

`POST /v1/projects` takes:

```json
{
  "name": "My project",
  "source": "/absolute/trusted/checkout/subdirectory",
  "branchPolicy": { "kind": "local", "branch": "trunk" },
  "confirmRegistration": true
}
```

Alternatively use `{"kind":"remote","remote":"origin"}` for remote-default
branch discovery at later worktree preparation. Registration validates that named
remote locally, without contacting it. Explicit local policy needs no remote.
Returns **200** and one project object, including on a canonical/symlink duplicate;
registration is idempotent and does not rename/update an existing record. A changed
policy/source alias sharing the same Git common directory conflicts (409). Separate
clones are separate identities. No move/delete/update endpoint is provided.

The client must first display the source and branch policy and obtain deliberate
user confirmation. The literal boolean `confirmRegistration: true` is required;
it is an explicit intent field, **not a security boundary against a malicious bearer
client**. Never generate registration requests from model-produced paths. Trusted
registration allows subsequent Pi execution with the host user's permissions and
project resources; this is not a sandbox. Registration itself does not create a
worktree, bind a chat, launch Pi, fetch, commit or merge.

## Bind on first acceptance; reconcile without mutation

`POST /v1/jobs` accepts the existing `{requestId,text,sessionId}` plus optional
`projectId`. It returns **202** and the persisted job with accepted `projectId`.
The first accepted request binds an unbound session atomically with its job/task.
An established chat cannot change projects; create a new session instead.

Old-client omission remains supported: an established chat uses its binding, and a
new chat uses the frozen default. Omitted `sessionId` still means the opaque legacy
ID `pocket` (not the app display name). Unknown/invalid explicit projects never
fall back to the default. A project is referenced by ID, not a source path. IDs at
the HTTP boundary are 1–80 letters/numbers/underscores/hyphens, starting with a
letter or number; treat generated IDs as opaque.

Exact request-ID retry must preserve text/session/project. Omission on a legacy
same-ID retry recovers the original record, even when it belongs to a non-default
project; an explicit conflict returns 409. GET `/v1/jobs/:id` also carries accepted
project identity. Permanent validation/binding errors must not become endless
connectivity polling or a new request ID.

`GET /v1/sessions/:sessionId/project` returns **200** and
`{"sessionId":"…","projectId":"…"}` for an established binding, or **404**
when unbound. It never binds a chat or creates/prepares a worktree. A 404 is not
permission to assign the current default to previously submitted local history:
reconcile exact saved jobs or report unresolved legacy state first.

## Existing review routes, no parallel project routes

Changes summaries, full snapshots and diffs now include top-level `projectId`.
An unbound navigation summary remains a successful empty summary with
`projectId: null`; full review/diff still require an existing worktree.

`POST /v1/sessions/:sessionId/actions` accepts optional `projectId` in addition to
its existing operation/revision/action fields. It asserts the immutable binding,
not a routing override. Accepted actions and GET action results carry `projectId`.
Same operation-ID retries recover the accepted result; a conflicting project,
session or action input is 409. Existing revision checks, scoped test cancellation,
selected-file commits and guarded local merges remain unchanged. Approval and job
cancellation still address the exact saved request IDs; no project-scoped duplicates
are introduced.

## Error contract and privacy

- **400:** malformed JSON/object/IDs, invalid source/branch policy, or missing explicit
  registration confirmation.
- **401:** unauthorized, checked before parsing request bodies or exposing paths.
- **404:** unknown project, unbound session or missing saved request/action. A binding
  conflict takes precedence when an established chat is explicitly retargeted.
- **409:** immutable binding/idempotency/policy/repository identity conflict.
- **413:** POST body exceeds 64 KiB (existing review size limits also remain).
- **426:** this HTTP layer's attached store does not support project bindings.
- **429:** existing maintenance/concurrency/review admission limits.

HTTP logs contain only route classifications, method/status/timing and error type;
never raw URLs, source paths, project names, commands, prompts or tokens. Authorized
responses intentionally expose operator-selected source/worktree paths; keep those
responses and the bearer token private. Back up private state before any later
production migration/deployment, which requires separate agreement.
