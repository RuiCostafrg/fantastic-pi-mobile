package dev.fantasticpimobile

import org.json.JSONObject

data class CodingProject(val id: String, val name: String, val source: String, val kind: String, val target: String) {
    val details get() = "$name\n$source\n${if (kind == "local") "Local branch" else "Remote default"}: $target\nID: $id"
}
data class ProjectChoices(val projects: List<CodingProject>, val binding: String?)

/** Read-only discovery is separate from deliberate registration and local selection. */
class ProjectCatalog(private val request: (String, JSONObject?) -> JSONObject) {
    fun projects(): List<CodingProject> {
        ProjectRequests.requireCapability(request("/health", null))
        val rows = request("/v1/projects", null).getJSONArray("projects")
        val projects = (0 until rows.length()).map { parse(rows.getJSONObject(it)) }
        if (projects.map { it.id }.distinct().size != projects.size) throw ProjectIdentityException("Duplicate project identities")
        return projects
    }
    fun load(session: ChatSession): ProjectChoices {
        val projects = projects()
        val binding = try {
            val value = request("/v1/sessions/${session.id}/project", null)
            if (value.optString("sessionId") != session.id) throw ProjectIdentityException("Another chat's project was returned")
            val id = ProjectRequests.projectId(value) ?: throw ProjectIdentityException("Missing chat project")
            ProjectRequests.validateProject(session.projectId, value)
            id
        } catch (error: BridgeException) { if (error.code == 404) null else throw error }
        if (session.projectState == ProjectState.BOUND && binding == null) throw ProjectIdentityException("Established binding unavailable; create no replacement")
        if (binding != null && projects.none { it.id == binding }) throw ProjectIdentityException("Bound project is missing from the registry")
        return ProjectChoices(projects, binding)
    }
    fun register(body: JSONObject): CodingProject {
        require(body.opt("confirmRegistration") == true) { "Confirm the trusted source and policy first" }
        ProjectRequests.requireCapability(request("/health", null))
        return parse(request("/v1/projects", body))
    }
    companion object {
        fun editable(session: ChatSession, hasJobs: Boolean) = !session.archived && !hasJobs &&
            session.projectState in listOf(ProjectState.UNBOUND, ProjectState.SELECTED)
        fun registration(name: String, source: String, kind: String, target: String): JSONObject {
            require(name.isNotBlank() && source.startsWith("/") && target.isNotBlank()) { "Enter a name, absolute trusted checkout path and branch/remote" }
            require(kind in listOf("local", "remote")) { "Choose a local branch or remote default" }
            return JSONObject().put("name", name.trim()).put("source", source.trim())
                .put("branchPolicy", JSONObject().put("kind", kind).put(if (kind == "local") "branch" else "remote", target.trim()))
        }
        fun parse(value: JSONObject): CodingProject {
            val id = ProjectRequests.projectId(value) ?: throw ProjectIdentityException("Missing project identity")
            val policy = value.getJSONObject("branchPolicy")
            val kind = policy.getString("kind")
            require(kind in listOf("local", "remote")) { "Unknown branch policy" }
            val name = value.getString("name"); val source = value.getString("source")
            val target = policy.getString(if (kind == "local") "branch" else "remote")
            require(name.isNotBlank() && source.startsWith("/") && target.isNotBlank()) { "Incomplete project details" }
            return CodingProject(id, name, source, kind, target)
        }
    }
}
