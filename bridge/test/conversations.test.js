import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { Harness, createRegistry, defineDoc, defineTask, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { openStore } from '../src/store.js';
import { openWorkspaces } from '../src/workspaces.js';
import { Owner, ConversationBaselines, TurnBaselines, initializeConversations } from '../src/conversations.js';
import { validateProject, registerProject } from '../src/projects.js';
import { makeServer } from '../src/server.js';

const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args])).stdout.trim();
const Jobs = defineDoc({ kind: 'pocket.jobs', version: 1, scope: 'session', initial: () => ({ items: {} }) });
const Reviews = defineDoc({ kind: 'pocket.reviews', version: 1, scope: 'session', initial: () => ({ items: {} }) });
const Projects = defineDoc({ kind: 'pocket.projects', version: 1, scope: 'session', initial: () => ({ items: {} }) });
const Bindings = defineDoc({ kind: 'pocket.bindings', version: 1, scope: 'session', initial: () => ({ items: {}, defaultProjectId: null, migrated: false }) });
async function oldJournal(directory, write, registry = createRegistry()) {
  await mkdir(directory, { recursive: true });
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'assistant.sqlite')),
    { registry, models: createModels() }, ctx);
  try { await write(harness, await harness.root(ctx)); }
  finally { await harness.close(ctx); }
}
async function wait(read, predicate) {
  for (let i = 0; i < 1200; i++) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Conversation migration fixture timed out');
}
async function fixture(fn) {
  const base = await mkdtemp(join(tmpdir(), 'mobile-conversations-'));
  const source = join(base, 'source'), directory = join(base, 'state');
  try {
    await mkdir(source);
    await git(source, 'init', '-b', 'trunk');
    await git(source, 'config', 'user.name', 'Conversation migration fixture');
    await git(source, 'config', 'user.email', 'fixture@example.invalid');
    await writeFile(join(source, 'file.txt'), 'base\n');
    await git(source, 'add', '.'); await git(source, 'commit', '-m', 'fixture');
    const options = { directory, cwd: source, defaultBranch: 'trunk', runner: async () => { throw new Error('No baseline dispatch expected'); } };
    await fn({ base, source, directory, options });
  } finally { await rm(base, { recursive: true, force: true }); }
}

