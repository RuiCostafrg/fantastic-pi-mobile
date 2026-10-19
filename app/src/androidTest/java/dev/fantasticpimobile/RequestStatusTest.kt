package dev.fantasticpimobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RequestStatusTest {
    private val job = Job("saved", "Question", "running", "", "chat", "Working", "{\"id\":\"approval\"}")

    @Test fun savedRunningAndApprovalAreNotLiveEvidence() {
        val observations = RequestObservations()
        assertEquals("CHECKING STATUS", requestLabel(job, observations.state(job.id)))
        assertTrue(requestSummary(job, observations.state(job.id)).contains("Saved status is not live confirmation"))
        assertTrue(requestAttention(observations.state(job.id)))
        observations.record(job.id, observations.epoch, RequestState.CURRENT)
        assertEquals("AWAITING APPROVAL", requestLabel(job, observations.state(job.id)))
        assertFalse(requestAttention(observations.state(job.id)))
        observations.reset()
        assertEquals(RequestState.CHECKING, observations.state(job.id))
    }
    @Test fun currentEvidenceExpiresAndCannotCrossChatsOrForegroundEpochs() {
        var now = 0L
        val observations = RequestObservations { now }
        val oldEpoch = observations.epoch
        assertTrue(observations.record(job.id, oldEpoch, RequestState.CURRENT))
        assertEquals(RequestState.CHECKING, observations.state("other-chat-job"))
        now = 9_999L
        assertEquals(RequestState.CURRENT, observations.state(job.id))
        now = 10_000L
        assertEquals(RequestState.CHECKING, observations.state(job.id))
        observations.reset()
        assertFalse(observations.record(job.id, oldEpoch, RequestState.CURRENT))
        assertEquals(RequestState.CHECKING, observations.state(job.id))
    }
    @Test fun lostConnectionDoesNotTurnAnUncertainRequestIntoFailureOrApproval() {
        val observations = RequestObservations()
        observations.record(job.id, observations.epoch, RequestState.CURRENT)
        observations.record(job.id, observations.epoch, RequestState.UNAVAILABLE)
        assertEquals("STATUS UNKNOWN", requestLabel(job, observations.state(job.id)))
        assertTrue(requestSummary(job, observations.state(job.id)).contains("work may still be running"))
        assertTrue(job.active) // No change to durable ID, single-flight admission or saved job state.
        observations.record(job.id, observations.epoch, RequestState.CURRENT)
        assertEquals("AWAITING APPROVAL", requestLabel(job, observations.state(job.id)))
    }
    @Test fun busyAndAcceptedQueuedAreNotReportedAsRunningAndTerminalEvidenceStaysTerminal() {
        assertEquals("WAITING FOR A SLOT", requestLabel(job, RequestState.WAITING))
        assertTrue(requestSummary(job.copy(status = "queued", pending = ""), RequestState.CURRENT).contains("waiting to start"))
        for (status in listOf("done", "failed", "interrupted", "cancelled")) {
            assertEquals(status.uppercase(), requestLabel(job.copy(status = status), RequestState.UNAVAILABLE))
        }
    }
}
