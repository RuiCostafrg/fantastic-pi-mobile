package dev.pipocket

import android.content.Intent
import android.content.res.Configuration
import android.view.ContextThemeWrapper
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LayoutTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    @Test fun longMergeLabelsCanGrowInTheActualReviewScreen() {
        val context = instrumentation.targetContext
        val activity = instrumentation.startActivitySync(Intent(context, ChangesActivity::class.java)
            .putExtra("sessionId", "pocket").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        try {
            instrumentation.runOnMainSync {
                val field = ChangesActivity::class.java.getDeclaredField("merge").apply { isAccessible = true }
                val button = field.get(activity) as Button
                button.text = "Merge into local a-very-long-default-branch-for-review"
                val spec = if (button.layoutParams.height > 0)
                    View.MeasureSpec.makeMeasureSpec(button.layoutParams.height, View.MeasureSpec.EXACTLY)
                    else View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
                button.measure(View.MeasureSpec.makeMeasureSpec(context.dp(220), View.MeasureSpec.EXACTLY), spec)
                button.layout(0, 0, button.measuredWidth, button.measuredHeight)
                assertEquals("Review text actions must grow, not have a fixed 48dp height", ViewGroup.LayoutParams.WRAP_CONTENT, button.layoutParams.height)
                assertTrue("Long merge label is vertically cropped", button.layout.height + button.compoundPaddingTop + button.compoundPaddingBottom <= button.height)
                assertEquals(0, button.layout.getEllipsisCount(button.layout.lineCount - 1))
            }
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test fun fullScreenDiffKeepsLongCodeOnOneLineAndRawPatchExact() {
        val context = instrumentation.targetContext
        val activity = instrumentation.startActivitySync(Intent(context, ChangesActivity::class.java)
            .putExtra("sessionId", "pocket").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as ChangesActivity
        var dialog: android.app.Dialog? = null
        val patch = "@@ -1 +1 @@\n-old\n+" + "x".repeat(250) + "END_OF_LONG_LINE\n"
        try {
            instrumentation.runOnMainSync { dialog = activity.openDiffViewer("src/ReadablePreferencesScreen.kt", patch) {} }
            instrumentation.waitForIdleSync()
            instrumentation.runOnMainSync {
                val root = dialog!!.window!!.decorView
                fun nodes(view: View): List<View> = listOf(view) + if (view is ViewGroup) (0 until view.childCount).flatMap { nodes(view.getChildAt(it)) } else emptyList()
                val views = nodes(root)
                val code = views.filterIsInstance<TextView>().first { it.id == R.id.diff_code }
                assertTrue("Long code must scroll horizontally", code.width > root.width)
                assertEquals("Code was soft-wrapped", code.text.count { it == '\n' } + 1, code.layout.lineCount)
                assertTrue(code.text.contains("END_OF_LONG_LINE"))
                views.filterIsInstance<Button>().first { it.text == "Raw patch" }.performClick()
                assertEquals(patch, code.text.toString())
            }
        } finally { instrumentation.runOnMainSync { dialog?.dismiss(); activity.finish() } }
    }

    @Test fun longPathsAndActionsFitAt320dpAnd200PercentFont() {
        instrumentation.runOnMainSync {
            val base = instrumentation.targetContext
            val config = Configuration(base.resources.configuration).apply { fontScale = 2f }
            val context = ContextThemeWrapper(base.createConfigurationContext(config), R.style.Theme_PiPocket)
            val filename = "VeryLongHumanReadableSettingsAndConnectionPreferencesScreen.kt"
            val row = context.reviewFileRow("app/src/main/java/dev/pipocket/$filename", " M", "working", true, false, {}, {})
            row.measure(View.MeasureSpec.makeMeasureSpec(context.dp(320), View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
            row.layout(0, 0, row.measuredWidth, row.measuredHeight)
            fun check(view: View) {
                if (view is TextView && view.text.isNotEmpty() && view.layout != null) {
                    assertTrue("Text vertically cropped", view.layout.height + view.compoundPaddingTop + view.compoundPaddingBottom <= view.height)
                    assertEquals("Text unexpectedly ellipsized", 0, view.layout.getEllipsisCount(view.layout.lineCount - 1))
                }
                if (view is ViewGroup) for (i in 0 until view.childCount) check(view.getChildAt(i))
            }
            check(row)
            assertTrue(row.height > context.dp(100))
            val action = context.actionButton("Commit 12 selected files to this chat") {}
            action.measure(View.MeasureSpec.makeMeasureSpec(context.dp(240), View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
            action.layout(0, 0, action.measuredWidth, action.measuredHeight)
            check(action); assertTrue(action.height >= context.dp(48))
            val icon = context.iconButton("menu", "Open chats") {}
            assertTrue(icon.minimumWidth >= context.dp(48)); assertTrue(icon.minimumHeight >= context.dp(48))
        }
    }
}