test('B02: backend legacy baseline preserves opaque chat/run/message identity and marked deterministic order across two reopens', () => fixture(async f => {
  const spaces = await openWorkspaces(f.options);
  const workspace = await spaces.forSession('legacy-chat');
  const only = await spaces.forSession('binding-only');
  await writeFile(join(workspace.cwd, 'file.txt'), 'dirty legacy\n');
  const manifest = await readFile(workspace.path + '.json', 'utf8');
  const sourceHead = await git(f.source, 'rev-parse', 'HEAD');
  const treeHead = await git(workspace.path, 'rev-parse', 'HEAD');
  const trees = await git(f.source, 'worktree', 'list', '--porcelain');
  await mkdir(join(f.directory, 'pi-sessions'), { recursive: true });
  const piPath = join(f.directory, 'pi-sessions', 'fixture-session.jsonl');
  await writeFile(piPath, 'synthetic Pi history; must not be rewritten\n');
  const saved = [
    { id: 'z-first-in-source', sessionId: 'legacy-chat', text: 'Z', answer: 'Z answer', status: 'done', createdAt: 100, taskId: 17, workspace },
    { id: 'a-second-in-source', sessionId: 'legacy-chat', text: 'A', answer: 'A answer', status: 'done', createdAt: 100, taskId: 19, workspace },
    { id: 'missing-date', text: 'legacy pocket', status: 'interrupted' }
  ];
  const review = { id: 'saved-review', sessionId: 'legacy-chat', status: 'done', createdAt: 101,
    input: { action: 'test', revision: 'a'.repeat(64), command: 'printf fixture' }, result: { message: 'saved test result' } };
  await oldJournal(f.directory, async (_, root) => root.commit(async tx => {
    const jobs = await tx.doc(Jobs); for (const job of saved) jobs.items[job.id] = job;
    (await tx.doc(Reviews)).items[review.id] = review;
    await tx.appendEntry(root.id, { kind: 'pocket.input', data: { requestId: saved[0].id, text: 'Z' } });
    await tx.appendEntry(root.id, { kind: 'pocket.result', data: { requestId: saved[0].id, status: 'done', answer: 'Z answer' } });
  }, ctx));
  let store = await openStore(f.options);
  try {
    const identity = await store.getOwnerIdentity();
    assert.match(identity.ownerId, /^[0-9a-f-]{36}$/);
    assert.equal(identity.baselineVersion, 1);
    const baseline = await store.getConversationBaseline('legacy-chat');
    assert.equal(baseline.baselineOnly, true);
    assert.equal(baseline.conversationId, 'legacy-chat');
    assert.equal(baseline.ownerId, identity.ownerId);
    assert.deepEqual(baseline.ordering, { kind: 'reconstructed', by: 'createdAt-then-id', missingDates: 'last' });
    assert.deepEqual(baseline.turns.map(t => [t.runId, t.ordinal]), [['a-second-in-source', 1], ['z-first-in-source', 2]]);
    assert.deepEqual(baseline.turns[0].messages, [
      { id: '["a-second-in-source","user"]', role: 'user', text: 'A' },
      { id: '["a-second-in-source","assistant"]', role: 'assistant', text: 'A answer' }
    ]);
    const detached = await store.getConversationBaseline('legacy-chat');
    detached.turns[0].messages[0].text = 'client-side mutation';
    assert.deepEqual(await store.getConversationBaseline('legacy-chat'), baseline);
    assert.equal(baseline.turns[1].source.taskId, 17);
    assert.deepEqual(baseline.turns[1].source.workspace, workspace);
    assert.deepEqual(baseline.reviews[0].source.input, review.input);
    assert.equal(baseline.cursor.sequence, 0, 'baseline invents no prior event sequence');
    assert.equal(baseline.cursor.ownerId, identity.ownerId);
    assert.equal(baseline.cursor.conversationId, 'legacy-chat');
    assert.match(baseline.cursor.generation, /^[0-9a-f-]{36}$/);
    const bindingOnly = await store.getConversationBaseline('binding-only');
    assert.deepEqual(bindingOnly.turns, []); assert.deepEqual(bindingOnly.reviews, []);
    assert.equal(bindingOnly.projectId, baseline.projectId);
    const pocket = await store.getConversationBaseline('pocket');
    assert.equal(pocket.turns[0].createdAt, null);
    assert.equal(pocket.turns[0].source.sessionId, undefined, 'legacy omission stays intact');
    assert.equal(await store.getConversationBaseline('unknown-chat'), null);
    assert.equal(await store.getSessionProject('unknown-chat'), null);
    for (let i = 0; i < 2; i++) {
      await store.close(); store = await openStore(f.options);
      assert.deepEqual(await store.getOwnerIdentity(), identity);
      assert.deepEqual(await store.getConversationBaseline('legacy-chat'), baseline);
      assert.deepEqual(await store.getConversationBaseline('binding-only'), bindingOnly);
      assert.deepEqual(await store.getConversationBaseline('pocket'), pocket);
    }
    assert.equal(await readFile(workspace.path + '.json', 'utf8'), manifest);
    assert.equal(await readFile(join(workspace.cwd, 'file.txt'), 'utf8'), 'dirty legacy\n');
    assert.equal(await readFile(piPath, 'utf8'), 'synthetic Pi history; must not be rewritten\n');
    assert.equal((await spaces.existing('binding-only')).path, only.path);
    assert.equal(await git(f.source, 'rev-parse', 'HEAD'), sourceHead);
    assert.equal(await git(workspace.path, 'rev-parse', 'HEAD'), treeHead);
    assert.equal(await git(f.source, 'worktree', 'list', '--porcelain'), trees);
  } finally { await store.close(); }
}));

