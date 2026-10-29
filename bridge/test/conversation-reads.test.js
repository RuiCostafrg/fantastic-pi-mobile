import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { Harness, createRegistry, defineDoc } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { openStore } from '../src/store.js';
import { stageConversations, ProjectionRecords, ProjectionEvents } from '../src/conversation-projection.js';
import { readConversationSnapshot, readConversationEvents, READ_LIMITS } from '../src/conversation-reads.js';
import { LiveRecords, projectMutation } from '../src/conversation-live.js';
const exec = promisify(execFile), key = (...p) => JSON.stringify(p);
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args])).stdout.trim();
const Bindings = defineDoc({ kind: 'pocket.bindings', version: 1, scope: 'session', initial: () => ({ items: {} }) });
const Jobs = defineDoc({ kind: 'pocket.jobs', version: 1, scope: 'session', initial: () => ({ items: {} }) });
async function wait(read, predicate) {
  for (let i = 0; i < 1000; i++) { const v = await read(); if (predicate(v)) return v; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('fixture timeout');
}
async function fixture(fn) {
  const base = await mkdtemp(join(tmpdir(), 'mobile-reads-')), cwd = join(base, 'source'), directory = join(base, 'journal');
  await mkdir(cwd); await git(cwd, 'init', '-b', 'trunk'); await git(cwd, 'config', 'user.name', 'Fixture'); await git(cwd, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(join(cwd, 'base.txt'), 'base'); await git(cwd, 'add', '.'); await git(cwd, 'commit', '-m', 'fixture');
  await writeFile(join(cwd, 'staged.txt'), 'preserve'); await git(cwd, 'add', '.'); const before = await git(cwd, 'diff', '--cached');
  try { await fn({ options: { directory, cwd, defaultBranch: 'trunk' }, directory, cwd }); assert.equal(await git(cwd, 'diff', '--cached'), before); }
  finally { await rm(base, { recursive: true, force: true }); }
}
async function journal(directory, fn) {
  const h = await Harness.open(await openNodeSqliteStorage(join(directory, 'assistant.sqlite')), { registry: createRegistry(), models: createModels() }, ctx);
  try { await fn(h, await h.root(ctx)); } finally { await h.close(ctx); }
}
const done = async (s, id, chat = 'chat', text = id) => { await s.submit(id, text, chat); await wait(() => s.get(id), j => j.status === 'done'); };
const bytes = x => Buffer.byteLength(JSON.stringify(x));
const code = code => ({ code });

test('B03c: full count/byte paged history, immutable capture, stable cards, deterministic replay and snapshot catch-up race', () => fixture(async f => {
  let store = await openStore({ ...f.options, runner: async ({ id }) => 'result-' + id });
  try {
    for (let i = 0; i < 7; i++) await done(store, 'run-' + i);
    const first = await store.readConversationSnapshot('chat', { limit: 2, maxBytes: 10000 });
    assert.equal(first.items.length, 2); assert.ok(first.next); assert.equal(first.consistentRead, true);
    await done(store, 'racing');
    const history = [...first.items]; let next = first.next;
    while (next) {
      const p = await store.readConversationSnapshot('chat', { token: next, limit: 2, maxBytes: 10000 });
      assert.deepEqual(await store.readConversationSnapshot('chat', { token: next, limit: 2, maxBytes: 10000 }), p);
      assert.ok(bytes(p) <= 10000 && p.items.length <= 2); history.push(...p.items); next = p.next;
    }
    assert.deepEqual(history.map(r => r.id), Array.from({ length: 7 }, (_, i) => 'run-' + i));
    assert.deepEqual(history.map(r => r.ordinal), [1, 2, 3, 4, 5, 6, 7]);
    for (const item of history) { assert.equal(item.record.messages.length, 2); assert.equal(item.record.messages[1].text, 'result-' + item.id); }
    assert.deepEqual(await store.readConversationSnapshot('chat', { token: first.snapshot, limit: 2, maxBytes: 10000 }), first);
    const catchup = await store.readConversationEvents('chat', { after: first.after });
    assert.ok(catchup.items.some(x => x.event.recordId === 'racing')); assert.equal(catchup.next, null);
    const snapshot = first.snapshot; await store.close(); store = await openStore(f.options);
    assert.deepEqual(await store.readConversationSnapshot('chat', { token: snapshot, limit: 2, maxBytes: 10000 }), first);
  } finally { await store.close(); }
}));

test('B03c: feed upper bound pins all pages while new writes arrive; all revisions apply idempotently to one card', () => fixture(async f => {
  let send, finish;
  const store = await openStore({ ...f.options, runner: async input => { send = input.onEvent; return new Promise(r => { finish = r; }); } });
  try {
    await store.submit('run', 'hello', 'chat'); await wait(async () => send, Boolean);
    const snapshot = await store.readConversationSnapshot('chat');
    for (let i = 0; i < 5; i++) await send({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'revision-' + i }] } });
    await send({ type: 'extension_ui_request', method: 'confirm', id: 'raw', title: 'question' });
    await send({ type: 'tool_execution_start', toolName: 'read' });
    const first = await store.readConversationEvents('chat', { after: snapshot.after, limit: 2, maxBytes: 12000 });
    assert.ok(first.next);
    await send({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'late' }] } });
    finish('final'); await wait(() => store.get('run'), j => j.status === 'done');
    assert.deepEqual(await store.readConversationEvents('chat', { token: first.page, limit: 2, maxBytes: 12000 }), first);
    const all = [...first.items]; let next = first.next, last = first;
    while (next) {
      const p = await store.readConversationEvents('chat', { token: next, limit: 2, maxBytes: 12000 });
      assert.deepEqual(await store.readConversationEvents('chat', { token: next, limit: 2, maxBytes: 12000 }), p);
      assert.equal(p.upper, first.upper); assert.ok(bytes(p) <= 12000 && p.items.length <= 2); all.push(...p.items); next = p.next; last = p;
    }
    assert.equal(all.at(-1).event.sequence, first.upper);
    assert.deepEqual(all.map(x => x.event.sequence), Array.from({ length: first.upper - snapshot.highWater }, (_, i) => snapshot.highWater + i + 1));
    assert.ok(all.some(x => x.event.type === 'run.pending' && x.record.source.pending));
    assert.ok(all.some(x => x.record.source.pending === null));
    const tail = await store.readConversationEvents('chat', { after: last.after });
    assert.equal(tail.items.at(-1).event.type, 'run.done');
    const cards = new Map(snapshot.items.map(x => [x.id, x.record]));
    for (const item of [...all, ...all, ...tail.items]) cards.set(item.event.recordId, item.record);
    assert.equal(cards.size, 1); assert.equal(cards.get('run').messages.length, 2); assert.equal(cards.get('run').messages[1].text, 'final');
    assert.equal(tail.approvalEvidence, 'raw-pending-not-action-proof');
  } finally { await store.close(); }
}));

