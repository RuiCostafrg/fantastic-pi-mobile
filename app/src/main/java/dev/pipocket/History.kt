package dev.pipocket

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.Log
import java.util.UUID

data class Job(val id: String, val text: String, val status: String, val answer: String,
    val sessionId: String, val progress: String, val pending: String) {
    val active get() = status in listOf("sending", "queued", "running")
}

data class ChatSession(val id: String, val title: String, val draft: String, val pinned: Boolean,
    val updatedAt: Long, val status: String?, val needsApproval: Boolean) {
    val active get() = status in listOf("sending", "queued", "running")
}

/** Owns chat organization, migration and per-chat single-flight admission. IDs never depend on titles. */
class History(context: Context, name: String = "pocket.sqlite") : SQLiteOpenHelper(context, name, null, 2) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE jobs (id TEXT PRIMARY KEY, text TEXT NOT NULL, status TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, sessionId TEXT NOT NULL DEFAULT 'pocket', progress TEXT NOT NULL DEFAULT '', pending TEXT NOT NULL DEFAULT '')")
        createSessions(db)
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
    }
    fun sessions(): List<ChatSession> = readableDatabase.rawQuery("""
        SELECT s.id,s.title,s.draft,s.pinned,s.updated,
          (SELECT status FROM jobs WHERE sessionId=s.id ORDER BY created DESC,rowid DESC LIMIT 1),
          EXISTS(SELECT 1 FROM jobs WHERE sessionId=s.id AND status IN ('sending','queued','running') AND pending<>'')
        FROM sessions s ORDER BY s.pinned DESC,s.updated DESC,s.rowid DESC
    """.trimIndent(), null).use { c -> buildList {
        while (c.moveToNext()) add(ChatSession(c.getString(0), c.getString(1), c.getString(2), c.getInt(3) != 0,
            c.getLong(4), if (c.isNull(5)) null else c.getString(5), c.getInt(6) != 0))
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
    fun rename(id: String, title: String) {
        require(title.trim().isNotEmpty() && title.trim().length <= 80) { "Use a name between 1 and 80 characters" }
        writableDatabase.update("sessions", ContentValues().apply { put("title", title.trim()); put("updated", System.currentTimeMillis()) }, "id=?", arrayOf(id))
    }
    fun pin(id: String, pinned: Boolean) {
        writableDatabase.update("sessions", ContentValues().apply { put("pinned", if (pinned) 1 else 0) }, "id=?", arrayOf(id))
    }
    fun saveDraft(id: String, text: String) {
        writableDatabase.update("sessions", ContentValues().apply { put("draft", text) }, "id=?", arrayOf(id))
    }
    fun add(id: String, sessionId: String, text: String) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val title = db.rawQuery("SELECT title FROM sessions WHERE id=?", arrayOf(sessionId)).use { check(it.moveToFirst()) { "Unknown chat" }; it.getString(0) }
            val busy = db.rawQuery("SELECT 1 FROM jobs WHERE sessionId=? AND status IN ('sending','queued','running') LIMIT 1", arrayOf(sessionId)).use { it.moveToFirst() }
            check(!busy) { "This chat already has an active request" }
            val empty = db.rawQuery("SELECT 1 FROM jobs WHERE sessionId=? LIMIT 1", arrayOf(sessionId)).use { !it.moveToFirst() }
            val now = System.currentTimeMillis()
            db.insertOrThrow("jobs", null, ContentValues().apply {
                put("id", id); put("sessionId", sessionId); put("text", text); put("status", "sending"); put("created", now)
            })
            db.update("sessions", ContentValues().apply {
                put("draft", ""); put("updated", now)
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
            if (old.status != status) Log.i("PiPocket", "job=$id session=${old.sessionId} status=$status")
        } finally { db.endTransaction() }
    }
    fun problem(id: String, message: String) {
        writableDatabase.update("jobs", ContentValues().apply { put("progress", message) }, "id=?", arrayOf(id))
    }
    fun jobs(sessionId: String): List<Job> = readableDatabase.rawQuery("SELECT $columns FROM jobs WHERE sessionId=? ORDER BY created,rowid", arrayOf(sessionId)).use(::jobs)
    fun activeJobs(): List<Job> = readableDatabase.rawQuery("SELECT $columns FROM jobs WHERE status IN ('sending','queued','running') ORDER BY created,rowid", null).use(::jobs)
    private fun jobs(c: Cursor): List<Job> = buildList { while (c.moveToNext()) add(job(c)) }
    private fun job(c: Cursor) = Job(c.getString(0), c.getString(1), c.getString(2), c.getString(3), c.getString(4), c.getString(5), c.getString(6))
    private val columns = "id,text,status,answer,sessionId,progress,pending"
}
