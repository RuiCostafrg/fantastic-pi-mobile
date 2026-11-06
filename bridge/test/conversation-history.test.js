import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { Harness, createRegistry, defineDoc } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { openStore } from '../src/store.js';
import { makeServer } from '../src/server.js';
import { HistoryIndex, HistoryChats, HistoryImports, HistoryRows, HistoryVersions, importHistory, historyDigest } from '../src/conversation-history.js';
const doc = (kind, initial) => defineDoc({ kind, version: 1, scope: 'session', initial });
const Jobs = doc('pocket.jobs', () => ({ items: {} })), Reviews = doc('pocket.reviews', () => ({ items: {} }));
const Bindings = doc('pocket.bindings', () => ({ items: {} }));
const exec = promisify(execFile), token = 'private-history-fixture-token'.repeat(3);
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args])).stdout.trim();
const fixtureURL = new URL('./fixtures/conversation-history-v4.json', import.meta.url);
const syntheticBytes = await readFile(fixtureURL, 'utf8'), inventory = JSON.parse(syntheticBytes);
const sign = input => ({ ...input, digest: historyDigest(input) });
const row = (requestId, ordinal = 1, change = {}) => ({ requestId, ordinal, text: 'PRIVATE_HISTORY_TEXT', answer: 'PRIVATE_HISTORY_ANSWER', clientStatus: 'done', projectId: null, ...change });
const wait = async (read, predicate) => {
  for (let i = 0; i < 500; i++) { const x = await read(); if (predicate(x)) return x; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('History fixture timed out');
};
async function files(path) {
  const result = {};
  for (const entry of await readdir(path, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) Object.assign(result, await files(full));
    else result[full] = (await readFile(full)).toString('base64');
  }
  return result;
}
async function fixture(fn) {
  const base = await mkdtemp(join(tmpdir(), 'conversation-history-')), cwd = join(base, 'source'), directory = join(base, 'state');
  await mkdir(cwd); await git(cwd, 'init', '-b', 'trunk');
  await git(cwd, 'config', 'user.name', 'Fixture'); await git(cwd, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(join(cwd, 'base.txt'), 'base'); await git(cwd, 'add', '.'); await git(cwd, 'commit', '-m', 'fixture');
  await writeFile(join(cwd, 'staged.txt'), 'keep'); await git(cwd, 'add', 'staged.txt');
  const source = [await git(cwd, 'rev-parse', 'HEAD'), await git(cwd, 'diff', '--cached')];
  const dispatches = [], logs = [];
  const options = { directory, cwd, defaultBranch: 'trunk', runner: async input => { dispatches.push(input.id); return 'BACKEND_FINAL'; } };
  let store = await openStore(options), server, dropped;
  async function stopServer() { if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); server = null; } }
  async function offline(fn) {
    await stopServer(); if (store) await store.close(); store = null;
    const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'assistant.sqlite')), { registry: createRegistry(), models: createModels() }, ctx);
    try { return await fn(harness, await harness.root(ctx)); }
    finally { await harness.close(ctx); store = await openStore(options); }
  }
  const f = { get store() { return store; }, get directory() { return directory; }, cwd, dispatches, logs, offline,
    async manifest(conversationId = 'history-only', rows = [row('historical-request')], change = {}) {
      return sign({ schemaVersion: 1, ownerId: (await store.getOwnerIdentity()).ownerId, conversationId,
        importId: 'import-' + conversationId, projectId: null, provenance: { kind: 'android-v4', sourceId: 'synthetic-export' }, session: {}, rows, ...change });
    },
    async seed(id = 'b01-shared-job', chat = 'shared-chat') { await store.submit(id, 'hello', chat); return wait(() => store.get(id), j => j?.status === 'done'); },
    async audit() { return offline(async (h, root) => ({ jobs: await h.snapshot(Jobs, ctx), reviews: await h.snapshot(Reviews, ctx), bindings: await h.snapshot(Bindings, ctx), tasks: await root.commit(tx => tx.scanTasks({}, 200), ctx) })); },
    async request(path, body, headers = {}) {
      if (!server) {
        const originalImport = store.importHistory.bind(store);
        store.importHistory = async (...args) => {
          const receipt = await originalImport(...args);
          if (dropped) { const socket = dropped; dropped = null; socket.destroy(); }
          return receipt;
        };
        server = makeServer(store, token, (event, data) => logs.push({ event, ...data }));
        server.prependListener('request', req => { if (req.headers['x-fixture-drop-import'] === 'yes') dropped = req.socket; });
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
      }
      const response = await fetch('http://127.0.0.1:' + server.address().port + path, { method: body === undefined ? 'GET' : 'POST',
        headers: Object.fromEntries(Object.entries({ Authorization: 'Bearer ' + token, 'X-Conversation-Schema': '1', 'X-Conversation-Owner': (await store.getOwnerIdentity()).ownerId, 'X-History-Schema': '1', ...headers }).filter(([, v]) => v !== undefined)),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      assert.equal(response.headers.get('cache-control'), 'no-store'); return { status: response.status, body: await response.json() };
    }
  };
  try {
    await fn(f);
    assert.deepEqual([await git(cwd, 'rev-parse', 'HEAD'), await git(cwd, 'diff', '--cached')], source);
    assert.equal(await readFile(fixtureURL, 'utf8'), syntheticBytes, 'synthetic drafts/selection/pairing/review JSON unchanged');
    const logged = JSON.stringify(logs);
    for (const secret of [token, base, 'PRIVATE_HISTORY', 'PRIVATE_PENDING', 'BACKEND_FINAL']) assert.ok(!logged.includes(secret));
  } finally { await stopServer(); if (store) await store.close(); await rm(base, { recursive: true, force: true }); }
}
const history = id => '/v1/conversations/' + id + '/history';
const q = value => encodeURIComponent(JSON.stringify(value));

function inventoryRows(sessionId) {
  return inventory.android.jobs.filter(j => j.sessionId === sessionId).map((j, index) => ({ requestId: j.id, ordinal: index + 1, text: j.text, answer: j.answer,
    clientStatus: j.status, projectId: j.projectId, projectState: j.projectState, createdAt: j.created, sourceRowid: j.sourceRowid, progress: j.progress, pending: j.pending }));
}
test('B06: synthetic Android inventory preserves original order/IDs/provenance and local organization without tasks, bindings or effects', () => fixture(async f => {
  const sharedJob = await f.seed(); await f.seed('b01-backend-only');
  const snapshot = await f.store.changes('shared-chat');
  const operation = { operationId: 'saved-review-operation', action: 'test', revision: snapshot.revision, command: 'printf B06_REVIEW_ONLY' };
  await f.store.reviewAction('shared-chat', operation);
  await wait(() => f.store.getReview('shared-chat', operation.operationId), action => action.status === 'done');
  await writeFile(join(sharedJob.workspace.cwd, 'private-dirty.txt'), 'retained dirty worktree evidence');
  await mkdir(join(f.directory, 'pi-sessions'), { recursive: true });
  await writeFile(join(f.directory, 'pi-sessions', 'saved-fixture.jsonl'), 'synthetic saved Pi bytes; never import or resume this file');
  const before = await f.audit(), savedFiles = await files(f.directory + '/worktrees'), savedPi = await files(f.directory + '/pi-sessions'), dispatches = [...f.dispatches];
  const core = await f.store.readConversationSnapshot('shared-chat');
  for (const session of inventory.android.sessions) {
    const { id, projectId, ...organization } = session;
    const manifest = await f.manifest(id, inventoryRows(id), { projectId, session: { ...organization, pinned: Boolean(session.pinned), finished: Boolean(session.finished), archived: Boolean(session.archived) } });
    const receipt = await f.store.importHistory(manifest);
    assert.equal(receipt.outcome, 'imported'); assert.equal(receipt.executionAuthority, false);
    assert.deepEqual((await f.store.readHistoryImport(manifest.ownerId, id, manifest.importId)).items[0].manifest, manifest);
  }
  const owner = (await f.store.getOwnerIdentity()).ownerId;
  const historical = await f.store.readHistory(owner, 'history-only');
  const rows = historical.items.filter(x => x.kind === 'evidence');
  assert.deepEqual(rows.map(r => r.evidence.requestId), inventory.comparisons.historySourceOrder);
  assert.deepEqual(rows.map(r => r.evidence.sourceRowid), [12, 13]); assert.equal(historical.projectId, null);
  assert.ok(rows.every(r => r.classification === 'historical-unverified' && !r.actionable && r.executionAuthority === false));
  const unresolved = (await f.store.readHistory(owner, 'uncertain-chat')).items[0];
  assert.equal(unresolved.evidence.clientStatus, 'sending'); assert.equal(unresolved.classification, 'unresolved-outbox');
  const shared = (await f.store.readHistory(owner, 'shared-chat')).items[0];
  assert.equal(shared.classification, 'backend-reference'); assert.deepEqual(shared.messages, []);
  assert.equal(shared.evidence.answer, 'older cached text'); assert.match(shared.evidence.pending, /Stale cached dialog/);
  assert.deepEqual(await f.store.readConversationSnapshot('shared-chat'), core, 'import cannot revise canonical results/events/approvals');
  assert.deepEqual(await f.audit(), before); assert.deepEqual(f.dispatches, dispatches); assert.deepEqual(await files(f.directory + '/worktrees'), savedFiles); assert.deepEqual(await files(f.directory + '/pi-sessions'), savedPi);
  for (const id of inventory.comparisons.androidOnlyRequests) assert.equal(await f.store.get(id), undefined);
  for (const id of ['history-only', 'uncertain-chat', 'selected-draft', 'pocket']) assert.equal(await f.store.getSessionProject(id), null);
}));

test('B06: exact retry/digest receipt survives reopen; changed manifests cannot reuse an import ID', () => fixture(async f => {
  const manifest = await f.manifest(), receipt = await f.store.importHistory(manifest);
  assert.deepEqual(await f.store.importHistory(manifest), receipt);
  const reordered = Object.fromEntries(Object.entries(manifest).reverse()); assert.deepEqual(await f.store.importHistory(reordered), receipt);
  await f.offline(async () => {});
  assert.deepEqual(await f.store.importHistory(manifest), receipt);
  await assert.rejects(f.store.importHistory(sign({ ...manifest, session: { title: 'changed' } })), e => e.status === 409 && e.code === 'IMPORT_ID_REUSED');
  const next = sign({ ...manifest, importId: 'another-import' });
  const duplicate = await f.store.importHistory(next); assert.equal(duplicate.decisions[0].deduplicated, true);
  const page = await f.store.readHistory(manifest.ownerId, manifest.conversationId);
  assert.equal(page.items.filter(x => x.kind === 'evidence').length, 1); assert.equal(page.items.filter(x => x.kind === 'import').length, 2);
  assert.deepEqual(f.dispatches, []);
}));

test('B06: conflicts preserve full immutable evidence and atomically import no partial rows; backend identity/state wins', () => fixture(async f => {
  const accepted = await f.seed();
  const manifest = await f.manifest('shared-chat', [row('new-local-history', 1), row(accepted.id, 2, { text: 'wrong content' })]);
  const receipt = await f.store.importHistory(manifest);
  assert.equal(receipt.outcome, 'conflict'); assert.deepEqual(receipt.decisions, []); assert.deepEqual(receipt.conflicts, [{ requestId: accepted.id, fields: ['text'] }]);
  const view = await f.store.readHistory(manifest.ownerId, 'shared-chat'); assert.equal(view.items.length, 1); assert.equal(view.items[0].kind, 'import');
  assert.deepEqual((await f.store.readHistoryImport(manifest.ownerId, 'shared-chat', manifest.importId)).items[0].manifest, manifest);
  assert.deepEqual(await f.store.get(accepted.id), accepted);
  assert.deepEqual(await f.store.importHistory(manifest), receipt);
  const good = sign({ ...manifest, importId: 'corrected-import', rows: [row(accepted.id, 1, { text: 'hello', clientStatus: 'running', answer: 'stale', pending: 'PRIVATE_PENDING' })] });
  assert.equal((await f.store.importHistory(good)).outcome, 'imported');
  const matched = (await f.store.readHistory(manifest.ownerId, 'shared-chat')).items.find(x => x.kind === 'evidence');
  assert.equal(matched.classification, 'backend-reference'); assert.deepEqual(matched.messages, []); assert.equal(matched.actionable, false);
  assert.deepEqual(await f.store.get(accepted.id), accepted); await f.offline(async () => {});
}));

test('B06: wrong chat/project and changed local evidence produce explicit conflicts, never retarget or overwrite', () => fixture(async f => {
  const accepted = await f.seed();
  for (const [name, target, rows, extra] of [
    ['cross-chat', 'other-chat', [row(accepted.id, 1, { text: 'hello' })], {}],
    ['cross-project', 'shared-chat', [row(accepted.id, 1, { text: 'hello', projectId: 'foreign-project' })], { projectId: 'foreign-project' }]
  ]) {
    const m = await f.manifest(target, rows, { importId: name, ...extra });
    assert.equal((await f.store.importHistory(m)).outcome, 'conflict');
  }
  const local = await f.manifest(); await f.store.importHistory(local);
  const changed = sign({ ...local, importId: 'changed-evidence', rows: [row('historical-request', 1, { answer: 'changed' })] });
  const conflict = await f.store.importHistory(changed); assert.equal(conflict.outcome, 'conflict'); assert.ok(conflict.conflicts[0].fields.includes('importedEvidence'));
  const view = await f.store.readHistory(local.ownerId, local.conversationId);
  assert.equal(view.items.find(x => x.kind === 'evidence').evidence.answer, 'PRIVATE_HISTORY_ANSWER');
  const claimed = await f.manifest('unproved-claim', [], { projectId: 'claim-a' }); await f.store.importHistory(claimed);
  const retargeted = sign({ ...claimed, importId: 'retargeted-claim', projectId: 'claim-b' });
  assert.equal((await f.store.importHistory(retargeted)).outcome, 'conflict');
  assert.equal(await f.store.getSessionProject('unproved-claim'), null);
  assert.equal(await f.store.getSessionProject('other-chat'), null); assert.deepEqual(await f.store.get(accepted.id), accepted);
  await f.offline(async () => {});
}));

test('B06: imported historical/uncertain IDs and unproved chats cannot execute through legacy or shared Send/create/approval', () => fixture(async f => {
  const accepted = await f.seed();
  const m = await f.manifest('shared-chat', [row('local-uncertain-id', 1, { clientStatus: 'sending' }), row('local-history-id', 2)]);
  await f.store.importHistory(m);
  for (const requestId of ['local-uncertain-id', 'local-history-id']) {
    await assert.rejects(f.store.submit(requestId, 'PRIVATE_HISTORY_TEXT', 'shared-chat'), e => e.code === 'IMPORTED_REQUEST_NOT_RUNNABLE');
    assert.equal((await f.request('/v1/jobs', { requestId, text: 'PRIVATE_HISTORY_TEXT', conversationId: 'shared-chat', projectId: accepted.projectId })).status, 409);
    await assert.rejects(f.store.answerApproval({ ownerId: m.ownerId, conversationId: 'shared-chat', projectId: accepted.projectId, runId: requestId, approvalId: 'fake', responseId: 'response-id', answer: { confirmed: true } }), e => e.status === 404);
  }
  const unresolved = await f.manifest('unknown-chat', [], { projectId: accepted.projectId }); await f.store.importHistory(unresolved);
  await assert.rejects(f.store.submit('fresh-attempt-id', 'hello', 'unknown-chat'), e => e.code === 'HISTORY_PROJECT_UNPROVED');
  await assert.rejects(f.store.createConversation({ ownerId: m.ownerId, conversationId: 'unknown-chat', projectId: accepted.projectId }), e => e.code === 'HISTORY_PROJECT_UNPROVED');
  await assert.rejects(f.store.reviewAction('unknown-chat', { operationId: 'blocked-review-op', action: 'test', revision: 'a'.repeat(64), command: 'echo forbidden', projectId: accepted.projectId }), e => e.code === 'HISTORY_PROJECT_UNPROVED');
  assert.equal(await f.store.getSessionProject('unknown-chat'), null);
  assert.deepEqual(f.dispatches, [accepted.id]);
  // Existing accepted-ID retry is unaffected by the new reservation guard.
  assert.deepEqual(await f.store.submit(accepted.id, 'hello', 'shared-chat'), accepted);
}));

test('B06: transaction faults after prepared rows or receipt roll back all documents and reservations', () => fixture(async f => {
  const manifest = await f.manifest();
  await f.offline(async (h, root) => {
    const before = await h.snapshot(HistoryIndex, ctx);
    for (const stage of ['rows-prepared', 'receipt-prepared']) {
      await assert.rejects(root.commit(async tx => importHistory(tx, await tx.doc(Bindings), await tx.doc(Jobs), manifest,
        where => { if (where === stage) throw new Error('synthetic import fault'); }), ctx), /synthetic import fault/);
      assert.deepEqual(await h.snapshot(HistoryIndex, ctx), before);
      for (const [family, address] of [[HistoryChats, manifest.conversationId], [HistoryRows, manifest.rows[0].requestId], [HistoryImports, manifest.importId], [HistoryVersions, JSON.stringify([manifest.conversationId, 1])]])
        assert.equal(await h.snapshot(family, address, ctx), undefined);
      assert.equal((await root.commit(tx => tx.scanTasks({}, 100), ctx)).items.length, 0);
    }
  });
  assert.equal((await f.store.importHistory(manifest)).outcome, 'imported');
}));

test('B06: bounded history snapshots pin source order/revision across imports; foreign/future tokens and sizes fail explicitly', () => fixture(async f => {
  const m = await f.manifest('history-only', [row('history-z-first', 1), row('history-a-second', 2)]); await f.store.importHistory(m);
  const first = await f.store.readHistory(m.ownerId, m.conversationId, { limit: 1 }); assert.ok(first.next);
  await f.store.importHistory(sign({ ...m, importId: 'more-evidence', rows: [row('history-third-id', 3)] }));
  let page = first, ids = [];
  while (page) { ids.push(...page.items.filter(x => x.kind === 'evidence').map(x => x.evidence.requestId)); page = page.next ? await f.store.readHistory(m.ownerId, m.conversationId, { token: page.next, limit: 1 }) : null; }
  assert.deepEqual(ids, ['history-z-first', 'history-a-second']);
  assert.deepEqual(await f.store.readHistory(m.ownerId, m.conversationId, { limit: 1, token: first.next }), await f.store.readHistory(m.ownerId, m.conversationId, { limit: 1, token: first.next }));
  for (const patch of [{ ownerId: 'foreign' }, { conversationId: 'foreign' }, { schemaVersion: 2 }, { revision: 999 }, { offset: -1 }])
    await assert.rejects(f.store.readHistory(m.ownerId, m.conversationId, { token: { ...first.next, ...patch } }), e => [400, 409].includes(e.status));
  await assert.rejects(f.store.readHistory('foreign', m.conversationId), e => e.code === 'FOREIGN_OWNER');
  const huge = await f.manifest('huge-chat', [row('huge-history-id', 1, { answer: '大'.repeat(3000) })]); await f.store.importHistory(huge);
  await assert.rejects(f.store.readHistory(m.ownerId, 'huge-chat', { maxBytes: 1024 }), e => e.status === 413);
  const bounded = await f.store.readHistory(m.ownerId, 'huge-chat', { maxBytes: 65536 }); assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 65536);
  await f.offline(async () => {});
}));

