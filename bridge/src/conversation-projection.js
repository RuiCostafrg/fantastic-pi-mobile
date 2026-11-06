import { createHash, randomUUID } from 'node:crypto';
import { defineDoc, defineDocFamily } from '@earendil-works/pi-durable';
import { Owner, ConversationBaselines, conversationMessages, compareLegacyRecords } from './conversations.js';
import { bindingError } from './bindings.js';

// Immutable B03a staging evidence and B03b transactional live projection.
export const ProjectionState = defineDoc({ kind: 'pocket.projection-state', version: 1, scope: 'session', initial: () => ({}) });
const family = kind => defineDocFamily({ kind, version: 1, scope: 'session', family: true, initial: () => ({}) });
export const ConversationProjections = family('pocket.conversation-projections');
export const ProjectionSnapshots = family('pocket.projection-snapshots');
export const ProjectionRecords = family('pocket.projection-records');
export const ProjectionEvents = family('pocket.projection-events');
const copy = value => JSON.parse(JSON.stringify(value));
const address = (...parts) => JSON.stringify(parts);
const sessionOf = source => source.sessionId ?? 'pocket';
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const same = (a, b) => canonical(a) === canonical(b);
const digest = (projectId, turns, reviews) => createHash('sha256').update(canonical({ projectId, turns, reviews })).digest('hex');
const fail = () => { throw bindingError('Conversation projection conflicts or is incomplete; refusing staging.'); };
const require = condition => { if (!condition) fail(); };
const statuses = new Set(['queued', 'running', 'done', 'failed', 'cancelled', 'interrupted']);
const ordering = { kind: 'reconstructed', by: 'preserved-ordinals-then-createdAt-id', missingDates: 'last' };
const unique = ids => Array.isArray(ids) && ids.every(id => typeof id === 'string') && new Set(ids).size === ids.length;
function checkSource(source, id, projectId, kind) {
  require(validId(id) && typeof projectId === 'string' && projectId.length > 0 && source &&
    typeof source.id === 'string' && source.id.length > 0 && sessionOf(source) === id && source.projectId === projectId);
  require(statuses.has(source.status) && (source.createdAt == null || (Number.isFinite(source.createdAt) && source.createdAt >= 0)));
  require(kind === 'turn' ? typeof source.text === 'string' && (source.answer == null || typeof source.answer === 'string')
    : source.input && typeof source.input === 'object' && !Array.isArray(source.input));
}
function checkIdentity(saved, current, kind) {
  require(current && saved.id === current.id && sessionOf(saved) === sessionOf(current) && saved.projectId === current.projectId &&
    saved.taskId === current.taskId && (saved.createdAt ?? null) === (current.createdAt ?? null));
  require(kind === 'turn' ? saved.text === current.text : same(saved.input, current.input));
  if (saved.workspace) require(same(saved.workspace, current.workspace));
}
async function create(tx, token, key, value) {
  const doc = await tx.doc(token, key, null);
  require(Object.keys(doc).length === 0); // Conflicting prepared evidence is never overwritten.
  Object.assign(doc, value);
}
function checkSnapshot(snapshot, event, chat, sequence) {
  require(snapshot && snapshot.schemaVersion === 1 && snapshot.ownerId === chat.ownerId && snapshot.conversationId === chat.conversationId && snapshot.projectId === chat.projectId &&
    snapshot.generation === chat.generation && snapshot.sequence === sequence && same(snapshot.ordering, ordering));
  require(event && event.type === 'snapshot.reset' && event.schemaVersion === 1 && event.ownerId === chat.ownerId &&
    event.conversationId === chat.conversationId && event.projectId === chat.projectId && event.generation === chat.generation &&
    event.sequence === sequence && event.snapshotSequence === sequence && event.requiresSnapshot === true &&
    event.reason === (sequence === 1 ? 'initial-stage' : 'unobserved-changes'));
}
function references(snapshot, kind) {
  const refs = kind === 'turn' ? snapshot.turns : snapshot.reviews;
  require(Array.isArray(refs) && unique(refs.map(ref => ref?.id)));
  for (const [index, ref] of refs.entries()) {
    require(ref.ordinal === index + 1 && Number.isSafeInteger(ref.revision) && ref.revision > 0 && ref.revision <= snapshot.sequence);
  }
  return refs;
}
function checkRecord(record, ref, snapshot, kind) {
  require(record);
  checkSource(record.source, snapshot.conversationId, snapshot.projectId, kind);
  require(record.source.id === ref.id && record.ordinal === ref.ordinal && record.revision === ref.revision &&
    (kind === 'turn' ? record.runId === ref.id && same(record.messages, conversationMessages(record.source)) : record.operationId === ref.id));
}
async function priorSnapshot(tx, chat) {
  const snapshot = await tx.doc(ProjectionSnapshots, address(chat.conversationId, chat.sequence), null);
  const event = await tx.doc(ProjectionEvents, address(chat.conversationId, chat.sequence), null);
  checkSnapshot(snapshot, event, chat, chat.sequence);
  return snapshot;
}
async function loadRecords(tx, snapshot, kind, records) {
  const loaded = [];
  for (const ref of references(snapshot, kind)) {
    const record = await tx.doc(ProjectionRecords, address(snapshot.conversationId, kind, ref.id, ref.revision), null);
    checkRecord(record, ref, snapshot, kind);
    checkIdentity(record.source, records[ref.id], kind);
    loaded.push(copy(record));
  }
  return loaded;
}
function orderedSources(items, id, seeds) {
  require(unique(seeds));
  for (const key of seeds) require(items[key] && sessionOf(items[key]) === id);
  const known = new Set(seeds);
  return [...seeds.map(key => items[key]), ...Object.values(items).filter(source => sessionOf(source) === id && !known.has(source.id)).sort(compareLegacyRecords)];
}

