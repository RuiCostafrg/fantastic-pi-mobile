package dev.pipocket

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.widget.Button
import android.widget.TextView

object PocketColors {
    val background = Color.rgb(14, 18, 29)
    val panel = Color.rgb(23, 29, 44)
    val card = Color.rgb(29, 38, 56)
    val accent = Color.rgb(176, 185, 255)
    val text = Color.rgb(235, 239, 250)
    val muted = Color.rgb(164, 176, 200)
}
fun Context.dp(n: Int) = (n * resources.displayMetrics.density).toInt()
fun rounded(color: Int, radius: Float = 18f) = GradientDrawable().apply { setColor(color); cornerRadius = radius }
fun Context.textLabel(text: String, size: Float = 15f, muted: Boolean = false) = TextView(this).apply {
    this.text = text; textSize = size; setTextColor(if (muted) PocketColors.muted else PocketColors.text)
    setPadding(0, dp(5), 0, dp(5))
}
fun Context.actionButton(text: String, description: String = text, action: () -> Unit) = Button(this).apply {
    this.text = text; contentDescription = description; isAllCaps = false
    minWidth = 0; minimumWidth = 0; minHeight = dp(48); minimumHeight = dp(48)
    setTextColor(PocketColors.accent); textSize = 14f; setTypeface(typeface, Typeface.BOLD)
    background = rounded(PocketColors.card, dp(14).toFloat())
    setOnClickListener { action() }
}
