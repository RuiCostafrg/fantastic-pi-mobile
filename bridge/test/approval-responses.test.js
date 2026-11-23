import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { Harness, createRegistry, defineDoc } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { ApprovalResponses, claimApproval } from '../src/approval-responses.js';
import { inspectApprovalEvidence } from '../src/approval-lifecycle.js';
const Jobs = defineDoc({ kind: 'pocket.jobs', version: 1, scope: 'session', initial: () => ({ items: {} }) });
const Bindings = defineDoc({ kind: 'pocket.bindings', version: 1, scope: 'session', initial: () => ({ items: {} }) });
async function journal(directory, fn) {
  const h = await Harness.open(await openNodeSqliteStorage(join(directory, 'assistant.sqlite')), { registry: createRegistry(), models: createModels() }, ctx);
  try { return await fn(h, await h.root(ctx)); } finally { await h.close(ctx); }
}
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args])).stdout.trim();
const raw = { type: 'extension_ui_request', method: 'confirm', id: 'dialog', title: 'Continue?' };
const wait = async (read, predicate) => {
  for (let i = 0; i < 500; i++) { const x = await read(); if (predicate(x)) return x; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('response fixture timed out');
};
async function fixture(fn) {
  const base = await mkdtemp(join(tmpdir(), 'approval-responses-')), cwd = join(base, 'source'), directory = join(base, 'journal');
  await mkdir(cwd); await git(cwd, 'init', '-b', 'trunk'); await git(cwd, 'config', 'user.name', 'Fixture'); await git(cwd, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(join(cwd, 'base.txt'), 'base'); await git(cwd, 'add', '.'); await git(cwd, 'commit', '-m', 'fixture');
  await writeFile(join(cwd, 'keep.txt'), 'keep'); await git(cwd, 'add', 'keep.txt');
  const before = [await git(cwd, 'rev-parse', 'HEAD'), await git(cwd, 'diff', '--cached')];
  const options = { directory, cwd, defaultBranch: 'trunk' };
  const inputs = new Map(), replies = [];
  let deliver = reply => { replies.push(reply); };
  const runner = async input => {
    inputs.set(input.id, input); input.clients.set(input.id, reply => deliver(reply));
    return new Promise((resolve, reject) => {
      input.finish = resolve;
      input.signal.addEventListener('abort', () => { input.clients.delete(input.id); reject(input.signal.reason); }, { once: true });
    });
  };
  let store = await openStore({ ...options, runner });
  const f = { get store() { return store; }, replies, inputs,
    deliver: fn => { deliver = fn; },
    async open(id = 'run', chat = 'chat') {
      await store.submit(id, 'hello', chat); const input = await wait(async () => inputs.get(id), Boolean);
      await input.onEvent(raw); return this.target(id);
    },
    async target(id = 'run') {
      const e = await store.inspectApprovalEvidence(id);
      return { ownerId: e.ownerId, conversationId: e.conversationId, projectId: e.projectId, runId: id, approvalId: e.currentOccurrenceId };
    },
    async reopen(offline) { await store.close(); if (offline) await offline(options); store = await openStore({ ...options, runner }); },
    async done(id = 'run') { inputs.get(id).finish('done'); await wait(() => store.get(id), j => j.status === 'done'); }
  };
  try { await fn(f); assert.deepEqual([await git(cwd, 'rev-parse', 'HEAD'), await git(cwd, 'diff', '--cached')], before); }
  finally { await store.close(); await rm(base, { recursive: true, force: true }); }
}

test('B04b: first exact answer wins; same response ID returns its durable receipt without replay', () => fixture(async f => {
  const target = await f.open();
  const request = { ...target, responseId: 'answer-one', answer: { confirmed: true } };
  const results = await Promise.allSettled([
    f.store.answerApproval(request),
    f.store.answerApproval({ ...request, responseId: 'answer-two', answer: { confirmed: false } })
  ]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(results.filter(x => x.status === 'rejected' && x.reason.status === 409).length, 1);
  assert.deepEqual(f.replies, [{ type: 'extension_ui_response', id: raw.id, confirmed: true }]);
  const receipt = results[0].value; assert.equal(receipt.delivery, 'attempted');
  assert.deepEqual(await f.store.answerApproval(request), receipt);
  await assert.rejects(f.store.answerApproval({ ...request, answer: { confirmed: false } }), e => e.status === 409);
  assert.equal(f.replies.length, 1);
  await f.done(); await f.reopen();
  assert.deepEqual(await f.store.answerApproval(request), receipt); assert.equal(f.replies.length, 1);
}));

test('B04b: stale, crossed and reused raw dialogs fail closed; exact fresh occurrence still works', () => fixture(async f => {
  const first = await f.open();
  for (const key of ['ownerId', 'conversationId', 'projectId', 'approvalId']) {
    await assert.rejects(f.store.answerApproval({ ...first, [key]: 'foreign', responseId: 'wrong-target', answer: { confirmed: true } }), e => e.status === 409);
  }
  await assert.rejects(f.store.answerApproval({ ...first, responseId: 'invalid', answer: { value: 'yes' } }), e => e.status === 400);
  await f.inputs.get('run').onEvent(raw); const second = await f.target();
  await assert.rejects(f.store.answerApproval({ ...first, responseId: 'stale', answer: { confirmed: true } }), e => e.status === 409);
  await assert.rejects(f.store.respond('run', { id: raw.id, confirmed: true }), e => e.status === 409);
  assert.equal(f.replies.length, 0);
  await f.store.answerApproval({ ...second, responseId: 'fresh', answer: { confirmed: false } });
  assert.equal(f.replies.length, 1); assert.equal(f.replies[0].confirmed, false);
}));

test('B04b: legacy UI uses the same first-answer claim; select/input/editor/cancel normalize strictly', () => fixture(async f => {
  await f.open();
  const results = await Promise.allSettled([
    f.store.respond('run', { id: raw.id, confirmed: false }),
    f.store.respond('run', { id: raw.id, confirmed: true })
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.replies.length, 1);
  for (const method of ['select', 'input', 'editor']) {
    await f.inputs.get('run').onEvent({ ...raw, id: method, method, options: ['allowed'] });
    const target = await f.target();
    if (method === 'select') await assert.rejects(f.store.answerApproval({ ...target, responseId: method, answer: { value: 'not allowed' } }), e => e.status === 400);
    await f.store.respond('run', { id: method, value: 'allowed' });
    assert.equal(f.replies.at(-1).value, 'allowed');
  }
  await f.inputs.get('run').onEvent({ ...raw, id: 'cancel-dialog' });
  await f.store.respond('run', { id: 'cancel-dialog', cancelled: true });
  assert.equal(f.replies.at(-1).cancelled, true);
}));

test('B04b: Stop wins before answer, rejects replacement frames, and does not affect another run', () => fixture(async f => {
  const target = await f.open(); await f.open('other-run', 'other-chat');
  await assert.rejects(f.store.stopRun({ ...target, projectId: 'foreign' }), e => e.status === 409);
  await f.store.stopRun(target);
  await assert.rejects(f.store.answerApproval({ ...target, responseId: 'late', answer: { confirmed: true } }), e => e.status === 409);
  await f.inputs.get('run').onEvent(raw);
  const job = await wait(() => f.store.get('run'), j => j.status === 'cancelled');
  assert.equal(job.pending, null); assert.equal(f.replies.length, 0);
  assert.ok((await f.store.get('other-run')).pending);
  assert.equal((await f.store.inspectApprovalEvidence('run')).currentOccurrenceId, null);
  await f.store.stopRun(target); // Terminal Stop is harmless, not a new task/answer.
  assert.ok((await f.store.get('other-run')).pending);
}));

test('B04b: answer wins before Stop; queued replacement and Stop cannot overtake its pipe attempt', () => fixture(async f => {
  const target = await f.open(); let release, entered = false;
  f.deliver(reply => { f.replies.push(reply); entered = true; return new Promise(resolve => { release = resolve; }); });
  const answer = f.store.answerApproval({ ...target, responseId: 'before-stop', answer: { confirmed: true } });
  await wait(async () => entered, Boolean);
  const replacement = f.inputs.get('run').onEvent({ ...raw, id: 'next-dialog' });
  const stop = f.store.stopRun(target);
  await new Promise(r => setTimeout(r, 30)); assert.equal(f.replies.length, 1);
  assert.equal((await f.store.inspectApprovalEvidence('run')).currentOccurrenceId, null);
  release(); assert.equal((await answer).delivery, 'attempted'); await replacement; await stop;
  await wait(() => f.store.get('run'), j => j.status === 'cancelled');
  assert.equal((await f.store.inspectApprovalEvidence('run')).currentOccurrenceId, null);
  assert.equal(f.replies.length, 1);
}));

for (const afterWrite of [false, true]) test('B04b: uncertain ' + (afterWrite ? 'post-write' : 'pre-write') + ' failure is durable and never replayed after restart', () => fixture(async f => {
  const target = await f.open();
  f.deliver(reply => { if (afterWrite) f.replies.push(reply); throw new Error('uncertain transport'); });
  const request = { ...target, responseId: 'uncertain', answer: { confirmed: false } };
  const receipt = await f.store.answerApproval(request); assert.equal(receipt.delivery, 'unknown');
  assert.deepEqual(await f.store.answerApproval(request), receipt);
  assert.equal(f.replies.length, afterWrite ? 1 : 0);
  await f.reopen(); await wait(() => f.store.get('run'), j => j.status === 'interrupted');
  assert.deepEqual(await f.store.answerApproval(request), receipt);
  assert.equal(f.replies.length, afterWrite ? 1 : 0);
  await assert.rejects(f.store.answerApproval({ ...request, responseId: 'try-again' }), e => e.status === 409);
}));

test('B04b: restart invalidates an unanswered approval; missing sender cannot acquire a claim', () => fixture(async f => {
  const target = await f.open(); const input = f.inputs.get('run'); input.clients.delete('run');
  const request = { ...target, responseId: 'no-sender', answer: { confirmed: true } };
  await assert.rejects(f.store.answerApproval(request), e => e.status === 409);
  assert.equal((await f.store.inspectApprovalEvidence('run')).currentOccurrenceId, target.approvalId);
  await f.reopen(); await wait(() => f.store.get('run'), j => j.status === 'interrupted');
  await assert.rejects(f.store.answerApproval(request), e => e.status === 409); assert.equal(f.replies.length, 0);
}));

test('B04b: fault after prepared claim rolls back receipt, occurrence expiry, Job and projection together', () => fixture(async f => {
  const target = await f.open();
  await f.reopen(async options => {
    await journal(options.directory, async (h, root) => {
      const before = await h.snapshot(Jobs, ctx);
      const responses = await h.snapshot(ApprovalResponses, ctx);
      await assert.rejects(root.commit(async tx => {
        await claimApproval(tx, await tx.doc(Bindings), await tx.doc(Jobs),
          { ...target, responseId: 'rolled-back', answer: { confirmed: true } }, () => {});
        throw new Error('after prepared claim');
      }, ctx), /after prepared claim/);
      assert.deepEqual(await h.snapshot(Jobs, ctx), before);
      assert.deepEqual(await h.snapshot(ApprovalResponses, ctx), responses);
      const evidence = await root.commit(async tx => inspectApprovalEvidence(tx, await tx.doc(Bindings), await tx.doc(Jobs), 'run'), ctx);
      assert.equal(evidence.currentOccurrenceId, target.approvalId);
      assert.equal(evidence.occurrences[0].state, 'observed');
      assert.equal(evidence.occurrences[0].responseId, undefined);
    });
  });
  assert.equal(f.replies.length, 0);
}));

test('B04b: corrupt or missing durable receipt refuses startup before dispatch; corrected evidence reopens', () => fixture(async f => {
  const target = await f.open();
  const receipt = await f.store.answerApproval({ ...target, responseId: 'persisted', answer: { confirmed: true } });
  await f.done();
  await f.reopen(async options => {
    for (const corrupt of [doc => { delete doc.items.persisted; }, doc => { doc.items.persisted.projectId = 'foreign'; }, doc => { doc.items.persisted.delivery = 'delivered-exactly-once'; }]) {
      const saved = await journal(options.directory, async (h, root) => {
        const saved = await h.snapshot(ApprovalResponses, ctx);
        await root.commit(async tx => corrupt(await tx.doc(ApprovalResponses)), ctx); return saved;
      });
      let dispatches = 0;
      await assert.rejects(openStore({ ...options, runner: async () => { dispatches++; } }), /evidence conflicts/);
      assert.equal(dispatches, 0);
      await journal(options.directory, async (_, root) => root.commit(async tx => {
        const document = await tx.doc(ApprovalResponses); for (const key of Object.keys(document)) delete document[key]; Object.assign(document, saved);
      }, ctx));
    }
  });
  assert.deepEqual(await f.store.answerApproval({ ...target, responseId: 'persisted', answer: { confirmed: true } }), receipt);
  assert.equal(f.replies.length, 1);
}));
