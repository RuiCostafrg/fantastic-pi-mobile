// B10 separate-process recovery boundary. Only disposable paths, fake execution.
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { Harness, createRegistry, defineDoc, defineTask, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { openStore } from '../src/store.js';
import { makeServer } from '../src/server.js';
import { runPi } from '../src/rpc.js';
import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
const [mode, directory, cwd, tokenPath] = process.argv.slice(2);
if (!['seed', 'owner'].includes(mode) || !directory || !cwd) throw Error('Disposable arguments required');
if (mode === 'seed') {
  // Supported transaction APIs prepare one accepted but never dispatched task.
  const Jobs = defineDoc({ kind: 'pocket.jobs', version: 1, scope: 'session', initial: () => ({ items: {} }) });
  const Command = defineTask({ name: 'pocket.command', version: 1, initial: () => ({ phase: 'execute' }), phases: { execute: async () => { throw Error('Seed must not execute'); } } });
  const registry = createRegistry(); registry.install(defineExtension({ name: 'pocket', tasks: [Command] }));
  await mkdir(directory, { recursive: true });
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'assistant.sqlite')), { registry, models: createModels() }, ctx);
  try {
    const root = await harness.root(ctx);
    const taskId = await root.commit(async tx => {
      const taskId = await tx.createTask(Command, { id: 'b10-undispatched', text: 'ANDROID_A', sessionId: 'queued-chat' }, { ownership: { kind: 'conversation' } });
      (await tx.doc(Jobs)).items['b10-undispatched'] = { id: 'b10-undispatched', text: 'ANDROID_A', sessionId: 'queued-chat', taskId, status: 'queued' };
      return taskId;
    }, ctx);
    console.log(JSON.stringify({ seeded: true, taskId }));
  } finally { await harness.close(ctx); }
} else {
  const token = await readFile(tokenPath, 'utf8');
  const read = p => readFile(p, 'utf8').catch(() => '');
  const store = await openStore({ directory, cwd, defaultBranch: 'trunk', runner: async input => {
    await appendFile(join(directory, 'coding-launches'), input.id + '\n');
    return runPi({ ...input, bin: process.execPath, args: [resolve(import.meta.dirname, 'b10-rpc-worker.js')] });
  }, reviewActions: { execute: async (sessionId, input, signal) => {
    await appendFile(join(directory, 'review-launches'), JSON.stringify({ sessionId, input }) + '\n');
    await new Promise((_, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
  } } });
  const backend = makeServer(store, token, () => {}); backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  const emit = x => console.log(JSON.stringify(x));
  emit({ ready: true, endpoint: 'http://127.0.0.1:' + backend.address().port, ownerId: (await store.getOwnerIdentity()).ownerId, projectId: (await store.listProjects())[0].projectId, pid: process.pid });
  try {
    for await (const line of createInterface({ input: process.stdin })) {
      const c = JSON.parse(line);
      if (c.command === 'snapshot') {
        const jobs = {};
        for (const id of ['b10-undispatched', 'b10-dispatched-code', 'b10-dispatched-approval']) {
          const j = await store.get(id); if (j) jobs[id] = { ...j, dispatches: j.workspace ? await read(join(j.workspace.cwd, '.b10-dispatches')) : '', replies: j.workspace ? await read(join(j.workspace.cwd, '.b10-replies')) : '' };
        }
        const review = await store.getReview('review-chat', 'b10-dispatched-review').catch(() => null);
        emit({ jobs, review, codingLaunches: await read(join(directory, 'coding-launches')), reviewLaunches: await read(join(directory, 'review-launches')) });
      } else if (c.command === 'close') break;
      else throw Error('Unknown recovery control');
    }
  } finally { backend.closeAllConnections(); await new Promise(r => backend.close(r)); await store.close(); }
  process.stdin.destroy();
}
