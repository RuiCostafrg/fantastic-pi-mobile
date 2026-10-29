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
import { ApprovalIndex, ApprovalRuns, ApprovalOccurrences, initializeApprovals, transitionApproval } from '../src/approval-lifecycle.js';
import { Owner } from '../src/conversations.js';
import { initializeLiveConversations, projectMutation, LiveRecords } from '../src/conversation-live.js';
import { ProjectionEvents, stageConversations } from '../src/conversation-projection.js';
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args])).stdout.trim();
const doc = kind => defineDoc({ kind, version: 1, scope: 'session', initial: () => ({ items: {} }) });
const Jobs = doc('pocket.jobs'), Bindings = doc('pocket.bindings');
const key = (...args) => JSON.stringify(args);
const raw = { type: 'extension_ui_request', method: 'select', id: 'repeat', title: 'Choose', options: ['one', 'two'], extra: { android: true } };
const wait = async (read, predicate) => {
  for (let i = 0; i < 1000; i++) { const x = await read(); if (predicate(x)) return x; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('approval fixture timed out');
};
async function journal(directory, fn) {
  const h = await Harness.open(await openNodeSqliteStorage(join(directory, 'assistant.sqlite')), { registry: createRegistry(), models: createModels() }, ctx);
  try { return await fn(h, await h.root(ctx)); } finally { await h.close(ctx); }
}
async function fixture(fn) {
  const base = await mkdtemp(join(tmpdir(), 'mobile-approvals-')), cwd = join(base, 'source'), directory = join(base, 'journal');
  await mkdir(cwd); await git(cwd, 'init', '-b', 'trunk'); await git(cwd, 'config', 'user.name', 'Fixture'); await git(cwd, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(join(cwd, 'base.txt'), 'base'); await git(cwd, 'add', '.'); await git(cwd, 'commit', '-m', 'fixture');
  await writeFile(join(cwd, 'staged.txt'), 'preserve'); await git(cwd, 'add', 'staged.txt');
  const before = [await git(cwd, 'rev-parse', 'HEAD'), await git(cwd, 'diff', '--cached')];
  try { await fn({ directory, options: { directory, cwd, defaultBranch: 'trunk' } });
    assert.deepEqual([await git(cwd, 'rev-parse', 'HEAD'), await git(cwd, 'diff', '--cached')], before);
  } finally { await rm(base, { recursive: true, force: true }); }
}
async function live(f, initializeProjection) {
  let send, finish;
  const replies = [];
  const store = await openStore({ ...f.options, initializeProjection, runner: async input => {
    send = input.onEvent; input.clients.set(input.id, reply => replies.push(reply));
    return new Promise((resolve, reject) => { finish = resolve;
      input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true });
    });
  } });
  await store.submit('run', 'hello', 'chat'); await wait(async () => send, Boolean);
  return { store, send: event => send(event), finish: answer => finish(answer), replies };
}

test('B04a: repeated identical raw questions are distinct scoped observations; detached inspector and non-question dedup remain', () => fixture(async f => {
  const { store, send, finish } = await live(f);
  try {
    assert.equal(await store.inspectApprovalEvidence('unknown'), null);
    await send(raw); const first = await store.inspectApprovalEvidence('run');
    const seq = (await store.inspectLiveConversation('chat')).cursor.sequence;
    await send(raw); const second = await store.inspectApprovalEvidence('run');
    assert.notEqual(first.currentOccurrenceId, second.currentOccurrenceId);
    assert.equal((await store.inspectLiveConversation('chat')).cursor.sequence, seq + 1);
    assert.equal(second.actionable, false); assert.equal(second.internalOnly, true);
    assert.equal(second.occurrences[0].reason, 'replacement'); assert.deepEqual(second.occurrences[1].observation.raw, raw);
    assert.equal(second.conversationId, 'chat'); assert.equal(second.runId, 'run');
    assert.equal(second.projectId, (await store.get('run')).projectId);
    assert.equal(second.ownerId, (await store.getOwnerIdentity()).ownerId);
    assert.deepEqual((await store.get('run')).pending, raw);
    second.occurrences[1].observation.raw.options.push('mutated');
    assert.deepEqual((await store.inspectApprovalEvidence('run')).occurrences[1].observation.raw, raw);
    await send({ type: 'tool_execution_start', toolName: 'read' });
    const cleared = await store.inspectApprovalEvidence('run'); assert.equal(cleared.currentOccurrenceId, null);
    assert.equal(cleared.occurrences[1].reason, 'pending-clear');
    const before = await store.inspectLiveConversation('chat');
    await send({ type: 'tool_execution_start', toolName: 'read' }); assert.deepEqual(await store.inspectLiveConversation('chat'), before);
    await send({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'partial' }] } });
    const result = await store.inspectLiveConversation('chat');
    await send({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'partial' }] } });
    assert.deepEqual(await store.inspectLiveConversation('chat'), result);
    finish('done'); await wait(() => store.get('run'), j => j.status === 'done');
  } finally { await store.close(); }
}));