test('B02: conflicting partial evidence rolls the whole startup back before resume and a corrected retry is safe', () => fixture(async f => {
  const saved = [
    { id: 'safe-job', sessionId: 'a-safe', text: 'keep safe', status: 'done', createdAt: 1 },
    { id: 'conflict-job', sessionId: 'z-conflict', text: 'keep conflict', status: 'done', createdAt: 2 }
  ];
  await oldJournal(f.directory, async (_, root) => root.commit(async tx => {
    const jobs = await tx.doc(Jobs); for (const job of saved) jobs.items[job.id] = job;
    Object.assign(await tx.doc(ConversationBaselines, 'z-conflict', null), { conversationId: 'foreign-evidence' });
  }, ctx));
  await assert.rejects(openStore(f.options), /Conversation baseline conflicts/);
  await oldJournal(f.directory, async (harness, root) => {
    assert.equal(await harness.snapshot(Owner, ctx), undefined);
    assert.equal(await harness.snapshot(ConversationBaselines, 'a-safe', ctx), undefined);
    assert.equal(await harness.snapshot(TurnBaselines, '["a-safe","safe-job"]', ctx), undefined);
    assert.deepEqual((await harness.snapshot(Jobs, ctx)).items, Object.fromEntries(saved.map(job => [job.id, job])));
    assert.deepEqual(await harness.snapshot(ConversationBaselines, 'z-conflict', ctx), { conversationId: 'foreign-evidence' });
    await root.commit(tx => tx.retireDoc(ConversationBaselines, 'z-conflict'), ctx);
  });
  const store = await openStore(f.options);
  try {
    assert.deepEqual((await store.getConversationBaseline('a-safe')).turns.map(t => t.runId), ['safe-job']);
    assert.deepEqual((await store.getConversationBaseline('z-conflict')).turns.map(t => t.runId), ['conflict-job']);
  } finally { await store.close(); }
}));

test('B02: persisted baseline corruption is rejected instead of repairing message identity or chronology', () => fixture(async f => {
  await oldJournal(f.directory, async (_, root) => root.commit(async tx => {
    (await tx.doc(Jobs)).items['baseline-job'] = { id: 'baseline-job', sessionId: 'chat', text: 'keep', answer: 'saved', status: 'done' };
  }, ctx));
  let store = await openStore(f.options);
  const before = await store.getConversationBaseline('chat');
  const owner = await store.getOwnerIdentity();
  await store.close();
  await oldJournal(f.directory, async (_, root) => root.commit(async tx => {
    const turn = await tx.doc(TurnBaselines, '["chat","baseline-job"]', null);
    turn.messages[0].id = 'wrong-message';
    turn.ordinal = 99;
  }, ctx));
  await assert.rejects(async () => { const unexpected = await openStore(f.options); await unexpected.close(); }, /Conversation baseline conflicts/);
  await oldJournal(f.directory, async (harness, root) => {
    assert.equal((await harness.snapshot(Owner, ctx)).ownerId, owner.ownerId);
    const corrupted = await harness.snapshot(TurnBaselines, '["chat","baseline-job"]', ctx);
    assert.equal(corrupted.messages[0].id, 'wrong-message', 'failure must not auto-repair conflict evidence');
    await root.commit(async tx => { Object.assign(await tx.doc(TurnBaselines, '["chat","baseline-job"]', null), before.turns[0]); }, ctx);
  });
  store = await openStore(f.options);
  try { assert.deepEqual(await store.getConversationBaseline('chat'), before); }
  finally { await store.close(); }
}));

