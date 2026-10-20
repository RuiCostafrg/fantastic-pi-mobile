import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);
const token = 'project-lifecycle-fixture-only-token-0000';
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args])).stdout.trim();
async function wait(predicate) {
  for (let i = 0; i < 600; i++) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Lifecycle fixture timed out');
}

test('independent two-project HTTP worker survives lost responses/client disconnect with exact IDs, scoped approval/cancel/review and no crossed writes', { timeout: 60000 }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'mobile-project-lifecycle-'));
  let child, lines, exited = false;
  async function reply() {
    let timer;
    try {
      const result = await Promise.race([lines.next(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fixture control timeout')), 15000); })]);
      assert.equal(result.done, false); return JSON.parse(result.value);
    } finally { clearTimeout(timer); }
  }
  const control = async command => { child.stdin.write(JSON.stringify({ command }) + '\n'); return reply(); };
  try {
    const roots = [join(base, 'a'), join(base, 'b')];
    for (const root of roots) {
      await mkdir(root); await git(root, 'init', '-b', 'trunk');
      await git(root, 'config', 'user.name', 'Lifecycle fixture'); await git(root, 'config', 'user.email', 'fixture@example.invalid');
      await writeFile(join(root, 'file.txt'), 'base\n'); await git(root, 'add', '.'); await git(root, 'commit', '-m', 'base');
      await writeFile(join(root, 'keep.txt'), 'staged source\n'); await git(root, 'add', 'keep.txt');
    }
    const indexes = await Promise.all(roots.map(root => git(root, 'diff', '--cached', '--binary')));
    child = spawn(process.execPath, [new URL('./project-lifecycle-fixture.js', import.meta.url).pathname, join(base, 'state'), ...roots], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.resume(); child.on('exit', () => { exited = true; });
    lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const ready = await reply(); assert.equal(ready.ready, true); assert.notEqual(ready.pid, process.pid);
    const [pa, pb] = ready.projects;
    const request = async (path, body) => {
      const response = await fetch(ready.endpoint + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
      return { status: response.status, body: await response.json() };
    };
    const a = { requestId: 'lifecycle-project-a', sessionId: 'chat-a', projectId: pa, text: 'CONFIRM_A' };
    const b = { requestId: 'lifecycle-project-b', sessionId: 'chat-b', projectId: pb, text: 'HOLD_B' };
    await assert.rejects(request('/v1/jobs', a));
    assert.equal((await request('/v1/jobs', b)).status, 202);
    await wait(async () => { const s = await control('snapshot'); return s.jobs[a.requestId]?.pending === 'approval-a' && s.jobs[b.requestId]?.dispatches === 'HOLD_B\n'; });
    assert.equal((await request('/v1/jobs/' + b.requestId + '/ui', { id: 'approval-a', confirmed: true })).status, 409);
    assert.equal((await request('/v1/jobs/' + a.requestId + '/ui', { id: 'foreign-dialog', confirmed: true })).status, 409);
    await control('offline');
    await assert.rejects(request('/health'));
    // Only stdin control remains: no HTTP client connected while the worker finishes B.
    await control('release-b');
    const during = await wait(async () => { const s = await control('snapshot'); return s.jobs[b.requestId]?.status === 'done' ? s : null; });
    assert.equal(during.jobs[a.requestId].status, 'running'); assert.equal(during.jobs[a.requestId].pending, 'approval-a');
    assert.equal(during.jobs[b.requestId].answer, 'RESULT_HOLD_B');
    await control('recover'); await control('online');
    for (const body of [a, b]) {
      const retry = await request('/v1/jobs', body); assert.equal(retry.status, 202);
      assert.equal(retry.body.projectId, body.projectId); assert.equal(retry.body.sessionId, body.sessionId);
      assert.equal((await request('/v1/jobs', { ...body, projectId: body === a ? pb : pa })).status, 409);
    }
    const cancel = { requestId: 'lifecycle-cancel-b', sessionId: 'chat-c', projectId: pb, text: 'CANCEL_B' };
    assert.equal((await request('/v1/jobs', cancel)).status, 202);
    await wait(async () => (await control('snapshot')).jobs[cancel.requestId]?.dispatches === 'CANCEL_B\n');
    assert.equal((await request('/v1/jobs/' + cancel.requestId + '/cancel', {})).status, 200);
    await wait(async () => (await request('/v1/jobs/' + cancel.requestId)).body.status === 'cancelled');
    const stillPending = (await request('/v1/jobs/' + a.requestId)).body;
    assert.equal(stillPending.status, 'running'); assert.equal(stillPending.pending.id, 'approval-a');
    assert.equal((await request('/v1/jobs/' + b.requestId)).body.status, 'done');
    assert.equal((await request('/v1/jobs/' + a.requestId + '/ui', { id: 'approval-a', confirmed: false })).status, 200);
    await wait(async () => (await request('/v1/jobs/' + a.requestId)).body.status === 'done');
    const snapshot = (await request('/v1/sessions/chat-b/changes')).body;
    const operation = { operationId: 'lifecycle-review-b', action: 'test', projectId: pb, revision: snapshot.revision,
      command: "printf 'once\\n' >> .fixture-review-dispatches; cat file.txt" };
    await control('drop'); await assert.rejects(request('/v1/sessions/chat-b/actions', operation));
    await wait(async () => (await request('/v1/sessions/chat-b/actions/' + operation.operationId)).body.status === 'done');
    await control('recover');
    const recovered = await request('/v1/sessions/chat-b/actions', operation);
    assert.equal(recovered.body.id, operation.operationId); assert.equal(recovered.body.projectId, pb);
    assert.equal(recovered.body.result.test.exitCode, 0); assert.match(recovered.body.result.test.output, /HOLD_B/);
    assert.equal((await request('/v1/sessions/chat-a/actions/' + operation.operationId)).status, 404);
    assert.equal((await request('/v1/sessions/chat-b/actions', { ...operation, projectId: pa })).status, 409);
    assert.equal(await readFile(join(snapshot.workspace.cwd, '.fixture-review-dispatches'), 'utf8'), 'once\n');
    assert.equal((await request('/v1/jobs/' + a.requestId)).body.status, 'done');
    assert.equal((await request('/v1/jobs/' + b.requestId)).body.status, 'done');
    const final = await control('snapshot');
    assert.deepEqual(final.launches, [a.requestId, b.requestId, cancel.requestId]);
    assert.ok(final.dropped.includes(a.requestId)); assert.ok(final.dropped.includes(operation.operationId));
    assert.notEqual(final.jobs[a.requestId].cwd, final.jobs[b.requestId].cwd);
    assert.equal(final.jobs[a.requestId].dispatches, 'CONFIRM_A\n');
    assert.equal(await readFile(join(final.jobs[a.requestId].cwd, 'file.txt'), 'utf8'), 'CONFIRM_A\n');
    assert.equal(await readFile(join(final.jobs[b.requestId].cwd, 'file.txt'), 'utf8'), 'HOLD_B\n');
    assert.equal(final.jobs[cancel.requestId].dispatches, 'CANCEL_B\n');
    assert.deepEqual(await Promise.all(roots.map(root => git(root, 'diff', '--cached', '--binary'))), indexes);
    for (const root of roots) assert.equal(await readFile(join(root, 'file.txt'), 'utf8'), 'base\n');
    assert.equal(exited, false, 'the independent worker never restarted when HTTP clients disconnected');
    assert.equal((await control('close')).closed, true);
    await wait(() => exited); assert.equal(child.exitCode, 0);
  } finally {
    if (child && !exited) {
      try { child.stdin.write('{"command":"close"}\n'); await wait(() => exited); } catch { /* preserve potentially live fixture state */ }
    }
    if (!child || exited) await rm(base, { recursive: true, force: true });
    else throw new Error('Fixture did not close; preserved disposable state at ' + base);
  }
});
