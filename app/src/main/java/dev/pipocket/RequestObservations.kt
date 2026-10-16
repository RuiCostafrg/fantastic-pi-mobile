package dev.pipocket

import android.os.SystemClock

/** Foreground-only evidence, not persisted job state. One chat's response proves nothing about another. */
enum class RequestState { CHECKING, CURRENT, UNAVAILABLE, WAITING }

class RequestObservations(private val now: () -> Long = { SystemClock.elapsedRealtime() }) {
    private data class Observation(val state: RequestState, val at: Long)
    private val observations = mutableMapOf<String, Observation>()
    var epoch = 0L
        private set
    fun reset() { epoch++; observations.clear() }
    /** Old visibility/connection epochs cannot revive approvals or overwrite newer observations. */
    fun record(id: String, requestEpoch: Long, state: RequestState): Boolean {
        if (requestEpoch != epoch) return false
        observations[id] = Observation(state, now())
        return true
    }
    fun state(id: String): RequestState {
        val observation = observations[id] ?: return RequestState.CHECKING
        return if (observation.state == RequestState.CURRENT && now() - observation.at >= 10_000)
            RequestState.CHECKING else observation.state
    }
}

fun requestSummary(job: Job, state: RequestState): String = when (state) {
    RequestState.CHECKING -> "Checking this request with the bridge… Saved status is not live confirmation."
    RequestState.UNAVAILABLE -> "Request status unavailable. Checking the same request ID; work may still be running. Check your Termux bridge."
    RequestState.WAITING -> "Bridge busy · waiting for a slot. Retrying with the same request ID."
    RequestState.CURRENT -> when {
        job.pending.isNotEmpty() -> "This chat needs your approval."
        job.status == "sending" -> "Connecting to your Termux bridge…"
        job.status == "queued" -> "Accepted by the bridge · waiting to start."
        else -> job.progress.ifBlank { "Pi is working in this chat…" }
    }
}

fun requestLabel(job: Job, state: RequestState): String = when {
    !job.active -> job.status.uppercase(java.util.Locale.ROOT)
    state == RequestState.CHECKING -> "CHECKING STATUS"
    state == RequestState.UNAVAILABLE -> "STATUS UNKNOWN"
    state == RequestState.WAITING -> "WAITING FOR A SLOT"
    job.pending.isNotEmpty() -> "AWAITING APPROVAL"
    else -> job.status.uppercase(java.util.Locale.ROOT)
}

fun requestAttention(state: RequestState) = state != RequestState.CURRENT
fun requestStateLabel(state: RequestState): String? = when (state) {
    RequestState.CHECKING -> "◌ Checking saved request"
    RequestState.UNAVAILABLE -> "! Status unknown · check connection"
    RequestState.WAITING -> "◌ Waiting for a bridge slot"
    RequestState.CURRENT -> null
}
