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
  const expected = Buffer.from('Bearer ' + token);
  return createServer(async (req, res) => {
    const started = Date.now();
    // Classify, do not log arbitrary URLs (which may contain secrets).
    const route = req.url === '/health' ? 'health' : req.url === '/v1/jobs' ? 'submit' : /^\/v1\/jobs\/[a-zA-Z0-9-]{8,80}(?:\/(cancel|ui))?$/.test(req.url ?? '') ? 'job' : req.url === '/v1/projects' || /^\/v1\/sessions\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\/project$/.test(req.url ?? '') ? 'project' : /^\/v1\/sessions\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\/(changes|diff|actions)(?:[/?]|$)/.test(req.url ?? '') ? 'review' : 'other';
    res.on('finish', () => logger('http.complete', { method: ['GET', 'POST'].includes(req.method) ? req.method : 'other', route, httpStatus: res.statusCode, durationMs: Date.now() - started }));
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    const actual = Buffer.from(req.headers.authorization ?? '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return send(401, { error: 'Unauthorized' });
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/health') return send(200, { ok: true, runtime: 'pi-durable', processId: process.pid, protocolVersion: projectBindings ? 5 : 4, worktreeIsolation: true, changesReview: true, projectBindings, maxConcurrent: store.maxConcurrent ?? DEFAULT_MAX_CONCURRENT });
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
      if (Object.hasOwn(body, 'projectId')) {
        if (!validProjectId(body.projectId)) return send(400, { error: 'projectId must be a nonempty opaque ID (up to 80 letters, numbers, underscores or hyphens)' });
        if (!projectBindings) return send(426, { error: 'Project bindings are not supported by this bridge. Upgrade before submitting a selected project.' });
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
        return send(202, await store.submit(body.requestId, body.text, body.sessionId, body.projectId));
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
