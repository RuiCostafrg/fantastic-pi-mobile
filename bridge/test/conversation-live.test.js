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
import { stageConversations, ProjectionEvents, ProjectionState, ProjectionRecords } from '../src/conversation-projection.js';
import { initializeLiveConversations, projectMutation, LiveRecords } from '../src/conversation-live.js';
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args])).stdout.trim();
const doc = kind => defineDoc({ kind, version: 1, scope: 'session', initial: () => ({ items: {} }) });
const Jobs = doc('pocket.jobs'), Reviews = doc('pocket.reviews'), Bindings = doc('pocket.bindings');
const key = (...args) => JSON.stringify(args);
const wait = async (read, predicate) => {
  for (let i = 0; i < 1000; i++) { const x = await read(); if (predicate(x)) return x; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('live fixture timed out');
};
async function journal(directory, fn) {
  const h = await Harness.open(await openNodeSqliteStorage(join(directory, 'assistant.sqlite')), { registry: createRegistry(), models: createModels() }, ctx);
  try { await fn(h, await h.root(ctx)); } finally { await h.close(ctx); }
}
async function fixture(fn) {
  const base = await mkdtemp(join(tmpdir(), 'mobile-live-')), cwd = join(base, 'source'), directory = join(base, 'journal');
  await mkdir(cwd);
  await git(cwd, 'init', '-b', 'trunk'); await git(cwd, 'config', 'user.name', 'Fixture'); await git(cwd, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(join(cwd, 'base.txt'), 'base'); await git(cwd, 'add', '.'); await git(cwd, 'commit', '-m', 'fixture');
  await writeFile(join(cwd, 'staged.txt'), 'preserve staging'); await git(cwd, 'add', 'staged.txt');
  const before = await git(cwd, 'diff', '--cached');
  try { await fn({ base, cwd, directory, options: { directory, cwd, defaultBranch: 'trunk' } }); assert.equal(await git(cwd, 'diff', '--cached'), before); }
  finally { await rm(base, { recursive: true, force: true }); }
}
const blocked = signal => new Promise((_, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });

test('B03b: all coding progress/result/pending/response/completion mutations project once, with stable cards and IDs', () => fixture(async f => {
  let send, finish;
  const events = [], replies = [];
  const store = await openStore({ ...f.options, runner: async input => {
    send = input.onEvent; input.clients.set(input.id, reply => replies.push(reply));
    return new Promise((resolve, reject) => { finish = resolve;
      input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true });
    });
  } });
  try {
    await store.submit('run-one', 'hello', 'chat');
    await wait(async () => send, Boolean);
    const inspect = () => store.inspectLiveConversation('chat');
    const first = await inspect(); assert.equal(first.turns.length, 1); assert.equal(first.turns[0].ordinal, 1);
    for (const event of [
      { type: 'extension_ui_request', method: 'notify', message: 'notice' },
      { type: 'tool_execution_start', toolName: 'read' },
      { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'partial' }] } },
      { type: 'extension_ui_request', method: 'confirm', id: 'raw-id', title: 'confirm?' }
    ]) {
      const before = await inspect(); await send(event); const after = await inspect();
      assert.equal(after.cursor.sequence, before.cursor.sequence + 1);
      assert.deepEqual(after.turns[0].source, await store.get('run-one')); events.push(after.events.at(-1).type);
      assert.equal(after.turns[0].messages.length, 2);
    }
    const pending = await inspect();
    await send({ type: 'extension_ui_request', method: 'confirm', id: 'raw-id', title: 'confirm?' });
    assert.equal((await inspect()).cursor.sequence, pending.cursor.sequence + 1,
      'B04a: identical question frames are distinct observations, unlike duplicate tool/results');
    await assert.rejects(store.respond('run-one', { id: 'raw-id', confirmed: true }), { status: 409 });
    const evidence = await store.inspectApprovalEvidence('run-one');
    await store.answerApproval({ ownerId: evidence.ownerId, conversationId: 'chat', projectId: evidence.projectId,
      runId: 'run-one', approvalId: evidence.currentOccurrenceId, responseId: 'b03-live-exact', answer: { confirmed: true } });
    assert.equal((await inspect()).turns[0].source.pending, null); assert.equal(replies.length, 1);
    finish('final answer'); await wait(() => store.get('run-one'), j => j.status === 'done');
    const done = await inspect(); assert.equal(done.events.at(-1).type, 'run.done');
    assert.equal(done.turns[0].messages[1].text, 'final answer'); assert.equal(done.turns.length, 1);
    assert.equal(done.cursor.generation, first.cursor.generation); assert.equal(done.turns[0].ordinal, first.turns[0].ordinal);
    assert.deepEqual(events, ['run.progress', 'run.progress', 'run.result', 'run.pending']);
    await assert.rejects(store.getStagedConversation('chat'), /projection conflicts/);
  } finally { await store.close(); }
}));

