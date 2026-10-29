import { createHash } from 'node:crypto';
import { defineDoc, defineDocFamily } from '@earendil-works/pi-durable';
import { Owner, conversationMessages } from './conversations.js';
import { ProjectionState } from './conversation-projection.js';
import { limits, page } from './conversation-reads.js';

// Evidence only: these documents are never inputs to a task or a Pi session.
export const HistoryIndex = defineDoc({ kind: 'pocket.history-index', version: 1, scope: 'session', initial: () => ({}) });
const family = kind => defineDocFamily({ kind, version: 1, scope: 'session', family: true, initial: () => ({}) });
export const HistoryChats = family('pocket.history-chats');
export const HistoryRows = family('pocket.history-rows');
export const HistoryImports = family('pocket.history-imports');
export const HistoryVersions = family('pocket.history-versions');
export const HISTORY_LIMITS = Object.freeze({ rows: 100, bytes: 65536 });
const key = (...parts) => JSON.stringify(parts);
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item);
export const historyDigest = manifest => createHash('sha256').update(canonical(Object.fromEntries(Object.entries(manifest).filter(([k]) => k !== 'digest')))).digest('hex');
const same = (a, b) => canonical(a) === canonical(b);
const receiptDigest = value => createHash('sha256').update(canonical(value)).digest('hex');
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, status }); };
const check = condition => { if (!condition) fail('HISTORY_EVIDENCE_CONFLICT'); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
const requestId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const statuses = new Set(['sending', 'queued', 'running', 'done', 'failed', 'cancelled', 'interrupted', 'unknown']);
const uncertain = new Set(['sending', 'queued', 'running', 'interrupted', 'unknown']);
const own = (items, name) => Object.hasOwn(items, name) ? items[name] : null;
function fields(value, allowed, required = allowed) {
  return object(value) && Object.keys(value).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(value, k));
}
export function validateHistoryManifest(input) {
  if (!object(input)) fail('INVALID_HISTORY_MANIFEST', 400);
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > HISTORY_LIMITS.bytes) fail('HISTORY_MANIFEST_TOO_LARGE', 413);
  if (!fields(input, ['schemaVersion', 'ownerId', 'conversationId', 'importId', 'digest', 'projectId', 'provenance', 'session', 'rows']) ||
      input.schemaVersion !== 1 || !id(input.conversationId) || !requestId(input.importId) ||
      typeof input.ownerId !== 'string' || !(input.projectId === null || id(input.projectId)) ||
      !fields(input.provenance, ['kind', 'sourceId']) || input.provenance.kind !== 'android-v4' || !id(input.provenance.sourceId) ||
      !object(input.session) || !Array.isArray(input.rows) || input.rows.length > HISTORY_LIMITS.rows)
    fail('INVALID_HISTORY_MANIFEST', 400);
  // Organization is preserved as evidence, not synchronized or applied to any client.
  const session = input.session;
  if (!fields(session, ['title', 'draft', 'pinned', 'finished', 'archived', 'created', 'updated', 'projectState'], []) ||
      Object.entries(session).some(([k, value]) => ['title', 'draft', 'projectState'].includes(k) ? typeof value !== 'string' :
        ['created', 'updated'].includes(k) ? !integer(value) : typeof value !== 'boolean')) fail('INVALID_SESSION_EVIDENCE', 400);
  const ids = new Set(); let ordinal = 0;
  for (const row of input.rows) {
    if (!fields(row, ['requestId', 'ordinal', 'text', 'answer', 'clientStatus', 'projectId', 'projectState', 'createdAt', 'sourceRowid', 'progress', 'pending'],
      ['requestId', 'ordinal', 'text', 'answer', 'clientStatus', 'projectId']) ||
      !requestId(row.requestId) || ids.has(row.requestId) || !integer(row.ordinal) || row.ordinal <= ordinal ||
      typeof row.text !== 'string' || typeof row.answer !== 'string' || !statuses.has(row.clientStatus) ||
      !(row.projectId === null || id(row.projectId)) ||
      ['projectState', 'progress', 'pending'].some(k => Object.hasOwn(row, k) && typeof row[k] !== 'string') ||
      ['createdAt', 'sourceRowid'].some(k => Object.hasOwn(row, k) && !integer(row[k]))) fail('INVALID_HISTORY_ROW', 400);
    ids.add(row.requestId); ordinal = row.ordinal;
  }
  if (typeof input.digest !== 'string' || !/^[0-9a-f]{64}$/.test(input.digest) || input.digest !== historyDigest(input)) fail('HISTORY_DIGEST_MISMATCH', 400);
}
async function indexOf(tx) {
  const index = await tx.doc(HistoryIndex), owner = await tx.doc(Owner);
  check(index.schemaVersion === 1 && index.ownerId === owner.ownerId &&
    ['conversationIds', 'requestIds', 'importIds'].every(k => Array.isArray(index[k]) && new Set(index[k]).size === index[k].length));
  return index;
}
async function ownerScope(tx, ownerId) {
  const index = await indexOf(tx), state = await tx.doc(ProjectionState);
  if (state.mode !== 'live') fail('HISTORY_IMPORT_UNAVAILABLE', 426);
  if (index.ownerId !== ownerId) fail('FOREIGN_OWNER');
  return index;
}
async function create(tx, token, address, value) {
  const doc = await tx.doc(token, address, null); check(Object.keys(doc).length === 0); Object.assign(doc, copy(value));
}

