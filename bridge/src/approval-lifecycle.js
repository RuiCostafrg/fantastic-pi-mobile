import { createHash } from 'node:crypto';
import { defineDoc, defineDocFamily } from '@earendil-works/pi-durable';
import { Owner } from './conversations.js';
import { ProjectionState } from './conversation-projection.js';
import { projectMutation } from './conversation-live.js';
import { bindingError } from './bindings.js';

export const ApprovalIndex = defineDoc({ kind: 'pocket.approval-index', version: 1, scope: 'session', initial: () => ({}) });
const family = kind => defineDocFamily({ kind, version: 1, scope: 'session', family: true, initial: () => ({}) });
export const ApprovalRuns = family('pocket.approval-runs');
export const ApprovalOccurrences = family('pocket.approval-occurrences');
const copy = x => JSON.parse(JSON.stringify(x));
const canonical = x => JSON.stringify(x, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const same = (a, b) => canonical(a) === canonical(b);
const digest = x => createHash('sha256').update(canonical(x)).digest('hex');
const require = x => { if (!x) throw bindingError('Approval lifecycle evidence conflicts or is incomplete.'); };
const empty = x => Object.keys(x).length === 0;
const sessionOf = j => j.sessionId ?? 'pocket';
const active = j => ['queued', 'running'].includes(j.status);
const question = x => x?.type === 'extension_ui_request' && ['confirm', 'select', 'input', 'editor'].includes(x.method);
const reasons = ['replacement', 'pending-clear', 'done', 'failed', 'cancelled', 'interrupted', 'startup'];
const runKey = (ownerId, runId) => JSON.stringify([ownerId, runId]);
const occurrenceKey = (ownerId, runId, ordinal) => JSON.stringify([ownerId, runId, ordinal]);
async function create(tx, token, key, value) {
  const target = await tx.doc(token, key, null); require(empty(target)); Object.assign(target, copy(value)); return target;
}
async function ownerOf(tx) {
  const owner = await tx.doc(Owner);
  require(owner.baselineVersion === 1 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(owner.ownerId));
  return owner.ownerId;
}
async function validateRun(tx, ownerId, bindings, job, run) {
  require(job && bindings.items[sessionOf(job)]?.projectId === job.projectId);
  require(run.schemaVersion === 1 && run.ownerId === ownerId && run.runId === job.id &&
    run.conversationId === sessionOf(job) && run.projectId === job.projectId &&
    Number.isSafeInteger(run.count) && run.count > 0 && (run.current === null || typeof run.current === 'string'));
  const occurrences = [];
  for (let ordinal = 1; ordinal <= run.count; ordinal++) {
    const id = occurrenceKey(ownerId, job.id, ordinal);
    const item = await tx.doc(ApprovalOccurrences, id, null), observation = item.observation;
    require(item.schemaVersion === 1 && item.id === id && observation && observation.ownerId === ownerId &&
      observation.runId === job.id && observation.conversationId === sessionOf(job) && observation.projectId === job.projectId &&
      observation.ordinal === ordinal && Number.isSafeInteger(observation.observedAt) && observation.observedAt >= 0 &&
      question(observation.raw) && item.observationDigest === digest(observation));
    require(item.state === 'expired' ? reasons.includes(item.reason) && Number.isSafeInteger(item.expiredAt) && item.expiredAt >= observation.observedAt
      : item.state === 'observed' && item.reason === null && item.expiredAt === null && ordinal === run.count && run.current === id);
    occurrences.push(item);
  }
  require((run.current === null || run.current === occurrenceKey(ownerId, job.id, run.count)) &&
    (job.approvalOccurrenceId ?? null) === run.current);
  if (run.current !== null) {
    const last = occurrences.at(-1);
    require(last.state === 'observed' && active(job) && same(job.pending, last.observation.raw));
  } else require(occurrences.every(o => o.state === 'expired'));
  return occurrences;
}
async function requireUnindexedEmpty(tx, ownerId, job) {
  require(job.approvalOccurrenceId == null);
  require(empty(await tx.doc(ApprovalRuns, runKey(ownerId, job.id), null)));
  require(empty(await tx.doc(ApprovalOccurrences, occurrenceKey(ownerId, job.id, 1), null)));
}
function checkIndex(index, ownerId) {
  require(index.schemaVersion === 1 && index.ownerId === ownerId && Array.isArray(index.runIds) &&
    index.runIds.every(id => typeof id === 'string' && id.length > 0) && new Set(index.runIds).size === index.runIds.length &&
    same(index.runIds, [...index.runIds].sort()));
}
function expire(run, occurrences, reason) {
  if (run.current === null) return;
  const item = occurrences.at(-1); item.state = 'expired'; item.reason = reason;
  item.expiredAt = Math.max(Date.now(), item.observation.observedAt); run.current = null;
}

/** Must follow B03 validation of ORIGINAL Jobs, in the same pre-resume transaction. */
export async function initializeApprovals(tx, { bindings, jobs }) {
  const state = await tx.doc(ProjectionState);
  // Historical staging injection is not live RPC evidence.
  if (state.mode === 'staged') return;
  require(state.mode === 'live');
  const ownerId = await ownerOf(tx), index = await tx.doc(ApprovalIndex);
  if (empty(index)) {
    require(Object.values(jobs.items).every(j => j.approvalOccurrenceId === undefined || j.approvalOccurrenceId === null));
    Object.assign(index, { schemaVersion: 1, ownerId, runIds: [] });
  }
  checkIndex(index, ownerId);
  const prepared = [];
  for (const id of index.runIds) {
    const run = await tx.doc(ApprovalRuns, runKey(ownerId, id), null);
    prepared.push([jobs.items[id], run, await validateRun(tx, ownerId, bindings, jobs.items[id], run)]);
  }
  for (const [id, job] of Object.entries(jobs.items)) {
    require(job.id === id && bindings.items[sessionOf(job)]?.projectId === job.projectId);
    if (!index.runIds.includes(id)) await requireUnindexedEmpty(tx, ownerId, job);
  }
  for (const [job, run, occurrences] of prepared) {
    if (run.current === null) continue;
    expire(run, occurrences, 'startup'); job.approvalOccurrenceId = null;
    await projectMutation(tx, bindings, 'turn', job, 'run.pending');
  }
}

/** Validate before applying patch. Each live question frame is a NEW observation. */
export async function transitionApproval(tx, bindings, job, patch) {
  const state = await tx.doc(ProjectionState);
  if (state.mode === 'staged') { Object.assign(job, patch); return; }
  require(state.mode === 'live');
  const ownerId = await ownerOf(tx), index = await tx.doc(ApprovalIndex); checkIndex(index, ownerId);
  let run, occurrences = [];
  if (index.runIds.includes(job.id)) {
    run = await tx.doc(ApprovalRuns, runKey(ownerId, job.id), null);
    occurrences = await validateRun(tx, ownerId, bindings, job, run);
  } else await requireUnindexedEmpty(tx, ownerId, job);
  const observed = Object.hasOwn(patch, 'pending') && question(patch.pending);
  const terminal = patch.status && !['queued', 'running'].includes(patch.status);
  if (run && (Object.hasOwn(patch, 'pending') || terminal)) {
    expire(run, occurrences, patch.stopRequested ? 'cancelled' : terminal ? patch.status : observed ? 'replacement' : 'pending-clear');
    job.approvalOccurrenceId = null;
  }
  if (observed) {
    require(!terminal && active(job) && bindings.items[sessionOf(job)]?.projectId === job.projectId);
    if (!run) {
      run = await create(tx, ApprovalRuns, runKey(ownerId, job.id), { schemaVersion: 1, ownerId, runId: job.id,
        conversationId: sessionOf(job), projectId: job.projectId, count: 0, current: null });
      index.runIds.push(job.id); index.runIds.sort();
    }
    const ordinal = run.count + 1; require(Number.isSafeInteger(ordinal));
    const id = occurrenceKey(ownerId, job.id, ordinal);
    const observation = { ownerId, runId: job.id, conversationId: sessionOf(job), projectId: job.projectId,
      ordinal, observedAt: Date.now(), raw: copy(patch.pending) };
    await create(tx, ApprovalOccurrences, id, { schemaVersion: 1, id, observation, observationDigest: digest(observation),
      state: 'observed', reason: null, expiredAt: null });
    run.count = ordinal; run.current = id; job.approvalOccurrenceId = id;
  }
  Object.assign(job, patch);
}

/** Diagnostic evidence only: never answer permission, a claim, or proof of sender liveness. */
export async function inspectApprovalEvidence(tx, bindings, jobs, runId) {
  const job = Object.hasOwn(jobs.items, runId) ? jobs.items[runId] : null;
  if (!job) return null; // No unknown-address lookup / document creation.
  require(bindings.items[sessionOf(job)]?.projectId === job.projectId);
  const ownerId = await ownerOf(tx), index = await tx.doc(ApprovalIndex); checkIndex(index, ownerId);
  const run = index.runIds.includes(runId) ? await tx.doc(ApprovalRuns, runKey(ownerId, runId), null) : null;
  const occurrences = run ? await validateRun(tx, ownerId, bindings, job, run) : [];
  // Do not acquire absent family documents here: Durable doc acquisition can
  // create an empty document even when the draft is not mutated.
  require(run || job.approvalOccurrenceId == null);
  return copy({ internalOnly: true, actionable: false, approvalEvidence: 'observation-only-not-answer-permission',
    ownerId, runId, conversationId: sessionOf(job), projectId: job.projectId,
    currentOccurrenceId: run?.current ?? null, legacyPending: run ? null : job.pending ?? null, occurrences });
}
