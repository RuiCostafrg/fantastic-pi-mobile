package dev.pipocket

import android.text.style.ForegroundColorSpan
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReviewUiTest {
    @Test fun passingEvidenceRequiresActualExitCodeAndMatchingRevision() {
        assertEquals("Tests: not run from Changes", testSummary(null))
        assertTrue(testSummary(JSONObject().put("status", "done")).contains("no exit-code evidence"))
        val passed = JSONObject().put("status", "done").put("exitCode", 0).put("stale", false)
        assertEquals("Tests: passed (exit 0) for this revision", testSummary(passed))
        passed.put("stale", true)
        assertTrue(testSummary(passed).contains("older/changed revision"))
        passed.remove("stale")
        assertTrue(testSummary(passed).contains("rerun"))
    }
    @Test fun failureInterruptionAndCancellationNeverBecomePassingResults() {
        val failed = JSONObject().put("status", "done").put("exitCode", 7).put("stale", false)
        assertTrue(testSummary(failed).contains("failed (exit 7)"))
        for (status in listOf("running", "queued", "interrupted", "cancelled", "failed")) {
            val summary = testSummary(JSONObject().put("status", status).put("exitCode", 0).put("stale", false))
            assertFalse(summary.contains("Tests: passed"))
        }
    }
    @Test fun diffRetainsExactTextAndUsesDistinctAdditionRemovalColors() {
        val text = "diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n context\n"
        val diff = coloredDiff(text)
        assertEquals(text, diff.toString())
        fun colorAt(marker: String): Int {
            val start = text.indexOf(marker)
            return diff.getSpans(start, start + marker.length, ForegroundColorSpan::class.java).first().foregroundColor
        }
        assertNotEquals(colorAt("-old"), colorAt("+new"))
        assertEquals(PocketColors.accent, colorAt("+++ b/file"))
    }
}