/** Startup validation before resume; do not repair foreign/partial evidence. */
export async function initializeHistory(tx, { bindings, jobs }) {
  const index = await tx.doc(HistoryIndex), owner = await tx.doc(Owner);
  if (!Object.keys(index).length) Object.assign(index, { schemaVersion: 1, ownerId: owner.ownerId, conversationIds: [], requestIds: [], importIds: [] });
  await indexOf(tx);
  const importedRows = new Set(), importedReceipts = new Set();
  for (const conversationId of index.conversationIds) {
    const chat = await tx.doc(HistoryChats, conversationId, null);
    check(chat.ownerId === owner.ownerId && chat.conversationId === conversationId && integer(chat.revision) && chat.revision > 0 &&
      Array.isArray(chat.rowIds) && new Set(chat.rowIds).size === chat.rowIds.length && Array.isArray(chat.importIds) && chat.importIds.length === chat.revision);
    const refs = [], claims = new Set();
    for (const [position, importId] of chat.importIds.entries()) {
      check(index.importIds.includes(importId) && !importedReceipts.has(importId)); importedReceipts.add(importId);
      const saved = await tx.doc(HistoryImports, importId, null);
      validateHistoryManifest(saved.manifest);
      check(saved.manifest.ownerId === owner.ownerId && saved.manifest.conversationId === conversationId && saved.manifest.importId === importId &&
        saved.receipt.ownerId === owner.ownerId && saved.receipt.conversationId === conversationId && saved.receipt.importId === importId &&
        saved.receipt.schemaVersion === 1 && saved.receipt.executionAuthority === false && saved.receiptDigest === receiptDigest(saved.receipt) &&
        saved.receipt.digest === saved.manifest.digest && saved.receipt.revision === position + 1 && ['imported', 'conflict'].includes(saved.receipt.outcome));
      if (saved.receipt.outcome === 'imported') {
        for (const claim of [saved.manifest.projectId, ...saved.manifest.rows.map(row => row.projectId)]) if (claim !== null) claims.add(claim);
        for (const row of saved.manifest.rows) {
          if (!refs.some(ref => ref.kind === 'row' && ref.id === row.requestId)) refs.push({ kind: 'row', id: row.requestId });
        }
      }
      refs.push({ kind: 'import', id: importId });
      const version = await tx.doc(HistoryVersions, key(conversationId, position + 1), null);
      check(version.ownerId === owner.ownerId && version.conversationId === conversationId && version.revision === position + 1 && same(version.refs, refs));
    }
    check(claims.size <= 1 && chat.claimedProjectId === ([...claims][0] ?? null));
    check(same(chat.rowIds, refs.filter(ref => ref.kind === 'row').map(ref => ref.id)));
    for (const requestId of chat.rowIds) {
      check(index.requestIds.includes(requestId) && !importedRows.has(requestId)); importedRows.add(requestId);
      const saved = await tx.doc(HistoryRows, requestId, null);
      check(saved.ownerId === owner.ownerId && saved.conversationId === conversationId && saved.evidence.requestId === requestId &&
        chat.importIds.includes(saved.importId) && ['backend-reference', 'historical-unverified', 'unresolved-outbox'].includes(saved.classification));
      const manifest = (await tx.doc(HistoryImports, saved.importId, null)).manifest;
      check(same(manifest.rows.find(row => row.requestId === requestId), saved.evidence) && same(saved.provenance, manifest.provenance));
      const backend = own(jobs.items, requestId);
      if (saved.classification === 'backend-reference') check(backend && (backend.sessionId ?? 'pocket') === conversationId && backend.text === saved.evidence.text &&
        backend.projectId === bindings.items[conversationId]?.projectId);
      else check(!backend && saved.classification === (uncertain.has(saved.evidence.clientStatus) ? 'unresolved-outbox' : 'historical-unverified'));
    }
  }
  check(importedRows.size === index.requestIds.length && importedReceipts.size === index.importIds.length);
}

