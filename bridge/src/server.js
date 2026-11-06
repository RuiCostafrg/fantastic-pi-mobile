import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openStore, validSessionId, DEFAULT_MAX_CONCURRENT } from './store.js';
import { log } from './log.js';

const validProjectId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
const projectView = ({ projectId, name, source, repositoryRoot, subdirectory, branchPolicy }) =>
  ({ projectId, name, source, repositoryRoot, subdirectory, branchPolicy });

export function makeServer(store, token, logger = log) {
  const projectBindings = store.projectBindings === true;
  const conversationCore = projectBindings && store.conversationCore === true && store.eventSchemaVersion === 1;
  const historyImport = conversationCore && store.historyImport === true && store.historySchemaVersion === 1;
  const expected = Buffer.from('Bearer ' + token);
  return createServer(async (req, res) => {
    const started = Date.now();
    // Classify, do not log arbitrary URLs (which may contain secrets).
    const route = req.url === '/health' ? 'health' : req.url === '/v1/jobs' ? 'submit' : /^\/v1\/jobs\/[a-zA-Z0-9-]{8,80}(?:\/(cancel|ui))?$/.test(req.url ?? '') ? 'job' : req.url === '/v1/projects' || /^\/v1\/sessions\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\/project$/.test(req.url ?? '') ? 'project' : /^\/v1\/sessions\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\/(changes|diff|actions)(?:[/?]|$)/.test(req.url ?? '') ? 'review' : /^\/v1\/conversations(?:[/?]|$)/.test(req.url ?? '') ? 'conversation' : 'other';
    res.on('finish', () => logger('http.complete', { method: ['GET', 'POST'].includes(req.method) ? req.method : 'other', route, httpStatus: res.statusCode, durationMs: Date.now() - started }));
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    const actual = Buffer.from(req.headers.authorization ?? '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return send(401, { error: 'Unauthorized' });
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/health') return send(200, { ok: true, runtime: 'pi-durable', processId: process.pid, protocolVersion: conversationCore ? 6 : projectBindings ? 5 : 4, ...(conversationCore ? { conversationCore: true, eventSchemaVersion: 1, ownerId: (await store.getOwnerIdentity()).ownerId, ...(historyImport ? { historyImport: true, historySchemaVersion: 1 } : {}) } : {}), worktreeIsolation: true, changesReview: true, projectBindings, maxConcurrent: store.maxConcurrent ?? DEFAULT_MAX_CONCURRENT });
      let body = {};
      if (req.method === 'POST') {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) return send(413, { error: 'Request too large' });
          chunks.push(chunk);
        }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'Invalid JSON' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return send(400, { error: 'Expected an object' });
      }
      const historyPath = /^\/v1\/conversations\/[^/]+\/history(?:\/imports(?:\/[^/]+)?)?$/.test(path);
      if (Object.hasOwn(body, 'projectId') && !(historyPath && body.projectId === null)) {
        if (!validProjectId(body.projectId)) return send(400, { error: 'projectId must be a nonempty opaque ID (up to 80 letters, numbers, underscores or hyphens)' });
        if (!projectBindings) return send(426, { error: 'Project bindings are not supported by this bridge. Upgrade before submitting a selected project.' });
      }
      const shared = path === '/v1/conversations' || path.startsWith('/v1/conversations/') ||
        Object.hasOwn(body, 'conversationId') || Object.hasOwn(body, 'ownerId') ||
        req.headers['x-conversation-schema'] !== undefined || req.headers['x-history-schema'] !== undefined;
      let ownerId;
      if (shared) {
        if (!conversationCore || req.headers['x-conversation-schema'] !== '1')
          return send(426, { error: 'CONVERSATION_CORE_UNAVAILABLE', requiredProtocol: 6, eventSchemaVersion: 1 });
        ownerId = req.headers['x-conversation-owner'];
        if (typeof ownerId !== 'string' || ownerId !== (await store.getOwnerIdentity()).ownerId)
          return send(409, { error: 'FOREIGN_OWNER' });
        if (Object.hasOwn(body, 'ownerId') && body.ownerId !== ownerId) return send(409, { error: 'FOREIGN_OWNER' });
      }
      const historyAware = req.headers['x-history-schema'] !== undefined;
      if ((historyPath || historyAware) && (!historyImport || req.headers['x-history-schema'] !== '1'))
        return send(426, { error: 'HISTORY_IMPORT_UNAVAILABLE', historySchemaVersion: 1 });
      const readOptions = (allowed = ['limit', 'maxBytes', 'token']) => {
        const options = {};
        for (const key of url.searchParams.keys()) {
          if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
            throw Object.assign(new Error('INVALID_READ_OPTIONS'), { status: 400 });
          const value = url.searchParams.get(key);
          if (key === 'limit' || key === 'maxBytes') {
            if (!/^[0-9]+$/.test(value)) throw Object.assign(new Error('INVALID_LIMIT'), { status: 400 });
            options[key] = Number(value);
          } else {
            if (value.length > 8192) throw Object.assign(new Error('TOKEN_TOO_LARGE'), { status: 413 });
            try { options[key] = JSON.parse(value); } catch { throw Object.assign(new Error('MALFORMED_TOKEN'), { status: 400 }); }
          }
        }
        if (options.token !== undefined && options.after !== undefined) throw Object.assign(new Error('AMBIGUOUS_TOKEN'), { status: 400 });
        return options;
      };
      if (path === '/v1/conversations') {
        if (req.method === 'GET') return send(200, await store.listConversations(ownerId, readOptions(), historyAware));
        if (req.method === 'POST') return send(200, await store.createConversation({ ...body, ownerId }));
      }
      const history = path.match(/^\/v1\/conversations\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,79})\/history(?:\/imports(?:\/([a-zA-Z0-9-]{8,80}))?)?$/);
      if (history) {
        const [, id, importId] = history;
        if (req.method === 'POST' && path.endsWith('/history/imports') && !importId) {
          if (body.conversationId !== id) return send(409, { error: 'HISTORY_TARGET_CONFLICT' });
          const receipt = await store.importHistory(body);
          return send(receipt.outcome === 'conflict' ? 409 : 200, receipt);
        }
        if (req.method === 'GET' && (importId || path.endsWith('/history')))
          return send(200, await (importId ? store.readHistoryImport(ownerId, id, importId, readOptions(['limit', 'maxBytes'])) :
            store.readHistory(ownerId, id, readOptions())));
      }
      const conversation = path.match(/^\/v1\/conversations\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,79})(?:\/(events|approvals)(?:\/([^/]+)\/response)?)?$/);
      if (conversation) {
        const [, id, action, encodedApprovalId] = conversation;
        if (req.method === 'GET' && (!action || (action === 'events' && !encodedApprovalId))) {
          const result = await (action === 'events' ? store.readConversationEvents(id, readOptions(['limit', 'maxBytes', 'token', 'after'])) : store.readConversationSnapshot(id, readOptions()));
          // Removing internal diagnostic labeling only shrinks the byte-bounded envelope.
          delete result.internalOnly;
          for (const item of result.items) if (item.record?.source) delete item.record.source.taskId;
          return send(200, result);
        }
        if (req.method === 'POST' && action === 'approvals' && encodedApprovalId) {
          if (typeof body.runId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(body.runId) || !validProjectId(body.projectId))
            return send(400, { error: 'Provide exact runId and projectId' });
          let approvalId;
          try { approvalId = decodeURIComponent(encodedApprovalId); } catch { return send(400, { error: 'MALFORMED_APPROVAL_ID' }); }
          if ((Object.hasOwn(body, 'conversationId') && body.conversationId !== id) ||
              (Object.hasOwn(body, 'approvalId') && body.approvalId !== approvalId)) return send(409, { error: 'APPROVAL_TARGET_CONFLICT' });
          return send(200, await store.answerApproval({ ownerId, conversationId: id, projectId: body.projectId,
            runId: body.runId, approvalId, responseId: body.responseId, answer: body.answer }));
        }
      }
      if (path === '/v1/projects' && ['GET', 'POST'].includes(req.method)) {
        if (!projectBindings) return send(426, { error: 'Project bindings are not supported by this bridge.' });
        if (req.method === 'GET') return send(200, { projects: (await store.listProjects()).map(projectView) });
        if (body.confirmRegistration !== true) return send(400, { error: 'Deliberate registration requires confirmRegistration: true after reviewing the trusted source and branch policy.' });
        return send(200, projectView(await store.registerProject({ source: body.source, name: body.name, branchPolicy: body.branchPolicy })));
      }
      const binding = path.match(/^\/v1\/sessions\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,79})\/project$/);
      if (req.method === 'GET' && binding) {
        if (!projectBindings) return send(426, { error: 'Project bindings are not supported by this bridge.' });
        const project = await store.getSessionProject(binding[1]);
        return project ? send(200, project) : send(404, { error: 'This chat has no accepted project binding.' });
      }
      if (path === '/v1/maintenance') {
        if (req.method === 'GET') return send(200, await store.maintenance());
        if (req.method === 'POST') {
          if (typeof body.paused !== 'boolean') return send(400, { error: 'Provide paused (boolean)' });
          return send(200, await store.maintenance(body.paused));
        }
      }
      if (req.method === 'POST' && path === '/v1/jobs') {
        if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(body.requestId) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 20000) return send(400, { error: 'Provide requestId (8–80 letters/numbers/hyphens) and text (1–20000 characters)' });
        if (Object.hasOwn(body, 'sessionId') && !validSessionId(body.sessionId)) return send(400, { error: 'sessionId must be 1–80 letters, numbers, underscores or hyphens, starting with a letter or number' });
        if (shared && (!validSessionId(body.conversationId) || !validProjectId(body.projectId) ||
            (Object.hasOwn(body, 'sessionId') && body.sessionId !== body.conversationId)))
          return send(400, { error: 'Shared Send requires exact conversationId and projectId' });
        return send(202, await store.submit(body.requestId, body.text, shared ? body.conversationId : body.sessionId, body.projectId, shared ? ownerId : undefined));
      }
      const session = path.match(/^\/v1\/sessions\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,79})\/(changes|diff|actions)(?:\/([a-zA-Z0-9-]{8,80})(\/cancel)?)?$/);
      if (session) {
        const [, id, action, operationId, cancel] = session;
        if (!operationId && req.method === 'GET' && action === 'changes') return send(200, await (url.searchParams.get('summary') === '1' ? store.changesSummary(id) : store.changes(id)));
        if (!operationId && req.method === 'GET' && action === 'diff') return send(200, await store.diff(id, { revision: url.searchParams.get('revision'), path: url.searchParams.get('path'), scope: url.searchParams.get('scope') }));
        if (!operationId && req.method === 'POST' && action === 'actions') return send(202, await store.reviewAction(id, body));
        if (operationId && !cancel && req.method === 'GET' && action === 'actions') return send(200, await store.getReview(id, operationId));
        if (operationId && cancel && req.method === 'POST' && action === 'actions') { await store.cancelReview(id, operationId); return send(200, { ok: true }); }
      }
      const match = path.match(/^\/v1\/jobs\/([a-zA-Z0-9-]{8,80})(?:\/(cancel|ui))?$/);
      if (match) {
        const [, id, action] = match;
        if (req.method === 'GET' && !action) {
          const job = await store.get(id);
          return job ? send(200, job) : send(404, { error: 'Unknown request' });
        }
        if (req.method === 'POST' && action) {
          if (action === 'cancel' && shared) {
            if (!validSessionId(body.conversationId) || !validProjectId(body.projectId) ||
                (Object.hasOwn(body, 'runId') && body.runId !== id)) return send(400, { error: 'Provide exact Stop target' });
            return send(200, await store.stopRun({ ownerId, conversationId: body.conversationId, projectId: body.projectId, runId: id }));
          }
          if (action === 'cancel') await store.cancel(id);
          else await store.respond(id, body);
          return send(200, { ok: true });
        }
      }
      send(404, { error: 'Not found' });
    } catch (error) {
      logger('http.error', { route, errorType: error.constructor?.name ?? 'Error' });
      send(error.status ?? 500, { error: error.status ? error.message : 'Bridge error; inspect local bridge process.' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(resolve(process.argv[1]))).href) {
  const token = process.env.FANTASTIC_PI_MOBILE_TOKEN;
  if (!token || token.length < 32 || token.startsWith('replace-')) throw new Error('Set FANTASTIC_PI_MOBILE_TOKEN to a random secret of at least 32 characters');
  if (!process.env.PI_WORKSPACE) throw new Error('Set PI_WORKSPACE to your trusted project directory');
  const extraArgs = JSON.parse(process.env.PI_ARGS ?? '[]');
  if (!Array.isArray(extraArgs) || !extraArgs.every(x => typeof x === 'string')) throw new Error('PI_ARGS must be a JSON string array');
  const store = await openStore({ directory: resolve(process.env.PI_DATA_DIR ?? 'data'), cwd: resolve(process.env.PI_WORKSPACE), bin: process.env.PI_BIN ?? 'pi', extraArgs, maxConcurrent: Number(process.env.PI_MAX_CONCURRENT ?? DEFAULT_MAX_CONCURRENT), defaultBranch: process.env.PI_DEFAULT_BRANCH, remote: process.env.PI_GIT_REMOTE ?? 'origin' });
  const server = makeServer(store, token);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(Number(process.env.PORT ?? 8787), '127.0.0.1', () => log('bridge.listening', { pid: process.pid }));
  let closing = false;
  const shutdown = async signal => {
    if (closing) return;
    closing = true;
    // Metadata only. Absence of these events is not proof of SIGKILL, Android
    // process eviction or any other specific cause; whole-process loss can
    // prevent JavaScript from logging at all.
    log('bridge.shutdown', { pid: process.pid, status: signal });
    server.close();
    await store.close();
    server.closeAllConnections();
    log('bridge.closed', { pid: process.pid });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
