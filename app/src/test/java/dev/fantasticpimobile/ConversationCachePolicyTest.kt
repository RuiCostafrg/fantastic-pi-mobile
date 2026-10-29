package dev.fantasticpimobile

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Pure wire-policy tests, NOT Android SQLite verification. */
class ConversationCachePolicyTest {
    private val scope = ConversationCachePolicy.Scope("11111111-1111-4111-8111-111111111111", "chat-a", "project-a")
    private fun token(kind: String, sequence: Long = 1, offset: Int = 0) = JSONObject()
        .put("schemaVersion", 1).put("ownerId", scope.ownerId).put("conversationId", scope.conversationId)
        .put("projectId", scope.projectId).put("generation", "generation-a").put("kind", kind).put("sequence", sequence)
        .apply { if (kind == "snapshot-page") put("offset", offset); if (kind == "feed-page") put("upper", sequence + 1) }
    private fun record(revision: Long = 1): JSONObject {
        val id = "request-0001"
        return JSONObject().put("runId", id).put("ordinal", 1).put("revision", revision)
            .put("source", JSONObject().put("id", id).put("sessionId", scope.conversationId).put("projectId", scope.projectId)
                .put("text", "Question").put("answer", "Answer").put("pending", JSONObject().put("id", "cached-approval")))
            .put("messages", JSONArray().put(JSONObject().put("id", JSONArray().put(id).put("user").toString()).put("role", "user").put("text", "Question"))
                .put(JSONObject().put("id", JSONArray().put(id).put("assistant").toString()).put("role", "assistant").put("text", "Answer")))
    }
    private fun snapshot(): JSONObject = token("envelope").put("consistentRead", true).put("liveWrites", true)
        .put("snapshot", token("snapshot-page")).put("highWater", 1).put("after", token("feed-cursor"))
        .put("next", JSONObject.NULL).put("items", JSONArray().put(JSONObject().put("kind", "turn").put("id", "request-0001").put("ordinal", 1).put("revision", 1).put("record", record())))
    private fun refuses(block: () -> Unit) {
        try { block(); fail("Accepted invalid evidence") } catch (_: IllegalArgumentException) { } catch (_: IllegalStateException) { }
    }
    @Test fun stableRoleIdsAndRawApprovalsAreOnlyEvidence() {
        val page = ConversationCachePolicy.page(scope, "snapshot", snapshot(), null)
        assertEquals("request-0001", page.records.single().id)
        assertEquals("cached-approval", page.records.single().body.getJSONObject("source").getJSONObject("pending").getString("id"))
        val evidence = ConversationCache.Evidence("turn", "request-0001", 1, page.records.single().body.toString())
        assertFalse(evidence.actionable); assertFalse(evidence.executionAuthority)
    }
    @Test fun legacyPocketSourceMayOmitRedundantSessionAndEmptyAnswer() {
        val s = scope.copy(conversationId = "pocket")
        val o = snapshot().put("conversationId", "pocket")
        o.getJSONObject("snapshot").put("conversationId", "pocket")
        o.getJSONObject("after").put("conversationId", "pocket")
        val r = o.getJSONArray("items").getJSONObject(0).getJSONObject("record")
        r.getJSONObject("source").remove("sessionId"); r.getJSONObject("source").remove("answer")
        r.getJSONArray("messages").getJSONObject(1).put("text", "")
        assertEquals("request-0001", ConversationCachePolicy.page(s, "snapshot", o, null).records.single().id)
    }
    @Test fun rejectsWrongOwnerProjectChatSchemaAndStringVersions() {
        for ((field, value) in listOf("ownerId" to "22222222-2222-4222-8222-222222222222", "conversationId" to "other", "projectId" to "other", "schemaVersion" to 2, "schemaVersion" to "1")) {
            refuses { ConversationCachePolicy.page(scope, "snapshot", snapshot().put(field, value), null) }
        }
    }
    @Test fun rejectsForeignTokensAndPrematureSnapshotCursor() {
        refuses { ConversationCachePolicy.page(scope, "snapshot", snapshot().put("after", token("feed-cursor", 2)), null) }
        refuses { ConversationCachePolicy.page(scope, "snapshot", snapshot().put("next", token("snapshot-page", 1, 2)), null) }
        refuses { ConversationCachePolicy.page(scope, "snapshot", snapshot(), token("snapshot-page").put("generation", "other")) }
        refuses { ConversationCachePolicy.page(scope, "snapshot", snapshot().put("next", token("feed-page")), null) }
    }
    @Test fun rejectsChangedMessageIdentityTextAndSourceProject() {
        for (change in 0..3) {
            val o = snapshot(); val r = o.getJSONArray("items").getJSONObject(0).getJSONObject("record")
            when (change) {
                0 -> r.getJSONArray("messages").getJSONObject(1).put("id", "invented")
                1 -> r.getJSONArray("messages").getJSONObject(0).put("text", "Changed")
                2 -> r.getJSONObject("source").put("projectId", "other")
                3 -> r.put("revision", 2)
            }
            refuses { ConversationCachePolicy.page(scope, "snapshot", o, null) }
        }
    }
    private fun feed(): JSONObject = token("envelope").put("consistentRead", true).put("liveWrites", true)
        .put("page", token("feed-page", 1)).put("upper", 2).put("after", token("feed-cursor", 2)).put("next", JSONObject.NULL)
        .put("items", JSONArray().put(JSONObject().put("event", token("event", 2).put("type", "run.result").put("kind", "turn")
            .put("recordId", "request-0001").put("ordinal", 1).put("revision", 2)).put("record", record(2))))
    @Test fun acceptsContiguousFeedAndRejectsGapResetUnknownAndFuture() {
        assertEquals(2L, ConversationCachePolicy.page(scope, "feed", feed(), token("feed-cursor", 1)).records.single().revision)
        for (type in listOf("snapshot.reset", "future.event")) {
            val o = feed(); o.getJSONArray("items").getJSONObject(0).getJSONObject("event").put("type", type)
            refuses { ConversationCachePolicy.page(scope, "feed", o, token("feed-cursor", 1)) }
        }
        val gap = feed(); gap.getJSONArray("items").getJSONObject(0).getJSONObject("event").put("sequence", 3)
        refuses { ConversationCachePolicy.page(scope, "feed", gap, token("feed-cursor", 1)) }
        refuses { ConversationCachePolicy.page(scope, "feed", feed().put("after", token("feed-cursor", 3)), token("feed-cursor", 1)) }
    }
    @Test fun historicalOnlyAndUnresolvedRemainNonExecutingAndHaveNoFeedCursor() {
        val s = scope.copy(projectId = null)
        val row = JSONObject().put("requestId", "request-0001").put("ordinal", 1).put("projectId", JSONObject.NULL)
            .put("text", "Question").put("answer", "Answer").put("clientStatus", "sending")
        val item = JSONObject().put("kind", "evidence").put("ownerId", s.ownerId).put("conversationId", s.conversationId)
            .put("classification", "unresolved-outbox").put("actionable", false).put("executionAuthority", false)
            .put("importId", "import-0001").put("provenance", JSONObject().put("kind", "android-v4").put("sourceId", "fixture-export"))
            .put("evidence", row).put("messages", record().getJSONArray("messages"))
        val o = JSONObject().put("schemaVersion", 1).put("ownerId", s.ownerId).put("conversationId", s.conversationId)
            .put("projectId", JSONObject.NULL).put("revision", 1).put("readOnly", true).put("executionAuthority", false)
            .put("items", JSONArray().put(item)).put("next", JSONObject.NULL)
        val page = ConversationCachePolicy.page(s, "history", o, null)
        assertNull(page.after); assertEquals("history", page.records.single().kind)
        item.put("actionable", true); refuses { ConversationCachePolicy.page(s, "history", o, null) }
        item.put("actionable", false).put("classification", "historical-unverified")
        refuses { ConversationCachePolicy.page(s, "history", o, null) }
        row.put("clientStatus", "done")
        assertEquals("history", ConversationCachePolicy.page(s, "history", o, null).records.single().kind)
        row.put("projectId", scope.projectId) // selected claim is not a proved backend binding
        assertEquals(scope.projectId, ConversationCachePolicy.page(scope, "history", o, null).records.single().projectId)
        row.put("projectId", "wrong-project")
        refuses { ConversationCachePolicy.page(scope, "history", o, null) }
    }
    @Test fun canonicalDigestMatchesB06KeyOrderingAndDoesNotNormalizeText() {
        assertEquals("{\"a\":{\"x\":true,\"z\":null},\"b\":[2,1]}", ConversationCachePolicy.canonical(JSONObject("{\"b\":[2,1],\"a\":{\"z\":null,\"x\":true}}")))
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", ConversationCachePolicy.digest("abc"))
        assertNotEquals(ConversationCachePolicy.digest("é"), ConversationCachePolicy.digest("e\u0301"))
    }
    @Test fun canonicalDigestUsesJsonStringifyEscapingIncludingLoneSurrogates() {
        val input = JSONObject().put("b", JSONArray().put(1).put(true).put(JSONObject.NULL).put("\n\t"))
            .put("a", "</script>\u0085\u2028😀\uD800")
        // Independently generated by Node JSON.stringify + crypto SHA-256.
        assertEquals("9d4c63cfaf1dd1d4a602f688e0c5784fc246630d645225130fd62d300a40b57a", ConversationCachePolicy.digest(ConversationCachePolicy.canonical(input)))
    }
    @Test fun manifestSchemaDigestIdentityAndUnsupportedFieldsFailClosed() {
        val m = JSONObject().put("schemaVersion", 1).put("ownerId", scope.ownerId).put("conversationId", scope.conversationId)
            .put("projectId", scope.projectId).put("importId", "import-0001")
            .put("provenance", JSONObject().put("kind", "android-v4").put("sourceId", "fixture-export"))
            .put("session", JSONObject()).put("rows", JSONArray())
        fun signed(): JSONObject {
            val copy = JSONObject(m.toString())
            return copy.put("digest", ConversationCachePolicy.digest(ConversationCachePolicy.canonical(copy)))
        }
        ConversationCachePolicy.manifest(scope, signed())
        refuses { ConversationCachePolicy.manifest(scope, signed().put("digest", "0".repeat(64))) }
        m.put("execute", true)
        refuses { ConversationCachePolicy.manifest(scope, signed()) }
        m.remove("execute"); m.getJSONObject("provenance").put("kind", "pi-session")
        refuses { ConversationCachePolicy.manifest(scope, signed()) }
        m.getJSONObject("provenance").put("kind", "android-v4"); m.put("schemaVersion", 2)
        refuses { ConversationCachePolicy.manifest(scope, signed()) }
    }
    @Test fun receiptRejectsExecutionAuthorityUnknownSchemasAndWrongProof() {
        val receipt = JSONObject().put("schemaVersion", 1).put("ownerId", scope.ownerId).put("conversationId", scope.conversationId)
            .put("importId", "import-0001").put("digest", "a".repeat(64)).put("outcome", "imported").put("revision", 1).put("executionAuthority", false)
            .put("projectEvidence", JSONObject().put("claimedProjectId", scope.projectId).put("provedProjectId", scope.projectId))
        ConversationCachePolicy.receipt(scope, receipt)
        receipt.put("executionAuthority", true); refuses { ConversationCachePolicy.receipt(scope, receipt) }
        receipt.put("executionAuthority", false).getJSONObject("projectEvidence").put("provedProjectId", "other")
        refuses { ConversationCachePolicy.receipt(scope, receipt) }
    }
}