test('B03b: concurrent duplicate admission and duplicate completed request add no task/message/event or project crossing', () => fixture(async f => {
  let calls = 0;
  let store = await openStore({ ...f.options, runner: async () => { calls++; return 'done'; } });
  try {
    const accepted = await Promise.all(Array.from({ length: 5 }, () => store.submit('same-run', 'same', 'chat')));
    assert.equal(new Set(accepted.map(x => x.taskId)).size, 1);
    await wait(() => store.get('same-run'), j => j.status === 'done');
    const before = await store.inspectLiveConversation('chat');
    await store.submit('same-run', 'same', 'chat');
    assert.deepEqual(await store.inspectLiveConversation('chat'), before);
    await assert.rejects(store.submit('same-run', 'same', 'foreign'), { status: 409 });
    await assert.rejects(store.submit('same-run', 'changed', 'chat'), { status: 409 });
    assert.equal(await store.getSessionProject('foreign'), null); assert.equal(calls, 1);
    await store.close(); store = await openStore(f.options);
    assert.deepEqual(await store.inspectLiveConversation('chat'), before);
  } finally { await store.close(); }
  await journal(f.directory, async (_, root) => {
    const tasks = await root.commit(tx => tx.scanTasks({}, 100), ctx); assert.equal(tasks.items.length, 1);
  });
}));

test('B03b: explicit Stop and runner failure atomically expose terminal state and clear raw pending', () => fixture(async f => {
  const store = await openStore({ ...f.options, runner: async input => {
    if (input.id === 'fail') throw new Error('fixture failure');
    await input.onEvent({ type: 'extension_ui_request', id: 'raw', method: 'confirm' });
    return blocked(input.signal);
  } });
  try {
    await store.submit('stop', 'stop', 'chat'); await wait(() => store.get('stop'), j => j.pending);
    await store.cancel('stop'); await wait(() => store.get('stop'), j => j.status === 'cancelled');
    const stopped = await store.inspectLiveConversation('chat');
    assert.equal(stopped.events.at(-1).type, 'run.cancelled'); assert.equal(stopped.turns[0].source.pending, null);
    await store.submit('fail', 'fail', 'chat'); await wait(() => store.get('fail'), j => j.status === 'failed');
    const failed = await store.inspectLiveConversation('chat'); assert.equal(failed.events.at(-1).type, 'run.failed');
    assert.deepEqual(failed.turns.map(t => t.ordinal), [1, 2]);
  } finally { await store.close(); }
}));

test('B03b: reviews admission/running/result/failure/abort and operation duplicates use same projection transaction', () => fixture(async f => {
  let calls = 0;
  const store = await openStore({ ...f.options, reviewActions: { execute: async (_, input, signal) => {
    calls++; if (input.command === 'fail') throw new Error('failure'); if (input.command === 'block') return blocked(signal); return { message: 'done' };
  } } });
  try {
    for (const [index, command, status] of [[1, 'ok', 'done'], [2, 'fail', 'failed'], [3, 'block', 'cancelled']]) {
      const input = { operationId: 'operation-' + index, action: 'test', revision: 'a'.repeat(64), command };
      const accepted = await store.reviewAction('chat', input);
      if (command === 'block') { await wait(() => store.getReview('chat', input.operationId), a => a.status === 'running'); await store.cancelReview('chat', input.operationId); }
      await wait(() => store.getReview('chat', input.operationId), a => a.status === status);
      const before = await store.inspectLiveConversation('chat');
      assert.equal(before.events.at(-1).type, 'review.' + status);
      assert.deepEqual(before.events.slice(-3).map(e => e.type), ['review.accepted', 'review.running', 'review.' + status]);
      assert.equal(before.reviews[index - 1].source.taskId, accepted.taskId);
      await store.reviewAction('chat', input); assert.deepEqual(await store.inspectLiveConversation('chat'), before);
      await assert.rejects(store.reviewAction('foreign', input), { status: 409 });
    }
    assert.equal(calls, 3); assert.equal(await store.getSessionProject('foreign'), null);
  } finally { await store.close(); }
}));

