import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { makeServer } from '../src/server.js';

// Real HTTP adapter around the exact bounded read envelope. The storage-level
// concurrent pinning/gaps/oversize matrix lives in conversation-reads.test.js.
test('B05 transport strips only internal fields, never enlarges a bounded read envelope', async () => {
  const ownerId = 'fixture-owner', token = 'fixture-token';
  const envelope = { schemaVersion: 1, ownerId, internalOnly: true, items: [{ record: { source: { taskId: 1, text: 'private' } } }], next: null };
  const store = { projectBindings: true, conversationCore: true, eventSchemaVersion: 1,
    getOwnerIdentity: async () => ({ ownerId }), readConversationSnapshot: async () => structuredClone(envelope),
    readConversationEvents: async () => structuredClone(envelope) };
  const server = makeServer(store, token, () => {});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    for (const path of ['/v1/conversations/chat', '/v1/conversations/chat/events']) {
      const response = await fetch('http://127.0.0.1:' + server.address().port + path, {
        headers: { Authorization: 'Bearer ' + token, 'X-Conversation-Schema': '1', 'X-Conversation-Owner': ownerId } });
      const text = await response.text();
      assert.equal(response.status, 200);
      assert.ok(Buffer.byteLength(text) < Buffer.byteLength(JSON.stringify(envelope)));
      assert.equal(JSON.parse(text).internalOnly, undefined);
      assert.equal(JSON.parse(text).items[0].record.source.taskId, undefined);
    }
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
