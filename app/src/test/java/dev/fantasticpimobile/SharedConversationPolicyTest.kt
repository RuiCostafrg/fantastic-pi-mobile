package dev.fantasticpimobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SharedConversationPolicyTest {
    private val owner = "11111111-1111-4111-8111-111111111111"
    private fun health() = JSONObject().put("protocolVersion", 6).put("conversationCore", true)
        .put("eventSchemaVersion", 1).put("ownerId", owner).put("projectBindings", true)
        .put("historyImport", true).put("historySchemaVersion", 1)
    private fun refused(block: () -> Unit) { try { block(); fail("Unsafe shared transition accepted") } catch (_: SharedConversationException) { } }
    @Test fun catalogueRejectsForeignSchemasOrderingAndUnprovedExecution() {
        val item = JSONObject().put("conversationId", "chat-a").put("projectId", "project-a").put("sequence", 0).put("currentRun", JSONObject.NULL)
        val page = JSONObject().put("schemaVersion", 1).put("ownerId", owner).put("items", org.json.JSONArray().put(item)).put("next", JSONObject.NULL)
        assertEquals("chat-a", SharedConversationPolicy.catalogue(page, owner, "").single().getString("conversationId"))
        refused { SharedConversationPolicy.catalogue(page, owner, "chat-z") }
        refused { SharedConversationPolicy.catalogue(JSONObject(page.toString()).put("schemaVersion", "1"), owner, "") }
        refused { SharedConversationPolicy.catalogue(JSONObject(page.toString()).put("ownerId", "other"), owner, "") }
        item.put("projectId", JSONObject.NULL)
        refused { SharedConversationPolicy.catalogue(page, owner, "") }
        item.put("executionAvailable", false).put("sequence", JSONObject.NULL)
        assertEquals(1, SharedConversationPolicy.catalogue(page, owner, "").size)
    }
    @Test fun boundedManifestsPreserveOriginalIdsOrderAndPendingEvidence() {
        val s = ConversationCachePolicy.Scope(owner, "chat-a", null)
        val rows = (1..101).map { Job("request-${it.toString().padStart(4, '0')}", "Q$it", "sending", "", "chat-a", "progress", "cached-dialog") }
        val chat = ChatSession("chat-a", "Exact title", "Draft", true, 0, "sending", true)
        val batches = SharedConversationPolicy.manifests(s, chat, rows)
        assertEquals(2, batches.size)
        assertEquals(100, batches.first().getJSONArray("rows").length())
        assertEquals(101, batches.last().getJSONArray("rows").getJSONObject(0).getInt("ordinal"))
        assertEquals("request-0001", batches.first().getJSONArray("rows").getJSONObject(0).getString("requestId"))
        assertEquals("cached-dialog", batches.first().getJSONArray("rows").getJSONObject(0).getString("pending"))
        batches.forEach { ConversationCachePolicy.manifest(s, it) }
    }
    @Test fun explicitCapabilityAndPinnedOwnerNeverDowngradeOrSwitch() {
        assertEquals(owner, SharedConversationPolicy.owner(health(), null))
        assertNull(SharedConversationPolicy.owner(JSONObject().put("protocolVersion", 5), null))
        refused { SharedConversationPolicy.owner(JSONObject().put("protocolVersion", 5), owner) }
        refused { SharedConversationPolicy.owner(health().put("ownerId", "22222222-2222-4222-8222-222222222222"), owner) }
        for ((key, value) in listOf("protocolVersion" to "6", "conversationCore" to "true", "eventSchemaVersion" to 2, "historySchemaVersion" to "1", "projectBindings" to false)) {
            refused { SharedConversationPolicy.owner(health().put(key, value), null) }
        }
    }
}
