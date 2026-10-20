import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openWorkspaces } from '../src/workspaces.js';
import { openStore } from '../src/store.js';
import { runPi } from '../src/rpc.js';

const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args])).stdout.trim();
async function temporary(test) {
  const root = await mkdtemp(join(tmpdir(), 'pocket-worktrees-'));
  try { await test(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function repo(root, name = 'repo') {
  const path = join(root, name);
  await mkdir(path);
  await git(path, 'init', '-b', 'trunk');
  await git(path, 'config', 'user.name', 'Worktree Test');
  await git(path, 'config', 'user.email', 'test@example.invalid');
  await writeFile(join(path, 'same.txt'), 'default branch\n');
  await git(path, 'add', '.'); await git(path, 'commit', '-m', 'Initial');
  return path;
}
async function waitFor(store, id, predicate) {
  for (let i = 0; i < 600; i++) {
    const job = await store.get(id);
    if (predicate(job)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for ' + id);
}

test('each chat starts from the explicit default, isolates same-file edits, and reuses dirty worktrees across restart', () => temporary(async root => {
  const source = await repo(root);
  await git(source, 'checkout', '-b', 'unrelated-feature');
  await writeFile(join(source, 'same.txt'), 'feature commit\n');
  await git(source, 'commit', '-am', 'Feature');
  await writeFile(join(source, 'same.txt'), 'original dirty checkout\n');
  await writeFile(join(source, '.env'), 'PRIVATE_LOCAL_ONLY');
  const options = { cwd: source, directory: join(root, 'data'), defaultBranch: 'trunk' };
  let manager = await openWorkspaces(options);
  const [a, b] = await Promise.all([manager.forSession('chat-A'), manager.forSession('chat-B')]);
  assert.notEqual(a.cwd, b.cwd); assert.notEqual(a.branch, b.branch);
  assert.equal(a.baseCommit, await git(source, 'rev-parse', 'trunk'));
  assert.equal(await readFile(join(a.cwd, 'same.txt'), 'utf8'), 'default branch\n');
  await assert.rejects(readFile(join(a.cwd, '.env')), { code: 'ENOENT' });
  await writeFile(join(a.cwd, 'same.txt'), 'A changes\n');
  await writeFile(join(b.cwd, 'same.txt'), 'B changes\n');
  manager = await openWorkspaces(options);
  assert.deepEqual(await manager.forSession('chat-A'), a);
  assert.equal(await readFile(join(a.cwd, 'same.txt'), 'utf8'), 'A changes\n');
  assert.equal(await readFile(join(b.cwd, 'same.txt'), 'utf8'), 'B changes\n');
  assert.equal(await readFile(join(source, 'same.txt'), 'utf8'), 'original dirty checkout\n');
  assert.equal(await git(source, 'branch', '--show-current'), 'unrelated-feature');
  assert.equal(await git(a.cwd, 'branch', '--show-current'), a.branch);
}));

test('auto mode fetches the current remote default for new chats, never silently uses a stale/feature branch', () => temporary(async root => {
  const origin = await repo(root, 'origin');
  const source = join(root, 'clone');
  await git(root, 'clone', origin, source);
  await git(source, 'checkout', '-b', 'feature');
  const manager = await openWorkspaces({ cwd: source, directory: join(root, 'data') });
  const a = await manager.forSession('before');
  await writeFile(join(origin, 'same.txt'), 'new default tip\n');
  await git(origin, 'commit', '-am', 'Advance default');
  const b = await manager.forSession('after');
  assert.notEqual(a.baseCommit, b.baseCommit);
  assert.equal(await readFile(join(b.cwd, 'same.txt'), 'utf8'), 'new default tip\n');
  assert.equal(await readFile(join(a.cwd, 'same.txt'), 'utf8'), 'default branch\n');
  await git(origin, 'checkout', '-b', 'next-default');
  const c = await manager.forSession('renamed-default');
  assert.equal(c.baseBranch, 'next-default');
  await rename(origin, origin + '-offline');
  assert.deepEqual(await manager.forSession('before'), a); // existing chats need no fetch
  await assert.rejects(manager.forSession('offline-new'), /Git workspace operation failed/);
  assert.equal(await git(source, 'branch', '--show-current'), 'feature');
}));

test('missing, switched or colliding worktrees fail closed without overwriting work', () => temporary(async root => {
  const source = await repo(root);
  const manager = await openWorkspaces({ cwd: source, directory: join(root, 'data'), defaultBranch: 'trunk' });
  const a = await manager.forSession('chat-a');
  await git(a.cwd, 'checkout', '-b', 'manually-switched');
  await assert.rejects(manager.forSession('chat-a'), /wrong checkout/);
  await git(a.cwd, 'checkout', a.branch);
  await git(source, 'worktree', 'remove', a.path);
  await assert.rejects(manager.forSession('chat-a'), /missing/);
  assert.equal(await git(source, 'rev-parse', a.branch), a.baseCommit);
  await assert.rejects(manager.forSession('../escape'), /Invalid workspace session/);
  await assert.rejects(openWorkspaces({ cwd: root, directory: join(root, 'not-repo') }), /Git workspace operation failed/);
  await assert.rejects(openWorkspaces({ cwd: source, directory: join(root, 'bad-base'), defaultBranch: 'missing' }).then(m => m.forSession('a')), /Git workspace operation failed/);
}));

test('preparation intent recovers without resetting a created worktree; project subdirectories remain scoped', () => temporary(async root => {
  const source = await repo(root);
  await mkdir(join(source, 'project'));
  await writeFile(join(source, 'project', 'file.txt'), 'project');
  await git(source, 'add', '.'); await git(source, 'commit', '-m', 'Project');
  const options = { cwd: join(source, 'project'), directory: join(root, 'data'), defaultBranch: 'trunk' };
  const manager = await openWorkspaces(options);
  const a = await manager.forSession('a');
  assert.equal(a.cwd, join(a.path, 'project'));
  const recordPath = a.path + '.json';
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  record.state = 'preparing'; await writeFile(recordPath, JSON.stringify(record));
  await writeFile(join(a.cwd, 'file.txt'), 'uncommitted');
  const reopened = await openWorkspaces(options);
  assert.deepEqual(await reopened.forSession('a'), a);
  assert.equal(await readFile(join(a.cwd, 'file.txt'), 'utf8'), 'uncommitted');
  assert.equal(JSON.parse(await readFile(recordPath, 'utf8')).state, 'ready');
}));

test('Durable jobs launch real RPC children in distinct worktrees and retain workspace metadata', () => temporary(async root => {
  const source = await repo(root);
  const directory = join(root, 'data');
  const fixture = resolve('test/fake-pi.js');
  const launches = [];
  const runner = async options => {
    launches.push(options);
    await writeFile(join(options.cwd, 'same.txt'), options.id);
    return runPi({ ...options, bin: process.execPath, args: [fixture] });
  };
  let store = await openStore({ cwd: source, directory, defaultBranch: 'trunk', runner });
  try {
    await store.submit('worktree-job-a', 'confirm', 'a');
    await store.submit('worktree-job-b', 'confirm', 'b');
    const a = await waitFor(store, 'worktree-job-a', j => j.pending);
    const b = await waitFor(store, 'worktree-job-b', j => j.pending);
    assert.notEqual(a.workspace.cwd, b.workspace.cwd);
    assert.notEqual(a.workspace.branch, b.workspace.branch);
    assert.equal(launches[0].text, 'confirm'); // no prefix breaking extension slash commands
    assert.ok(launches[0].args.includes('--append-system-prompt'));
    assert.equal(await readFile(join(a.workspace.cwd, 'same.txt'), 'utf8'), 'worktree-job-a');
    assert.equal(await readFile(join(b.workspace.cwd, 'same.txt'), 'utf8'), 'worktree-job-b');
    assert.equal(await readFile(join(source, 'same.txt'), 'utf8'), 'default branch\n');
    await store.respond(a.id, { id: 'dialog', confirmed: true });
    await store.respond(b.id, { id: 'dialog', confirmed: true });
    await waitFor(store, a.id, j => j.status === 'done'); await waitFor(store, b.id, j => j.status === 'done');
    await store.close();
    store = await openStore({ cwd: source, directory, defaultBranch: 'trunk', runner });
    assert.deepEqual((await store.get(a.id)).workspace, a.workspace);
    await store.submit('worktree-job-next', 'hi', 'a');
    const next = await waitFor(store, 'worktree-job-next', j => j.status === 'done');
    assert.deepEqual(next.workspace, a.workspace);
  } finally { await store.close(); }
}));

test('workspace setup failures never launch Pi in the shared checkout, including legacy chats', () => temporary(async root => {
  const source = await repo(root);
  let calls = 0;
  await assert.rejects(openStore({ cwd: source, directory: join(root, 'data'), defaultBranch: 'missing-default',
    runner: async () => { calls++; return 'Should not run'; } }), /Project Git validation failed/);
  assert.equal(calls, 0);
  assert.equal(await git(source, 'branch', '--show-current'), 'trunk');
  // Failed opening must release the Durable storage lock as well.
  const directory = join(root, 'not-a-repo-store');
  await assert.rejects(openStore({ cwd: root, directory }), /Git workspace operation failed/);
  const reopened = await openStore({ cwd: source, directory, defaultBranch: 'trunk', runner: async () => 'Legacy isolated' });
  try {
    await reopened.submit('legacy-isolated', 'hi');
    const job = await waitFor(reopened, 'legacy-isolated', j => j.status === 'done');
    assert.notEqual(job.workspace.cwd, source);
    assert.equal(job.workspace.baseBranch, 'trunk');
  } finally { await reopened.close(); }
}));

test('more than eight concurrent chats are supported with a configured bounded limit', () => temporary(async directory => {
  const fixture = resolve('test/fake-pi.js');
  const options = { directory, cwd: process.cwd(), maxConcurrent: 12,
    workspaces: { forSession: async () => ({ cwd: process.cwd() }) },
    runner: options => runPi({ ...options, bin: process.execPath, args: [fixture] }) };
  const store = await openStore(options);
  try {
    for (let i = 0; i < 9; i++) await store.submit('parallel-job-' + i, 'confirm', 'chat-' + i);
    for (let i = 0; i < 9; i++) await waitFor(store, 'parallel-job-' + i, j => Boolean(j.pending));
    assert.equal(store.maxConcurrent, 12);
  } finally { await store.close(); }
  for (const maxConcurrent of [0, 33, 1.5, NaN]) await assert.rejects(openStore({ ...options, maxConcurrent }), /between 1 and 32/);
}));
