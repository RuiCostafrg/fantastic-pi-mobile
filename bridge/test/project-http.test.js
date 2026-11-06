import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { openStore } from '../src/store.js';
import { makeServer } from '../src/server.js';

const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args])).stdout.trim();
const token = 'project-http-private-token'.repeat(3);
const delay = () => new Promise(resolve => setTimeout(resolve, 10));
async function repo(path) {
  await mkdir(path);
  await git(path, 'init', '-b', 'trunk');
  await git(path, 'config', 'user.name', 'HTTP test'); await git(path, 'config', 'user.email', 'test@example.invalid');
  await writeFile(join(path, 'file.txt'), 'base\n'); await git(path, 'add', '.'); await git(path, 'commit', '-m', 'base');
  return path;
}
const registration = source => ({ source, name: 'PRIVATE_PROJECT_NAME', branchPolicy: { kind: 'local', branch: 'trunk' }, confirmRegistration: true });
async function http(store, logs = []) {
  const server = makeServer(store, token, (event, data) => logs.push({ event, ...data }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return {
    async request(path, body, options = {}) {
      const response = await fetch('http://127.0.0.1:' + server.address().port + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: options.auth === false ? {} : { Authorization: 'Bearer ' + token },
        ...(body === undefined ? {} : { body: options.raw ? body : JSON.stringify(body) })
      });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return { status: response.status, body: await response.json() };
    },
    async close() { await new Promise(resolve => server.close(resolve)); server.closeAllConnections(); }
  };
}
async function fixture(fn) {
  const base = await mkdtemp(join(tmpdir(), 'mobile-project-http-'));
  const a = await repo(join(base, 'PRIVATE_SOURCE_A')), b = await repo(join(base, 'PRIVATE_SOURCE_B'));
  const logs = [], calls = [];
  const options = { directory: join(base, 'state'), cwd: a, defaultBranch: 'trunk', runner: async input => {
    calls.push(input);
    await writeFile(join(input.cwd, 'file.txt'), input.text + '\n');
    return input.text;
  } };
  let store, api;
  const reopen = async () => {
    if (api) await api.close();
    if (store) await store.close();
    store = await openStore(options); api = await http(store, logs);
  };
  try {
    await reopen();
    await fn({ base, a, b, logs, calls, options, reopen, request: (...args) => api.request(...args) });
  } finally { if (api) await api.close(); if (store) await store.close(); await rm(base, { recursive: true, force: true }); }
}
async function terminal(request, path) {
  for (let i = 0; i < 600; i++) {
    const result = await request(path);
    assert.equal(result.status, 200);
    if (!['queued', 'running'].includes(result.body.status)) { assert.equal(result.body.status, 'done', JSON.stringify(result.body)); return result.body; }
    await delay();
  }
  throw new Error('Timed out: ' + path);
}

test('authenticated project discovery/registration and two-project HTTP jobs/review survive reopen without retargeting', () => fixture(async f => {
  const req = f.request;
  for (const [path, body] of [['/health'], ['/v1/projects'], ['/v1/projects', registration(f.b)], ['/v1/sessions/unbound/project'],
    ['/v1/jobs', { requestId: 'unauth-job', text: 'PRIVATE_PROMPT', projectId: 'unknown' }]]) {
    assert.equal((await req(path, body, { auth: false })).status, 401);
  }
  const health = await req('/health');
  assert.equal(health.body.protocolVersion, 6); assert.equal(health.body.projectBindings, true);
  assert.equal(health.body.worktreeIsolation, true); assert.equal(health.body.changesReview, true);
  const listing = await req('/v1/projects'); assert.equal(listing.status, 200); assert.equal(listing.body.projects.length, 1);
  const pa = listing.body.projects[0]; assert.equal(pa.source, f.a);
  assert.equal(pa.repositoryIdentity, undefined); assert.equal(pa.commonDirectory, undefined);
  const before = await Promise.all([f.a, f.b].map(root => git(root, 'worktree', 'list', '--porcelain')));
  assert.equal((await req('/v1/sessions/unbound/project')).status, 404);
  const registered = await req('/v1/projects', registration(f.b)); assert.equal(registered.status, 200);
  const pb = registered.body;
  assert.notEqual(pb.projectId, pa.projectId); assert.equal(pb.source, f.b);
  assert.deepEqual(pb.branchPolicy, { kind: 'local', branch: 'trunk' });
  const alias = join(f.base, 'alias'); await symlink(f.b, alias);
  assert.equal((await req('/v1/projects', registration(alias))).body.projectId, pb.projectId);
  assert.equal((await req('/v1/projects')).body.projects.length, 2);
  assert.deepEqual(await Promise.all([f.a, f.b].map(root => git(root, 'worktree', 'list', '--porcelain'))), before);
  assert.equal(f.calls.length, 0);
  for (const [id, sessionId, projectId, text] of [['http-project-a', 'chat-a', pa.projectId, 'PRIVATE_PROMPT_A'], ['http-project-b', 'chat-b', pb.projectId, 'PRIVATE_PROMPT_B']]) {
    const accepted = await req('/v1/jobs', { requestId: id, sessionId, projectId, text });
    assert.equal(accepted.status, 202); assert.equal(accepted.body.projectId, projectId);
    const done = await terminal(req, '/v1/jobs/' + id);
    assert.equal(done.projectId, projectId); assert.equal(done.sessionId, sessionId);
    assert.equal(await readFile(join(done.workspace.cwd, 'file.txt'), 'utf8'), text + '\n');
    const binding = await req('/v1/sessions/' + sessionId + '/project');
    assert.deepEqual(binding.body, { sessionId, projectId });
    const summary = await req('/v1/sessions/' + sessionId + '/changes?summary=1');
    assert.equal(summary.body.projectId, projectId); assert.equal(summary.body.fileCount, 1);
    const review = await req('/v1/sessions/' + sessionId + '/changes');
    assert.equal(review.body.projectId, projectId);
    const diff = await req('/v1/sessions/' + sessionId + '/diff?scope=working&path=file.txt&revision=' + review.body.revision);
    assert.equal(diff.body.projectId, projectId); assert.ok(diff.body.text.includes(text));
  }
  const s = (await req('/v1/sessions/chat-b/changes')).body;
  const operation = { operationId: 'http-bound-review', projectId: pb.projectId, action: 'test', revision: s.revision, command: 'cat file.txt' };
  const accepted = await req('/v1/sessions/chat-b/actions', operation);
  assert.equal(accepted.status, 202); assert.equal(accepted.body.projectId, pb.projectId);
  const done = await terminal(req, '/v1/sessions/chat-b/actions/' + operation.operationId);
  assert.equal(done.projectId, pb.projectId); assert.equal(done.result.test.exitCode, 0); assert.match(done.result.test.output, /PRIVATE_PROMPT_B/);
  assert.equal((await req('/v1/sessions/chat-b/actions', { ...operation, projectId: pa.projectId })).status, 409);
  assert.equal((await req('/v1/jobs', { requestId: 'http-project-b', text: 'PRIVATE_PROMPT_B', sessionId: 'chat-b', projectId: pa.projectId })).status, 409);
  assert.equal((await req('/v1/jobs', { requestId: 'new-chat-conflict', text: 'hi', sessionId: 'chat-b', projectId: pa.projectId })).status, 409);
  // Omission remains compatible: an established chat stays bound, a legacy new chat uses default.
  assert.equal((await req('/v1/jobs', { requestId: 'old-client-bound', sessionId: 'chat-b', text: 'PRIVATE_NEXT_B' })).status, 202);
  assert.equal((await terminal(req, '/v1/jobs/old-client-bound')).projectId, pb.projectId);
  assert.equal((await req('/v1/jobs', { requestId: 'old-client-pocket', text: 'PRIVATE_LEGACY' })).status, 202);
  assert.equal((await terminal(req, '/v1/jobs/old-client-pocket')).projectId, pa.projectId);
  const originalCalls = f.calls.length;
  await f.reopen();
  assert.equal((await req('/v1/sessions/chat-b/project')).body.projectId, pb.projectId);
  assert.equal((await req('/v1/projects')).body.projects.length, 2);
  assert.equal((await req('/v1/jobs', { requestId: 'http-project-b', text: 'PRIVATE_PROMPT_B', sessionId: 'chat-b' })).body.projectId, pb.projectId);
  assert.equal((await req('/v1/sessions/chat-b/actions', operation)).body.projectId, pb.projectId);
  assert.equal(f.calls.length, originalCalls);
  for (const root of [f.a, f.b]) { assert.equal(await git(root, 'status', '--porcelain'), ''); assert.equal(await readFile(join(root, 'file.txt'), 'utf8'), 'base\n'); }
  const logged = JSON.stringify(f.logs);
  for (const privateValue of [f.base, f.a, f.b, token, 'PRIVATE_PROMPT', 'PRIVATE_PROJECT_NAME', 'cat file.txt']) assert.ok(!logged.includes(privateValue));
  assert.ok(f.logs.some(log => log.route === 'project'));
}));

test('HTTP rejects invalid/unknown projects and unconfirmed registration without binding or dispatch', () => fixture(async f => {
  const req = f.request;
  for (const confirmRegistration of [undefined, false, 'true', 1]) {
    assert.equal((await req('/v1/projects', { ...registration(f.b), confirmRegistration })).status, 400);
  }
  for (const change of [{ source: 'relative' }, { source: join(f.base, 'missing;echo PRIVATE') }, { name: '' },
    { branchPolicy: { kind: 'local', branch: 'missing' } }, { branchPolicy: { kind: 'remote', remote: '--bad' } }]) {
    assert.equal((await req('/v1/projects', { ...registration(f.b), ...change })).status, 400);
  }
  assert.equal((await req('/v1/projects', { ...registration(f.a), branchPolicy: { kind: 'remote', remote: 'origin' } })).status, 400);
  await git(f.a, 'branch', 'other');
  assert.equal((await req('/v1/projects', { ...registration(f.a), branchPolicy: { kind: 'local', branch: 'other' } })).status, 409);
  for (const projectId of [null, '', 4, {}, [], 'a'.repeat(81), '../source']) {
    assert.equal((await req('/v1/jobs', { requestId: 'invalid-project-id', text: 'PRIVATE', sessionId: 'unbound', projectId })).status, 400);
    assert.equal((await req('/v1/sessions/unbound/actions', { operationId: 'invalid-project-action', action: 'test', revision: 'a'.repeat(64), command: 'true', projectId })).status, 400);
  }
  for (const projectId of ['unknown-project', 'constructor', '__proto__']) {
    const result = await req('/v1/jobs', { requestId: 'unknown-project-id', text: 'PRIVATE', sessionId: 'unbound', projectId });
    assert.equal(result.status, projectId === '__proto__' ? 400 : 404);
  }
  assert.equal((await req('/v1/sessions/unbound/actions', { operationId: 'unknown-project-action', action: 'test', revision: 'a'.repeat(64), command: 'true', projectId: 'unknown-project' })).status, 404);
  assert.equal((await req('/v1/projects', '{broken', { raw: true })).status, 400);
  assert.equal((await req('/v1/projects', [])).status, 400);
  assert.equal((await req('/v1/projects', { ...registration(f.b), name: 'x'.repeat(65536) })).status, 413);
  assert.equal((await req('/v1/projects', { ...registration(f.b), name: 'x'.repeat(65536) }, { auth: false })).status, 401);
  assert.equal((await req('/v1/sessions/unbound/project')).status, 404);
  assert.equal((await req('/v1/projects')).body.projects.length, 1);
  assert.equal(f.calls.length, 0);
}));

test('an unsupported store never advertises project bindings or silently admits selected-project work', async () => {
  let calls = 0;
  const api = await http({ submit: async id => { calls++; return { id, status: 'queued' }; } });
  try {
    const health = (await api.request('/health')).body;
    assert.equal(health.protocolVersion, 4); assert.equal(health.projectBindings, false);
    assert.equal((await api.request('/v1/projects')).status, 426);
    assert.equal((await api.request('/v1/projects', registration('/not-used'))).status, 426);
    assert.equal((await api.request('/v1/sessions/chat/project')).status, 426);
    assert.equal((await api.request('/v1/jobs', { requestId: 'unsupported-selected', text: 'hi', projectId: 'selected-project' })).status, 426);
    assert.equal(calls, 0);
    assert.equal((await api.request('/v1/jobs', { requestId: 'legacy-supported', text: 'hi' })).status, 202);
    assert.equal(calls, 1);
  } finally { await api.close(); }
});