test('B03c: whole envelope byte bounds, explicit oversized item, count and invalid limits', () => fixture(async f => {
  const store = await openStore({ ...f.options, runner: async () => 'x'.repeat(3500) });
  try {
    for (let i = 0; i < 3; i++) await done(store, 'large-' + i);
    const p = await store.readConversationSnapshot('chat', { limit: 3, maxBytes: 11000 });
    assert.equal(p.items.length, 1); assert.ok(bytes(p) <= 11000); assert.ok(p.next);
    await assert.rejects(store.readConversationSnapshot('chat', { maxBytes: 2000 }), code('ITEM_TOO_LARGE'));
    let feed = await store.readConversationEvents('chat', { after: { ...p.after, sequence: 0 }, limit: 200, maxBytes: 14000 });
    let total = 0;
    do {
      assert.ok(bytes(feed) <= 14000); assert.ok(feed.items.length < 200); total += feed.items.length;
      feed = feed.next ? await store.readConversationEvents('chat', { token: feed.next, limit: 200, maxBytes: 14000 }) : null;
    } while (feed);
    assert.equal(total, p.highWater);
    assert.ok(bytes(await store.readConversationEvents('chat', { after: p.after, maxBytes: 1024 })) <= 1024);
    const small = { ...p.after, sequence: p.highWater - 1 };
    await assert.rejects(store.readConversationEvents('chat', { after: small, maxBytes: 2000 }), code('ITEM_TOO_LARGE'));
    for (const options of [{ limit: 0 }, { limit: -1 }, { limit: 201 }, { limit: 1.5 }, { limit: '2' }, { limit: null }, { maxBytes: 1023 }, { maxBytes: READ_LIMITS.maxBytes + 1 }, { maxBytes: Infinity }, { maxBytes: '4096' }]) {
      await assert.rejects(store.readConversationSnapshot('chat', options), code('INVALID_LIMIT'));
      await assert.rejects(store.readConversationEvents('chat', { after: p.after, ...options }), code('INVALID_LIMIT'));
    }
  } finally { await store.close(); }
}));

