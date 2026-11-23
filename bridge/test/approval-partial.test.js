import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApprovals, ApprovalIndex, ApprovalRuns } from '../src/approval-lifecycle.js';
import { Owner } from '../src/conversations.js';
import { ProjectionState } from '../src/conversation-projection.js';

// Narrow transaction double for red/green partial-index validation; durable
// rollback and all store integration use real disposable journals in the main suite.
test('B04a: a known run with unindexed partial evidence must not be silently adopted', async () => {
  const ownerId = '12345678-1234-4123-8123-123456789012';
  const data = new Map([[Owner, { baselineVersion: 1, ownerId }], [ProjectionState, { mode: 'live' }],
    [ApprovalIndex, { schemaVersion: 1, ownerId, runIds: [] }]]);
  const tx = { doc: async token => token === ApprovalRuns ? { partial: true } : data.get(token) ?? {} };
  await assert.rejects(initializeApprovals(tx, { bindings: { items: { chat: { projectId: 'project' } } },
    jobs: { items: { run: { id: 'run', sessionId: 'chat', projectId: 'project', status: 'done', pending: null } } } }), /Approval lifecycle/);
});
