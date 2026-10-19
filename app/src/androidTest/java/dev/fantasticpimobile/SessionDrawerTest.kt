package dev.fantasticpimobile

import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SessionDrawerTest {
    private fun onMain(test: () -> Unit) {
        var failure: Throwable? = null
        InstrumentationRegistry.getInstrumentation().runOnMainSync { try { test() } catch (error: Throwable) { failure = error } }
        failure?.let { throw it }
    }
    private fun views(view: View): List<View> = listOf(view) + if (view is ViewGroup)
        (0 until view.childCount).flatMap { views(view.getChildAt(it)) } else emptyList()
    private fun labels(view: View) = views(view).filterIsInstance<TextView>().map { it.text.toString() }
    private fun drawer() = SessionDrawer(InstrumentationRegistry.getInstrumentation().targetContext,
        {}, {}, {}, {}, { _, _ -> }, { _, _ -> }, {})
    @Test fun sectionsPrioritizeAttentionOverWorkingAndPinsDoNotOverrideHierarchy() = onMain {
        val drawer = drawer()
        drawer.render(listOf(
            ChatSession("finished", "Finished task", "", true, 5L, "done", false, finished = true),
            ChatSession("working", "Working task", "", false, 4L, "running", false),
            ChatSession("approval", "Approval task", "", false, 3L, "running", true),
            ChatSession("ready", "Ready task", "", false, 2L, "done", false),
            ChatSession("new", "Fresh task", "", false, 1L, null, false)
        ), "working")
        val labels = labels(drawer)
        val headings = labels.filter { it in ChatSection.entries.map { section -> section.heading } }
        assertEquals(listOf("NEW CHATS", "NEEDS ATTENTION", "WORKING", "FINISHED"), headings)
        assertTrue(labels.indexOf("Fresh task") < labels.indexOf("Approval task"))
        assertTrue(labels.indexOf("Approval task") < labels.indexOf("Working task"))
        assertTrue(labels.indexOf("Working task") < labels.indexOf("◆ Finished task"))
        assertTrue(labels.contains("Reply ready · review or mark finished"))
        assertTrue(labels.contains("◉ Your feedback needed"))
        val working = views(drawer).filterIsInstance<TextView>().single { it.text.toString() == "Working task" }
        assertEquals(FantasticPiMobileColors.muted, working.currentTextColor)
        assertTrue(working.parent.let { it as View }.isEnabled)
    }
    @Test fun unverifiedWorkIsAttentionNotAWorkingOrApprovalClaim() = onMain {
        val drawer = drawer()
        val sessions = listOf(ChatSession("a", "Saved approval", "", false, 1L, "running", true))
        drawer.render(sessions, "a", mapOf("a" to RequestState.UNAVAILABLE))
        assertTrue(labels(drawer).contains("NEEDS ATTENTION"))
        assertTrue(labels(drawer).contains("! Status unknown · check connection"))
        assertFalse(labels(drawer).contains("WORKING"))
        assertFalse(labels(drawer).contains("◉ Your feedback needed"))
        drawer.render(sessions, "a", mapOf("a" to RequestState.CURRENT))
        assertTrue(labels(drawer).contains("◉ Your feedback needed"))
        drawer.render(sessions, "a", mapOf("a" to RequestState.CHECKING))
        assertTrue(labels(drawer).contains("◌ Checking saved request"))
        assertFalse(labels(drawer).contains("◉ Your feedback needed"))
    }
    @Test fun archiveViewHidesNormalChatsAndMainViewHidesArchivedChats() = onMain {
        val drawer = drawer()
        drawer.render(listOf(
            ChatSession("visible", "Visible task", "", false, 2L, null, false),
            ChatSession("archived", "Archived task", "", false, 1L, "done", false, finished = true, archived = true)
        ), "visible")
        assertTrue(labels(drawer).contains("Visible task"))
        assertFalse(labels(drawer).contains("Archived task"))
        views(drawer).single { it.contentDescription == "Open archive" }.performClick()
        assertTrue(labels(drawer).contains("Archived task"))
        assertFalse(labels(drawer).contains("Visible task"))
        assertTrue(labels(drawer).contains("✓ Finished · archived"))
        views(drawer).single { it.contentDescription == "Back to chats" }.performClick()
        assertTrue(labels(drawer).contains("Visible task"))
        assertFalse(labels(drawer).contains("Archived task"))
    }
}
