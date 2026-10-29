import { mkdir, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { Harness, createRegistry, defineDoc, defineTask, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { runPi } from './rpc.js';
import { log } from './log.js';
import { openWorkspaces } from './workspaces.js';
import { projectWorkspaces } from './project-workspaces.js';
import { createReview } from './review.js';
import { validateProject, registerProject, lookupProject } from './projects.js';
import { bindSession, legacyEvidence, bindingError } from './bindings.js';
import { initializeConversations, readOwnerIdentity, readConversationBaseline } from './conversations.js';
import { readStagedConversation, ProjectionState } from './conversation-projection.js';
import { initializeLiveConversations, projectMutation, inspectLiveConversation } from './conversation-live.js';
import { readConversationSnapshot, readConversationEvents } from './conversation-reads.js';
import { initializeApprovals, transitionApproval, inspectApprovalEvidence } from './approval-lifecycle.js';
import { initializeApprovalResponses, claimApproval, recordAttempt } from './approval-responses.js';
import { createConversation, listConversations, requireOwner } from './conversation-interface.js';
import { initializeHistory, importHistory, readHistory, readHistoryImport, historyCatalogue, requireHistoryAdmission } from './conversation-history.js';

export const DEFAULT_MAX_CONCURRENT = 8;
export const MAX_CONCURRENT = 32;

const Projects = defineDoc({ kind: 'pocket.projects', version: 1, scope: 'session', initial: () => ({ items: {} }) });
const Bindings = defineDoc({ kind: 'pocket.bindings', version: 1, scope: 'session', initial: () => ({ items: {}, defaultProjectId: null, migrated: false }) });
const Jobs = defineDoc({ kind: 'pocket.jobs', version: 1, scope: 'session', initial: () => ({ items: {} }) });
const Reviews = defineDoc({ kind: 'pocket.reviews', version: 1, scope: 'session', initial: () => ({ items: {} }) });
export const active = job => ['queued', 'running'].includes(job.status);
export const validSessionId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id);
const sessionOf = job => job.sessionId ?? 'pocket';

export async function openStore({ directory, cwd, bin = 'pi', extraArgs = [], runner = runPi,
  maxConcurrent = DEFAULT_MAX_CONCURRENT, defaultBranch, remote = 'origin', workspaces, reviewActions,
  initializeProjection = initializeLiveConversations }) {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > MAX_CONCURRENT) throw new Error('maxConcurrent must be an integer between 1 and ' + MAX_CONCURRENT);
  const sessionFlags = new Set(['--session', '--session-id', '--session-dir', '--continue', '--resume', '--fork', '--no-session', '-c', '-r']);
  if (extraArgs.some(arg => sessionFlags.has(arg.split('=')[0]))) throw new Error('PI_ARGS cannot override session isolation');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Explicit exclusive lock: Durable storage itself has no multi-process locking.
  const lockPath = resolve(directory, 'bridge.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw new Error('Storage locked. Stop the other bridge; after a crash, remove bridge.lock only after verifying no bridge is running.'); });
  await lock.writeFile(String(process.pid));
  const clients = new Map();
  const gates = new Map();
  let closing = false;
  // One gate covers the entire claim -> pipe attempt -> receipt interval, and
  // every competing pending/replacement/terminal/Stop mutation for that run.
  const serialize = (id, action) => {
    const result = (gates.get(id) ?? Promise.resolve()).catch(() => {}).then(action);
    const tail = result.then(() => {}, () => {});
    gates.set(id, tail);
    void tail.then(() => { if (gates.get(id) === tail) gates.delete(id); });
    return result;
  };
  let harness, root, spaces, review;
  const answer = (request, legacy = false) => serialize(request.runId, async () => {
    if (closing) throw Object.assign(new Error('Bridge closing; approval delivery unavailable'), { status: 409 });
    const sender = clients.get(request.runId);
    const result = await root.commit(async tx => claimApproval(tx, await tx.doc(Bindings), await tx.doc(Jobs), request, sender, legacy), ctx);
    if (!result.claimed) return result.receipt;
    // Persisted unknown is final unless this specific live attempt returns. A
    // throw, process exit or failed receipt commit must NEVER cause a resend.
    try {
      if (clients.get(request.runId) !== sender) return result.receipt;
      await sender(result.reply);
      return await root.commit(async tx => recordAttempt(tx, await tx.doc(Bindings), await tx.doc(Jobs), result.receipt), ctx);
    } catch { return result.receipt; }
  });
  // Admission changes and this flag are serialized by root.commit.
  let admissionsPaused = false;
  const requireAdmissions = () => { if (admissionsPaused) throw Object.assign(new Error('Bridge maintenance: new submissions are paused.'), { status: 429 }); };
  const update = async (id, patch, runtime) => serialize(id, async () => {
    const current = (await harness.snapshot(Jobs, ctx)).items[id];
    if (!current || current.stopRequested || !active(current)) return;
    const change = async tx => {
      const job = (await tx.doc(Jobs)).items[id];
      if (job.stopRequested || !active(job)) return;
      await transitionApproval(tx, await tx.doc(Bindings), job, patch);
      await projectMutation(tx, await tx.doc(Bindings), 'turn', job,
        patch.status ? 'run.status' : Object.hasOwn(patch, 'answer') ? 'run.result' : Object.hasOwn(patch, 'progress') ? 'run.progress' : 'run.pending');
    };
    await (runtime ? runtime.commit(async tx => { await change(tx); }, ctx) : harness.commit(change, ctx));
    if (patch.status) log('job.state', { requestId: id, status: patch.status });
  });
  const complete = async (task, runtime, status, answer) => serialize(task.input.id, async () => {
    await runtime.commit(async tx => {
      const job = (await tx.doc(Jobs)).items[task.input.id];
      if (job.stopRequested) { status = 'cancelled'; answer = 'Stopped. Already-completed file/device changes are not rolled back.'; }
      await transitionApproval(tx, await tx.doc(Bindings), job, { status, answer, pending: null });
      await projectMutation(tx, await tx.doc(Bindings), 'turn', job, 'run.' + status);
      await tx.appendEntry(runtime.conversationId, { kind: 'pocket.result', data: { requestId: task.input.id, status, answer } });
      return { status: 'terminal', outcome: { status: 'completed', result: { status } } };
    }, ctx);
    log('job.state', { requestId: task.input.id, status });
  });
  const checkTaskBinding = async (task, document) => {
    const record = (await harness.snapshot(document, ctx)).items[task.input.id];
    const bindings = await harness.snapshot(Bindings, ctx);
    const sessionId = task.input.sessionId ?? 'pocket';
    if (!record?.projectId || sessionOf(record) !== sessionId ||
        bindings.items[sessionId]?.projectId !== record.projectId ||
        (task.input.projectId !== undefined && task.input.projectId !== record.projectId)) throw bindingError('Accepted task binding conflicts; refusing execution.');
    await lookupProject(await harness.snapshot(Projects, ctx), record.projectId, directory);
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
          await checkTaskBinding(task, Jobs);
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
      const action = (await tx.doc(Reviews)).items[task.input.id];
      Object.assign(action, { status, result, finishedAt: Date.now() });
      await projectMutation(tx, await tx.doc(Bindings), 'review', action, 'review.' + status);
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
      await runtime.commit(async tx => {
        const action = (await tx.doc(Reviews)).items[task.input.id]; action.status = 'running';
        await projectMutation(tx, await tx.doc(Bindings), 'review', action, 'review.running');
      }, ctx);
      try {
        await checkTaskBinding(task, Reviews);
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
    const legacySpaces = workspaces ?? await openWorkspaces({ cwd, directory, defaultBranch, remote });
    const registry = createRegistry();
    registry.install(defineExtension({ name: 'pocket', tasks: [Command, ReviewAction] }));
    harness = await Harness.open(await openNodeSqliteStorage(resolve(directory, 'assistant.sqlite')), { registry, models: createModels() }, ctx);
    root = await harness.root(ctx);
    const candidate = await validateProject({ source: resolve(cwd), name: 'Default project',
      branchPolicy: defaultBranch ? { kind: 'local', branch: defaultBranch } : { kind: 'remote', remote } }, directory);
    await root.commit(async tx => {
      const projects = await tx.doc(Projects);
      const bindings = await tx.doc(Bindings);
      const jobs = await tx.doc(Jobs);
      const reviews = await tx.doc(Reviews);
      let project;
      if (bindings.defaultProjectId) {
        project = await lookupProject(projects, bindings.defaultProjectId, directory);
        for (const key of ['source', 'repositoryRoot', 'commonDirectory', 'subdirectory', 'repositoryIdentity', 'branchPolicy']) {
          if (JSON.stringify(project[key]) !== JSON.stringify(candidate[key])) throw bindingError('Configured default conflicts with the frozen project. Restore the original configuration.');
        }
      } else project = registerProject(projects, candidate);
      if (!bindings.migrated) {
        const sessions = await legacyEvidence({ directory, project, spaces: legacySpaces,
          jobs: Object.values(jobs.items), reviews: Object.values(reviews.items) });
        for (const sessionId of sessions) {
          if (!validSessionId(sessionId)) throw bindingError('Invalid legacy session evidence.');
          if (Object.hasOwn(bindings.items, sessionId) && bindings.items[sessionId].projectId !== project.projectId) throw bindingError('Legacy binding conflicts.');
          bindings.items[sessionId] = { projectId: project.projectId };
        }
      }
      for (const record of [...Object.values(jobs.items), ...Object.values(reviews.items)]) {
        const projectId = bindings.items[sessionOf(record)]?.projectId;
        if (!projectId || !Object.hasOwn(projects.items, projectId) ||
            (bindings.migrated && !record.projectId) ||
            (record.projectId && record.projectId !== projectId)) throw bindingError('Saved request binding conflicts.');
        record.projectId = projectId;
      }
      bindings.defaultProjectId = project.projectId;
      bindings.migrated = true;
      await initializeConversations(tx, { projects, bindings, jobs, reviews });
      await initializeProjection(tx, { projects, bindings, jobs, reviews });
      await initializeApprovals(tx, { bindings, jobs });
      await initializeApprovalResponses(tx, { bindings, jobs });
      await initializeHistory(tx, { bindings, jobs });
    }, ctx);
    spaces = projectWorkspaces({ directory,
      defaultProjectId: (await harness.snapshot(Bindings, ctx)).defaultProjectId,
      defaultWorkspaces: legacySpaces,
      resolveProject: async sessionId => {
        if (!validSessionId(sessionId)) throw Object.assign(new Error('Invalid session'), { status: 400 });
        const bindings = await harness.snapshot(Bindings, ctx);
        if (!Object.hasOwn(bindings.items, sessionId)) throw Object.assign(new Error('This chat has no project/worktree yet. Send a message first.'), { status: 404 });
        return lookupProject(await harness.snapshot(Projects, ctx), bindings.items[sessionId].projectId, directory);
      }
    });
    review = reviewActions ?? createReview({ workspaces: spaces });
    harness.resume();
  } catch (error) { try { await harness?.close(ctx); } finally { await lock.close(); await unlink(lockPath); } throw error; }
  return {
    async get(id) { return (await harness.snapshot(Jobs, ctx)).items[id]; },
    // Stable journal identity is exposed by B05 health; baseline bodies stay internal.
    async getOwnerIdentity() { return readOwnerIdentity(harness, ctx); },
    async getConversationBaseline(sessionId) { return readConversationBaseline(harness, sessionId, ctx); },
    // Historical staged inspector refuses live mode; no HTTP capability.
    async getStagedConversation(sessionId, sequence) { return readStagedConversation(harness, sessionId, ctx, sequence); },
    async inspectLiveConversation(sessionId) { return inspectLiveConversation(harness, sessionId, ctx); },
    async inspectApprovalEvidence(runId) {
      return root.commit(async tx => inspectApprovalEvidence(tx, await tx.doc(Bindings), await tx.doc(Jobs), runId), ctx);
    },
    conversationCore: (await harness.snapshot(ProjectionState, ctx)).mode === 'live',
    eventSchemaVersion: 1,
    historyImport: true,
    historySchemaVersion: 1,
    async importHistory(input) {
      return root.commit(async tx => importHistory(tx, await tx.doc(Bindings), await tx.doc(Jobs), input), ctx);
    },
    async readHistory(ownerId, sessionId, options) {
      return root.commit(async tx => readHistory(tx, await tx.doc(Bindings), ownerId, sessionId, options), ctx);
    },
    async readHistoryImport(ownerId, sessionId, importId, options) {
      return root.commit(async tx => readHistoryImport(tx, ownerId, sessionId, importId, options), ctx);
    },
    async createConversation(input) {
      return root.commit(async tx => {
        requireAdmissions();
        await requireHistoryAdmission(tx, await tx.doc(Bindings), input.conversationId);
        return createConversation(tx, await tx.doc(Bindings), await tx.doc(Projects), input);
      }, ctx);
    },
    async listConversations(ownerId, options, includeHistory = false) {
      return root.commit(async tx => listConversations(tx, await tx.doc(Bindings), ownerId, options,
        includeHistory ? await historyCatalogue(tx, ownerId) : undefined), ctx);
    },
    // Same bounded readers as the internal regressions; no diagnostic transcript.
    async readConversationSnapshot(sessionId, options) {
      return root.commit(async tx => readConversationSnapshot(tx, await tx.doc(Bindings), sessionId, options), ctx);
    },
    async readConversationEvents(sessionId, options) {
      return root.commit(async tx => readConversationEvents(tx, await tx.doc(Bindings), sessionId, options), ctx);
    },
    maxConcurrent,
    projectBindings: true,
    async getSessionProject(sessionId) {
      if (!validSessionId(sessionId)) throw Object.assign(new Error('Invalid sessionId'), { status: 400 });
      const items = (await harness.snapshot(Bindings, ctx)).items;
      const binding = Object.hasOwn(items, sessionId) ? items[sessionId] : null;
      return binding ? { sessionId, projectId: binding.projectId } : null;
    },
    // Registration is trusted operator input; never derive sources from model output.
    async registerProject(input) {
      const candidate = await validateProject(input, directory);
      return root.commit(async tx => registerProject(await tx.doc(Projects), candidate), ctx);
    },
    async listProjects() { return JSON.parse(JSON.stringify(Object.values((await harness.snapshot(Projects, ctx)).items))); },
    async getProject(projectId) { return lookupProject(await harness.snapshot(Projects, ctx), projectId, directory); },
    async maintenance(paused) {
      return root.commit(async tx => {
        if (paused !== undefined) admissionsPaused = paused;
        const jobs = Object.values((await tx.doc(Jobs)).items).filter(active).length;
        const reviews = Object.values((await tx.doc(Reviews)).items).filter(active).length;
        return { admissionsPaused, jobs, reviews, idle: jobs === 0 && reviews === 0 };
      }, ctx);
    },
    async submit(id, text, sessionId = 'pocket', requestedProjectId, ownerId) {
      if (!validSessionId(sessionId)) throw Object.assign(new Error('Invalid sessionId'), { status: 400 });
      const result = await root.commit(async tx => {
        if (ownerId !== undefined) await requireOwner(tx, ownerId);
        const jobs = await tx.doc(Jobs);
        const bindings = await tx.doc(Bindings);
        const projects = await tx.doc(Projects);
        if (jobs.items[id]) {
          bindSession(bindings, projects, sessionId, requestedProjectId, jobs.items[id].projectId);
          if (jobs.items[id].text !== text || sessionOf(jobs.items[id]) !== sessionId) throw Object.assign(new Error('Request ID reused with different text or session'), { status: 409 });
          return JSON.parse(JSON.stringify(jobs.items[id]));
        }
        await requireHistoryAdmission(tx, bindings, sessionId, id);
        const projectId = bindSession(bindings, projects, sessionId, requestedProjectId);
        requireAdmissions();
        if (Object.values((await tx.doc(Reviews)).items).some(active)) throw Object.assign(new Error('A repository review action is running; this request will wait.'), { status: 429 });
        const running = Object.values(jobs.items).filter(active);
        if (running.some(job => sessionOf(job) === sessionId)) throw Object.assign(new Error('Another command is running in this session; stop it or wait.'), { status: 409 });
        if (running.length >= maxConcurrent) throw Object.assign(new Error('Parallel session limit reached; this request will retry when a slot is free.'), { status: 429 });
        await lookupProject(projects, projectId, directory);
        const taskId = await tx.createTask(Command, { id, text, sessionId, projectId }, { ownership: { kind: 'conversation' } });
        const job = { id, text, sessionId, projectId, taskId, status: 'queued', answer: '', progress: '', pending: null, createdAt: Date.now() };
        jobs.items[id] = job;
        await projectMutation(tx, bindings, 'turn', job, 'turn.accepted');
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
      return { ...summary, repositoryActionActive, projectId: (await this.getSessionProject(sessionId))?.projectId ?? null };
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
      return { ...snapshot, projectId: (await this.getSessionProject(sessionId))?.projectId ?? null, busy: jobs.some(j => active(j) && sessionOf(j) === sessionId), modelsBusy: jobs.some(active),
        refreshRequired, repositoryBusy: refreshRequired || reviews.some(active),
        operation: actions[0] ?? null,
        tests: testAction ? { status: testAction.status, message: testAction.result?.message, ...test,
          stale: test ? test.changedDuringRun || test.codeRevision !== snapshot.codeRevision : true } : null };
    },
    async diff(sessionId, input) {
      return { ...await review.diff(sessionId, input), projectId: (await this.getSessionProject(sessionId))?.projectId ?? null };
    },
    async reviewAction(sessionId, input) {
      if (!validSessionId(sessionId) || typeof input.operationId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.operationId) || !['commit', 'merge', 'test'].includes(input.action) || typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision)) throw Object.assign(new Error('Invalid repository action'), { status: 400 });
      const normalized = { action: input.action, revision: input.revision,
        ...(input.action === 'commit' ? { paths: input.paths, message: input.message } : {}),
        ...(input.action === 'test' ? { command: input.command } : {}) };
      const result = await root.commit(async tx => {
        const reviews = await tx.doc(Reviews);
        const existing = reviews.items[input.operationId];
        const bindings = await tx.doc(Bindings);
        const projects = await tx.doc(Projects);
        if (existing) {
          bindSession(bindings, projects, sessionId, input.projectId, existing.projectId);
          if (existing.sessionId !== sessionId || JSON.stringify(existing.input) !== JSON.stringify(normalized)) throw Object.assign(new Error('Operation ID reused with different input'), { status: 409 });
          return JSON.parse(JSON.stringify(existing));
        }
        await requireHistoryAdmission(tx, bindings, sessionId);
        const projectId = bindSession(bindings, projects, sessionId, input.projectId);
        requireAdmissions();
        if (Object.values(reviews.items).some(active)) throw Object.assign(new Error('Another repository action is running. Wait for it to finish.'), { status: 409 });
        const jobs = Object.values((await tx.doc(Jobs)).items).filter(active);
        if (jobs.some(j => sessionOf(j) === sessionId) || (input.action === 'merge' && jobs.length)) throw Object.assign(new Error('Wait for running Pi requests before changing this repository.'), { status: 409 });
        await lookupProject(projects, projectId, directory);
        const taskId = await tx.createTask(ReviewAction, { id: input.operationId, sessionId, projectId, input: normalized }, { ownership: { kind: 'conversation' } });
        const action = { id: input.operationId, sessionId, projectId, input: normalized, taskId, status: 'queued', createdAt: Date.now(), result: null };
        reviews.items[action.id] = action;
        await projectMutation(tx, bindings, 'review', action, 'review.accepted');
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
    async cancel(id, target) {
      const result = await serialize(id, () => root.commit(async tx => {
        const job = (await tx.doc(Jobs)).items[id];
        if (!job) throw Object.assign(new Error('Unknown request'), { status: 404 });
        const bindings = await tx.doc(Bindings);
        if (target) {
          const evidence = await inspectApprovalEvidence(tx, bindings, await tx.doc(Jobs), id);
          if (target.ownerId !== evidence.ownerId || target.conversationId !== sessionOf(job) || target.projectId !== job.projectId)
            throw Object.assign(new Error('Stop target conflicts'), { status: 409 });
        }
        if (!active(job)) return { runId: id, status: job.status, taskId: null };
        await transitionApproval(tx, bindings, job, { stopRequested: true, pending: null });
        await projectMutation(tx, bindings, 'turn', job, 'run.status');
        return { runId: id, status: job.status, taskId: job.taskId };
      }, ctx));
      // Do not hold the gate while abort invokes the terminal callback.
      if (result.taskId !== null) await harness.abortTask(result.taskId, ctx);
      return { runId: result.runId, status: result.status, stopRequested: result.taskId !== null };
    },
    async stopRun(target) { return this.cancel(target.runId, target); },
    async answerApproval(request) { return answer(request); },
    async respond(id, response) { return answer({ runId: id, answer: response }, true); },
    async close() {
      closing = true;
      try { await Promise.all([...gates.values()]); await harness.close(ctx); }
      finally { await lock.close(); await unlink(lockPath); }
    }
  };
}
