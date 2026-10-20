import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm, symlink, rename, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';

const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args])).stdout.trim();
async function repo(path) {
  await mkdir(path);
  await git(path, 'init', '-b', 'trunk');
  await git(path, 'config', 'user.email', 'test@example.invalid');
  await git(path, 'config', 'user.name', 'Test');
  await writeFile(join(path, 'file.txt'), 'original\n');
  await git(path, 'add', '.');
  await git(path, 'commit', '-m', 'initial');
  return path;
}
const input = source => ({ source, name: 'Test project', branchPolicy: { kind: 'local', branch: 'trunk' } });
async function fixture(fn) {
  const base = await mkdtemp(join(tmpdir(), 'mobile-projects-'));
  let store;
  let calls = 0;
  const directory = join(base, 'state');
  const source = await repo(join(base, 'source'));
  const options = { directory, cwd: source, defaultBranch: 'trunk', runner: async () => { calls++; return 'done'; } };
  const reopen = async () => { if (store) await store.close(); store = undefined; store = await openStore(options); return store; };
  try { store = await reopen(); await fn({ base, source, directory, reopen, store, calls: () => calls }); }
  finally { if (store) await store.close(); await rm(base, { recursive: true, force: true }); }
}

test('project registry persists stable IDs, deduplicates symlinks/races and performs no work', () => fixture(async f => {
  assert.equal((await f.store.listProjects()).length, 1); // frozen default seeded by step 03
  const alias = join(f.base, 'alias');
  await symlink(f.source, alias);
  const [project, duplicate] = await Promise.all([
    f.store.registerProject(input(f.source)), f.store.registerProject({ ...input(alias), name: 'Another label' })
  ]);
  assert.equal(project.projectId, duplicate.projectId);
  assert.equal(project.source, f.source);
  assert.deepEqual(project.branchPolicy, { kind: 'local', branch: 'trunk' });
  assert.equal(await git(f.source, 'remote'), '');
  project.name = 'Not persisted';
  assert.notEqual((await f.store.getProject(project.projectId)).name, project.name);
  const before = await git(f.source, 'worktree', 'list', '--porcelain');
  const reopened = await f.reopen();
  assert.equal((await reopened.registerProject(input(alias))).projectId, project.projectId);
  assert.equal((await reopened.listProjects()).length, 1);
  assert.equal(await git(f.source, 'worktree', 'list', '--porcelain'), before);
  const storage = join(f.directory, 'worktrees');
  for (const key of await readdir(storage)) assert.deepEqual(await readdir(join(storage, key)), []);
  assert.equal(f.calls(), 0);
  await assert.rejects(reopened.getProject('unknown'), { status: 404 });
  await assert.rejects(reopened.getProject('__proto__'), { status: 404 });
}));

test('registry rejects conflicting policies and common-dir aliases; independent clones stay distinct', () => fixture(async f => {
  const project = await f.store.registerProject(input(f.source));
  await git(f.source, 'branch', 'other');
  await assert.rejects(f.store.registerProject({ ...input(f.source), branchPolicy: { kind: 'local', branch: 'other' } }), { status: 409 });
  const subdir = join(f.source, 'sub');
  await mkdir(subdir);
  await assert.rejects(f.store.registerProject(input(subdir)), { status: 409 });
  const linked = join(f.base, 'linked');
  await git(f.source, 'worktree', 'add', linked, 'other');
  await assert.rejects(f.store.registerProject(input(linked)), { status: 409 });
  const clone = join(f.base, 'clone');
  await git(f.base, 'clone', '--', f.source, clone);
  assert.notEqual((await f.store.registerProject(input(clone))).projectId, project.projectId);
  assert.equal((await f.store.getProject(project.projectId)).source, f.source);
}));

test('invalid paths/checkouts/policies fail without registering or executing', () => fixture(async f => {
  const empty = join(f.base, 'empty'); await mkdir(empty);
  const unborn = join(f.base, 'unborn'); await mkdir(unborn); await git(unborn, 'init', '-b', 'trunk');
  const bare = join(f.base, 'bare'); await git(f.base, 'init', '--bare', bare);
  for (const source of ['relative', '', join(f.base, 'missing'), empty, unborn, bare, join(f.source, 'file.txt')]) {
    await assert.rejects(f.store.registerProject(input(source)), { status: 400 });
  }
  for (const branchPolicy of [null, {}, { kind: 'local', branch: 'missing' }, { kind: 'local', branch: 'bad..branch' },
    { kind: 'local', branch: '-trunk' }, { kind: 'remote', remote: '--bad' }, { kind: 'remote', remote: 'missing' }]) {
    await assert.rejects(f.store.registerProject({ ...input(f.source), branchPolicy }), { status: 400 });
  }
  for (const name of ['', '   ', null, 'x'.repeat(121)]) await assert.rejects(f.store.registerProject({ ...input(f.source), name }), { status: 400 });
  assert.equal((await f.store.listProjects()).length, 1); // no extra registrations
  assert.equal(f.calls(), 0);
}));

test('remote policy validation is offline; lookup rejects missing/replaced repository identities', () => fixture(async f => {
  const source = await repo(join(f.base, 'remote-source'));
  await git(source, 'remote', 'add', 'origin', 'https://example.invalid/not-contacted.git');
  const project = await f.store.registerProject({ ...input(source), branchPolicy: { kind: 'remote', remote: 'origin' } });
  assert.deepEqual((await f.store.getProject(project.projectId)).branchPolicy, { kind: 'remote', remote: 'origin' });
  await rename(source, source + '-saved');
  await assert.rejects(f.store.getProject(project.projectId), { status: 400 });
  await repo(source);
  await git(source, 'remote', 'add', 'origin', 'https://example.invalid/not-contacted.git');
  // A replacement at the same path must fail even when its branch policy matches.
  await assert.rejects(f.store.getProject(project.projectId), { status: 409 });
  await assert.rejects(f.store.registerProject({ ...input(source), branchPolicy: project.branchPolicy }), { status: 409 });
  await rename(source, source + '-replacement');
  await symlink(source + '-replacement', source);
  await assert.rejects(f.store.getProject(project.projectId), { status: 409 });
  assert.equal(f.calls(), 0);
}));

test('managed chat worktrees are not project sources and registry does not retarget legacy execution', () => fixture(async f => {
  const other = await repo(join(f.base, 'other'));
  await f.store.registerProject(input(other));
  await f.store.submit('legacy-request', 'hi', 'legacy-chat');
  let job;
  for (let i = 0; i < 300; i++) {
    job = await f.store.get('legacy-request');
    if (job.status === 'done') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(job.status, 'done');
  assert.equal(job.workspace.repositoryRoot, f.source);
  await assert.rejects(f.store.registerProject(input(job.workspace.path)), /Managed chat worktrees/);
  const relocated = join(f.base, 'relocated-chat');
  await git(f.source, 'worktree', 'move', job.workspace.path, relocated);
  await assert.rejects(f.store.registerProject(input(relocated)), /Managed chat worktrees/);
  assert.equal(f.calls(), 1);
}));