test('B02: undispatched legacy task is captured queued, resumes once, and keeps original task input and old entries', () => fixture(async f => {
  const Command = defineTask({ name: 'pocket.command', version: 1, initial: () => ({ phase: 'execute' }), phases: { execute: async () => {} } });
  const registry = createRegistry(); registry.install(defineExtension({ name: 'pocket', tasks: [Command] }));
  let taskId, originalInput, originalEntries;
  await oldJournal(f.directory, async (_, root) => {
    await root.commit(async tx => {
      taskId = await tx.createTask(Command, { id: 'queued-old', text: 'execute once' }, { ownership: { kind: 'conversation' } });
      (await tx.doc(Jobs)).items['queued-old'] = { id: 'queued-old', text: 'execute once', taskId, status: 'queued' };
      await tx.appendEntry(root.id, { kind: 'pocket.input', data: { requestId: 'queued-old', text: 'execute once' } });
    }, ctx);
    originalInput = await root.commit(async tx => (await tx.task(taskId)).input, ctx);
    originalEntries = await root.commit(async tx => (await tx.scanEntries({ conversationId: root.id }, 100)).items, ctx);
  }, registry);
  const calls = [];
  const options = { ...f.options, runner: async input => {
    calls.push(input.id);
    await writeFile(join(input.cwd, 'dispatch.txt'), 'one undispatched execution\n');
    return 'completed once';
  } };
  let store = await openStore(options);
  let baseline, identity, done;
  try {
    baseline = await store.getConversationBaseline('pocket');
    assert.equal(baseline.turns[0].source.status, 'queued');
    assert.equal(baseline.turns[0].source.taskId, taskId);
    done = await wait(() => store.get('queued-old'), j => j.status === 'done');
    assert.equal(done.taskId, taskId);
    assert.deepEqual(calls, ['queued-old']);
    identity = await store.getOwnerIdentity();
    for (let i = 0; i < 2; i++) {
      await store.close(); store = await openStore(options);
      assert.deepEqual(await store.getOwnerIdentity(), identity);
      assert.deepEqual(await store.getConversationBaseline('pocket'), baseline, 'B02 snapshot remains explicitly historical, not live status');
      assert.deepEqual(await store.get('queued-old'), done);
    }
    assert.deepEqual(calls, ['queued-old']);
    assert.equal(await readFile(join(done.workspace.cwd, 'dispatch.txt'), 'utf8'), 'one undispatched execution\n');
  } finally { await store.close(); }
  await oldJournal(f.directory, async (_, root) => {
    assert.deepEqual(await root.commit(async tx => (await tx.task(taskId)).input, ctx), originalInput);
    const entries = await root.commit(async tx => (await tx.scanEntries({ conversationId: root.id }, 100)).items, ctx);
    for (const entry of originalEntries) assert.deepEqual(entries.find(e => e.id === entry.id), entry);
    assert.equal(entries.filter(e => e.kind === 'pocket.result').length, 1);
    const tasks = await root.commit(tx => tx.scanTasks({}, 100), ctx);
    assert.equal(tasks.items.length, 1, 'baseline creates no task or executing conversation');
  }, registry);
}));

