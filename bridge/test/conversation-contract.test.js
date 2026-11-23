import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openStore } from '../src/store.js';
import { openWorkspaces } from '../src/workspaces.js';
import { makeServer } from '../src/server.js';
import { runPi } from '../src/rpc.js';

// B01 characterizes existing public store/HTTP behavior, not a future core.
// Only the external Pi peer is replaced; Git, Durable, RPC and HTTP are real.
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args])).stdout.trim();
const token = 'synthetic-conversation-contract-token'.repeat(2);
const peer = resolve('test/fake-pi.js');
async function wait(read, predicate) {
  for (let i = 0; i < 1200; i++) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Conversation characterization timed out');
}
async function fixture(fn) {
  const base = await mkdtemp(join(tmpdir(), 'mobile-conversation-contract-'));
  const source = join(base, 'source'), directory = join(base, 'state');
  let store, server;
  try {
    await mkdir(source);
    await git(source, 'init', '-b', 'trunk');
    await git(source, 'config', 'user.name', 'Conversation fixture');
    await git(source, 'config', 'user.email', 'fixture@example.invalid');
    await writeFile(join(source, 'file.txt'), 'source base\n');
    await git(source, 'add', '.'); await git(source, 'commit', '-m', 'fixture base');
    await writeFile(join(source, 'file.txt'), 'unrelated source staging\n');
    await git(source, 'add', 'file.txt');
    const sourceHead = await git(source, 'rev-parse', 'HEAD');
    const sourceIndex = await git(source, 'diff', '--cached', '--binary');
    const options = { directory, cwd: source, defaultBranch: 'trunk' };
    // A manifest-only chat is real saved binding evidence but has no job/task.
    const spaces = await openWorkspaces(options);
    const bindingOnly = await spaces.forSession('binding-only');
    await writeFile(join(bindingOnly.cwd, 'dirty-only.txt'), 'preserve dirty binding-only tree\n');
    const manifest = await readFile(bindingOnly.path + '.json', 'utf8');
    const launches = [];
    const dispatchPath = join(base, 'rpc-dispatches.txt');
    const runner = async input => {
      await appendFile(dispatchPath, input.id + '\n');
      const result = runPi({ ...input, bin: process.execPath, args: [peer] });
      launches.push({ id: input.id, cwd: input.cwd, args: [...input.args] });
      return result;
    };
    const close = async () => {
      if (server) {
        const current = server; server = undefined;
        current.closeAllConnections();
        await new Promise(resolve => current.close(resolve));
      }
      if (store) { const current = store; store = undefined; await current.close(); }
    };
    const reopen = async () => {
      await close();
      store = await openStore({ ...options, runner });
      server = makeServer(store, token, () => {});
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
    };
    await reopen();
    const request = async (path, body) => {
      const response = await fetch('http://127.0.0.1:' + server.address().port + path, {
        headers: { Authorization: 'Bearer ' + token },
        ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })
      });
      return { status: response.status, body: await response.json() };
    };
    try {
      await fn({ base, source, directory, options, bindingOnly, launches, dispatchPath,
        get store() { return store; }, request, reopen });
    } finally { await close(); }
    assert.equal(await git(source, 'rev-parse', 'HEAD'), sourceHead);
    assert.equal(await git(source, 'diff', '--cached', '--binary'), sourceIndex);
    assert.equal(await readFile(join(source, 'file.txt'), 'utf8'), 'unrelated source staging\n');
    assert.equal(await readFile(bindingOnly.path + '.json', 'utf8'), manifest);
    assert.equal(await readFile(join(bindingOnly.cwd, 'dirty-only.txt'), 'utf8'), 'preserve dirty binding-only tree\n');
  } finally {
    // Also release ownership if initial HTTP setup failed.
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (store) await store.close();
    await rm(base, { recursive: true, force: true });
  }
}
const terminal = (f, id, status = 'done') => wait(() => f.store.get(id), j => j?.status === status);
const sessionArg = launch => launch.args[launch.args.indexOf('--session-id') + 1];

