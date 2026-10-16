package dev.pipocket

import android.graphics.Color
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
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
fun coloredDiff(text: String): SpannableString {
    val result = SpannableString(text)
    var offset = 0
    for (line in text.split('\n')) {
        val color = when {
            line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@") || line.startsWith("diff ") -> PocketColors.accent
            line.startsWith("+") -> Color.rgb(156, 223, 180)
            line.startsWith("-") -> Color.rgb(255, 162, 162)
            else -> PocketColors.text
        }
        if (line.isNotEmpty()) result.setSpan(ForegroundColorSpan(color), offset, offset + line.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        offset += line.length + 1
    }
    return result
}