test('B04a: legacy reply, assistant result and completion expire observations without adding a new answer path', () => fixture(async f => {
  const { store, send, finish, replies } = await live(f);
  try {
    await send(raw); await store.respond('run', { id: raw.id, value: 'one' }); assert.equal(replies.length, 1);
    assert.equal((await store.inspectApprovalEvidence('run')).occurrences[0].reason, 'pending-clear');
    await send(raw); await send({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'partial' }] } });
    assert.equal((await store.inspectApprovalEvidence('run')).occurrences[1].reason, 'pending-clear');
    await send(raw); finish('done'); await wait(() => store.get('run'), j => j.status === 'done');
    const evidence = await store.inspectApprovalEvidence('run'); assert.equal(evidence.occurrences[2].reason, 'done');
    assert.equal(evidence.currentOccurrenceId, null);
  } finally { await store.close(); }
}));

test('B04a: failure and existing cancel expire pending in terminal transaction', () => fixture(async f => {
  let fail;
  const store = await openStore({ ...f.options, runner: async input => {
    await input.onEvent(raw);
    return new Promise((_, reject) => { fail = reject; input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true }); });
  } });
  try {
    await store.submit('failed-run', 'fail', 'chat'); await wait(() => store.get('failed-run'), j => j.pending); fail(new Error('fixture failure'));
    await wait(() => store.get('failed-run'), j => j.status === 'failed');
    assert.equal((await store.inspectApprovalEvidence('failed-run')).occurrences[0].reason, 'failed');
    await store.submit('cancel-run', 'cancel', 'chat'); await wait(() => store.get('cancel-run'), j => j.pending); await store.cancel('cancel-run');
    await wait(() => store.get('cancel-run'), j => j.status === 'cancelled');
    assert.equal((await store.inspectApprovalEvidence('cancel-run')).occurrences[0].reason, 'cancelled');
  } finally { await store.close(); }
}));

test('B04a: startup expires before resume, preserves raw history, rolls back interruption, reopens idempotently without replay', () => fixture(async f => {
  const { store, send } = await live(f); await send(raw); const observed = await store.inspectApprovalEvidence('run'); await store.close();
  let calls = 0;
  const options = { ...f.options, runner: async () => { calls++; throw new Error('must not replay'); } };
  await assert.rejects(openStore({ ...options, initializeProjection: async (tx, inventory) => {
    await initializeLiveConversations(tx, inventory); await initializeApprovals(tx, inventory);
    assert.equal(inventory.jobs.items.run.approvalOccurrenceId, null); assert.deepEqual(inventory.jobs.items.run.pending, raw);
    throw new Error('startup after prepared expiry');
  } }), /startup after prepared expiry/);
  await journal(f.directory, async h => {
    assert.equal((await h.snapshot(Jobs, ctx)).items.run.approvalOccurrenceId, observed.currentOccurrenceId);
    assert.equal((await h.snapshot(ApprovalOccurrences, observed.currentOccurrenceId, ctx)).state, 'observed');
  });
  let reopened = await openStore(options); await wait(() => reopened.get('run'), j => j.status === 'interrupted');
  const expired = await reopened.inspectApprovalEvidence('run'); assert.equal(expired.occurrences[0].reason, 'startup');
  assert.equal(expired.currentOccurrenceId, null); const projection = await reopened.inspectLiveConversation('chat'); await reopened.close();
  reopened = await openStore(options);
  try { assert.deepEqual(await reopened.inspectApprovalEvidence('run'), expired); assert.deepEqual(await reopened.inspectLiveConversation('chat'), projection); assert.equal(calls, 0); }
  finally { await reopened.close(); }
}));

test('B04a: pre-B04 staged raw pending is historical, never fabricated into an occurrence on first live migration', () => fixture(async f => {
  const { store, send } = await live(f, stageConversations); await send(raw); await store.close();
  let checked = false, calls = 0;
  const reopened = await openStore({ ...f.options, runner: async () => { calls++; }, initializeProjection: async (tx, inventory) => {
    await initializeLiveConversations(tx, inventory); await initializeApprovals(tx, inventory);
    assert.deepEqual(inventory.jobs.items.run.pending, raw); assert.equal(inventory.jobs.items.run.approvalOccurrenceId, undefined);
    assert.deepEqual((await tx.doc(ApprovalIndex)).runIds, []); checked = true;
  } });
  try { await wait(() => reopened.get('run'), j => j.status === 'interrupted'); const e = await reopened.inspectApprovalEvidence('run');
    assert.equal(e.actionable, false); assert.deepEqual(e.occurrences, []); assert.equal(checked, true); assert.equal(calls, 0);
  } finally { await reopened.close(); }
}));

