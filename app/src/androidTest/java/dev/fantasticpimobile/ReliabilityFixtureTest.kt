package dev.fantasticpimobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Only the explicitly isolated fixture APK may seed/reset its own application database. */
@RunWith(AndroidJUnit4::class)
class ReliabilityFixtureTest {
    @Test fun fixture() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        assumeTrue(context.packageName == "dev.fantasticpimobile.reliability")
        val args = InstrumentationRegistry.getArguments()
        when (args.getString("phase")) {
            "seed" -> {
                context.deleteDatabase("fantastic-pi-mobile.sqlite")
                context.getSharedPreferences("chat-ui", 0).edit().clear().commit()
                context.getSharedPreferences("review-requests", 0).edit().clear().commit()
                Connection(context).save(args.getString("endpoint")!!, "pocket-reliability-fixture-only-token")
                History(context).use { history ->
                    history.rename("pocket", "Fixture approval")
                    history.add("fixture-approval", "pocket", "confirm")
                    val other = history.createSession()
                    history.rename(other, "Fixture parallel")
                    history.add("fixture-parallel", other, "hang")
                    val selected = history.createSession()
                    history.rename(selected, "Fixture selected")
                    history.saveDraft(selected, "Unsent fixture draft")
                    context.getSharedPreferences("chat-ui", 0).edit().putString("selected", selected).commit()
                }
            }
            "verify" -> History(context).use { history ->
                val selected = context.getSharedPreferences("chat-ui", 0).getString("selected", "")!!
                assertEquals("Fixture selected", history.session(selected)!!.title)
                assertEquals("Unsent fixture draft", history.session(selected)!!.draft)
                assertTrue(history.jobs(selected).isEmpty())
                assertTrue(Connection(context).paired)
                val jobs = history.sessions().flatMap { history.jobs(it.id) }.associateBy { it.id }
                assertEquals(setOf("fixture-approval", "fixture-parallel"), jobs.keys)
                for ((id, key) in listOf("fixture-approval" to "approval", "fixture-parallel" to "parallel")) {
                    val job = jobs.getValue(id)
                    assertEquals(args.getString(key), job.status)
                    if (!job.active || id == "fixture-parallel") assertEquals("", job.pending)
                    else assertEquals("dialog", org.json.JSONObject(job.pending).getString("id"))
                }
            }
            else -> assumeTrue("Fixture phases are run by scripts/check-reliability.py", false)
        }
    }
}