/** Startup transaction after B02 validation, before any task resumes. No external effects. */
export async function stageConversations(tx, { projects, bindings, jobs, reviews }) {
  const owner = await tx.doc(Owner), state = await tx.doc(ProjectionState);
  require(uuid(owner.ownerId) && owner.baselineVersion === 1 && unique(owner.conversationIds));
  const existing = Object.keys(state).length !== 0;
  if (existing) {
    require(state.ownerId === owner.ownerId && state.mode === 'staged' && unique(state.conversationIds));
    require(same([...state.conversationIds].sort(), state.conversationIds));
    for (const id of state.conversationIds) require(Object.hasOwn(bindings.items, id));
  }
  for (const [id, binding] of Object.entries(bindings.items)) require(validId(id) && binding && Object.hasOwn(projects.items, binding.projectId));
  for (const [kind, items] of [['turn', jobs.items], ['review', reviews.items]]) {
    for (const [key, source] of Object.entries(items)) {
      require(source?.id === key);
      checkSource(source, sessionOf(source), bindings.items[sessionOf(source)]?.projectId, kind);
    }
  }
  const ids = Object.keys(bindings.items).sort();
  for (const id of ids) {
    const chat = await tx.doc(ConversationProjections, id, null);
    const known = existing && state.conversationIds.includes(id);
    const projectId = bindings.items[id].projectId;
    let oldTurns = [], oldReviews = [], seedTurns = [], seedReviews = [], generation;
    if (known) {
      require(chat.conversationId === id && chat.ownerId === owner.ownerId && chat.projectId === projectId && uuid(chat.generation) &&
        Number.isSafeInteger(chat.sequence) && chat.sequence > 0 && chat.mode === 'staged');
      const previous = await priorSnapshot(tx, chat);
      oldTurns = await loadRecords(tx, previous, 'turn', jobs.items);
      oldReviews = await loadRecords(tx, previous, 'review', reviews.items);
      require(digest(projectId, oldTurns.map(t => t.source), oldReviews.map(r => r.source)) === chat.sourceDigest);
      seedTurns = oldTurns.map(t => t.runId); seedReviews = oldReviews.map(r => r.operationId); generation = chat.generation;
    } else {
      require(Object.keys(chat).length === 0);
      if (owner.conversationIds.includes(id)) {
        const baseline = await tx.doc(ConversationBaselines, id, null);
        require(baseline.ownerId === owner.ownerId && baseline.conversationId === id && baseline.projectId === projectId && uuid(baseline.generation));
        seedTurns = baseline.turnIds; seedReviews = baseline.reviewIds; generation = baseline.generation;
      } else generation = randomUUID();
    }
    const turns = orderedSources(jobs.items, id, seedTurns), actions = orderedSources(reviews.items, id, seedReviews);
    const sourceDigest = digest(projectId, turns, actions);
    if (known && sourceDigest === chat.sourceDigest) continue;
    const sequence = known ? chat.sequence + 1 : 1;
    require(Number.isSafeInteger(sequence));
    const refs = async (kind, sources, old) => {
      const previous = new Map(old.map(record => [record.source.id, record]));
      const result = [];
      for (const [index, source] of sources.entries()) {
        const prior = previous.get(source.id), ordinal = index + 1;
        const revision = prior && same(prior.source, source) ? prior.revision : sequence;
        if (!prior || revision !== prior.revision) {
          await create(tx, ProjectionRecords, address(id, kind, source.id, revision), {
            ...(kind === 'turn' ? { runId: source.id, messages: conversationMessages(source) } : { operationId: source.id }),
            ordinal, revision, source: copy(source)
          });
        }
        result.push({ id: source.id, ordinal, revision });
      }
      return result;
    };
    const snapshot = { schemaVersion: 1, ownerId: owner.ownerId, conversationId: id, projectId, generation, sequence,
      ordering, turns: await refs('turn', turns, oldTurns), reviews: await refs('review', actions, oldReviews) };
    await create(tx, ProjectionSnapshots, address(id, sequence), snapshot);
    await create(tx, ProjectionEvents, address(id, sequence), { schemaVersion: 1, ownerId: owner.ownerId, conversationId: id,
      projectId, generation, sequence, type: 'snapshot.reset', reason: known ? 'unobserved-changes' : 'initial-stage',
      requiresSnapshot: true, snapshotSequence: sequence });
    Object.assign(chat, { ownerId: owner.ownerId, conversationId: id, projectId, generation, sequence, sourceDigest, mode: 'staged' });
  }
  Object.assign(state, { ownerId: owner.ownerId, mode: 'staged', conversationIds: ids });
}

