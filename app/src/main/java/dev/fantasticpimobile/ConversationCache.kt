package dev.fantasticpimobile

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject

/** Additive, inert cache over History's connection. Never writes sessions/jobs/preferences.
 * All evidence is private history; do not log payloads. No transport or execution dependency.
 */
internal class ConversationCache(private val history: History) {
    data class Result(val applied: Boolean, val duplicate: Boolean = false, val reason: String? = null)
    data class Evidence(val kind: String, val id: String, val ordinal: Long, val json: String) {
        val actionable: Boolean get() = false
        val executionAuthority: Boolean get() = false
    }
    companion object {
        fun create(db: SQLiteDatabase) {
            db.execSQL("CREATE TABLE conversation_cache (owner TEXT NOT NULL, chat TEXT NOT NULL, lane TEXT NOT NULL, key TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(owner,chat,lane,key))")
            db.execSQL("CREATE TABLE conversation_cache_conflicts (owner TEXT NOT NULL, chat TEXT NOT NULL, digest TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(owner,chat,digest))")
        }
    }
    private val db get() = history.writableDatabase
    private fun key(vararg parts: Any): String = JSONArray(parts.toList()).toString()
    private fun get(s: ConversationCachePolicy.Scope, lane: String, key: String): String? = db.rawQuery(
        "SELECT body FROM conversation_cache WHERE owner=? AND chat=? AND lane=? AND key=?", arrayOf(s.ownerId, s.conversationId, lane, key)
    ).use { if (it.moveToFirst()) it.getString(0) else null }
    private fun put(s: ConversationCachePolicy.Scope, lane: String, key: String, body: String) {
        db.insertWithOnConflict("conversation_cache", null, ContentValues().apply {
            put("owner", s.ownerId); put("chat", s.conversationId); put("lane", lane); put("key", key); put("body", body)
        }, SQLiteDatabase.CONFLICT_REPLACE).also { check(it != -1L) }
    }
    private fun immutable(s: ConversationCachePolicy.Scope, lane: String, key: String, body: String) {
        val old = get(s, lane, key)
        check(old == null || old == body) { "Conflicting immutable $lane evidence" }
        if (old == null) put(s, lane, key, body)
    }
    private fun rows(s: ConversationCachePolicy.Scope, lane: String): List<Pair<String, String>> = db.rawQuery(
        "SELECT key,body FROM conversation_cache WHERE owner=? AND chat=? AND lane=? ORDER BY key", arrayOf(s.ownerId, s.conversationId, lane)
    ).use { c -> buildList { while (c.moveToNext()) add(c.getString(0) to c.getString(1)) } }
    private fun <T> transaction(block: () -> T): T {
        val database = db
        database.beginTransaction()
        try { return block().also { database.setTransactionSuccessful() } } finally { database.endTransaction() }
    }
    private fun reject(s: ConversationCachePolicy.Scope, input: String, reason: String): Result = transaction {
        // Include original local inventory as it was when rejected, not a lossy replacement.
        val body = JSONObject().put("input", input).put("reason", reason).put("local", localInventory(s)).toString()
        db.execSQL("INSERT OR IGNORE INTO conversation_cache_conflicts(owner,chat,digest,body) VALUES (?,?,?,?)",
            arrayOf(s.ownerId, s.conversationId, ConversationCachePolicy.digest(body), body))
        Result(false, reason = reason)
    }
    private fun localInventory(s: ConversationCachePolicy.Scope): JSONArray = JSONArray(history.jobs(s.conversationId).map(::local))
    private fun local(j: Job) = JSONObject().put("id", j.id).put("sessionId", j.sessionId).put("text", j.text)
        .put("answer", j.answer).put("status", j.status).put("progress", j.progress).put("pending", j.pending)
        .put("projectId", j.projectId ?: JSONObject.NULL).put("projectState", j.projectState.name)
    private fun validateScope(s: ConversationCachePolicy.Scope) {
        val saved = get(s, "scope", "project")
        check(saved == null || saved == ConversationCachePolicy.canonical(s.projectId)) { "Cached project scope conflict" }
    }
    private fun rememberScope(s: ConversationCachePolicy.Scope) {
        immutable(s, "scope", "project", ConversationCachePolicy.canonical(s.projectId))
    }
    private fun claim(s: ConversationCachePolicy.Scope, projectId: String?) {
        // Non-null historical claims must agree, but never become a proved binding.
        if (projectId != null) immutable(s, "project-claim", "historical", ConversationCachePolicy.canonical(projectId))
    }
    private fun validateLocal(s: ConversationCachePolicy.Scope) {
        validateScope(s)
        val project = history.session(s.conversationId)?.projectId
        check(project == null || project == s.projectId) { "Local project conflict" }
        check(history.jobs(s.conversationId).all { it.projectId == null || it.projectId == s.projectId }) { "Local request project conflict" }
    }
    private fun link(s: ConversationCachePolicy.Scope, r: ConversationCachePolicy.Record) {
        if (r.kind !in listOf("turn", "history")) return
        val j = db.rawQuery("SELECT sessionId FROM jobs WHERE id=?", arrayOf(r.id)).use { c ->
            if (!c.moveToFirst()) null else {
                check(c.getString(0) == s.conversationId) { "Local request chat conflict" }
                history.jobs(s.conversationId).single { it.id == r.id }
            }
        } ?: return
        check(j.text == r.text && (j.projectId == null || r.projectId == null || j.projectId == r.projectId)) { "Local request content/project conflict" }
        immutable(s, "outbox-evidence", key(j.id, ConversationCachePolicy.digest(local(j).toString())), local(j).toString())
        // The link records comparison, NOT acceptance, completion or retry permission.
        val link = JSONObject().put("requestId", j.id).put("kind", r.kind)
            .put("classification", if (r.kind == "turn") "backend-reference" else r.body.getString("classification"))
            .put("actionable", false).put("executionAuthority", false).toString()
        immutable(s, "link-evidence", key(j.id, ConversationCachePolicy.digest(link)), link)
        val prior = get(s, "outbox-link", j.id)?.let(::JSONObject)
        if (prior?.getString("classification") != "backend-reference" || r.kind == "turn") put(s, "outbox-link", j.id, link)
    }
    fun state(s: ConversationCachePolicy.Scope, lane: String): JSONObject? {
        validateScope(s)
        return get(s, "state", lane)?.let(::JSONObject)
    }
    fun outboxLink(s: ConversationCachePolicy.Scope, requestId: String): JSONObject? {
        validateScope(s)
        return get(s, "outbox-link", requestId)?.let(::JSONObject)
    }
    fun conflicts(s: ConversationCachePolicy.Scope): List<String> = db.rawQuery(
        "SELECT body FROM conversation_cache_conflicts WHERE owner=? AND chat=? ORDER BY digest", arrayOf(s.ownerId, s.conversationId)
    ).use { c -> buildList { while (c.moveToNext()) add(c.getString(0)) } }
    fun records(s: ConversationCachePolicy.Scope, historical: Boolean = false): List<Evidence> {
        validateScope(s)
        return rows(s, if (historical) "history-head" else "head").map { (_, body) ->
            val r = JSONObject(body)
            Evidence(r.getString("kind"), r.getString("id"), r.getLong("ordinal"), r.getString("body"))
        }.sortedWith(compareBy({ it.kind }, { it.ordinal }, { it.id }))
    }

