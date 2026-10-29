import { randomUUID } from 'node:crypto';
import { defineDoc, defineDocFamily } from '@earendil-works/pi-durable';
import { bindingError } from './bindings.js';

// These are app-conversation documents in the existing Durable session, not new
// Durable conversations/tasks. B02 captures history only; B03 supplies live writes.
export const Owner = defineDoc({ kind: 'pocket.owner', version: 1, scope: 'session', initial: () => ({}) });
const family = kind => defineDocFamily({ kind, version: 1, scope: 'session', family: true, initial: () => ({}) });
export const ConversationBaselines = family('pocket.conversation-baselines');
export const TurnBaselines = family('pocket.turn-baselines');
export const ReviewBaselines = family('pocket.review-baselines');
const copy = value => JSON.parse(JSON.stringify(value));
const key = (conversationId, id) => JSON.stringify([conversationId, id]);
const sessionOf = record => record.sessionId ?? 'pocket';
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id);
const validUuid = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uniqueStrings = values => Array.isArray(values) && values.every(value => typeof value === 'string') && new Set(values).size === values.length;
const fail = () => { throw bindingError('Conversation baseline conflicts or is incomplete; refusing startup.'); };
const require = condition => { if (!condition) fail(); };
const statuses = new Set(['queued', 'running', 'done', 'failed', 'cancelled', 'interrupted']);
const ordering = { kind: 'reconstructed', by: 'createdAt-then-id', missingDates: 'last' };
export const compareLegacyRecords = (a, b) => {
  const dates = (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity);
  return (Number.isNaN(dates) ? 0 : dates) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
};
export const conversationMessages = source => [
  { id: JSON.stringify([source.id, 'user']), role: 'user', text: source.text },
  { id: JSON.stringify([source.id, 'assistant']), role: 'assistant', text: source.answer ?? '' }
];
function checkRecord(id, record, bindings, review) {
  require(record && record.id === id && typeof id === 'string' && id.length > 0);
  require(validId(sessionOf(record)) && statuses.has(record.status));
  require(record.projectId && bindings.items[sessionOf(record)]?.projectId === record.projectId);
  require(record.createdAt == null || (Number.isFinite(record.createdAt) && record.createdAt >= 0));
  if (review) require(record.input && typeof record.input === 'object' && !Array.isArray(record.input));
  else require(typeof record.text === 'string' && (record.answer == null || typeof record.answer === 'string'));
}
async function create(tx, token, address, value) {
  const doc = await tx.doc(token, address, null);
  require(Object.keys(doc).length === 0); // Never repair/overwrite conflicting partial evidence.
  Object.assign(doc, value);
}
function checkSource(saved, current, review) {
  require(current && saved.id === current.id && sessionOf(saved) === sessionOf(current) &&
    saved.projectId === current.projectId && saved.taskId === current.taskId &&
    (saved.createdAt ?? null) === (current.createdAt ?? null));
  require(review ? JSON.stringify(saved.input) === JSON.stringify(current.input) : saved.text === current.text);
}

