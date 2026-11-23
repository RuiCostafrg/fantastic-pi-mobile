package dev.fantasticpimobile

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** Wire validation only. Nothing returned here is a send/approval authorization. */
internal object ConversationCachePolicy {
    data class Scope(val ownerId: String, val conversationId: String, val projectId: String?) {
        init {
            require(ownerId.matches(Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")))
            require(ProjectRequests.validId(conversationId))
            require(projectId == null || ProjectRequests.validId(projectId))
        }
    }
    data class Record(val kind: String, val id: String, val revision: Long, val ordinal: Long,
        val body: JSONObject, val text: String? = null, val projectId: String? = null)
    data class Page(val lane: String, val start: JSONObject, val next: JSONObject?, val after: JSONObject?,
        val pin: Long, val records: List<Record>)
    fun canonical(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",", "{", "}") {
            quote(it) + ":" + canonical(value.get(it))
        }
        is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonical(value.get(it)) }
        is String -> quote(value)
        is Boolean -> value.toString()
        is Number -> if (value.toDouble().isFinite() && value.toDouble() == value.toLong().toDouble()) value.toLong().toString() else JSONObject.numberToString(value)
        else -> error("Unsupported JSON")
    }
    // JSON.stringify escaping, not JSONObject.quote's additional HTML/Unicode escaping.
    private fun quote(value: String): String = buildString {
        append('"')
        for (i in value.indices) {
            val c = value[i]
            when (c) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\t' -> append("\\t")
                '\n' -> append("\\n")
                '\u000C' -> append("\\f")
                '\r' -> append("\\r")
                else -> if (c.code < 32 || c.isHighSurrogate() && (i + 1 == value.length || !value[i + 1].isLowSurrogate()) ||
                    c.isLowSurrogate() && (i == 0 || !value[i - 1].isHighSurrogate())) append("\\u%04x".format(c.code)) else append(c)
            }
        }
        append('"')
    }
    fun digest(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 255) }
    fun string(o: JSONObject, key: String): String = (o.get(key) as? String) ?: error("Invalid $key")
    fun number(o: JSONObject, key: String): Long {
        val n = o.get(key)
        require(n is Int || n is Long) { "Invalid $key" }
        return (n as Number).toLong().also { require(it in 0..9007199254740991L) }
    }
    fun project(o: JSONObject): String? {
        require(o.has("projectId"))
        return if (o.isNull("projectId")) null else string(o, "projectId").also { require(ProjectRequests.validId(it)) }
    }
    fun scope(o: JSONObject, s: Scope, execution: Boolean = true) {
        require(number(o, "schemaVersion") == 1L) { "Unsupported schema" }
        require(string(o, "ownerId") == s.ownerId && string(o, "conversationId") == s.conversationId) { "Foreign owner/chat" }
        if (execution) require(project(o) == s.projectId) { "Foreign project" }
    }
    private fun token(o: JSONObject, s: Scope, kind: String, generation: String?): JSONObject {
        scope(o, s)
        require(string(o, "kind") == kind)
        if (generation != null) require(string(o, "generation") == generation)
        number(o, "sequence")
        if (kind == "snapshot-page") number(o, "offset")
        if (kind == "feed-page") require(number(o, "upper") >= number(o, "sequence"))
        return o
    }
    private fun messages(a: JSONArray, id: String, text: String, answer: String) {
        require(a.length() == 2)
        for ((i, role) in listOf("user", "assistant").withIndex()) {
            val m = a.getJSONObject(i)
            require(string(m, "id") == JSONArray().put(id).put(role).toString())
            require(string(m, "role") == role && string(m, "text") == if (i == 0) text else answer)
        }
    }
    private fun record(r: JSONObject, kind: String, id: String, revision: Long, ordinal: Long, s: Scope): Record {
        require(kind in listOf("turn", "review") && ProjectRequests.validId(id))
        require(revision > 0 && ordinal > 0 && number(r, "revision") == revision && number(r, "ordinal") == ordinal)
        require(string(r, if (kind == "turn") "runId" else "operationId") == id)
        val source = r.getJSONObject("source")
        val sessionId = if (source.isNull("sessionId")) "pocket" else string(source, "sessionId")
        require(string(source, "id") == id && sessionId == s.conversationId && project(source) == s.projectId)
        if (kind == "turn") messages(r.getJSONArray("messages"), id, string(source, "text"), if (source.isNull("answer")) "" else string(source, "answer"))
        return Record(kind, id, revision, ordinal, r, if (kind == "turn") string(source, "text") else null, s.projectId)
    }
    private val events = setOf("turn.accepted", "run.status", "run.progress", "run.result", "run.pending", "run.done", "run.failed", "run.cancelled", "run.interrupted", "review.accepted", "review.running", "review.done", "review.failed", "review.cancelled", "review.interrupted")
    fun page(s: Scope, lane: String, o: JSONObject, requested: JSONObject?): Page {
        scope(o, s, execution = lane != "history")
        if (lane == "history") require(project(o) == null || project(o) == s.projectId) { "Foreign proved project" }
        val items = o.getJSONArray("items")
        require(items.length() <= 200 && o.toString().toByteArray().size <= 1048576)
        val next = if (o.isNull("next")) null else o.getJSONObject("next")
        if (lane == "history") return history(s, o, requested, next)
        require(lane in listOf("snapshot", "feed") && s.projectId != null)
        require(o.get("consistentRead") == true && o.get("liveWrites") == true)
        val generation = string(o, "generation").also { require(it.isNotEmpty()) }
        val after = token(o.getJSONObject("after"), s, "feed-cursor", generation)
        val start: JSONObject
        val pin: Long
        if (lane == "snapshot") {
            pin = number(o, "highWater")
            val snapshot = token(o.getJSONObject("snapshot"), s, "snapshot-page", generation)
            require(number(snapshot, "sequence") == pin && number(snapshot, "offset") == 0L && number(after, "sequence") == pin)
            start = requested ?: snapshot
            token(start, s, "snapshot-page", generation)
            require(number(start, "sequence") == pin)
            next?.let {
                token(it, s, "snapshot-page", generation)
                require(number(it, "sequence") == pin && number(it, "offset") == number(start, "offset") + items.length() && items.length() > 0)
            }
        } else {
            start = token(o.getJSONObject("page"), s, "feed-page", generation)
            pin = number(o, "upper")
            require(number(start, "upper") == pin && requested != null)
            token(requested, s, string(requested, "kind"), generation)
            require(string(requested, "kind") in listOf("feed-cursor", "feed-page"))
            require(number(requested, "sequence") == number(start, "sequence"))
            if (requested.getString("kind") == "feed-page") require(number(requested, "upper") == pin)
        }
        val records = (0 until items.length()).map { i ->
            val item = items.getJSONObject(i)
            if (lane == "snapshot") {
                val revision = number(item, "revision"); require(revision <= pin)
                record(item.getJSONObject("record"), string(item, "kind"), string(item, "id"), revision, number(item, "ordinal"), s)
            } else {
                val e = item.getJSONObject("event"); scope(e, s)
                require(string(e, "generation") == generation)
                val sequence = number(e, "sequence")
                require(sequence == number(start, "sequence") + i + 1 && sequence <= pin)
                require(string(e, "type") in events) { "Reset/unknown event requires fresh snapshot" }
                val kind = string(e, "kind")
                require(e.getString("type").startsWith(if (kind == "review") "review." else if (e.getString("type") == "turn.accepted") "turn." else "run."))
                require(number(e, "revision") == sequence)
                record(item.getJSONObject("record"), kind, string(e, "recordId"), sequence, number(e, "ordinal"), s)
            }
        }
        require(records.map { it.kind to it.id }.distinct().size == records.size || lane == "feed")
        if (lane == "feed") {
            val end = number(start, "sequence") + items.length()
            require(number(after, "sequence") == end && end <= pin)
            require((next == null) == (end == pin))
            next?.let { token(it, s, "feed-page", generation); require(number(it, "sequence") == end && number(it, "upper") == pin && items.length() > 0) }
        }
        return Page(lane, start, next, after, pin, records)
    }
    private fun history(s: Scope, o: JSONObject, requested: JSONObject?, next: JSONObject?): Page {
        require(o.get("readOnly") == true && o.get("executionAuthority") == false)
        val revision = number(o, "revision").also { require(it > 0) }
        fun historyToken(t: JSONObject) {
            scope(t, s, false); require(string(t, "kind") == "history-page" && number(t, "revision") == revision); number(t, "offset")
        }
        val start = requested ?: JSONObject().put("schemaVersion", 1).put("ownerId", s.ownerId).put("conversationId", s.conversationId)
            .put("kind", "history-page").put("revision", revision).put("offset", 0)
        historyToken(start)
        val a = o.getJSONArray("items")
        next?.let { historyToken(it); require(number(it, "offset") == number(start, "offset") + a.length() && a.length() > 0) }
        val rows = (0 until a.length()).map { i ->
            val item = a.getJSONObject(i)
            if (string(item, "kind") == "import") {
                val receipt = item.getJSONObject("receipt"); receipt(s, receipt)
                Record("receipt", string(receipt, "importId"), 0, number(start, "offset") + i + 1, receipt)
            } else {
                require(string(item, "kind") == "evidence")
                require(string(item, "ownerId") == s.ownerId && string(item, "conversationId") == s.conversationId)
                require(item.get("actionable") == false && item.get("executionAuthority") == false)
                require(string(item, "importId").matches(Regex("[a-zA-Z0-9-]{8,80}")))
                val provenance = item.getJSONObject("provenance")
                require(string(provenance, "kind") == "android-v4" && ProjectRequests.validId(string(provenance, "sourceId")))
                val row = item.getJSONObject("evidence"); val id = string(row, "requestId")
                require(ProjectRequests.validId(id))
                val claim = project(row); require(claim == null || s.projectId == null || claim == s.projectId)
                val classification = string(item, "classification")
                require(classification in listOf("backend-reference", "historical-unverified", "unresolved-outbox"))
                val status = string(row, "clientStatus")
                require(status in listOf("sending", "queued", "running", "done", "failed", "cancelled", "interrupted", "unknown"))
                val uncertain = status in listOf("sending", "queued", "running", "interrupted", "unknown")
                if (classification != "backend-reference") require((classification == "unresolved-outbox") == uncertain)
                val messages = item.getJSONArray("messages")
                if (classification == "backend-reference") require(messages.length() == 0)
                else messages(messages, id, string(row, "text"), string(row, "answer"))
                require(number(row, "ordinal") > 0)
                Record("history", id, 0, number(start, "offset") + i + 1, item, string(row, "text"), claim)
            }
        }
        return Page("history", start, next, null, revision, rows)
    }
    fun manifest(s: Scope, m: JSONObject) {
        fun fields(o: JSONObject, allowed: Set<String>) { require(o.keys().asSequence().all { it in allowed }) }
        fields(m, setOf("schemaVersion", "ownerId", "conversationId", "projectId", "importId", "digest", "provenance", "session", "rows"))
        scope(m, s)
        require(string(m, "importId").matches(Regex("[a-zA-Z0-9-]{8,80}")))
        require(canonical(m).toByteArray(Charsets.UTF_8).size <= 65536)
        val unsigned = JSONObject(m.toString()).apply { remove("digest") }
        require(string(m, "digest") == digest(canonical(unsigned)))
        val provenance = m.getJSONObject("provenance")
        fields(provenance, setOf("kind", "sourceId"))
        require(string(provenance, "kind") == "android-v4" && ProjectRequests.validId(string(provenance, "sourceId")))
        val session = m.getJSONObject("session")
        fields(session, setOf("title", "draft", "projectState", "pinned", "finished", "archived", "created", "updated"))
        for (k in listOf("title", "draft", "projectState")) if (session.has(k)) string(session, k)
        for (k in listOf("pinned", "finished", "archived")) if (session.has(k)) require(session.get(k) is Boolean)
        for (k in listOf("created", "updated")) if (session.has(k)) number(session, k)
        val rows = m.getJSONArray("rows"); require(rows.length() <= 100)
        val seen = mutableSetOf<String>(); var ordinal = 0L
        for (i in 0 until rows.length()) {
            val r = rows.getJSONObject(i)
            fields(r, setOf("requestId", "ordinal", "text", "answer", "clientStatus", "projectId", "projectState", "progress", "pending", "createdAt", "sourceRowid"))
            val id = string(r, "requestId"); require(id.matches(Regex("[a-zA-Z0-9-]{8,80}")) && seen.add(id))
            val order = number(r, "ordinal"); require(order > ordinal); ordinal = order
            string(r, "text"); string(r, "answer")
            require(string(r, "clientStatus") in listOf("sending", "queued", "running", "done", "failed", "cancelled", "interrupted", "unknown"))
            val claim = project(r); require(claim == null || claim == s.projectId)
            for (k in listOf("projectState", "progress", "pending")) if (r.has(k)) string(r, k)
            for (k in listOf("createdAt", "sourceRowid")) if (r.has(k)) number(r, k)
        }
    }
    fun receipt(s: Scope, receipt: JSONObject) {
        scope(receipt, s, false)
        require(receipt.get("executionAuthority") == false)
        require(string(receipt, "importId").matches(Regex("[a-zA-Z0-9-]{8,80}")))
        require(string(receipt, "outcome") in listOf("imported", "conflict"))
        require(number(receipt, "revision") > 0)
        require(string(receipt, "digest").matches(Regex("[0-9a-f]{64}")))
        val proof = receipt.getJSONObject("projectEvidence")
        for (field in listOf("claimedProjectId", "provedProjectId")) {
            require(proof.has(field))
            if (!proof.isNull(field)) {
                val id = string(proof, field); require(ProjectRequests.validId(id))
                require(id == s.projectId || field == "claimedProjectId" && s.projectId == null)
            }
        }
    }
}