test('B01: legacy and concurrent acceptance retain exact request, project and task identity across reopen', () => fixture(async f => {
  const projectId = (await f.store.listProjects())[0].projectId;
  const accepted = await f.request('/v1/jobs', { requestId: 'b01-legacy-job', text: 'hello' });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.id, 'b01-legacy-job');
  assert.equal(accepted.body.sessionId, 'pocket');
  assert.equal(accepted.body.projectId, projectId);
  assert.ok(Number.isSafeInteger(accepted.body.taskId) && accepted.body.taskId > 0,
    'Durable currently returns a numeric task ID; do not replace it with the client request ID');
  const done = await terminal(f, 'b01-legacy-job');
  assert.equal(done.answer, 'Hello\u2028world');
  assert.equal(sessionArg(f.launches[0]), 'pocket');
  assert.equal(f.launches[0].args[f.launches[0].args.indexOf('--session-dir') + 1], join(f.directory, 'pi-sessions'));

  const body = { requestId: 'b01-active-job', sessionId: 'chat-race', projectId, text: 'hang' };
  const sameId = await Promise.all([f.request('/v1/jobs', body), f.request('/v1/jobs', body)]);
  assert.deepEqual(sameId.map(r => r.status), [202, 202]);
  assert.equal(sameId[0].body.taskId, sameId[1].body.taskId);
  await wait(() => f.launches, rows => rows.some(row => row.id === body.requestId));
  for (const change of [{ text: 'changed' }, { sessionId: 'wrong-chat' }, { projectId: 'wrong-project' }]) {
    assert.equal((await f.request('/v1/jobs', { ...body, ...change })).status, 409);
  }
  assert.equal(await f.store.getSessionProject('wrong-chat'), null, 'refused acceptance must roll back a proposed binding');

  const racing = await Promise.all(['b01-racing-one', 'b01-racing-two'].map(requestId =>
    f.request('/v1/jobs', { requestId, text: 'hang', sessionId: 'single-flight', projectId })));
  assert.deepEqual(racing.map(r => r.status).sort(), [202, 409]);
  const winner = racing.find(r => r.status === 202).body;
  const loser = winner.id === 'b01-racing-one' ? 'b01-racing-two' : 'b01-racing-one';
  assert.equal(await f.store.get(loser), undefined);
  await wait(() => f.launches, rows => rows.length === 3);
  const dispatches = await readFile(f.dispatchPath, 'utf8');
  await f.reopen();
  const recovered = await terminal(f, body.requestId, 'interrupted');
  await terminal(f, winner.id, 'interrupted');
  assert.equal(recovered.taskId, sameId[0].body.taskId);
  assert.equal(recovered.projectId, projectId);
  assert.equal(recovered.sessionId, 'chat-race');
  assert.equal(recovered.pending, null);
  assert.deepEqual((await f.request('/v1/jobs', { requestId: done.id, text: done.text })).body, done);
  assert.equal((await f.request('/v1/jobs', body)).body.taskId, recovered.taskId);
  assert.equal(await readFile(f.dispatchPath, 'utf8'), dispatches, 'accepted retries/recovery must not dispatch again');
  assert.equal((await f.store.getSessionProject('binding-only')).projectId, projectId);
}));

test('B01: equal raw dialog IDs stay run-scoped; Stop and sequential replies preserve the other chat and Pi context', () => fixture(async f => {
  await Promise.all([
    f.store.submit('b01-dialog-a', 'confirm', 'chat-a'),
    f.store.submit('b01-dialog-b', 'confirm', 'chat-b')
  ]);
  const a = await wait(() => f.store.get('b01-dialog-a'), j => j?.pending);
  const b = await wait(() => f.store.get('b01-dialog-b'), j => j?.pending);
  assert.equal(a.pending.id, 'dialog'); assert.equal(b.pending.id, 'dialog');
  assert.equal(a.pending.method, 'confirm');
  await assert.rejects(f.store.respond(a.id, { id: 'wrong-dialog', confirmed: true }), { status: 409 });
  await assert.rejects(f.store.respond(a.id, { id: 'dialog', confirmed: 'true' }), { status: 400 });
  await f.store.cancel(b.id);
  assert.equal((await terminal(f, b.id, 'cancelled')).pending, null);
  assert.deepEqual((await f.store.get(a.id)).pending, a.pending);
  await assert.rejects(f.store.respond(b.id, { id: 'dialog', confirmed: true }), { status: 409 });
  await f.store.respond(a.id, { id: 'dialog', confirmed: false });
  const done = await terminal(f, a.id);
  assert.equal(done.answer, 'Hello\u2028world'); assert.equal(done.pending, null);
  await assert.rejects(f.store.respond(a.id, { id: 'dialog', confirmed: false }), { status: 409 },
    'current legacy sequential retry expires; durable approval receipts are B04, not implemented');
  await f.store.submit('b01-dialog-next', 'hello', 'chat-a');
  const next = await terminal(f, 'b01-dialog-next');
  assert.equal(next.workspace.path, done.workspace.path);
  assert.equal(next.workspace.branch, done.workspace.branch);
  assert.equal(next.projectId, done.projectId);
  // Launch order across independent chats is deliberately not an ordering contract.
  assert.deepEqual([a.id, b.id, next.id].map(id => sessionArg(f.launches.find(row => row.id === id))),
    ['pocket-chat-a', 'pocket-chat-b', 'pocket-chat-a']);
  const launchA = f.launches.find(row => row.id === a.id);
  const launchB = f.launches.find(row => row.id === b.id);
  assert.notEqual(launchA.cwd, launchB.cwd);
  const dispatches = await readFile(f.dispatchPath, 'utf8');
  await f.reopen();
  assert.deepEqual(await f.store.get(a.id), done);
  assert.equal((await f.store.get(b.id)).status, 'cancelled');
  assert.deepEqual(await f.store.get(next.id), next);
  assert.equal(await readFile(f.dispatchPath, 'utf8'), dispatches);
}));

