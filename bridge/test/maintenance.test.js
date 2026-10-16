import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { openStore } from '../src/store.js';
import { makeServer } from '../src/server.js';
import { identity, idleEvidence } from '../../scripts/bridge-work.mjs';

async function fixture(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'pocket-maintenance-'));
  let finishReview;
  const store = await openStore({ directory, cwd: process.cwd(),
    workspaces: { forSession: async () => ({ cwd: process.cwd() }) },
    runner: async () => 'harmless result',
    reviewActions: { execute: async () => new Promise(r => { finishReview = r; }) }
  });
  const server = makeServer(store, 'private-test-token'.repeat(4), () => {});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const request = (path, body, authenticated = true) => fetch('http://127.0.0.1:' + server.address().port + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: authenticated ? { Authorization: 'Bearer ' + 'private-test-token'.repeat(4) } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  try { await fn({ directory, store, request, ready: () => Boolean(finishReview), finish: () => finishReview({ ok: true }) }); }
  finally { server.close(); server.closeAllConnections(); await store.close(); await rm(directory, { recursive: true, force: true }); }
}
async function until(check) {
  for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 10)); }
  assert.fail('Timed out');
}
const action = { operationId: 'maintenance-review', action: 'test', revision: 'a'.repeat(64), command: 'unused' };

test('maintenance is authenticated, validates input, blocks new IDs but preserves exact-ID recovery', () => fixture(async ({ store, request, directory }) => {
  assert.equal((await request('/v1/maintenance', { paused: true }, false)).status, 401);
  assert.equal((await request('/v1/maintenance', { paused: 'true' })).status, 400);
  await store.submit('already-completed', 'hello');
  await until(async () => (await store.get('already-completed')).status === 'done');
  const paused = await (await request('/v1/maintenance', { paused: true })).json();
  assert.deepEqual(paused, { admissionsPaused: true, jobs: 0, reviews: 0, idle: true });
  assert.equal((await request('/v1/jobs', { requestId: 'blocked-request', text: 'no' })).status, 429);
  assert.equal((await request('/v1/sessions/chat/actions', action)).status, 429);
  assert.equal((await request('/v1/jobs', { requestId: 'already-completed', text: 'hello' })).status, 202);
  assert.equal(idleEvidence(directory).idle, true);
  await request('/v1/maintenance', { paused: false });
  await store.submit('allowed-request', 'hello');
  await until(async () => (await store.get('allowed-request')).status === 'done');
}));

test('pause does not cancel review work; all-task evidence catches repository activity', () => fixture(async ({ store, directory, ready, finish }) => {
  await store.reviewAction('chat', action);
  await until(ready);
  assert.equal(idleEvidence(directory).idle, false);
  assert.deepEqual(await store.maintenance(true), { admissionsPaused: true, jobs: 0, reviews: 1, idle: false });
  assert.equal((await store.reviewAction('chat', action)).id, action.operationId);
  await assert.rejects(store.reviewAction('other', { ...action, operationId: 'new-review-id' }), { status: 429 });
  finish();
  await until(async () => (await store.maintenance()).idle);
  await until(() => idleEvidence(directory).idle);
}));

test('pause/admission race is serialized: every admitted job is counted or already finished', () => fixture(async ({ store }) => {
  const results = await Promise.allSettled([
    store.maintenance(true),
    ...Array.from({ length: 6 }, (_, n) => store.submit('racing-job-' + n, 'hello', 'chat' + n))
  ]);
  assert.equal(results[0].status, 'fulfilled');
  for (const result of results.slice(1)) { assert.equal(result.status, 'rejected'); assert.equal(result.reason.status, 429); }
  assert.equal((await store.maintenance()).idle, true);
}));

test('workflow refuses malformed/stale/wrong-process storage owners without signalling', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pocket-owner-'));
  try {
    await writeFile(join(directory, 'bridge.lock'), '-1');
    await assert.rejects(identity(directory), /Invalid storage owner/);
    await writeFile(join(directory, 'bridge.lock'), '2147483647');
    await assert.rejects(identity(directory), { code: 'OWNER_PROCESS_MISSING' });
    await writeFile(join(directory, 'bridge.lock'), String(process.pid));
    await assert.rejects(identity(directory), /identity mismatch/);
    assert.throws(() => idleEvidence(directory));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