test('B02: previously dispatched coding/dialog and review tasks are captured before resume, then interrupted without replay', () => fixture(async f => {
  const blocked = async (task, runtime, doc, pending) => {
    await runtime.memo('dispatched', true, ctx);
    await runtime.commit(async tx => {
      const record = (await tx.doc(doc)).items[task.input.id];
      record.status = 'running';
      if (pending) record.pending = { type: 'extension_ui_request', id: 'dialog', method: 'confirm', title: 'Saved pending dialog' };
    }, ctx);
    await new Promise((_, reject) => {
      if (runtime.signal.aborted) reject(runtime.signal.reason);
      else runtime.signal.addEventListener('abort', () => reject(runtime.signal.reason), { once: true });
    });
  };
  const Command = defineTask({ name: 'pocket.command', version: 1, initial: () => ({ phase: 'execute' }),
    phases: { execute: (task, runtime) => blocked(task, runtime, Jobs, true) } });
  const Review = defineTask({ name: 'pocket.review', version: 1, initial: () => ({ phase: 'execute' }),
    phases: { execute: (task, runtime) => blocked(task, runtime, Reviews, false) } });
  const registry = createRegistry(); registry.install(defineExtension({ name: 'pocket', tasks: [Command, Review] }));
  let commandId, reviewId, oldInputs;
  await oldJournal(f.directory, async (harness, root) => {
    await root.commit(async tx => {
      commandId = await tx.createTask(Command, { id: 'dispatched-code', text: 'do not repeat', sessionId: 'code-chat' }, { ownership: { kind: 'conversation' } });
      reviewId = await tx.createTask(Review, { id: 'dispatched-review', sessionId: 'review-chat', input: { action: 'test', command: 'never replay', revision: 'a'.repeat(64) } }, { ownership: { kind: 'conversation' } });
      (await tx.doc(Jobs)).items['dispatched-code'] = { id: 'dispatched-code', text: 'do not repeat', sessionId: 'code-chat', taskId: commandId, status: 'queued' };
      (await tx.doc(Reviews)).items['dispatched-review'] = { id: 'dispatched-review', sessionId: 'review-chat', taskId: reviewId, status: 'queued', input: { action: 'test', command: 'never replay', revision: 'a'.repeat(64) } };
    }, ctx);
    oldInputs = await root.commit(async tx => [(await tx.task(commandId)).input, (await tx.task(reviewId)).input], ctx);
    harness.resume();
    await wait(() => harness.snapshot(Jobs, ctx), doc => doc.items['dispatched-code'].pending);
    await wait(() => harness.snapshot(Reviews, ctx), doc => doc.items['dispatched-review'].status === 'running');
  }, registry);
  let calls = 0;
  const options = { ...f.options, runner: async () => { calls++; throw new Error('must not replay'); },
    reviewActions: { execute: async () => { calls++; throw new Error('must not replay review'); } } };
  let store = await openStore(options);
  try {
    const code = await store.getConversationBaseline('code-chat');
    const review = await store.getConversationBaseline('review-chat');
    assert.equal(code.turns[0].source.status, 'running');
    assert.equal(code.turns[0].source.pending.id, 'dialog', 'retained as historical source only, never current approval');
    assert.equal(review.reviews[0].source.status, 'running');
    const interrupted = await wait(() => store.get('dispatched-code'), j => j.status === 'interrupted');
    const action = await wait(() => store.getReview('review-chat', 'dispatched-review'), a => a.status === 'interrupted');
    assert.equal(interrupted.taskId, commandId); assert.equal(interrupted.pending, null);
    assert.equal(action.taskId, reviewId);
    await assert.rejects(store.respond('dispatched-code', { id: 'dialog', confirmed: true }), { status: 409 });
    for (let i = 0; i < 2; i++) {
      await store.close(); store = await openStore(options);
      assert.deepEqual(await store.getConversationBaseline('code-chat'), code);
      assert.deepEqual(await store.getConversationBaseline('review-chat'), review);
      assert.deepEqual(await store.get('dispatched-code'), interrupted);
      assert.deepEqual(await store.getReview('review-chat', 'dispatched-review'), action);
    }
    assert.equal(calls, 0);
  } finally { await store.close(); }
  await oldJournal(f.directory, async (_, root) => {
    assert.deepEqual(await root.commit(async tx => [(await tx.task(commandId)).input, (await tx.task(reviewId)).input], ctx), oldInputs);
  }, registry);
}));

test('B02: a failure after preparing the migration marker atomically discards owner, projection and binding writes', () => fixture(async f => {
  const candidate = await validateProject({ source: f.source, name: 'Fixture default', branchPolicy: { kind: 'local', branch: 'trunk' } }, f.directory);
  let failedOwner;
  await oldJournal(f.directory, async (harness, root) => {
    const prepare = async tx => {
      const projects = await tx.doc(Projects), bindings = await tx.doc(Bindings);
      const jobs = await tx.doc(Jobs), reviews = await tx.doc(Reviews);
      const project = registerProject(projects, candidate);
      bindings.items.chat = { projectId: project.projectId };
      bindings.defaultProjectId = project.projectId; bindings.migrated = true;
      jobs.items['atomic-job'] = { id: 'atomic-job', text: 'keep', sessionId: 'chat', projectId: project.projectId, status: 'done' };
      await initializeConversations(tx, { projects, bindings, jobs, reviews });
    };
    await assert.rejects(root.commit(async tx => {
      await prepare(tx);
      failedOwner = (await tx.doc(Owner)).ownerId;
      throw new Error('fixture failure after marker');
    }, ctx), /fixture failure after marker/);
    assert.match(failedOwner, /^[0-9a-f-]{36}$/);
    for (const token of [Owner, Projects, Bindings, Jobs, Reviews]) assert.equal(await harness.snapshot(token, ctx), undefined);
    assert.equal(await harness.snapshot(ConversationBaselines, 'chat', ctx), undefined);
    assert.equal(await harness.snapshot(TurnBaselines, '["chat","atomic-job"]', ctx), undefined);
    await root.commit(prepare, ctx);
  });
  const store = await openStore(f.options);
  try {
    assert.notEqual((await store.getOwnerIdentity()).ownerId, failedOwner);
    assert.deepEqual((await store.getConversationBaseline('chat')).turns.map(t => t.runId), ['atomic-job']);
  } finally { await store.close(); }
}));

