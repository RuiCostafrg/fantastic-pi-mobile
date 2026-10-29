import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { openStore } from '../src/store.js';
import { makeServer } from '../src/server.js';
const exec = promisify(execFile), token = 'private-conversation-http-token'.repeat(2);
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args])).stdout.trim();
const wait = async (read, predicate) => {
  for (let i = 0; i < 500; i++) { const value = await read(); if (predicate(value)) return value; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('HTTP fixture timed out');
};
async function fixture(fn) {
  const base = await mkdtemp(join(tmpdir(), 'conversation-http-')), cwd = join(base, 'repo');
  await mkdir(cwd); await git(cwd, 'init', '-b', 'trunk');
  await git(cwd, 'config', 'user.name', 'Fixture'); await git(cwd, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(join(cwd, 'base'), 'base'); await git(cwd, 'add', '.'); await git(cwd, 'commit', '-m', 'base');
  await writeFile(join(cwd, 'staged'), 'keep'); await git(cwd, 'add', 'staged');
  const before = [await git(cwd, 'rev-parse', 'HEAD'), await git(cwd, 'diff', '--cached'), await git(cwd, 'worktree', 'list', '--porcelain')];
  const inputs = new Map(), dispatches = [], replies = [], logs = [];
  let store, server, ownerId, projectId, dropped;
  const options = { directory: join(base, 'state'), cwd, defaultBranch: 'trunk', runner: async input => {
    dispatches.push(input.id); inputs.set(input.id, input);
    if (input.text !== 'hold') return 'PRIVATE_RESULT';
    input.clients.set(input.id, reply => replies.push(reply));
    return new Promise((resolve, reject) => { input.finish = resolve; input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true }); });
  } };
  async function close() { if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); } if (store) await store.close(); }
  const req = async (path, body, overrides = {}) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + path, { method: body === undefined ? 'GET' : 'POST',
      headers: Object.fromEntries(Object.entries({ Authorization: 'Bearer ' + token, 'X-Conversation-Schema': '1', 'X-Conversation-Owner': ownerId, ...overrides }).filter(([, value]) => value !== undefined)),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, body: await response.json() };
  };
  const reopen = async () => {
    if (store) await close();
    store = await openStore(options);
    // Lose the whole acceptance response AFTER the actual owner admits the work.
    const submit = store.submit.bind(store);
    store.submit = async (...args) => { const value = await submit(...args); if (dropped) { const socket = dropped; dropped = null; socket.destroy(); } return value; };
    server = makeServer(store, token, (event, data) => logs.push({ event, ...data }));
    server.prependListener('request', request => { if (request.headers['x-fixture-drop'] === 'yes') dropped = request.socket; });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    ownerId = (await store.getOwnerIdentity()).ownerId; projectId = (await store.listProjects())[0].projectId;
  };
  try {
    await reopen();
    await fn({ req, reopen, inputs, dispatches, replies, logs, before, cwd, get ownerId() { return ownerId; }, get projectId() { return projectId; },
      get store() { return store; }, done: id => wait(() => store.get(id), j => j?.status === 'done') });
    assert.deepEqual([await git(cwd, 'rev-parse', 'HEAD'), await git(cwd, 'diff', '--cached')], before.slice(0, 2));
    const logged = JSON.stringify(logs);
    for (const secret of [token, base, 'PRIVATE_TEXT', 'PRIVATE_RESULT', 'PRIVATE_APPROVAL']) assert.ok(!logged.includes(secret));
  } finally { await close(); await rm(base, { recursive: true, force: true }); }
}
const query = (key, value) => key + '=' + encodeURIComponent(JSON.stringify(value));
const chat = id => '/v1/conversations/' + id;
const send = (f, id, conversationId, text = 'PRIVATE_TEXT') => ({ requestId: id, conversationId, projectId: f.projectId, text });

