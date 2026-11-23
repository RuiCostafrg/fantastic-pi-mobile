package dev.fantasticpimobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Headless actual SQLite + real disposable Node owner/HTTP. No Activity or production state. */
@RunWith(AndroidJUnit4::class)
class SharedConversationsTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val args get() = InstrumentationRegistry.getArguments()
    private val project get() = args.getString("projectId")!!
    private fun scenario(block: (History, Connection, ( ((String, JSONObject?, Map<String, String>) -> JSONObject)? ) -> SharedConversations) -> Unit) {
        val context = instrumentation.targetContext
        assumeTrue(context.packageName == "dev.fantasticpimobile.reliability")
        require(args.getString("endpoint")?.startsWith("http://127.0.0.1:") == true)
        val name = "b08-${UUID.randomUUID()}.sqlite"
        val connection = Connection(context)
        connection.save(args.getString("endpoint")!!, "b08-isolated-fixture-token-000000000000")
        try { History(context, name).use { history ->
            val factory: (((String, JSONObject?, Map<String, String>) -> JSONObject)?) -> SharedConversations = { override ->
                SharedConversations(history, connection.endpoint, override ?: { path, body, headers -> connection.requestAt(connection.endpoint, path, body, headers) }).also { it.activate() }
            }
            block(history, connection, factory)
        } } finally { context.deleteDatabase(name) }
    }
    @Test fun discoversCompletedAndArchivedRemoteWorkWithoutChangingOrganizationOrCreatingLocalJobs() = scenario { h, _, factory ->
        h.ensureRemoteSession("archived-remote", project)
        h.add("local-${UUID.randomUUID()}", "archived-remote", "Local history")
        h.update(h.jobs("archived-remote").single().id, "done", "Saved answer")
        h.rename("archived-remote", "Exact saved title"); h.saveDraft("archived-remote", "Exact saved draft")
        h.pin("archived-remote", true); h.setFinished("archived-remote", true); h.setArchived("archived-remote", true)
        val original = h.session("archived-remote")!!
        val adapter = factory(null); adapter.refresh()
        assertEquals(SharedConversations.Mode.SHARED, adapter.mode)
        assertEquals("B08_FIXTURE_RESULT", adapter.jobs("remote-finished").single().answer)
        assertTrue(h.jobs("remote-finished").isEmpty())
        assertEquals(original, h.session("archived-remote"))
        val visible = adapter.sessions().single { it.id == "archived-remote" }
        assertTrue(visible.archived); assertTrue(visible.finished); assertTrue(visible.active)
        assertEquals(ChatSection.WORKING, visible.section)
        assertFalse(adapter.canSend(visible.id))
        adapter.refresh()
        assertEquals(1, adapter.jobs("remote-finished").size)
        adapter.invalidate(); assertFalse(adapter.live("archived-remote"))
    }
    @Test fun lostAcceptanceReopensAndRecoversSameSavedRequestWithoutRedispatch() = scenario { h, _, factory ->
        val chat = h.createSession(); h.selectProject(chat, project)
        val adapter = factory(null); adapter.refresh()
        val id = adapter.prepareSend(chat, "lost-acceptance")
        assertTrue(adapter.isSharedRequest(id)); assertEquals("", h.session(chat)!!.draft)
        adapter.refresh() // Real proxy drops entire accepted response.
        assertEquals(SharedConversations.Mode.UNAVAILABLE, adapter.mode)
        adapter.invalidate()
        val reopened = factory(null)
        repeat(3) { reopened.refresh(); Thread.sleep(100) }
        assertEquals(SharedConversations.Mode.SHARED, reopened.mode)
        assertEquals(id, h.jobs(chat).single().id)
        assertEquals("done", h.jobs(chat).single().status)
        assertEquals(id, reopened.jobs(chat).single().id)
        assertEquals("B08_FIXTURE_RESULT", reopened.jobs(chat).single().answer)
    }
    @Test fun lostImportReceiptRetainsUnresolvedOriginalRowsAndNeverSendsThem() = scenario { h, _, factory ->
        val chat = h.createSession(); val id = "old-${UUID.randomUUID()}"
        h.add(id, chat, "lost-import"); h.update(id, "sending", "Saved", "Uncertain", "{\"id\":\"cached-dialog\"}")
        val before = h.jobs(chat).single(); val original = h.session(chat)
        val adapter = factory(null); adapter.refresh()
        assertEquals(SharedConversations.Mode.UNAVAILABLE, adapter.mode)
        val reopened = factory(null); reopened.refresh()
        assertEquals(SharedConversations.Mode.SHARED, reopened.mode)
        assertEquals(before, h.jobs(chat).single()); assertEquals(original, h.session(chat))
        val display = reopened.jobs(chat).single()
        assertEquals(id, display.id); assertEquals("", display.pending)
        assertFalse(reopened.canApprove(display)); assertFalse(reopened.canSend(chat))
        assertFalse(reopened.isSharedRequest(id))
    }
    @Test fun staleLifecycleCallbacksAndReplacedOrDowngradedOwnerCannotAdoptOrSubmit() = scenario { h, c, factory ->
        lateinit var stale: SharedConversations
        stale = factory { path, body, headers ->
            c.requestAt(c.endpoint, path, body, headers).also { if (path.startsWith("/v1/conversations?")) stale.invalidate() }
        }
        stale.refresh()
        assertNull(h.session("remote-finished"))
        var posts = 0
        val replaced = factory { path, body, headers ->
            if (body != null) posts++
            c.requestAt(c.endpoint, path, body, headers).also { if (path == "/health") it.put("ownerId", "22222222-2222-4222-8222-222222222222") }
        }
        replaced.refresh(); assertEquals(SharedConversations.Mode.UNAVAILABLE, replaced.mode)
        assertEquals(0, posts)
        val downgraded = factory { path, body, headers ->
            if (body != null) posts++
            if (path == "/health") JSONObject().put("protocolVersion", 5) else c.requestAt(c.endpoint, path, body, headers)
        }
        downgraded.refresh(); assertEquals(SharedConversations.Mode.UNAVAILABLE, downgraded.mode)
        assertEquals(0, posts); assertNull(h.session("remote-finished"))
    }
    @Test fun sharedReviewLostResponseRecoversOriginalOperationAndPreservesSavedJson() = scenario { _, _, factory ->
        val adapter = factory(null); adapter.refresh()
        for (chat in listOf("archived-remote", "approval-remote")) adapter.stop(adapter.jobs(chat).single { it.active })
        adapter.refresh()
        val route = "/v1/sessions/remote-finished"
        val snapshot = adapter.requestScoped("$route/changes")
        val id = "review-${UUID.randomUUID()}"
        val body = JSONObject().put("operationId", id).put("projectId", project).put("action", "test")
            .put("revision", snapshot.getString("revision")).put("command", "printf B08_REVIEW_OK")
        val prefs = instrumentation.targetContext.getSharedPreferences("review-requests", 0)
        val key = "pending-b08-$id"; val original = body.toString()
        assertTrue(prefs.edit().putString(key, original).commit())
        try {
            try { adapter.requestScoped("$route/actions", body); fail("Expected lost review response") } catch (_: java.io.IOException) { }
            adapter.invalidate()
            val reopened = factory(null)
            var result = JSONObject()
            for (attempt in 0..50) {
                result = reopened.requestScoped("$route/actions/$id")
                if (result.optString("status") == "done") break
                Thread.sleep(100)
            }
            ProjectRequests.validateOperation("remote-finished", id, project, result)
            assertEquals("done", result.getString("status"))
            assertEquals(0, result.getJSONObject("result").getJSONObject("test").getInt("exitCode"))
            assertEquals("B08_REVIEW_OK", result.getJSONObject("result").getJSONObject("test").getString("output"))
            assertEquals(original, body.toString()); assertEquals(original, prefs.getString(key, null))
        } finally { prefs.edit().remove(key).commit() }
    }
    @Test fun immutableImportConflictRemainsBlockedAfterReopen() = scenario { h, c, factory ->
        val chat = h.createSession(); val id = "old-${UUID.randomUUID()}"
        h.add(id, chat, "Local original"); h.update(id, "done", "Local answer")
        val local = h.jobs(chat).single()
        val owner = c.request("/health").getString("ownerId")
        val s = ConversationCachePolicy.Scope(owner, chat, null)
        val other = SharedConversationPolicy.manifests(s, h.session(chat)!!, listOf(local.copy(text = "Conflicting other source"))).single()
        c.requestAt(c.endpoint, "/v1/conversations/$chat/history/imports", other,
            mapOf("X-Conversation-Schema" to "1", "X-Conversation-Owner" to owner, "X-History-Schema" to "1"))
        val adapter = factory(null); adapter.refresh()
        assertEquals(SharedConversations.Mode.UNAVAILABLE, adapter.mode)
        val reopened = factory(null); reopened.refresh()
        assertEquals(SharedConversations.Mode.UNAVAILABLE, reopened.mode)
        assertFalse(reopened.canSend(chat)); assertEquals(local, h.jobs(chat).single())
    }
    @Test fun sameUrlRePairInvalidatesHealthBeforeAnyAdoptionOrDispatch() = scenario { h, c, _ ->
        val identity = c.identity
        var posts = 0
        val adapter = SharedConversations(h, c.endpoint, { path, body, headers ->
            if (body != null) posts++
            c.requestAt(c.endpoint, path, body, headers, identity).also {
                if (path == "/health") c.save(c.endpoint, "different-fixture-credential-000000000000")
            }
        }, { c.identity == identity })
        adapter.activate(); adapter.refresh()
        assertEquals(SharedConversations.Mode.UNAVAILABLE, adapter.mode)
        assertEquals(0, posts); assertNull(h.session("remote-finished"))
        assertFalse(adapter.canSend("pocket"))
    }
    @Test fun competingRemoteAdmissionRemainsDiscoverableWhileSameIdOutboxWaits() = scenario { h, c, factory ->
        val chat = h.createSession(); h.selectProject(chat, project)
        val adapter = factory(null); adapter.refresh()
        val localId = adapter.prepareSend(chat, "remote")
        val remoteId = "competing-${UUID.randomUUID()}"
        val owner = c.request("/health").getString("ownerId")
        c.requestAt(c.endpoint, "/v1/jobs", JSONObject().put("requestId", remoteId).put("conversationId", chat).put("projectId", project).put("text", "hold"),
            mapOf("X-Conversation-Schema" to "1", "X-Conversation-Owner" to owner))
        adapter.refresh()
        assertEquals(SharedConversations.Mode.SHARED, adapter.mode)
        assertFalse(adapter.canSend(chat))
        assertEquals(localId, h.jobs(chat).single().id)
        val live = adapter.jobs(chat).first { it.active }
        assertEquals(remoteId, live.id); assertTrue(adapter.current(live))
        adapter.stop(live)
        // Admission/dispatch completion and the next exact-ID GET are separate
        // asynchronous boundaries; three fixed refreshes race under process load.
        for (attempt in 0 until 50) {
            adapter.refresh()
            if (h.jobs(chat).single().status == "done") break
            Thread.sleep(100)
        }
        assertEquals("done", h.jobs(chat).single().status)
        assertEquals(localId, h.jobs(chat).single().id)
        assertEquals(2, adapter.jobs(chat).size)
    }
    @Test fun localContentConflictRetainsBothSidesAfterPageTransactionRollsBack() = scenario { h, c, factory ->
        val adapter = factory(null); adapter.refresh()
        val owner = c.request("/health").getString("ownerId")
        val scope = ConversationCachePolicy.Scope(owner, "remote-finished", project)
        val cache = ConversationCache(h); val before = cache.state(scope, "execution").toString()
        val id = "conflict-${UUID.randomUUID()}"
        h.add(id, "remote-finished", "Different local text")
        val local = h.jobs("remote-finished").single()
        c.requestAt(c.endpoint, "/v1/jobs", JSONObject().put("requestId", id).put("conversationId", "remote-finished").put("projectId", project).put("text", "Remote original text"),
            mapOf("X-Conversation-Schema" to "1", "X-Conversation-Owner" to owner))
        Thread.sleep(150); adapter.refresh()
        assertEquals(SharedConversations.Mode.UNAVAILABLE, adapter.mode)
        assertEquals(before, cache.state(scope, "execution").toString())
        assertEquals(local, h.jobs("remote-finished").single())
        assertTrue("Both-side semantic conflict must survive rollback", cache.conflicts(scope).any { it.contains("Different local text") && it.contains("Remote original text") })
    }
    @Test fun unknownSchemaFeedRetainsConflictWithoutAdvancingAndRecoversFromOriginalCursor() = scenario { h, c, factory ->
        var corrupt = false
        val adapter = factory { path, body, headers ->
            c.requestAt(c.endpoint, path, body, headers).also { page ->
                if (corrupt && path.startsWith("/v1/conversations/remote-finished/events") && page.getJSONArray("items").length() > 0)
                    page.getJSONArray("items").getJSONObject(0).getJSONObject("event").put("schemaVersion", 2)
            }
        }
        adapter.refresh()
        val owner = c.request("/health").getString("ownerId")
        val scope = ConversationCachePolicy.Scope(owner, "remote-finished", project)
        val cache = ConversationCache(h); val before = cache.state(scope, "execution").toString()
        val headers = mapOf("X-Conversation-Schema" to "1", "X-Conversation-Owner" to owner)
        c.requestAt(c.endpoint, "/v1/jobs", JSONObject().put("requestId", "next-${UUID.randomUUID()}").put("conversationId", "remote-finished").put("projectId", project).put("text", "remote"), headers)
        Thread.sleep(150); corrupt = true
        adapter.refresh()
        assertEquals(SharedConversations.Mode.UNAVAILABLE, adapter.mode)
        assertEquals(before, cache.state(scope, "execution").toString())
        assertEquals(1, adapter.jobs("remote-finished").size)
        assertTrue("Rejected schema evidence must survive rollback", cache.conflicts(scope).isNotEmpty())
        corrupt = false; adapter.refresh()
        assertEquals(SharedConversations.Mode.SHARED, adapter.mode)
        assertEquals(2, adapter.jobs("remote-finished").size)
    }
    @Test fun lostApprovalResponseIsNotReplayedAndStopTargetsOnlyExactRun() = scenario { _, _, factory ->
        val adapter = factory(null); adapter.refresh()
        val approval = adapter.jobs("approval-remote").single()
        assertTrue(adapter.canApprove(approval))
        try { adapter.answer(approval, JSONObject().put("confirmed", true)); fail("Expected dropped response") } catch (_: java.io.IOException) { }
        assertFalse(adapter.canApprove(approval))
        try { adapter.answer(approval, JSONObject().put("confirmed", false)); fail("Replayed approval") } catch (_: SharedConversationException) { }
        repeat(3) { adapter.refresh(); Thread.sleep(100) }
        assertEquals("done", adapter.jobs("approval-remote").single().status)
        val held = adapter.jobs("archived-remote").first { it.id == "remote-held-run" }
        try { adapter.stop(held.copy(sessionId = "approval-remote")); fail("Stopped another chat") } catch (_: SharedConversationException) { }
        adapter.stop(held); adapter.refresh()
        assertEquals("cancelled", adapter.jobs("archived-remote").first { it.id == held.id }.status)
        assertEquals("done", adapter.jobs("remote-finished").single().status)
    }
}
