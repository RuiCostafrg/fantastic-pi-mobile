import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { openWorkspaces } from '../src/workspaces.js';
import { createReview } from '../src/review.js';
import { openStore } from '../src/store.js';
import { runPi } from '../src/rpc.js';
import { makeServer } from '../src/server.js';

const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args])).stdout.trim();
const signal = () => new AbortController().signal;
async function fixture(test) {
  const directory = await mkdtemp(join(tmpdir(), 'pocket-review-'));
  try {
    const source = join(directory, 'repo'); await mkdir(source);
    await git(source, 'init', '-b', 'trunk');
    await git(source, 'config', 'user.name', 'Review Test'); await git(source, 'config', 'user.email', 'test@example.invalid');
    await writeFile(join(source, 'file.txt'), 'base\n'); await writeFile(join(source, 'other.txt'), 'other\n');
    await mkdir(join(source, 'nested')); await writeFile(join(source, 'nested', 'deleted.txt'), 'delete me\n');
    await git(source, 'add', '.'); await git(source, 'commit', '-m', 'Base');
    const options = { cwd: source, directory: join(directory, 'data'), defaultBranch: 'trunk' };
    const workspaces = await openWorkspaces(options);
    const workspace = await workspaces.forSession('chat');
    const review = createReview({ workspaces });
    await test({ directory, source, options, workspaces, workspace, review });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
const apply = async (review, action, rest = {}) => review.execute('chat', { action, revision: (await review.snapshot('chat')).revision, ...rest }, signal());
async function waitFor(store, sessionId, predicate) {
  for (let i = 0; i < 400; i++) {
    const snapshot = await store.changes(sessionId);
    if (predicate(snapshot)) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Repository action timed out');
}

test('navigation summary is non-creating, chat-scoped, and follows working/committed/integrated files', () => fixture(async ({ workspace: w, workspaces, review, source }) => {
  assert.equal((await review.summary('ordinary')).hasChanges, false);
  await assert.rejects(workspaces.existing('ordinary'), /no worktree/);
  await writeFile(join(source, 'source-only.txt'), 'not this chat\n');
  assert.equal((await review.summary('chat')).fileCount, 0);
  await writeFile(join(w.path, 'file.txt'), 'changed\n');
  await writeFile(join(w.path, 'new.txt'), 'new\n');
  assert.deepEqual(await review.summary('chat'), { hasChanges: true, fileCount: 2, workingCount: 2, committedCount: 0 });
  await apply(review, 'commit', { paths: ['file.txt', 'new.txt'], message: 'Changes' });
  assert.deepEqual(await review.summary('chat'), { hasChanges: true, fileCount: 2, workingCount: 0, committedCount: 2 });
  await writeFile(join(w.path, 'file.txt'), 'again\n');
  assert.equal((await review.summary('chat')).fileCount, 2, 'same file counted once across working/committed');
  await apply(review, 'commit', { paths: ['file.txt'], message: 'Again' });
  await rm(join(source, 'source-only.txt'));
  await apply(review, 'merge');
  assert.equal((await review.summary('chat')).hasChanges, false);
}));

test('navigation summary does not read changed file contents or follow symlinks', () => fixture(async ({ workspace: w, review, directory }) => {
  await writeFile(join(w.path, 'large.bin'), Buffer.alloc(17 * 1024 * 1024));
  await symlink(join(directory, 'missing-private-target'), join(w.path, 'link'));
  assert.equal((await review.summary('chat')).fileCount, 2);
  await assert.rejects(review.snapshot('chat'), /16 MiB/);
}));

test('review lists tracked/untracked/deleted files and safe, bounded text/binary/symlink diffs', () => fixture(async ({ workspace: w, review, directory }) => {
  await writeFile(join(w.path, 'file.txt'), 'changed\n');
  await writeFile(join(w.path, 'new file.txt'), 'hello\n');
  await writeFile(join(w.path, 'binary.bin'), Buffer.from([0, 1, 2]));
  await rm(join(w.path, 'nested'), { recursive: true });
  await writeFile(join(directory, 'private'), 'DO_NOT_FOLLOW');
  await symlink(join(directory, 'private'), join(w.path, 'link'));
  const s = await review.snapshot('chat');
  assert.equal(s.files.length, 5); assert.equal(s.ahead, 0); assert.equal(s.tests, null);
  for (const path of ['file.txt', 'new file.txt', 'binary.bin', 'nested/deleted.txt', 'link']) {
    const d = await review.diff('chat', { revision: s.revision, scope: 'working', path });
    assert.ok(d.text.length > 0);
    assert.ok(!d.text.includes('DO_NOT_FOLLOW'));
  }
  assert.match((await review.diff('chat', { revision: s.revision, scope: 'working', path: 'binary.bin' })).text, /Binary file/);
  await assert.rejects(review.diff('chat', { revision: s.revision, scope: 'working', path: '../private' }), { status: 400 });
  await assert.rejects(review.snapshot('fresh-chat'), { status: 404 }); // no read-side worktree creation
}));

test('commit includes only reviewed selected files, not unrelated staged files; literal names are safe', () => fixture(async ({ workspace: w, review }) => {
  await writeFile(join(w.path, 'file.txt'), 'selected\n');
  await writeFile(join(w.path, 'other.txt'), 'staged unrelated\n'); await git(w.path, 'add', 'other.txt');
  await writeFile(join(w.path, ':(glob)*'), 'literal path\n');
  const result = await apply(review, 'commit', { paths: ['file.txt', ':(glob)*'], message: 'Selected change' });
  assert.match(result.commit, /^[a-f0-9]{40,64}$/);
  assert.equal(await git(w.path, 'show', 'HEAD:file.txt'), 'selected');
  assert.equal(await git(w.path, 'show', 'HEAD:other.txt'), 'other');
  assert.equal(await git(w.path, 'show', 'HEAD::(glob)*'), 'literal path');
  assert.equal(await git(w.path, 'diff', '--cached', '--name-only'), 'other.txt');
  const s = await review.snapshot('chat');
  assert.ok(s.committedFiles.some(f => f.path === 'file.txt'));
  assert.match((await review.diff('chat', { revision: s.revision, scope: 'committed', path: 'file.txt' })).text, /\+selected/);
}));

test('stale snapshots and unlisted paths cannot commit; explicit whole-file semantics preserve unrelated staging', () => fixture(async ({ workspace: w, review }) => {
  await writeFile(join(w.path, 'file.txt'), 'first\n');
  const s = await review.snapshot('chat');
  await writeFile(join(w.path, 'file.txt'), 'second\n');
  await assert.rejects(review.execute('chat', { action: 'commit', revision: s.revision, paths: ['file.txt'], message: 'stale' }, signal()), /stale/);
  await assert.rejects(apply(review, 'commit', { paths: ['../outside'], message: 'no' }), { status: 400 });
  assert.equal(await git(w.path, 'log', '-1', '--format=%s'), 'Base');
}));

test('review and test revisions cannot be reused across identical clones/worktrees', () => fixture(async ({ directory, source, options, review }) => {
  const clone = join(directory, 'clone');
  await git(directory, 'clone', source, clone);
  const otherSpaces = await openWorkspaces({ ...options, cwd: clone });
  await otherSpaces.forSession('chat');
  const other = createReview({ workspaces: otherSpaces });
  const a = await review.snapshot('chat'), b = await other.snapshot('chat');
  assert.equal(a.head, b.head);
  assert.notEqual(a.codeRevision, b.codeRevision);
  assert.notEqual(a.revision, b.revision);
  await assert.rejects(other.execute('chat', { action: 'test', revision: a.revision, command: 'true' }, signal()), /stale/);
}));

test('permission changes invalidate an already dirty file review', () => fixture(async ({ workspace: w, review }) => {
  await writeFile(join(w.path, 'file.txt'), 'changed\n');
  const before = await review.snapshot('chat');
  await chmod(join(w.path, 'file.txt'), 0o755);
  const after = await review.snapshot('chat');
  assert.notEqual(after.revision, before.revision);
  await assert.rejects(review.execute('chat', { action: 'commit', revision: before.revision, paths: ['file.txt'], message: 'stale mode' }, signal()), /stale/);
}));

test('merge integrates only committed changes into a clean local default; no remote push', () => fixture(async ({ source, workspace: w, review }) => {
  await writeFile(join(w.path, 'file.txt'), 'integrated\n');
  await apply(review, 'commit', { paths: ['file.txt'], message: 'Integration candidate' });
  const before = await review.snapshot('chat'); assert.equal(before.mergeBlock, null); assert.equal(before.ahead, 1);
  const result = await apply(review, 'merge');
  assert.equal(await readFile(join(source, 'file.txt'), 'utf8'), 'integrated\n');
  assert.equal(await git(source, 'branch', '--show-current'), 'trunk');
  assert.equal(await git(source, 'rev-parse', 'HEAD'), result.commit);
  assert.equal(await git(source, 'status', '--porcelain'), '');
  assert.equal((await review.snapshot('chat')).ahead, 0);
}));

test('merge conflicts are detected without modifying the target checkout', () => fixture(async ({ source, workspace: w, review }) => {
  await writeFile(join(w.path, 'file.txt'), 'chat version\n');
  await apply(review, 'commit', { paths: ['file.txt'], message: 'Chat edit' });
  await writeFile(join(source, 'file.txt'), 'default version\n'); await git(source, 'commit', '-am', 'Default edit');
  const head = await git(source, 'rev-parse', 'HEAD');
  await assert.rejects(apply(review, 'merge'), /Merge conflicts detected/);
  assert.equal(await git(source, 'rev-parse', 'HEAD'), head);
  assert.equal(await readFile(join(source, 'file.txt'), 'utf8'), 'default version\n');
  assert.equal(await git(source, 'status', '--porcelain'), '');
}));

test('merge refuses to overwrite ignored local files even when they are absent from status', () => fixture(async ({ source, workspace: w, review }) => {
  await writeFile(join(source, '.git', 'info', 'exclude'), 'ignored.txt\n');
  await writeFile(join(source, 'ignored.txt'), 'PRIVATE_LOCAL_FILE');
  await writeFile(join(w.path, 'ignored.txt'), 'incoming branch file');
  await git(w.path, 'add', '-f', 'ignored.txt'); await git(w.path, 'commit', '-m', 'Incoming ignored-name file');
  const head = await git(source, 'rev-parse', 'HEAD');
  await assert.rejects(apply(review, 'merge'), /untracked\/ignored path/);
  assert.equal(await git(source, 'rev-parse', 'HEAD'), head);
  assert.equal(await readFile(join(source, 'ignored.txt'), 'utf8'), 'PRIVATE_LOCAL_FILE');
  assert.equal(await git(source, 'status', '--porcelain'), '');
}));

test('dirty/default-branch/unfinished-operation guards block unsafe integration', () => fixture(async ({ source, workspace: w, review }) => {
  await writeFile(join(w.path, 'file.txt'), 'chat\n'); await apply(review, 'commit', { paths: ['file.txt'], message: 'Chat' });
  await writeFile(join(source, 'untracked'), 'keep');
  await assert.rejects(apply(review, 'merge'), /uncommitted/); await rm(join(source, 'untracked'));
  await git(source, 'checkout', '-b', 'feature');
  await assert.rejects(apply(review, 'merge'), /not on trunk/); await git(source, 'checkout', 'trunk');
  await writeFile(join(w.path, 'new.txt'), 'keep');
  await assert.rejects(apply(review, 'merge'), /working changes/);
}));

test('test runs capture actual exit codes/output and mark source-mutating runs stale', () => fixture(async ({ review }) => {
  const passed = await apply(review, 'test', { command: 'printf "REAL_TEST_OK\\n"' });
  assert.equal(passed.test.exitCode, 0); assert.match(passed.test.output, /REAL_TEST_OK/); assert.equal(passed.test.changedDuringRun, false);
  const failed = await apply(review, 'test', { command: 'printf "REAL_TEST_FAIL\\n"; exit 7' });
  assert.equal(failed.test.exitCode, 7);
  const changed = await apply(review, 'test', { command: 'printf modified > file.txt' });
  assert.equal(changed.test.changedDuringRun, true);
}));

test('Durable repository actions are idempotent, preserve evidence across reopen, and stale evidence is explicit', () => fixture(async ({ options, workspace: w }) => {
  let store = await openStore(options);
  try {
    const s = await store.changes('chat');
    const input = { operationId: 'durable-test-action', action: 'test', revision: s.revision, command: 'printf once >> execution-count' };
    await store.reviewAction('chat', input);
    const done = await waitFor(store, 'chat', s => s.operation.status === 'done');
    assert.equal(done.tests.exitCode, 0); assert.equal(done.tests.stale, true);
    assert.equal((await store.reviewAction('chat', input)).status, 'done');
    await assert.rejects(store.reviewAction('chat', { ...input, command: 'different' }), { status: 409 });
    await store.close(); store = await openStore(options);
    assert.equal((await store.changes('chat')).tests.exitCode, 0);
    assert.equal((await store.reviewAction('chat', input)).status, 'done');
    assert.equal(await readFile(join(w.path, 'execution-count'), 'utf8'), 'once');
  } finally { await store.close(); }
}));

test('actions completing during a Changes snapshot require an automatic fresh read', () => fixture(async ({ options, workspaces }) => {
  const base = createReview({ workspaces });
  let capture, release;
  const captured = new Promise(resolve => { capture = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let block = true;
  const reviewActions = { ...base, snapshot: async id => {
    const value = await base.snapshot(id);
    if (block) { block = false; capture(value); await gate; }
    return value;
  } };
  const store = await openStore({ ...options, reviewActions });
  try {
    const firstRead = store.changes('chat');
    const old = await captured;
    await store.reviewAction('chat', { operationId: 'during-snapshot-action', action: 'test', revision: old.revision, command: 'true' });
    for (let i = 0; i < 200 && (await store.getReview('chat', 'during-snapshot-action')).status !== 'done'; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal((await store.getReview('chat', 'during-snapshot-action')).status, 'done');
    release();
    const mixed = await firstRead;
    assert.equal(mixed.operation.status, 'done');
    assert.equal(mixed.refreshRequired, true);
    assert.equal(mixed.repositoryBusy, true);
    const fresh = await store.changes('chat');
    assert.equal(fresh.refreshRequired, false); assert.equal(fresh.repositoryBusy, false);
  } finally { release(); await store.close(); }
}));

test('repository actions block conflicting model admission and test cancellation is scoped', () => fixture(async ({ options }) => {
  const store = await openStore(options);
  try {
    const s = await store.changes('chat');
    await store.reviewAction('chat', { operationId: 'cancel-test-action', action: 'test', revision: s.revision, command: 'sleep 20' });
    await waitFor(store, 'chat', s => s.operation.status === 'running');
    assert.equal((await store.changesSummary('chat')).repositoryActionActive, true);
    assert.equal((await store.changesSummary('other-chat')).repositoryActionActive, false);
    await assert.rejects(store.submit('blocked-model', 'hi', 'other-chat'), { status: 429 });
    await assert.rejects(store.reviewAction('chat', { operationId: 'another-test-action', action: 'test', revision: s.revision, command: 'true' }), { status: 409 });
    await assert.rejects(store.cancelReview('different-chat', 'cancel-test-action'), { status: 404 });
    await store.cancelReview('chat', 'cancel-test-action');
    await waitFor(store, 'chat', s => s.operation.status === 'cancelled');
    assert.equal((await store.changesSummary('chat')).repositoryActionActive, false);
  } finally { await store.close(); }
}));

test('running model requests cannot be committed or merged underneath', () => fixture(async ({ options }) => {
  const peer = resolve('test/fake-pi.js');
  const store = await openStore({ ...options, runner: o => runPi({ ...o, bin: process.execPath, args: [peer] }) });
  try {
    await store.submit('model-active', 'confirm', 'chat');
    for (let i = 0; i < 200 && !(await store.get('model-active')).pending; i++) await new Promise(r => setTimeout(r, 10));
    const s = await store.changes('chat');
    assert.equal(s.busy, true);
    await assert.rejects(store.reviewAction('chat', { operationId: 'unsafe-commit-action', action: 'commit', revision: s.revision, paths: ['file.txt'], message: 'no' }), { status: 409 });
    await store.cancel('model-active');
  } finally { await store.close(); }
}));

test('dispatched repository operations are never replayed after bridge restart', () => fixture(async ({ options, workspaces }) => {
  let calls = 0;
  const base = createReview({ workspaces });
  const reviewActions = { ...base, execute: async (_, __, signal) => { calls++; await new Promise((_, reject) => { signal.addEventListener('abort', () => reject(new Error('closing')), { once: true }); }); } };
  let store = await openStore({ ...options, reviewActions });
  const s = await store.changes('chat');
  await store.reviewAction('chat', { operationId: 'interrupted-action', action: 'test', revision: s.revision, command: 'never run' });
  await waitFor(store, 'chat', s => s.operation.status === 'running');
  while (calls === 0) await new Promise(r => setTimeout(r, 10));
  await store.close(); store = await openStore({ ...options, reviewActions });
  try {
    const interrupted = await waitFor(store, 'chat', s => s.operation.status === 'interrupted');
    assert.match(interrupted.operation.result.message, /not replayed/); assert.equal(calls, 1);
  } finally { await store.close(); }
}));

test('authenticated HTTP review routes validate actions and never log filenames or commands', () => fixture(async ({ options, workspace: w }) => {
  await writeFile(join(w.path, 'file.txt'), 'PRIVATE_DIFF_TEXT\n');
  const store = await openStore(options), logs = [];
  const token = 'a'.repeat(64), server = makeServer(store, token, (event, data) => logs.push({ event, ...data }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  const req = (path, body, auth = true) => fetch(url + '/v1/sessions/chat/' + path, { headers: auth ? { Authorization: 'Bearer ' + token } : {}, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await req('changes', undefined, false)).status, 401);
    assert.equal((await req('changes?summary=1', undefined, false)).status, 401);
    const indicator = await req('changes?summary=1');
    assert.equal(indicator.status, 200);
    assert.deepEqual(await indicator.json(), { hasChanges: true, fileCount: 1, workingCount: 1, committedCount: 0, repositoryActionActive: false,
      projectId: (await store.getSessionProject('chat')).projectId });
    const s = await (await req('changes')).json();
    const diff = await req('diff?scope=working&path=file.txt&revision=' + s.revision); assert.equal(diff.status, 200);
    assert.match((await diff.json()).text, /PRIVATE_DIFF_TEXT/);
    assert.equal((await req('actions', { operationId: 'invalid-action', action: 'push', revision: s.revision })).status, 400);
    assert.equal((await req('actions', { operationId: 'http-test-action', action: 'test', revision: s.revision, command: 'true' })).status, 202);
    await waitFor(store, 'chat', s => s.operation.status === 'done');
    const recorded = await req('actions/http-test-action');
    assert.equal(recorded.status, 200); assert.equal((await recorded.json()).status, 'done');
    assert.equal((await req('actions/nonexistent-operation')).status, 404);
    assert.ok(!JSON.stringify(logs).includes('file.txt')); assert.ok(!JSON.stringify(logs).includes('PRIVATE_DIFF_TEXT'));
  } finally { server.close(); server.closeAllConnections(); await store.close(); }
}));
