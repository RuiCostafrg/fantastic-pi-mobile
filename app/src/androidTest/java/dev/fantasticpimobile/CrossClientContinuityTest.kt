package dev.fantasticpimobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** B10 phases intentionally execute in different real Android processes. No Activity. */
@RunWith(AndroidJUnit4::class)
class CrossClientContinuityTest {
    private val args get() = InstrumentationRegistry.getArguments()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val prefs get() = context.getSharedPreferences("b10-preservation", 0)
    private val chat = "b10-chat-a"
    private fun phase(block: (History, Connection, SharedConversations) -> Unit) {
        require(context.packageName == "dev.fantasticpimobile.reliability")
        require(args.getString("database")!!.matches(Regex("b10-[a-z0-9-]+\\.sqlite")))
        require(args.getString("endpoint")!!.startsWith("http://127.0.0.1:"))
        val c = Connection(context)
        History(context, args.getString("database")!!).use { h ->
            val adapter = SharedConversations(h, c.endpoint, { path, body, headers -> c.requestAt(c.endpoint, path, body, headers) })
            adapter.activate()
            try { block(h, c, adapter) } finally { adapter.invalidate() }
        }
    }
    private fun until(a: SharedConversations, predicate: () -> Boolean) {
        repeat(100) { a.refresh(); if (predicate()) return; Thread.sleep(100) }
        fail("B10 bounded reconciliation timeout")
    }
    private fun cursor(h: History, c: Connection): String {
        val scope = ConversationCachePolicy.Scope(c.request("/health").getString("ownerId"), chat, args.getString("projectId")!!)
        return ConversationCache(h).state(scope, "execution").toString()
    }
    private fun preserve(h: History, c: Connection) {
        assertEquals(prefs.getString("session", null), h.session(chat).toString())
        assertEquals(prefs.getString("pairing", null), c.identity)
        assertEquals("{\"operationId\":\"b10-saved-review\",\"action\":\"test\"}", context.getSharedPreferences("review-requests", 0).getString("pending-b10", null))
        assertEquals(prefs.getString("originalId", null), h.jobs(chat).single().id)
    }
    @Test fun androidSendsFirstTurn() {
        Connection(context).save(args.getString("endpoint")!!, java.io.File(context.filesDir, "b10-token").readText())
        phase { h, c, a ->
            h.ensureRemoteSession(chat, args.getString("projectId")!!)
            a.refresh(); val id = a.prepareSend(chat, "ANDROID_A")
            until(a) { a.jobs(chat).singleOrNull()?.status == "done" && h.jobs(chat).singleOrNull()?.status == "done" }
            assertEquals(id, a.jobs(chat).single().id)
            assertEquals("B10_RESULT_ANDROID_A", a.jobs(chat).single().answer)
            h.rename(chat, "B10 preserved title"); h.saveDraft(chat, "B10 unsent draft")
            h.pin(chat, true); h.setFinished(chat, true); h.setArchived(chat, true)
            context.getSharedPreferences("review-requests", 0).edit().putString("pending-b10", "{\"operationId\":\"b10-saved-review\",\"action\":\"test\"}").commit()
            assertTrue(prefs.edit().putString("session", h.session(chat).toString()).putString("pairing", c.identity)
                .putString("originalId", id).putString("cursor", cursor(h, c)).commit())
        }
    }
    @Test fun androidReopensAfterTerminalCompletion() = phase { h, c, a ->
        preserve(h, c)
        until(a) { a.jobs(chat).size == 2 && a.jobs(chat).last().status == "done" }
        val jobs = a.jobs(chat)
        assertEquals(listOf("ANDROID_A", "TERMINAL_A"), jobs.map { it.text })
        assertEquals(listOf("B10_RESULT_ANDROID_A", "B10_RESULT_TERMINAL_A"), jobs.map { it.answer })
        assertEquals(prefs.getString("originalId", null), jobs.first().id)
        assertEquals(args.getString("terminalRun"), jobs.last().id)
        assertEquals(2, jobs.map { it.id }.toSet().size)
        assertTrue(jobs.all { it.sessionId == chat && it.projectId == args.getString("projectId") && it.pending.isEmpty() && !a.canApprove(it) })
        assertEquals(1, h.jobs(chat).size) // Remote run must not become a local outbox row.
        val after = cursor(h, c); assertNotEquals(prefs.getString("cursor", null), after)
        repeat(3) { a.refresh(); assertEquals(jobs, a.jobs(chat)); assertEquals(after, cursor(h, c)) }
        preserve(h, c)
        assertEquals("running", a.jobs("b10-chat-b").single().status)
        assertEquals(args.getString("projectB"), a.jobs("b10-chat-b").single().projectId)
    }
    @Test fun androidLosesSendResponseBeforeProcessLoss() = phase { h, _, a ->
        h.ensureRemoteSession("b10-lost-a", args.getString("projectId")!!)
        a.refresh(); val id = a.prepareSend("b10-lost-a", "ANDROID_A")
        a.refresh(); assertEquals(SharedConversations.Mode.UNAVAILABLE, a.mode)
        assertTrue(a.isSharedRequest(id)); assertEquals(id, h.jobs("b10-lost-a").single().id)
    }
    @Test fun androidRecoversOriginalSendAfterProcessLoss() = phase { h, _, a ->
        val id = args.getString("lostAndroidRun")!!
        assertEquals(id, h.jobs("b10-lost-a").single().id)
        until(a) { h.jobs("b10-lost-a").single().status == "done" }
        assertEquals(id, a.jobs("b10-lost-a").single().id)
        assertEquals("B10_RESULT_ANDROID_A", a.jobs("b10-lost-a").single().answer)
        repeat(2) { a.refresh(); assertEquals(1, a.jobs("b10-lost-a").size) }
    }
    @Test fun androidCompetesWithTerminalSend() = phase { h, _, a ->
        a.refresh()
        assertEquals("B10 race initial refresh: ${a.message}; sessions=${h.sessions()}", SharedConversations.Mode.SHARED, a.mode)
        val id = a.prepareSend("b10-race", "RACE_A")
        a.refresh() // Proxy rendezvous releases only when both actual client POSTs arrive.
        assertTrue(a.isSharedRequest(id)); assertEquals(id, h.jobs("b10-race").single().id)
        assertTrue(prefs.edit().putString("raceId", id).commit())
    }
    @Test fun androidCompetesWithTerminalApproval() = phase { _, _, a ->
        a.refresh()
        val job = a.jobs(args.getString("approvalChat")!!).last()
        assertTrue(a.canApprove(job))
        try { a.answer(job, JSONObject().put("confirmed", false)) } catch (_: java.io.IOException) { }
        catch (error: BridgeException) { assertEquals(409, error.code) }
        catch (_: SharedConversationException) { }
        assertFalse(a.canApprove(job))
    }
    @Test fun androidReopensAfterApprovalRaceWithoutReplay() = phase { _, _, a ->
        val approvalChat = args.getString("approvalChat")!!
        until(a) { a.jobs(approvalChat).lastOrNull()?.status == "done" }
        val job = a.jobs(approvalChat).last()
        assertFalse(a.canApprove(job)); assertEquals("", job.pending)
        repeat(3) { a.refresh(); assertEquals(job, a.jobs(approvalChat).last()) }
    }
    @Test fun androidOfflineReopenRetainsOriginalEvidence() = phase { h, c, a ->
        val jobs = h.jobs(chat); val session = h.session(chat)
        a.refresh(); assertEquals(SharedConversations.Mode.UNAVAILABLE, a.mode)
        assertEquals(jobs, h.jobs(chat)); assertEquals(session, h.session(chat))
        preserve(h, c)
    }
    @Test fun androidReconcilesDuplicatePagesAfterOwnerReopen() = phase { h, c, a ->
        a.refresh(); assertEquals(SharedConversations.Mode.SHARED, a.mode)
        val owner = c.request("/health").getString("ownerId")
        val scope = ConversationCachePolicy.Scope(owner, chat, args.getString("projectId")!!)
        val page = c.requestAt(c.endpoint, "/v1/conversations/$chat?limit=50", null,
            mapOf("X-Conversation-Schema" to "1", "X-Conversation-Owner" to owner))
        val cache = ConversationCache(h)
        assertTrue(cache.apply(scope, "snapshot", page, null).applied)
        val state = cache.state(scope, "execution").toString()
        val repeated = cache.apply(scope, "snapshot", page, null)
        assertTrue(repeated.applied); assertTrue(repeated.duplicate)
        assertEquals(state, cache.state(scope, "execution").toString())
        assertEquals(listOf("ANDROID_A", "TERMINAL_A"), a.jobs(chat).map { it.text })
        repeat(2) { a.refresh(); assertEquals(2, a.jobs(chat).size) }
        preserve(h, c)
    }
}
