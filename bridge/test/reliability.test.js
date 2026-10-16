import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { openStore } from '../src/store.js';
import { makeServer } from '../src/server.js';
import { runPi } from '../src/rpc.js';

const token = 'reliability-test-only-token-00000000';
async function waitFor(store, id, predicate) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const job = await store.get(id);
    if (predicate(job)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Timed out waiting for fixture state: ' + id);
}
async function temporary(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'pocket-reliability-'));
  try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
const options = directory => ({ directory, cwd: process.cwd(),
  workspaces: { forSession: async () => ({ cwd: process.cwd() }) } });
const fake = input => runPi({ ...input, bin: process.execPath, args: [resolve('test/fake-pi.js')] });
async function listen(store) {
  const server = makeServer(store, token, () => {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  return { server, request: (path, body, signal) => fetch(url + path, {
    signal, headers: { Authorization: 'Bearer ' + token },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {})
  }) };
}
async function stop(server) {
  const closed = once(server, 'close');
  server.close(); server.closeAllConnections();
  await closed;
}

test('lost HTTP acceptance response retries the same ID without dispatching a second job', () => temporary(async directory => {
  let calls = 0;
  const store = await openStore({ ...options(directory), runner: input => { calls++; return fake(input); } });
  const admitted = Promise.withResolvers();
  const release = Promise.withResolvers();
  let first = true;
  const { server, request } = await listen({ ...store, submit: async (...args) => {
    const job = await store.submit(...args);
    if (first) { first = false; admitted.resolve(); await release.promise; }
    return job;
  } });
  try {
    const body = { requestId: 'lost-http-response', sessionId: 'chat-a', text: 'confirm' };
    const controller = new AbortController();
    const lostResponse = request('/v1/jobs', body, controller.signal).catch(error => error);
    await admitted.promise; // The real Durable admission has committed, but no HTTP body was sent.
    controller.abort();
    assert.equal((await lostResponse).name, 'AbortError');
    release.resolve();
    const pending = await waitFor(store, body.requestId, job => job?.pending);
    assert.equal((await request('/v1/jobs', body)).status, 202);
    assert.equal((await request('/v1/jobs', { ...body, sessionId: 'chat-b' })).status, 409);
    await store.respond(body.requestId, { id: pending.pending.id, confirmed: false });
    await waitFor(store, body.requestId, job => job.status === 'done');
    const retry = await (await request('/v1/jobs', body)).json();
    assert.equal(retry.status, 'done');
    assert.equal(retry.sessionId, 'chat-a');
    assert.equal(calls, 1);
  } finally { release.resolve(); await stop(server); await store.close(); }
}));

test('an approval survives listener loss but expires on bridge restart, without replay in either chat', () => temporary(async directory => {
  let calls = 0;
  const config = { ...options(directory), runner: input => { calls++; return fake(input); } };
  let store = await openStore(config);
  let listener;
  try {
    await store.submit('approval-reconnect', 'confirm', 'chat-a');
    await store.submit('parallel-reconnect', 'hang', 'chat-b');
    await waitFor(store, 'approval-reconnect', job => job?.pending);
    await waitFor(store, 'parallel-reconnect', job => job?.workspace);
    listener = await listen(store);
    await stop(listener.server); listener = null;
    assert.equal((await store.get('approval-reconnect')).pending.id, 'dialog');
    assert.equal((await store.get('parallel-reconnect')).status, 'running');
    listener = await listen(store);
    const reconnected = await (await listener.request('/v1/jobs/approval-reconnect')).json();
    assert.equal(reconnected.sessionId, 'chat-a');
    assert.equal(reconnected.pending.id, 'dialog');
    await stop(listener.server); listener = null;
    await store.close();
    store = await openStore(config);
    for (const id of ['approval-reconnect', 'parallel-reconnect']) {
      const job = await waitFor(store, id, job => job?.status === 'interrupted');
      assert.equal(job.pending, null);
    }
    await assert.rejects(store.respond('approval-reconnect', { id: 'dialog', confirmed: true }), { status: 409 });
    assert.equal((await store.submit('approval-reconnect', 'confirm', 'chat-a')).status, 'interrupted');
    assert.equal(calls, 2);
  } finally { if (listener) await stop(listener.server); await store.close(); }
}));
