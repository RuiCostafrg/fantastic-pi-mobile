import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';
import { openWorkspaces } from '../src/workspaces.js';

const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args])).stdout.trim();
const delay = () => new Promise(resolve => setTimeout(resolve, 10));
async function repo(path) {
  await mkdir(join(path, 'sub'), { recursive: true });
  await git(path, 'init', '-b', 'trunk');
  await git(path, 'config', 'user.name', 'Routing test');
  await git(path, 'config', 'user.email', 'test@example.invalid');
  for (const name of ['file.txt', 'keep.txt']) await writeFile(join(path, 'sub', name), 'base\n');
  await git(path, 'add', '.'); await git(path, 'commit', '-m', 'base');
  return path;
}
async function fixture(fn) {
  const base = await mkdtemp(join(tmpdir(), 'mobile-routing-'));
  const a = await repo(join(base, 'a'));
  const b = join(base, 'b'); await git(base, 'clone', a, b);
  await git(b, 'config', 'user.name', 'Routing test'); await git(b, 'config', 'user.email', 'test@example.invalid');
  const options = { directory: join(base, 'state'), cwd: join(a, 'sub'), defaultBranch: 'trunk' };
  try { await fn({ base, a, b, options }); }
  finally { await rm(base, { recursive: true, force: true }); }
}
const projectInput = root => ({ source: join(root, 'sub'), name: 'Other project', branchPolicy: { kind: 'local', branch: 'trunk' } });
async function job(store, id, status = 'done') {
  for (let i = 0; i < 600; i++) {
    const current = await store.get(id);
    if (!['queued', 'running'].includes(current.status)) { assert.equal(current.status, status, current.answer); return current; }
    await delay();
  }
  throw new Error('Job timed out: ' + id);
}
async function action(store, sessionId, id, input, status = 'done') {
  await store.reviewAction(sessionId, { operationId: id, revision: (await store.changes(sessionId)).revision, ...input });
  for (let i = 0; i < 600; i++) {
    const current = await store.getReview(sessionId, id);
    if (!['queued', 'running'].includes(current.status)) { assert.equal(current.status, status, current.result?.message); return current; }
    await delay();
  }
  throw new Error('Action timed out: ' + id);
}

