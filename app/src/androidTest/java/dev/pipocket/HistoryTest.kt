package dev.pipocket

import android.database.sqlite.SQLiteDatabase
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class HistoryTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun database(test: (String) -> Unit) {
        val name = "test-${UUID.randomUUID()}.sqlite"
        try { test(name) } finally { context.deleteDatabase(name) }
    }
    @Test fun upgradesLegacyHistoryWithoutLosingJobs() = database { name ->
        val path = context.getDatabasePath(name)
        path.parentFile!!.mkdirs()
        SQLiteDatabase.openOrCreateDatabase(path, null).use { db ->
            db.execSQL("CREATE TABLE jobs (id TEXT PRIMARY KEY,text TEXT NOT NULL,status TEXT NOT NULL,answer TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL)")
            db.execSQL("INSERT INTO jobs VALUES ('legacy-request','Legacy question','done','Legacy answer',1)")
            db.version = 1
        }
        History(context, name).use { history ->
            assertEquals("Main chat", history.session("pocket")!!.title)
            val job = history.jobs("pocket").single()
            assertEquals("legacy-request", job.id)
            assertEquals("Legacy answer", job.answer)
            assertEquals("pocket", job.sessionId)
            val other = history.createSession()
            assertTrue(history.jobs(other).isEmpty())
            assertEquals(2, history.sessions().size)
        }
    }
    @Test fun independentDraftsTitlesPinsAndHistoriesSurviveReopen() = database { name ->
        val other: String
        History(context, name).use { history ->
            other = history.createSession()
            history.saveDraft("pocket", "Draft A")
            history.saveDraft(other, "Draft B")
            history.rename(other, "Project B")
            history.pin(other, true)
            history.add("request-other", other, "Question B")
            history.update("request-other", "done", "Answer B")
            assertEquals("Draft A", history.session("pocket")!!.draft)
            assertEquals("", history.session(other)!!.draft)
            assertTrue(history.jobs("pocket").isEmpty())
        }
        History(context, name).use { history ->
            assertEquals(other, history.sessions().first().id)
            assertTrue(history.session(other)!!.pinned)
            assertEquals("Project B", history.session(other)!!.title)
            assertEquals("Draft A", history.session("pocket")!!.draft)
            assertEquals("Answer B", history.jobs(other).single().answer)
        }
    }
    @Test fun concurrentChatsHaveIndependentActivityApprovalsAndCancellation() = database { name ->
        History(context, name).use { history ->
            val other = history.createSession()
            history.add("request-a", "pocket", "A")
            history.add("request-b", other, "B")
            history.update("request-a", "running", "", "Approval", "{\"id\":\"same-dialog\"}")
            history.update("request-b", "running", "", "Working")
            assertEquals(2, history.activeJobs().size)
            assertTrue(history.session("pocket")!!.needsApproval)
            assertFalse(history.session(other)!!.needsApproval)
            try { history.add("request-duplicate", "pocket", "C"); fail("Admitted a second active request in one chat") }
            catch (_: IllegalStateException) { }
            history.update("request-b", "cancelled", "Stopped")
            assertEquals("request-a", history.activeJobs().single().id)
            assertEquals("running", history.jobs("pocket").single().status)
            assertTrue(history.session("pocket")!!.needsApproval)
        }
    }
    @Test fun firstMessageNamesOnlyAnUntitledChat() = database { name ->
        History(context, name).use { history ->
            val id = history.createSession()
            history.add("first-message", id, "Planning\nour next project")
            assertEquals("Planning our next project", history.session(id)!!.title)
            history.update("first-message", "done", "Okay")
            history.rename(id, "My project")
            history.add("second-message", id, "Another question")
            assertEquals("My project", history.session(id)!!.title)
            assertEquals(2, history.jobs(id).size)
        }
    }
}
