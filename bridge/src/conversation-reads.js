import { defineDocFamily } from '@earendil-works/pi-durable';
import { Owner, conversationMessages } from './conversations.js';
import { ProjectionState, ConversationProjections, ProjectionSnapshots, ProjectionRecords, ProjectionEvents } from './conversation-projection.js';
import { LiveRecords } from './conversation-live.js';

// Immutable reference manifests, not another execution model or copies of transcript bodies.
export const ReadSnapshots = defineDocFamily({ kind: 'pocket.read-snapshots', version: 1, scope: 'session', family: true, initial: () => ({}) });
export const READ_LIMITS = Object.freeze({ defaultCount: 50, maxCount: 200, defaultBytes: 262144, minBytes: 1024, maxBytes: 1048576 });
const key = (...p) => JSON.stringify(p);
const copy = x => JSON.parse(JSON.stringify(x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, status }); };
const check = (ok, code = 'HISTORY_GAP') => { if (!ok) fail(code); };
const types = new Set(['turn.accepted', 'run.status', 'run.progress', 'run.result', 'run.pending', 'run.done', 'run.failed', 'run.cancelled', 'run.interrupted', 'review.accepted', 'review.running', 'review.done', 'review.failed', 'review.cancelled', 'review.interrupted']);
export function limits(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('INVALID_LIMIT', 400);
  const { limit = READ_LIMITS.defaultCount, maxBytes = READ_LIMITS.defaultBytes } = options;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > READ_LIMITS.maxCount || !Number.isSafeInteger(maxBytes) || maxBytes < READ_LIMITS.minBytes || maxBytes > READ_LIMITS.maxBytes) fail('INVALID_LIMIT', 400);
  return { limit, maxBytes };
}
async function context(tx, bindings, id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id)) fail('MALFORMED_CONVERSATION', 400);
  const state = await tx.doc(ProjectionState), owner = await tx.doc(Owner);
  check(state.mode === 'live', 'LIVE_READS_UNAVAILABLE');
  // Check catalogue before doc lookup: unknown reads do not create/bind chats.
  if (!state.conversationIds.includes(id)) fail('UNKNOWN_CONVERSATION', 404);
  const chat = await tx.doc(ConversationProjections, id, null);
  check(chat.mode === 'live' && chat.ownerId === owner.ownerId && state.ownerId === owner.ownerId && chat.conversationId === id && chat.projectId === bindings.items[id]?.projectId && integer(chat.sequence));
  return copy(chat);
}
const scope = c => ({ schemaVersion: 1, ownerId: c.ownerId, conversationId: c.conversationId, projectId: c.projectId, generation: c.generation });
const cursor = (c, sequence) => ({ ...scope(c), kind: 'feed-cursor', sequence });
const snapshotToken = (c, sequence, offset = 0) => ({ ...scope(c), kind: 'snapshot-page', sequence, offset });
function validate(token, chat, kind) {
  if (!token || typeof token !== 'object' || Array.isArray(token)) fail('MALFORMED_TOKEN', 400);
  if (token.schemaVersion !== 1) fail('UNSUPPORTED_SCHEMA');
  if (token.kind !== kind || !integer(token.sequence)) fail('MALFORMED_TOKEN', 400);
  if (token.ownerId !== chat.ownerId || token.conversationId !== chat.conversationId || token.projectId !== chat.projectId) fail('FOREIGN_TOKEN');
  if (token.generation !== chat.generation) fail('WRONG_GENERATION');
  if (token.sequence > chat.sequence) fail('FUTURE_CURSOR');
}
async function boundary(tx, chat, sequence) {
  if (sequence === 0) return;
  const event = await tx.doc(ProjectionEvents, key(chat.conversationId, sequence), null);
  check(Object.keys(event).length > 0);
  check(event.schemaVersion === 1, 'UNSUPPORTED_SCHEMA');
  check(event.ownerId === chat.ownerId && event.conversationId === chat.conversationId && event.projectId === chat.projectId && event.generation === chat.generation && event.sequence === sequence);
}
async function record(tx, chat, ref, upper) {
  check(ref && ['turn', 'review'].includes(ref.kind) && typeof ref.id === 'string' && integer(ref.revision) && ref.revision > 0 && ref.revision <= upper && integer(ref.ordinal) && ref.ordinal > 0);
  const body = await tx.doc(ProjectionRecords, key(chat.conversationId, ref.kind, ref.id, ref.revision), null);
  check(body.revision === ref.revision && body.ordinal === ref.ordinal && body.source?.id === ref.id && (body.source.sessionId ?? 'pocket') === chat.conversationId && body.source.projectId === chat.projectId && (ref.kind === 'turn' ? body.runId === ref.id && same(body.messages, conversationMessages(body.source)) : body.operationId === ref.id), 'MISSING_IMMUTABLE_REFERENCE');
  return copy(body);
}
async function manifest(tx, chat, sequence) {
  const saved = await tx.doc(ReadSnapshots, key(chat.conversationId, sequence), null);
  if (saved.schemaVersion !== undefined) {
    check(saved.schemaVersion === 1, 'UNSUPPORTED_SCHEMA');
    check(same(saved.scope, scope(chat)) && saved.sequence === sequence && Array.isArray(saved.refs));
    return copy(saved.refs);
  }
  check(Object.keys(saved).length === 0);
  // Retained reset snapshots are also usable after promotion and across startup.
  check(sequence > 0 && sequence <= (chat.stagedSequence ?? 0));
  const staged = await tx.doc(ProjectionSnapshots, key(chat.conversationId, sequence), null);
  check(staged.schemaVersion === 1, Object.keys(staged).length ? 'UNSUPPORTED_SCHEMA' : 'HISTORY_GAP');
  check(staged.ownerId === chat.ownerId && staged.conversationId === chat.conversationId && staged.projectId === chat.projectId && staged.generation === chat.generation && staged.sequence === sequence && Array.isArray(staged.turns) && Array.isArray(staged.reviews));
  return ['turn', 'review'].flatMap(kind => (kind === 'turn' ? staged.turns : staged.reviews).map(r => ({ ...r, kind })));
}
async function capture(tx, chat) {
  const saved = await tx.doc(ReadSnapshots, key(chat.conversationId, chat.sequence), null);
  if (saved.schemaVersion !== undefined) return manifest(tx, chat, chat.sequence);
  check(Object.keys(saved).length === 0);
  const refs = [];
  for (const [kind, ids] of [['turn', chat.turnIds], ['review', chat.reviewIds]]) {
    check(Array.isArray(ids) && new Set(ids).size === ids.length);
    for (const [index, id] of ids.entries()) {
      const head = await tx.doc(LiveRecords, key(chat.conversationId, kind, id), null);
      const ref = { kind, id, ordinal: index + 1, revision: head.revision };
      // Pin and validate immutable revisions before leaving this consistent capture.
      check(same(copy(head), await record(tx, chat, ref, chat.sequence)), 'MISSING_IMMUTABLE_REFERENCE');
      refs.push(ref);
    }
  }
  Object.assign(saved, { schemaVersion: 1, scope: scope(chat), sequence: chat.sequence, refs });
  return refs;
}
export function page(items, make, { limit, maxBytes }) {
  let result = make([]), size = x => Buffer.byteLength(JSON.stringify(x), 'utf8');
  if (size(result) > maxBytes) fail('ENVELOPE_TOO_LARGE', 413);
  const accepted = [];
  for (const item of items.slice(0, limit)) {
    const candidate = make([...accepted, item]);
    if (size(candidate) > maxBytes) {
      if (!accepted.length) fail('ITEM_TOO_LARGE', 413);
      break;
    }
    accepted.push(item); result = candidate;
  }
  return result;
}
const envelope = chat => ({ ...scope(chat), internalOnly: true, consistentRead: true, liveWrites: true, approvalEvidence: 'raw-pending-not-action-proof' });

