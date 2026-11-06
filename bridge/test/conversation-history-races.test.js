import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openStore } from '../src/store.js';
import { historyDigest, HistoryImports, HistoryRows, HistoryVersions } from '../src/conversation-history.js';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
const exec = promisify(execFile);
const sign = m => ({ ...m, digest: historyDigest(m) });
async function fixture(fn) {
  const base = await mkdtemp(join(tmpdir(), 'history-races-')), cwd = join(base, 'repo'), directory = join(base, 'state');
  await mkdir(cwd);
  const git = async (...args) => exec('git', ['-C', cwd, ...args]);
  await git('init', '-b', 'trunk'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'test@example.invalid');
  await writeFile(join(cwd, 'base'), 'base'); await git('add', '.'); await git('commit', '-m', 'fixture');
  const dispatches = [], options = { cwd, directory, defaultBranch: 'trunk', runner: async input => { dispatches.push(input.id); return 'done'; } };
  let store = await openStore(options);
  async function offline(action) {
    if (store) await store.close(); store = null;
    const h = await Harness.open(await openNodeSqliteStorage(join(directory, 'assistant.sqlite')), { registry: createRegistry(), models: createModels() }, ctx);
    try { await action(h, await h.root(ctx)); } finally { await h.close(ctx); }
    store = await openStore(options);
  }
  const ownerId = (await store.getOwnerIdentity()).ownerId, projectId = (await store.listProjects())[0].projectId;
  const manifest = (conversationId = 'history-chat', requestId = 'historical-run') => sign({ schemaVersion: 1, ownerId, importId: 'import-' + conversationId,
    conversationId, projectId: null, provenance: { kind: 'android-v4', sourceId: 'synthetic-export' }, session: {},
    rows: [{ requestId, ordinal: 1, text: 'hello', answer: '', clientStatus: 'sending', projectId: null }] });
  try { await fn({ get store() { return store; }, manifest, offline, ownerId, projectId, dispatches }); }
  finally { if (store) await store.close(); await rm(base, { recursive: true, force: true }); }
}

test('B06: concurrent duplicate imports have one receipt/revision; opposite content cannot overwrite it', () => fixture(async f => {
  const m = f.manifest();
  const receipts = await Promise.all(Array.from({ length: 5 }, () => f.store.importHistory(m)));
  assert.ok(receipts.every(r => JSON.stringify(r) === JSON.stringify(receipts[0]))); assert.equal(receipts[0].revision, 1);
  const changed = sign({ ...m, rows: [{ ...m.rows[0], text: 'opposite' }] });
  await assert.rejects(f.store.importHistory(changed), e => e.code === 'IMPORT_ID_REUSED');
  assert.equal((await f.store.readHistory(f.ownerId, m.conversationId)).revision, 1);
  assert.deepEqual(f.dispatches, []);
}));

test('B06: Send/import serialization either reserves unexecuted evidence or references one admitted job, never a replay', () => fixture(async f => {
  for (const order of ['import-first', 'send-first']) {
    const m = f.manifest(order, 'race-' + order);
    const importing = () => f.store.importHistory(m);
    const sending = () => f.store.submit(m.rows[0].requestId, 'hello', m.conversationId, f.projectId, f.ownerId);
    const results = await Promise.allSettled(order === 'import-first' ? [importing(), sending()] : [sending(), importing()]);
    const job = await f.store.get(m.rows[0].requestId);
    const view = await f.store.readHistory(f.ownerId, m.conversationId);
    const evidence = view.items.find(x => x.kind === 'evidence');
    if (job) {
      assert.equal(evidence.classification, 'backend-reference'); assert.deepEqual(evidence.messages, []);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
    } else {
      assert.equal(evidence.classification, 'unresolved-outbox');
      assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'HISTORY_PROJECT_UNPROVED').length, 1);
      assert.equal(await f.store.getSessionProject(m.conversationId), null);
    }
    assert.ok(f.dispatches.filter(id => id === m.rows[0].requestId).length <= 1);
  }
}));

test('B06: startup refuses corrupted receipt, row classification or pinned references without repairing/dispatching', () => fixture(async f => {
  const m = f.manifest(); await f.store.importHistory(m);
  for (const [family, address, mutate] of [
    [HistoryImports, m.importId, doc => { doc.receipt.executionAuthority = true; }],
    [HistoryRows, m.rows[0].requestId, doc => { doc.classification = 'backend-reference'; }],
    [HistoryVersions, JSON.stringify([m.conversationId, 1]), doc => { doc.refs = []; }]
  ]) {
    let saved;
    await assert.rejects(f.offline(async (h, root) => {
      saved = await h.snapshot(family, address, ctx);
      await root.commit(async tx => mutate(await tx.doc(family, address, null)), ctx);
    }), /HISTORY_EVIDENCE_CONFLICT/);
    await f.offline(async (h, root) => {
      const corrupted = await h.snapshot(family, address, ctx); assert.notDeepEqual(corrupted, saved);
      await root.commit(async tx => { const doc = await tx.doc(family, address, null); for (const key of Object.keys(doc)) delete doc[key]; Object.assign(doc, saved); }, ctx);
    });
    assert.deepEqual((await f.store.readHistoryImport(f.ownerId, m.conversationId, m.importId)).items[0].manifest, m);
  }
  assert.deepEqual(f.dispatches, []);
}));
