package dev.fantasticpimobile

import android.app.Activity
import android.app.AlertDialog
import android.app.Dialog
import android.content.ClipData
import android.content.ClipboardManager
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.Window
import android.widget.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.Executors

/** Native, session-scoped review. No mutation is submitted without explicit confirmation. */
class ChangesActivity : Activity() {
    private lateinit var connection: Connection
    private lateinit var shared: SharedConversations
    private lateinit var sharedHistory: History
    private var connectionIdentity = ""
    private lateinit var sessionId: String
    private lateinit var summary: TextView
    private lateinit var mergeHint: TextView
    private lateinit var integration: LinearLayout
    private lateinit var commitHint: TextView
    private lateinit var evidence: TextView
    private lateinit var operation: TextView
    private lateinit var notice: TextView
    private lateinit var files: LinearLayout
    private lateinit var commit: Button
    private lateinit var tests: Button
    private lateinit var merge: Button
    private lateinit var cancel: Button
    private lateinit var retry: Button
    private lateinit var output: Button
    private val selected = mutableSetOf<String>()
    private val worker = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private val preferences by lazy { getSharedPreferences("review-requests", MODE_PRIVATE) }
    private var snapshot: JSONObject? = null
    private var pending: JSONObject? = null
    private var loading = false
    private var visible = false
    private var modalOpen = false
    private var reader: Dialog? = null
    private var filesKey = ""
    private var requestEpoch = 0L
    private var blockedPending = false
    private fun projectId() = History(this).use { it.session(sessionId)?.projectId }
    private val poll = object : Runnable {
        override fun run() {
            if (!visible) return
            if (!modalOpen && ((pending != null && !blockedPending) || snapshot?.optBoolean("busy") == true || snapshot?.optBoolean("repositoryBusy") == true)) refresh()
            handler.postDelayed(this, 2000)
        }
    }
    private val route get() = "/v1/sessions/$sessionId"
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sessionId = intent.getStringExtra("sessionId").orEmpty()
        if (!Regex("[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}").matches(sessionId)) { finish(); return }
        connection = Connection(this)
        connectionIdentity = connection.identity
        val endpoint = connection.endpoint
        sharedHistory = History(this)
        shared = SharedConversations(sharedHistory, endpoint,
            { path, body, headers -> connection.requestAt(endpoint, path, body, headers, connectionIdentity) },
            { connection.identity == connectionIdentity })
        pending = preferences.getString("pending-$sessionId", null)?.let { JSONObject(it) }
        window.statusBarColor = FantasticPiMobileColors.background; window.navigationBarColor = FantasticPiMobileColors.background
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(FantasticPiMobileColors.background)
            setPadding(dp(20), dp(8), dp(20), dp(12))
            setOnApplyWindowInsetsListener { view, insets ->
                view.setPadding(dp(20) + insets.systemWindowInsetLeft, dp(8) + insets.systemWindowInsetTop,
                    dp(20) + insets.systemWindowInsetRight, dp(12) + insets.systemWindowInsetBottom)
                insets.consumeSystemWindowInsets()
            }
        }
        val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(iconButton("back", "Back to chat") { finish() }, LinearLayout.LayoutParams(dp(48), dp(48)))
        header.addView(textLabel("Changes", 21f).apply { setTypeface(typeface, Typeface.BOLD); setPadding(dp(10), 0, 0, 0) }, LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(iconButton("refresh", "Refresh changes") { refresh() }, LinearLayout.LayoutParams(dp(48), dp(48)))
        root.addView(header)
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(8), 0, dp(16)) }
        summary = textLabel("Review your changes", 24f).apply { setTypeface(typeface, Typeface.BOLD) }; body.addView(summary)
        notice = textLabel("Loading your files…", 13f, true); body.addView(notice)
        body.addView(actionButton("Branch & folder details") { showRepositoryDetails() }.apply { background = null; gravity = Gravity.START; setPadding(0, dp(8), 0, dp(8)); textSize = 13f }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) })
        operation = textLabel("", 13f, true); body.addView(operation)
        retry = actionButton("Retry same confirmed request") { pending?.let { sendAction(it) } }; body.addView(retry, LinearLayout.LayoutParams(-1, -2))
        files = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; body.addView(files)
        val checks = sectionCard()
        checks.addView(textLabel("Checks", 18f).apply { setTypeface(typeface, Typeface.BOLD) })
        evidence = textLabel("Tests: not run from Changes", 14f); checks.addView(evidence)
        tests = actionButton("Run tests") { confirmTest() }; checks.addView(tests, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        output = actionButton("View test output") { snapshot?.optJSONObject("tests")?.let { showText("Test command output", it.optString("command") + "\n\n" + it.optString("output") + if (it.optBoolean("truncated")) "\n\n[Output truncated]" else "") } }
        checks.addView(output, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        cancel = actionButton("Stop test command") { cancelTests() }; checks.addView(cancel, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        body.addView(checks, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(20) })
        integration = sectionCard()
        integration.addView(textLabel("Bring changes together", 18f).apply { setTypeface(typeface, Typeface.BOLD) })
        mergeHint = textLabel("Commit your work before merging it into the main project.", 13f, true); integration.addView(mergeHint)
        merge = actionButton("Merge locally") { confirmMerge() }; integration.addView(merge, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        body.addView(integration, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(16) })
        root.addView(ScrollView(this).apply { addView(body); isFillViewport = true; clipToPadding = false }, LinearLayout.LayoutParams(-1, 0, 1f))
        commit = actionButton("Select files to commit", "Commit selected files") { confirmCommit() }.apply {
            background = rounded(FantasticPiMobileColors.accent, dp(12).toFloat()); setTextColor(FantasticPiMobileColors.background)
        }
        root.addView(commit, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        commitHint = textLabel("Commits whole files to this chat’s branch. Nothing pushed.", 11f, true); root.addView(commitHint)
        setContentView(root); updateButtons()
    }
    override fun onStart() { super.onStart(); requestEpoch++; loading = false; visible = true; if (::connection.isInitialized) { shared.activate(); refresh(); handler.post(poll) } }
    override fun onStop() { requestEpoch++; visible = false; if (::shared.isInitialized) shared.invalidate(); handler.removeCallbacks(poll); super.onStop() }
    override fun onDestroy() { reader?.dismiss(); worker.shutdown(); super.onDestroy() }
    private fun active(status: String) = status in listOf("queued", "running")
    private fun archived() = History(this).use { it.session(sessionId)?.archived ?: true }
    private fun refresh() {
        if (loading || isDestroyed) return
        loading = true; updateButtons()
        blockedPending = false
        val waiting = pending
        val epoch = requestEpoch; val endpoint = connection.endpoint; val expected = projectId() ?: waiting?.let { ProjectRequests.projectId(it) }
        worker.execute {
            var resolved = false
            val result = runCatching {
                if (waiting != null) {
                    try {
                        val operation = shared.requestScoped("$route/actions/${waiting.getString("operationId")}")
                        ProjectRequests.validateOperation(sessionId, waiting.getString("operationId"), ProjectRequests.projectId(waiting) ?: expected, operation)
                        resolved = true
                    }
                    catch (error: BridgeException) { if (error.code != 404) throw error }
                }
                shared.requestScoped("$route/changes").also { ProjectRequests.validateReview(sessionId, expected, it) }
            }
            handler.post {
                if (isDestroyed || !visible || epoch != requestEpoch || endpoint != connection.endpoint || connection.identity != connectionIdentity) return@post
                loading = false
                result.mapCatching { value ->
                    History(this).use { history -> ProjectRequests.projectId(value)?.let { history.confirmProject(sessionId, it) } }
                    ProjectRequests.validateReview(sessionId, projectId(), value)
                    value
                }.onSuccess {
                    if (resolved && pending?.optString("operationId") == waiting?.optString("operationId")) clearPending()
                    render(it)
                }.onFailure {
                    blockedPending = it is ProjectIdentityException || (it is BridgeException && it.code in listOf(404, 426))
                    notice.text = if (it is BridgeException && it.code == 404) "No worktree yet. Send a message in this chat first, or update the bridge if needed." else "Could not refresh Changes: ${it.message ?: "connection error"}"
                    notice.visibility = View.VISIBLE; snapshot = null; updateButtons()
                }
            }
        }
    }
    private fun render(value: JSONObject) {
        val previous = snapshot
        snapshot = value
        val w = value.getJSONObject("workspace")
        val workingCount = value.getJSONArray("files").length()
        val committedCount = value.getJSONArray("committedFiles").length()
        summary.text = when {
            workingCount > 0 -> "$workingCount ${if (workingCount == 1) "file" else "files"} in progress"
            committedCount > 0 -> "Ready to integrate"
            else -> "All caught up"
        }
        mergeHint.text = if (!value.isNull("mergeBlock")) value.optString("mergeBlock") + "." else
            "${value.optInt("ahead")} ${if (value.optInt("ahead") == 1) "commit" else "commits"} ready for local ${w.getString("baseBranch")}. Merging updates the main project. Nothing pushed."
        evidence.text = testSummary(value.optJSONObject("tests"))
        val op = value.optJSONObject("operation")
        operation.text = if (op == null) "" else "${op.getJSONObject("input").getString("action").replaceFirstChar { it.uppercase() }} · ${op.getString("status")}\n${op.optJSONObject("result")?.optString("message").orEmpty()}"
        operation.visibility = if (op == null) View.GONE else View.VISIBLE
        notice.text = when {
            pending != null -> "Response not confirmed. Refresh checks the saved operation ID; retry uses that exact same ID."
            archived() -> "Archived chat · read-only. Restore it from the chat menu to run actions."
            value.optBoolean("busy") -> "Pi is working in this chat. Review is read-only until it finishes."
            value.optBoolean("refreshRequired") -> "Repository changed while loading. Refreshing before enabling actions…"
            value.optBoolean("repositoryBusy") -> "A repository action is running. New requests wait; no automatic replay."
            value.optBoolean("modelsBusy") -> "Other chats are working. You can review here; merge after they finish."
            else -> ""
        }
        notice.visibility = if (notice.text.isEmpty()) View.GONE else View.VISIBLE
        val key = value.getString("revision") + value.getJSONArray("files").toString() + value.getJSONArray("committedFiles").toString()
        if (key != filesKey) {
            if (previous?.optString("revision") != value.optString("revision")) selected.clear()
            filesKey = key; files.removeAllViews()
            addFiles(value.getJSONArray("files"), "Working files", "working")
            addFiles(value.getJSONArray("committedFiles"), "Already committed", "committed")
        }
        updateButtons()
    }
    private fun addFiles(items: JSONArray, heading: String, scope: String) {
        if (items.length() == 0) return
        files.addView(textLabel("$heading · ${items.length()}", 16f).apply { setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(18), 0, dp(10)) })
        if (scope == "working") files.addView(textLabel(if (archived()) "Tap a file to see what changed." else "Tap a file to review its diff. Check the files you want to commit.", 13f, true))
        for (i in 0 until items.length()) {
            val file = items.getJSONObject(i); val path = file.getString("path")
            val row = reviewFileRow(path, file.getString("status"), scope, file.optBoolean("selectable") && !archived(), path in selected,
                { checked -> if (checked) selected.add(path) else selected.remove(path); updateButtons() }, { showDiff(path, scope) })
            files.addView(row, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) })
        }
    }
    private fun updateButtons() {
        if (!::commit.isInitialized) return
        val s = snapshot
        val allowed = s != null && !loading && pending == null && !archived() && !s.optBoolean("busy") && !s.optBoolean("repositoryBusy")
        commit.isEnabled = allowed && s?.optBoolean("canCommit") == true && selected.isNotEmpty()
        commit.text = if (selected.isEmpty()) "Select files to commit" else "Commit ${selected.size} selected ${if (selected.size == 1) "file" else "files"}"
        commit.visibility = if ((s?.optJSONArray("files")?.length() ?: 0) > 0 && !archived()) View.VISIBLE else View.GONE
        commitHint.visibility = commit.visibility
        tests.isEnabled = allowed
        tests.visibility = if (archived()) View.GONE else View.VISIBLE
        integration.visibility = if (archived()) View.GONE else View.VISIBLE
        merge.text = "Merge into ${s?.optJSONObject("workspace")?.optString("baseBranch") ?: "local default"}"
        merge.isEnabled = allowed && s?.isNull("mergeBlock") == true && s?.optBoolean("modelsBusy") != true
        val op = s?.optJSONObject("operation")
        cancel.visibility = if (op?.optJSONObject("input")?.optString("action") == "test" && active(op.optString("status"))) View.VISIBLE else View.GONE
        output.visibility = if (s?.optJSONObject("tests")?.has("output") == true) View.VISIBLE else View.GONE
        retry.visibility = if (pending != null) View.VISIBLE else View.GONE
        retry.isEnabled = !loading
        for (button in listOf(commit, tests, merge)) button.alpha = if (button.isEnabled) 1f else 0.4f
    }
    private fun showDiff(path: String, scope: String) {
        val revision = snapshot?.getString("revision") ?: return
        val expected = projectId(); val epoch = requestEpoch; val endpoint = connection.endpoint
        worker.execute {
            val result = runCatching { shared.requestScoped("$route/diff?scope=$scope&revision=$revision&path=${URLEncoder.encode(path, "UTF-8")}").also { ProjectRequests.validateProject(expected, it) } }
            handler.post { if (!isDestroyed && visible && epoch == requestEpoch && endpoint == connection.endpoint && connection.identity == connectionIdentity) result.onSuccess { showText(path, it.getString("text") + if (it.optBoolean("truncated")) "\n\n[Preview truncated; inspect the full file before committing.]" else "", true) }.onFailure { toast(it.message ?: "Diff unavailable; refresh") } }
        }
    }
    private fun showRepositoryDetails() {
        val s = snapshot ?: return; val w = s.getJSONObject("workspace")
        showText("Repository details", "Branch\n${w.getString("branch")}\n\nWorktree directory\n${w.getString("path")}\n\nLocal default\n${w.getString("baseBranch")}\n\nHEAD\n${s.getString("head")}\n\n${s.optInt("ahead")} ahead · ${s.optInt("behind")} behind\n\nWorktrees separate files, not phone permissions or Git history.")
    }
    private fun showText(title: String, text: String, diff: Boolean = false) {
        modalOpen = true
        if (diff) { reader = openDiffViewer(title, text) { modalOpen = false; reader = null }; return }
        val view = textLabel("", 13f).apply {
            typeface = Typeface.MONOSPACE; setTextIsSelectable(true); setPadding(dp(14), dp(12), dp(14), dp(12))
            this.text = if (diff) coloredDiff(text) else text
        }
        val dialog = Dialog(this).apply { requestWindowFeature(Window.FEATURE_NO_TITLE) }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(12), dp(12), dp(12))
            setBackgroundColor(FantasticPiMobileColors.panel)
        }
        panel.addView(textLabel(title, 20f).apply { setPadding(dp(12), dp(8), dp(12), dp(12)); setTypeface(typeface, Typeface.BOLD) })
        panel.addView(ScrollView(this).apply { addView(view) }, LinearLayout.LayoutParams(-1, 0, 1f))
        val actions = LinearLayout(this)
        actions.addView(actionButton("Copy") {
            (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(title, text)); toast("Copied")
        }, LinearLayout.LayoutParams(0, -2, 1f))
        actions.addView(actionButton("Close") { dialog.dismiss() }, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(8) })
        panel.addView(actions)
        dialog.setContentView(panel)
        reader = dialog
        dialog.setOnDismissListener { modalOpen = false; reader = null }
        dialog.show(); dialog.window?.setLayout(resources.displayMetrics.widthPixels - dp(24), (resources.displayMetrics.heightPixels * 0.8).toInt())
    }
    private fun confirmCommit() {
        val s = snapshot ?: return
        val paths = selected.toList().sorted()
        val message = EditText(this).apply { hint = "Commit message"; contentDescription = "Commit message"; maxLines = 3 }
        modalOpen = true
        val dialog = AlertDialog.Builder(this).setTitle("Commit ${paths.size} selected files?")
            .setMessage("${paths.joinToString("\n")}\n\nCommits each selected file’s full current content to this chat’s branch. Unrelated staged files are excluded. Git hooks are not run. Nothing pushed.")
            .setView(dialogField(message)).setNegativeButton("Cancel", null).setPositiveButton("Commit", null).create()
        dialog.setOnShowListener { dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            if (message.text.toString().trim().isEmpty()) message.error = "Enter a commit message"
            else { dialog.dismiss(); queueAction(JSONObject().put("action", "commit").put("revision", s.getString("revision")).put("paths", JSONArray(paths)).put("message", message.text.toString())) }
        } }
        dialog.setOnDismissListener { modalOpen = false }; dialog.show()
    }
    private fun confirmTest() {
        val s = snapshot ?: return
        modalOpen = true
        val command = EditText(this).apply { hint = "e.g. npm test"; contentDescription = "Test command"; setText(preferences.getString("test-$sessionId", "")); maxLines = 4 }
        val dialog = AlertDialog.Builder(this).setTitle("Run a test command?")
            .setMessage("Runs in this chat’s project directory with full Termux permissions—not a sandbox. Review the exact command. Timeout: 2 minutes. Tests can modify files; changed-revision results are marked stale.")
            .setView(dialogField(command)).setNegativeButton("Cancel", null).setPositiveButton("Run", null).create()
        dialog.setOnShowListener { dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            val text = command.text.toString().trim()
            if (text.isEmpty()) command.error = "Enter a test command"
            else { preferences.edit().putString("test-$sessionId", text).apply(); dialog.dismiss(); queueAction(JSONObject().put("action", "test").put("revision", s.getString("revision")).put("command", text)) }
        } }
        dialog.setOnDismissListener { modalOpen = false }; dialog.show()
    }
    private fun confirmMerge() {
        val s = snapshot ?: return; val branch = s.getJSONObject("workspace").getString("baseBranch")
        modalOpen = true
        val test = testSummary(s.optJSONObject("tests"))
        val dialog = AlertDialog.Builder(this).setTitle("Merge into local $branch?")
            .setMessage("Integrates all committed changes from this chat into the original repository’s local $branch branch and updates its working files.\n\n$test\n\nThe target must be clean and all Pi requests must finish. Conflicts are checked before changing the target. Nothing is pushed; no automatic reset or rollback.")
            .setNegativeButton("Cancel", null).setPositiveButton("Merge locally") { _, _ -> queueAction(JSONObject().put("action", "merge").put("revision", s.getString("revision"))) }.create()
        dialog.setOnDismissListener { modalOpen = false }; dialog.show()
    }
    private fun queueAction(body: JSONObject) {
        ProjectRequests.projectId(snapshot ?: return)?.let { body.put("projectId", it) }
        body.put("operationId", UUID.randomUUID().toString())
        if (!preferences.edit().putString("pending-$sessionId", body.toString()).commit()) { toast("Could not save request ID; nothing submitted"); return }
        pending = body; sendAction(body)
    }
    private fun clearPending() { preferences.edit().remove("pending-$sessionId").commit(); pending = null }
    private fun sendAction(body: JSONObject) {
        if (loading) return
        loading = true; updateButtons()
        val epoch = requestEpoch; val endpoint = connection.endpoint; val expected = projectId()
        worker.execute {
            val result = runCatching {
                fun checkOwner() {
                    if (epoch != requestEpoch || endpoint != connection.endpoint || connection.identity != connectionIdentity) throw ProjectIdentityException("Bridge connection changed; operation preserved")
                }
                ProjectRequests(beforeLegacySubmit = { project ->
                    checkOwner(); History(this).use { it.confirmProject(sessionId, project) }
                }, request = { path, payload ->
                    checkOwner(); shared.requestScoped(path, payload)
                }).sendReview(sessionId, body, expected)
            }
            handler.post {
                if (isDestroyed || !visible || epoch != requestEpoch || endpoint != connection.endpoint || connection.identity != connectionIdentity) return@post
                loading = false
                result.onSuccess { clearPending(); refresh() }.onFailure {
                    blockedPending = it is ProjectIdentityException || (it is BridgeException && it.code in listOf(404, 426))
                    // Definite validation/admission rejections did not dispatch the operation.
                    if (it is BridgeException && it.code in listOf(400, 404, 409, 413)) clearPending()
                    notice.text = it.message ?: "Response uncertain. Refresh checks the saved operation ID; retry uses the same ID."
                    notice.visibility = View.VISIBLE; updateButtons()
                }
            }
        }
    }
    private fun cancelTests() {
        val id = snapshot?.optJSONObject("operation")?.optString("id") ?: return
        worker.execute {
            val epoch = requestEpoch
            val result = runCatching { shared.requestScoped("$route/actions/$id/cancel", JSONObject()) }
            handler.post { if (!isDestroyed && visible && epoch == requestEpoch && connection.identity == connectionIdentity) { result.onFailure { toast(it.message ?: "Could not stop test") }; refresh() } }
        }
    }
    private fun toast(text: String) { Toast.makeText(this, text, Toast.LENGTH_LONG).show() }
}
