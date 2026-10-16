import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { openStore } from '../src/store.js';
import { runPi } from '../src/rpc.js';
import { makeServer } from '../src/server.js';

const fixture = resolve('test/fake-pi.js');
const runner = options => runPi({ ...options, bin: process.execPath, args: [fixture] });
async function waitFor(store, id, predicate) {
  for (let i = 0; i < 300; i++) {
    const job = await store.get(id);
    if (predicate(job)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for ' + id + ': ' + JSON.stringify(await store.get(id)));
}
async function temporary(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'pocket-'));
  try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
test('SQLite persistence, deduplication, busy rejection and dialogs', () => temporary(async directory => {
  let store = await openStore({ directory, cwd: process.cwd(), runner });
  try {
    await store.submit('request-one', 'confirm');
    await waitFor(store, 'request-one', job => job.pending);
    assert.equal((await store.submit('request-one', 'confirm')).id, 'request-one');
    await assert.rejects(store.submit('request-one', 'different'), /different text/);
    await assert.rejects(store.submit('request-two', 'test'), /Another command/);
    await assert.rejects(store.respond('request-one', { id: 'wrong', confirmed: true }), /expired/);
    await store.respond('request-one', { id: 'dialog', confirmed: false });
    const done = await waitFor(store, 'request-one', job => job.status === 'done');
    assert.equal(done.answer, 'Hello\u2028world');
    await store.close();
    store = await openStore({ directory, cwd: process.cwd(), runner });
    assert.equal((await store.get('request-one')).status, 'done');
    assert.equal((await store.submit('request-one', 'confirm')).status, 'done');
  } finally { await store.close(); }
}));
test('interrupted external commands are not replayed on reopen', () => temporary(async directory => {
  let calls = 0;
  const counted = options => { calls++; return runner(options); };
  let store = await openStore({ directory, cwd: process.cwd(), runner: counted });
  await store.submit('request-hang', 'hang');
  await waitFor(store, 'request-hang', job => job.status === 'running');
  await store.close();
  store = await openStore({ directory, cwd: process.cwd(), runner: counted });
  try {
    await waitFor(store, 'request-hang', job => job.status === 'interrupted');
    assert.equal(calls, 1);
  } finally { await store.close(); }
}));
test('cancellation, provider failure, handled commands, and exclusive storage lock', () => temporary(async directory => {
  const store = await openStore({ directory, cwd: process.cwd(), runner });
  try {
    await assert.rejects(openStore({ directory, cwd: process.cwd(), runner }), /locked/);
    await store.submit('request-hang', 'hang');
    await waitFor(store, 'request-hang', job => job.status === 'running');
    await store.cancel('request-hang');
    await waitFor(store, 'request-hang', job => job.status === 'cancelled');
    await store.submit('request-fail', 'failure');
    const failed = await waitFor(store, 'request-fail', job => job.status === 'failed');
    assert.match(failed.answer, /Provider failed/);
    await store.submit('request-command', '/handled');
    await waitFor(store, 'request-command', job => job.status === 'done');
  } finally { await store.close(); }
}));
test('HTTP auth, validation, admission and retrieval', () => temporary(async directory => {
  const store = await openStore({ directory, cwd: process.cwd(), runner });
  const token = 'a'.repeat(64);
  const server = makeServer(store, token);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  const request = (path, body, auth = true) => fetch(url + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: auth ? { Authorization: 'Bearer ' + token } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  try {
    assert.equal((await request('/health', undefined, false)).status, 401);
    assert.equal((await request('/health')).status, 200);
    assert.equal((await request('/v1/jobs', { requestId: 'bad', text: '' })).status, 400);
    assert.equal((await request('/v1/jobs', null)).status, 400);
    assert.equal((await request('/v1/jobs', { requestId: 'http-request', text: 'hi' })).status, 202);
    await waitFor(store, 'http-request', job => job.status === 'done');
    assert.equal((await (await request('/v1/jobs/http-request')).json()).answer, 'Hello\u2028world');
    assert.equal((await request('/v1/jobs/not-found')).status, 404);
  } finally { server.close(); server.closeAllConnections(); await store.close(); }
}));
test('RPC timeout stops a hung child', async () => {
  await assert.rejects(runPi({ bin: process.execPath, args: [fixture], cwd: process.cwd(), text: 'hang', signal: new AbortController().signal,
    onEvent: async () => {}, clients: new Map(), id: 'timeout', timeoutMs: 50 }), /timed out/);
});
