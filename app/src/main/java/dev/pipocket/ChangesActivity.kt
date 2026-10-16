package dev.pipocket

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
    private lateinit var sessionId: String
    private lateinit var summary: TextView
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
    private var filesKey = ""
    private val poll = object : Runnable {
        override fun run() {
            if (!visible) return
            if (!modalOpen && (pending != null || snapshot?.optBoolean("busy") == true || snapshot?.optBoolean("repositoryBusy") == true)) refresh()
            handler.postDelayed(this, 2000)
        }
    }
    private val route get() = "/v1/sessions/$sessionId"
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sessionId = intent.getStringExtra("sessionId").orEmpty()
        if (!Regex("[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}").matches(sessionId)) { finish(); return }
        connection = Connection(this)
        pending = preferences.getString("pending-$sessionId", null)?.let { JSONObject(it) }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(PocketColors.background)
            setPadding(dp(16), dp(8), dp(16), dp(12))
            setOnApplyWindowInsetsListener { view, insets ->
                view.setPadding(dp(16) + insets.systemWindowInsetLeft, dp(8) + insets.systemWindowInsetTop,
                    dp(16) + insets.systemWindowInsetRight, dp(12) + insets.systemWindowInsetBottom)
                insets.consumeSystemWindowInsets()
            }
        }
        val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(actionButton("←", "Back to chat") { finish() }, LinearLayout.LayoutParams(dp(48), dp(48)))
        val title = textLabel("Changes", 23f).apply { setTypeface(typeface, Typeface.BOLD); setPadding(dp(12), 0, 0, 0) }
        header.addView(title, LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(actionButton("Refresh") { refresh() }, LinearLayout.LayoutParams(dp(94), dp(48)))
        root.addView(header)
        notice = textLabel("Loading this chat’s worktree…", 13f, true); root.addView(notice)
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        summary = textLabel("", 14f).apply { setTextIsSelectable(true) }; body.addView(summary)
        evidence = textLabel("Tests: not run from Changes", 14f); body.addView(evidence)
        operation = textLabel("", 13f, true); body.addView(operation)
        output = actionButton("View test output") { snapshot?.optJSONObject("tests")?.let { showText("Test command output", it.optString("command") + "\n\n" + it.optString("output") + if (it.optBoolean("truncated")) "\n\n[Output truncated]" else "") } }
        body.addView(output, LinearLayout.LayoutParams(-1, dp(48)))
        files = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; body.addView(files)
        root.addView(ScrollView(this).apply { addView(body); isFillViewport = true }, LinearLayout.LayoutParams(-1, 0, 1f))
        val row = LinearLayout(this)
        tests = actionButton("Run tests") { confirmTest() }
        commit = actionButton("Commit selected") { confirmCommit() }
        row.addView(tests, LinearLayout.LayoutParams(0, dp(48), 1f))
        row.addView(commit, LinearLayout.LayoutParams(0, dp(48), 1f).apply { leftMargin = dp(8) }); root.addView(row)
        merge = actionButton("Merge into local default") { confirmMerge() }
        root.addView(merge, LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(6) })
        cancel = actionButton("Stop test command") { cancelTests() }; root.addView(cancel, LinearLayout.LayoutParams(-1, dp(48)))
        retry = actionButton("Retry same confirmed request") { pending?.let { sendAction(it) } }; root.addView(retry, LinearLayout.LayoutParams(-1, dp(48)))
        root.addView(textLabel("Nothing is pushed. Commits use selected whole files. Test commands run with Termux permissions.", 11f, true))
        setContentView(root); updateButtons()
    }
    override fun onStart() { super.onStart(); visible = true; if (::connection.isInitialized) { refresh(); handler.post(poll) } }
    override fun onStop() { visible = false; handler.removeCallbacks(poll); super.onStop() }
    override fun onDestroy() { worker.shutdown(); super.onDestroy() }
    private fun active(status: String) = status in listOf("queued", "running")
    private fun archived() = History(this).use { it.session(sessionId)?.archived ?: true }
    private fun refresh() {
        if (loading || isDestroyed) return
        loading = true; updateButtons()
        val waiting = pending
        worker.execute {
            var resolved = false
            val result = runCatching {
                if (waiting != null) {
                    try { connection.request("$route/actions/${waiting.getString("operationId")}"); resolved = true }
                    catch (error: BridgeException) { if (error.code != 404) throw error }
                }
                connection.request("$route/changes")
            }
            handler.post {
                if (isDestroyed) return@post
                loading = false
                if (resolved && pending?.optString("operationId") == waiting?.optString("operationId")) clearPending()
                result.onSuccess { render(it) }.onFailure {
                    notice.text = if (it is BridgeException && it.code == 404) "No worktree yet. Send a message in this chat first, or update the bridge if needed." else "Could not refresh Changes: ${it.message ?: "connection error"}"
                    snapshot = null; updateButtons()
                }
            }
        }
    }
    private fun render(value: JSONObject) {
        val previous = snapshot
        snapshot = value
        val w = value.getJSONObject("workspace")
        summary.text = "${w.getString("branch")}\n${w.getString("path")}\n\nHEAD ${value.getString("head").take(12)} · ${value.optInt("ahead")} ahead / ${value.optInt("behind")} behind local ${w.getString("baseBranch")}"
        evidence.text = testSummary(value.optJSONObject("tests"))
        val op = value.optJSONObject("operation")
        operation.text = if (op == null) "No repository actions recorded." else "${op.getJSONObject("input").getString("action").uppercase()} · ${op.getString("status").uppercase()}\n${op.optJSONObject("result")?.optString("message").orEmpty()}"
        notice.text = when {
            pending != null -> "Response not confirmed. Refresh checks the saved operation ID; retry uses that exact same ID."
            archived() -> "Archived chat · read-only. Restore it from the chat menu to run actions."
            value.optBoolean("busy") -> "Pi is working in this chat. Review is read-only until it finishes."
            value.optBoolean("refreshRequired") -> "Repository changed while loading. Refreshing before enabling actions…"
            value.optBoolean("repositoryBusy") -> "A repository action is running. New requests wait; no automatic replay."
            !value.isNull("mergeBlock") -> "Merge unavailable: ${value.optString("mergeBlock")}"
            value.optBoolean("modelsBusy") -> "Other chats are working. Review or commit here, but wait for all Pi requests before merging."
            else -> "Review files, run tests, then explicitly commit or merge. Nothing happens automatically."
        }
        val key = value.getString("revision") + value.getJSONArray("files").toString() + value.getJSONArray("committedFiles").toString()
        if (key != filesKey) {
            if (previous?.optString("revision") != value.optString("revision")) selected.clear()
            filesKey = key; files.removeAllViews()
            addFiles(value.getJSONArray("files"), "WORKING CHANGES · choose whole files to commit", "working")
            addFiles(value.getJSONArray("committedFiles"), "COMMITTED CHANGES VS LOCAL DEFAULT", "committed")
        }
        updateButtons()
    }
    private fun addFiles(items: JSONArray, heading: String, scope: String) {
        files.addView(textLabel(heading, 11f, true).apply { setPadding(0, dp(15), 0, dp(8)) })
        if (items.length() == 0) files.addView(textLabel("No changes", 14f, true))
        for (i in 0 until items.length()) {
            val file = items.getJSONObject(i); val path = file.getString("path")
            val row = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
            if (scope == "working") {
                row.addView(CheckBox(this).apply {
                    contentDescription = "Select file: $path"; isChecked = path in selected
                    isEnabled = file.optBoolean("selectable")
                    setOnCheckedChangeListener { _, checked -> if (checked) selected.add(path) else selected.remove(path); updateButtons() }
                }, LinearLayout.LayoutParams(dp(48), dp(48)))
            }
            row.addView(actionButton("${file.getString("status").trim()}  $path", "View $scope diff: $path") { showDiff(path, scope) }.apply {
                gravity = Gravity.CENTER_VERTICAL or Gravity.START; maxLines = 3
            }, LinearLayout.LayoutParams(0, -2, 1f))
            files.addView(row, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(6) })
        }
    }
    private fun updateButtons() {
        if (!::commit.isInitialized) return
        val s = snapshot
        val allowed = s != null && !loading && pending == null && !archived() && !s.optBoolean("busy") && !s.optBoolean("repositoryBusy")
        commit.isEnabled = allowed && s?.optBoolean("canCommit") == true && selected.isNotEmpty()
        tests.isEnabled = allowed
        merge.text = "Merge into local ${s?.optJSONObject("workspace")?.optString("baseBranch") ?: "default"}"
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
        worker.execute {
            val result = runCatching { connection.request("$route/diff?scope=$scope&revision=$revision&path=${URLEncoder.encode(path, "UTF-8")}") }
            handler.post { if (!isDestroyed) result.onSuccess { showText(path, it.getString("text") + if (it.optBoolean("truncated")) "\n\n[Preview truncated; inspect the full file before committing.]" else "", true) }.onFailure { toast(it.message ?: "Diff unavailable; refresh") } }
        }
    }
    private fun showText(title: String, text: String, diff: Boolean = false) {
        modalOpen = true
        val view = textLabel("", 13f).apply {
            typeface = Typeface.MONOSPACE; setTextIsSelectable(true); setPadding(dp(14), dp(12), dp(14), dp(12))
            this.text = if (diff) coloredDiff(text) else text
        }
        val dialog = Dialog(this).apply { requestWindowFeature(Window.FEATURE_NO_TITLE) }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(12), dp(12), dp(12))
            setBackgroundColor(PocketColors.panel)
        }
        panel.addView(textLabel(title, 20f).apply { setPadding(dp(12), dp(8), dp(12), dp(12)); setTypeface(typeface, Typeface.BOLD) })
        panel.addView(ScrollView(this).apply { addView(view) }, LinearLayout.LayoutParams(-1, 0, 1f))
        val actions = LinearLayout(this)
        actions.addView(actionButton("Copy") {
            (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(title, text)); toast("Copied")
        }, LinearLayout.LayoutParams(0, dp(48), 1f))
        actions.addView(actionButton("Close") { dialog.dismiss() }, LinearLayout.LayoutParams(0, dp(48), 1f).apply { leftMargin = dp(8) })
        panel.addView(actions)
        dialog.setContentView(panel)
        dialog.setOnDismissListener { modalOpen = false }
        dialog.show(); dialog.window?.setLayout(resources.displayMetrics.widthPixels - dp(24), (resources.displayMetrics.heightPixels * 0.8).toInt())
    }
    private fun confirmCommit() {
        val s = snapshot ?: return
        val paths = selected.toList().sorted()
        val message = EditText(this).apply { hint = "Commit message"; contentDescription = "Commit message"; maxLines = 3 }
        modalOpen = true
        val dialog = AlertDialog.Builder(this).setTitle("Commit ${paths.size} selected files?")
            .setMessage("${paths.joinToString("\n")}\n\nCommits each selected file’s full current content to this chat’s branch. Unrelated staged files are excluded. Git hooks are not run. Nothing pushed.")
            .setView(message).setNegativeButton("Cancel", null).setPositiveButton("Commit", null).create()
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
            .setView(command).setNegativeButton("Cancel", null).setPositiveButton("Run", null).create()
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
        body.put("operationId", UUID.randomUUID().toString())
        if (!preferences.edit().putString("pending-$sessionId", body.toString()).commit()) { toast("Could not save request ID; nothing submitted"); return }
        pending = body; sendAction(body)
    }
    private fun clearPending() { preferences.edit().remove("pending-$sessionId").commit(); pending = null }
    private fun sendAction(body: JSONObject) {
        if (loading) return
        loading = true; updateButtons()
        worker.execute {
            val result = runCatching { connection.request("$route/actions", body) }
            handler.post {
                if (isDestroyed) return@post
                loading = false
                result.onSuccess { clearPending(); refresh() }.onFailure {
                    // Definite validation/admission rejections did not dispatch the operation.
                    if (it is BridgeException && it.code in listOf(400, 409, 413)) clearPending()
                    notice.text = it.message ?: "Response uncertain. Refresh checks the saved operation ID; retry uses the same ID."
                    updateButtons()
                }
            }
        }
    }
    private fun cancelTests() {
        val id = snapshot?.optJSONObject("operation")?.optString("id") ?: return
        worker.execute {
            val result = runCatching { connection.request("$route/actions/$id/cancel", JSONObject()) }
            handler.post { if (!isDestroyed) { result.onFailure { toast(it.message ?: "Could not stop test") }; refresh() } }
        }
    }
    private fun toast(text: String) { Toast.makeText(this, text, Toast.LENGTH_LONG).show() }
}
