import { randomUUID } from 'node:crypto';
import { defineDocFamily } from '@earendil-works/pi-durable';
import { Owner, conversationMessages } from './conversations.js';
import { ProjectionState, ConversationProjections, ProjectionSnapshots, ProjectionRecords, ProjectionEvents,
  stageConversations, validateRetainedStage } from './conversation-projection.js';
import { bindingError } from './bindings.js';

export const LiveRecords = defineDocFamily({ kind: 'pocket.live-records', version: 1, scope: 'session', family: true, initial: () => ({}) });
const key = (...parts) => JSON.stringify(parts);
const copy = x => JSON.parse(JSON.stringify(x));
const canonical = x => JSON.stringify(x, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const same = (a, b) => canonical(a) === canonical(b);
const require = x => { if (!x) throw bindingError('Live conversation projection conflicts or is incomplete.'); };
async function create(tx, token, id, value) {
  const doc = await tx.doc(token, id, null); require(Object.keys(doc).length === 0); Object.assign(doc, copy(value));
}
const sessionOf = source => source.sessionId ?? 'pocket';
function identity(a, b, kind) {
  require(a.id === b.id && sessionOf(a) === sessionOf(b) && a.projectId === b.projectId && a.taskId === b.taskId &&
    (a.createdAt ?? null) === (b.createdAt ?? null) && (kind === 'turn' ? a.text === b.text : same(a.input, b.input)));
  if (a.workspace) require(same(a.workspace, b.workspace));
}
async function validateLive(tx, inventory) {
  const state = await tx.doc(ProjectionState), owner = await tx.doc(Owner);
  require(state.mode === 'live' && state.ownerId === owner.ownerId && same(state.conversationIds, Object.keys(inventory.bindings.items).sort()));
  for (const id of state.conversationIds) {
    const chat = await tx.doc(ConversationProjections, id, null);
    require(chat.mode === 'live' && chat.ownerId === owner.ownerId && chat.projectId === inventory.bindings.items[id].projectId && chat.conversationId === id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(chat.generation) &&
      (chat.stagedSequence === undefined || (Number.isSafeInteger(chat.stagedSequence) && chat.stagedSequence > 0 && chat.stagedSequence <= chat.sequence)));
    for (const [kind, items, refs] of [['turn', inventory.jobs.items, chat.turnIds], ['review', inventory.reviews.items, chat.reviewIds]]) {
      require(Array.isArray(refs) && new Set(refs).size === refs.length);
      require(Object.values(items).filter(s => sessionOf(s) === id).length === refs.length);
      for (const [index, recordId] of refs.entries()) {
        const head = await tx.doc(LiveRecords, key(id, kind, recordId), null);
        const record = await tx.doc(ProjectionRecords, key(id, kind, recordId, head.revision), null);
        require(head.ordinal === index + 1 && Number.isSafeInteger(head.revision) && head.revision > 0 && head.revision <= chat.sequence &&
          same(head, record) && same(head.source, items[recordId]) &&
          (kind === 'turn' ? head.runId === recordId : head.operationId === recordId));
        require(head.source.projectId === chat.projectId && sessionOf(head.source) === id);
        require(kind !== 'turn' || same(head.messages, conversationMessages(head.source)));
      }
    }
    require(Number.isSafeInteger(chat.sequence) && chat.sequence >= 0);
    for (let sequence = 1; sequence <= chat.sequence; sequence++) {
      const event = await tx.doc(ProjectionEvents, key(id, sequence), null);
      require(event.schemaVersion === 1 && event.ownerId === chat.ownerId && event.generation === chat.generation &&
        event.sequence === sequence && event.conversationId === id && event.projectId === chat.projectId);
      if (sequence <= (chat.stagedSequence ?? 0)) {
        await validateRetainedStage(tx, chat, sequence);
      } else {
        require(['turn', 'review'].includes(event.kind) && event.revision === sequence &&
          (event.kind === 'turn' ? ['turn.accepted', 'run.status', 'run.progress', 'run.result', 'run.pending', 'run.done', 'run.failed', 'run.cancelled', 'run.interrupted']
            : ['review.accepted', 'review.running', 'review.done', 'review.failed', 'review.cancelled', 'review.interrupted']).includes(event.type));
        const record = await tx.doc(ProjectionRecords, key(id, event.kind, event.recordId, sequence), null);
        const head = await tx.doc(LiveRecords, key(id, event.kind, event.recordId), null);
        require(record.revision === sequence && record.ordinal === event.ordinal && record.ordinal === head.ordinal);
        identity(record.source, head.source, event.kind);
        require(event.kind !== 'turn' || same(record.messages, conversationMessages(record.source)));
      }
    }
  }
}

/** Explicit atomic staged -> live promotion. Repeat reconciliation before copying heads. */
export async function initializeLiveConversations(tx, inventory) {
  const state = await tx.doc(ProjectionState);
  if (state.mode === 'live') { await validateLive(tx, inventory); return; }
  await stageConversations(tx, inventory);
  for (const id of state.conversationIds) {
    const chat = await tx.doc(ConversationProjections, id, null);
    const snapshot = await tx.doc(ProjectionSnapshots, key(id, chat.sequence), null);
    for (const [kind, refs] of [['turn', snapshot.turns], ['review', snapshot.reviews]]) {
      for (const ref of refs) {
        const record = await tx.doc(ProjectionRecords, key(id, kind, ref.id, ref.revision), null);
        await create(tx, LiveRecords, key(id, kind, ref.id), record);
      }
    }
    chat.stagedSequence = chat.sequence;
    chat.turnIds = snapshot.turns.map(r => r.id); chat.reviewIds = snapshot.reviews.map(r => r.id);
    chat.mode = 'live';
  }
  state.mode = 'live';
}

/** Caller owns the authoritative mutation and transaction. No history scan on updates. */
export async function projectMutation(tx, bindings, kind, source, type) {
  const state = await tx.doc(ProjectionState);
  // Only the injected historical-staging fixture initializer leaves this mode.
  const id = sessionOf(source), projectId = bindings.items[id]?.projectId;
  if (state.mode === 'staged') {
    const historical = await tx.doc(ConversationProjections, id, null);
    require(!historical.mode || historical.mode === 'staged');
    return;
  }
  require(state.mode === 'live' && projectId && source.projectId === projectId);
  const chat = await tx.doc(ConversationProjections, id, null);
  if (!chat.mode) {
    Object.assign(chat, { mode: 'live', ownerId: state.ownerId, conversationId: id, projectId,
      generation: randomUUID(), sequence: 0, turnIds: [], reviewIds: [] });
    require(!state.conversationIds.includes(id)); state.conversationIds.push(id); state.conversationIds.sort();
  }
  require(chat.mode === 'live' && chat.ownerId === state.ownerId && chat.projectId === projectId && chat.conversationId === id);
  const head = await tx.doc(LiveRecords, key(id, kind, source.id), null);
  const refs = kind === 'turn' ? chat.turnIds : chat.reviewIds;
  const exists = Object.keys(head).length > 0;
  if (exists) {
    require(same(head, await tx.doc(ProjectionRecords, key(id, kind, source.id, head.revision), null)));
    identity(head.source, source, kind);
    require(refs[head.ordinal - 1] === source.id);
    if (same(head.source, source)) return;
  } else { require(!refs.includes(source.id)); refs.push(source.id); }
  const sequence = chat.sequence + 1; require(Number.isSafeInteger(sequence) && sequence > 0);
  const record = { ...(kind === 'turn' ? { runId: source.id, messages: conversationMessages(source) } : { operationId: source.id }),
    ordinal: exists ? head.ordinal : refs.length, revision: sequence, source: copy(source) };
  await create(tx, ProjectionRecords, key(id, kind, source.id, sequence), record);
  await create(tx, ProjectionEvents, key(id, sequence), { schemaVersion: 1, ownerId: chat.ownerId, conversationId: id,
    projectId, generation: chat.generation, sequence, type, kind, recordId: source.id, revision: sequence, ordinal: record.ordinal,
    approvalEvidence: 'raw-pending-not-action-proof' });
  Object.assign(head, record); chat.sequence = sequence;
}

/** Internal, unbounded diagnostic only. B03c supplies consistent bounded client reads. */
export async function inspectLiveConversation(reader, id, context) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id)) throw Object.assign(new Error('Invalid conversation'), { status: 400 });
  const state = await reader.snapshot(ProjectionState, context); require(state?.mode === 'live');
  if (!state.conversationIds.includes(id)) return null;
  const chat = await reader.snapshot(ConversationProjections, id, context);
  const load = (kind, ids) => Promise.all(ids.map(recordId => reader.snapshot(LiveRecords, key(id, kind, recordId), context)));
  const events = [];
  for (let sequence = 1; sequence <= chat.sequence; sequence++) events.push(await reader.snapshot(ProjectionEvents, key(id, sequence), context));
  return copy({ internalOnly: true, consistentRead: false, liveWrites: true, approvalEvidence: 'raw-pending-not-action-proof',
    ownerId: chat.ownerId, conversationId: id, projectId: chat.projectId,
    cursor: { ownerId: chat.ownerId, conversationId: id, generation: chat.generation, sequence: chat.sequence },
    turns: await load('turn', chat.turnIds), reviews: await load('review', chat.reviewIds), events });
}