/** One supported owner transaction; the optional checkpoint is for rollback fixtures. */
export async function importHistory(tx, bindings, jobs, input, checkpoint = () => {}) {
  validateHistoryManifest(input);
  const index = await ownerScope(tx, input.ownerId);
  if (index.importIds.includes(input.importId)) {
    const saved = await tx.doc(HistoryImports, input.importId, null);
    if (!same(saved.manifest, input)) fail('IMPORT_ID_REUSED');
    return copy(saved.receipt);
  }
  const bound = own(bindings.items, input.conversationId)?.projectId ?? null;
  const conflicts = [], decisions = [], prepared = [];
  const conflict = (requestId, fields) => conflicts.push({ requestId, fields });
  const claims = [...new Set([input.projectId, ...input.rows.map(row => row.projectId)].filter(value => value !== null))];
  const previous = index.conversationIds.includes(input.conversationId) ? await tx.doc(HistoryChats, input.conversationId, null) : null;
  if (claims.length > 1 || (previous?.claimedProjectId && claims.length && previous.claimedProjectId !== claims[0])) conflict(null, ['projectId']);
  if (bound && input.projectId !== null && input.projectId !== bound) conflict(null, ['projectId']);
  for (const row of input.rows) {
    const backend = own(jobs.items, row.requestId), fields = [];
    if (row.projectId !== null && ((bound && row.projectId !== bound) || (input.projectId !== null && row.projectId !== input.projectId))) fields.push('projectId');
    if (backend) {
      if ((backend.sessionId ?? 'pocket') !== input.conversationId) fields.push('conversationId');
      if (backend.text !== row.text) fields.push('text');
      if ((input.projectId !== null && backend.projectId !== input.projectId) || (row.projectId !== null && backend.projectId !== row.projectId)) fields.push('projectId');
    }
    let saved;
    if (index.requestIds.includes(row.requestId)) {
      saved = await tx.doc(HistoryRows, row.requestId, null);
      if (saved.conversationId !== input.conversationId) fields.push('conversationId');
      if (backend ? saved.evidence.text !== row.text : !same(saved.evidence, row)) fields.push('importedEvidence');
    }
    if (fields.length) conflict(row.requestId, [...new Set(fields)]);
    const classification = backend ? 'backend-reference' : uncertain.has(row.clientStatus) ? 'unresolved-outbox' : 'historical-unverified';
    decisions.push({ requestId: row.requestId, classification, deduplicated: Boolean(saved),
      ...(backend ? { canonicalRunId: backend.id } : {}) });
    if (!saved) prepared.push({ ownerId: input.ownerId, conversationId: input.conversationId, importId: input.importId,
      classification, provenance: input.provenance, evidence: row });
  }
  let chat;
  if (index.conversationIds.includes(input.conversationId)) chat = await tx.doc(HistoryChats, input.conversationId, null);
  else {
    await create(tx, HistoryChats, input.conversationId, { ownerId: input.ownerId, conversationId: input.conversationId, revision: 0, claimedProjectId: null, rowIds: [], importIds: [] });
    chat = await tx.doc(HistoryChats, input.conversationId, null); index.conversationIds.push(input.conversationId); index.conversationIds.sort();
  }
  if (!conflicts.length && claims.length) chat.claimedProjectId = claims[0];
  if (!conflicts.length) for (const saved of prepared) {
    await create(tx, HistoryRows, saved.evidence.requestId, saved);
    index.requestIds.push(saved.evidence.requestId); chat.rowIds.push(saved.evidence.requestId);
  }
  await checkpoint('rows-prepared');
  const revision = chat.revision + 1;
  const receipt = { schemaVersion: 1, ownerId: input.ownerId, conversationId: input.conversationId, importId: input.importId,
    digest: input.digest, revision, outcome: conflicts.length ? 'conflict' : 'imported', executionAuthority: false,
    projectEvidence: { claimedProjectId: input.projectId, provedProjectId: bound, state: bound ? 'proved' : 'unproved' },
    decisions: conflicts.length ? [] : decisions, conflicts };
  await create(tx, HistoryImports, input.importId, { manifest: input, receipt, receiptDigest: receiptDigest(receipt) });
  const refs = chat.revision ? copy((await tx.doc(HistoryVersions, key(input.conversationId, chat.revision), null)).refs) : [];
  if (!conflicts.length) for (const saved of prepared) refs.push({ kind: 'row', id: saved.evidence.requestId });
  refs.push({ kind: 'import', id: input.importId });
  await create(tx, HistoryVersions, key(input.conversationId, revision), { ownerId: input.ownerId, conversationId: input.conversationId, revision, refs });
  chat.revision = revision; chat.importIds.push(input.importId); index.importIds.push(input.importId);
  await checkpoint('receipt-prepared');
  return copy(receipt);
}

