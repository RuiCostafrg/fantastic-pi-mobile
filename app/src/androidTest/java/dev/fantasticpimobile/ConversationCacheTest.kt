package dev.fantasticpimobile

import android.database.sqlite.SQLiteDatabase
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Fixture-only real SQLite tests. Compile does not mean these have run on a device. */
@RunWith(AndroidJUnit4::class)
class ConversationCacheTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val owner = "11111111-1111-4111-8111-111111111111"
    private fun database(block: (String) -> Unit) {
        assumeTrue("Separate fixture only", context.packageName == "dev.fantasticpimobile.reliability")
        val name = "cache-${UUID.randomUUID()}.sqlite"
        try { block(name) } finally { context.deleteDatabase(name) }
    }
    private fun scope(chat: String = "pocket", project: String? = "project-a") = ConversationCachePolicy.Scope(owner, chat, project)
    private fun token(s: ConversationCachePolicy.Scope, kind: String, sequence: Long, offset: Int = 0) = JSONObject()
        .put("schemaVersion", 1).put("ownerId", s.ownerId).put("conversationId", s.conversationId).put("projectId", s.projectId ?: JSONObject.NULL)
        .put("generation", "generation-a").put("kind", kind).put("sequence", sequence)
        .apply { if (kind == "snapshot-page") put("offset", offset) }
    private fun messages(id: String, answer: String = "Answer") = JSONArray(listOf("user", "assistant").map { role ->
        JSONObject().put("id", JSONArray().put(id).put(role).toString()).put("role", role).put("text", if (role == "user") "Question" else answer)
    })
    private fun item(s: ConversationCachePolicy.Scope, id: String = "request-0001", revision: Long = 1, ordinal: Long = 1, answer: String = "Answer"): JSONObject {
        val record = JSONObject().put("runId", id).put("revision", revision).put("ordinal", ordinal).put("messages", messages(id, answer))
            .put("source", JSONObject().put("id", id).put("sessionId", s.conversationId).put("projectId", s.projectId)
                .put("text", "Question").put("answer", answer).put("status", "done").put("pending", JSONObject().put("id", "stale-dialog")))
        return JSONObject().put("kind", "turn").put("id", id).put("revision", revision).put("ordinal", ordinal).put("record", record)
    }
    private fun snapshot(s: ConversationCachePolicy.Scope, items: JSONArray, high: Long = 1, next: JSONObject? = null) = token(s, "envelope", high)
        .put("consistentRead", true).put("liveWrites", true).put("snapshot", token(s, "snapshot-page", high)).put("highWater", high)
        .put("after", token(s, "feed-cursor", high)).put("items", items).put("next", next ?: JSONObject.NULL)
    private fun dump(db: SQLiteDatabase, table: String): List<String> = db.rawQuery("SELECT rowid,* FROM $table ORDER BY rowid", null).use { c ->
        buildList { while (c.moveToNext()) add((0 until c.columnCount).joinToString("|") { if (c.isNull(it)) "<null>" else c.getString(it) }) }
    }
    @Test fun supportedVersionsOneThroughFourUpgradeAdditivelyAndReopen() {
        for (version in 1..4) database { name ->
            val path = context.getDatabasePath(name); path.parentFile!!.mkdirs()
            val before: List<String>
            val sessions: List<String>?
            SQLiteDatabase.openOrCreateDatabase(path, null).use { db ->
                db.execSQL("CREATE TABLE jobs (id TEXT PRIMARY KEY,text TEXT NOT NULL,status TEXT NOT NULL,answer TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL)")
                if (version >= 2) {
                    db.execSQL("ALTER TABLE jobs ADD COLUMN sessionId TEXT NOT NULL DEFAULT 'pocket'")
                    db.execSQL("ALTER TABLE jobs ADD COLUMN progress TEXT NOT NULL DEFAULT ''")
                    db.execSQL("ALTER TABLE jobs ADD COLUMN pending TEXT NOT NULL DEFAULT ''")
                    db.execSQL("CREATE TABLE sessions (id TEXT PRIMARY KEY,title TEXT NOT NULL,draft TEXT NOT NULL DEFAULT '',pinned INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL)")
                    db.execSQL("INSERT INTO sessions VALUES ('pocket','Exact title','Exact draft',1,10,20)")
                    db.execSQL("CREATE INDEX jobs_session_created ON jobs(sessionId,created)")
                }
                if (version >= 3) {
                    db.execSQL("ALTER TABLE sessions ADD COLUMN finished INTEGER NOT NULL DEFAULT 0")
                    db.execSQL("ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
                    db.execSQL("UPDATE sessions SET finished=1,archived=1")
                }
                if (version >= 4) for (table in listOf("jobs", "sessions")) {
                    db.execSQL("ALTER TABLE $table ADD COLUMN projectId TEXT")
                    db.execSQL("ALTER TABLE $table ADD COLUMN projectState TEXT NOT NULL DEFAULT 'LEGACY_UNRESOLVED'")
                }
                db.execSQL("INSERT INTO jobs (id,text,status,answer,created) VALUES ('request-z-first','Question','sending','Saved',10)")
                db.execSQL("INSERT INTO jobs (id,text,status,answer,created) VALUES ('request-a-second','Other','interrupted','',10)")
                if (version >= 2) db.execSQL("UPDATE jobs SET pending='{\"id\":\"cached-dialog\"}',progress='Saved progress' WHERE id='request-z-first'")
                before = dump(db, "jobs"); sessions = if (version >= 2) dump(db, "sessions") else null
                db.version = version
            }
            repeat(2) {
                History(context, name).use { history ->
                    val db = history.writableDatabase
                    assertEquals(5, db.version)
                    // Every original column and rowid is an identical prefix; only additive fields follow.
                    assertEquals(before, dump(db, "jobs").map { it.split('|').take(before.first().split('|').size).joinToString("|") })
                    if (sessions != null) assertEquals(sessions, dump(db, "sessions").map { it.split('|').take(sessions.first().split('|').size).joinToString("|") })
                    assertEquals(listOf("request-z-first", "request-a-second"), history.jobs("pocket").map { it.id })
                    assertTrue(ConversationCache(history).records(scope(project = null)).isEmpty())
                    assertNull(ConversationCache(history).outboxLink(scope(project = null), "request-z-first"))
                }
            }
        }
    }
    @Test fun failedV4UpgradeRollsBackAddedTablesAndVersionThenRetriesCleanly() = database { name ->
        History(context, name).use { h ->
            h.add("request-0001", "pocket", "Question")
            h.writableDatabase.execSQL("DROP TABLE conversation_cache")
            h.writableDatabase.execSQL("DROP TABLE conversation_cache_conflicts")
            h.writableDatabase.execSQL("CREATE TABLE conversation_cache_conflicts (fixtureCollision TEXT)")
            h.writableDatabase.version = 4
        }
        History(context, name).use { h ->
            try { h.writableDatabase; fail("Upgrade should fail") } catch (_: android.database.sqlite.SQLiteException) { }
        }
        SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READWRITE).use { db ->
            assertEquals(4, db.version)
            assertFalse(db.rawQuery("SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversation_cache'", null).use { it.moveToFirst() })
            assertEquals("request-0001", db.rawQuery("SELECT id FROM jobs", null).use { it.moveToFirst(); it.getString(0) })
            db.execSQL("DROP TABLE conversation_cache_conflicts")
        }
        History(context, name).use { h ->
            assertEquals(5, h.writableDatabase.version)
            assertEquals("sending", h.jobs("pocket").single().status)
            assertTrue(ConversationCache(h).records(scope(project = null)).isEmpty())
        }
    }
    @Test fun partialSnapshotsDuplicatesCursorAndRemoteCompletionSurviveReopen() = database { name ->
        val s = scope()
        val next = token(s, "snapshot-page", 2, 1)
        val first = snapshot(s, JSONArray().put(item(s)), 2, next)
        History(context, name).use { history ->
            val cache = ConversationCache(history)
            assertTrue(cache.apply(s, "snapshot", first).applied)
            assertTrue(cache.records(s).isEmpty())
            assertTrue(cache.state(s, "execution")!!.isNull("after"))
            assertTrue(cache.apply(s, "snapshot", first).duplicate)
        }
        History(context, name).use { history ->
            val cache = ConversationCache(history)
            val duplicateId = snapshot(s, JSONArray().put(item(s)), 2)
            assertFalse(cache.apply(s, "snapshot", duplicateId, next).applied)
            assertTrue(cache.records(s).isEmpty()); assertTrue(cache.state(s, "execution")!!.isNull("after"))
            val last = snapshot(s, JSONArray().put(item(s, "remote-completed", 2, 2)), 2)
            assertTrue(cache.apply(s, "snapshot", last, next).applied)
            assertEquals(listOf("request-0001", "remote-completed"), cache.records(s).map { it.id })
            assertTrue(cache.records(s).none { it.actionable || it.executionAuthority })
            assertEquals(2, cache.state(s, "execution")!!.getJSONObject("after").getInt("sequence"))
            assertTrue(history.jobs(s.conversationId).isEmpty()) // no job/admission from discovery
            assertTrue(cache.apply(s, "snapshot", last, next).duplicate)
        }
    }
    @Test fun rollbackAfterPreparedPagePreservesCursorAndExactLocalOutbox() = database { name ->
        val s = scope()
        History(context, name).use { history ->
            history.selectProject("pocket", "project-a"); history.add("request-0001", "pocket", "Question")
            history.update("request-0001", "interrupted", "Saved answer", "Unknown delivery", "{\"id\":\"cached-dialog\"}")
            val oldJob = history.jobs("pocket").single(); val oldChat = history.session("pocket")
            val cache = ConversationCache(history); val page = snapshot(s, JSONArray().put(item(s)))
            try { cache.apply(s, "snapshot", page, beforeCommit = { error("Injected rollback") }); fail("No fault") } catch (_: IllegalStateException) { }
            assertNull(cache.state(s, "execution")); assertTrue(cache.records(s).isEmpty()); assertNull(cache.outboxLink(s, oldJob.id))
            assertTrue(cache.apply(s, "snapshot", page).applied)
            assertEquals(oldJob, history.jobs("pocket").single()); assertEquals(oldChat, history.session("pocket"))
            assertEquals("interrupted", history.jobs("pocket").single().status)
            assertFalse(history.session("pocket")!!.needsApproval)
            assertEquals("backend-reference", cache.outboxLink(s, oldJob.id)!!.getString("classification"))
        }
        History(context, name).use { history ->
            assertEquals("request-0001", history.jobs("pocket").single().id)
            assertEquals(1, ConversationCache(history).records(s).size)
        }
    }
    @Test fun feedUpsertsOneResultAndRejectsGapsAndChangedDuplicatesAtomically() = database { name ->
        val s = scope()
        History(context, name).use { history ->
            val cache = ConversationCache(history)
            assertTrue(cache.apply(s, "snapshot", snapshot(s, JSONArray().put(item(s)))).applied)
            val page = token(s, "envelope", 2).put("consistentRead", true).put("liveWrites", true).put("upper", 2)
                .put("page", token(s, "feed-page", 1).put("upper", 2)).put("after", token(s, "feed-cursor", 2)).put("next", JSONObject.NULL)
                .put("items", JSONArray().put(JSONObject().put("event", token(s, "event", 2).put("type", "run.result").put("kind", "turn")
                    .put("recordId", "request-0001").put("revision", 2).put("ordinal", 1)).put("record", item(s, revision = 2, answer = "New answer").getJSONObject("record"))))
            val requested = token(s, "feed-cursor", 1)
            assertTrue(cache.apply(s, "feed", page, requested).applied)
            assertTrue(cache.apply(s, "feed", page, requested).duplicate)
            assertEquals(1, cache.records(s).size)
            assertEquals("New answer", JSONObject(cache.records(s).single().json).getJSONObject("source").getString("answer"))
            val before = cache.state(s, "execution").toString()
            page.getJSONArray("items").getJSONObject(0).getJSONObject("record").getJSONObject("source").put("status", "failed")
            assertFalse(cache.apply(s, "feed", page, requested).applied)
            assertFalse(cache.apply(s, "feed", page, token(s, "feed-cursor", 0)).applied)
            assertEquals(before, cache.state(s, "execution").toString()); assertEquals(2, cache.conflicts(s).size)
            assertFalse(cache.apply(s, "feed", page, requested).applied) // repeated rejection is idempotent too
            assertEquals(2, cache.conflicts(s).size)
            try { cache.records(s.copy(projectId = "other")); fail("Read foreign project scope") } catch (_: IllegalStateException) { }
        }
    }
    @Test fun conflictsRetainBothSidesAndRejectWrongOwnerSchemaProjectWithoutPartialAdoption() = database { name ->
        val s = scope()
        History(context, name).use { history ->
            history.selectProject("pocket", "project-a"); history.add("request-0001", "pocket", "Different local text")
            val cache = ConversationCache(history)
            val original = history.jobs("pocket").single()
            val page = snapshot(s, JSONArray().put(item(s, "remote-first", 1, 1)).put(item(s, ordinal = 2)), 2)
            assertFalse(cache.apply(s, "snapshot", page).applied)
            assertTrue(cache.records(s).isEmpty()); assertNull(cache.state(s, "execution"))
            assertEquals(original, history.jobs("pocket").single())
            val evidence = JSONObject(cache.conflicts(s).single())
            assertTrue(evidence.getString("input").contains("remote-first"))
            assertEquals("Different local text", evidence.getJSONArray("local").getJSONObject(0).getString("text"))
            for ((key, value) in listOf("ownerId" to "22222222-2222-4222-8222-222222222222", "schemaVersion" to 2, "projectId" to "other")) {
                assertFalse(cache.apply(s, "snapshot", snapshot(s, JSONArray()).put(key, value)).applied)
            }
            assertEquals(4, cache.conflicts(s).size)
            assertTrue(cache.records(s.copy(ownerId = "22222222-2222-4222-8222-222222222222")).isEmpty())
        }
    }
    @Test fun remoteHistoricalOnlyChatDoesNotCreateSessionJobBindingOrCursor() = database { name ->
        val s = scope("historical-only", null)
        History(context, name).use { h ->
            val sessions = h.sessions(); val cache = ConversationCache(h)
            val row = JSONObject().put("requestId", "old-request").put("ordinal", 7).put("text", "Question").put("answer", "Answer")
                .put("clientStatus", "done").put("projectId", JSONObject.NULL).put("pending", "{\"id\":\"old-dialog\"}")
            val item = JSONObject().put("kind", "evidence").put("ownerId", owner).put("conversationId", s.conversationId).put("importId", "import-0001")
                .put("classification", "historical-unverified").put("provenance", JSONObject().put("kind", "android-v4").put("sourceId", "fixture-export"))
                .put("evidence", row).put("messages", messages("old-request")).put("actionable", false).put("executionAuthority", false)
            val page = JSONObject().put("schemaVersion", 1).put("ownerId", owner).put("conversationId", s.conversationId)
                .put("projectId", JSONObject.NULL).put("revision", 1).put("readOnly", true).put("executionAuthority", false)
                .put("items", JSONArray().put(item)).put("next", JSONObject.NULL)
            assertTrue(cache.apply(s, "history", page).applied)
            assertTrue(cache.apply(s, "history", page).duplicate)
            assertEquals("old-request", cache.records(s, true).single().id)
            assertFalse(cache.records(s, true).single().actionable)
            assertNull(cache.state(s, "execution")); assertNull(cache.outboxLink(s, "old-request"))
            assertEquals(sessions, h.sessions()); assertTrue(h.jobs(s.conversationId).isEmpty()); assertNull(h.session(s.conversationId))
        }
        History(context, name).use { h -> assertEquals("old-request", ConversationCache(h).records(s, true).single().id) }
    }
    private fun manifest(s: ConversationCachePolicy.Scope, status: String): JSONObject {
        val row = JSONObject().put("requestId", "request-0001").put("ordinal", 1).put("text", "Question").put("answer", "")
            .put("clientStatus", status).put("projectId", s.projectId ?: JSONObject.NULL).put("pending", "").put("progress", "")
        val m = JSONObject().put("schemaVersion", 1).put("ownerId", s.ownerId).put("conversationId", s.conversationId)
            .put("projectId", s.projectId ?: JSONObject.NULL).put("importId", "import-0001")
            .put("provenance", JSONObject().put("kind", "android-v4").put("sourceId", "fixture-export"))
            .put("session", JSONObject().put("title", "Original title").put("draft", "Original draft")).put("rows", JSONArray().put(row))
        return m.put("digest", ConversationCachePolicy.digest(ConversationCachePolicy.canonical(m)))
    }
    private fun receipt(s: ConversationCachePolicy.Scope, m: JSONObject, classification: String = "unresolved-outbox", outcome: String = "imported") = JSONObject()
        .put("schemaVersion", 1).put("ownerId", s.ownerId).put("conversationId", s.conversationId).put("importId", m.getString("importId"))
        .put("digest", m.getString("digest")).put("revision", 1).put("outcome", outcome).put("executionAuthority", false)
        .put("projectEvidence", JSONObject().put("claimedProjectId", s.projectId ?: JSONObject.NULL).put("provedProjectId", JSONObject.NULL).put("state", "unproved"))
        .put("decisions", if (outcome == "conflict") JSONArray() else JSONArray().put(JSONObject().put("requestId", "request-0001").put("classification", classification).put("deduplicated", false)))
        .put("conflicts", if (outcome == "conflict") JSONArray().put(JSONObject().put("fields", JSONArray().put("text"))) else JSONArray())
    @Test fun historicalOnlyImportsAndUnresolvedOutboxAcksDoNotSubmitOrMakeApprovalsActionable() = database { name ->
        val s = scope(project = null)
        val m = manifest(s, "sending")
        History(context, name).use { history ->
            history.rename("pocket", "Original title"); history.add("request-0001", "pocket", "Question"); history.saveDraft("pocket", "Original draft")
            val cache = ConversationCache(history); val old = history.jobs("pocket"); val chat = history.session("pocket")
            assertTrue(cache.saveImport(s, m).applied)
            assertNull(cache.importAcknowledgement(s, "import-0001"))
            val ack = receipt(s, m)
            try { cache.acknowledgeImport(s, ack) { error("Ack rollback") }; fail("No fault") } catch (_: IllegalStateException) { }
            assertNull(cache.importAcknowledgement(s, "import-0001")); assertNull(cache.outboxLink(s, "request-0001"))
            assertTrue(cache.acknowledgeImport(s, ack).applied); assertTrue(cache.acknowledgeImport(s, ack).duplicate)
            val evidence = JSONObject().put("kind", "evidence").put("ownerId", owner).put("conversationId", "pocket").put("importId", "import-0001")
                .put("classification", "unresolved-outbox").put("provenance", m.getJSONObject("provenance")).put("evidence", m.getJSONArray("rows").getJSONObject(0))
                .put("messages", messages("request-0001", "")).put("actionable", false).put("executionAuthority", false)
            val page = JSONObject().put("schemaVersion", 1).put("ownerId", owner).put("conversationId", "pocket").put("projectId", JSONObject.NULL)
                .put("revision", 1).put("readOnly", true).put("executionAuthority", false).put("items", JSONArray().put(evidence).put(JSONObject().put("kind", "import").put("receipt", ack))).put("next", JSONObject.NULL)
            assertTrue(cache.apply(s, "history", page).applied); assertTrue(cache.apply(s, "history", page).duplicate)
            assertNull(cache.state(s, "execution")); assertEquals(2, cache.records(s, historical = true).size)
            assertTrue(cache.records(s, historical = true).none { it.actionable || it.executionAuthority })
            assertFalse(cache.outboxLink(s, "request-0001")!!.getBoolean("actionable"))
            assertEquals(old, history.jobs("pocket")); assertEquals(chat, history.session("pocket"))
        }
        History(context, name).use { history ->
            val cache = ConversationCache(history)
            assertNotNull(cache.importAcknowledgement(s, "import-0001")); assertNotNull(cache.importManifest(s, "import-0001"))
            assertEquals("sending", history.jobs("pocket").single().status)
            assertEquals(2, cache.records(s, true).size)
        }
    }
    @Test fun lostAndConflictingAcknowledgementsPreserveManifestAndPreferences() = database { name ->
        val s = scope(project = null)
        val preferences = context.getSharedPreferences("cache-fixture-${UUID.randomUUID()}", 0)
        val saved = mapOf("selected-session" to "pocket", "pairing" to "synthetic-encrypted-pairing", "pending-pocket" to "{\"operationId\":\"saved-operation\",\"revision\":\"saved-revision\"}")
        saved.forEach { (k, v) -> preferences.edit().putString(k, v).commit() }
        try {
            val m = manifest(s, "sending")
            History(context, name).use { h -> h.add("request-0001", "pocket", "Question"); assertTrue(ConversationCache(h).saveImport(s, m).applied) }
            History(context, name).use { h ->
                val c = ConversationCache(h)
                assertEquals(ConversationCachePolicy.canonical(m), c.importManifest(s, "import-0001"))
                h.update("request-0001", "interrupted", "", "Locally observed uncertainty")
                assertTrue(c.saveImport(s, m).duplicate) // retry the original export, not today's changed status
                val ack = receipt(s, m, outcome = "conflict")
                assertTrue(c.acknowledgeImport(s, ack).applied)
                assertNull(c.outboxLink(s, "request-0001"))
                assertFalse(c.acknowledgeImport(s, receipt(s, m)).applied)
                assertEquals(ConversationCachePolicy.canonical(ack), c.importAcknowledgement(s, "import-0001"))
                assertEquals("interrupted", h.jobs("pocket").single().status)
                assertTrue(c.conflicts(s).isNotEmpty())
            }
            saved.forEach { (k, v) -> assertEquals(v, preferences.getString(k, null)) }
        } finally { preferences.edit().clear().commit() }
    }
}
