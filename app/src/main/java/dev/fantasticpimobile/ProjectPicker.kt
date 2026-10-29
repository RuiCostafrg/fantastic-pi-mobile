package dev.fantasticpimobile

import android.app.Activity
import android.app.AlertDialog
import android.os.Handler
import android.widget.*
import org.json.JSONObject
import java.util.concurrent.Executor

/** Native, scrollable picker. All history adoption occurs on the UI thread after ownership checks. */
class ProjectPicker(
    private val activity: Activity, private val history: History, private val connection: Connection,
    private val worker: Executor, private val handler: Handler,
    private val current: (String) -> Boolean, private val changed: () -> Unit,
    private val modal: (Boolean) -> Unit
) {
    private var dialog: AlertDialog? = null
    @Volatile private var generation = 0
    private var cacheEndpoint = ""
    private val cache = mutableMapOf<String, CodingProject>()
    fun label(session: ChatSession): String {
        val project = if (cacheEndpoint == connection.endpoint) cache[session.projectId] else null
        val identity = project?.let { "${it.name} · ${if (it.kind == "local") "branch" else "remote"} ${it.target}\n${it.source}" } ?: session.projectId
        return when (session.projectState) {
            ProjectState.UNBOUND -> "Choose project before Send"
            ProjectState.LEGACY_UNRESOLVED -> "Project unresolved · check established binding"
            else -> "Project · $identity · ${if (ProjectCatalog.editable(session, history.jobs(session.id).isNotEmpty())) "change" else "locked"}"
        }
    }
    fun close() { generation++; dialog?.dismiss(); dialog = null }
    fun refreshLabel(session: ChatSession) {
        if (!connection.paired || session.projectId == null) return
        val endpoint = connection.endpoint; val token = generation
        worker.execute {
            val rows = runCatching { catalog(endpoint) { token == generation && current(session.id) }.projects() }
            handler.post {
                if (token == generation && current(session.id) && endpoint == connection.endpoint) {
                    rows.getOrNull()?.let { remember(endpoint, it); changed() }
                }
            }
        }
    }
    private fun remember(endpoint: String, projects: List<CodingProject>) {
        cacheEndpoint = endpoint; cache.clear(); projects.forEach { cache[it.id] = it }
    }
    private fun catalog(endpoint: String, valid: () -> Boolean): ProjectCatalog {
        val identity = connection.identity
        return ProjectCatalog { path, body ->
            if (!valid() || endpoint != connection.endpoint || identity != connection.identity) throw ProjectIdentityException("Chat or bridge changed; project not applied")
            connection.requestAt(endpoint, path, body, expectedIdentity = identity).also {
                if (!valid() || identity != connection.identity) throw ProjectIdentityException("Pairing changed; project not applied")
            }
        }
    }
    fun show(sessionId: String) {
        close()
        val session = history.session(sessionId) ?: return
        val endpoint = connection.endpoint; val token = generation
        val content = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL; setPadding(activity.dp(20), activity.dp(8), activity.dp(20), activity.dp(12))
        }
        val popup = AlertDialog.Builder(activity).setTitle("Chat project")
            .setView(ScrollView(activity).apply { addView(content) }).setNegativeButton("Close", null).create()
        dialog = popup; modal(true)
        popup.setOnDismissListener { if (dialog === popup) { dialog = null; generation++; modal(false) } }
        popup.show()
        fun valid() = token == generation && current(sessionId) && dialog === popup && popup.isShowing && endpoint == connection.endpoint
        fun text(value: String) { content.addView(activity.textLabel(value)) }
        fun button(value: String, action: () -> Unit) { content.addView(activity.actionButton(value, action = action)) }
        fun error(error: Throwable, retry: () -> Unit) {
            content.removeAllViews()
            text("Project unavailable. ${error.message ?: "Check the bridge connection"}\nSaved project and draft are unchanged. No default fallback.")
            button("Retry", retry)
        }
        fun <T> runTask(action: () -> T, success: (T) -> Unit, retry: () -> Unit) {
            content.removeAllViews(); text("Checking projects…")
            worker.execute {
                val result = runCatching(action)
                handler.post {
                    if (valid()) result.fold({ value ->
                        try { success(value) } catch (failure: Exception) { error(failure, retry) }
                    }, { failure -> error(failure, retry) })
                }
            }
        }
        val api = catalog(endpoint, ::valid)
        lateinit var load: () -> Unit
        fun registration() {
            content.removeAllViews()
            text("Register a trusted local Git checkout. This does not send a request or create a worktree.")
            fun field(label: String) = EditText(activity).apply {
                hint = label; contentDescription = label; isSingleLine = true; content.addView(this)
            }
            val name = field("Project name"); val source = field("Absolute checkout path")
            val policy = Spinner(activity).apply {
                adapter = ArrayAdapter(activity, android.R.layout.simple_spinner_dropdown_item, listOf("Local branch (offline OK)", "Remote default"))
                contentDescription = "Branch policy"; content.addView(this)
            }
            val target = field("Branch or remote name")
            val problem = activity.textLabel(""); content.addView(problem)
            button("Review registration") {
                try {
                    val body = ProjectCatalog.registration(name.text.toString(), source.text.toString(), if (policy.selectedItemPosition == 0) "local" else "remote", target.text.toString())
                    content.removeAllViews()
                    text("Trust this repository?\n${body.getString("name")}\n${body.getString("source")}\n${body.getJSONObject("branchPolicy")}\n\nLater requests can use host-user tools, files and phone access. This is not a sandbox. No fetch, commit, merge or job runs during registration.")
                    button("Confirm trusted registration") {
                        body.put("confirmRegistration", true)
                        runTask({ api.register(body) }, { load() }, { load() })
                    }
                    button("Back to form") { registration() }
                } catch (failure: Exception) { problem.text = failure.message }
            }
            button("Back to projects") { load() }
        }
        load = {
            if (!connection.paired) {
                content.removeAllViews(); text("Pair the bridge first. Close this panel and tap Pair bridge. The draft is preserved.")
            } else runTask({ api.load(history.session(sessionId) ?: session) }, { choices ->
                remember(endpoint, choices.projects)
                if (choices.binding != null) history.confirmProject(sessionId, choices.binding)
                else if (history.session(sessionId)?.projectState == ProjectState.LEGACY_UNRESOLVED && history.jobs(sessionId).isEmpty()) history.resolveEmptyDraft(sessionId)
                val chat = history.session(sessionId) ?: error("Chat no longer exists")
                val editable = ProjectCatalog.editable(chat, history.jobs(sessionId).isNotEmpty())
                changed(); content.removeAllViews()
                if (!editable) {
                    text(chat.projectId?.let { id -> choices.projects.firstOrNull { it.id == id }?.details ?: "Project ID: $id" }
                        ?: "Project unresolved. Submitted history needs exact-request reconciliation; no project can be selected here.")
                    text("Established chats cannot switch repositories. Create a new chat to use another project.")
                } else {
                    text("Choose a project before Send. The first saved request locks this choice. Registration/listing alone does not execute work.")
                    if (choices.projects.isEmpty()) text("No registered projects. Register a trusted checkout below.")
                    for (project in choices.projects) button(project.details + if (chat.projectId == project.id) "\nSelected" else "") {
                        if (valid()) {
                            try { history.selectProject(sessionId, project.id); changed(); popup.dismiss() }
                            catch (failure: Exception) { error(failure, load) }
                        }
                    }
                    button("Register trusted project") { registration() }
                }
            }, { load() })
        }
        load()
    }
}