test('B04a: prepared occurrence, pointer, revision and expiry all roll back together; occupied next identity is never overwritten', () => fixture(async f => {
  const { store, send } = await live(f); await send(raw); const original = await store.inspectApprovalEvidence('run'); await store.close();
  await journal(f.directory, async (h, root) => {
    const head = await h.snapshot(LiveRecords, key('chat', 'turn', 'run'), ctx);
    const mutate = async tx => {
      const job = (await tx.doc(Jobs)).items.run, bindings = await tx.doc(Bindings);
      await transitionApproval(tx, bindings, job, { pending: raw }); await projectMutation(tx, bindings, 'turn', job, 'run.pending');
    };
    await assert.rejects(root.commit(async tx => { await mutate(tx); throw new Error('after occurrence and projection'); }, ctx), /after occurrence/);
    assert.equal((await h.snapshot(Jobs, ctx)).items.run.approvalOccurrenceId, original.currentOccurrenceId);
    assert.equal((await h.snapshot(ApprovalOccurrences, original.currentOccurrenceId, ctx)).state, 'observed');
    assert.deepEqual(await h.snapshot(LiveRecords, key('chat', 'turn', 'run'), ctx), head);
    assert.equal(await h.snapshot(ProjectionEvents, key('chat', head.revision + 1), ctx), undefined);
    const nextId = key(original.ownerId, 'run', 2);
    assert.equal(await h.snapshot(ApprovalOccurrences, nextId, ctx), undefined);
    await root.commit(async tx => Object.assign(await tx.doc(ApprovalOccurrences, nextId, null), { occupied: true }), ctx);
    await assert.rejects(root.commit(mutate, ctx), /Approval lifecycle/);
    assert.deepEqual(await h.snapshot(ApprovalOccurrences, nextId, ctx), { occupied: true });
    assert.equal((await h.snapshot(ApprovalOccurrences, original.currentOccurrenceId, ctx)).state, 'observed');
  });
}));

test('B04a: corrupt owner/index/run/occurrence/pointer evidence fails closed and rolls back startup before any dispatch', () => fixture(async f => {
  const { store, send } = await live(f); await send(raw); const evidence = await store.inspectApprovalEvidence('run'); await store.close();
  const runId = key(evidence.ownerId, 'run');
  const cases = [
    [ApprovalIndex, null, x => { x.ownerId = 'foreign'; }],
    [ApprovalIndex, null, x => { x.runIds.push('run'); }],
    [ApprovalRuns, runId, x => { x.runId = 'other-run'; }],
    [ApprovalRuns, runId, x => { x.conversationId = 'other-chat'; }],
    [ApprovalRuns, runId, x => { x.projectId = 'other-project'; }],
    [ApprovalRuns, runId, x => { x.count = 0; }],
    [ApprovalRuns, runId, x => { x.current = null; }],
    [ApprovalOccurrences, evidence.currentOccurrenceId, x => { x.observation.ordinal = 0; }],
    [ApprovalOccurrences, evidence.currentOccurrenceId, x => { x.state = 'claimed'; }],
    [ApprovalOccurrences, evidence.currentOccurrenceId, x => { delete x.observation; }],
    [Jobs, null, x => { x.items.run.approvalOccurrenceId = 'foreign'; }],
    [Owner, null, x => { x.ownerId = 'foreign'; }]
  ];
  let calls = 0;
  for (const [token, address, corrupt] of cases) {
    const saved = await journal(f.directory, async (h, root) => {
      const saved = address === null ? await h.snapshot(token, ctx) : await h.snapshot(token, address, ctx);
      await root.commit(async tx => { corrupt(address === null ? await tx.doc(token) : await tx.doc(token, address, null)); }, ctx); return saved;
    });
    await assert.rejects(openStore({ ...f.options, runner: async () => { calls++; } }), /conflicts|incomplete/);
    await journal(f.directory, async (h, root) => {
      const item = await h.snapshot(ApprovalOccurrences, evidence.currentOccurrenceId, ctx);
      if (token !== ApprovalOccurrences) assert.equal(item.state, 'observed');
      await root.commit(async tx => {
        const target = address === null ? await tx.doc(token) : await tx.doc(token, address, null);
        for (const k of Object.keys(target)) delete target[k]; Object.assign(target, saved);
      }, ctx);
    });
  }
  assert.equal(calls, 0);
}));