test('B02: owner identity is journal-specific, B05 exposes it only authenticated, and new writes do not masquerade as the captured baseline', () => fixture(async f => {
  const first = await openStore({ ...f.options, runner: async () => 'new write after baseline' });
  let server;
  try {
    const identity = await first.getOwnerIdentity();
    const second = await openStore({ ...f.options, directory: join(f.base, 'other-state') });
    try { assert.notEqual((await second.getOwnerIdentity()).ownerId, identity.ownerId); }
    finally { await second.close(); }
    await assert.rejects(openStore(f.options), /Storage locked/);
    await assert.rejects(first.getConversationBaseline('../invalid'), { status: 400 });
    assert.equal(await first.getConversationBaseline('new-chat'), null);
    await first.submit('post-baseline', 'hello', 'new-chat');
    await wait(() => first.get('post-baseline'), j => j.status === 'done');
    assert.equal(await first.getConversationBaseline('new-chat'), null, 'B03 must explicitly cover B02-era writes before live attachment');
    assert.equal((await first.getSessionProject('new-chat')).sessionId, 'new-chat');
    const token = 'synthetic-b02-health-token'.repeat(3);
    server = makeServer(first, token, () => {});
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = 'http://127.0.0.1:' + server.address().port;
    const headers = { Authorization: 'Bearer ' + token };
    const health = await (await fetch(url + '/health', { headers })).json();
    assert.equal(health.protocolVersion, 6); assert.equal(health.projectBindings, true);
    assert.equal(health.ownerId, identity.ownerId);
    assert.equal(health.conversationCore, true);
    assert.equal((await fetch(url + '/v1/conversations', { headers })).status, 426);
    assert.equal((await fetch(url + '/health')).status, 401);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await first.close();
  }
  const reopened = await openStore(f.options);
  try { assert.equal(await reopened.getConversationBaseline('new-chat'), null); }
  finally { await reopened.close(); }
}));

test('B02: malformed legacy identity/status/date and partial owner markers fail closed without leaving a projection', () => fixture(async f => {
  const good = { id: 'old-job', text: 'saved', sessionId: 'chat', status: 'done', createdAt: 12 };
  for (const change of [{ id: 'wrong-key' }, { status: 'invented-success' }, { createdAt: 'not-a-time' }]) {
    await oldJournal(f.directory, async (_, root) => root.commit(async tx => {
      (await tx.doc(Jobs)).items['old-job'] = { ...good, ...change };
    }, ctx));
    await assert.rejects(openStore(f.options), /Conversation baseline conflicts/);
    await oldJournal(f.directory, async harness => {
      assert.equal(await harness.snapshot(Owner, ctx), undefined);
      assert.equal(await harness.snapshot(ConversationBaselines, 'chat', ctx), undefined);
    });
  }
  await oldJournal(f.directory, async (_, root) => root.commit(async tx => {
    (await tx.doc(Jobs)).items['old-job'] = good;
    Object.assign(await tx.doc(Owner), { ownerId: 'do-not-regenerate-partial-owner', baselineVersion: 0 });
  }, ctx));
  await assert.rejects(openStore(f.options), /Conversation baseline conflicts/);
  await oldJournal(f.directory, async (harness, root) => {
    assert.equal((await harness.snapshot(Owner, ctx)).ownerId, 'do-not-regenerate-partial-owner');
    await root.commit(tx => tx.retireDoc(Owner), ctx);
  });
  const store = await openStore(f.options);
  try { assert.equal((await store.getConversationBaseline('chat')).turns[0].runId, 'old-job'); }
  finally { await store.close(); }
}));