test('B01: persisted pending dialog becomes interrupted on owner reopen and is never delivered or replayed', () => fixture(async f => {
  await f.store.submit('b01-pending-restart', 'confirm', 'pending-chat');
  const pending = await wait(() => f.store.get('b01-pending-restart'), j => j?.pending);
  const binding = await f.store.getSessionProject('pending-chat');
  const dispatches = await readFile(f.dispatchPath, 'utf8');
  const manifest = await readFile(pending.workspace.path + '.json', 'utf8');
  await writeFile(join(pending.workspace.cwd, 'uncertain.txt'), 'existing external effect; do not replay\n');
  await f.reopen();
  const recovered = await terminal(f, pending.id, 'interrupted');
  assert.equal(recovered.taskId, pending.taskId);
  assert.equal(recovered.projectId, pending.projectId);
  assert.deepEqual(recovered.workspace, pending.workspace);
  assert.equal(recovered.pending, null);
  assert.match(recovered.answer, /Inspect changes\/device state/);
  await assert.rejects(f.store.respond(pending.id, { id: pending.pending.id, confirmed: true }), { status: 409 });
  assert.deepEqual(await f.store.submit(pending.id, pending.text, pending.sessionId), recovered);
  await f.reopen();
  assert.deepEqual(await f.store.get(pending.id), recovered);
  assert.deepEqual(await f.store.getSessionProject('pending-chat'), binding);
  assert.equal(await readFile(f.dispatchPath, 'utf8'), dispatches);
  assert.equal(await readFile(pending.workspace.path + '.json', 'utf8'), manifest);
  assert.equal(await readFile(join(pending.workspace.cwd, 'uncertain.txt'), 'utf8'), 'existing external effect; do not replay\n');
}));

test('B01: saved repository-operation JSON and task identity survive dispatched uncertainty without a second shell effect', () => fixture(async f => {
  await f.store.submit('b01-review-setup', 'hello', 'review-chat');
  const setup = await terminal(f, 'b01-review-setup');
  const snapshot = await f.store.changes('review-chat');
  const body = { operationId: 'b01-review-operation', projectId: setup.projectId,
    action: 'test', revision: snapshot.revision,
    command: "printf 'B01_REVIEW_DISPATCH\\n' >> review-dispatch.txt; sleep 30" };
  const savedJson = JSON.stringify(body);
  const accepted = await f.request('/v1/sessions/review-chat/actions', body);
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.id, body.operationId);
  assert.equal(accepted.body.sessionId, 'review-chat');
  assert.equal(accepted.body.projectId, setup.projectId);
  const markerPath = join(setup.workspace.cwd, 'review-dispatch.txt');
  await wait(() => readFile(markerPath, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return ''; throw error;
  }), text => text === 'B01_REVIEW_DISPATCH\n');
  const retry = await f.request('/v1/sessions/review-chat/actions', JSON.parse(savedJson));
  assert.equal(retry.status, 202);
  assert.equal(retry.body.taskId, accepted.body.taskId);
  assert.equal((await f.request('/v1/sessions/review-chat/actions', { ...body, command: 'changed' })).status, 409);
  assert.equal((await f.request('/v1/sessions/wrong-review/actions', body)).status, 409);
  assert.equal(await f.store.getSessionProject('wrong-review'), null);
  await f.reopen();
  const recovered = await wait(() => f.store.getReview('review-chat', body.operationId), a => a.status === 'interrupted');
  assert.equal(recovered.taskId, accepted.body.taskId);
  assert.equal(recovered.projectId, setup.projectId);
  assert.deepEqual(recovered.input, { action: 'test', revision: body.revision, command: body.command });
  assert.match(recovered.result.message, /not replayed/);
  assert.deepEqual((await f.request('/v1/sessions/review-chat/actions', JSON.parse(savedJson))).body, recovered);
  await assert.rejects(f.store.getReview('wrong-review', body.operationId), { status: 404 });
  await f.reopen();
  assert.deepEqual(await f.store.getReview('review-chat', body.operationId), recovered);
  assert.equal(JSON.stringify(body), savedJson);
  assert.equal(await readFile(markerPath, 'utf8'), 'B01_REVIEW_DISPATCH\n');
}));

