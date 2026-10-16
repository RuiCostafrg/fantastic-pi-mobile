import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openStore, validSessionId, DEFAULT_MAX_CONCURRENT } from './store.js';
import { log } from './log.js';

export function makeServer(store, token, logger = log) {
  const expected = Buffer.from('Bearer ' + token);
  return createServer(async (req, res) => {
    const started = Date.now();
    // Classify, do not log arbitrary URLs (which may contain secrets).
    const route = req.url === '/health' ? 'health' : req.url === '/v1/jobs' ? 'submit' : /^\/v1\/jobs\/[a-zA-Z0-9-]{8,80}(?:\/(cancel|ui))?$/.test(req.url ?? '') ? 'job' : 'other';
    res.on('finish', () => logger('http.complete', { method: ['GET', 'POST'].includes(req.method) ? req.method : 'other', route, httpStatus: res.statusCode, durationMs: Date.now() - started }));
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    const actual = Buffer.from(req.headers.authorization ?? '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return send(401, { error: 'Unauthorized' });
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/health') return send(200, { ok: true, runtime: 'pi-durable', protocolVersion: 3, worktreeIsolation: true, maxConcurrent: store.maxConcurrent ?? DEFAULT_MAX_CONCURRENT });
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
      if (req.method === 'POST' && path === '/v1/jobs') {
        if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(body.requestId) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 20000) return send(400, { error: 'Provide requestId (8–80 letters/numbers/hyphens) and text (1–20000 characters)' });
        if (Object.hasOwn(body, 'sessionId') && !validSessionId(body.sessionId)) return send(400, { error: 'sessionId must be 1–80 letters, numbers, underscores or hyphens, starting with a letter or number' });
        return send(202, await store.submit(body.requestId, body.text, body.sessionId));
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const token = process.env.PI_POCKET_TOKEN;
  if (!token || token.length < 32 || token.startsWith('replace-')) throw new Error('Set PI_POCKET_TOKEN to a random secret of at least 32 characters');
  if (!process.env.PI_WORKSPACE) throw new Error('Set PI_WORKSPACE to your trusted project directory');
  const extraArgs = JSON.parse(process.env.PI_ARGS ?? '[]');
  if (!Array.isArray(extraArgs) || !extraArgs.every(x => typeof x === 'string')) throw new Error('PI_ARGS must be a JSON string array');
  const store = await openStore({ directory: resolve(process.env.PI_DATA_DIR ?? 'data'), cwd: resolve(process.env.PI_WORKSPACE), bin: process.env.PI_BIN ?? 'pi', extraArgs, maxConcurrent: Number(process.env.PI_MAX_CONCURRENT ?? DEFAULT_MAX_CONCURRENT), defaultBranch: process.env.PI_DEFAULT_BRANCH, remote: process.env.PI_GIT_REMOTE ?? 'origin' });
  const server = makeServer(store, token);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(Number(process.env.PORT ?? 8787), '127.0.0.1', () => console.log('Pi Pocket bridge listening on localhost'));
  let closing = false;
  const shutdown = async () => { if (closing) return; closing = true; server.close(); await store.close(); server.closeAllConnections(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
