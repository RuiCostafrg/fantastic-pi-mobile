package dev.fantasticpimobile

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.Log
import java.util.UUID
import org.json.JSONObject

enum class ProjectState { UNBOUND, LEGACY_UNRESOLVED, SELECTED, BOUND }

data class Job(val id: String, val text: String, val status: String, val answer: String,
    val sessionId: String, val progress: String, val pending: String,
    val projectId: String? = null, val projectState: ProjectState = ProjectState.LEGACY_UNRESOLVED,
    val approvalOccurrenceId: String? = null) {
    val active get() = status in listOf("sending", "queued", "running")
}

enum class ChatSection(val heading: String) {
    NEW("NEW CHATS"), ATTENTION("NEEDS ATTENTION"), WORKING("WORKING"), FINISHED("FINISHED"), ARCHIVED("ARCHIVED")
}

data class ChatSession(val id: String, val title: String, val draft: String, val pinned: Boolean,
    val updatedAt: Long, val status: String?, val needsApproval: Boolean,
    val finished: Boolean = false, val archived: Boolean = false,
    val projectId: String? = null, val projectState: ProjectState = ProjectState.UNBOUND) {
    val active get() = status in listOf("sending", "queued", "running")
    // A completed Pi turn is not a user-finished task. Approvals outrank background work.
    val section get() = when {
        needsApproval -> ChatSection.ATTENTION
        active -> ChatSection.WORKING
        archived -> ChatSection.ARCHIVED
        finished -> ChatSection.FINISHED
        status == null -> ChatSection.NEW
        else -> ChatSection.ATTENTION
    }
}