test('B03c: malformed, foreign owner/chat/project, generation, schema, future and token-kind validation; unknown reads have no effects', () => fixture(async f => {
  const store = await openStore({ ...f.options, runner: async () => 'done' });
  try {
    await done(store, 'one'); await done(store, 'two', 'other');
    const p = await store.readConversationSnapshot('chat');
    for (const [patch, error] of [[{ ownerId: 'foreign' }, 'FOREIGN_TOKEN'], [{ conversationId: 'other' }, 'FOREIGN_TOKEN'], [{ projectId: 'wrong' }, 'FOREIGN_TOKEN'], [{ generation: 'wrong' }, 'WRONG_GENERATION'], [{ schemaVersion: 2 }, 'UNSUPPORTED_SCHEMA'], [{ sequence: p.highWater + 1 }, 'FUTURE_CURSOR'], [{ sequence: -1 }, 'MALFORMED_TOKEN'], [{ kind: 'snapshot-page' }, 'MALFORMED_TOKEN']]) {
      await assert.rejects(store.readConversationEvents('chat', { after: { ...p.after, ...patch } }), code(error));
    }
    await assert.rejects(store.readConversationSnapshot('chat', { token: p.after }), code('MALFORMED_TOKEN'));
    await assert.rejects(store.readConversationSnapshot('chat', { token: { ...p.snapshot, offset: -1 } }), code('MALFORMED_TOKEN'));
    await assert.rejects(store.readConversationEvents('chat', { after: null }), code('MALFORMED_TOKEN'));
    for (const method of ['readConversationSnapshot', 'readConversationEvents']) {
      await assert.rejects(store[method]('unknown'), code('UNKNOWN_CONVERSATION'));
      await assert.rejects(store[method]('../bad'), code('MALFORMED_CONVERSATION'));
    }
    assert.equal(await store.getSessionProject('unknown'), null);
    assert.equal((await store.inspectLiveConversation('chat')).turns.length, 1);
    assert.equal((await store.inspectLiveConversation('other')).turns.length, 1);
  } finally { await store.close(); }
  await journal(f.directory, async (_, root) => root.commit(async tx => {
    assert.equal((await tx.scanTasks({}, 100)).items.length, 2);
    assert.equal(Object.hasOwn((await tx.doc(Bindings)).items, 'unknown'), false);
  }, ctx));
}));

test('B03c: retained staged resets page-read historical revisions and catch up through review/recovery without redispatch', () => fixture(async f => {
  let store = await openStore({ ...f.options, initializeProjection: stageConversations, runner: async () => 'old' });
  await done(store, 'old'); await store.close();
  store = await openStore({ ...f.options, initializeProjection: stageConversations }); await store.close();
  await journal(f.directory, async (_, root) => root.commit(async tx => { (await tx.doc(Jobs)).items.old.answer = 'changed'; }, ctx));
  let calls = 0;
  store = await openStore({ ...f.options, runner: async input => {
    calls++; await input.onEvent({ type: 'extension_ui_request', method: 'confirm', id: 'pending' });
    return new Promise((_, reject) => input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true }));
  }, reviewActions: { execute: async () => ({ message: 'review done' }) } });
  let first;
  try {
    const now = await store.readConversationSnapshot('chat');
    const resets = await store.readConversationEvents('chat', { after: { ...now.after, sequence: 0 }, limit: 1 });
    assert.equal(resets.items[0].event.type, 'snapshot.reset');
    const old = await store.readConversationSnapshot('chat', { token: resets.items[0].snapshot });
    assert.equal(old.items[0].record.source.answer, 'old');
    const second = await store.readConversationEvents('chat', { token: resets.next });
    assert.equal(second.items[0].event.reason, 'unobserved-changes');
    assert.equal((await store.readConversationSnapshot('chat', { token: second.items[0].snapshot })).items[0].record.source.answer, 'changed');
    await store.reviewAction('chat', { operationId: 'review-op', action: 'test', revision: 'a'.repeat(64), command: 'fixture' });
    await wait(() => store.getReview('chat', 'review-op'), r => r.status === 'done');
    await store.submit('pending', 'pending', 'chat'); await wait(() => store.get('pending'), j => j.pending);
    first = await store.readConversationSnapshot('chat', { limit: 1 });
  } finally { await store.close(); }
  store = await openStore({ ...f.options, runner: async () => { calls++; return 'REPLAY'; } });
  try {
    await wait(() => store.get('pending'), j => j.status === 'interrupted');
    const recovered = await store.readConversationEvents('chat', { after: first.after });
    assert.ok(recovered.items.some(x => x.event.type === 'run.interrupted' && x.record.source.pending === null));
    assert.equal(calls, 1);
    assert.deepEqual(await store.readConversationSnapshot('chat', { token: first.snapshot, limit: 1 }), first);
    const current = await store.readConversationSnapshot('chat');
    assert.equal(current.items.filter(x => x.kind === 'review').length, 1);
    const all = await store.readConversationEvents('chat', { after: { ...current.after, sequence: 2 } });
    assert.ok(all.items.some(x => x.event.type === 'review.done'));
  } finally { await store.close(); }
}));

