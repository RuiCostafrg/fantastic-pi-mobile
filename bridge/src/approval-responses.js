import { createHash } from 'node:crypto';
import { defineDoc } from '@earendil-works/pi-durable';
import { Owner } from './conversations.js';
import { ProjectionState } from './conversation-projection.js';
import { ApprovalOccurrences, inspectApprovalEvidence, transitionApproval } from './approval-lifecycle.js';
import { projectMutation } from './conversation-live.js';
import { bindingError } from './bindings.js';

export const ApprovalResponses = defineDoc({ kind: 'pocket.approval-responses', version: 1, scope: 'session', initial: () => ({}) });
const copy = x => JSON.parse(JSON.stringify(x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const conflict = () => Object.assign(new Error('Dialog expired or response target conflicts; refresh the request'), { status: 409 });
const require = value => { if (!value) throw bindingError('Approval response evidence conflicts or is incomplete.'); };
const active = job => ['queued', 'running'].includes(job.status);
const idValid = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);

export function normalizeAnswer(raw, response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw Object.assign(new Error('Invalid dialog response'), { status: 400 });
  if (response.cancelled === true) return { cancelled: true };
  if (raw.method === 'confirm' && typeof response.confirmed === 'boolean') return { confirmed: response.confirmed };
  if (['input', 'editor', 'select'].includes(raw.method) && typeof response.value === 'string' && response.value.length <= 20000 &&
      (raw.method !== 'select' || Array.isArray(raw.options) && raw.options.includes(response.value))) return { value: response.value };
  throw Object.assign(new Error('Invalid dialog response'), { status: 400 });
}
function validate(document, ownerId) {
  require(document.schemaVersion === 1 && document.ownerId === ownerId && document.items && typeof document.items === 'object' && !Array.isArray(document.items));
}

/** Same pre-resume transaction as B02/B03/B04a. Unknown delivery is never replayed. */
export async function initializeApprovalResponses(tx, { bindings, jobs }) {
  if ((await tx.doc(ProjectionState)).mode === 'staged') return;
  const ownerId = (await tx.doc(Owner)).ownerId, document = await tx.doc(ApprovalResponses);
  if (Object.keys(document).length === 0) {
    require(Object.values(jobs.items).every(job => job.approvalResponse === undefined));
    Object.assign(document, { schemaVersion: 1, ownerId, items: {} });
  }
  validate(document, ownerId);
  const claimed = new Set();
  for (const [id, receipt] of Object.entries(document.items)) {
    const evidence = await inspectApprovalEvidence(tx, bindings, jobs, receipt.runId);
    const occurrence = evidence?.occurrences.find(item => item.id === receipt.approvalId);
    require(receipt.responseId === id && idValid(id) && receipt.ownerId === ownerId && occurrence &&
      receipt.conversationId === evidence.conversationId && receipt.projectId === evidence.projectId &&
      occurrence.state === 'expired' && occurrence.reason === 'pending-clear' && occurrence.responseId === id &&
      same(receipt.answer, normalizeAnswer(occurrence.observation.raw, receipt.answer)) &&
      Number.isSafeInteger(receipt.claimedAt) && receipt.claimedAt >= occurrence.observation.observedAt &&
      ['unknown', 'attempted'].includes(receipt.delivery) && !claimed.has(receipt.approvalId));
    claimed.add(receipt.approvalId);
  }
  for (const job of Object.values(jobs.items)) {
    require(job.stopRequested === undefined || job.stopRequested === true);
    if (job.approvalResponse !== undefined) require(same(document.items[job.approvalResponse.responseId], job.approvalResponse));
    const evidence = await inspectApprovalEvidence(tx, bindings, jobs, job.id);
    for (const occurrence of evidence.occurrences) {
      if (occurrence.responseId !== undefined) require(document.items[occurrence.responseId]?.approvalId === occurrence.id);
    }
  }
}

/** Called under the run gate; the durable claim + expiry + projection precede any pipe write. */
export async function claimApproval(tx, bindings, jobs, request, sender, legacy = false) {
  const job = jobs.items[request.runId];
  if (!job) throw Object.assign(new Error('Unknown request'), { status: 404 });
  const evidence = await inspectApprovalEvidence(tx, bindings, jobs, job.id);
  let target = request;
  if (legacy) {
    const matches = evidence.occurrences.filter(item => item.observation.raw.id === request.answer?.id);
    // A reused raw ID is ambiguous, even if an old client happens to hold the latest payload.
    if (matches.length !== 1 || matches[0].id !== evidence.currentOccurrenceId) throw conflict();
    const approvalId = matches[0].id;
    target = { ownerId: evidence.ownerId, conversationId: evidence.conversationId, projectId: evidence.projectId,
      runId: job.id, approvalId, responseId: 'legacy-' + createHash('sha256').update(approvalId).digest('hex'), answer: request.answer };
  }
  if (!idValid(target.responseId)) throw Object.assign(new Error('Invalid responseId'), { status: 400 });
  if (target.ownerId !== evidence.ownerId || target.conversationId !== evidence.conversationId || target.projectId !== evidence.projectId) throw conflict();
  const occurrence = evidence.occurrences.find(item => item.id === target.approvalId);
  if (!occurrence) throw conflict();
  const answer = normalizeAnswer(occurrence.observation.raw, target.answer);
  const document = await tx.doc(ApprovalResponses); validate(document, evidence.ownerId);
  const existing = Object.hasOwn(document.items, target.responseId) ? document.items[target.responseId] : null;
  if (existing) {
    if (existing.approvalId !== target.approvalId || existing.runId !== target.runId || !same(existing.answer, answer)) throw conflict();
    return { receipt: copy(existing), claimed: false };
  }
  if (!sender || !active(job) || job.stopRequested || evidence.currentOccurrenceId !== target.approvalId) throw conflict();
  const receipt = { ownerId: evidence.ownerId, conversationId: evidence.conversationId, projectId: evidence.projectId,
    runId: job.id, approvalId: target.approvalId, responseId: target.responseId, answer, claimedAt: Date.now(), delivery: 'unknown' };
  document.items[target.responseId] = receipt;
  await transitionApproval(tx, bindings, job, { pending: null });
  (await tx.doc(ApprovalOccurrences, target.approvalId, null)).responseId = target.responseId;
  job.approvalResponse = copy(receipt);
  await projectMutation(tx, bindings, 'turn', job, 'run.pending');
  return { receipt: copy(receipt), claimed: true, reply: { type: 'extension_ui_response', id: occurrence.observation.raw.id, ...answer } };
}

export async function recordAttempt(tx, bindings, jobs, receipt) {
  const document = await tx.doc(ApprovalResponses); validate(document, receipt.ownerId);
  const current = document.items[receipt.responseId]; require(same(current, receipt));
  current.delivery = 'attempted';
  const job = jobs.items[receipt.runId]; job.approvalResponse = copy(current);
  await projectMutation(tx, bindings, 'turn', job, 'run.pending');
  return copy(current);
}
