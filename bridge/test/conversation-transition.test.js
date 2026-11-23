import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { Harness, createRegistry, defineDoc } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { openStore as openLiveStore } from '../src/store.js';
import { runPi } from '../src/rpc.js';
import { Owner, ConversationBaselines, initializeConversations } from '../src/conversations.js';
import { validateProject, registerProject } from '../src/projects.js';
import { ProjectionState, ConversationProjections, ProjectionSnapshots, ProjectionRecords, ProjectionEvents,
  stageConversations } from '../src/conversation-projection.js';

// Retain B03a historical-only fixtures explicitly; production defaults to live promotion.
const openStore = options => openLiveStore({ ...options, initializeProjection: stageConversations });
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args])).stdout.trim();
const doc = (kind, initial) => defineDoc({ kind, version: 1, scope: 'session', initial });
const Projects = doc('pocket.projects', () => ({ items: {} }));
const Bindings = doc('pocket.bindings', () => ({ items: {}, defaultProjectId: null, migrated: false }));
const Jobs = doc('pocket.jobs', () => ({ items: {} }));
const Reviews = doc('pocket.reviews', () => ({ items: {} }));
async function journal(directory, fn) {
  await mkdir(directory, { recursive: true });
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'assistant.sqlite')),
    { registry: createRegistry(), models: createModels() }, ctx);
  try { await fn(harness, await harness.root(ctx)); }
  finally { await harness.close(ctx); }
}
async function wait(read, predicate) {
  for (let i = 0; i < 1200; i++) {
    const value = await read(); if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Conversation transition timed out');
}
async function fixture(fn) {
  const base = await mkdtemp(join(tmpdir(), 'mobile-transition-'));
  const source = join(base, 'source'), directory = join(base, 'state');
  try {
    await mkdir(source);
    await git(source, 'init', '-b', 'trunk');
    await git(source, 'config', 'user.name', 'Transition fixture');
    await git(source, 'config', 'user.email', 'fixture@example.invalid');
    await writeFile(join(source, 'file.txt'), 'base\n');
    await git(source, 'add', '.'); await git(source, 'commit', '-m', 'fixture base');
    const candidate = await validateProject({ source, name: 'Fixture project', branchPolicy: { kind: 'local', branch: 'trunk' } }, directory);
    let projectId;
    await journal(directory, async (_, root) => root.commit(async tx => {
      const projects = await tx.doc(Projects), bindings = await tx.doc(Bindings);
      const jobs = await tx.doc(Jobs), reviews = await tx.doc(Reviews);
      projectId = registerProject(projects, candidate).projectId;
      bindings.items.legacy = { projectId }; bindings.defaultProjectId = projectId; bindings.migrated = true;
      jobs.items['old-no-date'] = { id: 'old-no-date', sessionId: 'legacy', projectId, text: 'old', answer: 'old result', status: 'done', taskId: 41 };
      await tx.appendEntry(root.id, { kind: 'pocket.result', data: { requestId: 'old-no-date', status: 'done', answer: 'old result' } });
      // A real B02 journal baseline, deliberately captured before later writes.
      await initializeConversations(tx, { projects, bindings, jobs, reviews });
    }, ctx));
    const options = { directory, cwd: source, defaultBranch: 'trunk', runner: async () => { throw new Error('No migration dispatch permitted'); } };
    await fn({ base, source, directory, projectId, options });
  } finally { await rm(base, { recursive: true, force: true }); }
}

test('B03a: post-B02 turns/results/reviews and binding-only chats stage once without changing baseline IDs, ordinals or generation', () => fixture(async f => {
  await journal(f.directory, async (_, root) => root.commit(async tx => {
    const jobs = await tx.doc(Jobs);
    jobs.items['z-extra'] = { id: 'z-extra', sessionId: 'legacy', projectId: f.projectId, text: 'Z', answer: 'Z result', status: 'done', createdAt: 100 };
    jobs.items['a-extra'] = { id: 'a-extra', sessionId: 'legacy', projectId: f.projectId, text: 'A', answer: 'A result', status: 'done', createdAt: 100 };
    (await tx.doc(Reviews)).items['saved-review'] = { id: 'saved-review', sessionId: 'legacy', projectId: f.projectId, status: 'done',
      input: { action: 'test', revision: 'a'.repeat(64), command: 'printf fixture' }, result: { message: 'saved result' } };
    (await tx.doc(Bindings)).items['binding-only'] = { projectId: f.projectId };
  }, ctx));
  let store = await openStore(f.options);
  try {
    const baseline = await store.getConversationBaseline('legacy');
    const stage = await store.getStagedConversation('legacy');
    assert.equal(stage.stagedOnly, true); assert.equal(stage.liveWrites, false);
    assert.equal(stage.approvalEvidence, 'historical-only');
    assert.equal(stage.ownerId, baseline.ownerId);
    assert.equal(stage.cursor.generation, baseline.cursor.generation);
    assert.equal(stage.projectId, f.projectId);
    assert.deepEqual(stage.turns.map(t => [t.runId, t.ordinal]), [['old-no-date', 1], ['a-extra', 2], ['z-extra', 3]],
      'existing ordinals precede extras even when saved dates are missing');
    assert.deepEqual(stage.turns[0].messages, baseline.turns[0].messages);
    assert.equal(stage.reviews[0].operationId, 'saved-review');
    assert.equal(stage.reviews[0].source.result.message, 'saved result');
    assert.equal(stage.cursor.sequence, 1);
    assert.equal(stage.reset.type, 'snapshot.reset');
    assert.equal(stage.reset.requiresSnapshot, true);
    assert.equal(stage.reset.reason, 'initial-stage');
    const bindingOnly = await store.getStagedConversation('binding-only');
    assert.deepEqual(bindingOnly.turns, []); assert.deepEqual(bindingOnly.reviews, []);
    assert.equal(await store.getConversationBaseline('binding-only'), null);
    assert.equal(await store.getStagedConversation('unknown'), null);
    for (let i = 0; i < 2; i++) {
      await store.close(); store = await openStore(f.options);
      assert.deepEqual(await store.getStagedConversation('legacy'), stage);
      assert.deepEqual(await store.getStagedConversation('binding-only'), bindingOnly);
      assert.deepEqual(await store.getConversationBaseline('legacy'), baseline);
    }
  } finally { await store.close(); }
}));

test('B03a: unobserved state changes create one explicit reset, retain old snapshots, and never reorder existing turns', () => fixture(async f => {
  let store = await openStore(f.options);
  const first = await store.getStagedConversation('legacy');
  const baseline = await store.getConversationBaseline('legacy');
  await store.close();
  await journal(f.directory, async (_, root) => root.commit(async tx => {
    const jobs = await tx.doc(Jobs);
    jobs.items['old-no-date'].answer = 'updated result';
    jobs.items['new-earlier-time'] = { id: 'new-earlier-time', sessionId: 'legacy', projectId: f.projectId, text: 'new', answer: '',
      status: 'running', createdAt: 0, pending: { id: 'dialog', method: 'confirm' } };
  }, ctx));
  store = await openStore(f.options);
  let second;
  try {
    second = await store.getStagedConversation('legacy');
    assert.equal(second.cursor.sequence, 2);
    assert.equal(second.cursor.generation, first.cursor.generation);
    assert.equal(second.reset.reason, 'unobserved-changes');
    assert.deepEqual(second.turns.map(t => [t.runId, t.ordinal]), [['old-no-date', 1], ['new-earlier-time', 2]]);
    assert.equal(second.turns[0].messages[1].id, first.turns[0].messages[1].id);
    assert.equal(second.turns[0].messages[1].text, 'updated result');
    assert.equal(second.turns[1].source.pending.id, 'dialog');
    assert.equal(second.approvalEvidence, 'historical-only');
    assert.deepEqual(await store.getStagedConversation('legacy', 1), first);
    assert.deepEqual(await store.getConversationBaseline('legacy'), baseline);
    await assert.rejects(store.getStagedConversation('legacy', 3), { status: 409 });
    await assert.rejects(store.getStagedConversation('legacy', 0), { status: 400 });
    await assert.rejects(store.getStagedConversation('../legacy'), { status: 400 });
  } finally { await store.close(); }
  await journal(f.directory, async (_, root) => root.commit(async tx => {
    const row = (await tx.doc(Jobs)).items['old-no-date'];
    const text = row.text; delete row.text; row.text = text; // Key insertion order is not a state change.
  }, ctx));
  store = await openStore(f.options);
  try { assert.deepEqual(await store.getStagedConversation('legacy'), second); }
  finally { await store.close(); }
  await journal(f.directory, async harness => {
    assert.equal((await harness.snapshot(ProjectionEvents, '["legacy",1]', ctx)).type, 'snapshot.reset');
    assert.equal((await harness.snapshot(ProjectionEvents, '["legacy",2]', ctx)).type, 'snapshot.reset');
    assert.equal(await harness.snapshot(ProjectionEvents, '["legacy",3]', ctx), undefined);
  });
}));

test('B03a: callback failure after preparing reset/revisions rolls back source, pointer, snapshot and event together', () => fixture(async f => {
  let store = await openStore(f.options);
  const first = await store.getStagedConversation('legacy');
  const source = await store.get('old-no-date');
  await store.close();
  await journal(f.directory, async (harness, root) => {
    const prepare = async tx => {
      const projects = await tx.doc(Projects), bindings = await tx.doc(Bindings);
      const jobs = await tx.doc(Jobs), reviews = await tx.doc(Reviews);
      jobs.items['old-no-date'].answer = 'new revision';
      await initializeConversations(tx, { projects, bindings, jobs, reviews });
      await stageConversations(tx, { projects, bindings, jobs, reviews });
    };
    await assert.rejects(root.commit(async tx => { await prepare(tx); throw new Error('fixture reset commit failure'); }, ctx), /fixture reset commit failure/);
    assert.deepEqual((await harness.snapshot(Jobs, ctx)).items['old-no-date'], source);
    assert.equal((await harness.snapshot(ConversationProjections, 'legacy', ctx)).sequence, 1);
    for (const token of [ProjectionSnapshots, ProjectionEvents]) assert.equal(await harness.snapshot(token, '["legacy",2]', ctx), undefined);
    assert.equal(await harness.snapshot(ProjectionRecords, '["legacy","turn","old-no-date",2]', ctx), undefined);
    await root.commit(prepare, ctx);
  });
  store = await openStore(f.options);
  try {
    assert.deepEqual(await store.getStagedConversation('legacy', 1), first);
    const second = await store.getStagedConversation('legacy');
    assert.equal(second.cursor.sequence, 2); assert.equal(second.turns[0].messages[1].text, 'new revision');
  } finally { await store.close(); }
}));

test('B03a: a later chat conflict rolls back the entire staged transition and a corrected retry preserves owner/baseline evidence', () => fixture(async f => {
  await journal(f.directory, async (_, root) => root.commit(async tx => {
    (await tx.doc(Bindings)).items['z-new'] = { projectId: f.projectId };
    Object.assign(await tx.doc(ConversationProjections, 'z-new', null), { ownerId: 'foreign-evidence' });
  }, ctx));
  await assert.rejects(openStore(f.options), /Conversation projection conflicts/);
  await journal(f.directory, async (harness, root) => {
    assert.equal(await harness.snapshot(ProjectionState, ctx), undefined);
    assert.equal(await harness.snapshot(ConversationProjections, 'legacy', ctx), undefined);
    assert.equal(await harness.snapshot(ProjectionSnapshots, '["legacy",1]', ctx), undefined);
    assert.equal(await harness.snapshot(ProjectionEvents, '["legacy",1]', ctx), undefined);
    assert.equal(await harness.snapshot(ProjectionRecords, '["legacy","turn","old-no-date",1]', ctx), undefined);
    assert.deepEqual(await harness.snapshot(ConversationProjections, 'z-new', ctx), { ownerId: 'foreign-evidence' });
    await root.commit(tx => tx.retireDoc(ConversationProjections, 'z-new'), ctx);
  });
  const store = await openStore(f.options);
  try {
    const baseline = await store.getConversationBaseline('legacy'), stage = await store.getStagedConversation('legacy');
    assert.equal(stage.ownerId, baseline.ownerId); assert.equal(stage.cursor.generation, baseline.cursor.generation);
    assert.equal(stage.cursor.sequence, 1); assert.equal((await store.getStagedConversation('z-new')).cursor.sequence, 1);
  } finally { await store.close(); }
}));

test('B03a: retained snapshot inspection rejects a missing old immutable revision instead of silently returning a partial transcript', () => fixture(async f => {
  let store = await openStore(f.options);
  const first = await store.getStagedConversation('legacy');
  await store.close();
  await journal(f.directory, async (_, root) => root.commit(async tx => {
    (await tx.doc(Jobs)).items['old-no-date'].answer = 'second body';
  }, ctx));
  store = await openStore(f.options); await store.close();
  await journal(f.directory, async (_, root) => root.commit(tx => tx.retireDoc(ProjectionRecords, '["legacy","turn","old-no-date",1]'), ctx));
  store = await openStore(f.options);
  try {
    assert.equal((await store.getStagedConversation('legacy')).turns[0].messages[1].text, 'second body');
    await assert.rejects(store.getStagedConversation('legacy', 1), /Conversation projection conflicts/);
  } finally { await store.close(); }
  await journal(f.directory, async (_, root) => root.commit(async tx => {
    Object.assign(await tx.doc(ProjectionRecords, '["legacy","turn","old-no-date",1]', null), first.turns[0]);
  }, ctx));
  store = await openStore(f.options);
  try { assert.deepEqual(await store.getStagedConversation('legacy', 1), first); }
  finally { await store.close(); }
}));

test('B03a: interrupted RPC recovery is staged explicitly on next reopen with no replay or live approval claim', () => fixture(async f => {
  const marker = join(f.base, 'dispatches.txt');
  const peer = resolve('test/fake-pi.js');
  const options = { ...f.options, runner: async input => {
    await appendFile(marker, input.id + '\n');
    return runPi({ ...input, bin: process.execPath, args: [peer] });
  } };
  const sourceHead = await git(f.source, 'rev-parse', 'HEAD');
  await writeFile(join(f.source, 'file.txt'), 'unrelated staged data\n'); await git(f.source, 'add', 'file.txt');
  const index = await git(f.source, 'diff', '--cached', '--binary');
  let store = await openStore(options);
  let pending;
  try {
    await store.submit('transition-pending', 'confirm', 'pending-chat');
    pending = await wait(() => store.get('transition-pending'), job => job.pending);
    assert.equal(await store.getStagedConversation('pending-chat'), null, 'no B03b live write instrumentation yet');
    await writeFile(join(pending.workspace.cwd, 'uncertain.txt'), 'preserved uncertain effect\n');
  } finally { await store.close(); }
  const manifest = await readFile(pending.workspace.path + '.json', 'utf8');
  store = await openStore(options);
  let first, interrupted;
  try {
    first = await store.getStagedConversation('pending-chat');
    assert.equal(first.turns[0].source.status, 'running');
    assert.equal(first.turns[0].source.pending.id, 'dialog');
    assert.equal(first.stagedOnly, true); assert.equal(first.approvalEvidence, 'historical-only');
    interrupted = await wait(() => store.get('transition-pending'), job => job.status === 'interrupted');
    assert.equal(interrupted.pending, null); assert.equal(interrupted.taskId, pending.taskId);
    await assert.rejects(store.respond(interrupted.id, { id: 'dialog', confirmed: true }), { status: 409 });
  } finally { await store.close(); }
  store = await openStore(options);
  try {
    const recovered = await store.getStagedConversation('pending-chat');
    assert.equal(recovered.cursor.sequence, 2); assert.equal(recovered.reset.reason, 'unobserved-changes');
    assert.equal(recovered.cursor.generation, first.cursor.generation);
    assert.equal(recovered.turns[0].source.status, 'interrupted'); assert.equal(recovered.turns[0].source.pending, null);
    assert.deepEqual(await store.getStagedConversation('pending-chat', 1), first);
    assert.deepEqual(await store.get(interrupted.id), interrupted);
    const detached = await store.getStagedConversation('pending-chat'); detached.turns[0].messages[0].text = 'local mutation';
    assert.deepEqual(await store.getStagedConversation('pending-chat'), recovered);
    await store.close(); store = await openStore(options);
    assert.deepEqual(await store.getStagedConversation('pending-chat'), recovered);
    assert.equal(await readFile(marker, 'utf8'), 'transition-pending\n');
    assert.equal(await readFile(pending.workspace.path + '.json', 'utf8'), manifest);
    assert.equal(await readFile(join(pending.workspace.cwd, 'uncertain.txt'), 'utf8'), 'preserved uncertain effect\n');
    assert.equal(await git(f.source, 'rev-parse', 'HEAD'), sourceHead);
    assert.equal(await git(f.source, 'diff', '--cached', '--binary'), index);
  } finally { await store.close(); }
}));

test('B03a: initial staging failure also rolls back first-time B02 baseline and legacy project migration', () => fixture(async f => {
  const directory = join(f.base, 'unmigrated-state');
  await journal(directory, async (_, root) => root.commit(async tx => {
    (await tx.doc(Jobs)).items['unmigrated-job'] = { id: 'unmigrated-job', text: 'preserve', status: 'done' };
    Object.assign(await tx.doc(ConversationProjections, 'pocket', null), { conversationId: 'foreign-evidence' });
  }, ctx));
  await assert.rejects(openStore({ ...f.options, directory }), /Conversation projection conflicts/);
  await journal(directory, async (harness, root) => {
    assert.equal(await harness.snapshot(Owner, ctx), undefined);
    assert.equal(await harness.snapshot(Projects, ctx), undefined);
    assert.equal(await harness.snapshot(Bindings, ctx), undefined);
    assert.equal(await harness.snapshot(ConversationBaselines, 'pocket', ctx), undefined);
    assert.equal(await harness.snapshot(ProjectionState, ctx), undefined);
    assert.deepEqual((await harness.snapshot(Jobs, ctx)).items['unmigrated-job'], { id: 'unmigrated-job', text: 'preserve', status: 'done' });
    await root.commit(tx => tx.retireDoc(ConversationProjections, 'pocket'), ctx);
  });
  const store = await openStore({ ...f.options, directory });
  try {
    const baseline = await store.getConversationBaseline('pocket'), staged = await store.getStagedConversation('pocket');
    assert.equal(staged.cursor.generation, baseline.cursor.generation);
    assert.equal(staged.turns[0].runId, 'unmigrated-job');
    assert.equal(staged.turns[0].source.sessionId, undefined);
  } finally { await store.close(); }
}));

test('B03a: wrong reset schema/generation or changed accepted post-baseline input fails closed without inventing a reset', () => fixture(async f => {
  await journal(f.directory, async (_, root) => root.commit(async tx => {
    (await tx.doc(Jobs)).items['late-job'] = { id: 'late-job', sessionId: 'legacy', projectId: f.projectId, text: 'accepted input', answer: 'result', status: 'done' };
  }, ctx));
  let store = await openStore(f.options);
  const first = await store.getStagedConversation('legacy');
  await store.close();
  for (const change of [{ schemaVersion: 999 }, { generation: 'foreign-generation' }]) {
    await journal(f.directory, async (_, root) => root.commit(async tx => {
      Object.assign(await tx.doc(ProjectionEvents, '["legacy",1]', null), change);
    }, ctx));
    await assert.rejects(openStore(f.options), /Conversation projection conflicts/);
    await journal(f.directory, async (harness, root) => {
      assert.equal(await harness.snapshot(ProjectionEvents, '["legacy",2]', ctx), undefined);
      await root.commit(async tx => { Object.assign(await tx.doc(ProjectionEvents, '["legacy",1]', null), first.reset); }, ctx);
    });
  }
  await journal(f.directory, async (_, root) => root.commit(async tx => {
    (await tx.doc(Jobs)).items['late-job'].text = 'changed accepted input';
  }, ctx));
  await assert.rejects(openStore(f.options), /Conversation projection conflicts/);
  await journal(f.directory, async (harness, root) => {
    assert.equal((await harness.snapshot(Jobs, ctx)).items['late-job'].text, 'changed accepted input', 'failure cannot silently repair evidence');
    assert.equal(await harness.snapshot(ProjectionEvents, '["legacy",2]', ctx), undefined);
    await root.commit(async tx => { (await tx.doc(Jobs)).items['late-job'].text = 'accepted input'; }, ctx);
  });
  store = await openStore(f.options);
  try { assert.deepEqual(await store.getStagedConversation('legacy'), first); }
  finally { await store.close(); }
}));