/** Caller supplies the same supported root.commit used by authoritative mutations. */
export async function readConversationSnapshot(tx, bindings, id, options = {}) {
  const bounds = limits(options), chat = await context(tx, bindings, id);
  let sequence = chat.sequence, offset = 0, refs;
  if (options.token !== undefined) {
    validate(options.token, chat, 'snapshot-page');
    ({ sequence, offset } = options.token);
    if (!integer(offset)) fail('MALFORMED_TOKEN', 400);
    refs = await manifest(tx, chat, sequence);
  } else refs = await capture(tx, chat);
  await boundary(tx, chat, sequence);
  if (offset > refs.length) fail('MALFORMED_TOKEN', 400);
  for (const kind of ['turn', 'review']) {
    const group = refs.filter(r => r.kind === kind);
    check(new Set(group.map(r => r.id)).size === group.length && group.every((r, i) => r.ordinal === i + 1));
  }
  // Only returned candidates are loaded; heads are never consulted on continuation.
  const candidates = [];
  for (const ref of refs.slice(offset, offset + bounds.limit)) candidates.push({ ...ref, record: await record(tx, chat, ref, sequence) });
  return page(candidates, items => ({ ...envelope(chat), snapshot: snapshotToken(chat, sequence), highWater: sequence,
    after: cursor(chat, sequence), items, next: offset + items.length < refs.length ? snapshotToken(chat, sequence, offset + items.length) : null }), bounds);
}

