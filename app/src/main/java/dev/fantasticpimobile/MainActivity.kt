package dev.fantasticpimobile

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
    private lateinit var project: Button
    private lateinit var projectPicker: ProjectPicker
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
    private lateinit var shared: SharedConversations
    private val sharedWorker = Executors.newSingleThreadExecutor()
    private var sharedRefreshing = false
    private var sharedIdentity = ""
    private fun configureShared() {
        val identity = connection.identity
        if (::shared.isInitialized) shared.invalidate()
        sharedIdentity = identity
        val endpoint = connection.endpoint
        shared = SharedConversations(history, endpoint,
            { path, body, headers -> connection.requestAt(endpoint, path, body, headers, identity) },
            { connection.identity == identity })
        if (visible) shared.activate()
    }
    private fun chatJobs(id: String): List<Job> = if (::shared.isInitialized && shared.sharedRequired())
        runCatching { shared.jobs(id) }.getOrElse { history.jobs(id).map { it.copy(pending = "") } } else history.jobs(id)
    private fun chatSessions(): List<ChatSession> = if (::shared.isInitialized && shared.sharedRequired())
        runCatching { shared.sessions() }.getOrElse { history.sessions() } else history.sessions()
    private fun currentEvidence(job: Job): Boolean = if (shared.sharedRequired()) shared.current(job)
        else !shared.isSharedRequest(job.id) && observations.state(job.id) == RequestState.CURRENT
    private fun displayState(job: Job): RequestState = when {
        !shared.sharedRequired() -> observations.state(job.id)
        shared.mode == SharedConversations.Mode.CHECKING -> RequestState.CHECKING
        shared.current(job) -> RequestState.CURRENT
        else -> RequestState.UNAVAILABLE
    }
    private fun approvalCurrent(job: Job): Boolean = if (shared.sharedRequired()) shared.canApprove(job) else currentEvidence(job)
    private fun sharedAction(job: Job, action: (SharedConversations) -> Unit) {
        val adapter = shared
        sharedWorker.execute {
            runCatching { action(adapter) }
            handler.post { if (!isDestroyed && visible && shared === adapter) { render(); refresh() } }
        }
    }
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
        configureShared()
        projectPicker = ProjectPicker(this, history, connection, worker, handler,
            { id -> visible && !isDestroyed && selectedId == id }, { render() },
            { open -> modalOpen = open; if (!open) maybeShowApproval() })
        val savedId = getSharedPreferences("chat-ui", MODE_PRIVATE).getString("selected", "pocket") ?: "pocket"
        selectedId = if (history.session(savedId) != null) savedId else "pocket"
        speechSessionId = savedInstanceState?.getString("speechSession")
        window.statusBarColor = FantasticPiMobileColors.background
        window.navigationBarColor = FantasticPiMobileColors.background
        // FrameLayout honors inset padding; DrawerLayout positions children using margins instead.
        val insetFrame = FrameLayout(this).apply {
            setBackgroundColor(FantasticPiMobileColors.background)
            setOnApplyWindowInsetsListener { view, insets ->
                view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
                insets.consumeSystemWindowInsets()
            }
        }
        drawer = DrawerLayout(this).apply {
            setBackgroundColor(FantasticPiMobileColors.background)
            setScrimColor(Color.argb(160, 0, 0, 0))
        }
        insetFrame.addView(drawer, FrameLayout.LayoutParams(-1, -1))
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(8), dp(20), dp(12))
            setBackgroundColor(FantasticPiMobileColors.background)
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
        project = actionButton("Choose project before Send", "Chat project") { projectPicker.show(selectedId) }
        root.addView(project, LinearLayout.LayoutParams(-1, -2))
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
            background = rounded(FantasticPiMobileColors.panel, dp(20).toFloat())
        }
        draft = EditText(this).apply {
            hint = "Message this chat…"; contentDescription = "Message this chat"
            setTextColor(FantasticPiMobileColors.text); setHintTextColor(FantasticPiMobileColors.muted); textSize = 16f
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
            if (shared.sharedRequired()) sharedAction(job) { it.stop(job) }
            else if (currentEvidence(job)) network(job.id) { connection.request("/v1/jobs/${job.id}/cancel", JSONObject()) }
        }
        actions.addView(stop, LinearLayout.LayoutParams(0, -2, 1f).apply { rightMargin = dp(8) })
        send = actionButton("Send") { submit() }.apply {
            background = rounded(FantasticPiMobileColors.accent, dp(14).toFloat()); setTextColor(FantasticPiMobileColors.background)
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

    override fun onStart() { super.onStart(); observations.reset(); visible = true; shared.activate(); changesInfo = null; nextChangesCheck = 0; render(); history.session(selectedId)?.let { projectPicker.refreshLabel(it) }; handler.post(poll) }
    override fun onStop() {
        saveDraft(); visible = false; shared.invalidate(); observations.reset(); projectPicker.close()
        approvalDialog?.dismiss(); approvalDialog = null
        handler.removeCallbacks(poll); super.onStop()
    }
    override fun onDestroy() { approvalDialog?.dismiss(); worker.shutdown(); sharedWorker.shutdown(); super.onDestroy() }
    override fun onSaveInstanceState(outState: Bundle) { saveDraft(); outState.putString("speechSession", speechSessionId); super.onSaveInstanceState(outState) }
    @Deprecated("Platform back API")
    override fun onBackPressed() {
        if (drawer.isDrawerOpen(GravityCompat.START)) drawer.closeDrawer(GravityCompat.START) else super.onBackPressed()
    }
    private fun saveDraft() { handler.removeCallbacks(persistDraft); history.saveDraft(selectedId, draft.text.toString()) }
    private fun hideKeyboard() { (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(draft.windowToken, 0); draft.clearFocus() }
    private fun selectedJob() = chatJobs(selectedId).firstOrNull { it.active }
    private fun newChat() { navigation.showChats(); switchSession(history.createSession()) }
    private fun finishSession(session: ChatSession, finished: Boolean) {
        try { check(chatSessions().none { it.id == session.id && it.active }) { "Remote work is active; refresh or Stop it first" }; history.setFinished(session.id, finished); render() }
        catch (error: IllegalStateException) { Toast.makeText(this, error.message, Toast.LENGTH_LONG).show() }
    }
    private fun archiveSession(session: ChatSession, archived: Boolean) {
        try {
            check(chatSessions().none { it.id == session.id && it.active }) { "Remote work is active; refresh or Stop it first" }
            history.setArchived(session.id, archived)
            if (archived && selectedId == session.id) {
                switchSession(history.sessions().firstOrNull { !it.archived }?.id ?: history.createSession())
            } else render()
        } catch (error: IllegalStateException) { Toast.makeText(this, error.message, Toast.LENGTH_LONG).show() }
    }
    private fun switchSession(id: String) {
        if (id != selectedId) {
            projectPicker.close()
            saveDraft(); approvalDialog?.dismiss(); approvalDialog = null
            selectedId = id
            changesInfo = null; changesSession = ""; nextChangesCheck = 0
            getSharedPreferences("chat-ui", MODE_PRIVATE).edit().putString("selected", id).commit()
            bindingDraft = true; draft.setText(history.session(id)?.draft.orEmpty()); draft.setSelection(draft.length()); bindingDraft = false
        }
        hideKeyboard(); drawer.closeDrawer(GravityCompat.START); render(); refreshChanges(force = true)
        history.session(selectedId)?.let { projectPicker.refreshLabel(it) }
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
        val job = chatJobs(session.id).lastOrNull()
        if (job == null) { details.text = "A dedicated worktree is created from the default branch when you send the first message."; return }
        worker.execute {
            val message = try {
                val response = shared.requestScoped("/v1/jobs/${job.id}")
                ProjectRequests.validateJob(job, history.session(job.sessionId)?.projectId, response)
                val workspace = response.optJSONObject("workspace")
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
        val sessions = chatSessions()
        val session = sessions.firstOrNull { it.id == selectedId } ?: return
        val jobs = chatJobs(selectedId)
        val current = jobs.firstOrNull { it.active }
        title.text = session.title
        project.isEnabled = !shared.readOnly(selectedId)
        project.text = if (shared.readOnly(selectedId)) "Historical chat · unproved project · read-only" else projectPicker.label(session)
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
        send.isEnabled = !session.archived && (!connection.paired || current == null &&
            (!shared.sharedRequired() || shared.canSend(selectedId)))
        stop.visibility = if (current != null) View.VISIBLE else View.GONE
        stop.isEnabled = connection.paired && current != null && current.status != "sending" && currentEvidence(current)
        send.alpha = if (send.isEnabled) 1f else 0.4f; stop.alpha = if (stop.isEnabled) 1f else 0.35f
        status.text = when {
            current != null && shared.sharedRequired() -> if (shared.live(selectedId)) "Remote/local work active · ${shared.message}" else shared.message
            session.archived -> "Archived · history preserved. Restore this chat to continue."
            session.finished -> "✓ Finished by you · archive from ⋮, or send a message to reopen."
            !connection.paired -> "Bridge not paired. Tap Pair bridge; saved requests resume after pairing."
            current != null -> requestSummary(current, observations.state(current.id))
            session.status == "failed" -> "Request failed. Inspect the result below before retrying."
            session.status == "interrupted" -> "Interrupted · inspect changes before a new request. Work was not replayed."
            shared.sharedRequired() -> shared.message
            else -> "Ready when you are"
        }
        val approvalCurrent = current != null && approvalCurrent(current) && connection.paired
        review.visibility = if (approvalCurrent && current?.pending?.isNotEmpty() == true) View.VISIBLE else View.GONE
        val states = jobs.map { if (it.active) displayState(it) else RequestState.CURRENT }
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
                    background = rounded(FantasticPiMobileColors.card, dp(18).toFloat())
                }, LinearLayout.LayoutParams(-1, -2).apply { leftMargin = dp(26); topMargin = dp(16) })
                val unpaired = job.active && !connection.paired
                val observed = displayState(job)
                val historical = job.status == "historical" || shared.sharedRequired() && !shared.isSharedRequest(job.id) && job.approvalOccurrenceId == null && job.progress.startsWith("Historical/unresolved")
                val state = if (historical) "HISTORICAL / UNRESOLVED · READ ONLY" else if (unpaired) "WAITING FOR PAIRING" else requestLabel(job, observed)
                val answer = if (unpaired) "Pair your Termux bridge to continue." else job.answer.ifBlank {
                    if (job.active) requestSummary(job, observed) else "No answer recorded."
                }
                messages.addView(textLabel("PI · $state\n$answer", 16f).apply {
                    setPadding(dp(14), dp(14), dp(14), dp(14)); setTextIsSelectable(true)
                    background = rounded(FantasticPiMobileColors.panel, dp(18).toFloat())
                }, LinearLayout.LayoutParams(-1, -2).apply { rightMargin = dp(12); topMargin = dp(10); bottomMargin = dp(10) })
            }
            renderedSession = selectedId; renderedJobs = jobs; renderedPaired = connection.paired; renderedStates = states
            scroll.post { if (atBottom) scroll.fullScroll(View.FOCUS_DOWN) else scroll.scrollTo(0, previousY) }
        }
        val sessionStates = sessions.filter { it.active }.associate { it.id to
            if (shared.sharedRequired()) { if (shared.live(it.id)) RequestState.CURRENT else RequestState.UNAVAILABLE }
            else observations.state(chatJobs(it.id).last { job -> job.active }.id) }
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
        if (!visible || !connection.paired || chatJobs(selectedId).isEmpty()) return
        val now = android.os.SystemClock.elapsedRealtime()
        if (!force && now < nextChangesCheck) return
        val id = selectedId; val endpoint = connection.endpoint; val epoch = observations.epoch
        if (!checkingChanges.add(id)) return
        nextChangesCheck = now + 4500
        worker.execute {
            val result = runCatching {
                shared.requestScoped("/v1/sessions/$id/changes?summary=1").also {
                    ProjectRequests.validateProject(history.session(id)?.projectId, it)
                }
            }
            handler.post {
                checkingChanges.remove(id)
                if (!isDestroyed && visible && selectedId == id && connection.endpoint == endpoint && observations.epoch == epoch) {
                    val accepted = result.getOrNull()
                    val identity = runCatching { accepted?.let { ProjectRequests.projectId(it) }?.let { history.confirmProject(id, it) } }
                    changesSession = id; changesInfo = if (identity.isSuccess) accepted else null; render()
                }
            }
        }
    }

    /** Poll every active chat, not just the visible one. Background completions never switch selection. */
    private fun refresh() {
        if (!connection.paired) return
        if (sharedIdentity != connection.identity) configureShared()
        if (!sharedRefreshing) {
            sharedRefreshing = true
            val adapter = shared; val epoch = observations.epoch
            sharedWorker.execute {
                adapter.refresh()
                handler.post {
                    sharedRefreshing = false
                    if (!isDestroyed && visible && shared === adapter && observations.epoch == epoch) render()
                }
            }
        }
        refreshChanges()
        if (shared.sharedRequired()) return
        for (job in history.activeJobs().filter { !shared.isSharedRequest(it.id) }) {
            if (!polling.add(job.id)) continue
            val epoch = observations.epoch
            val endpoint = connection.endpoint
            worker.execute {
                var result: JSONObject? = null
                var failure: Exception? = null
                try {
                    fun checkOwner() {
                        if (epoch != observations.epoch || endpoint != connection.endpoint || shared.sharedRequired()) throw ProjectIdentityException("Bridge mode/connection changed; request preserved")
                    }
                    result = ProjectRequests(beforeLegacySubmit = { project ->
                        checkOwner(); history.resolveRequestProject(job.id, project)
                    }, request = { path, body ->
                        checkOwner(); connection.requestAt(endpoint, path, body)
                    }).fetch(job, history.session(job.sessionId)?.projectId)
                } catch (error: Exception) { failure = error }
                handler.post {
                    polling.remove(job.id)
                    // Responses from before backgrounding or re-pairing are not live evidence.
                    if (isDestroyed || !visible || epoch != observations.epoch || endpoint != connection.endpoint || shared.sharedRequired()) return@post
                    val received = result
                    val error = failure
                    if (received != null) {
                        runCatching { history.acceptResponse(job.id, received) }
                            .onSuccess { observations.record(job.id, epoch, RequestState.CURRENT) }
                            .onFailure { observations.record(job.id, epoch, RequestState.UNAVAILABLE); history.problem(job.id, "Project identity could not be verified; saved request preserved") }
                    } else if (job.status == "sending" && error != null && ProjectRequests.permanentSubmission(error)) {
                        history.update(job.id, "rejected", error.message ?: "Request rejected")
                    } else {
                        observations.record(job.id, epoch, if (error is BridgeException && error.code == 429) RequestState.WAITING else RequestState.UNAVAILABLE)
                        if (error is ProjectIdentityException) history.problem(job.id, error.message ?: "Project identity mismatch; saved request preserved")
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
        if (history.session(selectedId)?.let { it.projectState == ProjectState.UNBOUND || (it.projectState == ProjectState.LEGACY_UNRESOLVED && history.jobs(selectedId).isEmpty()) } == true) {
            draft.error = "Choose or resolve this chat's project before sending"; projectPicker.show(selectedId); return
        }
        saveDraft()
        try {
            if (shared.sharedRequired()) shared.prepareSend(selectedId, text)
            else history.add(UUID.randomUUID().toString(), selectedId, text)
        } catch (error: Exception) { draft.error = error.message ?: "Refresh this chat before Send"; return }
        bindingDraft = true; draft.setText(""); bindingDraft = false
        hideKeyboard(); render(); refresh()
    }
    private fun network(jobId: String? = null, action: () -> Unit) {
        val epoch = observations.epoch
        val endpoint = connection.endpoint
        worker.execute {
            var failed = false
            try {
                if (epoch != observations.epoch || endpoint != connection.endpoint || shared.sharedRequired()) throw ProjectIdentityException("Bridge mode changed; action not sent")
                action()
            } catch (_: Exception) { failed = true }
            handler.post {
                if (!isDestroyed && visible && epoch == observations.epoch && endpoint == connection.endpoint) {
                    if (jobId != null) observations.record(jobId, epoch, if (failed) RequestState.UNAVAILABLE else RequestState.CHECKING)
                    render(); refresh()
                }
            }
        }
    }
    private fun approvalKey(job: Job): String = job.id + ":" + (job.approvalOccurrenceId ?: JSONObject(job.pending).optString("id"))
    private fun maybeShowApproval() {
        if (!visible || modalOpen || drawer.isDrawerVisible(GravityCompat.START) || approvalDialog?.isShowing == true) return
        val job = selectedJob() ?: return
        if (!connection.paired || !approvalCurrent(job)) return
        if (job.pending.isNotEmpty() && approvalKey(job) !in deferredApprovals) showApproval(job)
    }
    private fun showApproval(job: Job) {
        if (!visible || job.sessionId != selectedId || job.pending.isEmpty() || !approvalCurrent(job)) return
        val pending = JSONObject(job.pending)
        val key = approvalKey(job)
        val builder = AlertDialog.Builder(this).setTitle("${history.session(job.sessionId)?.title}: ${pending.optString("title", "Pi extension")}")
        fun reply(json: JSONObject) {
            val current = selectedJob() ?: return
            if (!visible || !approvalCurrent(job) || current.pending.isEmpty() || approvalKey(current) != key) return
            deferredApprovals.add(key)
            if (shared.sharedRequired()) sharedAction(job) { it.answer(job, json) }
            else network(job.id) { connection.request("/v1/jobs/${job.id}/ui", json.put("id", pending.getString("id"))) }
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
                try { projectPicker.close(); shared.invalidate(); connection.save(url.text.toString(), token.text.toString()); configureShared(); observations.reset(); Log.i("FantasticPiMobile", "pairing saved"); dialog.dismiss(); render(); refresh() }
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