test('bound projects isolate concurrent coding, summaries/diffs, tests, selected commits and local merges across reopen', () => fixture(async f => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const launches = [];
  const runner = async input => {
    launches.push(input);
    await writeFile(join(input.cwd, 'file.txt'), input.text + '\n');
    await gate;
    return input.text;
  };
  let store = await openStore({ ...f.options, runner });
  try {
    const pa = (await store.listProjects())[0];
    const pb = await store.registerProject(projectInput(f.b));
    for (const root of [f.a, f.b]) {
      await writeFile(join(root, 'sub/keep.txt'), 'source staging\n');
      await git(root, 'add', 'sub/keep.txt');
    }
    const originalIndexes = await Promise.all([f.a, f.b].map(root => git(root, 'diff', '--cached', '--binary')));
    await Promise.all([
      store.submit('routing-a', 'PROJECT_A', 'chat-a', pa.projectId),
      store.submit('routing-b', 'PROJECT_B', 'chat-b', pb.projectId)
    ]);
    for (let i = 0; i < 600 && launches.length !== 2; i++) await delay();
    assert.equal(launches.length, 2, 'both workers must be live simultaneously');
    release();
    const ja = await job(store, 'routing-a'), jb = await job(store, 'routing-b');
    assert.equal(ja.workspace.repositoryRoot, f.a); assert.equal(jb.workspace.repositoryRoot, f.b);
    assert.notEqual(ja.workspace.path, jb.workspace.path); assert.notEqual(ja.workspace.branch, jb.workspace.branch);
    assert.equal(ja.workspace.cwd, join(ja.workspace.path, 'sub')); assert.equal(jb.workspace.cwd, join(jb.workspace.path, 'sub'));
    for (const [j, text] of [[ja, 'PROJECT_A'], [jb, 'PROJECT_B']]) assert.equal(await readFile(join(j.workspace.cwd, 'file.txt'), 'utf8'), text + '\n');
    for (const root of [f.a, f.b]) assert.equal(await readFile(join(root, 'sub/file.txt'), 'utf8'), 'base\n');
    assert.equal((await store.changesSummary('chat-a')).fileCount, 1);
    assert.equal((await store.changesSummary('chat-b')).fileCount, 1);
    assert.equal((await store.changesSummary('unknown')).hasChanges, false);
    assert.equal(await store.getSessionProject('unknown'), null);
    const sa = await store.changes('chat-a'), sb = await store.changes('chat-b');
    assert.notEqual(sa.revision, sb.revision);
    for (const [session, snapshot, text, other] of [['chat-a', sa, 'PROJECT_A', 'PROJECT_B'], ['chat-b', sb, 'PROJECT_B', 'PROJECT_A']]) {
      const diff = await store.diff(session, { revision: snapshot.revision, scope: 'working', path: 'sub/file.txt' });
      assert.ok(diff.text.includes(text)); assert.ok(!diff.text.includes(other));
    }
    await assert.rejects(store.diff('chat-b', { revision: sa.revision, scope: 'working', path: 'sub/file.txt' }), { status: 409 });
    const cross = await action(store, 'chat-b', 'cross-project-revision', { action: 'commit', revision: sa.revision, paths: ['sub/file.txt'], message: 'wrong' }, 'failed');
    assert.match(cross.result.message, /stale/);
    for (const [session, j, text] of [['chat-a', ja, 'PROJECT_A'], ['chat-b', jb, 'PROJECT_B']]) {
      const run = await action(store, session, 'test-' + session, { action: 'test', command: 'pwd; cat file.txt' });
      assert.equal(run.projectId, j.projectId); assert.equal(run.result.test.exitCode, 0);
      assert.ok(run.result.test.output.includes(j.workspace.cwd)); assert.ok(run.result.test.output.includes(text));
      await writeFile(join(j.workspace.cwd, 'keep.txt'), 'unrelated staged\n');
      await git(j.workspace.path, 'add', 'sub/keep.txt');
      await action(store, session, 'commit-' + session, { action: 'commit', paths: ['sub/file.txt'], message: 'Selected ' + session });
      assert.equal(await git(j.workspace.path, 'show', 'HEAD:sub/file.txt'), text);
      assert.equal(await git(j.workspace.path, 'show', 'HEAD:sub/keep.txt'), 'base');
      assert.equal(await git(j.workspace.path, 'diff', '--cached', '--name-only'), 'sub/keep.txt');
      await action(store, session, 'finish-' + session, { action: 'commit', paths: ['sub/keep.txt'], message: 'Explicit remaining change' });
    }
    assert.deepEqual(await Promise.all([f.a, f.b].map(root => git(root, 'diff', '--cached', '--binary'))), originalIndexes);
    const blocked = await action(store, 'chat-a', 'dirty-target-merge', { action: 'merge' }, 'failed');
    assert.match(blocked.result.message, /uncommitted/);
    // Explicit cleanup of disposable source staging only, after preservation assertions.
    for (const root of [f.a, f.b]) { await git(root, 'restore', '--staged', 'sub/keep.txt'); await git(root, 'restore', 'sub/keep.txt'); }
    await store.close(); store = await openStore({ ...f.options, runner });
    assert.equal((await store.getSessionProject('chat-b')).projectId, pb.projectId);
    assert.equal((await store.changes('chat-b')).workspace.path, jb.workspace.path);
    assert.equal((await store.submit('routing-b', 'PROJECT_B', 'chat-b')).projectId, pb.projectId);
    assert.equal(launches.length, 2);
    await action(store, 'chat-a', 'merge-chat-a', { action: 'merge' });
    assert.equal(await readFile(join(f.a, 'sub/file.txt'), 'utf8'), 'PROJECT_A\n');
    assert.equal(await readFile(join(f.b, 'sub/file.txt'), 'utf8'), 'base\n');
    assert.equal((await store.changesSummary('chat-a')).hasChanges, false);
    assert.equal((await store.changesSummary('chat-b')).hasChanges, true);
    await action(store, 'chat-b', 'merge-chat-b', { action: 'merge' });
    assert.equal(await readFile(join(f.b, 'sub/file.txt'), 'utf8'), 'PROJECT_B\n');
    assert.equal(await readFile(join(f.a, 'sub/file.txt'), 'utf8'), 'PROJECT_A\n');
    for (const root of [f.a, f.b]) assert.equal(await git(root, 'status', '--porcelain'), '');
  } finally { release(); await store.close(); }
}));

