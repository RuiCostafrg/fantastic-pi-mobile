package dev.fantasticpimobile

import org.json.JSONObject

/** Identity failures are not proof that accepted external work stopped or was rejected. */
class ProjectIdentityException(message: String) : Exception(message)

/** HTTP policy without an Activity: selection/IDs are never reconstructed from titles or cwd. */
class ProjectRequests(
    private val beforeLegacySubmit: (String) -> Unit = { throw ProjectIdentityException("Legacy project must be saved before submission") },
    private val request: (String, JSONObject?) -> JSONObject
) {
    fun fetch(job: Job, sessionProjectId: String?): JSONObject {
        if (job.projectId != null && sessionProjectId != null && job.projectId != sessionProjectId) throw ProjectIdentityException("Saved request/chat projects conflict")
        if (job.projectState in listOf(ProjectState.SELECTED, ProjectState.BOUND) && job.projectId == null) throw ProjectIdentityException("Saved request is missing its project")
        val expected = job.projectId ?: sessionProjectId
        val value = if (job.status != "sending") request("/v1/jobs/${job.id}", null) else {
            val health = request("/health", null)
            if (health.optInt("protocolVersion") < 3 || !health.optBoolean("worktreeIsolation")) {
                throw BridgeException(426, "Update the bridge for isolated Git worktrees")
            }
            if (job.projectState == ProjectState.UNBOUND) throw BridgeException(400, "Choose a project for this new chat before sending")
            if (expected != null) {
                requireCapability(health)
                request("/v1/jobs", payload(job, expected))
            } else {
                // Upgraded sending rows may already have been accepted. Recover exact ID first;
                // never stamp an old chat with today's default or manufacture another request ID.
                val recovered = try { request("/v1/jobs/${job.id}", null) }
                    catch (error: BridgeException) { if (error.code == 404) null else throw error }
                if (recovered != null) recovered else {
                    requireCapability(health)
                    val binding = request("/v1/sessions/${job.sessionId}/project", null)
                    if (binding.optString("sessionId") != job.sessionId || projectId(binding) == null) {
                        throw ProjectIdentityException("Cannot prove this legacy chat's project; nothing submitted")
                    }
                    val project = projectId(binding)!!
                    // Freeze proved legacy identity before dispatch: a lost response must not
                    // let a later retry resolve the same ID against a replacement owner's default.
                    beforeLegacySubmit(project)
                    request("/v1/jobs", payload(job, project)).also { validateProject(project, it) }
                }
            }
        }
        validateJob(job, sessionProjectId, value)
        return value
    }

    fun sendReview(sessionId: String, body: JSONObject, expected: String?): JSONObject {
        val saved = projectId(body)
        if (saved != null && expected != null && saved != expected) throw ProjectIdentityException("Saved operation belongs to another project")
        if (body.has("projectId") && saved == null) throw ProjectIdentityException("Saved operation has an invalid explicit project")
        requireCapability(request("/health", null))
        var verified = saved ?: expected
        if (saved == null) {
            val binding = request("/v1/sessions/$sessionId/project", null)
            if (binding.optString("sessionId") != sessionId || projectId(binding) == null) throw ProjectIdentityException("Cannot prove the saved operation's chat binding")
            validateProject(expected, binding)
            verified = projectId(binding)
        }
        if (saved == null) beforeLegacySubmit(verified!!)
        // Enrich a transport copy, never rewrite saved legacy operation JSON or its exact ID.
        val outgoing = JSONObject(body.toString()).apply { if (verified != null) put("projectId", verified) }
        return request("/v1/sessions/$sessionId/actions", outgoing).also {
            validateOperation(sessionId, body.getString("operationId"), verified, it)
        }
    }

    companion object {
        fun validId(value: String) = Regex("[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}").matches(value)
        fun projectId(value: JSONObject): String? {
            if (!value.has("projectId") || value.isNull("projectId")) return null
            val id = value.opt("projectId")
            if (id !is String || !validId(id)) throw ProjectIdentityException("Bridge returned an invalid project identity")
            return id
        }
        fun requireCapability(health: JSONObject) {
            if (health.optInt("protocolVersion") < 5 || health.opt("projectBindings") != true) {
                throw BridgeException(426, "Update the bridge for project bindings; the saved project was not submitted or changed")
            }
        }
        fun payload(job: Job, projectId: String?): JSONObject = JSONObject().put("requestId", job.id)
            .put("text", job.text).put("sessionId", job.sessionId).apply { if (projectId != null) put("projectId", projectId) }
        fun validateProject(expected: String?, response: JSONObject) {
            val actual = projectId(response)
            if (expected != null && actual != expected) throw ProjectIdentityException("Bridge returned a missing or different project; result not applied")
        }
        fun validateJob(job: Job, sessionProjectId: String?, response: JSONObject) {
            if (response.optString("id") != job.id || response.optString("sessionId", "pocket") != job.sessionId) {
                throw ProjectIdentityException("Bridge returned another request/chat; result not applied")
            }
            if (job.projectId != null && sessionProjectId != null && job.projectId != sessionProjectId) throw ProjectIdentityException("Saved request/chat projects conflict")
            validateProject(job.projectId ?: sessionProjectId, response)
            if (response.optString("status") !in listOf("queued", "running", "done", "failed", "cancelled", "interrupted")) {
                throw ProjectIdentityException("Unknown bridge job state")
            }
        }
        fun validateReview(sessionId: String, expected: String?, response: JSONObject) {
            validateProject(expected, response)
            response.optJSONObject("operation")?.let { operation ->
                validateOperation(sessionId, operation.optString("id"), expected ?: projectId(response), operation)
            }
        }
        fun validateOperation(sessionId: String, id: String, expected: String?, response: JSONObject) {
            if (response.optString("id") != id || response.optString("sessionId") != sessionId) throw ProjectIdentityException("Bridge returned another repository operation")
            validateProject(expected, response)
        }
        fun permanentSubmission(error: Exception) = error is BridgeException && error.code in listOf(400, 404, 409, 413, 426)
    }
}
