package dev.fantasticpimobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** One-off, explicitly invoked migration helper. Not included in the application APK. */
@RunWith(AndroidJUnit4::class)
class MigrationPairingTest {
    @Test fun importPrivatePairingFile() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeTrue(InstrumentationRegistry.getArguments().getString("migration") == "confirmed")
        check(context.packageName == "dev.fantasticpimobile")
        val file = java.io.File(context.filesDir, "migration-pairing.json")
        check(file.isFile) { "Explicit private migration input required" }
        try {
            val input = JSONObject(file.readText())
            Connection(context).save(input.getString("endpoint"), input.getString("token"))
            assertTrue(Connection(context).paired)
        } finally {
            check(file.delete()) { "Remove private migration input before continuing" }
        }
    }
}
