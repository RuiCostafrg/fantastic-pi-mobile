package dev.fantasticpimobile

import android.content.Intent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.net.ServerSocket
import java.net.SocketException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Exercises real activity + HTTP + saved history, only in the separate fixture sandbox. */
@RunWith(AndroidJUnit4::class)
class LiveStatusUiTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun texts(node: AccessibilityNodeInfo?): List<String> {
        if (node == null) return emptyList()
        return listOfNotNull(node.text?.toString()) + (0 until node.childCount).flatMap { texts(node.getChild(it)) }
    }
    private fun labels() = texts(instrumentation.uiAutomation.rootInActiveWindow)
    private fun await(label: String, predicate: () -> Boolean) {
        val until = System.nanoTime() + TimeUnit.SECONDS.toNanos(15)
        while (System.nanoTime() < until) { if (predicate()) return; Thread.sleep(100) }
        val root = instrumentation.uiAutomation.rootInActiveWindow
        val detail = if (root?.packageName?.toString() == "dev.fantasticpimobile.reliability") texts(root).joinToString(" | ") else "foreground package: ${root?.packageName}"
        fail("Timed out: $label; fixture UI: $detail")
    }
    @Test fun cachedApprovalWaitsForLiveEvidenceAndDisappearsWhenInterrupted() {
        val context = instrumentation.targetContext
        assumeTrue(context.packageName == "dev.fantasticpimobile.reliability")
        val server = ServerSocket(0, 8, java.net.InetAddress.getByName("127.0.0.1"))
        val pool = Executors.newCachedThreadPool()
        val gate = CountDownLatch(1)
        val available = AtomicBoolean(false)
        val interrupted = AtomicBoolean(false)
        pool.execute {
            try {
                while (!server.isClosed) {
                    val client = server.accept()
                    pool.execute {
                        client.use { socket ->
                            socket.soTimeout = 5000
                            val reader = socket.getInputStream().bufferedReader()
                            val requestLine = reader.readLine().orEmpty()
                            while (!reader.readLine().isNullOrEmpty()) { /* GET only; no content logged. */ }
                            val jobRequest = requestLine.contains("/v1/jobs/saved-approval ")
                            if (jobRequest) gate.await(10, TimeUnit.SECONDS)
                            val code = if (available.get()) 200 else 503
                            val body = when {
                                !available.get() -> "{\"error\":\"Fixture offline\"}"
                                !jobRequest -> "{\"hasChanges\":false}"
                                interrupted.get() -> "{\"id\":\"saved-approval\",\"sessionId\":\"pocket\",\"status\":\"interrupted\",\"answer\":\"Not replayed\"}"
                                else -> "{\"id\":\"saved-approval\",\"sessionId\":\"pocket\",\"status\":\"running\",\"pending\":{\"id\":\"approval\",\"method\":\"confirm\",\"title\":\"Fixture approval\"}}"
                            }
                            val bytes = body.toByteArray(Charsets.UTF_8)
                            socket.getOutputStream().apply {
                                write("HTTP/1.1 $code Fixture\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                                write(bytes); flush()
                            }
                        }
                    }
                }
            } catch (_: SocketException) { /* listener closed by cleanup */ }
        }
        var activity: MainActivity? = null
        try {
            context.deleteDatabase("fantastic-pi-mobile.sqlite")
            History(context).use { history ->
                history.add("saved-approval", "pocket", "Fixture request")
                history.update("saved-approval", "running", "", "Working", "{\"id\":\"approval\",\"method\":\"confirm\",\"title\":\"Old approval\"}")
            }
            context.getSharedPreferences("chat-ui", 0).edit().putString("selected", "pocket").commit()
            Connection(context).save("http://127.0.0.1:${server.localPort}", "fixture-only-test-token-00000000000")
            activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            await("checking saved status") { labels().any { it.contains("CHECKING STATUS") } }
            assertFalse("Cached approval opened before verification", labels().any { it.equals("Allow", ignoreCase = true) })
            gate.countDown()
            await("unknown status after connection failure") { labels().any { it.contains("STATUS UNKNOWN") } }
            assertFalse("Unavailable approval must not be actionable", labels().any { it.equals("Allow", ignoreCase = true) })
            available.set(true)
            await("fresh approval") { labels().any { it.equals("Allow", ignoreCase = true) } }
            interrupted.set(true)
            await("interrupted result replaces live approval") { labels().any { it.contains("PI · INTERRUPTED") } }
            assertFalse(labels().any { it.equals("Allow", ignoreCase = true) })
            History(context).use { history ->
                val job = history.jobs("pocket").single()
                assertEquals("saved-approval", job.id)
                assertEquals("interrupted", job.status)
                assertEquals("", job.pending)
            }
        } finally {
            gate.countDown()
            activity?.let { current -> instrumentation.runOnMainSync { current.finish() } }
            server.close(); pool.shutdownNow()
        }
    }
}
