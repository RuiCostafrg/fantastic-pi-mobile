import { mkdir, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { Harness, createRegistry, defineDoc, defineTask, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { runPi } from './rpc.js';
import { log } from './log.js';
import { openWorkspaces } from './workspaces.js';
import { createReview } from './review.js';

export const DEFAULT_MAX_CONCURRENT = 8;
export const MAX_CONCURRENT = 32;

const Jobs = defineDoc({ kind: 'pocket.jobs', version: 1, scope: 'session', initial: () => ({ items: {} }) });
const Reviews = defineDoc({ kind: 'pocket.reviews', version: 1, scope: 'session', initial: () => ({ items: {} }) });
export const active = job => ['queued', 'running'].includes(job.status);
export const validSessionId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id);
const sessionOf = job => job.sessionId ?? 'pocket';

export async function openStore({ directory, cwd, bin = 'pi', extraArgs = [], runner = runPi,
  maxConcurrent = DEFAULT_MAX_CONCURRENT, defaultBranch, remote = 'origin', workspaces, reviewActions }) {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > MAX_CONCURRENT) throw new Error('maxConcurrent must be an integer between 1 and ' + MAX_CONCURRENT);
  const sessionFlags = new Set(['--session', '--session-id', '--session-dir', '--continue', '--resume', '--fork', '--no-session', '-c', '-r']);
  if (extraArgs.some(arg => sessionFlags.has(arg.split('=')[0]))) throw new Error('PI_ARGS cannot override session isolation');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Explicit exclusive lock: Durable storage itself has no multi-process locking.
  const lockPath = resolve(directory, 'bridge.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw new Error('Storage locked. Stop the other bridge; after a crash, remove bridge.lock only after verifying no bridge is running.'); });
  await lock.writeFile(String(process.pid));
  const clients = new Map();
  let harness, root, spaces, review;
  // Admission changes and this flag are serialized by root.commit.
  let admissionsPaused = false;
  const requireAdmissions = () => { if (admissionsPaused) throw Object.assign(new Error('Bridge maintenance: new submissions are paused.'), { status: 429 }); };
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
              '--append-system-prompt', 'Fantastic Pi Mobile workspace: this chat has its own Git worktree at ' + workspace.cwd +
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
  const finishReview = async (task, runtime, status, result) => {
    await runtime.commit(async tx => {
      Object.assign((await tx.doc(Reviews)).items[task.input.id], { status, result, finishedAt: Date.now() });
      return { status: 'terminal', outcome: { status: 'completed', result: { status } } };
    }, ctx);
    log('review.state', { requestId: task.input.id, sessionId: task.input.sessionId, status });
  };
  const ReviewAction = defineTask({
    name: 'pocket.review', version: 1, initial: () => ({ phase: 'execute' }),
    phases: { execute: async (task, runtime) => {
      if (await runtime.memo('dispatched', ctx)) {
        await finishReview(task, runtime, 'interrupted', { message: 'Bridge restarted during a repository action. Inspect Git/test state; it was not replayed.' }); return;
      }
      await runtime.memo('dispatched', true, ctx);
      await runtime.commit(async tx => { (await tx.doc(Reviews)).items[task.input.id].status = 'running'; }, ctx);
      try {
        const result = await review.execute(task.input.sessionId, task.input.input, runtime.signal);
        await finishReview(task, runtime, 'done', result);
      } catch (error) {
        if (runtime.signal.aborted) throw error;
        await finishReview(task, runtime, 'failed', { message: error.status ? error.message : 'Repository action failed. Inspect state before retrying.' });
      }
    } },
    abort: async (task, runtime) => finishReview(task, runtime, 'cancelled', { message: 'Stopped. Previously completed test/file/Git side effects are not rolled back.' })
  });
  try {
    spaces = workspaces ?? await openWorkspaces({ cwd, directory, defaultBranch, remote });
    review = reviewActions ?? createReview({ workspaces: spaces });
    const registry = createRegistry();
    registry.install(defineExtension({ name: 'pocket', tasks: [Command, ReviewAction] }));
    harness = await Harness.open(await openNodeSqliteStorage(resolve(directory, 'assistant.sqlite')), { registry, models: createModels() }, ctx);
    root = await harness.root(ctx);
    await harness.commit(async tx => { await tx.doc(Jobs); await tx.doc(Reviews); }, ctx);
    harness.resume();
  } catch (error) { await lock.close(); await unlink(lockPath); throw error; }
  return {
    async get(id) { return (await harness.snapshot(Jobs, ctx)).items[id]; },
    maxConcurrent,
    async maintenance(paused) {
      return root.commit(async tx => {
        if (paused !== undefined) admissionsPaused = paused;
        const jobs = Object.values((await tx.doc(Jobs)).items).filter(active).length;
        const reviews = Object.values((await tx.doc(Reviews)).items).filter(active).length;
        return { admissionsPaused, jobs, reviews, idle: jobs === 0 && reviews === 0 };
      }, ctx);
    },
    async submit(id, text, sessionId = 'pocket') {
      if (!validSessionId(sessionId)) throw Object.assign(new Error('Invalid sessionId'), { status: 400 });
      const result = await root.commit(async tx => {
        const jobs = await tx.doc(Jobs);
        if (jobs.items[id]) {
          if (jobs.items[id].text !== text || sessionOf(jobs.items[id]) !== sessionId) throw Object.assign(new Error('Request ID reused with different text or session'), { status: 409 });
          return JSON.parse(JSON.stringify(jobs.items[id]));
        }
        requireAdmissions();
        if (Object.values((await tx.doc(Reviews)).items).some(active)) throw Object.assign(new Error('A repository review action is running; this request will wait.'), { status: 429 });
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
    async changesSummary(sessionId) {
      if (!validSessionId(sessionId)) throw Object.assign(new Error('Invalid session'), { status: 400 });
      const summary = await review.summary(sessionId);
      const repositoryActionActive = Object.values((await harness.snapshot(Reviews, ctx)).items).some(a => a.sessionId === sessionId && active(a));
      return { ...summary, repositoryActionActive };
    },
    async changes(sessionId) {
      if (!validSessionId(sessionId)) throw Object.assign(new Error('Invalid session'), { status: 400 });
      const reviewStates = items => JSON.stringify(Object.values(items).map(a => [a.id, a.status, a.finishedAt]));
      const jobStates = items => JSON.stringify(Object.values(items).filter(j => sessionOf(j) === sessionId).map(j => [j.id, j.status]));
      const beforeReviews = reviewStates((await harness.snapshot(Reviews, ctx)).items);
      const beforeJobs = jobStates((await harness.snapshot(Jobs, ctx)).items);
      const snapshot = await review.snapshot(sessionId);
      const reviewItems = (await harness.snapshot(Reviews, ctx)).items;
      const reviews = Object.values(reviewItems);
      const jobs = Object.values((await harness.snapshot(Jobs, ctx)).items);
      const refreshRequired = beforeReviews !== reviewStates(reviewItems) || beforeJobs !== jobStates(Object.fromEntries(jobs.map(j => [j.id, j])));
      const actions = reviews.slice().reverse().filter(a => a.sessionId === sessionId).sort((a, b) => b.createdAt - a.createdAt);
      const testAction = actions.find(a => a.input.action === 'test');
      const test = testAction?.result?.test;
      return { ...snapshot, busy: jobs.some(j => active(j) && sessionOf(j) === sessionId), modelsBusy: jobs.some(active),
        refreshRequired, repositoryBusy: refreshRequired || reviews.some(active),
        operation: actions[0] ?? null,
        tests: testAction ? { status: testAction.status, message: testAction.result?.message, ...test,
          stale: test ? test.changedDuringRun || test.codeRevision !== snapshot.codeRevision : true } : null };
    },
    async diff(sessionId, input) { return review.diff(sessionId, input); },
    async reviewAction(sessionId, input) {
      if (!validSessionId(sessionId) || typeof input.operationId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.operationId) || !['commit', 'merge', 'test'].includes(input.action) || typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision)) throw Object.assign(new Error('Invalid repository action'), { status: 400 });
      const normalized = { action: input.action, revision: input.revision,
        ...(input.action === 'commit' ? { paths: input.paths, message: input.message } : {}),
        ...(input.action === 'test' ? { command: input.command } : {}) };
      const result = await root.commit(async tx => {
        const reviews = await tx.doc(Reviews);
        const existing = reviews.items[input.operationId];
        if (existing) {
          if (existing.sessionId !== sessionId || JSON.stringify(existing.input) !== JSON.stringify(normalized)) throw Object.assign(new Error('Operation ID reused with different input'), { status: 409 });
          return JSON.parse(JSON.stringify(existing));
        }
        requireAdmissions();
        if (Object.values(reviews.items).some(active)) throw Object.assign(new Error('Another repository action is running. Wait for it to finish.'), { status: 409 });
        const jobs = Object.values((await tx.doc(Jobs)).items).filter(active);
        if (jobs.some(j => sessionOf(j) === sessionId) || (input.action === 'merge' && jobs.length)) throw Object.assign(new Error('Wait for running Pi requests before changing this repository.'), { status: 409 });
        const taskId = await tx.createTask(ReviewAction, { id: input.operationId, sessionId, input: normalized }, { ownership: { kind: 'conversation' } });
        const action = { id: input.operationId, sessionId, input: normalized, taskId, status: 'queued', createdAt: Date.now(), result: null };
        reviews.items[action.id] = action;
        return action;
      }, ctx);
      harness.resume();
      return result;
    },
    async getReview(sessionId, id) {
      const action = (await harness.snapshot(Reviews, ctx)).items[id];
      if (!action || action.sessionId !== sessionId) throw Object.assign(new Error('Unknown repository action'), { status: 404 });
      return action;
    },
    async cancelReview(sessionId, id) {
      const action = (await harness.snapshot(Reviews, ctx)).items[id];
      if (!action || action.sessionId !== sessionId) throw Object.assign(new Error('Unknown repository action'), { status: 404 });
      if (action.input.action !== 'test') throw Object.assign(new Error('Git actions cannot be cancelled once dispatched; inspect the result.'), { status: 409 });
      await harness.abortTask(action.taskId, ctx);
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