    /** requested is the exact saved token used on the wire; null starts a fresh snapshot/history.
     * A partial snapshot is staged, not made visible. Its after is committed only on the last page.
     * Feed cursor and visible revisions are committed together on every page.
     * Unexpected storage/fault exceptions propagate after rollback, not converted into success.
     */
    fun apply(s: ConversationCachePolicy.Scope, lane: String, envelope: JSONObject, requested: JSONObject? = null,
        beforeCommit: (() -> Unit)? = null): Result {
        val input = ConversationCachePolicy.canonical(envelope)
        val savedEnvelope = JSONObject(input)
        val request = requested?.let { JSONObject(ConversationCachePolicy.canonical(it)) }
        val page = try { ConversationCachePolicy.page(s, lane, savedEnvelope, request) }
        catch (e: IllegalArgumentException) { return reject(s, input, e.message ?: "Invalid page") }
        catch (e: IllegalStateException) { return reject(s, input, e.message ?: "Invalid page") }
        catch (_: org.json.JSONException) { return reject(s, input, "Malformed page") }
        // Semantic rejection must roll back all page changes before preserving conflicting evidence.
        return try { transaction {
            validateLocal(s)
            rememberScope(s)
            val batchKey = key(lane, ConversationCachePolicy.canonical(page.start))
            val oldPage = get(s, "page", batchKey)
            if (oldPage != null) {
                check(oldPage == input) { "Changed duplicate page" }
                return@transaction Result(true, duplicate = true)
            }
            val stateLane = if (lane == "history") "history" else "execution"
            val old = state(s, stateLane)
            if (lane == "feed") {
                check(old != null && old.getString("mode") in listOf("ready", "feed")) { "Snapshot incomplete" }
                val expected = if (!old!!.isNull("next")) old.getJSONObject("next") else old.getJSONObject("after")
                check(ConversationCachePolicy.canonical(expected) == ConversationCachePolicy.canonical(request)) { "Feed gap/stale cursor" }
            } else if (request != null) {
                check(old != null && old.getString("mode") == lane && !old.isNull("next") &&
                    ConversationCachePolicy.canonical(old.getJSONObject("next")) == ConversationCachePolicy.canonical(request)) { "Page gap/stale continuation" }
            } else {
                // Fresh snapshots may reset generation, never rewind the same generation.
                if (old != null && lane == "snapshot" && old.has("after") && !old.isNull("after")) {
                    val prior = old.getJSONObject("after")
                    if (prior.getString("generation") == page.after!!.getString("generation"))
                        check(page.pin >= prior.getLong("sequence")) { "Snapshot rewind" }
                }
                if (old != null && lane == "history") check(page.pin >= old.getLong("pin")) { "History rewind" }
                db.delete("conversation_cache", "owner=? AND chat=? AND lane=?", arrayOf(s.ownerId, s.conversationId, "stage-$lane"))
            }
            if (lane != "history") claim(s, s.projectId)
            for (r in page.records) {
                if (r.kind == "history") claim(s, r.projectId)
                if (r.kind == "receipt") {
                    val proof = r.body.getJSONObject("projectEvidence")
                    if (!proof.isNull("claimedProjectId")) claim(s, proof.getString("claimedProjectId"))
                }
                link(s, r)
                val body = ConversationCachePolicy.canonical(r.body)
                val generation = if (lane == "history") "history" else savedEnvelope.getString("generation")
                immutable(s, "record", key(generation, r.kind, r.id, r.revision), body)
                if (r.kind in listOf("turn", "review")) {
                    val priorHead = get(s, "head", key(r.kind, r.id))?.let(::JSONObject)
                    if (priorHead != null) {
                        val priorBody = JSONObject(priorHead.getString("body"))
                        check(priorHead.getLong("ordinal") == r.ordinal) { "Record order conflict" }
                        if (r.kind == "turn") check(priorBody.getJSONObject("source").getString("text") == r.text) { "Remote request text conflict" }
                        else check(ConversationCachePolicy.canonical(priorBody.getJSONObject("source").opt("input")) ==
                            ConversationCachePolicy.canonical(r.body.getJSONObject("source").opt("input"))) { "Remote review input conflict" }
                    }
                }
                val wrapped = JSONObject().put("kind", r.kind).put("id", r.id).put("ordinal", r.ordinal).put("body", body).toString()
                val target = if (lane == "feed") "head" else "stage-$lane"
                val headKey = key(r.kind, r.id)
                val prior = get(s, target, headKey)?.let(::JSONObject)
                if (lane != "feed") check(prior == null) { "Duplicate ID across snapshot/history pages" }
                put(s, target, headKey, wrapped)
            }
            if (lane != "feed" && page.next == null) {
                val target = if (lane == "history") "history-head" else "head"
                db.delete("conversation_cache", "owner=? AND chat=? AND lane=?", arrayOf(s.ownerId, s.conversationId, target))
                val staged = rows(s, "stage-$lane")
                if (lane == "snapshot") for (kind in listOf("turn", "review")) {
                    val ordinals = staged.map { JSONObject(it.second) }.filter { it.getString("kind") == kind }.map { it.getLong("ordinal") }.sorted()
                    check(ordinals == (1L..ordinals.size.toLong()).toList()) { "Snapshot ordinal gap" }
                }
                for ((k, body) in staged) put(s, target, k, body)
            }
            put(s, "page", batchKey, input)
            put(s, "state", stateLane, JSONObject().put("mode", if (page.next == null) "ready" else lane)
                .put("pin", page.pin).put("next", page.next ?: JSONObject.NULL)
                .put("after", if (lane == "snapshot" && page.next != null) old?.optJSONObject("after") ?: JSONObject.NULL else page.after ?: JSONObject.NULL).toString())
            beforeCommit?.invoke()
            Result(true)
        } } catch (e: IllegalStateException) {
            // Test/storage faults must remain observable; semantic checks have no external effects.
            if (beforeCommit != null) throw e
            reject(s, input, e.message ?: "Conflict")
        }
    }
    /** Save exact bounded export before transport so lost acknowledgements reuse import ID/digest. */
    fun saveImport(s: ConversationCachePolicy.Scope, inputManifest: JSONObject): Result {
        val input = ConversationCachePolicy.canonical(inputManifest)
        val manifest = JSONObject(input)
        return try { transaction {
            validateLocal(s); ConversationCachePolicy.manifest(s, manifest)
            rememberScope(s)
            claim(s, ConversationCachePolicy.project(manifest))
            val id = ConversationCachePolicy.string(manifest, "importId")
            // Import IDs are owner-global, just like the server's receipts.
            val elsewhere = db.rawQuery("SELECT chat,body FROM conversation_cache WHERE owner=? AND lane='manifest' AND key=?", arrayOf(s.ownerId, id)).use { c ->
                buildList { while (c.moveToNext()) add(c.getString(0) to c.getString(1)) }
            }
            check(elsewhere.all { it.first == s.conversationId && it.second == input }) { "Import ID reused" }
            if (elsewhere.isNotEmpty()) return@transaction Result(true, duplicate = true)
            val manifestRows = manifest.getJSONArray("rows")
            val seen = mutableSetOf<String>()
            var ordinal = 0L
            for (i in 0 until manifestRows.length()) {
                val row = manifestRows.getJSONObject(i)
                val requestId = ConversationCachePolicy.string(row, "requestId")
                require(seen.add(requestId))
                val order = ConversationCachePolicy.number(row, "ordinal"); require(order > ordinal); ordinal = order
                val saved = history.jobs(s.conversationId).singleOrNull { it.id == requestId } ?: error("Unknown local export row")
                check(row.getString("text") == saved.text && row.getString("answer") == saved.answer && row.getString("clientStatus") == saved.status &&
                    ConversationCachePolicy.project(row) == saved.projectId) { "Export inventory conflict" }
                if (row.has("pending")) check(row.getString("pending") == saved.pending)
                if (row.has("progress")) check(row.getString("progress") == saved.progress)
            }
            immutable(s, "manifest", id, input)
            immutable(s, "import-inventory", id, ConversationCachePolicy.canonical(localInventory(s)))
            Result(true)
        } } catch (e: IllegalArgumentException) { reject(s, input, e.message ?: "Invalid manifest") }
        catch (e: IllegalStateException) { reject(s, input, e.message ?: "Import conflict") }
        catch (_: org.json.JSONException) { reject(s, input, "Malformed manifest") }
    }
    fun acknowledgeImport(s: ConversationCachePolicy.Scope, inputReceipt: JSONObject, beforeCommit: (() -> Unit)? = null): Result {
        val input = ConversationCachePolicy.canonical(inputReceipt)
        val receipt = JSONObject(input)
        return try { transaction {
            validateLocal(s)
            ConversationCachePolicy.receipt(s, receipt)
            val id = ConversationCachePolicy.string(receipt, "importId")
            val manifest = JSONObject(get(s, "manifest", id) ?: error("Unknown local import"))
            check(manifest.getString("digest") == receipt.getString("digest")) { "Import digest conflict" }
            check(ConversationCachePolicy.canonical(manifest.get("projectId")) ==
                ConversationCachePolicy.canonical(receipt.getJSONObject("projectEvidence").get("claimedProjectId"))) { "Import project claim conflict" }
            claim(s, ConversationCachePolicy.project(manifest))
            val old = get(s, "ack", id)
            if (old != null) {
                check(old == input) { "Conflicting immutable acknowledgement" }
                return@transaction Result(true, duplicate = true)
            }
            val rows = manifest.getJSONArray("rows")
            val decisions = receipt.getJSONArray("decisions")
            if (receipt.getString("outcome") == "conflict") require(decisions.length() == 0 && receipt.getJSONArray("conflicts").length() > 0)
            else {
                require(receipt.getJSONArray("conflicts").length() == 0 && decisions.length() == rows.length())
                for (i in 0 until rows.length()) {
                    val row = rows.getJSONObject(i); val d = decisions.getJSONObject(i)
                    require(d.getString("requestId") == row.getString("requestId"))
                    val classification = d.getString("classification")
                    require(classification in listOf("backend-reference", "historical-unverified", "unresolved-outbox"))
                    if (classification == "backend-reference") require(d.getString("canonicalRunId") == row.getString("requestId"))
                    else require((classification == "unresolved-outbox") == (row.getString("clientStatus") in listOf("sending", "queued", "running", "interrupted", "unknown")))
                    link(s, ConversationCachePolicy.Record("history", row.getString("requestId"), 0, row.getLong("ordinal"),
                        JSONObject().put("classification", classification), row.getString("text"), ConversationCachePolicy.project(row)))
                }
            }
            immutable(s, "ack", id, input)
            beforeCommit?.invoke()
            Result(true)
        } } catch (e: IllegalArgumentException) { reject(s, input, e.message ?: "Invalid acknowledgement") }
        catch (e: IllegalStateException) { if (beforeCommit != null) throw e else reject(s, input, e.message ?: "Acknowledgement conflict") }
        catch (_: org.json.JSONException) { reject(s, input, "Malformed acknowledgement") }
    }
    fun importManifest(s: ConversationCachePolicy.Scope, id: String): String? {
        validateScope(s)
        return get(s, "manifest", id)
    }
    fun importAcknowledgement(s: ConversationCachePolicy.Scope, id: String): String? {
        validateScope(s)
        return get(s, "ack", id)
    }
}