test('B03b: prepromotion re-reconciles staged interval atomically and preserves immutable reset/snapshot references', () => fixture(async f => {
  let store = await openStore({ ...f.options, initializeProjection: stageConversations, runner: async () => 'historical' });
  await store.submit('old', 'old', 'chat'); await wait(() => store.get('old'), j => j.status === 'done'); await store.close();
  store = await openStore({ ...f.options, initializeProjection: stageConversations });
  const staged = await store.getStagedConversation('chat'); await store.close();
  await journal(f.directory, async (_, root) => root.commit(async tx => { (await tx.doc(Jobs)).items.old.answer = 'intervening'; }, ctx));
  store = await openStore(f.options);
  try {
    const live = await store.inspectLiveConversation('chat'); assert.equal(live.turns[0].source.answer, 'intervening');
    assert.equal(live.cursor.generation, staged.cursor.generation); assert.equal(live.turns[0].ordinal, staged.turns[0].ordinal);
    assert.deepEqual(live.events.map(e => e.type), ['snapshot.reset', 'snapshot.reset']);
    assert.equal(live.events[1].reason, 'unobserved-changes');
  } finally { await store.close(); }
  await journal(f.directory, async h => {
    assert.deepEqual(await h.snapshot(ProjectionEvents, key('chat', 1), ctx), staged.reset);
    assert.deepEqual(await h.snapshot(ProjectionRecords, key('chat', 'turn', 'old', 1), ctx), staged.turns[0]);
  });
}));

test('B03b: fault after prepared projection/event rolls back authoritative body/head/sequence and retry is once', () => fixture(async f => {
  const store = await openStore({ ...f.options, runner: async () => 'done' });
  await store.submit('record', 'record', 'chat'); await wait(() => store.get('record'), j => j.status === 'done'); await store.close();
  await journal(f.directory, async (h, root) => {
    const source = (await h.snapshot(Jobs, ctx)).items.record;
    const head = await h.snapshot(LiveRecords, key('chat', 'turn', 'record'), ctx);
    const state = await h.snapshot(ProjectionState, ctx);
    const mutate = async tx => {
      const job = (await tx.doc(Jobs)).items.record; job.answer = 'revision';
      await projectMutation(tx, await tx.doc(Bindings), 'turn', job, 'run.result');
    };
    await assert.rejects(root.commit(async tx => { await mutate(tx); throw new Error('after event'); }, ctx), /after event/);
    assert.deepEqual((await h.snapshot(Jobs, ctx)).items.record, source);
    assert.deepEqual(await h.snapshot(LiveRecords, key('chat', 'turn', 'record'), ctx), head);
    assert.deepEqual(await h.snapshot(ProjectionState, ctx), state);
    assert.equal(await h.snapshot(ProjectionEvents, key('chat', head.revision + 1), ctx), undefined);
    await root.commit(mutate, ctx); await root.commit(mutate, ctx);
    assert.equal((await h.snapshot(LiveRecords, key('chat', 'turn', 'record'), ctx)).revision, head.revision + 1);
    await assert.rejects(root.commit(async tx => { const job = (await tx.doc(Jobs)).items.record; job.projectId = 'foreign'; await projectMutation(tx, await tx.doc(Bindings), 'turn', job, 'run.result'); }, ctx), /projection conflicts/);
    const review = { id: 'fault-review', sessionId: 'chat', projectId: source.projectId, input: { action: 'test' }, status: 'queued', result: null };
    await assert.rejects(root.commit(async tx => {
      (await tx.doc(Reviews)).items[review.id] = review;
      await projectMutation(tx, await tx.doc(Bindings), 'review', review, 'review.accepted');
      throw new Error('review event fault');
    }, ctx), /review event fault/);
    assert.equal((await h.snapshot(Reviews, ctx)).items[review.id], undefined);
    assert.equal(await h.snapshot(LiveRecords, key('chat', 'review', review.id), ctx), undefined);
  });
}));