test('B03c: missing immutable references, sequence gaps and unsupported event schemas fail explicitly, never partial', () => fixture(async f => {
  const store = await openStore({ ...f.options, runner: async () => 'done' });
  await done(store, 'one'); const p = await store.readConversationSnapshot('chat'); await store.close();
  await journal(f.directory, async (_, root) => {
    // Use the supported transaction API with deliberately malformed fixture evidence.
    await root.commit(async tx => {
      const bindings = await tx.doc(Bindings);
      const ref = p.items[0], body = await tx.doc(ProjectionRecords, key('chat', 'turn', ref.id, ref.revision), null);
      const saved = JSON.parse(JSON.stringify(body)); for (const k of Object.keys(body)) delete body[k];
      await assert.rejects(readConversationSnapshot(tx, bindings, 'chat', { token: p.snapshot }), code('MISSING_IMMUTABLE_REFERENCE'));
      Object.assign(body, saved);
      const e = await tx.doc(ProjectionEvents, key('chat', 1), null), old = JSON.parse(JSON.stringify(e));
      for (const k of Object.keys(e)) delete e[k];
      await assert.rejects(readConversationEvents(tx, bindings, 'chat', { after: { ...p.after, sequence: 0 } }), code('HISTORY_GAP'));
      Object.assign(e, old, { schemaVersion: 99 });
      await assert.rejects(readConversationEvents(tx, bindings, 'chat', { after: { ...p.after, sequence: 0 } }), code('UNSUPPORTED_SCHEMA'));
      Object.assign(e, old);
    }, ctx);
  });
}));

test('B03c: supported capture transaction serializes a write racing head pinning and retains catch-up evidence', () => fixture(async f => {
  const store = await openStore({ ...f.options, runner: async () => 'before' });
  await done(store, 'one'); await store.close();
  await journal(f.directory, async (_, root) => {
    let enter, release;
    const entered = new Promise(r => { enter = r; }), released = new Promise(r => { release = r; });
    const reading = root.commit(async tx => {
      const wrapped = { doc: async (...args) => {
        if (args[0] === LiveRecords) { enter(); await released; }
        return tx.doc(...args);
      } };
      return readConversationSnapshot(wrapped, await tx.doc(Bindings), 'chat');
    }, ctx);
    await entered;
    const writing = root.commit(async tx => {
      const job = (await tx.doc(Jobs)).items.one; job.answer = 'after';
      await projectMutation(tx, await tx.doc(Bindings), 'turn', job, 'run.result');
    }, ctx);
    release();
    const captured = await reading; await writing;
    assert.equal(captured.items[0].record.source.answer, 'before');
    const feed = await root.commit(async tx => readConversationEvents(tx, await tx.doc(Bindings), 'chat', { after: captured.after }), ctx);
    assert.equal(feed.items.length, 1); assert.equal(feed.items[0].record.source.answer, 'after');
    assert.equal(feed.items[0].event.sequence, captured.highWater + 1);
    const again = await root.commit(async tx => readConversationSnapshot(tx, await tx.doc(Bindings), 'chat', { token: captured.snapshot }), ctx);
    assert.deepEqual(again, captured);
  });
}));

test('B03c: two real projects stay isolated, and reads never prepare an unknown tree or admit tasks', () => fixture(async f => {
  const other = join(f.cwd, '..', 'other-source'); await mkdir(other);
  await git(other, 'init', '-b', 'trunk'); await git(other, 'config', 'user.name', 'Fixture'); await git(other, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(join(other, 'base.txt'), 'other'); await git(other, 'add', '.'); await git(other, 'commit', '-m', 'fixture');
  const store = await openStore({ ...f.options, runner: async () => 'done' });
  try {
    const project = await store.registerProject({ source: other, name: 'Other', branchPolicy: { kind: 'local', branch: 'trunk' } });
    await done(store, 'default-run');
    await store.submit('other-run', 'other', 'other-chat', project.projectId);
    await wait(() => store.get('other-run'), j => j.status === 'done');
    const a = await store.readConversationSnapshot('chat'), b = await store.readConversationSnapshot('other-chat');
    assert.notEqual(a.projectId, b.projectId); assert.equal(b.items[0].id, 'other-run');
    await assert.rejects(store.readConversationSnapshot('other-chat', { token: a.snapshot }), code('FOREIGN_TOKEN'));
    await assert.rejects(store.readConversationEvents('chat', { after: b.after }), code('FOREIGN_TOKEN'));
    assert.equal(await store.getSessionProject('unknown'), null);
    await assert.rejects(store.readConversationSnapshot('unknown'), code('UNKNOWN_CONVERSATION'));
    assert.equal(await git(other, 'status', '--porcelain'), '');
  } finally { await store.close(); }
}));
