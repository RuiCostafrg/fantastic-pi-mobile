import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
const exec = promisify(execFile);
import { randomBytes } from 'node:crypto';
const helper = resolve('test/b10-recovery-fixture.js');
function peer(argv) {
  const child = spawn(process.execPath, argv, { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  const queue = [], readers = [];
  createInterface({ input: child.stdout }).on('line', line => { const value = JSON.parse(line); readers.length ? readers.shift()(value) : queue.push(value); });
  return { child, next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise((r, reject) => {
    const timer = setTimeout(() => reject(Error('B10 child response deadline')), 10000);
    readers.push(v => { clearTimeout(timer); r(v); });
  }), async call(c) { child.stdin.write(JSON.stringify(c) + '\n'); return this.next(); }, async close() {
    const exited = once(child, 'exit'); child.stdin.write('{"command":"close"}\n'); await exited; assert.equal(child.exitCode, 0);
  } };
}
async function wait(read, predicate) {
  for (let i = 0; i < 300; i++) { const value = await read(); if (predicate(value)) return value; await new Promise(r => setTimeout(r, 20)); }
  throw Error('B10 recovery state deadline');
}

test('B10 separate owner processes: undispatched original task runs once; dispatched coding/review/answered approval remain interrupted, never replay', { timeout: 60000 }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'b10-recovery-')), cwd = join(base, 'source'), directory = join(base, 'state');
  const peers = [], token = randomBytes(32).toString('hex'), tokenPath = join(base, 'token');
  const git = async (...args) => (await exec('git', ['-C', cwd, ...args])).stdout;
  try {
    await writeFile(tokenPath, token, { mode: 0o600 });
    await mkdir(cwd);
    for (const args of [['init', '-b', 'trunk'], ['config', 'user.name', 'Fixture'], ['config', 'user.email', 'fixture@example.invalid']]) await git(...args);
    await writeFile(join(cwd, 'context.txt'), ''); await git('add', '.'); await git('commit', '-m', 'fixture');
    await writeFile(join(cwd, 'staged.txt'), 'KEEP'); await git('add', 'staged.txt');
    const original = [await git('rev-parse', 'HEAD'), await git('diff', '--cached', '--binary')];
    const seed = JSON.parse((await exec(process.execPath, [helper, 'seed', directory, cwd])).stdout);
    assert.equal(seed.seeded, true);
    async function owner() {
      const p = peer([helper, 'owner', directory, cwd, tokenPath]); peers.push(p);
      const ready = await p.next(); assert.equal(ready.pid, p.child.pid);
      const request = async (path, body) => {
        const response = await fetch(ready.endpoint + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'X-Conversation-Schema': '1', 'X-Conversation-Owner': ready.ownerId, 'X-History-Schema': '1' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
        return { status: response.status, body: await response.json() };
      };
      return { ...p, ...ready, request };
    }
    let p = await owner();
    const queued = await wait(() => p.call({ command: 'snapshot' }), s => s.jobs['b10-undispatched']?.status === 'done');
    const job = queued.jobs['b10-undispatched'];
    assert.equal(job.taskId, seed.taskId); assert.equal(job.sessionId, 'queued-chat'); assert.equal(job.projectId, p.projectId);
    assert.equal(job.dispatches, 'ANDROID_A\n'); assert.equal(queued.codingLaunches, 'b10-undispatched\n');
    const identity = p.ownerId, projectId = p.projectId;
    await p.close(); p = await owner();
    assert.equal(p.ownerId, identity); assert.deepEqual(await p.call({ command: 'snapshot' }), queued);
    const submits = [
      { requestId: 'b10-dispatched-code', conversationId: 'code-chat', projectId, text: 'RACE_A' },
      { requestId: 'b10-dispatched-approval', conversationId: 'approval-chat', projectId, text: 'UNCERTAIN_APPROVAL' }
    ];
    for (const body of submits) assert.equal((await p.request('/v1/jobs', body)).status, 202);
    const active = await wait(() => p.call({ command: 'snapshot' }), s => s.jobs['b10-dispatched-code']?.dispatches && s.jobs['b10-dispatched-approval']?.approvalOccurrenceId);
    const pending = active.jobs['b10-dispatched-approval'];
    const response = { runId: pending.id, projectId, responseId: 'b10-uncertain-answer', answer: { confirmed: true } };
    const receipt = await p.request('/v1/conversations/approval-chat/approvals/' + encodeURIComponent(pending.approvalOccurrenceId) + '/response', response);
    assert.equal(receipt.status, 200); assert.equal(receipt.body.responseId, response.responseId);
    assert.equal(receipt.body.delivery, 'attempted');
    const operation = { operationId: 'b10-dispatched-review', projectId, action: 'test', revision: 'a'.repeat(64), command: 'B10_FAKE_REVIEW_ONLY' };
    assert.equal((await p.request('/v1/sessions/review-chat/actions', operation)).status, 202);
    const uncertain = await wait(() => p.call({ command: 'snapshot' }), s => s.review?.status === 'running' && s.reviewLaunches.includes('B10_FAKE_REVIEW_ONLY') && s.jobs[pending.id].replies.includes('b10-raw'));
    const treeIdentities = {};
    for (const [id, j] of Object.entries(uncertain.jobs)) {
      treeIdentities[id] = { manifest: await readFile(j.workspace.path + '.json', 'utf8'), branch: (await exec('git', ['-C', j.workspace.cwd, 'symbolic-ref', 'HEAD'])).stdout, head: (await exec('git', ['-C', j.workspace.cwd, 'rev-parse', 'HEAD'])).stdout };
    }
    assert.equal(uncertain.jobs[pending.id].status, 'running', 'pipe attempt is not completion');
    assert.equal(uncertain.jobs[pending.id].replies.trim().split('\n').length, 1);
    await p.close();
    for (let reopen = 0; reopen < 2; reopen++) {
      p = await owner(); assert.equal(p.ownerId, identity); assert.equal(p.projectId, projectId);
      const recovered = await wait(() => p.call({ command: 'snapshot' }), s => s.jobs[pending.id]?.status === 'interrupted' && s.jobs['b10-dispatched-code']?.status === 'interrupted' && s.review?.status === 'interrupted');
      assert.equal(recovered.codingLaunches, uncertain.codingLaunches);
      assert.equal(recovered.reviewLaunches, uncertain.reviewLaunches);
      for (const id of Object.keys(uncertain.jobs)) {
        assert.equal(recovered.jobs[id].taskId, uncertain.jobs[id].taskId);
        assert.deepEqual(recovered.jobs[id].workspace, uncertain.jobs[id].workspace);
        assert.equal(recovered.jobs[id].dispatches, uncertain.jobs[id].dispatches);
        assert.equal(recovered.jobs[id].replies, uncertain.jobs[id].replies);
        assert.equal(recovered.jobs[id].projectId, projectId);
        const space = recovered.jobs[id].workspace;
        assert.deepEqual({ manifest: await readFile(space.path + '.json', 'utf8'), branch: (await exec('git', ['-C', space.cwd, 'symbolic-ref', 'HEAD'])).stdout, head: (await exec('git', ['-C', space.cwd, 'rev-parse', 'HEAD'])).stdout }, treeIdentities[id]);
      }
      assert.equal(recovered.review.id, operation.operationId); assert.equal(recovered.review.taskId, uncertain.review.taskId);
      assert.deepEqual(recovered.review.input, uncertain.review.input);
      assert.equal(recovered.jobs[pending.id].pending, null);
      assert.deepEqual(recovered.jobs[pending.id].approvalResponse, receipt.body);
      // Same receipt is retrievable; a fresh response ID cannot replay the pipe.
      assert.equal((await p.request('/v1/conversations/approval-chat/approvals/' + encodeURIComponent(pending.approvalOccurrenceId) + '/response', { ...response, responseId: 'b10-never-new-answer' })).status, 409);
      assert.equal((await p.request('/v1/sessions/review-chat/actions', operation)).body.id, operation.operationId);
      assert.deepEqual((await p.call({ command: 'snapshot' })).reviewLaunches, uncertain.reviewLaunches);
      await p.close();
    }
    assert.deepEqual([await git('rev-parse', 'HEAD'), await git('diff', '--cached', '--binary')], original);
    assert.equal(await readFile(join(cwd, 'context.txt'), 'utf8'), '');
  } finally {
    for (const p of peers) if (p.child.exitCode === null) { const exited = once(p.child, 'exit'); p.child.kill('SIGTERM'); await exited; }
    await rm(base, { recursive: true, force: true });
  }
});
