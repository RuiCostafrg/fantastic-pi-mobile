# Multi-session Android navigation

Research and implementation decision: 2026-10-16.

## Verified primary sources

1. [Gemini Apps Help — Find and manage recent chats, Android](https://support.google.com/gemini/answer/13666746?hl=en&co=GENIE.Platform%3DAndroid). Retrieved successfully. Google's Android-specific instructions describe opening Menu to see pinned/recent chats, searching from the menu, and long-pressing a chat to pin or rename it. This supports a familiar conversation drawer rather than placing every conversation in a horizontal tab strip.
2. [Android Developers — Navigation drawer](https://developer.android.com/develop/ui/compose/components/drawer). Retrieved successfully. Describes the drawer as a slide-in navigation menu opened by a menu icon or edge gesture, distinguishes standard drawers sharing space from modal drawers overlaying content, and provides open/close and gesture behavior. The implementation here uses AndroidX DrawerLayout with native Views, not Compose, to preserve the current app's small build and existing activity.

Attempted OpenAI's [Android FAQ](https://help.openai.com/en/articles/8142208-chatgpt-android-app-faq) and [Android history instructions](https://help.openai.com/en/articles/8167621-how-can-i-access-my-conversation-history-in-the-chatgpt-android-app); both returned HTTP 403. Those pages were not inspected and no details of ChatGPT's current UI are asserted. A candidate Claude help URL returned 404 and was not used as evidence. Research was sequential because this harness exposes no background-agent tool.

## Decision for Pi Pocket

- A real modal left drawer, edge swipe, scrim/back dismissal, and an accessible top-bar menu button.
- New chat at the top; search by title; pinned and recent sections; selected-chat highlight; rename/pin available through explicit overflow menus as well as long press.
- Per-chat title, draft, transcript, progress, and pending approval. Switching must not cancel a run or move its approval into another conversation.
- Running/needs-approval badges and a count of active chats. Completion of a hidden chat never switches the visible conversation.
- Scrollable message cards and an always-visible composer on the main screen.
- Preserve the current conversation as `pocket` during an additive SQLite migration. New chats use stable UUIDs and separate Pi session IDs. Reopening a chat resumes only its own context.
- A maximum of three admitted active requests across chats by default, with only one per chat. The limit bounds simultaneous Pi processes and provider costs; it is not a background execution guarantee.
- One workspace/provider configuration remains shared. Different model conversations are isolated, but file edits and pi-droid actions are NOT sandboxed or isolated; concurrent actions on the same files/device can conflict. Warn in the drawer and README.
- No deletion UI in this change: durable deletion, running jobs, and remote session history need a coherent policy first. Pin/rename are safe local organization controls, not server-side deletion or synchronization.

## Follow-up: task lifecycle hierarchy (user-requested)

The user requested new chats first, attention/reply-ready tasks second, muted working tasks third, user-finished tasks last, and reversible archiving. Version 0.3.0 replaces pinned/recent **sections** with New chats / Needs attention / Working / Finished. Pins still prioritize within each section.

Model completion and user completion are intentionally distinct. A `done` request belongs in Needs attention until the user marks the conversation finished. Approvals outrank running work; failures/stops remain visible for review. A new message reopens a finished task. Archive is only available for user-finished, inactive chats, hides them from the main list, and preserves history/context with a restore action. Archived chats are read-only until restored. These local organization flags do not cancel/delete bridge jobs or establish a security boundary.

## Verification plan

- Bridge integration tests: actual concurrent fake-RPC children, separate session flags, per-chat single-flight admission, global cap, idempotency/session conflicts, approval and cancellation isolation, legacy defaults, persistence/restart non-replay.
- Android instrumentation: upgrade legacy database without losing jobs, independent drafts/transcripts, title/pin persistence.
- On-device pi-droid: create/switch/rename/pin/search, preserve old history and pairing, run a waiting test in one chat while a real question completes in another, Stop only the selected chat, and relaunch to check persisted selection and histories.
