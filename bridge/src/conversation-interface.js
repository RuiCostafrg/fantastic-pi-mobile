import { randomUUID } from 'node:crypto';
import { Owner } from './conversations.js';
import { ProjectionState, ConversationProjections } from './conversation-projection.js';
import { LiveRecords } from './conversation-live.js';
import { limits, page } from './conversation-reads.js';
import { bindSession } from './bindings.js';

const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
export async function requireOwner(tx, ownerId) {
  const owner = await tx.doc(Owner), state = await tx.doc(ProjectionState);
  if (state.mode !== 'live') fail('CONVERSATION_CORE_UNAVAILABLE', 426);
  if (owner.ownerId !== ownerId) fail('FOREIGN_OWNER');
}
export async function createConversation(tx, bindings, projects, { ownerId, conversationId, projectId }) {
  await requireOwner(tx, ownerId);
  if (typeof conversationId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(conversationId) ||
      typeof projectId !== 'string' || !projectId) fail('INVALID_CONVERSATION', 400);
  bindSession(bindings, projects, conversationId, projectId);
  const state = await tx.doc(ProjectionState);
  const chat = await tx.doc(ConversationProjections, conversationId, null);
  if (!state.conversationIds.includes(conversationId)) {
    if (Object.keys(chat).length) fail('HISTORY_GAP');
    Object.assign(chat, { mode: 'live', ownerId, conversationId, projectId, generation: randomUUID(),
      sequence: 0, turnIds: [], reviewIds: [] });
    state.conversationIds.push(conversationId); state.conversationIds.sort();
  }
  if (chat.mode !== 'live' || chat.conversationId !== conversationId || chat.ownerId !== ownerId || chat.projectId !== projectId) fail('CONVERSATION_CONFLICT');
  return { schemaVersion: 1, ownerId, conversationId, projectId };
}
// Keyset catalogue: refresh from the beginning on reconnect. Not a transcript cursor.
export async function listConversations(tx, bindings, ownerId, options = {}, histories) {
  await requireOwner(tx, ownerId);
  const bounds = limits(options), state = await tx.doc(ProjectionState);
  const after = options.token, kind = histories ? 'history-catalogue-page' : 'catalogue-page';
  const catalogueIds = [...new Set([...state.conversationIds, ...(histories ?? []).map(h => h.conversationId)])].sort();
  if (after !== undefined && (!after || after.schemaVersion !== 1 || after.kind !== kind ||
      after.ownerId !== ownerId || typeof after.lastId !== 'string' || !catalogueIds.includes(after.lastId)))
    fail('INVALID_CATALOGUE_TOKEN');
  const ids = catalogueIds.filter(id => after === undefined || id > after.lastId);
  const candidates = [];
  for (const id of ids.slice(0, bounds.limit)) {
    const history = histories?.find(h => h.conversationId === id);
    const historyEvidence = history ? { revision: history.revision, readOnly: true, executionAuthority: false } : undefined;
    if (!state.conversationIds.includes(id)) {
      candidates.push({ conversationId: id, projectId: null, sequence: null, currentRun: null,
        executionAvailable: false, historyEvidence });
      continue;
    }
    const chat = await tx.doc(ConversationProjections, id, null);
    if (chat.mode !== 'live' || chat.conversationId !== id || chat.ownerId !== ownerId || chat.projectId !== bindings.items[id]?.projectId ||
        !Number.isSafeInteger(chat.sequence) || chat.sequence < 0 || !Array.isArray(chat.turnIds)) fail('HISTORY_GAP');
    const runId = chat.turnIds.at(-1);
    const source = runId ? (await tx.doc(LiveRecords, JSON.stringify([id, 'turn', runId]), null)).source : null;
    if (runId && (!source || source.id !== runId || (source.sessionId ?? 'pocket') !== id || source.projectId !== chat.projectId)) fail('HISTORY_GAP');
    candidates.push({ conversationId: id, projectId: chat.projectId, sequence: chat.sequence,
      currentRun: source ? { runId, status: source.status, approvalId: source.approvalOccurrenceId ?? null } : null,
      ...(historyEvidence ? { executionAvailable: true, historyEvidence } : {}) });
  }
  return page(candidates, items => ({ schemaVersion: 1, ownerId, items,
    next: items.length < ids.length ? { schemaVersion: 1, ownerId, kind, lastId: items.at(-1)?.conversationId ?? after?.lastId } : null }), bounds);
}
