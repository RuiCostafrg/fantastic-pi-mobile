package dev.fantasticpimobile

import android.app.AlertDialog
import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

/** Explicitly authorized visible fixture only, against the disposable real B08 Node owner. */
@RunWith(AndroidJUnit4::class)
class SharedConversationsUiTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun await(label: String, check: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(25)
        while (System.nanoTime() < deadline) { if (check()) return; Thread.sleep(100) }
        fail("Timed out: $label")
    }
    private fun descendants(view: View): List<View> = listOf(view) + if (view is ViewGroup)
        (0 until view.childCount).flatMap { descendants(view.getChildAt(it)) } else emptyList()
    private fun nodes(activity: MainActivity): List<View> {
        var result: List<View> = emptyList()
        instrumentation.runOnMainSync { result = descendants(activity.window.decorView) }
        return result
    }
    private fun has(activity: MainActivity, text: String) = nodes(activity).any { it is TextView && it.text.contains(text) }
    private fun click(label: String) {
        fun find(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
            if (node == null) return null
            if (node.isClickable && node.isVisibleToUser && node.isEnabled &&
                (node.text?.toString()?.contains(label, ignoreCase = true) == true || node.contentDescription?.toString() == label)) return node
            for (i in 0 until node.childCount) find(node.getChild(i))?.let { return it }
            return null
        }
        var target: AccessibilityNodeInfo? = null
        await("fixture clickable $label") {
            val root = instrumentation.uiAutomation.rootInActiveWindow
            target = if (root?.packageName?.toString() == "dev.fantasticpimobile.reliability") find(root) else null
            target != null
        }
        assertTrue(target!!.performAction(AccessibilityNodeInfo.ACTION_CLICK))
        instrumentation.waitForIdleSync()
    }
    private fun open(label: String) { click("Open chats"); click("Open chat: $label") }
    @Test fun liveDiscoverySendApprovalStopAndReopenPreserveLocalState() {
        val context = instrumentation.targetContext
        assumeTrue(context.packageName == "dev.fantasticpimobile.reliability")
        val args = InstrumentationRegistry.getArguments()
        val endpoint = args.getString("endpoint")!!; val project = args.getString("projectId")!!
        require(endpoint.startsWith("http://127.0.0.1:"))
        context.deleteDatabase("fantastic-pi-mobile.sqlite")
        History(context).use { h ->
            h.selectProject("pocket", project); h.saveDraft("pocket", "KEEP_LOCAL_DRAFT")
            h.ensureRemoteSession("archived-remote", project)
            h.add("local-ui-history", "archived-remote", "Prior local history")
            h.update("local-ui-history", "done", "Prior local answer")
            h.rename("archived-remote", "Preserved archived title")
            h.saveDraft("archived-remote", "KEEP_ARCHIVED_DRAFT"); h.pin("archived-remote", true)
            h.setFinished("archived-remote", true); h.setArchived("archived-remote", true)
        }
        context.getSharedPreferences("chat-ui", 0).edit().putString("selected", "pocket").commit()
        val reviews = context.getSharedPreferences("review-requests", 0)
        val review = "{\"operationId\":\"keep-original-operation\",\"action\":\"test\",\"command\":\"never execute\"}"
        reviews.edit().putString("pending-preserved-other-chat", review).commit()
        val connection = Connection(context); connection.save(endpoint, "b08-isolated-fixture-token-000000000000")
        val identity = connection.identity
        val activities = mutableListOf<MainActivity>()
        fun launch() = (instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity).also { activities.add(it) }
        var activity = launch()
        try {
            await("shared foreground sync") { has(activity, "Shared conversations · up to date") }
            assertTrue(nodes(activity).filterIsInstance<EditText>().any { it.text.toString() == "KEEP_LOCAL_DRAFT" })
            open("Chat remote-finis")
            await("remote completed result") { has(activity, "B08_FIXTURE_RESULT") }
            assertEquals(1, nodes(activity).filterIsInstance<TextView>().count { it.text.contains("B08_FIXTURE_RESULT") })
            History(context).use { assertTrue(it.jobs("remote-finished").isEmpty()); assertEquals("KEEP_LOCAL_DRAFT", it.session("pocket")!!.draft) }
            instrumentation.runOnMainSync { activity.finish() }; instrumentation.waitForIdleSync()
            activity = launch()
            await("same remote result after reopen") { has(activity, "B08_FIXTURE_RESULT") }
            assertEquals("remote-finished", context.getSharedPreferences("chat-ui", 0).getString("selected", null))
            open("Main chat")
            await("enabled new shared Send") { nodes(activity).filterIsInstance<Button>().any { it.text.toString() == "Send" && it.isEnabled } }
            instrumentation.runOnMainSync { descendants(activity.window.decorView).filterIsInstance<EditText>().single { it.contentDescription == "Message this chat" }.setText("remote") }
            click("Send")
            await("native Send persisted and completed") { History(context).use { it.jobs("pocket").singleOrNull()?.status == "done" } }
            await("native Send canonical result") { has(activity, "B08_FIXTURE_RESULT") }
            open("Preserved archived title") // Still discoverable in the main drawer despite archive flag.
            await("remote active Stop") { nodes(activity).filterIsInstance<Button>().any { it.contentDescription == "Stop this chat" && it.isEnabled } }
            assertFalse(nodes(activity).filterIsInstance<Button>().first { it.text.toString() == "Send" }.isEnabled)
            click("Stop this chat")
            await("exact run cancelled") { has(activity, "CANCELLED") }
            History(context).use { h ->
                val saved = h.session("archived-remote")!!
                assertEquals("Preserved archived title", saved.title); assertEquals("KEEP_ARCHIVED_DRAFT", saved.draft)
                assertTrue(saved.archived); assertTrue(saved.finished); assertTrue(saved.pinned)
            }
            open("Chat approval-rem")
            click("Allow") // Fixture drops the response after the owner records/delivers the exact answer.
            await("approval completes without retry") { has(activity, "B08_APPROVED_RESULT") }
            instrumentation.runOnMainSync { activity.finish() }; instrumentation.waitForIdleSync()
            activity = launch()
            await("approval result preserved after reopen") { has(activity, "B08_APPROVED_RESULT") }
            assertEquals(identity, connection.identity)
            assertEquals(review, reviews.getString("pending-preserved-other-chat", null))
        } finally {
            instrumentation.runOnMainSync { activities.forEach { it.finish() } }; instrumentation.waitForIdleSync()
            reviews.edit().remove("pending-preserved-other-chat").commit()
        }
    }
}
