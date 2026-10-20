// Explicit disposable fixture. Does not load .env, use production storage or call a provider.
// stdin/stdout: metadata/control only. The authenticated proxy drops complete accepted
// responses for designated IDs, not requests, so a client must recover uncertain work.
import { resolve, join } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { openStore } from '../src/store.js';
import { makeServer } from '../src/server.js';
import { runPi } from '../src/rpc.js';

const [directory, a, b] = process.argv.slice(2);
if (!directory || !a || !b) throw new Error('Expected disposable state and two repository paths');
const token = 'project-lifecycle-fixture-only-token-0000';
const launches = [], dropped = [], jobs = ['lifecycle-project-a', 'lifecycle-project-b', 'lifecycle-cancel-b'];
const store = await openStore({ directory, cwd: a, defaultBranch: 'trunk', runner: options => {
  launches.push(options.id);
  return runPi({ ...options, bin: process.execPath, args: [resolve(import.meta.dirname, 'project-lifecycle-pi.js')] });
} });
const pa = (await store.listProjects())[0];
const pb = await store.registerProject({ source: b, name: 'Fixture B', branchPolicy: { kind: 'local', branch: 'trunk' } });
const backend = makeServer(store, token, () => {});
backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
let online = true, dropJobs = true, dropReview = true;
const sockets = new Set();
const proxy = createServer(async (req, res) => {
  try {
    if (!online) { req.socket.destroy(); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const upstream = await fetch('http://127.0.0.1:' + backend.address().port + req.url, {
      method: req.method, headers: { Authorization: req.headers.authorization ?? '', 'Content-Type': 'application/json' },
      ...(req.method === 'POST' ? { body } : {})
    });
    const data = await upstream.text();
    const value = req.method === 'POST' ? JSON.parse(body.toString()) : {};
    if (upstream.status === 202 && ((dropJobs && value.requestId === jobs[0]) || (dropReview && value.operationId === 'lifecycle-review-b'))) {
      dropped.push(value.requestId ?? value.operationId); req.socket.destroy(); return;
    }
    res.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(data);
  } catch { req.socket.destroy(); }
});
proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
const emit = value => console.log(JSON.stringify(value));
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const ends = [proxy, backend].map(server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  for (const socket of sockets) socket.destroy();
  await Promise.all(ends); await store.close();
}
emit({ ready: true, endpoint: 'http://127.0.0.1:' + proxy.address().port, projects: [pa.projectId, pb.projectId], pid: process.pid });
try {
  for await (const line of createInterface({ input: process.stdin })) {
    const { command } = JSON.parse(line);
    if (command === 'online' || command === 'offline') {
      online = command === 'online'; if (!online) for (const socket of sockets) socket.destroy();
      emit({ online });
    } else if (command === 'recover') { dropJobs = dropReview = false; emit({ recovering: true }); }
    else if (command === 'drop') { dropJobs = dropReview = true; emit({ dropping: true }); }
    else if (command === 'drop-review') { dropReview = true; emit({ droppingReview: true }); }
    else if (command === 'release-b') {
      const job = await store.get(jobs[1]);
      if (!job?.workspace?.cwd) throw new Error('B not dispatched');
      await writeFile(join(job.workspace.cwd, '.fixture-release'), 'release\n'); emit({ released: true });
    } else if (command === 'snapshot') {
      const records = {};
      for (const id of jobs) {
        const job = await store.get(id);
        records[id] = job ? { id, sessionId: job.sessionId, projectId: job.projectId, status: job.status,
          pending: job.pending?.id ?? null, answer: job.answer, cwd: job.workspace?.cwd,
          dispatches: job.workspace ? await readFile(join(job.workspace.cwd, '.fixture-dispatches'), 'utf8').catch(() => '') : '' } : null;
      }
      emit({ launches, dropped, jobs: records });
    } else if (command === 'close') { await close(); emit({ closed: true }); break; }
    else throw new Error('Unknown command');
  }
} finally { await close(); }
process.stdin.destroy();
