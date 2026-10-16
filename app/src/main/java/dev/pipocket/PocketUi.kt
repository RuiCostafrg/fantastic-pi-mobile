package dev.pipocket

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.Gravity
import android.widget.Button
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView

/** Calm, Catppuccin Mocha-inspired surfaces; color is never the only change indicator. */
object PocketColors {
    val background = Color.rgb(30, 30, 46)
    val panel = Color.rgb(24, 24, 37)
    val card = Color.rgb(49, 50, 68)
    val accent = Color.rgb(180, 190, 254)
    val text = Color.rgb(205, 214, 244)
    val muted = Color.rgb(166, 173, 200)
    val added = Color.rgb(166, 227, 161)
    val removed = Color.rgb(243, 139, 168)
    val addedBackground = Color.rgb(39, 57, 46)
    val removedBackground = Color.rgb(64, 39, 51)
}
fun Context.dp(n: Int) = (n * resources.displayMetrics.density).toInt()
fun rounded(color: Int, radius: Float = 18f) = GradientDrawable().apply { setColor(color); cornerRadius = radius }
fun Context.textLabel(text: String, size: Float = 15f, muted: Boolean = false) = TextView(this).apply {
    this.text = text; textSize = size; setTextColor(if (muted) PocketColors.muted else PocketColors.text)
    setPadding(0, dp(5), 0, dp(5)); setLineSpacing(dp(2).toFloat(), 1f)
}
/** Use wrap-content height at call sites: 48dp is a touch minimum, not a text-height cap. */
fun Context.actionButton(text: String, description: String = text, action: () -> Unit) = Button(this).apply {
    this.text = text; contentDescription = description; isAllCaps = false
    minWidth = 0; minimumWidth = 0; minHeight = dp(48); minimumHeight = dp(48)
    setPadding(dp(16), dp(10), dp(16), dp(10)); maxLines = Int.MAX_VALUE
    gravity = Gravity.CENTER; includeFontPadding = true
    setTextColor(PocketColors.accent); textSize = 14f; setTypeface(typeface, Typeface.BOLD)
    background = RippleDrawable(ColorStateList.valueOf(0x22b4befe), rounded(PocketColors.card, dp(12).toFloat()), null)
    stateListAnimator = null
    setOnClickListener { action() }
}
fun Context.iconButton(icon: String, description: String, action: () -> Unit) = ImageButton(this).apply {
    contentDescription = description; minimumWidth = dp(48); minimumHeight = dp(48)
    setPadding(dp(12), dp(12), dp(12), dp(12))
    setImageDrawable(ToolbarIcon(icon))
    background = RippleDrawable(ColorStateList.valueOf(0x22b4befe), rounded(Color.TRANSPARENT, dp(12).toFloat()), null)
    setOnClickListener { action() }
}
fun Context.sectionCard() = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(14))
    background = rounded(PocketColors.panel, dp(14).toFloat())
}
fun Context.dialogField(view: android.view.View) = android.widget.FrameLayout(this).apply {
    setPadding(dp(24), dp(8), dp(24), dp(8))
    addView(view, android.widget.FrameLayout.LayoutParams(-1, -2))
}
/** Vector strokes, not font glyphs: toolbar icons do not clip or change at large font scales. */
private class ToolbarIcon(private val icon: String) : Drawable() {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = PocketColors.text; strokeWidth = 1.8f; style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    override fun draw(canvas: Canvas) {
        canvas.save(); canvas.translate(bounds.left.toFloat(), bounds.top.toFloat()); canvas.scale(bounds.width() / 24f, bounds.height() / 24f)
        when (icon) {
            "menu" -> for (y in listOf(6f, 12f, 18f)) canvas.drawLine(4f, y, 20f, y, paint)
            "add" -> { canvas.drawLine(12f, 5f, 12f, 19f, paint); canvas.drawLine(5f, 12f, 19f, 12f, paint) }
            "more" -> { paint.style = Paint.Style.FILL; for (y in listOf(5f, 12f, 19f)) canvas.drawCircle(12f, y, 1.6f, paint); paint.style = Paint.Style.STROKE }
            "back" -> { canvas.drawLine(5f, 12f, 20f, 12f, paint); canvas.drawPath(Path().apply { moveTo(11f, 5f); lineTo(4f, 12f); lineTo(11f, 19f) }, paint) }
            "refresh" -> { canvas.drawArc(4f, 4f, 20f, 20f, 40f, 285f, false, paint); canvas.drawPath(Path().apply { moveTo(15f, 3f); lineTo(20f, 6f); lineTo(15f, 8f) }, paint) }
        }
        canvas.restore()
    }
    override fun setAlpha(alpha: Int) { paint.alpha = alpha }
    override fun setColorFilter(colorFilter: ColorFilter?) { paint.colorFilter = colorFilter }
    @Deprecated("Deprecated in Android") override fun getOpacity() = PixelFormat.TRANSLUCENT
}
