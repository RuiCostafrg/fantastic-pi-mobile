package dev.pipocket

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class Job(val id: String, val text: String, val status: String, val answer: String) {
    val active get() = status in listOf("sending", "queued", "running")
}

class History(context: Context) : SQLiteOpenHelper(context, "pocket.sqlite", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE jobs (id TEXT PRIMARY KEY, text TEXT NOT NULL, status TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
    fun add(id: String, text: String) {
        writableDatabase.insertOrThrow("jobs", null, ContentValues().apply {
            put("id", id); put("text", text); put("status", "sending"); put("created", System.currentTimeMillis())
        })
    }
    fun update(id: String, status: String, answer: String) {
        writableDatabase.update("jobs", ContentValues().apply { put("status", status); put("answer", answer) }, "id = ?", arrayOf(id))
    }
    fun recent(): List<Job> = readableDatabase.rawQuery("SELECT id,text,status,answer FROM jobs ORDER BY created DESC LIMIT 30", null).use { cursor ->
        buildList { while (cursor.moveToNext()) add(Job(cursor.getString(0), cursor.getString(1), cursor.getString(2), cursor.getString(3))) }
    }
}
