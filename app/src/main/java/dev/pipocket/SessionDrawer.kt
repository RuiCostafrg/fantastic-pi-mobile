package dev.pipocket

import android.content.Context
import android.graphics.Typeface
import android.text.Editable
import android.text.TextWatcher
import android.text.TextUtils
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.*
import java.util.Locale

/** Orders by task lifecycle first; pins only affect ordering within a section. */
class SessionDrawer(context: Context, private val select: (String) -> Unit, newChat: () -> Unit,
    private val rename: (ChatSession) -> Unit, private val pin: (ChatSession) -> Unit,
    private val finish: (ChatSession, Boolean) -> Unit, private val archive: (ChatSession, Boolean) -> Unit,
    private val settings: () -> Unit) : LinearLayout(context) {
    private val summary = context.textLabel("", 13f, true)
    private val rows = LinearLayout(context).apply { orientation = VERTICAL }
    private val search = EditText(context)
    private val archiveButton = context.actionButton("Archive") { showingArchive = !showingArchive; renderRows() }
    private var sessions: List<ChatSession> = emptyList()
    private var selected = ""
    private var showingArchive = false
    init {
        orientation = VERTICAL; setPadding(context.dp(18), context.dp(16), context.dp(18), context.dp(12))
        setBackgroundColor(PocketColors.panel)
        addView(context.textLabel("✦ Pi Pocket", 25f).apply { setTypeface(typeface, Typeface.BOLD) })
        addView(summary)
        addView(context.actionButton("＋ New chat", "New chat") {
            showingArchive = false; search.setText(""); newChat(); renderRows()
        }, LayoutParams(-1, context.dp(52)).apply { topMargin = context.dp(16); bottomMargin = context.dp(14) })
        search.apply {
            hint = "Search chats"; contentDescription = "Search chats"; textSize = 15f
            inputType = InputType.TYPE_CLASS_TEXT; isSingleLine = true
            setTextColor(PocketColors.text); setHintTextColor(PocketColors.muted)
            setPadding(context.dp(14), context.dp(8), context.dp(14), context.dp(8))
            background = rounded(PocketColors.background, context.dp(14).toFloat())
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { renderRows() }
                override fun afterTextChanged(s: Editable?) = Unit
            })
        }
        addView(search, LayoutParams(-1, context.dp(48)))
        addView(ScrollView(context).apply { addView(rows); isFillViewport = true }, LayoutParams(-1, 0, 1f).apply { topMargin = context.dp(12) })
        addView(archiveButton, LayoutParams(-1, context.dp(48)))
        addView(context.actionButton("Settings", action = settings), LayoutParams(-1, context.dp(48)).apply { topMargin = context.dp(6) })
        addView(context.textLabel("Separate conversations.\nFiles and this phone are shared.", 12f, true))
    }
    fun render(items: List<ChatSession>, selectedId: String) {
        if (items == sessions && selectedId == selected) return
        sessions = items; selected = selectedId
        renderRows()
    }
    fun showChats() { showingArchive = false; renderRows() }
    private fun renderRows() {
        rows.removeAllViews()
        val visible = sessions.filter { it.archived == showingArchive }
        summary.text = if (showingArchive) "Archive · ${visible.size} saved chats" else "${visible.size} chats · ${visible.count { it.section == ChatSection.ATTENTION }} need attention"
        archiveButton.text = if (showingArchive) "← Back to chats" else "Archive (${sessions.count { it.archived }})"
        archiveButton.contentDescription = if (showingArchive) "Back to chats" else "Open archive"
        val query = search.text.toString().trim().lowercase(Locale.ROOT)
        val filtered = visible.filter { it.title.lowercase(Locale.ROOT).contains(query) }
        if (filtered.isEmpty()) { rows.addView(context.textLabel(if (query.isNotEmpty()) "No chats found" else if (showingArchive) "No archived chats yet" else "Start a new chat above", 14f, true)); return }
        for (section in ChatSection.entries) {
            val group = filtered.filter { it.section == section }
            if (group.isEmpty()) continue
            rows.addView(context.textLabel(section.heading, 11f, true).apply { setPadding(context.dp(8), context.dp(14), 0, context.dp(8)) })
            for (session in group) {
                val working = section == ChatSection.WORKING
                val row = LinearLayout(context).apply {
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(context.dp(12), context.dp(9), context.dp(4), context.dp(9))
                    background = rounded(if (session.id == selected) PocketColors.card else PocketColors.panel, context.dp(14).toFloat())
                    isClickable = true; isFocusable = true; contentDescription = "Open chat: ${session.title}"
                    setOnClickListener { select(session.id) }
                    setOnLongClickListener { menu(this, session); true }
                }
                val labels = LinearLayout(context).apply { orientation = VERTICAL }
                labels.addView(context.textLabel((if (session.pinned) "◆ " else "") + session.title, 15f, working).apply {
                    maxLines = 1; ellipsize = TextUtils.TruncateAt.END
                    if (session.id == selected) { if (!working) setTextColor(PocketColors.accent); setTypeface(typeface, Typeface.BOLD) }
                })
                val state = when {
                    session.archived -> "✓ Finished · archived"
                    session.needsApproval -> "◉ Your feedback needed"
                    session.status == "sending" -> "◌ Connecting / waiting for a slot"
                    session.active -> "● Working in background"
                    session.finished -> "✓ Finished by you"
                    session.status == "done" -> "Reply ready · review or mark finished"
                    session.status == "cancelled" -> "Stopped · review needed"
                    session.status in listOf("failed", "rejected", "interrupted") -> "! ${session.status} · review needed"
                    else -> "Ready for a new thought"
                }
                labels.addView(context.textLabel(state, 12f, true))
                // Muted grey labels, not disabled controls: still readable and fully interactive.
                row.addView(labels, LayoutParams(0, -2, 1f))
                val more = context.actionButton("⋮", "Chat options: ${session.title}") {}
                more.background = rounded(PocketColors.panel, context.dp(12).toFloat())
                more.setOnClickListener { menu(more, session) }
                row.addView(more, LayoutParams(context.dp(44), context.dp(48)))
                rows.addView(row, LayoutParams(-1, -2).apply { bottomMargin = context.dp(4) })
            }
        }
    }
    fun menu(anchor: View, session: ChatSession, includeSettings: Boolean = false) {
        PopupMenu(context, anchor).apply {
            menu.add("Rename chat").setOnMenuItemClickListener { rename(session); true }
            menu.add(if (session.pinned) "Unpin chat" else "Pin chat").setOnMenuItemClickListener { pin(session); true }
            if (session.archived) {
                menu.add("Restore chat").setOnMenuItemClickListener { archive(session, false); true }
            } else if (!session.active && session.status != null) {
                menu.add(if (session.finished) "Reopen chat" else "Mark finished").setOnMenuItemClickListener { finish(session, !session.finished); true }
                if (session.finished) menu.add("Archive chat").setOnMenuItemClickListener { archive(session, true); true }
            }
            if (includeSettings) menu.add("Settings").setOnMenuItemClickListener { settings(); true }
        }.show()
    }
}
