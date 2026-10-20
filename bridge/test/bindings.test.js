import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { Harness, createRegistry, defineDoc, defineTask, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { openStore } from '../src/store.js';
import { openWorkspaces } from '../src/workspaces.js';

const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args])).stdout.trim();
const Jobs = defineDoc({ kind: 'pocket.jobs', version: 1, scope: 'session', initial: () => ({ items: {} }) });
const Reviews = defineDoc({ kind: 'pocket.reviews', version: 1, scope: 'session', initial: () => ({ items: {} }) });
const Command = defineTask({ name: 'pocket.command', version: 1, initial: () => ({ phase: 'execute' }), phases: { execute: async () => {} } });
async function seed(directory, jobs, reviews = [], queued = false) {
  await mkdir(directory, { recursive: true });
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'pocket', tasks: [Command] }));
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'assistant.sqlite')), { registry, models: createModels() }, ctx);
  try {
    const root = await harness.root(ctx);
    await root.commit(async tx => {
      const document = await tx.doc(Jobs);
      for (const job of jobs) {
        if (queued) job.taskId = await tx.createTask(Command, { id: job.id, text: job.text, sessionId: job.sessionId }, { ownership: { kind: 'conversation' } });
        document.items[job.id] = job;
      }
      const actions = await tx.doc(Reviews);
      for (const action of reviews) actions.items[action.id] = action;
    }, ctx);
  } finally { await harness.close(ctx); }
}
function taskInputs(directory) {
  const db = new DatabaseSync(join(directory, 'assistant.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT record FROM tasks').all().map(row => JSON.parse(row.record).input); }
  finally { db.close(); }
}
async function repo(path) {
  await mkdir(path);
  await git(path, 'init', '-b', 'trunk');
  await git(path, 'config', 'user.email', 'test@example.invalid');
  await git(path, 'config', 'user.name', 'Test');
  await writeFile(join(path, 'file.txt'), 'original\n');
  await git(path, 'add', '.'); await git(path, 'commit', '-m', 'initial');
  return path;
}
const input = source => ({ source, name: 'Other', branchPolicy: { kind: 'local', branch: 'trunk' } });
async function fixture(fn) {
  const base = await mkdtemp(join(tmpdir(), 'mobile-bindings-'));
  const source = await repo(join(base, 'source'));
  const directory = join(base, 'state');
  const options = { directory, cwd: source, defaultBranch: 'trunk', runner: async () => 'done' };
  try { await fn({ base, source, directory, options }); }
  finally { await rm(base, { recursive: true, force: true }); }
}
async function wait(store, id, predicate = job => job.status === 'done') {
  for (let i = 0; i < 500; i++) {
    const job = await store.get(id);
    if (predicate(job)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for ' + id);
}

test('atomic bindings, exact-ID retry and active/idle conflicts survive restart', () => fixture(async f => {
  let calls = 0;
  const runner = ({ signal }) => { calls++; return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); };
  let store = await openStore({ ...f.options, runner });
  try {
    const project = (await store.listProjects())[0];
    const other = await store.registerProject(input(await repo(join(f.base, 'other'))));
    assert.equal(await store.getSessionProject('unbound'), null);
    await assert.rejects(store.submit('unknown', 'hi', 'unbound', 'unknown'), { status: 404 });
    await assert.rejects(store.submit('invalid', 'hi', 'unbound', null), { status: 400 });
    assert.equal(await store.getSessionProject('unbound'), null);
    const race = await Promise.allSettled([
      store.submit('request-a', 'hi', 'chat', project.projectId),
      store.submit('request-b', 'hi', 'chat', other.projectId)
    ]);
    assert.equal(race[0].status, 'fulfilled'); assert.equal(race[1].status, 'rejected');
    assert.equal(race[0].value.projectId, project.projectId);
    await wait(store, 'request-a', () => calls === 1);
    assert.equal(taskInputs(f.directory).find(input => input.id === 'request-a').projectId, project.projectId);
    assert.equal((await store.submit('request-a', 'hi', 'chat')).projectId, project.projectId);
    for (const [id, text, session, selected] of [
      ['request-a', 'hi', 'chat', other.projectId], ['request-a', 'changed', 'chat', project.projectId],
      ['request-a', 'hi', 'different', project.projectId], ['new-id', 'hi', 'chat', other.projectId]
    ]) await assert.rejects(store.submit(id, text, session, selected), { status: 409 });
    assert.equal(await store.getSessionProject('different'), null);
    await store.close(); store = await openStore({ ...f.options, runner });
    await wait(store, 'request-a', j => j.status === 'interrupted');
    assert.equal(calls, 1);
    assert.deepEqual(await store.getSessionProject('chat'), { sessionId: 'chat', projectId: project.projectId });
    await assert.rejects(store.submit('idle-conflict', 'hi', 'chat', other.projectId), { status: 409 });
    assert.equal((await store.submit('request-a', 'hi', 'chat')).projectId, project.projectId);
  } finally { await store.close(); }
}));

test('pre-resume migration maps saved jobs, review actions and manifest-only chats without changing workspaces', () => fixture(async f => {
  const spaces = await openWorkspaces(f.options);
  const workspace = await spaces.forSession('legacy');
  const orphan = await spaces.forSession('manifest-only');
  await writeFile(join(workspace.path, 'file.txt'), 'dirty legacy\n');
  const manifest = await readFile(workspace.path + '.json', 'utf8');
  await seed(f.directory, [{ id: 'old', text: 'hi', sessionId: 'legacy', status: 'done', workspace }], [
    { id: 'old-review', sessionId: 'legacy', status: 'done', input: { action: 'test' }, result: { message: 'saved' } }
  ]);
  let store = await openStore(f.options);
  let projectId;
  try {
    projectId = (await store.get('old')).projectId;
    assert.equal((await store.getReview('legacy', 'old-review')).projectId, projectId);
    assert.equal((await store.getSessionProject('manifest-only')).projectId, projectId);
    assert.equal((await store.submit('old', 'hi', 'legacy')).status, 'done');
    const next = await store.submit('next', 'hi', 'legacy');
    assert.equal(next.projectId, projectId);
    assert.equal((await wait(store, 'next')).workspace.path, workspace.path);
  } finally { await store.close(); }
  store = await openStore(f.options);
  try { assert.equal((await store.getSessionProject('legacy')).projectId, projectId); }
  finally { await store.close(); }
  assert.equal(await readFile(workspace.path + '.json', 'utf8'), manifest);
  assert.equal(await readFile(join(workspace.path, 'file.txt'), 'utf8'), 'dirty legacy\n');
  assert.equal((await spaces.existing('manifest-only')).path, orphan.path);
  const different = await repo(join(f.base, 'different'));
  await assert.rejects(openStore({ ...f.options, cwd: different }), /frozen project/);
  await git(f.source, 'branch', 'other');
  await assert.rejects(openStore({ ...f.options, defaultBranch: 'other' }), /frozen project/);
  store = await openStore(f.options); await store.close(); // failed opens release ownership
}));

test('legacy workspace metadata may omit only repositoryRoot when the exact manifest and real tree prove it', () => fixture(async f => {
  const spaces = await openWorkspaces(f.options);
  const workspace = await spaces.forSession('old-shape');
  const { repositoryRoot, ...legacyWorkspace } = workspace;
  await writeFile(join(workspace.path, 'file.txt'), 'preserved legacy dirty\n');
  const manifest = await readFile(workspace.path + '.json', 'utf8');
  const before = await git(f.source, 'status', '--porcelain');
  for (const key of ['cwd', 'path', 'branch', 'baseBranch', 'baseCommit']) {
    const incomplete = { ...legacyWorkspace }; delete incomplete[key];
    await seed(f.directory, [{ id: 'old-shape-job', text: 'hi', sessionId: 'old-shape', status: 'done', workspace: incomplete }]);
    await assert.rejects(openStore(f.options), /Legacy workspace evidence/);
  }
  for (const wrong of [null, f.base]) {
    await seed(f.directory, [{ id: 'old-shape-job', text: 'hi', sessionId: 'old-shape', status: 'done', workspace: { ...legacyWorkspace, repositoryRoot: wrong } }]);
    await assert.rejects(openStore(f.options), /Legacy workspace evidence/);
  }
  await seed(f.directory, [{ id: 'old-shape-job', text: 'hi', sessionId: 'old-shape', status: 'done', workspace: legacyWorkspace }]);
  let calls = 0;
  let store = await openStore({ ...f.options, runner: async () => { calls++; return 'must not replay'; } });
  try {
    const old = await store.get('old-shape-job');
    assert.ok(old.projectId);
    assert.deepEqual(old.workspace, legacyWorkspace, 'do not repair/rewrite historical metadata');
    assert.equal((await store.changes('old-shape')).workspace.repositoryRoot, f.source);
    assert.equal((await store.submit('old-shape-job', 'hi', 'old-shape')).status, 'done');
    assert.equal(calls, 0);
  } finally { await store.close(); }
  store = await openStore(f.options);
  try { assert.deepEqual((await store.get('old-shape-job')).workspace, legacyWorkspace); }
  finally { await store.close(); }
  assert.equal(await readFile(workspace.path + '.json', 'utf8'), manifest);
  assert.equal(await readFile(join(workspace.path, 'file.txt'), 'utf8'), 'preserved legacy dirty\n');
  assert.equal(await git(f.source, 'status', '--porcelain'), before);
}));

test('undispatched legacy task resolves migrated record and implicit pocket binding before preparation', () => fixture(async f => {
  await seed(f.directory, [{ id: 'queued-old', text: 'hi', status: 'queued' }], [], true);
  let calls = 0;
  const store = await openStore({ ...f.options, runner: async () => { calls++; return 'done'; } });
  try {
    const job = await wait(store, 'queued-old');
    assert.equal(job.projectId, (await store.getSessionProject('pocket')).projectId);
    assert.equal(job.workspace.repositoryRoot, f.source);
    assert.equal(calls, 1);
  } finally { await store.close(); }
}));

test('ambiguous historical evidence fails before resume and migration retry remains safe', () => fixture(async f => {
  const spaces = await openWorkspaces(f.options);
  const workspace = await spaces.forSession('legacy');
  const manifest = await readFile(workspace.path + '.json', 'utf8');
  await seed(f.directory, [{ id: 'legacy-job', text: 'hi', sessionId: 'legacy', status: 'done',
    workspace: { ...workspace, cwd: f.source } }]);
  await assert.rejects(openStore(f.options), /Legacy workspace evidence/);
  assert.equal(await readFile(workspace.path + '.json', 'utf8'), manifest);
  await seed(f.directory, [{ id: 'legacy-job', text: 'hi', sessionId: 'legacy', status: 'done', workspace }]);
  const store = await openStore(f.options);
  try { assert.ok((await store.get('legacy-job')).projectId); }
  finally { await store.close(); }
}));

test('historical manifests from another repository block bootstrap rather than rebind or run', () => fixture(async f => {
  const original = await openWorkspaces(f.options);
  const workspace = await original.forSession('historical');
  await writeFile(join(workspace.path, 'file.txt'), 'preserve me\n');
  const different = await repo(join(f.base, 'different'));
  let calls = 0;
  await assert.rejects(openStore({ ...f.options, cwd: different, runner: async () => { calls++; } }), /Legacy workspace evidence/);
  assert.equal(calls, 0);
  assert.equal(await readFile(join(workspace.path, 'file.txt'), 'utf8'), 'preserve me\n');
  const store = await openStore(f.options);
  try {
    assert.equal((await store.listProjects()).length, 1); // failed migration did not seed a default
    assert.ok((await store.getSessionProject('historical')).projectId);
  } finally { await store.close(); }
}));

test('incomplete legacy preparation is inventoried without creating or resetting a tree', () => fixture(async f => {
  const spaces = await openWorkspaces(f.options);
  const workspace = await spaces.forSession('preparing');
  const record = JSON.parse(await readFile(workspace.path + '.json', 'utf8'));
  await git(f.source, 'worktree', 'remove', workspace.path);
  record.state = 'preparing';
  await writeFile(workspace.path + '.json', JSON.stringify(record));
  const before = await git(f.source, 'worktree', 'list', '--porcelain');
  const store = await openStore(f.options);
  try { assert.ok((await store.getSessionProject('preparing')).projectId); }
  finally { await store.close(); }
  assert.equal(await git(f.source, 'worktree', 'list', '--porcelain'), before);
  assert.deepEqual(JSON.parse(await readFile(workspace.path + '.json', 'utf8')), record);
}));

test('review acceptance and retries persist the project and reject conflicting projects while active', () => fixture(async f => {
  let release, started, calls = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const reviewActions = { execute: async () => { calls++; started(); return new Promise(resolve => { release = resolve; }); } };
  let store = await openStore({ ...f.options, reviewActions });
  try {
    const project = (await store.listProjects())[0];
    const other = await store.registerProject(input(await repo(join(f.base, 'other'))));
    const action = { operationId: 'review-binding', action: 'test', revision: 'a'.repeat(64), command: 'true' };
    assert.equal((await store.reviewAction('chat', action)).projectId, project.projectId);
    await ready;
    assert.equal(taskInputs(f.directory).find(input => input.id === action.operationId).projectId, project.projectId);
    assert.equal((await store.reviewAction('chat', action)).projectId, project.projectId);
    await assert.rejects(store.reviewAction('chat', { ...action, projectId: other.projectId }), { status: 409 });
    await assert.rejects(store.submit('model-conflict', 'hi', 'chat', other.projectId), { status: 409 });
    release({ message: 'done' });
    for (let i = 0; i < 500 && (await store.getReview('chat', action.operationId)).status !== 'done'; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal((await store.getReview('chat', action.operationId)).status, 'done');
    await store.close(); store = await openStore({ ...f.options, reviewActions });
    assert.equal((await store.reviewAction('chat', action)).projectId, project.projectId);
    await assert.rejects(store.reviewAction('chat', { ...action, projectId: other.projectId }), { status: 409 });
    assert.equal(calls, 1);
  } finally { release?.({}); await store.close(); }
}));
