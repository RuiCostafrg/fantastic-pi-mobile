package dev.fantasticpimobile

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class ProjectCatalogTest {
    private fun health() = JSONObject().put("protocolVersion", 5).put("projectBindings", true)
    private fun row(id: String = "project-a") = JSONObject().put("projectId", id).put("name", "Fixture")
        .put("source", "/disposable/checkout").put("branchPolicy", JSONObject().put("kind", "local").put("branch", "trunk"))
    private fun chat(state: ProjectState = ProjectState.UNBOUND, project: String? = null) =
        ChatSession("chat-a", "Draft", "Keep draft", false, 0, null, false, projectId = project, projectState = state)
    private fun list() = JSONObject().put("projects", JSONArray().put(row()).put(row("project-b")))
    private fun fails(action: () -> Unit): Exception {
        try { action() } catch (error: Exception) { return error }
        throw AssertionError("Expected failure")
    }
    @Test fun discoveringTwoProjectsAndAbsentBindingDoesNotPostOrSelectDefault() {
        val calls = mutableListOf<String>()
        val result = ProjectCatalog { path, body ->
            assertNull(body); calls.add(path)
            when (path) { "/health" -> health(); "/v1/projects" -> list(); else -> throw BridgeException(404, "Unbound") }
        }.load(chat())
        assertNull(result.binding); assertEquals(listOf("project-a", "project-b"), result.projects.map { it.id })
        assertEquals(listOf("/health", "/v1/projects", "/v1/sessions/chat-a/project"), calls)
        assertTrue(result.projects.first().details.contains("Local branch: trunk"))
    }
    @Test fun establishedBindingIsReadOnlyEvenWithoutLocalJobs() {
        assertFalse(ProjectCatalog.editable(chat(ProjectState.BOUND, "project-a"), false))
        assertFalse(ProjectCatalog.editable(chat(ProjectState.LEGACY_UNRESOLVED), false))
        assertFalse(ProjectCatalog.editable(chat(ProjectState.SELECTED, "project-a"), true))
        assertFalse(ProjectCatalog.editable(chat().copy(archived = true), false))
        assertTrue(ProjectCatalog.editable(chat(), false))
        assertTrue(ProjectCatalog.editable(chat(ProjectState.SELECTED, "project-a"), false))
    }
    @Test fun foreignMissingAndConflictingBindingCannotBeAdopted() {
        for (value in listOf(JSONObject().put("sessionId", "other").put("projectId", "project-a"),
            JSONObject().put("sessionId", "chat-a"), JSONObject().put("sessionId", "chat-a").put("projectId", "project-b"))) {
            assertTrue(fails { ProjectCatalog { path, _ -> when (path) { "/health" -> health(); "/v1/projects" -> list(); else -> value } }
                .load(chat(ProjectState.BOUND, "project-a")) } is ProjectIdentityException)
        }
        assertTrue(fails { ProjectCatalog { path, _ -> when (path) { "/health" -> health(); "/v1/projects" -> list(); else -> throw BridgeException(404, "Missing") } }
            .load(chat(ProjectState.BOUND, "project-a")) } is ProjectIdentityException)
    }
    @Test fun emptyRegistryIsNotAnImplicitDefault() {
        val result = ProjectCatalog { path, _ -> when (path) {
            "/health" -> health(); "/v1/projects" -> JSONObject().put("projects", JSONArray()); else -> throw BridgeException(404, "Unbound")
        } }.load(chat())
        assertTrue(result.projects.isEmpty()); assertNull(result.binding)
    }
    @Test fun oldBridgeAndOfflineStopBeforeDiscoveryOrRegistration() {
        for (register in listOf(false, true)) {
            val calls = mutableListOf<String>()
            val api = ProjectCatalog { path, _ -> calls.add(path); health().put("protocolVersion", 4) }
            assertEquals(426, (fails { if (register) api.register(row().put("confirmRegistration", true)) else api.load(chat()) } as BridgeException).code)
            assertEquals(listOf("/health"), calls)
        }
        assertTrue(fails { ProjectCatalog { _, _ -> throw IOException("Offline") }.load(chat()) } is IOException)
    }
    @Test fun registrationRequiresLiteralConfirmationAndExplicitLocalOrRemotePolicy() {
        val body = ProjectCatalog.registration("Fixture", "/disposable/checkout", "local", "trunk")
        assertFalse(body.has("confirmRegistration"))
        val posts = mutableListOf<JSONObject>()
        val api = ProjectCatalog { path, payload -> if (path == "/health") health() else { posts.add(payload!!); row() } }
        fails { api.register(body) }; fails { api.register(body.put("confirmRegistration", "true")) }; assertTrue(posts.isEmpty())
        assertEquals("project-a", api.register(body.put("confirmRegistration", true)).id)
        assertEquals("trunk", posts.single().getJSONObject("branchPolicy").getString("branch"))
        assertEquals("origin", ProjectCatalog.registration("Remote", "/fixture", "remote", "origin").getJSONObject("branchPolicy").getString("remote"))
        fails { ProjectCatalog.registration("", "/fixture", "local", "trunk") }
        fails { ProjectCatalog.registration("Fixture", "relative", "local", "trunk") }
    }
    @Test fun duplicateAndMalformedRegistryEntriesFailClosed() {
        for (rows in listOf(JSONArray().put(row()).put(row()), JSONArray().put(row().put("projectId", "bad/id")),
            JSONArray().put(row().put("source", "relative")))) {
            fails { ProjectCatalog { path, _ -> if (path == "/health") health() else JSONObject().put("projects", rows) }.projects() }
        }
    }
}