test('identical bound clones have distinct revisions and retain global review/admission guards', () => fixture(async f => {
  let running;
  const started = new Promise(resolve => { running = resolve; });
  const store = await openStore({ ...f.options, runner: async ({ text, signal }) => {
    if (text !== 'hang') return 'done';
    running();
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
  } });
  try {
    const pb = await store.registerProject(projectInput(f.b));
    await store.submit('identical-a', 'hi', 'same-a'); await job(store, 'identical-a');
    await store.submit('identical-b', 'hi', 'same-b', pb.projectId); await job(store, 'identical-b');
    const a = await store.changes('same-a'), b = await store.changes('same-b');
    assert.equal(a.head, b.head);
    assert.deepEqual(a.files, b.files);
    assert.notEqual(a.revision, b.revision); assert.notEqual(a.codeRevision, b.codeRevision);
    const cross = await action(store, 'same-b', 'identical-cross-revision', { action: 'test', revision: a.revision, command: 'exit 99' }, 'failed');
    assert.match(cross.result.message, /stale/);
    await store.submit('busy-other-project', 'hang', 'same-b'); await started;
    await assert.rejects(store.reviewAction('same-a', { operationId: 'global-merge-guard', action: 'merge', revision: a.revision }), { status: 409 });
    const test = await store.reviewAction('same-a', { operationId: 'global-test-guard', action: 'test', revision: a.revision, command: 'sleep 20' });
    assert.ok(test.projectId);
    await assert.rejects(store.submit('blocked-other-project', 'hi', 'new-b', pb.projectId), { status: 429 });
    await assert.rejects(store.reviewAction('new-b', { operationId: 'global-review-guard', action: 'test', revision: b.revision, command: 'true', projectId: pb.projectId }), { status: 409 });
    assert.equal(await store.getSessionProject('new-b'), null);
    await store.cancelReview('same-a', 'global-test-guard');
    await store.cancel('busy-other-project');
  } finally { await store.close(); }
}));

test('legacy worktrees remain byte-compatible and dirty state survives when another project is selected', () => fixture(async f => {
  const legacy = await openWorkspaces(f.options);
  const workspace = await legacy.forSession('pocket');
  await writeFile(join(workspace.cwd, 'file.txt'), 'legacy dirty\n');
  const manifest = await readFile(workspace.path + '.json', 'utf8');
  let store = await openStore({ ...f.options, runner: async input => {
    assert.equal(await readFile(join(input.cwd, 'file.txt'), 'utf8'), 'legacy dirty\n'); return 'preserved';
  } });
  try {
    await store.registerProject(projectInput(f.b));
    await store.submit('legacy-routing', 'inspect');
    assert.equal((await job(store, 'legacy-routing')).workspace.path, workspace.path);
    await store.close(); store = await openStore(f.options);
    assert.equal((await store.changes('pocket')).workspace.path, workspace.path);
    assert.equal(await readFile(workspace.path + '.json', 'utf8'), manifest);
    assert.equal(await readFile(join(workspace.cwd, 'file.txt'), 'utf8'), 'legacy dirty\n');
  } finally { await store.close(); }
}));

test('bound repository identity and worktree guards apply to cached non-default managers without fallback', () => fixture(async f => {
  let calls = 0;
  const options = { ...f.options, runner: async () => { calls++; return 'done'; } };
  const store = await openStore(options);
  try {
    const pb = await store.registerProject(projectInput(f.b));
    await store.submit('identity-first', 'hi', 'bound-b', pb.projectId);
    const first = await job(store, 'identity-first');
    const before = await git(f.a, 'status', '--porcelain');
    await rename(f.b, f.b + '-saved');
    await repo(f.b);
    await assert.rejects(store.changes('bound-b'), /identity changed/);
    await assert.rejects(store.changesSummary('bound-b'), /identity changed/);
    await assert.rejects(store.submit('replaced-source', 'hi', 'bound-b'), /identity changed/);
    await rename(f.b, f.b + '-replacement'); await rename(f.b + '-saved', f.b);
    await git(first.workspace.path, 'checkout', '-b', 'switched');
    await assert.rejects(store.changes('bound-b'), /repository\/branch changed/);
    await store.submit('switched-tree', 'hi', 'bound-b'); await job(store, 'switched-tree', 'failed');
    assert.equal(calls, 1);
    assert.equal(await git(f.a, 'status', '--porcelain'), before);
    await git(first.workspace.path, 'checkout', first.workspace.branch);
    await git(f.b, 'worktree', 'remove', first.workspace.path);
    await store.submit('missing-tree', 'hi', 'bound-b'); await job(store, 'missing-tree', 'failed');
    assert.equal(calls, 1);
    assert.equal(await store.get('replaced-source'), undefined);
    assert.equal((await readdir(join(f.options.directory, 'worktrees'))).length, 2);
  } finally { await store.close(); }
}));
