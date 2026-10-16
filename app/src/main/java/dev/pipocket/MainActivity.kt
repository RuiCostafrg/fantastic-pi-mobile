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
    private var selectedId = "pocket"
    private var renderedSession = ""
    private var renderedJobs: List<Job>? = null
    private var renderedPaired = false
    private var bindingDraft = false
    private var visible = false
    private var modalOpen = false
    private var speechSessionId: String? = null
    private var approvalDialog: AlertDialog? = null
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
            orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(8), dp(16), dp(10))
            setBackgroundColor(PocketColors.background)
        }
        val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(actionButton("☰", "Open chats") { hideKeyboard(); drawer.openDrawer(GravityCompat.START) }, LinearLayout.LayoutParams(dp(48), dp(48)))
        val titles = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, dp(4), 0) }
        titles.addView(textLabel("PI POCKET", 10f, true).apply { letterSpacing = 0.16f })
        title = textLabel("", 20f).apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END; setTypeface(typeface, Typeface.BOLD) }
        titles.addView(title); header.addView(titles, LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(actionButton("＋", "New chat") { newChat() }, LinearLayout.LayoutParams(dp(48), dp(48)))
        val more = actionButton("⋮", "Chat menu") {}
        more.setOnClickListener { showMenu(more) }
        header.addView(more, LinearLayout.LayoutParams(dp(44), dp(48)).apply { leftMargin = dp(6) })
        root.addView(header)
        subtitle = textLabel("", 12f, true); root.addView(subtitle)
        status = textLabel("", 13f, true).apply { maxLines = 3 }; root.addView(status)
        lifecycle = actionButton("Mark finished") {
            history.session(selectedId)?.let { session ->
                if (session.archived) archiveSession(session, false) else finishSession(session, !session.finished)
            }
        }
        root.addView(lifecycle, LinearLayout.LayoutParams(-1, dp(48)))
        review = actionButton("Review approval") {
            selectedJob()?.let { job -> deferredApprovals.remove(approvalKey(job)); showApproval(job) }
        }
        root.addView(review, LinearLayout.LayoutParams(-1, dp(48)))
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
        actions.addView(talk, LinearLayout.LayoutParams(0, dp(48), 1f))
        stop = actionButton("Stop", "Stop this chat") {
            val job = selectedJob() ?: return@actionButton
            network(job.id) { connection.request("/v1/jobs/${job.id}/cancel", JSONObject()) }
        }
        actions.addView(stop, LinearLayout.LayoutParams(0, dp(48), 1f).apply { leftMargin = dp(8); rightMargin = dp(8) })
        send = actionButton("Send") { submit() }.apply {
            background = rounded(PocketColors.accent, dp(14).toFloat()); setTextColor(PocketColors.background)
        }
        actions.addView(send, LinearLayout.LayoutParams(0, dp(48), 1f)); composer.addView(actions)
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

    override fun onStart() { super.onStart(); visible = true; render(); handler.post(poll) }
    override fun onStop() { saveDraft(); visible = false; handler.removeCallbacks(poll); super.onStop() }
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
            getSharedPreferences("chat-ui", MODE_PRIVATE).edit().putString("selected", id).commit()
            bindingDraft = true; draft.setText(history.session(id)?.draft.orEmpty()); draft.setSelection(draft.length()); bindingDraft = false
        }
        hideKeyboard(); drawer.closeDrawer(GravityCompat.START); render()
    }
    private fun showMenu(anchor: View) {
        val session = history.session(selectedId) ?: return
        navigation.menu(anchor, session, includeSettings = true)
    }
    private fun renameSession(session: ChatSession) {
        modalOpen = true
        val input = EditText(this).apply { setText(session.title); isSingleLine = true; selectAll() }
        val dialog = AlertDialog.Builder(this).setTitle("Rename chat").setView(input)
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
        val others = sessions.count { it.active && it.id != selectedId }
        lifecycle.visibility = if (session.archived || (current == null && session.status != null)) View.VISIBLE else View.GONE
        lifecycle.text = when { session.archived -> "Restore chat"; session.finished -> "✓ Finished · Reopen chat"; else -> "Mark finished" }
        lifecycle.contentDescription = when { session.archived -> "Restore chat"; session.finished -> "Reopen chat"; else -> "Mark finished" }
        draft.isEnabled = !session.archived
        talk.isEnabled = !session.archived
        talk.alpha = if (talk.isEnabled) 1f else 0.35f
        subtitle.text = if (others > 0) "$others other chats active · shared workspace" else "Independent chat · shared workspace"
        send.text = if (connection.paired) "Send" else "Pair bridge"
        send.isEnabled = !session.archived && (!connection.paired || current == null)
        stop.isEnabled = connection.paired && current != null && current.status != "sending"
        send.alpha = if (send.isEnabled) 1f else 0.4f; stop.alpha = if (stop.isEnabled) 1f else 0.35f
        status.text = when {
            session.archived -> "Archived · history preserved. Restore this chat to continue."
            session.finished -> "✓ Finished by you · archive from ⋮, or send a message to reopen."
            !connection.paired -> "Bridge not paired. Tap Pair bridge; saved requests resume after pairing."
            current?.pending?.isNotEmpty() == true -> "This chat needs your approval. Other chats can keep running."
            current != null -> current.progress.ifBlank { if (current.status == "sending") "Connecting to your Termux bridge…" else "Pi is working in this chat…" }
            jobs.lastOrNull()?.status == "failed" -> "Request failed. Inspect the result below before retrying."
            else -> "Ready · your Termux bridge must stay running"
        }
        review.visibility = if (current?.pending?.isNotEmpty() == true) View.VISIBLE else View.GONE
        if (renderedSession != selectedId || renderedJobs != jobs || renderedPaired != connection.paired) {
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
                val state = if (unpaired) "WAITING FOR PAIRING" else job.status.uppercase()
                val answer = if (unpaired) "Pair your Termux bridge to continue." else job.answer.ifBlank { if (job.pending.isNotEmpty()) "Waiting for your approval…" else "Waiting for Pi…" }
                messages.addView(textLabel("PI · $state\n$answer", 16f).apply {
                    setPadding(dp(14), dp(14), dp(14), dp(14)); setTextIsSelectable(true)
                    background = rounded(PocketColors.panel, dp(18).toFloat())
                }, LinearLayout.LayoutParams(-1, -2).apply { rightMargin = dp(12); topMargin = dp(10); bottomMargin = dp(10) })
            }
            renderedSession = selectedId; renderedJobs = jobs; renderedPaired = connection.paired
            scroll.post { if (atBottom) scroll.fullScroll(View.FOCUS_DOWN) else scroll.scrollTo(0, previousY) }
        }
        navigation.render(sessions, selectedId)
        if (current?.pending.isNullOrEmpty()) { approvalDialog?.dismiss(); approvalDialog = null }
        maybeShowApproval()
    }

    /** Poll every active chat, not just the visible one. Background completions never switch selection. */
    private fun refresh() {
        if (!connection.paired) return
        for (job in history.activeJobs()) {
            if (!polling.add(job.id)) continue
            worker.execute {
                try {
                    val result = if (job.status == "sending") {
                        val health = connection.request("/health")
                        if (health.optInt("protocolVersion") < 2) throw BridgeException(426, "Update the Termux bridge to support separate chats")
                        connection.request("/v1/jobs", JSONObject().put("requestId", job.id).put("text", job.text).put("sessionId", job.sessionId))
                    } else connection.request("/v1/jobs/${job.id}")
                    if (result.optString("sessionId", "pocket") != job.sessionId) throw BridgeException(409, "Bridge returned a different chat; request not applied")
                    history.update(job.id, result.getString("status"), result.optString("answer"), result.optString("progress"), result.optJSONObject("pending")?.toString().orEmpty())
                } catch (error: Exception) {
                    val rejected = job.status == "sending" && error is BridgeException && error.code in listOf(400, 409, 426)
                    if (rejected) history.update(job.id, "rejected", error.message ?: "Request rejected")
                    else history.problem(job.id, if (error is BridgeException && error.code == 429) "All parallel slots are busy. Waiting and retrying with the same request ID." else "Not updated: ${error.message ?: "Connection error"}. Retrying this request ID.")
                } finally {
                    handler.post { polling.remove(job.id); if (!isDestroyed && visible) render() }
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
        worker.execute {
            try { action() }
            catch (error: Exception) { if (jobId != null) history.problem(jobId, error.message ?: "Connection error") }
            handler.post { if (!isDestroyed && visible) { render(); refresh() } }
        }
    }
    private fun approvalKey(job: Job): String = job.id + ":" + JSONObject(job.pending).optString("id")
    private fun maybeShowApproval() {
        if (!visible || modalOpen || drawer.isDrawerVisible(GravityCompat.START) || approvalDialog?.isShowing == true) return
        val job = selectedJob() ?: return
        if (job.pending.isNotEmpty() && approvalKey(job) !in deferredApprovals) showApproval(job)
    }
    private fun showApproval(job: Job) {
        if (job.sessionId != selectedId || job.pending.isEmpty()) return
        val pending = JSONObject(job.pending)
        val key = approvalKey(job)
        val builder = AlertDialog.Builder(this).setTitle("${history.session(job.sessionId)?.title}: ${pending.optString("title", "Pi extension")}")
        fun reply(json: JSONObject) {
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
                builder.setView(input).setPositiveButton("Send") { _, _ -> reply(JSONObject().put("value", input.text.toString())) }
                    .setNegativeButton("Cancel") { _, _ -> reply(JSONObject().put("cancelled", true)) }
            }
        }
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
                try { connection.save(url.text.toString(), token.text.toString()); Log.i("PiPocket", "pairing saved"); dialog.dismiss(); render(); refresh() }
                catch (error: Exception) { token.error = error.message }
            }
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener {
                worker.execute {
                    val message = try {
                        val health = connection.request("/health")
                        if (health.optInt("protocolVersion") < 2) "Bridge needs an update for multiple chats" else "Bridge connected · up to ${health.optInt("maxConcurrent", 3)} active chats"
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
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Talk to Pi Pocket"); putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
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
