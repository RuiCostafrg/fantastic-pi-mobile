# Ideas from pi-phone: knowledge, search and high-leverage phone workflows

Research date: 2026-10-19. This is a proposal, **not an implementation or permission to enable background automation**.

## Executive recommendation

Borrow the **knowledge loop**, not the entire application:

> Capture something useful → preserve its source → retrieve scoped evidence → answer or act → verify the outcome → save what was learned.

Fantastic Pi Mobile already has a working native app, real Pi CLI/RPC sessions, isolated worktrees and conservative non-replay semantics. Its highest-return next increment is a **private, source-linked research/memory workbench**, not a rewrite into another large web application.

Start with local session/document search and explicit “Remember this”, add a modest web-search/fetch pipeline, then make capture one Android share away. Defer autonomous goals, always-on monitoring and a bundled Linux runtime until the retrieval loop is useful and safe.

## Sources and limits

Inspected pi-phone at commit [`35e56c1d07423c7507a049907d454e6199b99d14`](https://github.com/picassio/pi-phone/tree/35e56c1d07423c7507a049907d454e6199b99d14), including source, architecture notes and relevant tests. Followed its knowledge dependency into pi-para at [`7ee2ed46124ccd6d6b1937d78f56a5416170efb1`](https://github.com/picassio/pi-para/tree/7ee2ed46124ccd6d6b1937d78f56a5416170efb1), version 0.8.8. Also checked first-party Android and SQLite documentation.

This was static research: **no upstream APK/dependency installation, upstream test execution, provider sign-in, private-history upload or phone setting change**. Test files are evidence of intended coverage, not tests I ran. Effort/payoff rankings below are engineering judgments, not benchmarks.

Important distinction: their named Pi Pocket upstream is **TannerMidd/pi-pocket**, not RuiCostafrg/fantastic-pi-mobile. This is a related design reference, not a drop-in upstream update for our repository. Their GitHub description still mentions React Native; the inspected README/source instead show a Java Android shell and a WebView/Preact UI. Trust the pinned source over stale metadata. [S1, S2]

## 1. What is genuinely worth borrowing

### A. A portable knowledge base, not just chat history — highest value

pi-phone wraps pi-para's wiki tools and project-scoped context. The backing knowledge is Markdown with frontmatter and wikilinks; it includes sources, freshness, backlinks and open questions. Search supports keyword retrieval and optional remote embeddings with sqlite-vec. pi-para's query layer supports scope/category/archive filters and graph boosting through links. Its context builder uses a budget and at most 40 matching page summaries, not the complete wiki. [S3, S4, S5]

**Our version:**

- Separate **raw evidence** (session excerpts, files, captured pages) from **curated knowledge** (decisions, facts, procedures).
- Each saved claim has a source/request/session reference, captured time, verification state and scope.
- Distinguish `observed`, `user-stated`, `model-inferred`, `superseded` and `needs-checking`.
- Treat operating facts such as bridge readiness, PID, current branch and ADB address as expiring evidence, not permanent memory.
- Search memories when needed; inject a small set of approved preferences/project facts, not all old conversations.
- Offer “Why do you think that?” and “Forget/revoke this” with real source links.

**Shortcut:** our bridge runs the actual Pi coding agent rather than implementing its entire tool harness. pi-para already declares a normal Pi extension and skills. Trial that integration in a disposable wiki/config/session before writing a second knowledge engine. Do not assume its TUI settings commands work through RPC. Check native dependencies, scheduler lifecycle and eight concurrent Pi processes before adopting it. pi-para bundles better-sqlite3; pi-phone takes extra packaging steps to use node:sqlite and avoid local model dependencies. This is promising reuse, not a guaranteed one-command Android install. [S4, S6]

**Critical improvement:** age is not truth. A recently edited hallucination must not get a trustworthy “fresh” badge. pi-para's inspected freshness helper uses the page's updated date. Keep evidence verification separate from edit time. [S5]

### B. Search is a pipeline, not a list of providers

pi-phone separates `web_search`, `fetch_content`, document conversion and wiki ingestion. Search returns links/snippets; fetch extracts article text through Readability/Turndown, handles documents, and specializes GitHub repos/issues/PRs. Large output is persisted and the truncation/file-location note goes **before** the excerpt. It supports parallel query batches and per-query failures. [S7, S8]

**Our version:** one configured search backend initially, plus readable fetching and immutable source snapshots. Add a second provider only if an evaluation shows missed coverage. Their inspected tree has 38 provider modules; that is maintenance cost, not a sensible MVP target.

A useful response is:

1. Answer and confidence/uncertainty.
2. Evidence cards with source, date and supporting excerpt.
3. Contradictions, missing information and suggested next check.
4. Optional “Save this finding” into project knowledge.

Use local-first retrieval over approved chat records, notes, project docs and code; then search the public web if needed. **Never silently send a private local search query to an external provider.** Semantic search is optional; start with FTS/BM25, filenames, exact identifiers, recency and source links. SQLite FTS5 supplies BM25/snippets; verify the target bridge build supports it. [S9]

### C. Track unresolved questions, not just summaries

pi-phone/pi-para explicitly carry open questions with dates/session references and move answered ones into resolved questions. Capture can consult open questions across the wiki. This is closer to useful continuity than an ever-growing session summary. [S3, S4, S10]

**Our version:** a small “Open loops” list with owner, source, next check and verification condition. Examples:

- Why does the screen-off sampler disappear?
- Has the revised lifecycle matrix passed as a whole?
- Which saved paths block physical checkout relocation?

The model proposes resolutions; tests/user evidence close them. Avoid allowing “I think I fixed it” to close a reliability issue. A compact open-loop list should not become a full project-management rewrite.

### D. Event-driven agents beat polling conversations

Their `watch_ci` is a bounded durable watcher: look periodically, stop after a deadline/repeated failures, and deliver a deduplicated follow-up when the run ends. The conversation can end its turn instead of spending model tokens repeatedly asking `gh`. Schedules use durable waits and stable delivery request IDs. [S11, S12]

**Our version:** a small event inbox for CI completion, requested reminders and approved rechecks. A notification is not an execution permission. Receiving an event should not silently authorize a deploy, purchase, send or replay of an interrupted tool action. Use scoped work, a deadline, a stop control and a spend cap.

### E. Let the agent inspect an artifact, not commandeer the phone

pi-phone has an off-screen WebView rendering service, allowing screenshots of generated HTML at different widths without foreground UI navigation. It also supports sandboxed rich/interactive answers. [S13, S2]

**Our version:** an optional isolated artifact viewer for a report, comparison, diagram, calculator or checklist. Start with static sanitized Markdown/HTML, then add a narrow declarative action schema. No arbitrary JavaScript-to-native tool bridge. A map or interactive form can send an explicit user action back to the assistant; merely opening it must not execute shell commands.

This does **not** replace pi-droid for testing native Android controls, lifecycle or the user's actual screen.

## 2. High-return hacks and edgier experiments

These are **our proposals inspired by the source**, not features all verified in pi-phone.

| Idea | Payoff / effort | Smallest useful experiment | Important boundary |
|---|---|---|---|
| **Search yesterday** | Very high / low–medium | Index approved app history and selected Pi sessions; answer “where did we decide X?” with exact session/message links | Read source files only; never resume/replay their tools; exclude secrets and allow per-session opt-out |
| **Remember this / decision receipts** | Very high / low–medium | One explicit action saves a decision, why, source and scope; retrieve in another chat | Show the saved text and allow correction/deletion; no automatic global memory |
| **Share-to-research inbox** | Very high / medium | Android share target receives a URL, selected text, screenshot or document and asks Save / Summarize / Compare / Ask | Start with `ACTION_SEND` text/URLs; no microphone/clipboard surveillance; URI grants and import limits for files [S14] |
| **Screenshot → knowledge card** | High / medium | User shares a screenshot, agent extracts a checklist/receipt/idea, keeps source reference, asks to save | Treat visible instructions as untrusted content; capture on request, not continuously |
| **Project cockpit generated from existing notes** | High / low–medium | A read-only card of current goal, open loops, last verified state and next action from PROGRESS/docs | Historical PID/status must be labelled historical; model cannot silently rewrite acceptance evidence |
| **One research command** | High / medium | `/research topic`: query a small set of angles, fetch primary sources, make a cited brief and save raw evidence | Request/time/spend bounds; no automatic account/backend switching; report failed sources |
| **Contradiction / stale-knowledge radar** | High / medium | Flag “not installed” vs newer installation evidence, or old/new package names in operational docs | Suggest a diff; do not rewrite historical test evidence or assume latest text wins |
| **Failure-to-runbook compiler** | High / medium | On an explicitly closed debugging task, propose one source-linked runbook + regression command | Never copy `.env`, tokens, private logs or guessed causes into the wiki |
| **Research two viewpoints, then falsify** | High for decisions / medium | One bounded worker builds a case, another finds counterevidence, final answer resolves disagreement with sources | Not an endless agent team; independent evidence beats two models agreeing |
| **Build while I am at the gym** | High / medium | CI watcher sends a ready APK link/report; user chooses install | First enable/verify our CI; no unattended production rollout or auto-install |
| **SSH offload, phone as cockpit** | High for heavy work / medium–high | Explicitly route builds/indexing to one trusted machine, keep conversation/evidence on phone | Show where each command/file lives; connection loss is unknown state, not retry permission [S15] |
| **Done when this passes** | High / medium–high | Approved isolated goal with fixed check, max rounds, time and spend | A test command is code execution; no auto-send/deploy and no uncertain-action replay [S16] |
| **Zero-touch morning brief** | Potentially high / medium–high | Opt-in local draft of yesterday's outcomes/open questions, reviewed on first open | Only after retrieval/capture is accurate; schedules do not guarantee Android wakes/runs on time |

**My strongest opinion:** “Search yesterday” + “Remember this” + a share inbox will likely improve daily usefulness more than another major UI redesign or a 38-provider search picker. This is a hypothesis to evaluate with real questions, not a measured result.

## 3. Specific weaknesses not to copy uncritically

### Automatic capture has a success-accounting tradeoff

`para-capture.ts` deliberately moves its watermark after submission, not successful capture completion. It avoids repeating a failing capture forever, but “submitted” is not proof that knowledge was saved. It also takes only the last 60,000 characters when a session digest is long. A shared archived capture conversation is reset for each capture; concurrency/isolation deserve tests before eight mobile chats use the pattern. I did not reproduce a race or audit every caller. [S10]

For us: separate `queued/running/succeeded/failed` capture records keyed by source range and content hash. Move the committed watermark only after verified durable writes. A failure remains visible and retryable with the same capture ID. Manual capture first; opt-in background capture later.

### Fetch limits and provenance need tightening

In the inspected `fetch_content` path, the 25 MB guard checks `Content-Length`, then reads `arrayBuffer()` without an observed streamed actual-byte ceiling. It follows redirects; that path does not show a private-address/DNS-rebinding policy. The persistent text filename is derived from URL, not source content/version. GitHub cache refresh uses `git reset --hard` inside its designated cache. [S8]

These are static design concerns, not a complete vulnerability finding. A local powerful agent already has broad access. Still: use streamed byte/time/decompression limits, explicit internal-network policy and redirect checks; immutable content-addressed snapshots; pinned repository commit references; isolated caches that users never edit. Fence fetched text as untrusted evidence. “Read-only research” may fetch paid APIs, write caches or load hostile content; name those effects honestly.

### Notifications are not durable delivery

`phone-events.ts` keeps 100 events in memory and resets its sequence on server restart. The Android poller intentionally starts at “now”. This is a useful foreground-service notification bridge, not a persistent inbox with guaranteed catch-up. The upstream handover also lists phone notification/download/backup testing as outstanding at its writing. [S17, S18]

For us: persist an event outbox/cursor or reconstruct outstanding completion/approval state; stable dedup IDs; no secret contents on the lock screen by default. A notification-service improvement does not keep the separate Termux process alive.

### Old-SDK bundled runtime is clever, but a different product bet

Their package ID `io.piphone` deliberately has the same length as `com.termux`, permitting in-place binary prefix rewriting. They target SDK 28 to run executables from app-writable storage and document sideload-only distribution. Android's first-party documentation confirms the execution restriction for apps targeting Android 10+. Our `dev.fantasticpimobile` package cannot simply use their equal-length prefix trick. [S2, S19]

Their service helps host its own Node process; OEM/Android process killing is still possible. Do not downgrade our SDK or replace the working Termux architecture as a quick “reliability fix”. If desired, do a separately identified throwaway runtime experiment with installation, signing, update integrity, licensing and rollback criteria.

### Guardrails are not complete security boundaries

The wiki write guard is a tool/path convention, and the design explicitly says it is not a security boundary. Plan-mode tool allowlists likewise are not an OS sandbox. The secrets design redacts common encodings/chunk boundaries, but explicitly disclaims protection against determined exfiltration. Search content, imported documents, generated UI and saved memories can contain prompt injection. [S3, S20]

Keep scope/permissions in code where possible. Distinguish reading knowledge from changing it and from taking external actions. Do not let a “memory” page become a higher-priority command channel. Approval is about a particular action/revision, not a permanent trust badge.

### Reuse and legal provenance need care

pi-phone's own code is MIT, with upstream notices. Its README explicitly says the pi-termux-mobile foundation had no license file and author permission should be confirmed. pi-para's README/package metadata declare MIT, but its inspected top-level tree has no LICENSE file. Confirm actual redistribution notices/permissions before vendoring either foundation; prefer patterns or clearly licensed packages over copying a runtime wholesale. Pi logo/trademark rights are separate. [S1, S4, S6]

## 4. Suggested architecture for Fantastic Pi Mobile

Keep existing app/RPC/worktree boundaries. Put new capabilities behind small tools, not one huge prompt or a second all-powerful agent server:

```text
Android explicit capture / chat / selected documents
                ↓
Private evidence store (source IDs, timestamps, hashes, scopes, retention)
                ↓
Local retrieval ←→ explicit public web search/fetch
                ↓
Evidence-backed answer + proposed knowledge patch
                ↓ user approves / policy permits scoped save
Curated wiki + open questions + bounded next-session context
```

Possible seams, names illustrative:

- `knowledge_search`: local sources/scopes, snippets and stable source references.
- `source_read`: read the exact saved version behind a result.
- `knowledge_propose` / `knowledge_apply`: reviewable, conflict-checked changes.
- `research_search` / `research_fetch`: public-web requests with visible provider/provenance.
- `capture_inbox`: unprocessed user-shared material, separate from trusted knowledge.

Do not add all these APIs before the first experiment. A thin pi-para extension trial or a bridge-side FTS index may answer the important questions first. Search must not open the production Durable journal as a second executing harness; use safe read-only exports/snapshots. The private index/wiki belongs outside per-chat disposable Git worktrees and outside the public repository. Keep state compatibility and explicit dispatch-intent/non-replay rules.

## 5. Order of work and success criteria

1. **Knowledge/search spike in isolation.** Compare pi-para in RPC against a minimal FTS index using an approved, non-secret sample. No global install, auto-capture, production restart or dependency bump without agreement. Evaluate native install requirements and extension API compatibility; pi-phone uses Pi packages 1.3.0, while our bridge dependencies are pinned at 1.0.4. Do not copy their Durable integration verbatim. [S6, S21]
2. **Local history search + explicit memory.** Use 20 real questions with known answers and deliberate unanswerable/contradictory cases. Examples: “What broke the build?”, “Which screen-off test actually passed?”, “Why is the old folder retained?” Measure correct source/answer retrieval, abstention, latency and prompt tokens. Do not optimize vector scores before answers are useful.
3. **Web research and source preservation.** One backend, primary-source fetching, snippets/snapshots/citations, visible cost/privacy policy, hostile-page and oversized-response tests. Add document conversion on a small known corpus and report extraction failures.
4. **Android share inbox and simple knowledge browser.** URL/text first; screenshots/files next. Test capture from the actual Sharesheet with pi-droid; confirm permissions, no automatic Send and correct source attribution.
5. **Open loops and event-driven CI notifications.** Persist delivery state; user-approved watches only. Our currently inactive CI template must be enabled/validated before relying on it for APK releases.
6. **Only then add opt-in automatic capture, schedules, remote offload or bounded goal loops.** Require proof that a failed/poisoned capture cannot silently become authoritative memory and that unknown external actions remain non-replayed.

Reliability work remains necessary, but it need not block an explicit foreground search/capture experiment. Conversely, a wiki is not a substitute for finishing the lifecycle matrix. Physical checkout relocation is a separate migration, not a dependency for these ideas.

## Primary source index

Pinned pi-phone sources below refer to the inspected commit, not moving `master`.

- **S1:** [README: capabilities, credits and license caveats](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/README.md).
- **S2:** [DESIGN: runtime, wiki, web, artifacts, remote execution](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/DESIGN.md).
- **S3:** [Wiki integration and scopes](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/src/server/para.ts), [wiki tools/guard](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/src/server/extensions/para.ts), [wiki tests](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/test/para.test.ts).
- **S4:** [pi-para README: extension, Markdown storage, BM25, capture](https://github.com/picassio/pi-para/blob/7ee2ed46124ccd6d6b1937d78f56a5416170efb1/README.md).
- **S5:** [pi-para query/freshness](https://github.com/picassio/pi-para/blob/7ee2ed46124ccd6d6b1937d78f56a5416170efb1/src/query.ts), [context budget](https://github.com/picassio/pi-para/blob/7ee2ed46124ccd6d6b1937d78f56a5416170efb1/src/context.ts).
- **S6:** [pi-para package: extension registration, exports and dependencies](https://github.com/picassio/pi-para/blob/7ee2ed46124ccd6d6b1937d78f56a5416170efb1/package.json), [Android packaging discussion](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/DESIGN.md#4-ours).
- **S7:** [Search selection/authentication](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/src/server/web/access.ts), [web tools/query batching](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/src/server/extensions/web.ts).
- **S8:** [Fetch/extraction, output bounds, cache and GitHub handling](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/src/server/web/fetch.ts), [web tests](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/test/web.test.ts).
- **S9:** [SQLite FTS5, BM25 and snippets](https://www.sqlite.org/fts5.html).
- **S10:** [Capture watermark, source selection and submission](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/src/server/para-capture.ts#L121-L194).
- **S11:** [Bounded durable CI watcher](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/src/server/extensions/ci-watch.ts).
- **S12:** [Durable scheduled messages and stable delivery IDs](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/src/server/schedules.ts), [schedule tests](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/test/schedules.test.ts).
- **S13:** [Screenshot request service](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/src/server/screenshots.ts), [Android off-screen renderer](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/android/app/src/main/java/io/piphone/Renderer.java).
- **S14:** [Android: receiving shared content](https://developer.android.com/training/sharing/receive).
- **S15:** [Remote-machine architecture](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/DESIGN.md#4-ours).
- **S16:** [Goal-loop check/time limits and spend check](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/src/server/goals.ts).
- **S17:** [In-memory phone events](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/src/server/phone-events.ts), [Android service polling/restart behavior](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/android/app/src/main/java/io/piphone/PiService.java).
- **S18:** [Handover: tested features versus pending phone checks](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/HANDOVER.md).
- **S19:** [Android 10 execution restrictions](https://developer.android.com/about/versions/10/behavior-changes-10#execute-permission), [foreground-service background-start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start).
- **S20:** [Secret redaction/approval design](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/src/server/secrets.ts), [plan-mode limits](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/src/server/extensions/plan.ts).
- **S21:** [pi-phone pinned dependencies](https://github.com/picassio/pi-phone/blob/35e56c1d07423c7507a049907d454e6199b99d14/package.json); our local comparison: `bridge/package.json`, `bridge/src/store.js`, `bridge/src/workspaces.js`, `app/src/main/AndroidManifest.xml`, `docs/repository-rename.md`.