/** Owns chat organization, migration and per-chat single-flight admission. IDs never depend on titles. */
class History(context: Context, name: String = "fantastic-pi-mobile.sqlite") : SQLiteOpenHelper(context, name, null, 5) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE jobs (id TEXT PRIMARY KEY, text TEXT NOT NULL, status TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, sessionId TEXT NOT NULL DEFAULT 'pocket', progress TEXT NOT NULL DEFAULT '', pending TEXT NOT NULL DEFAULT '')")
        createSessions(db)
        addLifecycle(db)
        addProjects(db, false)
        ConversationCache.create(db)
    }
    private fun addProjects(db: SQLiteDatabase, legacy: Boolean) {
        for (table in listOf("sessions", "jobs")) {
            db.execSQL("ALTER TABLE $table ADD COLUMN projectId TEXT")
            db.execSQL("ALTER TABLE $table ADD COLUMN projectState TEXT NOT NULL DEFAULT 'UNBOUND'")
            if (legacy) db.execSQL("UPDATE $table SET projectState='LEGACY_UNRESOLVED'")
        }
    }
    private fun addLifecycle(db: SQLiteDatabase) {
        db.execSQL("ALTER TABLE sessions ADD COLUMN finished INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
    }
    private fun createSessions(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, draft TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL)")
        val now = System.currentTimeMillis()
        db.execSQL("INSERT INTO sessions (id,title,created,updated) VALUES ('pocket','Main chat',?,?)", arrayOf(now, now))
        db.execSQL("CREATE INDEX jobs_session_created ON jobs(sessionId,created)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE jobs ADD COLUMN sessionId TEXT NOT NULL DEFAULT 'pocket'")
            db.execSQL("ALTER TABLE jobs ADD COLUMN progress TEXT NOT NULL DEFAULT ''")
            db.execSQL("ALTER TABLE jobs ADD COLUMN pending TEXT NOT NULL DEFAULT ''")
            createSessions(db)
        }
        if (oldVersion < 3) addLifecycle(db)
        if (oldVersion < 4) addProjects(db, true)
        if (oldVersion < 5) ConversationCache.create(db)
    }
    fun sessions(): List<ChatSession> = readableDatabase.rawQuery("""
        SELECT s.id,s.title,s.draft,s.pinned,s.updated,
          (SELECT status FROM jobs WHERE sessionId=s.id ORDER BY created DESC,rowid DESC LIMIT 1),
          EXISTS(SELECT 1 FROM jobs WHERE sessionId=s.id AND status IN ('sending','queued','running') AND pending<>''), s.finished, s.archived, s.projectId, s.projectState
        FROM sessions s ORDER BY s.pinned DESC,s.updated DESC,s.rowid DESC
    """.trimIndent(), null).use { c -> buildList {
        while (c.moveToNext()) add(ChatSession(c.getString(0), c.getString(1), c.getString(2), c.getInt(3) != 0,
            c.getLong(4), if (c.isNull(5)) null else c.getString(5), c.getInt(6) != 0, c.getInt(7) != 0, c.getInt(8) != 0,
            if (c.isNull(9)) null else c.getString(9), ProjectState.valueOf(c.getString(10))))
    } }
    fun session(id: String): ChatSession? = sessions().firstOrNull { it.id == id }
    fun createSession(): String {
        val id = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        writableDatabase.insertOrThrow("sessions", null, ContentValues().apply {
            put("id", id); put("title", "New chat"); put("created", now); put("updated", now)
        })
        return id
    }
    /** New remote identities get local organization; existing titles/drafts/flags are untouched. */
    internal fun ensureRemoteSession(id: String, projectId: String?) {
        require(ProjectRequests.validId(id))
        if (session(id) == null) {
            val now = System.currentTimeMillis()
            writableDatabase.insertOrThrow("sessions", null, ContentValues().apply {
                put("id", id); put("title", "Chat ${id.take(12)}"); put("created", now); put("updated", now)
            })
        }
        if (projectId != null) confirmProject(id, projectId)
    }
    fun rename(id: String, title: String) {
        require(title.trim().isNotEmpty() && title.trim().length <= 80) { "Use a name between 1 and 80 characters" }
        writableDatabase.update("sessions", ContentValues().apply { put("title", title.trim()); put("updated", System.currentTimeMillis()) }, "id=?", arrayOf(id))
    }
    fun pin(id: String, pinned: Boolean) {
        writableDatabase.update("sessions", ContentValues().apply { put("pinned", if (pinned) 1 else 0) }, "id=?", arrayOf(id))
    }
    /** Lifecycle changes are transactional with admission, so running work cannot be hidden. */
    fun setFinished(id: String, finished: Boolean) = organize(id) { session ->
        check(!session.active) { "Stop or finish the running request first" }
        check(!session.archived) { "Restore this chat before reopening it" }
        check(session.status != null) { "Send a message before marking this chat finished" }
        ContentValues().apply { put("finished", if (finished) 1 else 0) }
    }
    fun setArchived(id: String, archived: Boolean) = organize(id) { session ->
        check(!session.active) { "Running chats cannot be archived" }
        check(!archived || session.finished) { "Mark this chat finished before archiving" }
        ContentValues().apply { put("archived", if (archived) 1 else 0) }
    }
    private fun organize(id: String, values: (ChatSession) -> ContentValues) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val session = session(id) ?: error("Unknown chat")
            db.update("sessions", values(session).apply { put("updated", System.currentTimeMillis()) }, "id=?", arrayOf(id))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    fun saveDraft(id: String, text: String) {
        writableDatabase.update("sessions", ContentValues().apply { put("draft", text) }, "id=?", arrayOf(id))
    }
    fun add(id: String, sessionId: String, text: String) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val session = session(sessionId) ?: error("Unknown chat")
            check(!session.archived) { "Restore this chat before sending a message" }
            val title = session.title
            val busy = db.rawQuery("SELECT 1 FROM jobs WHERE sessionId=? AND status IN ('sending','queued','running') LIMIT 1", arrayOf(sessionId)).use { it.moveToFirst() }
            check(!busy) { "This chat already has an active request" }
            val empty = db.rawQuery("SELECT 1 FROM jobs WHERE sessionId=? LIMIT 1", arrayOf(sessionId)).use { !it.moveToFirst() }
            val now = System.currentTimeMillis()
            db.insertOrThrow("jobs", null, ContentValues().apply {
                put("id", id); put("sessionId", sessionId); put("text", text); put("status", "sending"); put("created", now)
                put("projectId", session.projectId); put("projectState", session.projectState.name)
            })
            db.update("sessions", ContentValues().apply {
                put("draft", ""); put("updated", now); put("finished", 0)
                if (empty && title == "New chat") put("title", text.replace(Regex("\\s+"), " ").take(40))
            }, "id=?", arrayOf(sessionId))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    fun update(id: String, status: String, answer: String, progress: String = "", pending: String = "") {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val old = db.rawQuery("SELECT $columns FROM jobs WHERE id=?", arrayOf(id)).use { if (it.moveToFirst()) job(it) else null } ?: return
            db.update("jobs", ContentValues().apply {
                put("status", status); put("answer", answer); put("progress", progress); put("pending", pending)
            }, "id=?", arrayOf(id))
            if (old.status != status || old.answer != answer) {
                db.update("sessions", ContentValues().apply { put("updated", System.currentTimeMillis()) }, "id=?", arrayOf(old.sessionId))
            }
            db.setTransactionSuccessful()
            if (old.status != status) Log.i("FantasticPiMobile", "job=$id session=${old.sessionId} status=$status")
        } finally { db.endTransaction() }
    }
    /** Selection is only editable before the first saved request; titles never route work. */
    fun selectProject(sessionId: String, projectId: String) {
        require(ProjectRequests.validId(projectId)) { "Invalid project ID" }
        val db = writableDatabase
        db.beginTransaction()
        try {
            val chat = session(sessionId) ?: error("Unknown chat")
            check(chat.projectState in listOf(ProjectState.UNBOUND, ProjectState.SELECTED)) { "Reconcile this chat's established project first" }
            check(jobs(sessionId).isEmpty()) { "Create a new chat to select another project" }
            db.update("sessions", ContentValues().apply { put("projectId", projectId); put("projectState", ProjectState.SELECTED.name) }, "id=?", arrayOf(sessionId))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    /** Only after a backend binding lookup proves a legacy empty draft is unbound. */
    fun resolveEmptyDraft(sessionId: String) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val chat = session(sessionId) ?: error("Unknown chat")
            check(chat.projectState == ProjectState.LEGACY_UNRESOLVED && jobs(sessionId).isEmpty()) { "Submitted history needs exact-ID reconciliation" }
            db.update("sessions", ContentValues().apply { put("projectState", ProjectState.UNBOUND.name) }, "id=?", arrayOf(sessionId))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    fun confirmProject(sessionId: String, projectId: String) {
        require(ProjectRequests.validId(projectId)) { "Invalid project ID" }
        val db = writableDatabase
        db.beginTransaction()
        try {
            val chat = session(sessionId) ?: error("Unknown chat")
            check(chat.projectId == null || chat.projectId == projectId) { "Project binding conflict" }
            check(jobs(sessionId).all { it.projectId == null || it.projectId == projectId }) { "Saved request project conflict" }
            db.update("sessions", ContentValues().apply { put("projectId", projectId); put("projectState", ProjectState.BOUND.name) }, "id=?", arrayOf(sessionId))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    /** Persist a proved legacy target before dispatch, without claiming acceptance/completion. */
    fun resolveRequestProject(id: String, projectId: String) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val old = db.rawQuery("SELECT $columns FROM jobs WHERE id=?", arrayOf(id)).use { if (it.moveToFirst()) job(it) else null } ?: error("Unknown request")
            check(old.projectId == null || old.projectId == projectId) { "Saved request project conflict" }
            confirmProject(old.sessionId, projectId)
            db.update("jobs", ContentValues().apply { put("projectId", projectId); put("projectState", ProjectState.BOUND.name) }, "id=?", arrayOf(id))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    /** Validate again against current persisted identity and apply binding/result atomically. */
    fun acceptResponse(id: String, response: JSONObject) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val old = db.rawQuery("SELECT $columns FROM jobs WHERE id=?", arrayOf(id)).use { if (it.moveToFirst()) job(it) else null } ?: error("Unknown request")
            ProjectRequests.validateJob(old, session(old.sessionId)?.projectId, response)
            ProjectRequests.projectId(response)?.let { project ->
                confirmProject(old.sessionId, project)
                db.update("jobs", ContentValues().apply { put("projectId", project); put("projectState", ProjectState.BOUND.name) }, "id=?", arrayOf(id))
            }
            update(id, response.getString("status"), response.optString("answer"), response.optString("progress"), response.optJSONObject("pending")?.toString().orEmpty())
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    fun problem(id: String, message: String) {
        writableDatabase.update("jobs", ContentValues().apply { put("progress", message) }, "id=?", arrayOf(id))
    }
    fun jobs(sessionId: String): List<Job> = readableDatabase.rawQuery("SELECT $columns FROM jobs WHERE sessionId=? ORDER BY created,rowid", arrayOf(sessionId)).use(::jobs)
    fun activeJobs(): List<Job> = readableDatabase.rawQuery("SELECT $columns FROM jobs WHERE status IN ('sending','queued','running') ORDER BY created,rowid", null).use(::jobs)
    private fun jobs(c: Cursor): List<Job> = buildList { while (c.moveToNext()) add(job(c)) }
    private fun job(c: Cursor) = Job(c.getString(0), c.getString(1), c.getString(2), c.getString(3), c.getString(4), c.getString(5), c.getString(6), if (c.isNull(7)) null else c.getString(7), ProjectState.valueOf(c.getString(8)))
    private val columns = "id,text,status,answer,sessionId,progress,pending,projectId,projectState"
}
