package dev.fantasticpimobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import android.os.SystemClock
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class BridgeException(val code: Int, message: String) : Exception(message)

class Connection(context: Context) {
    private val prefs = context.getSharedPreferences("connection", Context.MODE_PRIVATE)
    val paired: Boolean get() = prefs.contains("token") && prefs.contains("iv")
    private var lastOutcome: String? = null
    val endpoint: String get() = prefs.getString("endpoint", "http://127.0.0.1:8787")!!
    // Includes encrypted credential identity, so same-URL re-pairing invalidates in-flight proof.
    internal val identity: String get() = ConversationCachePolicy.digest(endpoint + ":" + prefs.getString("iv", "") + ":" + prefs.getString("token", ""))
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("fantastic-pi-mobile-token", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("fantastic-pi-mobile-token", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun save(endpoint: String, token: String) {
        val uri = URI(endpoint.trim())
        require(uri.host != null && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null && uri.path.orEmpty() in listOf("", "/")) { "Use a base URL without a path or credentials" }
        require(uri.scheme == "https" || (uri.scheme == "http" && uri.host in listOf("127.0.0.1", "localhost"))) { "HTTP is allowed only on localhost; remote bridges require HTTPS" }
        require(token.length >= 32) { "Token needs at least 32 characters" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString("endpoint", endpoint.trim().trimEnd('/'))
            .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString("token", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()) { "Could not save settings" }
    }
    private fun token(): String {
        val encrypted = prefs.getString("token", null) ?: error("Open Settings and pair your bridge first")
        val iv = Base64.decode(prefs.getString("iv", ""), Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv)) }
        return String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), Charsets.UTF_8)
    }
    fun request(path: String, body: JSONObject? = null): JSONObject = requestAt(endpoint, path, body)
    /** A health/binding proof must never be followed by POST to a newly paired endpoint. */
    fun requestAt(expectedEndpoint: String, path: String, body: JSONObject? = null,
        headers: Map<String, String> = emptyMap(), expectedIdentity: String? = null): JSONObject {
        if (expectedIdentity != null && identity != expectedIdentity) throw ProjectIdentityException("Pairing changed; request preserved")
        if (endpoint != expectedEndpoint) throw ProjectIdentityException("Bridge connection changed; request preserved")
        val authorization = token()
        if (endpoint != expectedEndpoint || expectedIdentity != null && identity != expectedIdentity) throw ProjectIdentityException("Bridge connection changed; request preserved")
        val started = SystemClock.elapsedRealtime()
        val method = if (body == null) "GET" else "POST"
        val route = when { path == "/health" -> "health"; path == "/v1/jobs" -> "submit"; path.startsWith("/v1/sessions/") -> "review"; else -> "job" }
        val conn = URL(expectedEndpoint + path).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 5000; conn.readTimeout = 15000
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Authorization", "Bearer " + authorization)
            headers.forEach { (name, value) ->
                require(name in setOf("X-Conversation-Schema", "X-Conversation-Owner", "X-History-Schema"))
                conn.setRequestProperty(name, value)
            }
            if (body != null) {
                val bytes = body.toString().toByteArray(Charsets.UTF_8)
                conn.requestMethod = "POST"; conn.doOutput = true
                // Streaming mode prevents HttpURLConnection silently replaying a buffered POST
                // after a lost response. Recovery belongs to the persisted exact-ID policy.
                conn.setFixedLengthStreamingMode(bytes.size)
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(bytes) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val result = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val json = if (result.isBlank()) JSONObject() else JSONObject(result)
            if (code !in 200..299) throw BridgeException(code, json.optString("error", "Bridge HTTP $code"))
            outcome("$method $route HTTP $code", started, false)
            return json
        } catch (error: Exception) {
            // Deliberately omit exception messages, bodies, URLs and credentials.
            val reason = if (error is BridgeException) "HTTP ${error.code}" else error.javaClass.simpleName
            outcome("$method $route $reason", started, true)
            throw error
        } finally { conn.disconnect() }
    }
    @Synchronized private fun outcome(value: String, started: Long, failed: Boolean) {
        if (value == lastOutcome) return // Do not spam identical polling failures.
        lastOutcome = value
        val message = "$value durationMs=${SystemClock.elapsedRealtime() - started}"
        if (failed) Log.w("FantasticPiMobile", message) else Log.i("FantasticPiMobile", message)
    }
}