test('B01: synthetic Android v4 inventory distinguishes stale cache, backend-only results, local history and unresolved sends', () => fixture(async f => {
  const fixturePath = new URL('./fixtures/conversation-history-v4.json', import.meta.url);
  const bytes = await readFile(fixturePath, 'utf8');
  const history = JSON.parse(bytes);
  assert.equal(history.android.schemaVersion, 4);
  const cached = history.android.jobs.find(row => row.id === history.comparisons.sharedBackendRequest);
  assert.equal(cached.sessionId, 'shared-chat');
  await f.store.submit(cached.id, cached.text, cached.sessionId);
  const accepted = await terminal(f, cached.id);
  assert.equal(cached.status, 'running'); assert.equal(accepted.status, 'done');
  assert.equal(JSON.parse(cached.pending).id, 'dialog'); assert.equal(accepted.pending, null);
  assert.equal(cached.projectId, null); assert.ok(accepted.projectId);
  assert.equal(cached.answer, 'older cached text'); assert.equal(accepted.answer, 'Hello\u2028world');
  await f.store.submit(history.comparisons.backendOnlyRequest, 'hello', cached.sessionId);
  const remote = await terminal(f, history.comparisons.backendOnlyRequest);
  assert.equal(remote.sessionId, cached.sessionId);
  assert.ok(!history.android.jobs.some(row => row.id === remote.id), 'local active-row polling alone cannot discover this completed turn');

  for (const id of history.comparisons.androidOnlyRequests) assert.equal(await f.store.get(id), undefined);
  for (const id of ['history-only', 'uncertain-chat', 'selected-draft', 'pocket']) {
    assert.equal(await f.store.getSessionProject(id), null, 'inventory must not infer a backend binding');
  }
  const historical = history.android.jobs.filter(row => row.sessionId === 'history-only');
  assert.deepEqual(historical.map(row => row.id), ['history-z-first', 'history-a-second']);
  assert.deepEqual(historical.map(row => row.sourceRowid), [12, 13]);
  assert.equal(historical[0].created, historical[1].created, 'tie preserves source row evidence, not ID chronology');
  const uncertain = history.android.jobs.find(row => row.id === 'b01-local-uncertain');
  assert.equal(uncertain.status, 'sending'); assert.equal(uncertain.projectState, 'LEGACY_UNRESOLVED');
  assert.equal(uncertain.projectId, null);
  const archived = history.android.sessions.find(row => row.id === 'history-only');
  assert.equal(archived.archived, 1); assert.equal(archived.finished, 1);
  assert.equal(archived.draft, 'preserved archived draft');
  const preferences = history.android.preferences;
  const pendingJson = preferences['review-requests']['pending-shared-chat'];
  const operation = JSON.parse(pendingJson);
  assert.equal(operation.operationId, 'b01-saved-review');
  assert.ok(!Object.hasOwn(operation, 'projectId'), 'legacy pending operation JSON has no invented project');
  await assert.rejects(f.store.getReview('shared-chat', operation.operationId), { status: 404 });
  assert.equal(preferences['chat-ui'].selected, 'history-only');
  assert.equal((await f.store.getSessionProject(history.comparisons.bindingOnlySession)).projectId, accepted.projectId);

  const dispatches = await readFile(f.dispatchPath, 'utf8');
  await f.reopen();
  assert.deepEqual(await f.store.get(accepted.id), accepted);
  assert.deepEqual(await f.store.get(remote.id), remote);
  for (const id of history.comparisons.androidOnlyRequests) assert.equal(await f.store.get(id), undefined);
  assert.equal(await readFile(f.dispatchPath, 'utf8'), dispatches);
  assert.equal(JSON.stringify(history), JSON.stringify(JSON.parse(bytes)), 'inventory did not rewrite local evidence');
  assert.equal(await readFile(fixturePath, 'utf8'), bytes);
}));