test('B06 HTTP: authentication/schema/owner/size/digest gates, explicit history catalogue opt-in and acknowledgement loss', () => fixture(async f => {
  const m = await f.manifest(); const path = history(m.conversationId) + '/imports';
  assert.equal((await f.request('/health')).body.historyImport, true);
  assert.equal((await f.request(path, m, { Authorization: '' })).status, 401);
  assert.equal((await f.request(path, m, { 'X-History-Schema': undefined })).status, 426);
  assert.equal((await f.request(path, m, { 'X-History-Schema': '2' })).status, 426);
  assert.equal((await f.request(path, m, { 'X-Conversation-Owner': 'foreign' })).status, 409);
  assert.equal((await f.request(path, { ...m, digest: '0'.repeat(64) })).status, 400);
  assert.equal((await f.request(path, { ...m, rows: [row('oversize-history', 1, { answer: 'x'.repeat(65536) })] })).status, 413);
  assert.equal((await f.request(path, { ...m, conversationId: 'wrong' })).status, 409);
  // Destroy the actual HTTP response socket AFTER the durable receipt commits.
  await assert.rejects(f.request(path, m, { 'X-Fixture-Drop-Import': 'yes' }));
  const recovered = await f.request(path + '/' + m.importId); assert.equal(recovered.status, 200);
  assert.equal(recovered.body.items[0].receipt.revision, 1);
  assert.deepEqual((await f.request(path, m)).body, recovered.body.items[0].receipt);
  const catalogue = await f.request('/v1/conversations');
  assert.equal(catalogue.body.items[0].executionAvailable, false); assert.equal(catalogue.body.items[0].projectId, null); assert.equal(catalogue.body.items[0].historyEvidence.revision, 1);
  assert.deepEqual((await f.request('/v1/conversations', undefined, { 'X-History-Schema': undefined })).body.items, [], 'B05 catalogue remains execution-only');
  assert.equal((await f.request('/v1/conversations/history-only')).status, 404, 'evidence is not a fake executable snapshot');
  const extra = await f.manifest('z-extra-history'); await f.store.importHistory(extra);
  const first = (await f.request('/v1/conversations?limit=1')).body;
  assert.equal(first.next.kind, 'history-catalogue-page');
  const second = await f.request('/v1/conversations?token=' + q(first.next));
  assert.equal(second.body.items[0].conversationId, 'z-extra-history');
  assert.equal((await f.request('/v1/conversations?token=' + q(first.next), undefined, { 'X-History-Schema': undefined })).status, 409);
  const view = await f.request(history('history-only')); assert.equal(view.status, 200); assert.equal(view.body.items[0].actionable, false);
  assert.equal((await f.request(path + '/' + m.importId, undefined, { Authorization: '' })).status, 401);
  const changed = sign({ ...m, importId: 'conflict-over-http', rows: [row('historical-request', 1, { text: 'changed' })] });
  assert.equal((await f.request(path, changed)).status, 409);
  assert.deepEqual(f.dispatches, []);
}));

