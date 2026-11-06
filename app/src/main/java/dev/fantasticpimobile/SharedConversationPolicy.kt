package dev.fantasticpimobile

import org.json.JSONObject

internal class SharedConversationException(message: String) : Exception(message)

/** Strict wire/client decisions. Cache evidence alone never grants action permission. */
internal object SharedConversationPolicy {
    fun requireSafe(ok: Boolean, message: String) { if (!ok) throw SharedConversationException(message) }
    fun catalogue(page: JSONObject, owner: String, after: String): List<JSONObject> {
        requireSafe(page.opt("schemaVersion") == 1 && page.opt("ownerId") == owner && page.has("next"), "Foreign catalogue/schema")
        val array = page.getJSONArray("items")
        requireSafe(array.length() <= 200 && page.toString().toByteArray().size <= 1048576, "Catalogue exceeds bounds")
        var previous = after
        val result = (0 until array.length()).map { i ->
            JSONObject(array.getJSONObject(i).toString()).also { row ->
                val id = row.getString("conversationId")
                requireSafe(ProjectRequests.validId(id) && id > previous, "Catalogue order/identity conflict")
                previous = id
                val project = ConversationCachePolicy.project(row)
                if (row.opt("executionAvailable") != false) {
                    requireSafe(project != null, "Executable chat needs a proved project")
                    ConversationCachePolicy.number(row, "sequence")
                    row.optJSONObject("currentRun")?.let { run ->
                        requireSafe(ProjectRequests.validId(run.getString("runId")) && run.getString("status") in states, "Invalid run summary")
                    }
                } else requireSafe(project == null && row.isNull("currentRun") && row.isNull("sequence"), "Unproved historical chat cannot execute")
            }
        }
        page.optJSONObject("next")?.let {
            requireSafe(it.opt("schemaVersion") == 1 && it.opt("ownerId") == owner &&
                it.optString("kind") == "history-catalogue-page" && it.optString("lastId") == previous && result.isNotEmpty(), "Invalid catalogue continuation")
        }
        return result
    }
    private val states = setOf("queued", "running", "done", "failed", "cancelled", "interrupted")
    fun job(source: JSONObject, conversation: String, project: String?): Job {
        val result = Job(source.getString("id"), source.getString("text"), source.getString("status"), source.optString("answer", ""),
            source.optString("sessionId", "pocket"), source.optString("progress", ""), source.optJSONObject("pending")?.toString().orEmpty(),
            ConversationCachePolicy.project(source), ProjectState.BOUND,
            if (source.isNull("approvalOccurrenceId")) null else source.getString("approvalOccurrenceId"))
        requireSafe(result.sessionId == conversation && result.projectId == project && result.status in states, "Invalid canonical run")
        return result
    }
    fun manifests(s: ConversationCachePolicy.Scope, chat: ChatSession, jobs: List<Job>): List<JSONObject> {
        val sourceId = java.util.UUID.randomUUID().toString()
        fun manifest(rows: org.json.JSONArray, id: String): JSONObject {
            val result = JSONObject().put("schemaVersion", 1).put("ownerId", s.ownerId).put("conversationId", s.conversationId)
                .put("projectId", s.projectId ?: JSONObject.NULL).put("importId", id)
                .put("provenance", JSONObject().put("kind", "android-v4").put("sourceId", sourceId))
                .put("session", JSONObject().put("title", chat.title).put("draft", chat.draft).put("pinned", chat.pinned)
                    .put("finished", chat.finished).put("archived", chat.archived).put("projectState", chat.projectState.name))
                .put("rows", rows)
            return result.put("digest", ConversationCachePolicy.digest(ConversationCachePolicy.canonical(result)))
        }
        val batches = mutableListOf<JSONObject>()
        var rows = org.json.JSONArray(); var id = java.util.UUID.randomUUID().toString()
        for ((index, job) in jobs.withIndex()) {
            requireSafe(job.sessionId == chat.id, "Export chat mismatch")
            val row = JSONObject().put("requestId", job.id).put("ordinal", index + 1).put("text", job.text).put("answer", job.answer)
                .put("clientStatus", if (job.status == "rejected") "unknown" else job.status).put("projectId", job.projectId ?: JSONObject.NULL)
                .put("projectState", job.projectState.name).put("pending", job.pending).put("progress", job.progress)
            val candidate = org.json.JSONArray(rows.toString()).put(row)
            if (candidate.length() > 100 || manifest(candidate, id).toString().toByteArray().size > 65536) {
                requireSafe(rows.length() > 0, "One history row exceeds import bound; original history preserved")
                batches.add(manifest(rows, id)); rows = org.json.JSONArray(); id = java.util.UUID.randomUUID().toString()
            }
            rows.put(row)
            requireSafe(manifest(rows, id).toString().toByteArray().size <= 65536, "One history row exceeds import bound")
        }
        if (rows.length() > 0) batches.add(manifest(rows, id))
        return batches
    }
    fun validateAnswerReceipt(owner: String, job: Job, body: JSONObject, receipt: JSONObject) {
        requireSafe(receipt.optString("ownerId") == owner && receipt.optString("conversationId") == job.sessionId &&
            receipt.optString("projectId") == job.projectId && receipt.optString("runId") == job.id &&
            receipt.optString("approvalId") == job.approvalOccurrenceId && receipt.optString("responseId") == body.getString("responseId") &&
            receipt.optString("delivery") in listOf("attempted", "unknown") &&
            ConversationCachePolicy.canonical(receipt.optJSONObject("answer")) == ConversationCachePolicy.canonical(body.getJSONObject("answer")), "Approval receipt mismatch; delivery unknown, do not replay")
    }
    fun owner(health: JSONObject, pinned: String?): String? {
        val version = health.opt("protocolVersion")
        val legacy = version is Number && version.toDouble() == version.toInt().toDouble() && version.toInt() in 3..5 && !health.has("conversationCore")
        if (legacy && pinned == null) return null
        requireSafe(version is Number && version.toDouble() == 6.0 && health.opt("conversationCore") == true &&
            health.opt("projectBindings") == true && health.opt("eventSchemaVersion") is Number && health.opt("eventSchemaVersion") == 1 &&
            health.opt("historyImport") == true && health.opt("historySchemaVersion") is Number && health.opt("historySchemaVersion") == 1,
            "Shared connection unavailable or incompatible; saved work preserved")
        val owner = health.opt("ownerId") as? String
        requireSafe(owner != null && owner.matches(Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")), "Invalid bridge owner")
        requireSafe(pinned == null || pinned == owner, "Bridge owner changed; explicit reconciliation required. Nothing submitted")
        return owner
    }
}
