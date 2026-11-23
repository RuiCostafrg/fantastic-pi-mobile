// B10 isolated HTTP/Durable owner. No .env, production state or provider.
import { openStore } from '../src/store.js';
import { makeServer } from '../src/server.js';
import { runPi } from '../src/rpc.js';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
const [directory, a, b, tokenPath] = process.argv.slice(2);
if (!directory || !a || !b || !tokenPath) throw Error('Disposable state, projects and private token file required');
const token = await readFile(tokenPath, 'utf8');
const launches = [], submissions = [], dropped = [];
let store, backend, online = true, drop = false, barrier = null;
const requests = [];
async function rendezvous(kind) {
  if (barrier?.kind !== kind) return;
  const b = barrier;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Fixture rendezvous deadline')), 20000);
    b.waiters.push(() => { clearTimeout(timer); resolve(); });
    if (b.waiters.length === 2) { barrier = null; b.waiters.forEach(release => release()); }
  });
}
async function open() {
  store = await openStore({ directory, cwd: a, defaultBranch: 'trunk', runner: input => {
    launches.push({ id: input.id, sessionId: input.sessionId, projectId: input.projectId, cwd: input.cwd });
    return runPi({ ...input, bin: process.execPath, args: [resolve(import.meta.dirname, 'b10-rpc-worker.js')] });
  } });
  backend = makeServer(store, token, () => {}); backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
}
async function closeBackend() { backend.closeAllConnections(); await new Promise(r => backend.close(r)); await store.close(); }
await open();
const pa = (await store.listProjects())[0].projectId;
const pb = (await store.registerProject({ source: b, name: 'B10 B', branchPolicy: { kind: 'local', branch: 'trunk' } })).projectId;
const ownerId = (await store.getOwnerIdentity()).ownerId;
const proxy = createServer(async (req, res) => {
  try {
    if (!online) { req.socket.destroy(); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks), body = bytes.length ? JSON.parse(bytes) : null;
    if (req.method === 'POST') {
      requests.push({ path: req.url, body });
      if (req.url === '/v1/jobs') { submissions.push(body.requestId); await rendezvous('send'); }
      if (req.url.includes('/approvals/')) await rendezvous('approval');
    }
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => ['authorization', 'x-conversation-schema', 'x-conversation-owner', 'x-history-schema'].includes(k)));
    const response = await fetch('http://127.0.0.1:' + backend.address().port + req.url, { method: req.method, headers, ...(body ? { body: bytes } : {}), signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (drop && response.ok && req.method === 'POST' && (req.url === '/v1/jobs' || req.url.includes('/approvals/'))) {
      drop = false; dropped.push(body.requestId ?? body.responseId); req.socket.destroy(); return;
    }
    res.writeHead(response.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data));
  } catch { req.socket.destroy(); }
});
proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
const emit = v => console.log(JSON.stringify(v));
emit({ ready: true, endpoint: 'http://127.0.0.1:' + proxy.address().port, projectId: pa, projectB: pb, ownerId, pid: process.pid });
try {
  for await (const line of createInterface({ input: process.stdin })) {
    const c = JSON.parse(line);
    if (c.command === 'snapshot') {
      const jobs = {};
      for (const id of new Set(submissions)) {
        const j = await store.get(id); if (!j) continue;
        jobs[id] = { ...j };
        if (j.workspace) for (const name of ['.b10-dispatches', '.b10-contexts', '.b10-replies', 'context.txt']) jobs[id][name] = await readFile(join(j.workspace.cwd, name), 'utf8').catch(() => '');
      }
      emit({ ownerId: (await store.getOwnerIdentity()).ownerId, launches, submissions, dropped, requests, jobs });
    } else if (c.command === 'barrier') { barrier = { kind: c.kind, waiters: [] }; emit({ barrier: c.kind });
    } else if (c.command === 'release') {
      const j = await store.get(c.id); await writeFile(join(j.workspace.cwd, '.b10-release-' + j.text), 'release\n'); emit({ released: c.id });
    } else if (c.command === 'online' || c.command === 'offline') { online = c.command === 'online'; emit({ online }); }
    else if (c.command === 'drop') { drop = true; emit({ drop }); }
    else if (c.command === 'reopen') { await closeBackend(); await open(); emit({ ownerId: (await store.getOwnerIdentity()).ownerId }); }
    else if (c.command === 'close') break;
    else throw Error('Unknown control');
  }
} finally { proxy.closeAllConnections(); await new Promise(r => proxy.close(r)); await closeBackend(); }
process.stdin.destroy();
