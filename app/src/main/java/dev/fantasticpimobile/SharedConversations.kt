package dev.fantasticpimobile

import android.content.ContentValues
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID

/** Foreground adapter, not an executor. Legacy tables remain the local outbox/organization;
 * canonical remote turns live only in ConversationCache. HTTP is injected at the system seam.
 * A lifecycle ticket guards both network chains and local commits, including same-URL re-pairing.
 */
internal class SharedConversations(
    private val history: History,
    private val endpoint: String,
    private val request: (String, JSONObject?, Map<String, String>) -> JSONObject,
    private val connectionCurrent: () -> Boolean = { true },
    private val clock: () -> Long = { android.os.SystemClock.elapsedRealtime() }
) {
    enum class Mode { CHECKING, LEGACY, SHARED, UNAVAILABLE }
    @Volatile var mode = Mode.CHECKING; private set
    @Volatile var message = "Checking shared connection…"; private set
    private val lock = Any()
    private var generation = 0L
    private var enabled = false
    private var verifiedAt = Long.MIN_VALUE
    private val fresh = mutableMapOf<String, Long>()
    private val endpointKey = ConversationCachePolicy.digest(endpoint)
    private val cache = ConversationCache(history)
    private val db get() = history.writableDatabase
    private val clientOwner = "android-client"
    private fun read(chat: String, lane: String, key: String): String? = db.rawQuery(
        "SELECT body FROM conversation_cache WHERE owner=? AND chat=? AND lane=? AND key=?",
        arrayOf(clientOwner, chat, lane, key)).use { if (it.moveToFirst()) it.getString(0) else null }
    private fun write(chat: String, lane: String, key: String, body: String) {
        db.insertWithOnConflict("conversation_cache", null, ContentValues().apply {
            put("owner", clientOwner); put("chat", chat); put("lane", lane); put("key", key); put("body", body)
        }, android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE).also { check(it != -1L) }
    }
    private fun <T> transaction(block: () -> T): T {
        val database = db; database.beginTransaction()
        try { return block().also { database.setTransactionSuccessful() } } finally { database.endTransaction() }
    }
    private fun owner(): String? = read(endpointKey, "connection", "owner")
    fun activate() = synchronized(lock) { generation++; enabled = true; fresh.clear(); mode = Mode.CHECKING }
    fun invalidate() = synchronized(lock) { generation++; enabled = false; fresh.clear(); verifiedAt = Long.MIN_VALUE; mode = Mode.CHECKING }
    private fun ticket(): Long = synchronized(lock) { checkCurrent(generation); generation }
    private fun checkCurrent(ticket: Long) {
        SharedConversationPolicy.requireSafe(enabled && ticket == generation && connectionCurrent(), "Connection or visibility changed; saved work preserved")
    }
    // Cache operations own their transactions, including rollback THEN conflict retention.
    // Wrapping them in an outer SQLite transaction would roll back retained conflicts too.
    private fun <T> commit(ticket: Long, block: () -> T): T = synchronized(lock) { checkCurrent(ticket); block() }
    private fun call(ticket: Long, path: String, body: JSONObject? = null, shared: Boolean = true): JSONObject {
        synchronized(lock) { checkCurrent(ticket) }
        val headers = if (shared) mapOf("X-Conversation-Schema" to "1", "X-Conversation-Owner" to (owner() ?: error("Missing owner")), "X-History-Schema" to "1") else emptyMap()
        val result = request(path, body, headers)
        synchronized(lock) { checkCurrent(ticket) }
        return result
    }
    private fun preflight(ticket: Long): String? {
        val result = call(ticket, "/health", shared = false)
        val proved = SharedConversationPolicy.owner(result, owner())
        commit(ticket) {
            if (proved != null) write(endpointKey, "connection", "owner", proved)
            verifiedAt = clock(); mode = if (proved == null) Mode.LEGACY else Mode.SHARED
        }
        return proved
    }
    private fun entries(): List<JSONObject> = db.rawQuery(
        "SELECT body FROM conversation_cache WHERE owner=? AND chat=? AND lane='catalogue' ORDER BY key", arrayOf(clientOwner, endpointKey)
    ).use { c -> buildList { while (c.moveToNext()) add(JSONObject(c.getString(0))) } }
    private fun entry(id: String) = read(endpointKey, "catalogue", id)?.let(::JSONObject)
    private fun scope(id: String): ConversationCachePolicy.Scope {
        val e = entry(id)
        val project = if (e != null) ConversationCachePolicy.project(e) else history.session(id)?.projectId
        return ConversationCachePolicy.Scope(owner() ?: error("No shared owner"), id, project)
    }
    private fun encoded(token: JSONObject) = URLEncoder.encode(token.toString(), "UTF-8")
    private fun catalogue(ticket: Long) {
        var next: JSONObject? = null
        val seen = mutableSetOf<String>()
        var previous = ""
        do {
            val response = call(ticket, "/v1/conversations?limit=50&maxBytes=262144" + (next?.let { "&token=${encoded(it)}" } ?: ""))
            val rows = SharedConversationPolicy.catalogue(response, owner()!!, previous)
            commit(ticket) {
                for (row in rows) {
                    val id = row.getString("conversationId")
                    SharedConversationPolicy.requireSafe(seen.add(id), "Repeated catalogue identity")
                    val old = entry(id)
                    SharedConversationPolicy.requireSafe(old == null || ConversationCachePolicy.project(old) == ConversationCachePolicy.project(row), "Catalogue project changed")
                    write(endpointKey, "catalogue", id, row.toString()); previous = id
                }
            }
            next = response.optJSONObject("next")
            if (next != null) SharedConversationPolicy.requireSafe(rows.isNotEmpty(), "Catalogue made no progress")
        } while (next != null)
    }
    private fun adopt(ticket: Long, s: ConversationCachePolicy.Scope, lane: String, response: JSONObject, token: JSONObject?) {
        val result = commit(ticket) { cache.apply(s, lane, response, token) }
        SharedConversationPolicy.requireSafe(result.applied, result.reason ?: "Cache conflict; original evidence retained")
    }
    private fun execution(ticket: Long, s: ConversationCachePolicy.Scope) {
        var reset = false
        while (true) {
            val state = cache.state(s, "execution")
            val snapshot = state == null || state.getString("mode") == "snapshot" || reset
            val token = if (reset) null else state?.optJSONObject("next") ?: if (snapshot) null else state?.optJSONObject("after")
            val lane = if (snapshot) "snapshot" else "feed"
            val path = "/v1/conversations/${s.conversationId}" + if (snapshot) "?limit=50&maxBytes=262144" else "/events?limit=50&maxBytes=262144"
            val query = token?.let { "&${if (it.getString("kind") == "feed-cursor") "after" else "token"}=${encoded(it)}" }.orEmpty()
            try {
                val response = call(ticket, path + query)
                adopt(ticket, s, lane, response, token)
                if (response.isNull("next")) break
                reset = false
            } catch (error: Exception) {
                val resettable = error is BridgeException && error.code == 409 || error is SharedConversationException &&
                    (error.message?.contains("Reset/unknown event") == true || error.message?.contains("Feed gap") == true)
                if (!snapshot && !reset && resettable) { reset = true; continue }
                throw error
            }
        }
        commit(ticket) {
            history.ensureRemoteSession(s.conversationId, s.projectId)
            // Recover lost answer acknowledgements from exact canonical receipt evidence,
            // never by sending another answer or creating a new response ID.
            for (record in cache.records(s).filter { it.kind == "turn" }) {
                val source = JSONObject(record.json).getJSONObject("source")
                val receipt = source.optJSONObject("approvalResponse") ?: continue
                val key = "${s.ownerId}:${receipt.optString("approvalId")}"
                val intent = read(s.conversationId, "answer", key)?.let(::JSONObject) ?: continue
                val job = SharedConversationPolicy.job(source, s.conversationId, s.projectId).copy(approvalOccurrenceId = receipt.getString("approvalId"))
                SharedConversationPolicy.validateAnswerReceipt(s.ownerId, job, intent, receipt)
                write(s.conversationId, "answer-receipt", key, receipt.toString())
            }
            fresh[s.conversationId] = clock()
        }
    }
    private fun historyPages(ticket: Long, s: ConversationCachePolicy.Scope) {
        // Refresh from the beginning when the prior pinned history revision is complete.
        var token = cache.state(s, "history")?.optJSONObject("next")
        do {
            val response = call(ticket, "/v1/conversations/${s.conversationId}/history?limit=50&maxBytes=262144" + (token?.let { "&token=${encoded(it)}" } ?: ""))
            adopt(ticket, s, "history", response, token)
            token = response.optJSONObject("next")
        } while (token != null)
        commit(ticket) { history.ensureRemoteSession(s.conversationId, null) }
    }
    private fun imports(ticket: Long, s: ConversationCachePolicy.Scope) {
        val jobs = history.jobs(s.conversationId).filter { !isSharedRequest(it.id) && it.status != "rejected" }
        if (jobs.isEmpty()) return
        var ids = read(s.conversationId, "imports", s.ownerId)?.let(::JSONArray)
        if (ids == null) {
            val manifests = SharedConversationPolicy.manifests(s, history.session(s.conversationId)!!, jobs)
            commit(ticket) {
                for (m in manifests) check(cache.saveImport(s, m).applied) { "Local import inventory conflict" }
                ids = JSONArray(manifests.map { it.getString("importId") })
                write(s.conversationId, "imports", s.ownerId, ids.toString())
            }
        }
        for (i in 0 until ids!!.length()) {
            val id = ids!!.getString(i)
            val savedReceipt = cache.importAcknowledgement(s, id)
            if (savedReceipt != null) {
                SharedConversationPolicy.requireSafe(JSONObject(savedReceipt).getString("outcome") == "imported", "Retained history import conflict requires explicit reconciliation")
                continue
            }
            val manifest = JSONObject(cache.importManifest(s, id) ?: error("Saved export missing"))
            val base = "/v1/conversations/${s.conversationId}/history/imports"
            val recovered = try { call(ticket, "$base/$id?maxBytes=1048576").getJSONArray("items").getJSONObject(0).getJSONObject("receipt") }
                catch (error: BridgeException) { if (error.code == 404) null else throw error }
            val receipt = recovered ?: try { call(ticket, base, manifest) } catch (error: BridgeException) {
                // Conflicts are durable too; recover their exact immutable receipt after HTTP 409.
                if (error.code != 409) throw error
                call(ticket, "$base/$id?maxBytes=1048576").getJSONArray("items").getJSONObject(0).getJSONObject("receipt")
            }
            val accepted = commit(ticket) { cache.acknowledgeImport(s, receipt) }
            SharedConversationPolicy.requireSafe(accepted.applied && receipt.getString("outcome") == "imported", "History import conflict; both sides preserved")
        }
    }
    fun refresh() {
        val ticket = ticket()
        try {
            if (preflight(ticket) == null) { message = "Legacy bridge · shared conversations unavailable"; return }
            // Only locally prepared shared requests can be retried. Old sending rows are evidence.
            var waitingForSlot = false
            for (job in history.activeJobs()) if (isSharedRequest(job.id)) {
                try { recoverSend(ticket, job) } catch (error: BridgeException) {
                    if (error.code !in listOf(409, 429)) throw error
                    // A competing remote admission must still be discovered. Retain the exact
                    // local outbox ID; no replacement request and no guessed remote Stop target.
                    waitingForSlot = true
                }
            }
            catalogue(ticket)
            val ids = (entries().map { it.getString("conversationId") } + history.sessions().filter { history.jobs(it.id).isNotEmpty() }.map { it.id }).distinct()
            for (id in ids) {
                val s = scope(id); val e = entry(id)
                if (e != null && e.opt("executionAvailable") != false) execution(ticket, s)
                imports(ticket, s)
                if (e?.has("historyEvidence") == true || read(id, "imports", s.ownerId) != null) historyPages(ticket, s)
            }
            commit(ticket) { message = if (waitingForSlot) "Remote busy or admission conflict · saved request retained with the same ID" else "Shared conversations · up to date" }
        } catch (_: Exception) {
            synchronized(lock) { if (ticket == generation && enabled) { mode = Mode.UNAVAILABLE; fresh.clear(); message = "Shared status unavailable or conflicting · saved work preserved" } }
        }
    }
    fun isSharedRequest(id: String) = read(id, "send", "target") != null
    fun sharedRequired() = owner() != null || mode != Mode.LEGACY
    fun live(id: String): Boolean = synchronized(lock) {
        enabled && connectionCurrent() && mode == Mode.SHARED && clock() - (fresh[id] ?: Long.MIN_VALUE / 2) in 0..10000
    }
    fun readOnly(id: String): Boolean = entry(id)?.opt("executionAvailable") == false
    fun canSend(id: String): Boolean = synchronized(lock) {
        if (!enabled || !connectionCurrent() || mode != Mode.SHARED || clock() - verifiedAt !in 0..10000) return@synchronized false
        val e = entry(id)
        if (e != null && (!live(id) || e.opt("executionAvailable") == false)) return@synchronized false
        val chat = history.session(id) ?: return@synchronized false
        chat.projectId != null && !chat.archived && jobs(id).none { it.active } && history.jobs(id).none {
            it.status in listOf("sending", "queued", "running", "interrupted", "unknown") && !isSharedRequest(it.id) && cache.outboxLink(scope(id), it.id)?.optString("classification") != "backend-reference"
        }
    }
    fun prepareSend(id: String, text: String): String = synchronized(lock) {
        SharedConversationPolicy.requireSafe(canSend(id), "Refresh/reconcile this chat before Send; no request submitted")
        val requestId = UUID.randomUUID().toString()
        transaction {
            history.add(requestId, id, text)
            write(requestId, "send", "target", JSONObject().put("ownerId", owner()).put("endpoint", endpointKey)
                .put("projectId", history.session(id)!!.projectId).put("conversationId", id).put("text", text).toString())
        }
        requestId
    }
    private fun recoverSend(ticket: Long, job: Job) {
        val target = JSONObject(read(job.id, "send", "target") ?: error("Missing shared outbox identity"))
        SharedConversationPolicy.requireSafe(target.getString("ownerId") == owner() && target.getString("endpoint") == endpointKey &&
            target.getString("conversationId") == job.sessionId && target.getString("projectId") == job.projectId && target.getString("text") == job.text, "Saved shared target changed; nothing submitted")
        val result = try { call(ticket, "/v1/jobs/${job.id}") } catch (error: BridgeException) {
            if (error.code != 404 || job.status != "sending") throw error
            call(ticket, "/v1/jobs", JSONObject(target.toString()).apply { remove("endpoint"); put("requestId", job.id) })
        }
        ProjectRequests.validateJob(job, job.projectId, result)
        SharedConversationPolicy.requireSafe(result.optString("text") == job.text, "Saved request text conflicts with backend; nothing adopted")
        commit(ticket) { history.acceptResponse(job.id, result) }
    }
    fun jobs(id: String): List<Job> = synchronized(lock) {
        if (owner() == null) return@synchronized history.jobs(id).map { it.copy(pending = "") }
        val s = scope(id)
        val canonical = cache.records(s).filter { it.kind == "turn" }.map { SharedConversationPolicy.job(JSONObject(it.json).getJSONObject("source"), id, s.projectId) }
        val remoteIds = canonical.map { it.id }.toSet()
        val local = history.jobs(id).filter { it.id !in remoteIds }
        val historical = cache.records(s, true).filter { it.kind == "history" }.mapNotNull {
            val body = JSONObject(it.json)
            if (body.getString("classification") == "backend-reference") null else {
                val row = body.getJSONObject("evidence")
                Job(row.getString("requestId"), row.getString("text"), "historical", row.getString("answer"), id,
                    body.getString("classification"), "", ConversationCachePolicy.project(row), ProjectState.LEGACY_UNRESOLVED)
            }
        }.filter { h -> h.id !in remoteIds && local.none { it.id == h.id } }
        // Local-only pending rows are never live approvals, even after import acknowledgement.
        val inertLocal = local.map { if (!isSharedRequest(it.id)) it.copy(pending = "", progress = "Historical/unresolved local evidence · not resubmitted") else it }
        canonical + historical + inertLocal
    }
    fun sessions(): List<ChatSession> = synchronized(lock) {
        history.sessions().map { chat ->
            val turns = jobs(chat.id)
            val canonicalLast = if (owner() == null) null else cache.records(scope(chat.id)).lastOrNull { it.kind == "turn" }?.id
            val current = turns.firstOrNull { it.active } ?: turns.firstOrNull { it.id == canonicalLast } ?: turns.lastOrNull()
            chat.copy(status = current?.status, needsApproval = current?.pending?.isNotEmpty() == true && live(chat.id))
        }
    }
    fun current(job: Job): Boolean = live(job.sessionId) && cache.records(scope(job.sessionId)).any {
        it.kind == "turn" && it.id == job.id && SharedConversationPolicy.job(JSONObject(it.json).getJSONObject("source"), job.sessionId, job.projectId) == job
    }
    fun canApprove(job: Job): Boolean = current(job) && job.active && job.approvalOccurrenceId != null && job.pending.isNotEmpty() &&
        read(job.sessionId, "answer", "${owner()}:${job.approvalOccurrenceId}") == null
    private fun freshJob(ticket: Long, job: Job): JSONObject {
        preflight(ticket)
        SharedConversationPolicy.requireSafe(mode == Mode.SHARED && live(job.sessionId), "Refresh this run before acting")
        val result = call(ticket, "/v1/jobs/${job.id}")
        ProjectRequests.validateJob(job, job.projectId, result)
        return result
    }
    fun answer(job: Job, answer: JSONObject) {
        val ticket = ticket()
        SharedConversationPolicy.requireSafe(canApprove(job), "Approval is stale or already attempted")
        val current = freshJob(ticket, job)
        SharedConversationPolicy.requireSafe(current.optString("approvalOccurrenceId") == job.approvalOccurrenceId && current.optString("status") in listOf("queued", "running") &&
            ConversationCachePolicy.canonical(current.optJSONObject("pending")) == ConversationCachePolicy.canonical(JSONObject(job.pending)), "Approval changed; nothing answered")
        val key = "${owner()}:${job.approvalOccurrenceId}"
        val body = JSONObject().put("runId", job.id).put("projectId", job.projectId).put("responseId", UUID.randomUUID().toString()).put("answer", JSONObject(answer.toString()))
        commit(ticket) {
            SharedConversationPolicy.requireSafe(read(job.sessionId, "answer", key) == null, "Answer already saved; do not replay")
            write(job.sessionId, "answer", key, body.toString()) // Persist intent before any HTTP attempt.
        }
        val receipt = call(ticket, "/v1/conversations/${job.sessionId}/approvals/${URLEncoder.encode(job.approvalOccurrenceId, "UTF-8").replace("+", "%20")}/response", body)
        SharedConversationPolicy.validateAnswerReceipt(owner()!!, job, body, receipt)
        commit(ticket) { write(job.sessionId, "answer-receipt", key, receipt.toString()); fresh.remove(job.sessionId) }
    }
    /** Owner-gated existing review transport. Saved operation JSON stays byte-for-byte local. */
    fun requestScoped(path: String, body: JSONObject? = null): JSONObject {
        val ticket = ticket()
        val proved = preflight(ticket)
        val operation = body?.optString("operationId")?.takeIf { it.isNotBlank() }
            ?: Regex("/actions/([a-zA-Z0-9-]{8,80})(?:/cancel)?$").find(path)?.groupValues?.get(1)
        if (operation != null) {
            commit(ticket) {
                val saved = read(operation, "review", "target")
                val target = JSONObject().put("endpoint", endpointKey).put("ownerId", proved ?: JSONObject.NULL).toString()
                SharedConversationPolicy.requireSafe(saved == null || saved == target, "Saved repository action owner changed; operation preserved")
                if (proved != null && saved == null && body?.has("operationId") == true) write(operation, "review", "target", target)
            }
        }
        return call(ticket, path, body, shared = proved != null)
    }
    fun stop(job: Job) {
        val ticket = ticket()
        SharedConversationPolicy.requireSafe(current(job), "Refresh the exact current run before Stop")
        freshJob(ticket, job)
        val result = call(ticket, "/v1/jobs/${job.id}/cancel", JSONObject().put("conversationId", job.sessionId).put("projectId", job.projectId))
        SharedConversationPolicy.requireSafe(result.optString("runId") == job.id, "Stop receipt target mismatch")
        commit(ticket) { fresh.remove(job.sessionId) }
    }
}
