package dev.fantasticpimobile

import android.database.sqlite.SQLiteDatabase
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Data-only sandbox tests. No Activity, pairing change or visible device action. */
@RunWith(AndroidJUnit4::class)
class ProjectHistoryTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun database(test: (String) -> Unit) {
        assumeTrue("Run only the separate fixture APK", context.packageName == "dev.fantasticpimobile.reliability")
        val name = "project-test-${UUID.randomUUID()}.sqlite"
        try { test(name) } finally { context.deleteDatabase(name) }
    }
    private fun accepted(id: String, session: String, project: String) = JSONObject().put("id", id).put("sessionId", session)
        .put("projectId", project).put("status", "running").put("pending", JSONObject().put("id", "approval"))

    @Test fun selectionRequestAndAcceptedBindingSurviveReopenAndCannotBeRetargeted() = database { name ->
        val chat: String
        History(context, name).use { history ->
            chat = history.createSession()
            assertEquals(ProjectState.UNBOUND, history.session(chat)!!.projectState)
            history.selectProject(chat, "project-a")
            history.saveDraft(chat, "Unsent draft")
        }
        History(context, name).use { history ->
            assertEquals("Unsent draft", history.session(chat)!!.draft)
            assertEquals(ProjectState.SELECTED, history.session(chat)!!.projectState)
            history.add("exact-request", chat, "Original text")
            assertEquals("project-a", history.jobs(chat).single().projectId)
            try { history.selectProject(chat, "project-b"); fail("Changed saved request selection") } catch (_: IllegalStateException) { }
            history.acceptResponse("exact-request", accepted("exact-request", chat, "project-a"))
        }
        History(context, name).use { history ->
            val job = history.jobs(chat).single()
            assertEquals("exact-request", job.id); assertEquals("Original text", job.text)
            assertEquals("project-a", job.projectId); assertEquals(ProjectState.BOUND, job.projectState)
            assertEquals(ProjectState.BOUND, history.session(chat)!!.projectState)
            assertEquals("approval", JSONObject(job.pending).getString("id"))
            try { history.acceptResponse(job.id, accepted(job.id, chat, "project-b")); fail("Applied wrong project") } catch (_: ProjectIdentityException) { }
            assertEquals(job, history.jobs(chat).single())
            try { history.confirmProject(chat, "project-b"); fail("Retargeted chat") } catch (_: IllegalStateException) { }
        }
    }
    @Test fun versionThreePreservesJobsDraftsLifecycleAndPendingOperationIdsWithoutDefaultStamping() = database { name ->
        val path = context.getDatabasePath(name); path.parentFile!!.mkdirs()
        val preferences = context.getSharedPreferences("review-requests", 0)
        val pendingKey = "pending-${UUID.randomUUID()}"
        val operation = JSONObject().put("operationId", "exact-old-operation").put("action", "test").put("revision", "old-revision").put("command", "true").toString()
        preferences.edit().putString(pendingKey, operation).commit()
        try {
            SQLiteDatabase.openOrCreateDatabase(path, null).use { db ->
                db.execSQL("CREATE TABLE jobs (id TEXT PRIMARY KEY,text TEXT NOT NULL,status TEXT NOT NULL,answer TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL,sessionId TEXT NOT NULL DEFAULT 'pocket',progress TEXT NOT NULL DEFAULT '',pending TEXT NOT NULL DEFAULT '')")
                db.execSQL("CREATE TABLE sessions (id TEXT PRIMARY KEY,title TEXT NOT NULL,draft TEXT NOT NULL DEFAULT '',pinned INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL,finished INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0)")
                db.execSQL("INSERT INTO sessions VALUES ('upgrade-chat','Established title','Preserve draft',1,10,20,1,1)")
                db.execSQL("INSERT INTO sessions VALUES ('empty-draft','Empty legacy','Empty draft text',0,10,20,0,0)")
                db.execSQL("INSERT INTO jobs VALUES ('exact-legacy-id','Question','sending','Saved answer',11,'upgrade-chat','Saved progress','{\"id\":\"saved-dialog\"}')")
                db.version = 3
            }
            History(context, name).use { history ->
                val chat = history.session("upgrade-chat")!!
                assertEquals("Established title", chat.title); assertEquals("Preserve draft", chat.draft)
                assertTrue(chat.pinned); assertTrue(chat.finished); assertTrue(chat.archived)
                assertNull(chat.projectId); assertEquals(ProjectState.LEGACY_UNRESOLVED, chat.projectState)
                val old = history.jobs(chat.id).single()
                assertEquals("exact-legacy-id", old.id); assertEquals("sending", old.status); assertEquals("Saved answer", old.answer)
                assertEquals("Saved progress", old.progress); assertEquals("saved-dialog", JSONObject(old.pending).getString("id"))
                assertNull(old.projectId); assertEquals(ProjectState.LEGACY_UNRESOLVED, old.projectState)
                try { history.selectProject(chat.id, "today-default"); fail("Guessed legacy project") } catch (_: IllegalStateException) { }
                history.resolveRequestProject(old.id, "historical-project")
                assertEquals("sending", history.jobs(chat.id).single().status) // proof is not acceptance
                assertEquals("historical-project", history.jobs(chat.id).single().projectId)
                history.acceptResponse(old.id, accepted(old.id, chat.id, "historical-project"))
                assertEquals("historical-project", history.session(chat.id)!!.projectId)
                assertEquals(ProjectState.LEGACY_UNRESOLVED, history.session("empty-draft")!!.projectState)
                history.resolveEmptyDraft("empty-draft")
                history.selectProject("empty-draft", "deliberate-project")
            }
            History(context, name).use { history ->
                assertEquals("historical-project", history.jobs("upgrade-chat").single().projectId)
                assertEquals("deliberate-project", history.session("empty-draft")!!.projectId)
                assertEquals("Empty draft text", history.session("empty-draft")!!.draft)
            }
            assertEquals(operation, preferences.getString(pendingKey, null))
        } finally { preferences.edit().remove(pendingKey).commit() }
    }
    @Test fun rejectionAndOfflineProblemsDoNotDropSelectionOrChangeRequestIds() = database { name ->
        History(context, name).use { history ->
            val chat = history.createSession(); history.selectProject(chat, "saved-project")
            history.add("saved-request", chat, "Keep text")
            history.problem("saved-request", "Offline")
            assertEquals("saved-project", history.jobs(chat).single().projectId)
            history.update("saved-request", "rejected", "Unknown project")
            assertEquals("saved-request", history.jobs(chat).single().id)
            assertEquals("saved-project", history.session(chat)!!.projectId)
            assertEquals("Keep text", history.jobs(chat).single().text)
        }
    }
}