test('B05 HTTP: gated authenticated create is non-executing, idempotent, immutable and survives reopen', () => fixture(async f => {
  const create = { conversationId: 'empty-chat', projectId: f.projectId };
  for (const path of ['/health', '/v1/conversations', chat('empty-chat'), chat('empty-chat') + '/events'])
    assert.equal((await f.req(path, undefined, { Authorization: '' })).status, 401);
  assert.equal((await f.req('/v1/conversations', create, { 'X-Conversation-Schema': '' })).status, 426);
  assert.equal((await f.req('/v1/conversations', create, { 'X-Conversation-Owner': 'foreign' })).status, 409);
  const health = (await f.req('/health')).body;
  assert.equal(health.protocolVersion, 6); assert.equal(health.conversationCore, true); assert.equal(health.eventSchemaVersion, 1); assert.equal(health.ownerId, f.ownerId);
  assert.equal((await f.req(chat('missing'))).status, 404);
  assert.equal((await f.req('/v1/conversations', { ...create, ignored: 'x'.repeat(65536) })).status, 413);
  assert.equal((await f.req('/v1/conversations', create, { Authorization: '' })).status, 401);
  assert.equal((await f.req('/v1/conversations', create)).status, 200);
  assert.deepEqual(await f.req('/v1/conversations', create), await f.req('/v1/conversations', create));
  assert.equal((await f.req('/v1/conversations', { ...create, projectId: 'unknown' })).status, 409);
  assert.equal((await f.req('/v1/conversations', { ...create, conversationId: '../bad' })).status, 400);
  const snapshot = (await f.req(chat('empty-chat'))).body;
  assert.deepEqual(snapshot.items, []); assert.equal(snapshot.highWater, 0); assert.equal(snapshot.internalOnly, undefined);
  assert.equal(f.inputs.size, 0); assert.equal(await git(f.cwd, 'worktree', 'list', '--porcelain'), f.before[2]);
  const ownerId = f.ownerId;
  await f.reopen(); assert.equal(f.ownerId, ownerId);
  assert.deepEqual((await f.req(chat('empty-chat'))).body.after, snapshot.after);
}));

test('B05 HTTP: catalogue discovery, bounded pinned snapshots/events, token errors and legacy writes', () => fixture(async f => {
  for (const id of ['a', 'b']) {
    assert.equal((await f.req('/v1/jobs', send(f, 'remote-run-' + id, id))).status, 202); await f.done('remote-run-' + id);
  }
  const first = (await f.req('/v1/conversations?limit=1')).body;
  assert.equal(first.items.length, 1); assert.equal(first.items[0].currentRun.status, 'done');
  const second = (await f.req('/v1/conversations?limit=1&' + query('token', first.next))).body;
  assert.equal(second.items[0].conversationId, 'b'); assert.equal(second.next, null);
  const snapshot = (await f.req(chat('a') + '?limit=1')).body;
  assert.equal(snapshot.items[0].record.runId, 'remote-run-a');
  assert.equal(snapshot.items[0].record.source.taskId, undefined);
  // Old-client route adds the next turn to exactly the same projection.
  assert.equal((await f.req('/v1/jobs', { requestId: 'legacy-next-run', sessionId: 'a', text: 'PRIVATE_TEXT' }, { 'X-Conversation-Schema': undefined })).status, 202);
  await f.done('legacy-next-run');
  const feedPath = chat('a') + '/events?' + query('after', snapshot.after) + '&limit=1';
  const feed = await f.req(feedPath); assert.equal(feed.status, 200); assert.equal(feed.body.items.length, 1);
  assert.deepEqual(await f.req(feedPath), feed);
  let page = feed.body, count = page.items.length;
  while (page.next) { page = (await f.req(chat('a') + '/events?' + query('token', page.next) + '&limit=1')).body; count += page.items.length; }
  assert.ok(count >= 2);
  const pinned = (await f.req(chat('a') + '?limit=1')).body;
  assert.ok(pinned.next);
  assert.equal((await f.req('/v1/jobs', send(f, 'third-large-run', 'a', '大'.repeat(3000)))).status, 202);
  await f.done('third-large-run');
  const continuation = (await f.req(chat('a') + '?limit=1&' + query('token', pinned.next))).body;
  assert.equal(continuation.highWater, pinned.highWater);
  assert.equal(continuation.items[0].record.runId, 'legacy-next-run'); assert.equal(continuation.next, null);
  assert.deepEqual((await f.req(chat('a') + '?limit=1&' + query('token', pinned.next))).body, continuation);
  assert.equal((await f.req(chat('a') + '?maxBytes=1024')).status, 413);
  const boundedCatalogue = (await f.req('/v1/conversations?maxBytes=1024')).body;
  assert.ok(Buffer.byteLength(JSON.stringify(boundedCatalogue)) <= 1024);
  assert.equal((await f.req(chat('b') + '/events?' + query('after', snapshot.after))).status, 409);
  for (const patch of [{ ownerId: 'foreign' }, { generation: 'foreign' }, { sequence: 99999 }, { schemaVersion: 2 }])
    assert.equal((await f.req(chat('a') + '/events?' + query('after', { ...snapshot.after, ...patch }))).status, 409);
  for (const suffix of ['?limit=0', '?limit=201', '?maxBytes=1023', '?limit=1&limit=2', '?unknown=1', '?token=bad'])
    assert.equal((await f.req(chat('a') + suffix)).status, 400);
  assert.equal((await f.req(chat('a') + '?token=' + 'x'.repeat(8193))).status, 413);
  assert.equal((await f.req('/v1/jobs', { ...send(f, 'bad-shared-run', 'a'), sessionId: 'b' })).status, 400);
  assert.equal((await f.req('/v1/jobs', { requestId: 'bad-shared-run', conversationId: 'a', text: 'hello' })).status, 400);
}));