test('B06: rejects malformed manifests and unsupported history stores without writes or fallback', () => fixture(async f => {
  const m = await f.manifest();
  for (const change of [{ schemaVersion: 2 }, { extra: true }, { rows: [row('duplicate-row-id'), row('duplicate-row-id', 2)] },
    { rows: [row('bad-order-one', 2), row('bad-order-two', 1)] }, { rows: [row('bad-state-row', 1, { clientStatus: 'approved' })] },
    { rows: [row('bad-action-row', 1, { action: 'send' })] }, { session: { pendingReview: 'must stay local' } }, { provenance: { kind: 'pi-session', sourceId: 'source' } },
    { rows: Array.from({ length: 101 }, (_, i) => row('request-' + i, i + 1)) }]) {
    await assert.rejects(f.store.importHistory(sign({ ...m, ...change })), e => e.status === 400);
  }
  assert.deepEqual((await f.store.listConversations(m.ownerId, {}, true)).items, []);
  assert.equal(await f.store.getSessionProject(m.conversationId), null);
  let calls = 0;
  const server = makeServer({ projectBindings: true, conversationCore: true, eventSchemaVersion: 1, getOwnerIdentity: async () => ({ ownerId: m.ownerId }), importHistory: async () => { calls++; } }, token, () => {});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const response = await fetch('http://127.0.0.1:' + server.address().port + history(m.conversationId) + '/imports', { method: 'POST', body: JSON.stringify(m), headers: { Authorization: 'Bearer ' + token, 'X-Conversation-Schema': '1', 'X-Conversation-Owner': m.ownerId, 'X-History-Schema': '1' } });
    assert.equal(response.status, 426); assert.equal(calls, 0);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
}));
