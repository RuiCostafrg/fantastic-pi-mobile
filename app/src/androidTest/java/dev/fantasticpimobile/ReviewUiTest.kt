package dev.fantasticpimobile

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
    @Test fun changesEntryNeedsFilesOrAnUnresolvedAction() {
        assertFalse(hasReviewChanges(null))
        assertFalse(hasReviewChanges(JSONObject().put("fileCount", 0)))
        assertTrue(hasReviewChanges(JSONObject().put("fileCount", 2)))
        assertTrue(hasReviewChanges(JSONObject().put("fileCount", 0).put("repositoryActionActive", true)))
        assertTrue(hasReviewChanges(null, uncertainRequest = true))
        val full = JSONObject("""{"files":[{"path":"a"}],"committedFiles":[{"path":"a"},{"path":"b"}]}""")
        assertEquals(2, reviewFileCount(full))
        assertTrue(hasReviewChanges(full))
        assertFalse(hasReviewChanges(JSONObject().put("operation", JSONObject().put("status", "done"))))
    }
    @Test fun readableDiffCountsBothSidesAndPreservesCodeNotGitHeaders() {
        val patch = "diff --git a/a b/a\nindex abc..def 100644\n--- a/a\n+++ b/a\n@@ -8,3 +12,3 @@\n context\n---old-content\n+++new-content\n \\tend\n\\ No newline at end of file\n"
        val diff = readableDiff(patch)
        assertEquals(1, diff.added); assertEquals(1, diff.removed)
        assertEquals(DiffLine(9, null, '-', "--old-content"), diff.lines.first { it.kind == '-' })
        assertEquals(DiffLine(null, 13, '+', "++new-content"), diff.lines.first { it.kind == '+' })
        assertTrue(diff.lines.any { it.before == 10 && it.after == 14 })
        assertFalse(diffReaderText(diff).contains("index abc"))
        assertTrue(diffReaderText(diff).contains("No newline at end of file"))
        assertTrue(diffReaderText(diff).contains("−"))
    }
    @Test fun newFilesBinaryAndEmptyFilesAreNotInventedCode() {
        val fresh = readableDiff("New file: a.txt\n+hello\n+")
        assertEquals(1, fresh.added); assertEquals(1, fresh.lines.first().after)
        assertEquals(0, readableDiff("Binary files a/x and b/x differ\n").added)
        assertEquals(0, readableDiff("New file: empty\n+").added)
        assertTrue(readableDiff("New symbolic link → target").lines.any { it.content.contains("target") })
        assertEquals("Modified", fileStatusLabel(" M"))
        assertEquals("Added", fileStatusLabel("??"))
        assertEquals("Conflict", fileStatusLabel("UU"))
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
        assertEquals(FantasticPiMobileColors.accent, colorAt("+++ b/file"))
    }
}