export async function readConversationEvents(tx, bindings, id, options = {}) {
  const bounds = limits(options), chat = await context(tx, bindings, id);
  const token = options.token ?? options.after;
  validate(token, chat, options.token === undefined ? 'feed-cursor' : 'feed-page');
  const start = token.sequence, upper = options.token === undefined ? chat.sequence : token.upper;
  if (!integer(upper) || upper < start) fail('MALFORMED_TOKEN', 400);
  if (upper > chat.sequence) fail('FUTURE_CURSOR');
  await boundary(tx, chat, start);
  const candidates = [];
  for (let sequence = start + 1; sequence <= upper && candidates.length < bounds.limit; sequence++) {
    const event = await tx.doc(ProjectionEvents, key(id, sequence), null);
    check(Object.keys(event).length > 0);
    check(event.schemaVersion === 1, 'UNSUPPORTED_SCHEMA');
    check(event.ownerId === chat.ownerId && event.conversationId === id && event.projectId === chat.projectId && event.generation === chat.generation && event.sequence === sequence);
    if (event.type === 'snapshot.reset') {
      check(event.requiresSnapshot === true && event.snapshotSequence === sequence && ['initial-stage', 'unobserved-changes'].includes(event.reason));
      const refs = await manifest(tx, chat, sequence);
      for (const ref of refs) await record(tx, chat, ref, sequence);
      candidates.push({ event: copy(event), snapshot: snapshotToken(chat, sequence) });
    } else {
      check(types.has(event.type) && event.type.startsWith(event.kind === 'review' ? 'review.' : event.type === 'turn.accepted' ? 'turn.' : 'run.') && event.revision === sequence);
      const ref = { kind: event.kind, id: event.recordId, revision: event.revision, ordinal: event.ordinal };
      candidates.push({ event: copy(event), record: await record(tx, chat, ref, upper) });
    }
  }
  return page(candidates, items => {
    const sequence = items.at(-1)?.event.sequence ?? start;
    return { ...envelope(chat), upper, page: { ...scope(chat), kind: 'feed-page', sequence: start, upper }, items, after: cursor(chat, sequence),
      next: sequence < upper ? { ...scope(chat), kind: 'feed-page', sequence, upper } : null };
  }, bounds);
}
