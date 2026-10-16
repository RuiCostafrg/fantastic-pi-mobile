// Disposable, same-phone lifecycle fixture. Never imports production .env or calls a model.
// stdin JSON commands control only this fixture's listener; stdout is a metadata-only protocol.
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { openStore } from '../src/store.js';
import { makeServer } from '../src/server.js';
import { runPi } from '../src/rpc.js';

const [directory, cwd, port] = process.argv.slice(2);
if (!directory || !cwd || !port) throw new Error('Expected disposable data directory, repository and port');
const launches = [];
const reads = {};
const store = await openStore({ directory, cwd, defaultBranch: 'main', runner: options => {
  launches.push(options.id);
  return runPi({ ...options, bin: process.execPath, args: [resolve(import.meta.dirname, 'fake-pi.js')] });
} });
const get = store.get.bind(store);
store.get = async id => {
  const job = await get(id);
  reads[id] = { count: (reads[id]?.count ?? 0) + 1, status: job?.status, pending: Boolean(job?.pending) };
  return job;
};
let server;
async function listen() {
  server = makeServer(store, 'pocket-reliability-fixture-only-token', () => {});
  server.listen(Number(port), '127.0.0.1');
  await once(server, 'listening');
}
async function disconnect() {
  const closed = once(server, 'close');
  server.close(); server.closeAllConnections();
  await closed;
}
const emit = value => console.log(JSON.stringify(value));
await listen(); emit({ ready: true });
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  if (server.listening) await disconnect();
  await store.close();
}
for await (const line of createInterface({ input: process.stdin })) {
  const { command } = JSON.parse(line);
  if (command === 'offline') { await disconnect(); emit({ offline: true }); }
  else if (command === 'online') { await listen(); emit({ online: true }); }
  else if (command === 'snapshot') {
    const jobs = {};
    for (const id of ['fixture-approval', 'fixture-parallel']) {
      const job = await get(id);
      jobs[id] = { status: job?.status, pending: Boolean(job?.pending) };
    }
    emit({ launches, reads, jobs });
  }
  else if (command === 'close') { await shutdown(); emit({ closed: true }); break; }
  else throw new Error('Unknown fixture command');
}
await shutdown();
process.stdin.destroy();
