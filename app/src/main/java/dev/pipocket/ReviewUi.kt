package dev.pipocket

import android.graphics.Canvas
import android.graphics.Paint
import android.text.SpannableString
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.LineBackgroundSpan
import org.json.JSONObject

/** Test evidence comes only from a recorded command, never assistant prose. */
fun testSummary(test: JSONObject?): String {
    if (test == null) return "Tests: not run from Changes"
    return when (test.optString("status")) {
        "queued", "running" -> "Tests: running…"
        "interrupted" -> "Tests: interrupted · result unknown; inspect before retrying"
        "cancelled" -> "Tests: cancelled · no passing result recorded"
        "failed" -> "Tests: could not record a completed result"
        "done" -> {
            if (!test.has("exitCode")) "Tests: no exit-code evidence"
            else {
                val result = if (test.optInt("exitCode", -1) == 0) "passed (exit 0)" else "failed (exit ${test.optInt("exitCode", -1)})"
                if (test.optBoolean("stale", true)) "Tests: $result for an older/changed revision · rerun" else "Tests: $result for this revision"
            }
        }
        else -> "Tests: no completed result recorded"
    }
}
fun reviewFileCount(summary: JSONObject?): Int {
    if (summary == null) return 0
    if (summary.has("fileCount")) return summary.optInt("fileCount").coerceAtLeast(0)
    // Older protocol-v4 bridges ignore summary=1 and return a complete snapshot.
    val paths = mutableSetOf<String>()
    for (key in listOf("files", "committedFiles")) {
        val files = summary.optJSONArray(key) ?: continue
        for (i in 0 until files.length()) paths.add(files.getJSONObject(i).optString("path"))
    }
    return paths.size
}
fun hasReviewChanges(summary: JSONObject?, uncertainRequest: Boolean = false): Boolean = uncertainRequest ||
    reviewFileCount(summary) > 0 || summary?.optBoolean("repositoryActionActive") == true ||
    summary?.optJSONObject("operation")?.optString("status") in listOf("queued", "running")

fun fileStatusLabel(status: String): String = when {
    status.contains('U') || status in listOf("AA", "DD") -> "Conflict"
    status == "??" || status.contains('A') -> "Added"
    status.contains('D') -> "Deleted"
    status.contains('R') -> "Renamed"
    status.contains('T') -> "Type changed"
    else -> "Modified"
}
fun coloredDiff(text: String): SpannableString {
    val result = SpannableString(text)
    var offset = 0
    for (line in text.split('\n')) {
        val color = when {
            line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@") || line.startsWith("diff ") -> PocketColors.accent
            line.startsWith("+") -> PocketColors.added
            line.startsWith("-") -> PocketColors.removed
            else -> PocketColors.text
        }
        if (line.isNotEmpty()) result.setSpan(ForegroundColorSpan(color), offset, offset + line.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        offset += line.length + 1
    }
    return result
}

data class DiffLine(val before: Int?, val after: Int?, val kind: Char, val content: String)
data class ReadableDiff(val lines: List<DiffLine>) {
    val added get() = lines.count { it.kind == '+' }
    val removed get() = lines.count { it.kind == '-' }
}
/** Pure presentation parser. Exact original patch remains available through Raw patch / Copy. */
fun readableDiff(patch: String): ReadableDiff {
    val rows = mutableListOf<DiffLine>()
    var before = 0; var after = 0; var inHunk = false; var newFile = false
    val hunk = Regex("^@@ -(\\d+)(?:,\\d+)? \\+(\\d+)(?:,\\d+)? @@.*")
    val source = patch.split('\n')
    for ((index, line) in source.withIndex()) {
        val match = hunk.matchEntire(line)
        when {
            match != null -> {
                before = match.groupValues[1].toIntOrNull() ?: 0
                after = match.groupValues[2].toIntOrNull() ?: 0
                inHunk = true; newFile = false
                rows.add(DiffLine(null, null, '@', "Lines $before → $after"))
            }
            line.startsWith("New file: ") && !inHunk -> { newFile = true; inHunk = true; after = 1 }
            line.startsWith("diff --git ") -> { inHunk = false; newFile = false }
            index == source.lastIndex && line.isEmpty() -> Unit // patch's final terminator, not another code line
            // Legacy new-file previews contain a synthetic final '+' for a terminating newline.
            newFile && index == source.lastIndex && line == "+" -> Unit
            inHunk && line.startsWith("+") -> rows.add(DiffLine(null, after++, '+', line.drop(1)))
            inHunk && line.startsWith("-") -> rows.add(DiffLine(before++, null, '-', line.drop(1)))
            inHunk && line.startsWith(" ") -> rows.add(DiffLine(before++, after++, ' ', line.drop(1)))
            line.startsWith("\\ No newline") -> rows.add(DiffLine(null, null, 'i', "No newline at end of file"))
            !inHunk && (line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) -> Unit
            line.isNotEmpty() -> rows.add(DiffLine(null, null, 'i', line))
        }
    }
    if (rows.isEmpty()) rows.add(DiffLine(null, null, 'i', "Empty file · no text to display"))
    return ReadableDiff(rows)
}

fun diffReaderText(diff: ReadableDiff): CharSequence {
    val result = SpannableStringBuilder()
    val digits = maxOf(3, diff.lines.maxOfOrNull { maxOf(it.before ?: 0, it.after ?: 0) }?.toString()?.length ?: 1)
    for (line in diff.lines) {
        val start = result.length
        val prefix = if (line.kind in listOf('+', '-', ' ')) {
            "${line.before?.toString().orEmpty().padStart(digits)} ${line.after?.toString().orEmpty().padStart(digits)} ${if (line.kind == '-') '−' else line.kind}  "
        } else "  "
        result.append(prefix).append(line.content).append('\n')
        val color = when (line.kind) { '+' -> PocketColors.added; '-' -> PocketColors.removed; '@' -> PocketColors.accent; else -> PocketColors.muted }
        result.setSpan(ForegroundColorSpan(color), start, if (line.kind in listOf('@', 'i')) result.length else start + prefix.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        when (line.kind) {
            '+' -> result.setSpan(DiffBackground(PocketColors.addedBackground), start, result.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            '-' -> result.setSpan(DiffBackground(PocketColors.removedBackground), start, result.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
    }
    return result
}
private class DiffBackground(private val color: Int) : LineBackgroundSpan {
    override fun drawBackground(canvas: Canvas, paint: Paint, left: Int, right: Int, top: Int, baseline: Int, bottom: Int,
                                text: CharSequence, start: Int, end: Int, lineNumber: Int) {
        val previous = paint.color; paint.color = color
        canvas.drawRect(left.toFloat(), top.toFloat(), right.toFloat(), bottom.toFloat(), paint)
        paint.color = previous
    }
}