test('B05 HTTP: actual lost acceptance response retries same ID once; completed remote turn is discoverable', () => fixture(async f => {
  const body = send(f, 'lost-response-run', 'remote');
  await assert.rejects(f.req('/v1/jobs', body, { 'X-Fixture-Drop': 'yes' }));
  await f.done(body.requestId);
  assert.equal((await f.req('/v1/jobs', body)).status, 202);
  assert.equal(f.inputs.size, 1); assert.deepEqual(f.dispatches, [body.requestId]);
  assert.equal((await f.req('/v1/jobs', { ...body, text: 'different' })).status, 409);
  const listing = (await f.req('/v1/conversations')).body;
  assert.equal(listing.items[0].currentRun.runId, body.requestId); assert.equal(listing.items[0].currentRun.status, 'done');
  assert.equal((await f.req(chat('remote'))).body.items.length, 1);
}));

test('B05 HTTP: exact approval receipts, competing answers and run-scoped Stop cannot cross targets', () => fixture(async f => {
  for (const [id, conversationId] of [['approval-run-a', 'a'], ['approval-run-b', 'b']]) {
    assert.equal((await f.req('/v1/jobs', send(f, id, conversationId, 'hold'))).status, 202);
    const input = await wait(async () => f.inputs.get(id), Boolean);
    await input.onEvent({ type: 'extension_ui_request', method: 'confirm', id: 'dialog', title: 'PRIVATE_APPROVAL' });
  }
  const snapshot = (await f.req(chat('a'))).body, source = snapshot.items[0].record.source;
  const approvalId = source.approvalOccurrenceId;
  const path = chat('a') + '/approvals/' + encodeURIComponent(approvalId) + '/response';
  const body = { runId: 'approval-run-a', projectId: f.projectId, responseId: 'http-answer-a', answer: { confirmed: true } };
  assert.equal((await f.req(path.replace('/a/', '/b/'), body)).status, 409);
  assert.equal((await f.req(path, body, { Authorization: '' })).status, 401);
  assert.equal((await f.req(path, { ...body, conversationId: 'b' })).status, 409);
  assert.equal((await f.req('/v1/jobs/approval-run-a/cancel', { conversationId: 'a', projectId: f.projectId }, { Authorization: '' })).status, 401);
  const results = await Promise.all([f.req(path, body), f.req(path, { ...body, responseId: 'http-answer-b', answer: { confirmed: false } })]);
  assert.deepEqual(results.map(x => x.status).sort(), [200, 409]); assert.equal(f.replies.length, 1);
  const winner = results.find(x => x.status === 200).body;
  const retry = { ...body, responseId: winner.responseId, answer: winner.answer };
  assert.deepEqual((await f.req(path, retry)).body, winner); assert.equal(f.replies.length, 1);
  assert.equal((await f.req('/v1/jobs/approval-run-a/cancel', { conversationId: 'b', projectId: f.projectId })).status, 409);
  assert.equal((await f.req('/v1/jobs/approval-run-a/cancel', { conversationId: 'a', projectId: f.projectId })).status, 200);
  assert.equal((await f.store.get('approval-run-b')).status, 'running');
  assert.equal((await f.req('/v1/jobs/approval-run-a/cancel', { conversationId: 'a', projectId: f.projectId })).status, 200);
  await f.req('/v1/jobs/approval-run-b/cancel', { conversationId: 'b', projectId: f.projectId });
  await f.reopen(); assert.deepEqual((await f.req(path, retry)).body, winner); assert.equal(f.replies.length, 1);
}));

test('B05 HTTP: unsupported capability refuses shared requests without legacy fallback', async () => {
  let calls = 0;
  const server = makeServer({ projectBindings: true, submit: async () => { calls++; } }, token, () => {});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    for (const path of ['/v1/conversations', '/v1/jobs']) {
      const response = await fetch('http://127.0.0.1:' + server.address().port + path, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ conversationId: 'chat', projectId: 'project', requestId: 'no-fallback', text: 'hello' }) });
      assert.equal(response.status, 426);
    }
    assert.equal(calls, 0);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
