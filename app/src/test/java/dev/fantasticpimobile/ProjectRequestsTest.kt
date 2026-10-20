package dev.fantasticpimobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

/** Headless tests of the real request policy. No Activity, device or provider is used. */
class ProjectRequestsTest {
    private fun health(version: Int = 5, capability: Any = true) = JSONObject().put("protocolVersion", version)
        .put("projectBindings", capability).put("worktreeIsolation", true)
    private fun job(project: String? = "project-a", state: ProjectState = ProjectState.SELECTED, status: String = "sending") =
        Job("exact-request", "Original text", status, "", "exact-chat", "", "", project, state)
    private fun response(job: Job, project: String? = job.projectId) = JSONObject().put("id", job.id)
        .put("sessionId", job.sessionId).put("status", "done").apply { if (project != null) put("projectId", project) }
    private inline fun <reified T : Exception> fails(block: () -> Unit): T {
        try { block() } catch (error: Exception) { if (error is T) return error; throw error }
        throw AssertionError("Expected ${T::class.java.simpleName}")
    }
    @Test fun selectionAndExactIdsAreNeverDroppedFromSubmission() {
        val saved = job()
        val calls = mutableListOf<Pair<String, JSONObject?>>()
        val client = ProjectRequests { path, body -> calls.add(path to body); if (path == "/health") health() else response(saved) }
        client.fetch(saved, "project-a")
        assertEquals(listOf("/health", "/v1/jobs"), calls.map { it.first })
        val body = calls.last().second!!
        assertEquals("exact-request", body.getString("requestId")); assertEquals("exact-chat", body.getString("sessionId"))
        assertEquals("Original text", body.getString("text")); assertEquals("project-a", body.getString("projectId"))
        assertEquals(saved, job())
    }
    @Test fun oldMissingFalseAndStringCapabilitiesRefuseBeforePost() {
        for (h in listOf(health(4), health(5, false), health(5, "true"), health().apply { remove("projectBindings") })) {
            val calls = mutableListOf<String>()
            val error = fails<BridgeException> { ProjectRequests { path, _ -> calls.add(path); h }.fetch(job(), "project-a") }
            assertEquals(426, error.code); assertEquals(listOf("/health"), calls)
        }
    }
    @Test fun offlineAndDroppedAcceptancePreserveTheSameSelectedPayloadForRetry() {
        val saved = job()
        val submissions = mutableListOf<String>()
        var online = false
        val client = ProjectRequests { path, body ->
            if (!online) throw IOException("offline")
            if (path == "/health") health() else { submissions.add(body.toString()); throw IOException("response lost") }
        }
        fails<IOException> { client.fetch(saved, "project-a") }
        assertTrue(submissions.isEmpty())
        online = true
        repeat(2) { fails<IOException> { client.fetch(saved, "project-a") } }
        assertEquals(2, submissions.size); assertEquals(submissions[0], submissions[1])
        assertEquals("project-a", saved.projectId); assertEquals("exact-request", saved.id)
    }
    @Test fun newUnboundChatCannotAccidentallyUseTheDefault() {
        val calls = mutableListOf<String>()
        val error = fails<BridgeException> { ProjectRequests { path, _ -> calls.add(path); health() }.fetch(job(null, ProjectState.UNBOUND), null) }
        assertEquals(400, error.code); assertEquals(listOf("/health"), calls)
    }
    @Test fun legacySendingRecoversExactAcceptedJobBeforeConsideringPost() {
        val saved = job(null, ProjectState.LEGACY_UNRESOLVED)
        val calls = mutableListOf<String>()
        val result = ProjectRequests { path, _ -> calls.add(path); if (path == "/health") health() else response(saved, "historical-project") }.fetch(saved, null)
        assertEquals("historical-project", result.getString("projectId"))
        assertEquals(listOf("/health", "/v1/jobs/exact-request"), calls)
        // Accepted legacy work can still be polled on an old bridge without inferring a default ID.
        val oldResult = ProjectRequests { _, _ -> response(saved) }.fetch(saved.copy(status = "running"), null)
        assertNull(ProjectRequests.projectId(oldResult))
    }
    @Test fun unresolvedLegacyNeedsProvedBindingSavedBeforeRetryAndKeepsItsExactId() {
        val saved = job(null, ProjectState.LEGACY_UNRESOLVED)
        val calls = mutableListOf<Pair<String, JSONObject?>>()
        var persisted: String? = null
        val result = ProjectRequests(beforeLegacySubmit = { persisted = it }) { path, body ->
            calls.add(path to body)
            when (path) {
                "/health" -> health()
                "/v1/jobs/exact-request" -> throw BridgeException(404, "not accepted")
                "/v1/sessions/exact-chat/project" -> JSONObject().put("sessionId", "exact-chat").put("projectId", "historical-project")
                else -> { assertEquals("historical-project", persisted); response(saved, "historical-project") }
            }
        }.fetch(saved, null)
        assertEquals("historical-project", ProjectRequests.projectId(result))
        assertEquals(4, calls.size); assertEquals("historical-project", calls.last().second!!.getString("projectId"))
        assertEquals(saved.id, calls.last().second!!.getString("requestId"))
        var posts = 0
        val error = fails<BridgeException> { ProjectRequests { path, body ->
            if (body != null) posts++
            if (path == "/health") health() else throw BridgeException(404, "unbound")
        }.fetch(saved, null) }
        assertEquals(404, error.code); assertEquals(0, posts)
    }
    @Test fun aDroppedLegacyAcceptanceCannotResolveAgainstAReplacementDefaultOnRetry() {
        val old = job(null, ProjectState.LEGACY_UNRESOLVED)
        var persisted: String? = null
        val first = ProjectRequests(beforeLegacySubmit = { persisted = it }) { path, body ->
            when (path) {
                "/health" -> health()
                "/v1/jobs/exact-request" -> throw BridgeException(404, "missing")
                "/v1/sessions/exact-chat/project" -> JSONObject().put("sessionId", "exact-chat").put("projectId", "original-project")
                else -> { assertEquals("original-project", persisted); assertEquals(persisted, body!!.getString("projectId")); throw IOException("acceptance response lost") }
            }
        }
        fails<IOException> { first.fetch(old, null) }
        assertEquals("original-project", persisted)
        val calls = mutableListOf<Pair<String, JSONObject?>>()
        val replacement = ProjectRequests { path, body ->
            calls.add(path to body)
            if (path == "/health") health() else throw BridgeException(404, "original project unknown to replacement owner")
        }
        val error = fails<BridgeException> { replacement.fetch(old.copy(projectId = persisted, projectState = ProjectState.BOUND), persisted) }
        assertEquals(404, error.code)
        assertEquals(listOf("/health", "/v1/jobs"), calls.map { it.first })
        assertEquals("original-project", calls.last().second!!.getString("projectId"))
        assertEquals(old.id, calls.last().second!!.getString("requestId"))
    }
    @Test fun failedLegacyIdentityPersistencePreventsPost() {
        var posts = 0
        val client = ProjectRequests(beforeLegacySubmit = { throw IOException("database unavailable") }) { path, body ->
            if (body != null) posts++
            when (path) {
                "/health" -> health()
                "/v1/jobs/exact-request" -> throw BridgeException(404, "missing")
                else -> JSONObject().put("sessionId", "exact-chat").put("projectId", "proved-project")
            }
        }
        fails<IOException> { client.fetch(job(null, ProjectState.LEGACY_UNRESOLVED), null) }
        assertEquals(0, posts)
    }
    @Test fun missingLegacyJobOnAnOldBridgeCannotFallThroughToDefaultPost() {
        var posts = 0
        val error = fails<BridgeException> { ProjectRequests { path, body ->
            if (body != null) posts++
            if (path == "/health") health(4) else throw BridgeException(404, "missing")
        }.fetch(job(null, ProjectState.LEGACY_UNRESOLVED), null) }
        assertEquals(426, error.code); assertEquals(0, posts)
    }
    @Test fun wrongRequestChatProjectAndMalformedProjectAreNeverAppliedAsRejections() {
        val saved = job(status = "running")
        for (wrong in listOf(response(saved, "project-b"), response(saved, null), response(saved).put("projectId", 1),
            response(saved).put("id", "different-request"), response(saved).put("sessionId", "different-chat"))) {
            val error = fails<ProjectIdentityException> { ProjectRequests { _, _ -> wrong }.fetch(saved, "project-a") }
            assertFalse(ProjectRequests.permanentSubmission(error))
        }
        fails<ProjectIdentityException> { ProjectRequests.validateJob(saved, "project-b", response(saved)) }
    }
    @Test fun permanentProjectSubmissionErrorsStopPollingButNetworkErrorsStayUncertain() {
        for (code in listOf(400, 404, 409, 413, 426)) assertTrue(ProjectRequests.permanentSubmission(BridgeException(code, "rejected")))
        for (code in listOf(401, 429, 500)) assertFalse(ProjectRequests.permanentSubmission(BridgeException(code, "uncertain")))
        assertFalse(ProjectRequests.permanentSubmission(IOException("offline")))
    }
    @Test fun inconsistentSavedRequestFailsBeforeAnyNetworkDispatch() {
        var calls = 0
        val client = ProjectRequests { _, _ -> calls++; health() }
        fails<ProjectIdentityException> { client.fetch(job(), "different-project") }
        fails<ProjectIdentityException> { client.fetch(job(null, ProjectState.SELECTED), null) }
        assertEquals(0, calls)
    }
    @Test fun legacyReviewOmissionNeedsProvedBindingAndCannotRetargetOnAReplacementBridge() {
        val body = JSONObject().put("operationId", "legacy-operation").put("action", "test")
        val original = body.toString()
        var posts = 0
        val client = ProjectRequests { path, payload ->
            when {
                path == "/health" -> health()
                payload == null -> JSONObject().put("sessionId", "chat").put("projectId", "wrong-project")
                else -> { posts++; JSONObject() }
            }
        }
        fails<ProjectIdentityException> { client.sendReview("chat", body, "historical-project") }
        assertEquals(0, posts); assertEquals(original, body.toString())
        var persisted: String? = null
        val correct = ProjectRequests(beforeLegacySubmit = { persisted = it }) { path, payload ->
            when {
                path == "/health" -> health()
                payload == null -> JSONObject().put("sessionId", "chat").put("projectId", "historical-project")
                else -> { assertEquals("historical-project", persisted); assertEquals(persisted, payload.getString("projectId")); posts++; JSONObject().put("id", "legacy-operation").put("sessionId", "chat").put("projectId", "historical-project") }
            }
        }
        correct.sendReview("chat", body, "historical-project")
        assertEquals(1, posts); assertEquals(original, body.toString()); assertFalse(body.has("projectId"))
    }
    @Test fun reviewSnapshotCannotImportAnOperationFromAnotherChatOrProject() {
        val operation = JSONObject().put("id", "operation").put("sessionId", "chat").put("projectId", "project-a")
        val snapshot = JSONObject().put("projectId", "project-a").put("operation", operation)
        ProjectRequests.validateReview("chat", "project-a", snapshot)
        operation.put("projectId", "project-b")
        fails<ProjectIdentityException> { ProjectRequests.validateReview("chat", "project-a", snapshot) }
        operation.put("projectId", "project-a").put("sessionId", "other-chat")
        fails<ProjectIdentityException> { ProjectRequests.validateReview("chat", "project-a", snapshot) }
    }
    @Test fun savedReviewOperationKeepsProjectAndIdAndValidatesReturnedOwnership() {
        val body = JSONObject().put("operationId", "exact-operation").put("projectId", "project-a")
            .put("action", "test").put("revision", "revision").put("command", "true")
        val original = body.toString()
        val calls = mutableListOf<String>()
        val client = ProjectRequests { path, _ ->
            calls.add(path)
            if (path == "/health") health() else JSONObject().put("id", "exact-operation").put("sessionId", "chat").put("projectId", "project-a")
        }
        client.sendReview("chat", body, "project-a")
        assertEquals(listOf("/health", "/v1/sessions/chat/actions"), calls)
        assertEquals(original, body.toString())
        fails<ProjectIdentityException> { client.sendReview("chat", body, "project-b") }
        fails<ProjectIdentityException> { ProjectRequests.validateOperation("chat", "exact-operation", "project-a", JSONObject().put("id", "other")) }
        fails<BridgeException> { ProjectRequests { _, _ -> health(4) }.sendReview("chat", body, "project-a") }
        assertEquals(original, body.toString())
    }
}
