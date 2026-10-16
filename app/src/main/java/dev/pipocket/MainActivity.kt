package dev.pipocket

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognizerIntent
import android.text.InputType
import android.view.View
import android.widget.*
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private lateinit var history: History
    private lateinit var connection: Connection
    private lateinit var draft: EditText
    private lateinit var transcript: TextView
    private lateinit var status: TextView
    private lateinit var send: Button
    private lateinit var stop: Button
    private val worker = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private var visible = false
    private var polling = false
    private var dialogId: String? = null
    private var current: Job? = null
    private val poll = object : Runnable {
        override fun run() {
            if (!visible) return
            refresh()
            handler.postDelayed(this, 1500)
        }
    }
    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
    private fun label(text: String, size: Float = 16f) = TextView(this).apply {
        this.text = text; textSize = size; setTextColor(Color.rgb(231, 235, 244)); setPadding(0, dp(6), 0, dp(6))
    }
    private fun button(text: String, action: () -> Unit) = Button(this).apply { this.text = text; setOnClickListener { action() } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(18, 22, 34)
        window.navigationBarColor = Color.rgb(18, 22, 34)
        // Do not draw controls underneath Android 15 edge-to-edge system bars.
        history = History(this); connection = Connection(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(12), dp(18), dp(12))
            setBackgroundColor(Color.rgb(18, 22, 34))
            setOnApplyWindowInsetsListener { view, insets ->
                view.setPadding(dp(18) + insets.systemWindowInsetLeft, dp(12) + insets.systemWindowInsetTop,
                    dp(18) + insets.systemWindowInsetRight, dp(12) + insets.systemWindowInsetBottom)
                insets.consumeSystemWindowInsets()
            }
        }
        val header = LinearLayout(this)
        header.addView(label("✦ Pi Pocket", 26f), LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(button("Settings") { settings() })
        root.addView(header)
        root.addView(label("Your voice. Your projects. Your Pi.", 14f))
        status = label("Pair your local bridge in Settings.", 13f); root.addView(status)
        transcript = label("", 16f).apply { setTextIsSelectable(true) }
        val scroll = ScrollView(this).apply { addView(transcript) }
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(label("Review your words, then tap Send. Pi can change files and operate your device.", 12f))
        draft = EditText(this).apply {
            hint = "What shall we do?"; setTextColor(Color.WHITE); setHintTextColor(Color.LTGRAY)
            minLines = 2; maxLines = 5; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            setText(savedInstanceState?.getString("draft").orEmpty())
        }
        root.addView(draft)
        val actions = LinearLayout(this)
        actions.addView(button("Talk") { speak() }, LinearLayout.LayoutParams(0, -2, 1f))
        send = button("Send") { submit() }; actions.addView(send, LinearLayout.LayoutParams(0, -2, 1f))
        stop = button("Stop") { current?.let { job -> network { connection.request("/v1/jobs/" + job.id + "/cancel", JSONObject()); "Stop requested" } } }
        actions.addView(stop, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(actions)
        setContentView(root)
        render()
    }
    override fun onStart() { super.onStart(); visible = true; handler.post(poll) }
    override fun onStop() { visible = false; handler.removeCallbacks(poll); super.onStop() }
    override fun onDestroy() { worker.shutdown(); super.onDestroy() }
    override fun onSaveInstanceState(outState: Bundle) { outState.putString("draft", draft.text.toString()); super.onSaveInstanceState(outState) }

    private fun render() {
        val jobs = history.recent()
        current = jobs.firstOrNull { it.active }
        send.isEnabled = current == null
        stop.isEnabled = current != null && current?.status != "sending"
        transcript.text = if (jobs.isEmpty()) "Hey! Tap Talk or type a request.\n\nTry: “Inspect my project and explain what to build next.”\n\nVoice recognition is provided by your installed Android speech service and may use its cloud servers."
        else jobs.reversed().joinToString("\n\n────────────────\n\n") {
            "YOU\n" + it.text + "\n\nPI · " + it.status.uppercase() + "\n" + it.answer.ifBlank { "Waiting for Pi…" }
        }
    }
    private fun submit() {
        val text = draft.text.toString().trim()
        if (text.isBlank() || current != null) return
        if (text.length > 20000) { status.text = "Please keep requests under 20,000 characters"; return }
        history.add(UUID.randomUUID().toString(), text)
        draft.setText(""); render(); refresh()
    }
    private fun refresh() {
        if (polling) return
        val job = history.recent().firstOrNull { it.active } ?: return
        polling = true
        worker.execute {
            try {
                val result = if (job.status == "sending") connection.request("/v1/jobs", JSONObject().put("requestId", job.id).put("text", job.text))
                else connection.request("/v1/jobs/" + job.id)
                history.update(job.id, result.getString("status"), result.optString("answer"))
                handler.post {
                    polling = false
                    if (!isDestroyed && visible) {
                        render(); status.text = result.optString("progress").ifBlank { "Bridge connected · " + result.getString("status") }
                        val pending = result.optJSONObject("pending")
                        if (pending != null) showApproval(job.id, pending)
                    }
                }
            } catch (error: Exception) {
                val rejected = job.status == "sending" && error is BridgeException && error.code in listOf(400, 409)
                if (rejected) history.update(job.id, "rejected", error.message ?: "Request rejected")
                handler.post {
                    polling = false
                    if (!isDestroyed && visible) {
                        render()
                        status.text = if (rejected) "Request rejected: " + error.message
                        else "Not delivered/updated: " + (error.message ?: "Connection error") + ". Retrying with the same request ID."
                    }
                }
            }
        }
    }
    private fun network(action: () -> String) {
        worker.execute {
            val message = try { action() } catch (error: Exception) { error.message ?: "Connection error" }
            handler.post { if (!isDestroyed && visible) { status.text = message; refresh() } }
        }
    }
    private fun showApproval(jobId: String, pending: JSONObject) {
        val id = pending.getString("id")
        if (dialogId == id || !visible) return
        dialogId = id
        val method = pending.getString("method")
        val builder = AlertDialog.Builder(this).setTitle(pending.optString("title", "Pi extension"))
        fun reply(json: JSONObject) {
            dialogId = null
            network { connection.request("/v1/jobs/$jobId/ui", json.put("id", id)); "Response sent" }
        }
        builder.setOnCancelListener { reply(JSONObject().put("cancelled", true)) }
        when (method) {
            "confirm" -> builder.setMessage(pending.optString("message"))
                .setPositiveButton("Allow") { _, _ -> reply(JSONObject().put("confirmed", true)) }
                .setNegativeButton("Deny") { _, _ -> reply(JSONObject().put("confirmed", false)) }
            "select" -> {
                val options = pending.getJSONArray("options")
                builder.setItems(Array(options.length()) { options.getString(it) }) { _, index ->
                    reply(JSONObject().put("value", options.getString(index)))
                }.setNegativeButton("Cancel") { _, _ -> reply(JSONObject().put("cancelled", true)) }
            }
            else -> {
                val input = EditText(this).apply {
                    hint = pending.optString("placeholder"); setText(pending.optString("prefill"))
                    inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
                }
                builder.setView(input).setPositiveButton("Send") { _, _ -> reply(JSONObject().put("value", input.text.toString())) }
                    .setNegativeButton("Cancel") { _, _ -> reply(JSONObject().put("cancelled", true)) }
            }
        }
        builder.show()
    }
    private fun settings() {
        val fields = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(8), dp(20), dp(8)) }
        val url = EditText(this).apply { hint = "Bridge URL"; setText(connection.endpoint); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI }
        val token = EditText(this).apply { hint = "Paste pairing token (never shown again)"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        fields.addView(url); fields.addView(token)
        val dialog = AlertDialog.Builder(this).setTitle("Pair Pi in Termux").setView(fields)
            .setMessage("Default: http://127.0.0.1:8787. Keep the bridge running in Termux. Token is encrypted with Android Keystore.")
            .setPositiveButton("Save", null).setNeutralButton("Test") { _, _ -> network { connection.request("/health"); "Bridge connected ✓" } }
            .setNegativeButton("Cancel", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                try { connection.save(url.text.toString(), token.text.toString()); dialog.dismiss(); network { connection.request("/health"); "Bridge connected ✓" } }
                catch (error: Exception) { token.error = error.message }
            }
        }
        dialog.show()
    }
    private fun speak() {
        try {
            startActivityForResult(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Talk to Pi Pocket")
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            }, 42)
        } catch (_: ActivityNotFoundException) { status.text = "No speech service installed. You can still type your request." }
    }
    @Deprecated("Platform activity result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 42 && resultCode == RESULT_OK) {
            data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let { draft.setText(it); draft.setSelection(it.length) }
        }
    }
}
