import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openStore } from '../src/store.js';
import { historyDigest } from '../src/conversation-history.js';
const exec = promisify(execFile);
const wait = async read => { for (let n = 0; n < 500; n++) { const x = await read(); if (x) return x; await new Promise(r => setTimeout(r, 10)); } throw new Error('No live fixture sender'); };
test('B06: imported done status/cached dialog cannot complete, expire or answer a current live approval', async () => {
  const base = await mkdtemp(join(tmpdir(), 'history-active-')), cwd = join(base, 'repo');
  await mkdir(cwd);
  const git = async (...args) => exec('git', ['-C', cwd, ...args]);
  await git('init', '-b', 'trunk'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'test@example.invalid');
  await writeFile(join(cwd, 'base'), 'base'); await git('add', '.'); await git('commit', '-m', 'fixture');
  let input; const replies = [];
  const store = await openStore({ cwd, directory: join(base, 'state'), defaultBranch: 'trunk', runner: async current => {
    input = current; current.clients.set(current.id, reply => replies.push(reply));
    return new Promise((resolve, reject) => current.signal.addEventListener('abort', () => { current.clients.delete(current.id); reject(current.signal.reason); }, { once: true }));
  } });
  try {
    const runId = 'current-approval-run';
    await store.submit(runId, 'hello', 'live-chat'); await wait(async () => input);
    await input.onEvent({ type: 'extension_ui_request', method: 'confirm', id: 'dialog', title: 'Live approval' });
    const before = await store.get(runId), approval = await store.inspectApprovalEvidence(runId);
    const manifest = { schemaVersion: 1, ownerId: approval.ownerId, conversationId: 'live-chat', importId: 'cached-live-import', projectId: null,
      provenance: { kind: 'android-v4', sourceId: 'fixture-export' }, session: {},
      rows: [{ requestId: runId, ordinal: 1, text: 'hello', answer: 'Unverified local completion', clientStatus: 'done', projectId: null, pending: '{"id":"dialog","confirmed":true}' }] };
    manifest.digest = historyDigest(manifest);
    const receipt = await store.importHistory(manifest); assert.equal(receipt.decisions[0].classification, 'backend-reference');
    assert.deepEqual(await store.get(runId), before); assert.deepEqual(await store.inspectApprovalEvidence(runId), approval); assert.deepEqual(replies, []);
    const view = await store.readHistory(approval.ownerId, 'live-chat');
    assert.deepEqual(view.items[0].messages, []); assert.equal(view.items[0].actionable, false);
    await store.answerApproval({ ownerId: approval.ownerId, conversationId: 'live-chat', projectId: approval.projectId, runId,
      approvalId: approval.currentOccurrenceId, responseId: 'explicit-answer-id', answer: { confirmed: false } });
    assert.deepEqual(replies, [{ type: 'extension_ui_response', id: 'dialog', confirmed: false }]);
    await store.cancel(runId);
  } finally { await store.close(); await rm(base, { recursive: true, force: true }); }
});
