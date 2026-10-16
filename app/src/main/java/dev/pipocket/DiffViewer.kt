package dev.pipocket

import android.app.Activity
import android.app.AlertDialog
import android.app.Dialog
import android.content.ClipData
import android.content.ClipboardManager
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.Window
import android.widget.*

/** One-column, full-screen review on phones; long code scrolls horizontally rather than wrapping. */
fun Activity.openDiffViewer(path: String, patch: String, onDismiss: () -> Unit): Dialog {
    val parsed = readableDiff(patch)
    val dialog = Dialog(this).apply { requestWindowFeature(Window.FEATURE_NO_TITLE) }
    val root = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; setBackgroundColor(PocketColors.background)
        setPadding(dp(20), dp(12), dp(20), dp(16))
        setOnApplyWindowInsetsListener { view, insets ->
            view.setPadding(dp(20) + insets.systemWindowInsetLeft, dp(12) + insets.systemWindowInsetTop,
                dp(20) + insets.systemWindowInsetRight, dp(16) + insets.systemWindowInsetBottom)
            insets.consumeSystemWindowInsets()
        }
    }
    val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
    header.addView(iconButton("back", "Close diff") { dialog.dismiss() }, LinearLayout.LayoutParams(dp(48), dp(48)))
    var fileDetails: AlertDialog? = null
    val filename = textLabel(path.substringAfterLast('/'), 18f).apply {
        setTypeface(typeface, Typeface.BOLD); setPadding(dp(10), dp(6), 0, dp(6))
        contentDescription = "File details: $path"
        setOnClickListener {
            val details = textLabel(path, 15f).apply { setPadding(dp(24), dp(16), dp(24), dp(16)); setTextIsSelectable(true) }
            fileDetails = AlertDialog.Builder(this@openDiffViewer).setTitle("File path").setView(details).setPositiveButton("Close", null).show()
        }
    }
    header.addView(filename, LinearLayout.LayoutParams(0, -2, 1f)); root.addView(header)
    val folder = path.substringBeforeLast('/', "")
    if (folder.isNotEmpty()) root.addView(textLabel(folder, 12f, true).apply {
        maxLines = 2; ellipsize = TextUtils.TruncateAt.END; contentDescription = "Folder: $folder · tap filename for the full path"
    })
    root.addView(textLabel("− ${parsed.removed} removed     + ${parsed.added} added", 13f, true))
    root.addView(textLabel("Line numbers: before → after · swipe sideways for long lines", 11f, true))
    val code = textLabel("", 13f).apply {
        typeface = Typeface.MONOSPACE; setTextIsSelectable(true); setHorizontallyScrolling(true)
        setPadding(dp(12), dp(12), dp(20), dp(16)); setLineSpacing(dp(3).toFloat(), 1f)
        minimumWidth = resources.displayMetrics.widthPixels - dp(40)
        text = diffReaderText(parsed); id = R.id.diff_code
        setBackgroundColor(PocketColors.panel)
    }
    val tools = LinearLayout(this)
    var raw = false
    lateinit var toggle: Button
    toggle = actionButton("Raw patch") {
        raw = !raw; toggle.text = if (raw) "Readable diff" else "Raw patch"
        code.text = if (raw) coloredDiff(patch) else diffReaderText(parsed)
    }
    tools.addView(toggle, LinearLayout.LayoutParams(0, -2, 1f))
    tools.addView(actionButton("Copy patch") {
        (getSystemService(Activity.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(path, patch))
        Toast.makeText(this, "Original patch copied", Toast.LENGTH_SHORT).show()
    }, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(8) })
    root.addView(tools, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10); bottomMargin = dp(12) })
    val horizontal = HorizontalScrollView(this).apply { isFillViewport = true; addView(code) }
    root.addView(ScrollView(this).apply { isFillViewport = true; addView(horizontal) }, LinearLayout.LayoutParams(-1, 0, 1f))
    dialog.setContentView(root); dialog.setOnDismissListener { fileDetails?.dismiss(); onDismiss() }
    dialog.show()
    dialog.window?.apply {
        setBackgroundDrawable(ColorDrawable(PocketColors.background))
        statusBarColor = PocketColors.background; navigationBarColor = PocketColors.background
        setLayout(-1, -1)
    }
    return dialog
}
