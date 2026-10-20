package dev.fantasticpimobile

import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Visible Activity tests: run only after agreement, and only in the fixture sandbox. */
@RunWith(AndroidJUnit4::class)
class ProjectPickerUiTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun await(check: () -> Boolean) {
        val until = System.nanoTime() + TimeUnit.SECONDS.toNanos(15)
        while (System.nanoTime() < until) { if (check()) return; Thread.sleep(100) }
        fail("Timed out waiting for fixture picker state")
    }
    private fun nodes(view: View): List<View> = listOf(view) + if (view is ViewGroup)
        (0 until view.childCount).flatMap { nodes(view.getChildAt(it)) } else emptyList()
    private fun click(text: String) {
        var found: android.view.accessibility.AccessibilityNodeInfo? = null
        await {
            val root = instrumentation.uiAutomation.rootInActiveWindow
            found = if (root?.packageName?.toString() == "dev.fantasticpimobile.reliability")
                root.findAccessibilityNodeInfosByText(text).firstOrNull { it.isClickable && it.isVisibleToUser } else null
            found != null
        }
        assertTrue("Clickable fixture action: $text", found!!.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK))
        instrumentation.waitForIdleSync()
    }
    private fun visible(text: String): Boolean = instrumentation.uiAutomation.rootInActiveWindow
        ?.findAccessibilityNodeInfosByText(text)?.isNotEmpty() == true

    private class Fixture : AutoCloseable {
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val pool = Executors.newCachedThreadPool()
        val posts = AtomicInteger()
        @Volatile var version = 5
        @Volatile var empty = false
        @Volatile var offline = false
        @Volatile var bound = false
        fun project(id: String) = JSONObject().put("projectId", id).put("name", "Fixture $id")
            .put("source", "/fixture/$id").put("branchPolicy", JSONObject().put("kind", "local").put("branch", "trunk"))
        init {
            pool.execute {
                try {
                    while (!server.isClosed) {
                        val client = server.accept()
                        pool.execute {
                            client.use { socket ->
                                socket.soTimeout = 5000
                                val reader = socket.getInputStream().bufferedReader()
                                val first = reader.readLine().orEmpty(); var length = 0
                                while (true) {
                                    val line = reader.readLine().orEmpty(); if (line.isEmpty()) break
                                    if (line.startsWith("Content-Length:", true)) length = line.substringAfter(':').trim().toInt()
                                }
                                if (length > 0) { val body = CharArray(length); var offset = 0; while (offset < length) { val n = reader.read(body, offset, length - offset); if (n < 0) break; offset += n } }
                                if (first.startsWith("POST")) posts.incrementAndGet()
                                val path = first.split(' ').getOrNull(1).orEmpty()
                                val code = when { offline -> 503; path.endsWith("/project") && !bound -> 404; else -> 200 }
                                val value = when {
                                    code != 200 -> JSONObject().put("error", "Fixture unavailable")
                                    path == "/health" -> JSONObject().put("protocolVersion", version).put("projectBindings", true)
                                    path == "/v1/projects" && first.startsWith("POST") -> project("registered")
                                    path == "/v1/projects" -> JSONObject().put("projects", if (empty) JSONArray() else JSONArray().put(project("alpha")).put(project("beta")))
                                    path.endsWith("/project") -> JSONObject().put("sessionId", "fixture-chat").put("projectId", "beta")
                                    else -> JSONObject().put("projectId", "beta").put("hasChanges", false)
                                }
                                val bytes = value.toString().toByteArray()
                                socket.getOutputStream().apply {
                                    write("HTTP/1.1 $code Fixture\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray()); write(bytes); flush()
                                }
                            }
                        }
                    }
                } catch (_: SocketException) { /* cleanup */ }
            }
        }
        override fun close() { server.close(); pool.shutdownNow() }
    }
    private fun scenario(test: (Fixture, MainActivity, () -> MainActivity) -> Unit) {
        val context = instrumentation.targetContext
        assumeTrue(context.packageName == "dev.fantasticpimobile.reliability")
        Fixture().use { fixture ->
            context.deleteDatabase("fantastic-pi-mobile.sqlite")
            History(context).use { it.writableDatabase.execSQL("UPDATE sessions SET id='fixture-chat' WHERE id='pocket'") }
            context.getSharedPreferences("chat-ui", 0).edit().putString("selected", "fixture-chat").commit()
            Connection(context).save("http://127.0.0.1:${fixture.server.localPort}", "fixture-only-project-token-00000000")
            val activities = mutableListOf<MainActivity>()
            fun launch(): MainActivity = (instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity).also { activities.add(it) }
            try { test(fixture, launch(), ::launch) }
            finally { instrumentation.runOnMainSync { activities.forEach { it.finish() } }; instrumentation.waitForIdleSync() }
        }
    }
    @Test fun choosePersistReopenAndLockEstablishedProject() = scenario { fixture, activity, reopen ->
        click("Choose project before Send")
        await { visible("Fixture beta") }
        click("Fixture beta")
        History(instrumentation.targetContext).use { history ->
            assertEquals("beta", history.session("fixture-chat")!!.projectId)
            assertEquals(ProjectState.SELECTED, history.session("fixture-chat")!!.projectState)
            history.add("saved-request", "fixture-chat", "Already accepted fixture request")
            history.update("saved-request", "done", "Fixture done")
            history.confirmProject("fixture-chat", "beta")
        }
        fixture.bound = true
        instrumentation.runOnMainSync { activity.finish() }
        instrumentation.waitForIdleSync()
        reopen()
        await { visible("locked") }
        click("Project ·")
        await { visible("Established chats cannot switch") }
        assertFalse(visible("Register trusted project"))
        assertEquals(0, fixture.posts.get())
        History(instrumentation.targetContext).use { assertEquals("beta", it.session("fixture-chat")!!.projectId) }
    }
    @Test fun emptyOldAndUnavailableBridgeKeepDraftUnbound() = scenario { fixture, activity, _ ->
        fixture.empty = true
        click("Choose project before Send")
        await { visible("No registered projects") }
        click("Close")
        fixture.version = 4
        click("Choose project before Send")
        await { visible("Update the bridge") }
        assertFalse(visible("Register trusted project"))
        fixture.version = 5; fixture.offline = true
        click("Retry")
        await { visible("Fixture unavailable") }
        assertEquals(0, fixture.posts.get())
        History(instrumentation.targetContext).use { assertNull(it.session("fixture-chat")!!.projectId) }
        instrumentation.runOnMainSync { assertTrue(nodes(activity.window.decorView).filterIsInstance<EditText>().isNotEmpty()) }
    }
    @Test fun registrationRequiresReviewThenExplicitConfirmationAndDoesNotSend() = scenario { fixture, _, _ ->
        click("Choose project before Send"); await { visible("Register trusted project") }; click("Register trusted project")
        fun fill(label: String, value: String) {
            val node = instrumentation.uiAutomation.rootInActiveWindow.findAccessibilityNodeInfosByText(label).first()
            val args = android.os.Bundle().apply { putCharSequence(android.view.accessibility.AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value) }
            assertTrue(node.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_SET_TEXT, args))
        }
        fill("Project name", "Registered fixture"); fill("Absolute checkout path", "/fixture/new"); fill("Branch or remote name", "trunk")
        click("Review registration"); await { visible("Trust this repository?") }
        assertEquals(0, fixture.posts.get())
        click("Confirm trusted registration"); await { visible("Register trusted project") }
        assertEquals(1, fixture.posts.get())
        History(instrumentation.targetContext).use { assertNull(it.session("fixture-chat")!!.projectId); assertTrue(it.jobs("fixture-chat").isEmpty()) }
    }
}
