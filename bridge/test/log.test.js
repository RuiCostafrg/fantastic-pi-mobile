import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createLogger } from '../src/log.js';
import { makeServer } from '../src/server.js';

test('diagnostics exclude payloads, authorization and arbitrary URLs', async () => {
  const lines = [];
  const logger = createLogger(line => lines.push(line));
  logger('test', { status: 'done', text: 'PRIVATE_PROMPT', answer: 'PRIVATE_ANSWER', token: 'PRIVATE_TOKEN', error: 'PRIVATE_ERROR' });
  const server = makeServer({ submit: async id => ({ id, status: 'queued' }) }, 'PRIVATE_TOKEN'.repeat(4), logger);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    await (await fetch(url + '/PRIVATE_URL?token=PRIVATE_QUERY')).text();
    await (await fetch(url + '/v1/jobs', { method: 'POST', headers: { Authorization: 'Bearer ' + 'PRIVATE_TOKEN'.repeat(4) }, body: JSON.stringify({ requestId: 'log-request', text: 'PRIVATE_PROMPT' }) })).text();
    const output = lines.join('\n');
    assert.doesNotMatch(output, /PRIVATE_/);
    const events = lines.map(line => JSON.parse(line));
    assert.ok(events.some(e => e.event === 'http.complete' && e.route === 'other' && e.httpStatus === 401));
    assert.ok(events.some(e => e.route === 'submit' && e.httpStatus === 202 && typeof e.durationMs === 'number'));
  } finally { server.close(); server.closeAllConnections(); }
});