/** Run in the same startup transaction as binding migration, strictly before resume. */
export async function initializeConversations(tx, { projects, bindings, jobs, reviews }) {
  const owner = await tx.doc(Owner);
  for (const [id, binding] of Object.entries(bindings.items)) {
    require(validId(id) && binding && Object.hasOwn(projects.items, binding.projectId));
  }
  for (const [id, record] of Object.entries(jobs.items)) checkRecord(id, record, bindings, false);
  for (const [id, record] of Object.entries(reviews.items)) checkRecord(id, record, bindings, true);
  if (Object.keys(owner).length !== 0) {
    require(validUuid(owner.ownerId) && owner.baselineVersion === 1 && uniqueStrings(owner.conversationIds));
    require(same([...owner.conversationIds].sort(), owner.conversationIds));
    for (const id of owner.conversationIds) {
      require(validId(id));
      const chat = await tx.doc(ConversationBaselines, id, null);
      require(chat.conversationId === id && chat.ownerId === owner.ownerId &&
        chat.projectId === bindings.items[id]?.projectId && validUuid(chat.generation) &&
        chat.sequence === 0 && same(chat.ordering, ordering) && uniqueStrings(chat.turnIds) && uniqueStrings(chat.reviewIds));
      for (const [index, runId] of chat.turnIds.entries()) {
        const turn = await tx.doc(TurnBaselines, key(id, runId), null);
        require(turn.runId === runId && turn.source && sessionOf(turn.source) === id);
        checkRecord(runId, turn.source, bindings, false);
        checkSource(turn.source, jobs.items[runId], false);
        require(turn.ordinal === index + 1 && turn.createdAt === (turn.source.createdAt ?? null) &&
          same(turn.messages, conversationMessages(turn.source)));
      }
      require(same([...chat.turnIds].sort((a, b) => compareLegacyRecords(jobs.items[a], jobs.items[b])), chat.turnIds));
      for (const operationId of chat.reviewIds) {
        const action = await tx.doc(ReviewBaselines, key(id, operationId), null);
        require(action.operationId === operationId && action.source && sessionOf(action.source) === id);
        checkRecord(operationId, action.source, bindings, true);
        checkSource(action.source, reviews.items[operationId], true);
      }
      require(same([...chat.reviewIds].sort((a, b) => compareLegacyRecords(reviews.items[a], reviews.items[b])), chat.reviewIds));
    }
    return;
  }
  const ownerId = randomUUID();
  const ids = Object.keys(bindings.items).sort();
  for (const id of ids) {
    const turns = Object.values(jobs.items).filter(record => sessionOf(record) === id).sort(compareLegacyRecords);
    const actions = Object.values(reviews.items).filter(record => sessionOf(record) === id).sort(compareLegacyRecords);
    await create(tx, ConversationBaselines, id, { conversationId: id, ownerId,
      projectId: bindings.items[id].projectId, generation: randomUUID(), sequence: 0,
      ordering, turnIds: turns.map(record => record.id), reviewIds: actions.map(record => record.id) });
    for (const [index, source] of turns.entries()) {
      await create(tx, TurnBaselines, key(id, source.id), { runId: source.id,
        ordinal: index + 1, createdAt: source.createdAt ?? null, messages: conversationMessages(source), source: copy(source) });
    }
    for (const source of actions) {
      await create(tx, ReviewBaselines, key(id, source.id), { operationId: source.id, source: copy(source) });
    }
  }
  Object.assign(owner, { ownerId, baselineVersion: 1, conversationIds: ids });
}

/** Stable journal identity; B05 health exposes this, never as approval action proof. */
export async function readOwnerIdentity(reader, context) {
  const owner = await reader.snapshot(Owner, context);
  return owner ? { ownerId: owner.ownerId, baselineVersion: owner.baselineVersion } : null;
}
export async function readConversationBaseline(reader, id, context) {
  if (!validId(id)) throw Object.assign(new Error('Invalid conversationId'), { status: 400 });
  const owner = await reader.snapshot(Owner, context);
  if (!owner?.conversationIds.includes(id)) return null;
  const chat = await reader.snapshot(ConversationBaselines, id, context);
  const turns = await Promise.all(chat.turnIds.map(runId => reader.snapshot(TurnBaselines, key(id, runId), context)));
  const reviews = await Promise.all(chat.reviewIds.map(operationId => reader.snapshot(ReviewBaselines, key(id, operationId), context)));
  return copy({ baselineOnly: true, schemaVersion: 1, ownerId: owner.ownerId,
    conversationId: id, projectId: chat.projectId, ordering: chat.ordering,
    cursor: { ownerId: owner.ownerId, conversationId: id, generation: chat.generation, sequence: chat.sequence }, turns, reviews });
}
