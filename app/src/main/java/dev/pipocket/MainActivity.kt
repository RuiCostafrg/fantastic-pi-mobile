package dev.pipocket

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognizerIntent
import android.text.Editable
import android.text.InputType
import android.text.TextUtils
import android.text.TextWatcher
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.*
import androidx.drawerlayout.widget.DrawerLayout
import androidx.core.view.GravityCompat
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private lateinit var history: History
    private lateinit var connection: Connection
    private lateinit var drawer: DrawerLayout
    private lateinit var navigation: SessionDrawer
    private lateinit var title: TextView
    private lateinit var subtitle: TextView
    private lateinit var status: TextView
    private lateinit var messages: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var draft: EditText
    private lateinit var send: Button
    private lateinit var stop: Button
    private lateinit var talk: Button
    private lateinit var review: Button
    private lateinit var lifecycle: Button
    private lateinit var changes: Button
    private var changesSession = ""
    private var changesInfo: JSONObject? = null
    private var nextChangesCheck = 0L
    private val checkingChanges = mutableSetOf<String>()
    private var selectedId = "pocket"
    private var renderedSession = ""
    private var renderedJobs: List<Job>? = null
    private var renderedPaired = false
    private var renderedStates: List<RequestState> = emptyList()
    private val observations = RequestObservations()
    private var bindingDraft = false
    private var visible = false
    private var modalOpen = false
    private var speechSessionId: String? = null
    private var approvalDialog: AlertDialog? = null
    private var approvalDialogKey: String? = null
    private val deferredApprovals = mutableSetOf<String>()
    private val polling = mutableSetOf<String>() // UI-thread owned, one HTTP poll per job.
    private val worker = Executors.newFixedThreadPool(4)
    private val handler = Handler(Looper.getMainLooper())
    private val persistDraft = Runnable { history.saveDraft(selectedId, draft.text.toString()) }
    private val poll = object : Runnable {
        override fun run() {
            if (!visible) return
            refresh()
            handler.postDelayed(this, 1500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        history = History(this); connection = Connection(this)
        val savedId = getSharedPreferences("chat-ui", MODE_PRIVATE).getString("selected", "pocket") ?: "pocket"
        selectedId = if (history.session(savedId) != null) savedId else "pocket"
        speechSessionId = savedInstanceState?.getString("speechSession")
        window.statusBarColor = PocketColors.background
        window.navigationBarColor = PocketColors.background
        // FrameLayout honors inset padding; DrawerLayout positions children using margins instead.
        val insetFrame = FrameLayout(this).apply {
            setBackgroundColor(PocketColors.background)
            setOnApplyWindowInsetsListener { view, insets ->
                view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
                insets.consumeSystemWindowInsets()
            }
        }
        drawer = DrawerLayout(this).apply {
            setBackgroundColor(PocketColors.background)
            setScrimColor(Color.argb(160, 0, 0, 0))
        }
        insetFrame.addView(drawer, FrameLayout.LayoutParams(-1, -1))
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(8), dp(20), dp(12))
            setBackgroundColor(PocketColors.background)
        }
        val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(iconButton("menu", "Open chats") { hideKeyboard(); drawer.openDrawer(GravityCompat.START) }, LinearLayout.LayoutParams(dp(48), dp(48)))
        val titles = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, dp(4), 0) }
        titles.addView(textLabel("FANTASTIC PI MOBILE", 10f, true).apply { letterSpacing = 0.16f })
        title = textLabel("", 20f).apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END; setTypeface(typeface, Typeface.BOLD) }
        titles.addView(title); header.addView(titles, LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(iconButton("add", "New chat") { newChat() }, LinearLayout.LayoutParams(dp(48), dp(48)))
        val more = iconButton("more", "Chat menu") {}
        more.setOnClickListener { showMenu(more) }
        header.addView(more, LinearLayout.LayoutParams(dp(48), dp(48)))
        root.addView(header)
        subtitle = textLabel("", 12f, true); root.addView(subtitle)
        status = textLabel("", 13f, true); root.addView(status)
        lifecycle = actionButton("Mark finished") {
            history.session(selectedId)?.let { session ->
                if (session.archived) archiveSession(session, false) else finishSession(session, !session.finished)
            }
        }
        lifecycle.apply { background = null; gravity = Gravity.END; setPadding(0, dp(8), 0, dp(8)); textSize = 13f }
        root.addView(lifecycle, LinearLayout.LayoutParams(-1, -2))
        changes = actionButton("Review changes", "Review changes") { openChanges() }.apply { visibility = View.GONE }
        root.addView(changes, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8); bottomMargin = dp(8) })
        review = actionButton("Review approval") {
            selectedJob()?.let { job -> deferredApprovals.remove(approvalKey(job)); showApproval(job) }
        }
        root.addView(review, LinearLayout.LayoutParams(-1, -2))
        messages = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll = ScrollView(this).apply { addView(messages); isFillViewport = true; clipToPadding = false }
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        val composer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(8), dp(12), dp(10))
            background = rounded(PocketColors.panel, dp(20).toFloat())
        }
        draft = EditText(this).apply {
            hint = "Message this chat…"; contentDescription = "Message this chat"
            setTextColor(PocketColors.text); setHintTextColor(PocketColors.muted); textSize = 16f
            background = null; minLines = 1; maxLines = 4
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            setText(history.session(selectedId)?.draft.orEmpty())
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    if (!bindingDraft) { handler.removeCallbacks(persistDraft); handler.postDelayed(persistDraft, 300) }
                }
                override fun afterTextChanged(s: Editable?) = Unit
            })
        }
        composer.addView(draft)
        val actions = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        talk = actionButton("Talk") { speak() }
        actions.addView(talk, LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(8) })
        stop = actionButton("Stop", "Stop this chat") {
            val job = selectedJob() ?: return@actionButton
            network(job.id) { connection.request("/v1/jobs/${job.id}/cancel", JSONObject()) }
        }
        actions.addView(stop, LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(8) })
        send = actionButton("Send") { submit() }.apply {
            background = rounded(PocketColors.accent, dp(14).toFloat()); setTextColor(PocketColors.background)
        }
        actions.addView(send, LinearLayout.LayoutParams(0, -2, 1f)); composer.addView(actions)
        root.addView(composer, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        root.addView(textLabel("Review before sending. Pi can change files and operate your phone.", 11f, true))
        drawer.addView(root, DrawerLayout.LayoutParams(-1, -1))
        navigation = SessionDrawer(this, ::switchSession, ::newChat, ::renameSession,
            { session -> history.pin(session.id, !session.pinned); render() }, ::finishSession, ::archiveSession, ::settings)
        val drawerWidth = minOf((resources.displayMetrics.widthPixels * 0.88).toInt(), dp(340))
        drawer.addView(navigation, DrawerLayout.LayoutParams(drawerWidth, -1, GravityCompat.START))
        drawer.addDrawerListener(object : DrawerLayout.SimpleDrawerListener() {
            override fun onDrawerClosed(drawerView: View) { maybeShowApproval() }
        })
        setContentView(insetFrame)
        render()
    }

    override fun onStart() { super.onStart(); observations.reset(); visible = true; changesInfo = null; nextChangesCheck = 0; render(); handler.post(poll) }
    override fun onStop() {
        saveDraft(); visible = false; observations.reset()
        approvalDialog?.dismiss(); approvalDialog = null
        handler.removeCallbacks(poll); super.onStop()
    }
    override fun onDestroy() { approvalDialog?.dismiss(); worker.shutdown(); super.onDestroy() }
    override fun onSaveInstanceState(outState: Bundle) { saveDraft(); outState.putString("speechSession", speechSessionId); super.onSaveInstanceState(outState) }
    @Deprecated("Platform back API")
    override fun onBackPressed() {
        if (drawer.isDrawerOpen(GravityCompat.START)) drawer.closeDrawer(GravityCompat.START) else super.onBackPressed()
    }
    private fun saveDraft() { handler.removeCallbacks(persistDraft); history.saveDraft(selectedId, draft.text.toString()) }
    private fun hideKeyboard() { (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(draft.windowToken, 0); draft.clearFocus() }
    private fun selectedJob() = history.activeJobs().firstOrNull { it.sessionId == selectedId }
    private fun newChat() { navigation.showChats(); switchSession(history.createSession()) }
    private fun finishSession(session: ChatSession, finished: Boolean) {
        try { history.setFinished(session.id, finished); render() }
        catch (error: IllegalStateException) { Toast.makeText(this, error.message, Toast.LENGTH_LONG).show() }
    }
    private fun archiveSession(session: ChatSession, archived: Boolean) {
        try {
            history.setArchived(session.id, archived)
            if (archived && selectedId == session.id) {
                switchSession(history.sessions().firstOrNull { !it.archived }?.id ?: history.createSession())
            } else render()
        } catch (error: IllegalStateException) { Toast.makeText(this, error.message, Toast.LENGTH_LONG).show() }
    }
    private fun switchSession(id: String) {
        if (id != selectedId) {
            saveDraft(); approvalDialog?.dismiss(); approvalDialog = null
            selectedId = id
            changesInfo = null; changesSession = ""; nextChangesCheck = 0
            getSharedPreferences("chat-ui", MODE_PRIVATE).edit().putString("selected", id).commit()
            bindingDraft = true; draft.setText(history.session(id)?.draft.orEmpty()); draft.setSelection(draft.length()); bindingDraft = false
        }
        hideKeyboard(); drawer.closeDrawer(GravityCompat.START); render(); refreshChanges(force = true)
    }
    private fun showMenu(anchor: View) {
        val session = history.session(selectedId) ?: return
        navigation.menu(anchor, session, includeSettings = true, changes = if (reviewAvailable()) ({ openChanges() }) else null) { showWorkspace(session) }
    }
    private fun openChanges() {
        saveDraft(); hideKeyboard()
        startActivity(Intent(this, ChangesActivity::class.java).putExtra("sessionId", selectedId))
    }
    private fun showWorkspace(session: ChatSession) {
        modalOpen = true
        val details = textLabel("Loading workspace…", 14f).apply {
            setPadding(dp(20), dp(12), dp(20), dp(12)); setTextIsSelectable(true)
        }
        val dialog = AlertDialog.Builder(this).setTitle("${session.title} · Workspace")
            .setView(ScrollView(this).apply { addView(details) }).setPositiveButton("Close", null).create()
        dialog.setOnDismissListener { modalOpen = false; maybeShowApproval() }
        dialog.show()
        val job = history.jobs(session.id).lastOrNull()
        if (job == null) { details.text = "A dedicated worktree is created from the default branch when you send the first message."; return }
        worker.execute {
            val message = try {
                val workspace = connection.request("/v1/jobs/${job.id}").optJSONObject("workspace")
                if (workspace == null) "No worktree recorded yet. New requests prepare a dedicated worktree before Pi runs."
                else "Directory\n${workspace.optString("cwd")}\n\nBranch\n${workspace.optString("branch")}\n\nStarted from\n${workspace.optString("baseBranch")} @ ${workspace.optString("baseCommit")}\n\nEdits stay here until you explicitly integrate them. Archiving does not remove this worktree. Phone actions and Git history are shared."
            } catch (_: Exception) { "Workspace details unavailable. Check the saved bridge connection and try again." }
            handler.post { if (!isDestroyed && dialog.isShowing) details.text = message }
        }
    }
    private fun renameSession(session: ChatSession) {
        modalOpen = true
        val input = EditText(this).apply { setText(session.title); isSingleLine = true; selectAll() }
        val dialog = AlertDialog.Builder(this).setTitle("Rename chat").setView(dialogField(input))
            .setPositiveButton("Save", null).setNegativeButton("Cancel", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                try { history.rename(session.id, input.text.toString()); dialog.dismiss(); render() }
                catch (error: IllegalArgumentException) { input.error = error.message }
            }
        }
        dialog.setOnDismissListener { modalOpen = false; maybeShowApproval() }
        dialog.show()
    }

    private fun render() {
        val sessions = history.sessions()
        val session = sessions.firstOrNull { it.id == selectedId } ?: return
        val jobs = history.jobs(selectedId)
        val current = jobs.firstOrNull { it.active }
        title.text = session.title
        changes.visibility = if (reviewAvailable()) View.VISIBLE else View.GONE
        val changedCount = reviewFileCount(changesInfo)
        changes.text = if (changedCount > 0) "Review $changedCount changed ${if (changedCount == 1) "file" else "files"}" else "View repository action"
        val others = sessions.count { it.active && it.id != selectedId }
        lifecycle.visibility = if (session.archived || (current == null && session.status != null)) View.VISIBLE else View.GONE
        lifecycle.text = when { session.archived -> "Restore chat"; session.finished -> "✓ Finished · Reopen chat"; else -> "Mark finished" }
        lifecycle.contentDescription = when { session.archived -> "Restore chat"; session.finished -> "Reopen chat"; else -> "Mark finished" }
        draft.isEnabled = !session.archived
        talk.isEnabled = !session.archived
        talk.alpha = if (talk.isEnabled) 1f else 0.35f
        subtitle.text = if (others > 0) "$others other chats with pending requests" else "A space for your next idea"
        send.text = if (connection.paired) "Send" else "Pair bridge"
        send.isEnabled = !session.archived && (!connection.paired || current == null)
        stop.visibility = if (current != null) View.VISIBLE else View.GONE
        stop.isEnabled = connection.paired && current != null && current.status != "sending"
        send.alpha = if (send.isEnabled) 1f else 0.4f; stop.alpha = if (stop.isEnabled) 1f else 0.35f
        status.text = when {
            session.archived -> "Archived · history preserved. Restore this chat to continue."
            session.finished -> "✓ Finished by you · archive from ⋮, or send a message to reopen."
            !connection.paired -> "Bridge not paired. Tap Pair bridge; saved requests resume after pairing."
            current != null -> requestSummary(current, observations.state(current.id))
            jobs.lastOrNull()?.status == "failed" -> "Request failed. Inspect the result below before retrying."
            jobs.lastOrNull()?.status == "interrupted" -> "Interrupted · inspect changes before a new request. Work was not replayed."
            else -> "Ready when you are"
        }
        val approvalCurrent = current != null && observations.state(current.id) == RequestState.CURRENT && connection.paired
        review.visibility = if (approvalCurrent && current?.pending?.isNotEmpty() == true) View.VISIBLE else View.GONE
        val states = jobs.map { if (it.active) observations.state(it.id) else RequestState.CURRENT }
        if (renderedSession != selectedId || renderedJobs != jobs || renderedPaired != connection.paired || renderedStates != states) {
            val atBottom = renderedSession != selectedId || scroll.getChildAt(0).height - scroll.height - scroll.scrollY < dp(100)
            val previousY = scroll.scrollY
            messages.removeAllViews()
            if (jobs.isEmpty()) {
                messages.addView(textLabel("✦\nA fresh conversation.", 28f).apply { setPadding(dp(8), dp(45), dp(8), dp(12)) })
                messages.addView(textLabel("Talk, type, or start a project.\nEach chat keeps its own Pi context.\n\nOpen ☰ to switch chats while Pi works.", 16f, true))
            }
            for (job in jobs) {
                messages.addView(textLabel("YOU\n${job.text}", 16f).apply {
                    setPadding(dp(16), dp(13), dp(16), dp(13)); setTextIsSelectable(true)
                    background = rounded(PocketColors.card, dp(18).toFloat())
                }, LinearLayout.LayoutParams(-1, -2).apply { leftMargin = dp(26); topMargin = dp(16) })
                val unpaired = job.active && !connection.paired
                val observed = observations.state(job.id)
                val state = if (unpaired) "WAITING FOR PAIRING" else requestLabel(job, observed)
                val answer = if (unpaired) "Pair your Termux bridge to continue." else job.answer.ifBlank {
                    if (job.active) requestSummary(job, observed) else "No answer recorded."
                }
                messages.addView(textLabel("PI · $state\n$answer", 16f).apply {
                    setPadding(dp(14), dp(14), dp(14), dp(14)); setTextIsSelectable(true)
                    background = rounded(PocketColors.panel, dp(18).toFloat())
                }, LinearLayout.LayoutParams(-1, -2).apply { rightMargin = dp(12); topMargin = dp(10); bottomMargin = dp(10) })
            }
            renderedSession = selectedId; renderedJobs = jobs; renderedPaired = connection.paired; renderedStates = states
            scroll.post { if (atBottom) scroll.fullScroll(View.FOCUS_DOWN) else scroll.scrollTo(0, previousY) }
        }
        val sessionStates = history.activeJobs().associate { it.sessionId to observations.state(it.id) }
        navigation.render(sessions, selectedId, sessionStates)
        if (!approvalCurrent || current?.pending.isNullOrEmpty() || approvalDialogKey != current?.takeIf { it.pending.isNotEmpty() }?.let { approvalKey(it) }) {
            approvalDialog?.dismiss(); approvalDialog = null
        }
        maybeShowApproval()
    }

    private fun reviewAvailable() = connection.paired && hasReviewChanges(
        if (changesSession == selectedId) changesInfo else null,
        getSharedPreferences("review-requests", MODE_PRIVATE).contains("pending-$selectedId"))

    private fun refreshChanges(force: Boolean = false) {
        if (!visible || !connection.paired || history.jobs(selectedId).isEmpty()) return
        val now = android.os.SystemClock.elapsedRealtime()
        if (!force && now < nextChangesCheck) return
        val id = selectedId; val endpoint = connection.endpoint
        if (!checkingChanges.add(id)) return
        nextChangesCheck = now + 4500
        worker.execute {
            val result = runCatching { connection.request("/v1/sessions/$id/changes?summary=1") }
            handler.post {
                checkingChanges.remove(id)
                if (!isDestroyed && visible && selectedId == id && connection.endpoint == endpoint) {
                    changesSession = id; changesInfo = result.getOrNull(); render()
                }
            }
        }
    }

    /** Poll every active chat, not just the visible one. Background completions never switch selection. */
    private fun refresh() {
        refreshChanges()
        if (!connection.paired) return
        for (job in history.activeJobs()) {
            if (!polling.add(job.id)) continue
            val epoch = observations.epoch
            val endpoint = connection.endpoint
            worker.execute {
                var result: JSONObject? = null
                var failure: Exception? = null
                try {
                    val received = if (job.status == "sending") {
                        val health = connection.request("/health")
                        if (health.optInt("protocolVersion") < 3 || !health.optBoolean("worktreeIsolation")) throw BridgeException(426, "Update the Termux bridge for isolated Git worktrees")
                        connection.request("/v1/jobs", JSONObject().put("requestId", job.id).put("text", job.text).put("sessionId", job.sessionId))
                    } else connection.request("/v1/jobs/${job.id}")
                    if (received.optString("sessionId", "pocket") != job.sessionId) throw BridgeException(409, "Bridge returned a different chat; request not applied")
                    require(received.getString("status") in listOf("queued", "running", "done", "failed", "cancelled", "interrupted")) { "Unknown bridge job state" }
                    result = received
                } catch (error: Exception) { failure = error }
                handler.post {
                    polling.remove(job.id)
                    // Responses from before backgrounding or re-pairing are not live evidence.
                    if (isDestroyed || !visible || epoch != observations.epoch || endpoint != connection.endpoint) return@post
                    val received = result
                    val error = failure
                    if (received != null) {
                        history.update(job.id, received.getString("status"), received.optString("answer"), received.optString("progress"), received.optJSONObject("pending")?.toString().orEmpty())
                        observations.record(job.id, epoch, RequestState.CURRENT)
                    } else if (job.status == "sending" && error is BridgeException && error.code in listOf(400, 409, 426)) {
                        history.update(job.id, "rejected", error.message ?: "Request rejected")
                    } else {
                        observations.record(job.id, epoch, if (error is BridgeException && error.code == 429) RequestState.WAITING else RequestState.UNAVAILABLE)
                    }
                    render()
                }
            }
        }
    }
    private fun submit() {
        if (!connection.paired) { settings(); return }
        val text = draft.text.toString().trim()
        if (text.isBlank() || selectedJob() != null || history.session(selectedId)?.archived == true) return
        if (text.length > 20000) { draft.error = "Keep requests under 20,000 characters"; return }
        saveDraft()
        history.add(UUID.randomUUID().toString(), selectedId, text)
        bindingDraft = true; draft.setText(""); bindingDraft = false
        hideKeyboard(); render(); refresh()
    }
    private fun network(jobId: String? = null, action: () -> Unit) {
        val epoch = observations.epoch
        val endpoint = connection.endpoint
        worker.execute {
            var failed = false
            try { action() } catch (_: Exception) { failed = true }
            handler.post {
                if (!isDestroyed && visible && epoch == observations.epoch && endpoint == connection.endpoint) {
                    if (jobId != null) observations.record(jobId, epoch, if (failed) RequestState.UNAVAILABLE else RequestState.CHECKING)
                    render(); refresh()
                }
            }
        }
    }
    private fun approvalKey(job: Job): String = job.id + ":" + JSONObject(job.pending).optString("id")
    private fun maybeShowApproval() {
        if (!visible || modalOpen || drawer.isDrawerVisible(GravityCompat.START) || approvalDialog?.isShowing == true) return
        val job = selectedJob() ?: return
        if (!connection.paired || observations.state(job.id) != RequestState.CURRENT) return
        if (job.pending.isNotEmpty() && approvalKey(job) !in deferredApprovals) showApproval(job)
    }
    private fun showApproval(job: Job) {
        if (!visible || job.sessionId != selectedId || job.pending.isEmpty() || observations.state(job.id) != RequestState.CURRENT) return
        val pending = JSONObject(job.pending)
        val key = approvalKey(job)
        val builder = AlertDialog.Builder(this).setTitle("${history.session(job.sessionId)?.title}: ${pending.optString("title", "Pi extension")}")
        fun reply(json: JSONObject) {
            val current = selectedJob() ?: return
            if (!visible || observations.state(job.id) != RequestState.CURRENT || current.pending.isEmpty() || approvalKey(current) != key) return
            deferredApprovals.add(key)
            network(job.id) { connection.request("/v1/jobs/${job.id}/ui", json.put("id", pending.getString("id"))) }
        }
        builder.setOnCancelListener { deferredApprovals.add(key) }
        builder.setNeutralButton("Later") { _, _ -> deferredApprovals.add(key) }
        when (pending.getString("method")) {
            "confirm" -> builder.setMessage(pending.optString("message"))
                .setPositiveButton("Allow") { _, _ -> reply(JSONObject().put("confirmed", true)) }
                .setNegativeButton("Deny") { _, _ -> reply(JSONObject().put("confirmed", false)) }
            "select" -> {
                val options = pending.getJSONArray("options")
                builder.setItems(Array(options.length()) { options.getString(it) }) { _, index -> reply(JSONObject().put("value", options.getString(index))) }
                    .setNegativeButton("Cancel") { _, _ -> reply(JSONObject().put("cancelled", true)) }
            }
            else -> {
                val input = EditText(this).apply {
                    hint = pending.optString("placeholder"); setText(pending.optString("prefill"))
                    inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
                }
                builder.setView(dialogField(input)).setPositiveButton("Send") { _, _ -> reply(JSONObject().put("value", input.text.toString())) }
                    .setNegativeButton("Cancel") { _, _ -> reply(JSONObject().put("cancelled", true)) }
            }
        }
        approvalDialogKey = key
        approvalDialog = builder.create().also { dialog -> dialog.setOnDismissListener { if (approvalDialog === dialog) approvalDialog = null }; dialog.show() }
    }
    private fun settings() {
        modalOpen = true
        val fields = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(8), dp(20), dp(8)) }
        val url = EditText(this).apply { hint = "Bridge URL"; setText(connection.endpoint); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI }
        val token = EditText(this).apply { hint = "Paste pairing token"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        fields.addView(url); fields.addView(token)
        val dialog = AlertDialog.Builder(this).setTitle("Pair Pi in Termux").setView(fields)
            .setMessage("Use http://127.0.0.1:8787 on this phone. Tokens are encrypted with Android Keystore. Test checks your saved connection.")
            .setPositiveButton("Save", null).setNeutralButton("Test", null).setNegativeButton("Cancel", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                try { connection.save(url.text.toString(), token.text.toString()); observations.reset(); Log.i("PiPocket", "pairing saved"); dialog.dismiss(); render(); refresh() }
                catch (error: Exception) { token.error = error.message }
            }
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener {
                worker.execute {
                    val message = try {
                        val health = connection.request("/health")
                        if (health.optInt("protocolVersion") < 3 || !health.optBoolean("worktreeIsolation")) "Bridge needs an update for isolated Git worktrees" else "Bridge connected · own Git worktrees · up to ${health.optInt("maxConcurrent", 8)} active chats"
                    } catch (error: Exception) { error.message ?: "Connection error" }
                    handler.post { if (dialog.isShowing && !isDestroyed) Toast.makeText(this, message, Toast.LENGTH_LONG).show() }
                }
            }
        }
        dialog.setOnDismissListener { modalOpen = false; maybeShowApproval() }
        dialog.show()
    }
    private fun speak() {
        speechSessionId = selectedId
        try {
            startActivityForResult(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Talk to Fantastic Pi Mobile"); putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            }, 42)
        } catch (_: ActivityNotFoundException) { Toast.makeText(this, "No speech service installed. You can still type.", Toast.LENGTH_LONG).show() }
    }
    @Deprecated("Platform activity result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 42 && resultCode == RESULT_OK) {
            data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let { text ->
                val id = speechSessionId ?: selectedId
                history.saveDraft(id, text)
                if (id == selectedId) draft.setText(text)
            }
        }
    }
}