test('B03b: admission event conflict rolls back binding/task/input and corrected retry creates exactly one', () => fixture(async f => {
  let store = await openStore(f.options); await store.close();
  await journal(f.directory, async (_, root) => root.commit(async tx => Object.assign(await tx.doc(ProjectionEvents, key('fault-chat', 1), null), { foreign: true }), ctx));
  store = await openStore({ ...f.options, runner: async () => 'done' });
  try {
    await assert.rejects(store.submit('fault-run', 'hello', 'fault-chat'), /projection conflicts/);
    assert.equal(await store.get('fault-run'), undefined); assert.equal(await store.getSessionProject('fault-chat'), null);
    assert.equal(await store.inspectLiveConversation('fault-chat'), null);
  } finally { await store.close(); }
  await journal(f.directory, async (_, root) => {
    assert.equal((await root.commit(tx => tx.scanTasks({}, 100), ctx)).items.length, 0);
    assert.equal((await root.commit(tx => tx.scanEntries({ conversationId: root.id }, 100), ctx)).items.filter(e => e.kind === 'pocket.input').length, 0);
    // Fixture correction keeps immutable conflicting evidence; retry with a fresh exact target.
  });
  store = await openStore({ ...f.options, runner: async () => 'done' });
  try { await store.submit('fault-run', 'hello', 'corrected-chat'); await wait(() => store.get('fault-run'), j => j.status === 'done'); }
  finally { await store.close(); }
}));

test('B03b: promotion fault after reconciliation and head writes rolls back staged interval, then retry is idempotent', () => fixture(async f => {
  let store = await openStore({ ...f.options, initializeProjection: stageConversations, runner: async () => 'old' });
  await store.submit('old', 'old', 'chat'); await wait(() => store.get('old'), j => j.status === 'done'); await store.close();
  store = await openStore({ ...f.options, initializeProjection: stageConversations }); const staged = await store.getStagedConversation('chat'); await store.close();
  await assert.rejects(openStore({ ...f.options, initializeProjection: async (tx, inventory) => { await initializeLiveConversations(tx, inventory); throw new Error('promotion fault'); } }), /promotion fault/);
  await journal(f.directory, async h => {
    assert.equal((await h.snapshot(ProjectionState, ctx)).mode, 'staged');
    assert.equal(await h.snapshot(LiveRecords, key('chat', 'turn', 'old'), ctx), undefined);
  });
  store = await openStore(f.options); const live = await store.inspectLiveConversation('chat'); await store.close();
  assert.equal(live.cursor.sequence, staged.cursor.sequence);
  store = await openStore(f.options); try { assert.deepEqual(await store.inspectLiveConversation('chat'), live); } finally { await store.close(); }
}));

test('B03b: live pending coding and running review recover interrupted once in projection without redispatch', () => fixture(async f => {
  let coding = 0, reviews = 0;
  const options = { ...f.options, runner: async input => {
    coding++; input.clients.set(input.id, () => { throw new Error('stale sender'); });
    await input.onEvent({ type: 'extension_ui_request', id: 'saved-dialog', method: 'confirm' });
    return blocked(input.signal);
  }, reviewActions: { execute: async (_, __, signal) => { reviews++; return blocked(signal); } } };
  let store = await openStore(options);
  await store.submit('uncertain', 'do not replay', 'code-chat');
  await wait(() => store.get('uncertain'), j => j.pending);
  await store.reviewAction('review-chat', { operationId: 'uncertain-review', action: 'test', command: 'do not replay', revision: 'a'.repeat(64) });
  await wait(() => store.getReview('review-chat', 'uncertain-review'), a => a.status === 'running');
  const beforeCode = await store.inspectLiveConversation('code-chat'), beforeReview = await store.inspectLiveConversation('review-chat');
  await store.close(); store = await openStore(options);
  try {
    await wait(() => store.get('uncertain'), j => j.status === 'interrupted');
    await wait(() => store.getReview('review-chat', 'uncertain-review'), a => a.status === 'interrupted');
    const code = await store.inspectLiveConversation('code-chat'), review = await store.inspectLiveConversation('review-chat');
    assert.equal(code.cursor.sequence, beforeCode.cursor.sequence + 2, 'startup occurrence expiry then original interrupted recovery'); assert.equal(review.cursor.sequence, beforeReview.cursor.sequence + 1);
    assert.equal(code.events.at(-1).type, 'run.interrupted'); assert.equal(review.events.at(-1).type, 'review.interrupted');
    assert.equal(code.turns[0].source.pending, null); assert.equal(code.turns[0].runId, beforeCode.turns[0].runId);
    await assert.rejects(store.respond('uncertain', { id: 'saved-dialog', confirmed: true }), { status: 409 });
    await store.close(); store = await openStore(options);
    assert.deepEqual(await store.inspectLiveConversation('code-chat'), code);
    assert.deepEqual(await store.inspectLiveConversation('review-chat'), review);
    assert.equal(coding, 1); assert.equal(reviews, 1);
  } finally { await store.close(); }
}));