test('B02: pre-existing multi-project bindings retain their exact project IDs without preparing any checkout', () => fixture(async f => {
  const other = join(f.base, 'other-source');
  await git(f.base, 'clone', '--no-hardlinks', f.source, other);
  const candidates = await Promise.all([f.source, other].map(source => validateProject({ source, name: 'Fixture project', branchPolicy: { kind: 'local', branch: 'trunk' } }, f.directory)));
  let pa, pb;
  await oldJournal(f.directory, async (_, root) => root.commit(async tx => {
    const projects = await tx.doc(Projects), bindings = await tx.doc(Bindings), jobs = await tx.doc(Jobs);
    pa = registerProject(projects, candidates[0]); pb = registerProject(projects, candidates[1]);
    bindings.defaultProjectId = pa.projectId; bindings.migrated = true;
    bindings.items['chat-a'] = { projectId: pa.projectId };
    bindings.items['chat-b'] = { projectId: pb.projectId };
    bindings.items['only-b'] = { projectId: pb.projectId };
    jobs.items['project-job-a'] = { id: 'project-job-a', sessionId: 'chat-a', projectId: pa.projectId, text: 'A', answer: 'A result', status: 'done', createdAt: 10 };
    jobs.items['project-job-b'] = { id: 'project-job-b', sessionId: 'chat-b', projectId: pb.projectId, text: 'B', answer: 'B result', status: 'done', createdAt: 10 };
  }, ctx));
  const before = await Promise.all([f.source, other].map(source => git(source, 'worktree', 'list', '--porcelain')));
  let store = await openStore(f.options);
  try {
    const a = await store.getConversationBaseline('chat-a'), b = await store.getConversationBaseline('chat-b');
    assert.notEqual(pa.projectId, pb.projectId);
    assert.equal(a.projectId, pa.projectId); assert.equal(b.projectId, pb.projectId);
    assert.equal(b.turns[0].runId, 'project-job-b');
    assert.equal(b.turns[0].messages[1].text, 'B result');
    const only = await store.getConversationBaseline('only-b');
    assert.equal(only.projectId, pb.projectId); assert.deepEqual(only.turns, []);
    await store.close(); store = await openStore(f.options);
    assert.deepEqual(await store.getConversationBaseline('chat-a'), a);
    assert.deepEqual(await store.getConversationBaseline('chat-b'), b);
    assert.deepEqual(await store.getConversationBaseline('only-b'), only);
    assert.deepEqual(await Promise.all([f.source, other].map(source => git(source, 'worktree', 'list', '--porcelain'))), before);
  } finally { await store.close(); }
}));

test('B02: incomplete manifest-only preparation is captured without recreating a worktree', () => fixture(async f => {
  const spaces = await openWorkspaces(f.options);
  const workspace = await spaces.forSession('preparing-chat');
  await git(f.source, 'worktree', 'remove', workspace.path);
  const record = JSON.parse(await readFile(workspace.path + '.json', 'utf8'));
  record.state = 'preparing';
  const manifest = JSON.stringify(record);
  await writeFile(workspace.path + '.json', manifest);
  const before = await git(f.source, 'worktree', 'list', '--porcelain');
  const store = await openStore(f.options);
  try {
    const baseline = await store.getConversationBaseline('preparing-chat');
    assert.equal(baseline.projectId, (await store.getSessionProject('preparing-chat')).projectId);
    assert.deepEqual(baseline.turns, []);
    assert.equal(await git(f.source, 'worktree', 'list', '--porcelain'), before);
    assert.equal(await readFile(workspace.path + '.json', 'utf8'), manifest);
    await assert.rejects(readFile(join(workspace.path, 'file.txt')), { code: 'ENOENT' });
  } finally { await store.close(); }
}));
