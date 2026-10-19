package dev.fantasticpimobile

import android.content.Context
import android.graphics.Typeface
import android.view.Gravity
import android.widget.CheckBox
import android.widget.LinearLayout

/** Filename first, folder second. No filename truncation or fixed row heights. */
fun Context.reviewFileRow(path: String, status: String, scope: String, selectable: Boolean, checked: Boolean,
                          onSelected: (Boolean) -> Unit, onOpen: () -> Unit): LinearLayout {
    val row = LinearLayout(this).apply {
        gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(64)
        setPadding(dp(8), dp(10), dp(14), dp(10))
        background = rounded(FantasticPiMobileColors.panel, dp(12).toFloat())
        isClickable = true; isFocusable = true; contentDescription = "View $scope diff: $path"
        setOnClickListener { onOpen() }
    }
    if (scope == "working" && selectable) row.addView(CheckBox(this).apply {
        contentDescription = "Select file: $path"; isChecked = checked; isEnabled = selectable
        buttonTintList = android.content.res.ColorStateList.valueOf(FantasticPiMobileColors.accent)
        minimumWidth = dp(48); minimumHeight = dp(48)
        setOnCheckedChangeListener { _, value -> onSelected(value) }
    }, LinearLayout.LayoutParams(dp(48), dp(48)))
    val labels = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(8), 0, 0, 0) }
    labels.addView(textLabel(path.substringAfterLast('/'), 16f).apply { setTypeface(typeface, Typeface.BOLD) })
    val folder = path.substringBeforeLast('/', "")
    if (folder.isNotEmpty()) labels.addView(textLabel(folder, 12f, true))
    val staging = if (scope != "working" || status.length != 2 || status == "??" || status[0] == ' ') ""
        else if (status[1] == ' ') " · staged" else " · staged & edited"
    labels.addView(textLabel(fileStatusLabel(status) + staging, 12f, true).apply {
        if (fileStatusLabel(status) == "Added") setTextColor(FantasticPiMobileColors.added)
        if (fileStatusLabel(status) == "Deleted" || fileStatusLabel(status) == "Conflict") setTextColor(FantasticPiMobileColors.removed)
    })
    row.addView(labels, LinearLayout.LayoutParams(0, -2, 1f))
    return row
}