/** Validate retained immutable staged evidence, not current state or an inspector. */
export async function validateRetainedStage(tx, chat, sequence) {
  const snapshot = await tx.doc(ProjectionSnapshots, address(chat.conversationId, sequence), null);
  const event = await tx.doc(ProjectionEvents, address(chat.conversationId, sequence), null);
  checkSnapshot(snapshot, event, chat, sequence);
  for (const kind of ['turn', 'review']) {
    for (const ref of references(snapshot, kind)) {
      const record = await tx.doc(ProjectionRecords, address(chat.conversationId, kind, ref.id, ref.revision), null);
      checkRecord(record, ref, snapshot, kind);
    }
  }
}

/** Non-paginated internal migration inspector, never a live transcript/approval interface. */
export async function readStagedConversation(reader, id, context, sequence) {
  if (!validId(id) || (sequence !== undefined && (!Number.isSafeInteger(sequence) || sequence < 1))) {
    throw Object.assign(new Error('Invalid staged conversation/sequence'), { status: 400 });
  }
  const state = await reader.snapshot(ProjectionState, context);
  if (!state) return null;
  require(state.mode === 'staged' && uuid(state.ownerId) && unique(state.conversationIds));
  if (!state.conversationIds.includes(id)) return null;
  const chat = await reader.snapshot(ConversationProjections, id, context);
  require(chat && chat.ownerId === state.ownerId && chat.conversationId === id && uuid(chat.generation) &&
    Number.isSafeInteger(chat.sequence) && chat.sequence > 0 && chat.mode === 'staged');
  const selected = sequence ?? chat.sequence;
  const snapshot = await reader.snapshot(ProjectionSnapshots, address(id, selected), context);
  if (!snapshot || selected > chat.sequence) throw bindingError('Unknown staged snapshot; refresh migration evidence.');
  const reset = await reader.snapshot(ProjectionEvents, address(id, selected), context);
  checkSnapshot(snapshot, reset, chat, selected);
  const load = async kind => Promise.all(references(snapshot, kind).map(async ref => {
    const record = await reader.snapshot(ProjectionRecords, address(id, kind, ref.id, ref.revision), context);
    checkRecord(record, ref, snapshot, kind);
    return record;
  }));
  return copy({ stagedOnly: true, liveWrites: false, approvalEvidence: 'historical-only', schemaVersion: 1,
    ownerId: snapshot.ownerId, conversationId: id, projectId: snapshot.projectId, ordering: snapshot.ordering,
    cursor: { ownerId: snapshot.ownerId, conversationId: id, generation: snapshot.generation, sequence: selected },
    turns: await load('turn'), reviews: await load('review'), reset });
}
