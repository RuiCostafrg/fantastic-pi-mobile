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
const fake = options => runPi({ ...options, bin: process.execPath, args: [fixture] });
async function waitFor(store, id, predicate) {
  for (let i = 0; i < 300; i++) {
    const job = await store.get(id);
    if (predicate(job)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out: ' + id);
}
async function temporary(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'pocket-sessions-'));
  try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('sessions run concurrently, isolate dialogs/cancellation and reuse only their own Pi context', () => temporary(async directory => {
  const launches = [];
  const runner = options => { launches.push({ id: options.id, args: options.args }); return fake(options); };
  let store = await openStore({ directory, cwd: process.cwd(), runner });
  try {
    await store.submit('session-job-a', 'confirm', 'chat-a');
    await store.submit('session-job-b', 'confirm', 'chat-b');
    await waitFor(store, 'session-job-a', job => job.pending);
    await waitFor(store, 'session-job-b', job => job.pending);
    assert.equal((await store.get('session-job-a')).status, 'running');
    assert.equal((await store.get('session-job-b')).status, 'running');
    assert.equal((await store.submit('session-job-a', 'confirm', 'chat-a')).id, 'session-job-a');
    await assert.rejects(store.submit('session-job-a', 'confirm', 'chat-b'), { status: 409 });
    await assert.rejects(store.submit('session-job-c', 'hi', 'chat-a'), { status: 409 });
    await store.respond('session-job-a', { id: 'dialog', confirmed: true });
    await waitFor(store, 'session-job-a', job => job.status === 'done');
    assert.equal((await store.get('session-job-b')).pending.id, 'dialog');
    await store.cancel('session-job-b');
    await waitFor(store, 'session-job-b', job => job.status === 'cancelled');
    assert.equal((await store.get('session-job-a')).status, 'done');
    await store.close();
    store = await openStore({ directory, cwd: process.cwd(), runner });
    assert.equal((await store.get('session-job-a')).sessionId, 'chat-a');
    await store.submit('session-job-d', 'hi', 'chat-a');
    await waitFor(store, 'session-job-d', job => job.status === 'done');
    const session = id => { const args = launches.find(x => x.id === id).args; return args[args.indexOf('--session-id') + 1]; };
    assert.notEqual(session('session-job-a'), session('session-job-b'));
    assert.equal(session('session-job-a'), session('session-job-d'));
    assert.equal(session('session-job-a'), 'pocket-chat-a');
  } finally { await store.close(); }
}));

test('same-session admission is atomic; independent sessions have a bounded parallel limit', () => temporary(async directory => {
  const store = await openStore({ directory, cwd: process.cwd(), runner: fake, maxConcurrent: 2 });
  try {
    const admitted = await Promise.allSettled([
      store.submit('atomic-job-a', 'hang', 'chat-a'),
      store.submit('atomic-job-b', 'hang', 'chat-a')
    ]);
    assert.equal(admitted.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(admitted.find(x => x.status === 'rejected').reason.status, 409);
    await store.submit('parallel-job-c', 'hang', 'chat-b');
    await waitFor(store, 'parallel-job-c', job => job.status === 'running');
    await assert.rejects(store.submit('parallel-job-d', 'hi', 'chat-c'), { status: 429 });
    await store.cancel('parallel-job-c');
    await waitFor(store, 'parallel-job-c', job => job.status === 'cancelled');
    await store.submit('parallel-job-d', 'hi', 'chat-c');
    await waitFor(store, 'parallel-job-d', job => job.status === 'done');
  } finally { await store.close(); }
}));

test('restart does not replay dispatched jobs in any session', () => temporary(async directory => {
  let calls = 0;
  const runner = options => { calls++; return fake(options); };
  let store = await openStore({ directory, cwd: process.cwd(), runner });
  await store.submit('restart-job-a', 'hang', 'chat-a');
  await store.submit('restart-job-b', 'hang', 'chat-b');
  await waitFor(store, 'restart-job-a', job => job.status === 'running');
  await waitFor(store, 'restart-job-b', job => job.status === 'running');
  await store.close();
  store = await openStore({ directory, cwd: process.cwd(), runner });
  try {
    await waitFor(store, 'restart-job-a', job => job.status === 'interrupted');
    await waitFor(store, 'restart-job-b', job => job.status === 'interrupted');
    assert.equal(calls, 2);
  } finally { await store.close(); }
}));

test('HTTP session validation and backward-compatible legacy conversation', () => temporary(async directory => {
  const launches = [];
  const store = await openStore({ directory, cwd: process.cwd(), runner: options => { launches.push(options.args); return fake(options); } });
  const token = 'a'.repeat(64);
  const server = makeServer(store, token);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const request = (path, body) => fetch('http://127.0.0.1:' + server.address().port + path, {
    headers: { Authorization: 'Bearer ' + token },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {})
  });
  try {
    assert.equal((await (await request('/health')).json()).protocolVersion, 2);
    for (const sessionId of ['', '../pocket', 'a'.repeat(81), 4, null]) {
      assert.equal((await request('/v1/jobs', { requestId: 'invalid-session', text: 'hi', sessionId })).status, 400);
    }
    assert.equal((await request('/v1/jobs', { requestId: 'legacy-job', text: 'hi' })).status, 202);
    await waitFor(store, 'legacy-job', job => job.status === 'done');
    assert.equal((await store.get('legacy-job')).sessionId, 'pocket');
    assert.equal(launches[0][launches[0].indexOf('--session-id') + 1], 'pocket');
    assert.equal((await request('/v1/jobs', { requestId: 'new-chat-job', text: 'hi', sessionId: 'new-chat' })).status, 202);
    await waitFor(store, 'new-chat-job', job => job.status === 'done');
    assert.equal((await (await request('/v1/jobs/new-chat-job')).json()).sessionId, 'new-chat');
  } finally { server.close(); server.closeAllConnections(); await store.close(); }
}));

test('trusted Pi flags cannot accidentally override conversation isolation', () => temporary(async directory => {
  for (const flag of ['--session-id', '--session=x', '--continue', '-c', '--no-session']) {
    await assert.rejects(openStore({ directory, cwd: process.cwd(), extraArgs: [flag] }), /session/i);
  }
}));
