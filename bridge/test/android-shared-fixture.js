// Explicit B08-only disposable owner; never reads .env or invokes Pi/provider tools.
// stdin controls fixture lifecycle; stdout contains only readiness/count metadata.
import { openStore } from '../src/store.js';
import { makeServer } from '../src/server.js';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
const [directory, cwd] = process.argv.slice(2);
if (!directory || !cwd) throw new Error('Disposable directory/repository required');
const token = 'b08-isolated-fixture-token-000000000000';
const dispatches = [], replies = [], dropped = [], imports = [], submissions = [], reviewSubmissions = [];
const inputs = new Map();
const store = await openStore({ directory, cwd, defaultBranch: 'trunk', runner: async input => {
  dispatches.push(input.id); inputs.set(input.id, input);
  if (!['hold', 'approve'].includes(input.text)) return 'B08_FIXTURE_RESULT';
  return new Promise((resolve, reject) => {
    input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true });
    input.clients.set(input.id, reply => { replies.push(input.id); resolve('B08_APPROVED_RESULT'); });
    if (input.text === 'approve') input.onEvent({ type: 'extension_ui_request', method: 'confirm', id: 'raw-fixture-dialog', title: 'B08 fixture permission', message: 'Allow this harmless fixture answer?' }).catch(reject);
  });
} });
const projectId = (await store.listProjects())[0].projectId;
const ownerId = (await store.getOwnerIdentity()).ownerId;
for (const [id, chat, text] of [['remote-finished-run', 'remote-finished', 'remote'], ['remote-held-run', 'archived-remote', 'hold'], ['remote-approval-run', 'approval-remote', 'approve']]) {
  await store.submit(id, text, chat, projectId, ownerId);
  for (let i = 0; i < 500; i++) {
    const job = await store.get(id);
    if (text === 'remote' ? job.status === 'done' : text === 'approve' ? job.pending : inputs.has(id)) break;
    await new Promise(r => setTimeout(r, 10));
    if (i === 499) throw new Error('Seed timeout');
  }
}
const backend = makeServer(store, token, () => {});
backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
const seen = new Set();
const proxy = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks), body = bytes.length ? JSON.parse(bytes) : null;
    if (req.method === 'POST' && req.url === '/v1/jobs') submissions.push(body.requestId);
    if (req.method === 'POST' && req.url.endsWith('/actions')) reviewSubmissions.push(body.operationId);
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([key]) => ['authorization', 'x-conversation-schema', 'x-conversation-owner', 'x-history-schema'].includes(key)));
    headers['content-type'] = 'application/json';
    const response = await fetch('http://127.0.0.1:' + backend.address().port + req.url, { method: req.method, headers, ...(body ? { body: bytes } : {}) });
    const data = await response.text();
    const importPath = req.method === 'POST' && req.url.endsWith('/history/imports');
    if (importPath) imports.push(body.importId);
    const drop = response.ok && (req.url === '/v1/jobs' && body?.text === 'lost-acceptance' ? body.requestId :
      importPath && body?.rows?.some(row => row.text === 'lost-import') ? body.importId :
      req.method === 'POST' && req.url.includes('/approvals/') ? body.responseId :
      req.method === 'POST' && req.url.endsWith('/actions') && body?.command === 'printf B08_REVIEW_OK' ? body.operationId : null);
    if (drop && !seen.has(drop)) { seen.add(drop); dropped.push(drop); req.socket.destroy(); return; }
    res.writeHead(response.status, { 'Content-Type': 'application/json' }); res.end(data);
  } catch { req.socket.destroy(); }
});
proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
console.log(JSON.stringify({ ready: true, endpoint: 'http://127.0.0.1:' + proxy.address().port, projectId, ownerId, pid: process.pid }));
try {
  for await (const line of createInterface({ input: process.stdin })) {
    const command = JSON.parse(line).command;
    if (command === 'snapshot') console.log(JSON.stringify({ dispatches, replies, dropped, imports, submissions, reviewSubmissions }));
    else if (command === 'close') break;
    else throw new Error('Unknown fixture command');
  }
} finally {
  for (const server of [proxy, backend]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await store.close();
}
process.stdin.destroy();
