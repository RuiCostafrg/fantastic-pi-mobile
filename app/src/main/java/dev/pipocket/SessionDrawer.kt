package dev.pipocket

import android.content.Context
import android.graphics.Typeface
import android.text.Editable
import android.text.TextWatcher
import android.text.TextUtils
import android.text.InputType
import android.view.Gravity
import android.widget.*
import java.util.Locale

/** Conversation navigation owns its search, ordering, badges and row menus. */
class SessionDrawer(context: Context, private val select: (String) -> Unit, newChat: () -> Unit,
    private val rename: (ChatSession) -> Unit, private val pin: (ChatSession) -> Unit,
    settings: () -> Unit) : LinearLayout(context) {
    private val summary = context.textLabel("", 13f, true)
    private val rows = LinearLayout(context).apply { orientation = VERTICAL }
    private val search = EditText(context)
    private var sessions: List<ChatSession> = emptyList()
    private var selected = ""
    init {
        orientation = VERTICAL; setPadding(context.dp(18), context.dp(16), context.dp(18), context.dp(12))
        setBackgroundColor(PocketColors.panel)
        addView(context.textLabel("✦ Pi Pocket", 25f).apply { setTypeface(typeface, Typeface.BOLD) })
        addView(summary)
        addView(context.actionButton("＋ New chat", "New chat", newChat), LayoutParams(-1, context.dp(52)).apply { topMargin = context.dp(16); bottomMargin = context.dp(14) })
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
        addView(context.actionButton("Settings", action = settings), LayoutParams(-1, context.dp(48)))
        addView(context.textLabel("Separate conversations.\nFiles and this phone are shared.", 12f, true))
    }
    fun render(items: List<ChatSession>, selectedId: String) {
        if (items == sessions && selectedId == selected) return
        sessions = items; selected = selectedId
        val active = items.count { it.active }
        summary.text = "${items.size} chats · $active active"
        renderRows()
    }
    private fun renderRows() {
        rows.removeAllViews()
        val query = search.text.toString().trim().lowercase(Locale.ROOT)
        val filtered = sessions.filter { it.title.lowercase(Locale.ROOT).contains(query) }
        if (filtered.isEmpty()) { rows.addView(context.textLabel("No chats found", 14f, true)); return }
        for ((heading, group) in listOf("PINNED" to filtered.filter { it.pinned }, "RECENT" to filtered.filter { !it.pinned })) {
            if (group.isEmpty()) continue
            rows.addView(context.textLabel(heading, 11f, true).apply { setPadding(context.dp(8), context.dp(14), 0, context.dp(8)) })
            for (session in group) {
                val row = LinearLayout(context).apply {
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(context.dp(12), context.dp(9), context.dp(4), context.dp(9))
                    background = rounded(if (session.id == selected) PocketColors.card else PocketColors.panel, context.dp(14).toFloat())
                    isClickable = true; isFocusable = true; contentDescription = "Open chat: ${session.title}"
                    setOnClickListener { select(session.id) }
                    setOnLongClickListener { menu(this, session); true }
                }
                val labels = LinearLayout(context).apply { orientation = VERTICAL }
                labels.addView(context.textLabel(session.title, 15f).apply {
                    maxLines = 1; ellipsize = TextUtils.TruncateAt.END
                    if (session.id == selected) { setTextColor(PocketColors.accent); setTypeface(typeface, Typeface.BOLD) }
                })
                val state = when {
                    session.needsApproval -> "◉ Needs approval"
                    session.status == "sending" -> "◌ Connecting"
                    session.active -> "● Running"
                    session.status == "done" -> "✓ Complete"
                    session.status == "cancelled" -> "Stopped"
                    session.status in listOf("failed", "rejected", "interrupted") -> "! ${session.status}"
                    else -> "Ready for a new thought"
                }
                labels.addView(context.textLabel(state, 12f, true))
                row.addView(labels, LayoutParams(0, -2, 1f))
                val more = context.actionButton("⋮", "Chat options: ${session.title}") {}
                more.background = rounded(PocketColors.panel, context.dp(12).toFloat())
                more.setOnClickListener { menu(more, session) }
                row.addView(more, LayoutParams(context.dp(44), context.dp(48)))
                rows.addView(row, LayoutParams(-1, -2).apply { bottomMargin = context.dp(4) })
            }
        }
    }
    private fun menu(anchor: android.view.View, session: ChatSession) {
        PopupMenu(context, anchor).apply {
            menu.add("Rename").setOnMenuItemClickListener { rename(session); true }
            menu.add(if (session.pinned) "Unpin" else "Pin").setOnMenuItemClickListener { pin(session); true }
        }.show()
    }
}
