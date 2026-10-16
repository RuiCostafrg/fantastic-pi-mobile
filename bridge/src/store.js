import { mkdir, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { Harness, createRegistry, defineDoc, defineTask, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { runPi } from './rpc.js';
import { log } from './log.js';
import { openWorkspaces } from './workspaces.js';

export const DEFAULT_MAX_CONCURRENT = 8;
export const MAX_CONCURRENT = 32;

const Jobs = defineDoc({ kind: 'pocket.jobs', version: 1, scope: 'session', initial: () => ({ items: {} }) });
export const active = job => ['queued', 'running'].includes(job.status);
export const validSessionId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id);
const sessionOf = job => job.sessionId ?? 'pocket';

export async function openStore({ directory, cwd, bin = 'pi', extraArgs = [], runner = runPi,
  maxConcurrent = DEFAULT_MAX_CONCURRENT, defaultBranch, remote = 'origin', workspaces }) {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > MAX_CONCURRENT) throw new Error('maxConcurrent must be an integer between 1 and ' + MAX_CONCURRENT);
  const sessionFlags = new Set(['--session', '--session-id', '--session-dir', '--continue', '--resume', '--fork', '--no-session', '-c', '-r']);
  if (extraArgs.some(arg => sessionFlags.has(arg.split('=')[0]))) throw new Error('PI_ARGS cannot override session isolation');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Explicit exclusive lock: Durable storage itself has no multi-process locking.
  const lockPath = resolve(directory, 'bridge.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw new Error('Storage locked. Stop the other bridge; after a crash, remove bridge.lock only after verifying no bridge is running.'); });
  await lock.writeFile(String(process.pid));
  const clients = new Map();
  let harness, root, spaces;
  const update = async (id, patch, runtime) => {
    const change = async tx => { Object.assign((await tx.doc(Jobs)).items[id], patch); };
    await (runtime ? runtime.commit(async tx => { await change(tx); }, ctx) : harness.commit(change, ctx));
    if (patch.status) log('job.state', { requestId: id, status: patch.status });
  };
  const complete = async (task, runtime, status, answer) => {
    await runtime.commit(async tx => {
      Object.assign((await tx.doc(Jobs)).items[task.input.id], { status, answer, pending: null });
      await tx.appendEntry(runtime.conversationId, { kind: 'pocket.result', data: { requestId: task.input.id, status, answer } });
      return { status: 'terminal', outcome: { status: 'completed', result: { status } } };
    }, ctx);
    log('job.state', { requestId: task.input.id, status });
  };
  const Command = defineTask({
    name: 'pocket.command', version: 1, initial: () => ({ phase: 'execute' }),
    phases: {
      execute: async (task, runtime) => {
        // Commit intent BEFORE the external process. A crash thereafter is ambiguous:
        // NEVER rerun a coding/device action automatically.
        if (await runtime.memo('dispatched', ctx)) {
          await complete(task, runtime, 'interrupted', 'Bridge restarted during a command. Inspect changes/device state before sending a new request.');
          return;
        }
        await runtime.memo('dispatched', true, ctx);
        await update(task.input.id, { status: 'running', pending: null }, runtime);
        try {
          await update(task.input.id, { progress: 'Preparing this chat’s isolated Git worktree…' }, runtime);
          const workspace = await spaces.forSession(task.input.sessionId ?? 'pocket', runtime.signal);
          runtime.signal.throwIfAborted();
          await update(task.input.id, { workspace, progress: 'Working in this chat’s own Git worktree' }, runtime);
          const answer = await runner({
            bin, cwd: workspace.cwd,
            args: [...extraArgs, '--mode', 'rpc', '--session-dir', resolve(directory, 'pi-sessions'), '--session-id', (task.input.sessionId ?? 'pocket') === 'pocket' ? 'pocket' : 'pocket-' + task.input.sessionId,
              '--append-system-prompt', 'Pi Pocket workspace: this chat has its own Git worktree at ' + workspace.cwd +
              '. Branch: ' + (workspace.branch ?? 'test') + '. Work inside this checkout, not paths remembered from earlier turns. ' +
              'Do not switch branches, edit other checkouts, merge, or push unless explicitly requested. Uncommitted files from the original checkout were not copied. Phone actions are still shared.'],
            text: task.input.text, signal: runtime.signal, clients, id: task.input.id,
            onEvent: async event => {
              if (event.type === 'extension_ui_request') {
                if (['confirm', 'select', 'input', 'editor'].includes(event.method)) await update(task.input.id, { pending: event }, runtime);
                else if (event.message || event.statusText) await update(task.input.id, { progress: String(event.message ?? event.statusText).slice(-2000) }, runtime);
              } else if (event.type.startsWith('tool_execution')) {
                await update(task.input.id, { progress: event.type + ': ' + event.toolName, pending: null }, runtime);
              } else if (event.message?.role === 'assistant') {
                const answer = (event.message.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('').slice(-100000);
                if (answer) await update(task.input.id, { answer, pending: null }, runtime);
              }
            }
          });
          await complete(task, runtime, 'done', answer || 'Command handled by Pi.');
        } catch (error) {
          if (runtime.signal.aborted) throw error;
          await complete(task, runtime, 'failed', String(error.message).slice(-4000));
        }
      }
    },
    abort: async (task, runtime) => complete(task, runtime, 'cancelled', 'Stopped. Already-completed file/device changes are not rolled back.')
  });
  try {
    spaces = workspaces ?? await openWorkspaces({ cwd, directory, defaultBranch, remote });
    const registry = createRegistry();
    registry.install(defineExtension({ name: 'pocket', tasks: [Command] }));
    harness = await Harness.open(await openNodeSqliteStorage(resolve(directory, 'assistant.sqlite')), { registry, models: createModels() }, ctx);
    root = await harness.root(ctx);
    await harness.commit(async tx => { await tx.doc(Jobs); }, ctx);
    harness.resume();
  } catch (error) { await lock.close(); await unlink(lockPath); throw error; }
  return {
    async get(id) { return (await harness.snapshot(Jobs, ctx)).items[id]; },
    maxConcurrent,
    async submit(id, text, sessionId = 'pocket') {
      if (!validSessionId(sessionId)) throw Object.assign(new Error('Invalid sessionId'), { status: 400 });
      const result = await root.commit(async tx => {
        const jobs = await tx.doc(Jobs);
        if (jobs.items[id]) {
          if (jobs.items[id].text !== text || sessionOf(jobs.items[id]) !== sessionId) throw Object.assign(new Error('Request ID reused with different text or session'), { status: 409 });
          return JSON.parse(JSON.stringify(jobs.items[id]));
        }
        const running = Object.values(jobs.items).filter(active);
        if (running.some(job => sessionOf(job) === sessionId)) throw Object.assign(new Error('Another command is running in this session; stop it or wait.'), { status: 409 });
        if (running.length >= maxConcurrent) throw Object.assign(new Error('Parallel session limit reached; this request will retry when a slot is free.'), { status: 429 });
        const taskId = await tx.createTask(Command, { id, text, sessionId }, { ownership: { kind: 'conversation' } });
        const job = { id, text, sessionId, taskId, status: 'queued', answer: '', progress: '', pending: null, createdAt: Date.now() };
        jobs.items[id] = job;
        await tx.appendEntry(root.id, { kind: 'pocket.input', data: { requestId: id, text } });
        return job;
      }, ctx);
      log('job.admitted', { requestId: id, sessionId, status: result.status });
      harness.resume();
      return result;
    },
    async cancel(id) {
      const job = await this.get(id);
      if (!job) throw Object.assign(new Error('Unknown request'), { status: 404 });
      await harness.abortTask(job.taskId, ctx);
    },
    async respond(id, response) {
      const job = await this.get(id);
      const p = job?.pending;
      if (!p || response.id !== p.id || !clients.has(id)) throw Object.assign(new Error('Dialog expired; refresh the request'), { status: 409 });
      const reply = { type: 'extension_ui_response', id: p.id };
      if (response.cancelled === true) reply.cancelled = true;
      else if (p.method === 'confirm' && typeof response.confirmed === 'boolean') reply.confirmed = response.confirmed;
      else if (['input', 'editor', 'select'].includes(p.method) && typeof response.value === 'string' && response.value.length <= 20000 && (p.method !== 'select' || p.options.includes(response.value))) reply.value = response.value;
      else throw Object.assign(new Error('Invalid dialog response'), { status: 400 });
      await update(id, { pending: null });
      clients.get(id)?.(reply);
    },
    async close() { try { await harness.close(ctx); } finally { await lock.close(); await unlink(lockPath); } }
  };
}
