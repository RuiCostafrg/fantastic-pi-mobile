package dev.fantasticpimobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Headless phases driven ONLY by check-project-lifecycle.py; each instrumentation
 * invocation is a different client process. No Activity, provider or production state. */
@RunWith(AndroidJUnit4::class)
class ProjectLifecycleTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val ui get() = context.getSharedPreferences("chat-ui", 0)
    private val reviews get() = context.getSharedPreferences("review-requests", 0)
    private val ids = listOf("lifecycle-project-a", "lifecycle-project-b")
    private fun job(history: History, id: String) = history.sessions().flatMap { history.jobs(it.id) }.single { it.id == id }
    private fun await(action: () -> Boolean) {
        val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
        while (System.nanoTime() < end) { if (action()) return; Thread.sleep(50) }
        fail("Project lifecycle fixture phase timed out")
    }
    private fun failure(action: () -> Unit): Exception {
        try { action() } catch (error: Exception) { return error }
        throw AssertionError("Expected request failure")
    }
    private fun client(connection: Connection): ProjectRequests {
        val endpoint = connection.endpoint
        return ProjectRequests { path, body -> connection.requestAt(endpoint, path, body) }
    }
    private fun checkSaved(history: History, connection: Connection): String {
        val selected = ui.getString("selected", null)!!
        assertEquals("Unsent B draft", history.session(selected)!!.draft)
        assertTrue(connection.paired)
        val a = job(history, ids[0]); val b = job(history, ids[1])
        assertEquals("CONFIRM_A", a.text); assertEquals("HOLD_B", b.text)
        assertEquals("pocket", a.sessionId); assertEquals(selected, b.sessionId)
        assertNotEquals(a.projectId, b.projectId)
        for (value in listOf(a, b)) assertEquals(value.projectId, history.session(value.sessionId)!!.projectId)
        return selected
    }
    private fun cancelThird(history: History, connection: Connection, api: ProjectRequests, project: String) {
        val chat = history.createSession(); history.selectProject(chat, project)
        history.add("lifecycle-cancel-b", chat, "CANCEL_B")
        val cancel = job(history, "lifecycle-cancel-b")
        history.acceptResponse(cancel.id, api.fetch(cancel, cancel.projectId))
        await {
            val now = job(history, cancel.id); val response = api.fetch(now, now.projectId)
            history.acceptResponse(now.id, response)
            response.optString("progress").contains("tool_execution_start")
        }
        connection.request("/v1/jobs/${cancel.id}/cancel", JSONObject())
        await {
            val now = job(history, cancel.id); history.acceptResponse(now.id, api.fetch(now, now.projectId))
            job(history, now.id).status == "cancelled"
        }
    }
    @Test fun fixture() {
        assumeTrue(context.packageName == "dev.fantasticpimobile.reliability")
        val args = InstrumentationRegistry.getArguments()
        val phase = args.getString("phase")
        assumeTrue("Run through scripts/check-project-lifecycle.py", phase in listOf("submit", "offline", "recover", "verify"))
        if (phase == "submit") {
            context.deleteDatabase("fantastic-pi-mobile.sqlite")
            ui.edit().clear().commit(); reviews.edit().clear().commit()
            Connection(context).save(args.getString("endpoint")!!, "project-lifecycle-fixture-only-token-0000")
        }
        val connection = Connection(context); val api = client(connection)
        History(context).use { history ->
            when (phase) {
                "submit" -> {
                    val rows = ProjectCatalog { path, body -> connection.request(path, body) }.projects()
                    assertEquals(2, rows.size)
                    val pa = args.getString("projectA")!!; val pb = args.getString("projectB")!!
                    assertEquals(setOf(pa, pb), rows.map { it.id }.toSet())
                    history.selectProject("pocket", pa)
                    history.saveDraft("pocket", "CONFIRM_A")
                    history.add(ids[0], "pocket", "CONFIRM_A")
                    assertEquals("", history.session("pocket")!!.draft)
                    val other = history.createSession(); history.selectProject(other, pb)
                    history.add(ids[1], other, "HOLD_B")
                    history.saveDraft(other, "Unsent B draft")
                    ui.edit().putString("selected", other).commit()
                    val a = job(history, ids[0])
                    // Proxy forwards/admission succeeds, then destroys the response socket.
                    assertTrue(failure { api.fetch(a, pa) } is IOException)
                    assertEquals("sending", job(history, ids[0]).status)
                    history.acceptResponse(ids[1], api.fetch(job(history, ids[1]), pb))
                    await {
                        val value = api.fetch(job(history, ids[1]), pb)
                        history.acceptResponse(ids[1], value)
                        value.optString("status") == "running" && value.has("workspace")
                    }
                    checkSaved(history, connection)
                }
                "offline" -> {
                    checkSaved(history, connection)
                    val before = history.sessions().flatMap { history.jobs(it.id) }
                    for (value in before) assertTrue(failure { api.fetch(value, value.projectId) } is IOException)
                    assertEquals(before, history.sessions().flatMap { history.jobs(it.id) })
                    assertEquals("sending", job(history, ids[0]).status)
                }
                "recover" -> {
                    val other = checkSaved(history, connection)
                    assertEquals("sending", job(history, ids[0]).status)
                    for (id in ids) {
                        val old = job(history, id)
                        history.acceptResponse(id, api.fetch(old, old.projectId))
                    }
                    await {
                        val a = job(history, ids[0]); history.acceptResponse(a.id, api.fetch(a, a.projectId))
                        job(history, a.id).pending.isNotEmpty()
                    }
                    val a = job(history, ids[0]); val b = job(history, ids[1])
                    assertEquals("done", b.status); assertEquals("RESULT_HOLD_B", b.answer)
                    val wrong = connection.request("/v1/jobs/${a.id}").put("projectId", b.projectId)
                    assertTrue(failure { history.acceptResponse(a.id, wrong) } is ProjectIdentityException)
                    assertEquals(a, job(history, a.id))
                    assertTrue(failure { history.acceptResponse(b.id, connection.request("/v1/jobs/${a.id}")) } is ProjectIdentityException)
                    assertEquals(b, job(history, b.id))
                    val approval = JSONObject(a.pending).getString("id")
                    assertEquals(409, (failure { connection.request("/v1/jobs/${b.id}/ui", JSONObject().put("id", approval).put("confirmed", true)) } as BridgeException).code)
                    assertEquals(409, (failure { connection.request("/v1/jobs/${a.id}/ui", JSONObject().put("id", "foreign-dialog").put("confirmed", true)) } as BridgeException).code)
                    cancelThird(history, connection, api, b.projectId!!)
                    val stillPending = connection.request("/v1/jobs/${a.id}")
                    assertEquals("running", stillPending.getString("status"))
                    assertEquals(approval, stillPending.getJSONObject("pending").getString("id"))
                    assertEquals("done", connection.request("/v1/jobs/${b.id}").getString("status"))
                    connection.request("/v1/jobs/${a.id}/ui", JSONObject().put("id", approval).put("confirmed", false))
                    await {
                        val now = job(history, a.id); history.acceptResponse(now.id, api.fetch(now, now.projectId))
                        job(history, now.id).status == "done"
                    }
                    val snapshot = connection.request("/v1/sessions/$other/changes")
                    ProjectRequests.validateReview(other, b.projectId, snapshot)
                    val body = JSONObject().put("operationId", "lifecycle-review-b").put("projectId", b.projectId)
                        .put("action", "test").put("revision", snapshot.getString("revision"))
                        .put("command", "printf 'once\\n' >> .fixture-review-dispatches; cat file.txt")
                    assertTrue(reviews.edit().putString("pending-$other", body.toString()).commit())
                    assertTrue(failure { api.sendReview(other, body, b.projectId) } is IOException)
                    assertEquals(body.toString(), reviews.getString("pending-$other", null))
                }
                "verify" -> {
                    val other = checkSaved(history, connection)
                    val a = job(history, ids[0]); val b = job(history, ids[1])
                    assertEquals("done", a.status); assertEquals("RESULT_CONFIRM_A", a.answer); assertEquals("", a.pending)
                    assertEquals("done", b.status); assertEquals("RESULT_HOLD_B", b.answer)
                    val saved = reviews.getString("pending-$other", null)!!; val body = JSONObject(saved)
                    val id = body.getString("operationId")
                    var operation = JSONObject()
                    await { operation = connection.request("/v1/sessions/$other/actions/$id"); operation.optString("status") == "done" }
                    ProjectRequests.validateOperation(other, id, b.projectId, operation)
                    assertEquals(0, operation.getJSONObject("result").getJSONObject("test").getInt("exitCode"))
                    assertTrue(operation.getJSONObject("result").getJSONObject("test").getString("output").contains("HOLD_B"))
                    val retry = api.sendReview(other, body, b.projectId)
                    assertEquals(id, retry.getString("id")); assertEquals("done", retry.getString("status"))
                    assertEquals(saved, reviews.getString("pending-$other", null))
                    assertTrue(failure { api.sendReview("pocket", body, a.projectId) } is ProjectIdentityException)
                    assertEquals(404, (failure { connection.request("/v1/sessions/pocket/actions/$id") } as BridgeException).code)
                    val foreign = JSONObject(operation.toString()).put("sessionId", "pocket")
                    assertTrue(failure { ProjectRequests.validateOperation(other, id, b.projectId, foreign) } is ProjectIdentityException)
                    assertTrue(reviews.edit().remove("pending-$other").commit())
                    assertEquals("cancelled", job(history, "lifecycle-cancel-b").status)
                    assertEquals(b.projectId, job(history, "lifecycle-cancel-b").projectId)
                    checkSaved(history, connection)
                    assertEquals(a, job(history, a.id)); assertEquals(b, job(history, b.id))
                    assertEquals(b.projectId, history.session(other)!!.projectId)
                    assertEquals(other, ui.getString("selected", null))
                }
            }
        }
    }
}