/** Reservations prevent historical/uncertain evidence becoming a task via ANY Send route. */
export async function requireHistoryAdmission(tx, bindings, conversationId, requestId) {
  const index = await indexOf(tx);
  if (index.conversationIds.includes(conversationId) && !own(bindings.items, conversationId)) fail('HISTORY_PROJECT_UNPROVED');
  if (requestId !== undefined && index.requestIds.includes(requestId)) fail('IMPORTED_REQUEST_NOT_RUNNABLE');
}
export async function historyCatalogue(tx, ownerId) {
  const index = await ownerScope(tx, ownerId), result = [];
  for (const id of index.conversationIds) {
    const chat = await tx.doc(HistoryChats, id, null);
    result.push({ conversationId: id, revision: chat.revision });
  }
  return result;
}
async function savedImport(tx, index, conversationId, importId) {
  if (!index.importIds.includes(importId)) fail('UNKNOWN_HISTORY_IMPORT', 404);
  const saved = await tx.doc(HistoryImports, importId, null);
  if (saved.manifest.conversationId !== conversationId) fail('FOREIGN_HISTORY_IMPORT');
  check(saved.receiptDigest === receiptDigest(saved.receipt));
  return copy({ manifest: saved.manifest, receipt: saved.receipt });
}
export async function readHistoryImport(tx, ownerId, conversationId, importId, options = {}) {
  const bounds = limits(options), index = await ownerScope(tx, ownerId);
  const saved = await savedImport(tx, index, conversationId, importId);
  return page([saved], items => ({ schemaVersion: 1, ownerId, conversationId, executionAuthority: false, items, next: null }), bounds);
}
export async function readHistory(tx, bindings, ownerId, conversationId, options = {}) {
  const bounds = limits(options), index = await ownerScope(tx, ownerId);
  if (!index.conversationIds.includes(conversationId)) fail('UNKNOWN_HISTORY', 404);
  const chat = await tx.doc(HistoryChats, conversationId, null);
  let revision = chat.revision, offset = 0;
  if (options.token !== undefined) {
    const token = options.token;
    if (!object(token) || token.kind !== 'history-page' || token.schemaVersion !== 1 || token.ownerId !== ownerId || token.conversationId !== conversationId)
      fail('FOREIGN_HISTORY_TOKEN');
    if (!integer(token.revision) || token.revision < 1 || token.revision > revision || !integer(token.offset)) fail('INVALID_HISTORY_TOKEN', 400);
    ({ revision, offset } = token);
  }
  const version = await tx.doc(HistoryVersions, key(conversationId, revision), null);
  check(version.revision === revision && version.ownerId === ownerId && version.conversationId === conversationId && Array.isArray(version.refs));
  if (offset > version.refs.length) fail('INVALID_HISTORY_TOKEN', 400);
  const candidates = [];
  for (const ref of version.refs.slice(offset, offset + bounds.limit)) {
    if (ref.kind === 'import') candidates.push({ kind: 'import', receipt: (await savedImport(tx, index, conversationId, ref.id)).receipt });
    else {
      const saved = copy(await tx.doc(HistoryRows, ref.id, null));
      check(saved.ownerId === ownerId && saved.conversationId === conversationId && saved.evidence.requestId === ref.id);
      candidates.push({ kind: 'evidence', ...saved, actionable: false, executionAuthority: false,
        messages: saved.classification === 'backend-reference' ? [] : conversationMessages({ id: ref.id, text: saved.evidence.text, answer: saved.evidence.answer }) });
    }
  }
  return page(candidates, items => ({ schemaVersion: 1, ownerId, conversationId, revision, readOnly: true, executionAuthority: false,
    // Project proof is always authoritative binding evidence, never an imported claim.
    projectId: own(bindings.items, conversationId)?.projectId ?? null,
    items, next: offset + items.length < version.refs.length ? { schemaVersion: 1, ownerId, conversationId, kind: 'history-page', revision, offset: offset + items.length } : null }), bounds);
}