test('B03b: live reopen refuses untracked source changes and corrupt old event evidence rather than fabricating resets', () => fixture(async f => {
  let store = await openStore({ ...f.options, runner: async () => 'done' });
  await store.submit('saved', 'saved', 'chat'); await wait(() => store.get('saved'), j => j.status === 'done');
  const live = await store.inspectLiveConversation('chat'); await store.close();
  await journal(f.directory, async (_, root) => root.commit(async tx => { (await tx.doc(Jobs)).items.saved.answer = 'untracked'; }, ctx));
  await assert.rejects(openStore(f.options), /projection conflicts/);
  await journal(f.directory, async (_, root) => root.commit(async tx => {
    (await tx.doc(Jobs)).items.saved.answer = 'done';
    (await tx.doc(ProjectionEvents, key('chat', 1), null)).generation = 'foreign';
  }, ctx));
  await assert.rejects(openStore(f.options), /projection conflicts/);
  await journal(f.directory, async (_, root) => root.commit(async tx => {
    Object.assign(await tx.doc(ProjectionEvents, key('chat', 1), null), live.events[0]);
  }, ctx));
  store = await openStore(f.options); try { assert.deepEqual(await store.inspectLiveConversation('chat'), live); } finally { await store.close(); }
}));

test('B03b: two project projections retain exact ownership, reads create no binding, mismatched retry cannot cross projects', () => fixture(async f => {
  const second = join(f.base, 'second'); await mkdir(second);
  await git(second, 'init', '-b', 'trunk'); await git(second, 'config', 'user.name', 'Fixture'); await git(second, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(join(second, 'base.txt'), 'second'); await git(second, 'add', '.'); await git(second, 'commit', '-m', 'fixture');
  const store = await openStore({ ...f.options, runner: async input => { await writeFile(join(input.cwd, 'effect.txt'), input.id); return input.id; } });
  try {
    const a = (await store.listProjects())[0];
    const b = await store.registerProject({ source: second, name: 'Second', branchPolicy: { kind: 'local', branch: 'trunk' } });
    await Promise.all([store.submit('project-a', 'A', 'chat-a', a.projectId), store.submit('project-b', 'B', 'chat-b', b.projectId)]);
    await wait(() => store.get('project-a'), j => j.status === 'done'); await wait(() => store.get('project-b'), j => j.status === 'done');
    const ca = await store.inspectLiveConversation('chat-a'), cb = await store.inspectLiveConversation('chat-b');
    assert.equal(ca.projectId, a.projectId); assert.equal(cb.projectId, b.projectId);
    assert(ca.events.every(e => e.projectId === a.projectId)); assert(cb.events.every(e => e.projectId === b.projectId));
    assert.equal(ca.turns[0].source.workspace.repositoryRoot, f.cwd); assert.equal(cb.turns[0].source.workspace.repositoryRoot, second);
    await assert.rejects(store.submit('project-a', 'A', 'chat-a', b.projectId), { status: 409 });
    assert.deepEqual(await store.inspectLiveConversation('chat-a'), ca); assert.deepEqual(await store.inspectLiveConversation('chat-b'), cb);
    assert.equal(await store.inspectLiveConversation('unknown'), null); assert.equal(await store.getSessionProject('unknown'), null);
  } finally { await store.close(); }
}));
