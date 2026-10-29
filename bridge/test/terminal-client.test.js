import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { historyDigest } from '../src/conversation-history.js';
const exec = promisify(execFile);
const test = (name, fn) => nodeTest(name, { timeout: 20000 }, fn);
const token = 'b08-isolated-fixture-token-000000000000';
const clientPath = resolve('../scripts/conversation-client.mjs');
function peer(child) {
  const queue = [], readers = []; let stderr = '';
  child.stderr.on('data', x => { stderr += x; });
  createInterface({ input: child.stdout }).on('line', line => { const v = JSON.parse(line); if (readers.length) readers.shift()(v); else queue.push(v); });
  return { child, next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise((r, reject) => { const timer = setTimeout(() => reject(new Error('Process response timeout: ' + stderr)), 15000); readers.push(x => { clearTimeout(timer); r(x); }); }),
    async call(c) { child.stdin.write(JSON.stringify(c) + '\n'); return this.next(); } };
}
async function fixture(fn) {
  const base = await mkdtemp(join(tmpdir(), 'b09-terminal-')), repo = join(base, 'repo');
  const clients = [], proxies = []; let owner;
  try {
    await mkdir(repo);
    for (const args of [['init', '-b', 'trunk'], ['config', 'user.name', 'Fixture'], ['config', 'user.email', 'fixture@example.invalid']]) await exec('git', ['-C', repo, ...args]);
    await writeFile(join(repo, 'base'), 'base'); await exec('git', ['-C', repo, 'add', '.']); await exec('git', ['-C', repo, 'commit', '-m', 'base']);
    await writeFile(join(repo, 'staged'), 'KEEP'); await exec('git', ['-C', repo, 'add', 'staged']);
    const before = (await exec('git', ['-C', repo, 'diff', '--cached'])).stdout;
    owner = peer(spawn(process.execPath, ['test/android-shared-fixture.js', join(base, 'durable'), repo], { stdio: ['pipe', 'pipe', 'pipe'] }));
    const metadata = await owner.next(); assert.equal(metadata.ready, true);
    async function proxy(transform, before = () => {}) {
      const server = createServer(async (req, res) => {
        try {
          const chunks = []; for await (const chunk of req) chunks.push(chunk);
          await before(req, Buffer.concat(chunks));
          const response = await fetch(metadata.endpoint + req.url, { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
          const body = await response.json(); const result = transform(req, body) ?? body;
          res.writeHead(response.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result));
        } catch { req.socket.destroy(); }
      });
      server.listen(0, '127.0.0.1'); await once(server, 'listening'); proxies.push(server);
      return 'http://127.0.0.1:' + server.address().port;
    }
    async function client(name = 'client', endpoint = metadata.endpoint) {
      const dir = join(base, name); await mkdir(dir, { mode: 0o700, recursive: true });
      const config = join(dir, 'config.json');
      await writeFile(config, JSON.stringify({ endpoint, token, pageSize: 1 }), { mode: 0o600 });
      const p = peer(spawn(process.execPath, [clientPath, '--config', config], { stdio: ['pipe', 'pipe', 'pipe'] })); clients.push(p);
      assert.deepEqual(await p.next(), { ready: true }); p.dir = dir;
      p.state = async () => JSON.parse(await readFile(join(dir, 'conversation-state.json'), 'utf8'));
      p.close = async () => { if (p.child.exitCode !== null || p.child.signalCode !== null) return; const exit = once(p.child, 'exit'); p.child.stdin.end(); await exit; };
      return p;
    }
    await fn({ client, proxy, owner, ...metadata });
    assert.equal((await exec('git', ['-C', repo, 'diff', '--cached'])).stdout, before);
  } finally {
    for (const p of clients) if (p.child.exitCode === null && p.child.signalCode === null) { p.child.kill('SIGINT'); await once(p.child, 'exit'); }
    for (const proxy of proxies) { proxy.closeAllConnections(); await new Promise(r => proxy.close(r)); }
    if (owner && owner.child.exitCode === null) { const exited = once(owner.child, 'exit'); owner.child.stdin.end(); await exited; }
    await rm(base, { recursive: true, force: true });
  }
}
const ok = response => { assert.equal(response.ok, true, JSON.stringify(response)); return response.result; };
const error = (response, code) => { assert.equal(response.ok, false); if (code) assert.equal(response.error, code); };
const open = (p, chat) => p.call({ command: 'open', conversationId: chat }).then(ok);

test('B09 child process: completed remote discovery, duplicate opens/feed, private cursor and reconnect', () => fixture(async f => {
  let p = await f.client();
  const listing = ok(await p.call({ command: 'list' }));
  assert.equal(listing.conversations.find(x => x.conversationId === 'remote-finished').currentRun.status, 'done');
  const first = await open(p, 'remote-finished'), again = await open(p, 'remote-finished');
  assert.deepEqual(again, first); assert.equal(first.records.length, 1);
  assert.equal(ok(await p.call({ command: 'read', conversationId: 'remote-finished' })).records.length, 1);
  assert.equal((await stat(join(p.dir, 'conversation-state.json'))).mode & 0o777, 0o600);
  const state = await p.state(); assert.equal(state.ownerId, f.ownerId); assert.ok(state.chats['remote-finished'].after);
  await p.close(); p = await f.client(); assert.deepEqual(await open(p, 'remote-finished'), first); await p.close();
}));

test('B09 child process: actual lost Send response, EOF detach, original-ID recovery without duplicate dispatch', () => fixture(async f => {
  let p = await f.client();
  error(await p.call({ command: 'send', conversationId: 'remote-finished', text: 'lost-acceptance' }));
  const state = await p.state(), [id] = Object.keys(state.outbox); assert.ok(id); assert.equal(state.outbox[id].accepted, undefined);
  await p.close(); p = await f.client();
  const result = ok(await p.call({ command: 'recover' })); assert.equal(result.sends[0].id, id);
  await p.call({ command: 'recover' });
  const snapshot = await f.owner.call({ command: 'snapshot' });
  assert.equal(snapshot.submissions.filter(x => x === id).length, 1); assert.equal(snapshot.dispatches.filter(x => x === id).length, 1);
  assert.equal((await open(p, 'remote-finished')).records.length, 2);
  await p.close();
}));

test('B09 child processes: competing exact approvals, lost receipt recovery and no replay on reconnect', () => fixture(async f => {
  let p = await f.client('one'); const q = await f.client('two');
  const source = (await open(p, 'approval-remote')).records[0].record.source;
  const command = { command: 'answer', conversationId: 'approval-remote', projectId: f.projectId, runId: source.id, approvalId: source.approvalOccurrenceId, answer: { confirmed: true } };
  const results = await Promise.all([p.call(command), q.call({ ...command, answer: { confirmed: false } })]);
  assert.ok(results.every(x => !x.ok)); // Winner really loses its socket; loser fails fresh proof or owner claim.
  const snapshot = await f.owner.call({ command: 'snapshot' }); assert.equal(snapshot.replies.length, 1); assert.equal(snapshot.dropped.length, 1);
  const states = await Promise.all([p.state(), q.state()]);
  const winner = states.findIndex(s => Object.keys(s.responses).some(id => snapshot.dropped.includes(id)));
  const win = winner === 0 ? p : q; const savedId = Object.keys(states[winner].responses)[0];
  await win.close(); const reopened = await f.client(winner === 0 ? 'one' : 'two');
  const recovered = ok(await reopened.call({ command: 'recover' })); assert.equal(recovered.answers[0].responseId, savedId); assert.equal(recovered.answers[0].receipt.responseId, savedId);
  error(await reopened.call(command));
  assert.equal((await f.owner.call({ command: 'snapshot' })).replies.length, 1);
  await reopened.close(); await (winner === 0 ? q : p).close();
}));

test('B09 child process: exact Stop isolation, confirmation, EOF and Ctrl-C never cancel', () => fixture(async f => {
  let p = await f.client();
  await open(p, 'archived-remote');
  await p.close(); p = await f.client();
  const exit = once(p.child, 'exit'); p.child.kill('SIGINT'); await exit;
  p = await f.client();
  let held = (await open(p, 'archived-remote')).records[0].record.source; assert.equal(held.status, 'running');
  const stop = { command: 'stop', conversationId: 'archived-remote', projectId: f.projectId, runId: held.id };
  error(await p.call(stop), 'CONFIRM_EXACT_RUN');
  error(await p.call({ ...stop, conversationId: 'approval-remote', confirm: held.id }), 'TARGET_CONFLICT');
  assert.equal(ok(await p.call({ ...stop, confirm: held.id })).runId, held.id);
  assert.equal((await open(p, 'approval-remote')).records[0].record.source.status, 'running');
  // A terminal old Stop cannot affect a later run in the very same conversation.
  for (let i = 0; i < 100; i++) {
    if ((await open(p, 'archived-remote')).records[0].record.source.status === 'cancelled') break;
    await new Promise(r => setTimeout(r, 10));
  }
  const nextRun = ok(await p.call({ command: 'send', conversationId: 'archived-remote', text: 'hold' }));
  ok(await p.call({ ...stop, confirm: held.id }));
  const later = await open(p, 'archived-remote'); assert.equal(later.records.find(x => x.id === nextRun.id).record.source.status, 'running');
  await p.close(); p = await f.client();
  assert.equal((await open(p, 'archived-remote')).records.find(x => x.id === nextRun.id).record.source.status, 'running');
  const detached = once(p.child, 'exit'); ok(await p.call({ command: 'detach' })); await detached;
}));

test('B09 child process: unknown schemas/owner/downgrade retain original outbox/cursors and never use legacy', () => fixture(async f => {
  let mode = '', postCount = 0, p, beforeContinuation;
  const endpoint = await f.proxy((req, body) => {
    if (req.url === '/health') {
      if (mode === 'owner') return { ...body, ownerId: '00000000-0000-4000-8000-000000000000' };
      if (mode === 'old') return { ...body, protocolVersion: 5, conversationCore: false };
      if (mode === 'schema') return { ...body, eventSchemaVersion: 2 };
    }
    if (mode === 'page' && req.url.includes('/remote-finished?')) return { ...body, schemaVersion: 2 };
    if (mode === 'foreign-page' && req.url.includes('/remote-finished?')) return { ...body, ownerId: 'foreign' };
    if ((mode === 'gap' || mode === 'later-gap' && req.url.includes('token=')) && req.url.includes('/events?')) return { ...body, after: { ...body.after, sequence: body.after.sequence + 1 } };
  }, async (req, bytes) => {
    if (mode === 'later-gap' && req.url.includes('/events?') && req.url.includes('token=')) beforeContinuation = await p.state();
    if (req.method !== 'POST') return;
    postCount++;
    const body = JSON.parse(bytes), saved = await p.state();
    assert.equal(req.headers['x-conversation-owner'], saved.ownerId);
    assert.equal(req.headers['x-conversation-schema'], '1');
    if (req.url === '/v1/jobs') assert.equal(saved.outbox[body.requestId].text, body.text);
  });
  p = await f.client('gated', endpoint);
  await open(p, 'remote-finished');
  error(await p.call({ command: 'send', conversationId: 'remote-finished', text: 'lost-acceptance' }));
  const saved = await p.state(); assert.equal(Object.keys(saved.outbox).length, 1);
  for (mode of ['owner', 'old', 'schema', 'page', 'foreign-page', 'gap']) {
    error(await p.call({ command: ['gap'].includes(mode) ? 'read' : 'open', conversationId: 'remote-finished' }));
    if (['owner', 'old', 'schema'].includes(mode)) error(await p.call({ command: 'recover' }));
    assert.deepEqual(await p.state(), saved);
  }
  assert.equal(postCount, 1);
  mode = 'later-gap'; error(await p.call({ command: 'read', conversationId: 'remote-finished' }));
  assert.ok(beforeContinuation); assert.deepEqual(await p.state(), beforeContinuation);
  // Another command saves in-memory state too: a rejected continuation must not leak
  // tentative records into the next preflight's atomic write.
  mode = ''; ok(await p.call({ command: 'list' })); assert.deepEqual(await p.state(), beforeContinuation);
  assert.equal(ok(await p.call({ command: 'recover' })).sends.length, 1);
  await p.close();
}));

test('B09 child process: duplicated snapshot items/pages and replayed feed are idempotent across reopen', () => fixture(async f => {
  let duplicate = false;
  const endpoint = await f.proxy((req, body) => {
    if (duplicate && req.url.includes('/remote-finished?')) return { ...body, items: body.items.flatMap(x => [x, x]) };
  });
  let p = await f.client('duplicate', endpoint);
  const first = await open(p, 'remote-finished');
  const saved = await p.state();
  ok(await p.call({ command: 'send', conversationId: 'remote-finished', text: 'next terminal turn' }));
  // Capture and apply actual feed pages. Then simulate a crash before local cursor commit
  // by restoring ONLY this disposable client's earlier atomic state and rereading.
  let feed;
  for (let i = 0; i < 100; i++) {
    feed = ok(await p.call({ command: 'read', conversationId: 'remote-finished' }));
    if (feed.records.length === 2 && feed.records[1].record.source.status === 'done') break;
  }
  assert.equal(feed.records.length, 2); await p.close();
  await writeFile(join(p.dir, 'conversation-state.json'), JSON.stringify(saved), { mode: 0o600 });
  p = await f.client('duplicate', endpoint);
  assert.deepEqual(ok(await p.call({ command: 'read', conversationId: 'remote-finished' })), feed);
  duplicate = true; const snapshot = await open(p, 'remote-finished');
  assert.equal(snapshot.records.length, 2); assert.deepEqual(snapshot.records, feed.records); assert.equal(first.records.length, 1);
  assert.equal((await f.owner.call({ command: 'snapshot' })).submissions.length, 1);
  await p.close();
}));

test('B09 child process: history-only evidence stays read-only and cannot Send or answer cached dialogs', () => fixture(async f => {
  const manifest = { schemaVersion: 1, ownerId: f.ownerId, conversationId: 'history-only', importId: 'terminal-fixture-import', projectId: null,
    provenance: { kind: 'android-v4', sourceId: 'synthetic-history' }, session: { title: 'Historical evidence' }, rows: [
      { requestId: 'historical-only-run', ordinal: 1, text: 'old text', answer: 'old answer', clientStatus: 'done', projectId: null, pending: '{"method":"confirm"}' },
      { requestId: 'unresolved-only-run', ordinal: 2, text: 'uncertain text', answer: '', clientStatus: 'unknown', projectId: null }
    ] };
  manifest.digest = historyDigest(manifest);
  const response = await fetch(f.endpoint + '/v1/conversations/history-only/history/imports', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-Conversation-Schema': '1', 'X-Conversation-Owner': f.ownerId, 'X-History-Schema': '1' }, body: JSON.stringify(manifest) });
  assert.equal(response.status, 200);
  const p = await f.client(); const view = await open(p, 'history-only'); assert.equal(view.readOnly, true);
  const rows = view.evidence.filter(x => x.kind === 'evidence'); assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(x => x.classification), ['historical-unverified', 'unresolved-outbox']);
  error(await p.call({ command: 'send', conversationId: 'history-only', text: 'do not send' }), 'READ_ONLY');
  error(await p.call({ command: 'answer', conversationId: 'history-only', projectId: f.projectId, runId: 'historical-only-run', approvalId: 'cached', answer: { confirmed: true } }));
  assert.equal((await f.owner.call({ command: 'snapshot' })).submissions.length, 0); await p.close();
}));

test('B09 child process: approval ID/answer intent is durable before HTTP; uncertain answer is never posted again', () => fixture(async f => {
  let p, observed = 0;
  const endpoint = await f.proxy(() => {}, async (req, bytes) => {
    if (!req.url.includes('/approvals/') || req.method !== 'POST') return;
    const body = JSON.parse(bytes), state = await p.state(); observed++;
    assert.equal(state.ownerId, f.ownerId); assert.equal(state.responses[body.responseId].approvalId, body.approvalId);
    assert.deepEqual(state.responses[body.responseId].answer, body.answer);
  });
  p = await f.client('answer-persist', endpoint);
  const source = (await open(p, 'approval-remote')).records[0].record.source;
  const command = { command: 'answer', conversationId: 'approval-remote', projectId: f.projectId, runId: source.id, approvalId: source.approvalOccurrenceId, answer: { confirmed: true } };
  error(await p.call({ ...command, answer: { confirmed: true, extra: 'not normalized' } }), 'EXACT_ANSWER_REQUIRED');
  assert.equal(Object.keys((await p.state()).responses).length, 0);
  error(await p.call(command)); assert.equal(observed, 1);
  await p.close(); p = await f.client('answer-persist', endpoint);
  const recovery = ok(await p.call({ command: 'recover' })); assert.ok(recovery.answers[0].receipt);
  error(await p.call(command)); assert.equal(observed, 1); await p.close();
}));

test('B09 child process: loss before admission retries only original durable ID after exact GET absence', () => fixture(async f => {
  let drop = true, observedId, p;
  const endpoint = await f.proxy(() => {}, async (req, bytes) => {
    if (req.method !== 'POST' || req.url !== '/v1/jobs') return;
    const body = JSON.parse(bytes), saved = await p.state();
    assert.equal(saved.outbox[body.requestId].text, body.text);
    if (drop) { drop = false; observedId = body.requestId; req.socket.destroy(); throw new Error('Fixture pre-admission loss'); }
    assert.equal(body.requestId, observedId);
  });
  p = await f.client('before-admission', endpoint);
  error(await p.call({ command: 'send', conversationId: 'remote-finished', text: 'next turn' })); await p.close();
  assert.equal((await f.owner.call({ command: 'snapshot' })).submissions.length, 0);
  p = await f.client('before-admission', endpoint);
  assert.equal(ok(await p.call({ command: 'recover' })).sends[0].id, observedId);
  for (let i = 0; i < 100; i++) {
    if ((await open(p, 'remote-finished')).records.find(x => x.id === observedId)?.record.source.status === 'done') break;
    await new Promise(r => setTimeout(r, 10));
  }
  const snapshot = await f.owner.call({ command: 'snapshot' });
  assert.equal(snapshot.submissions.filter(x => x === observedId).length, 1);
  assert.equal(snapshot.dispatches.filter(x => x === observedId).length, 1); await p.close();
}));

test('B09 child process: private config and single-writer state lock, without secret/path diagnostics', () => fixture(async f => {
  const p = await f.client('locked'); await open(p, 'remote-finished');
  const second = peer(spawn(process.execPath, [clientPath, '--config', join(p.dir, 'config.json')], { stdio: ['pipe', 'pipe', 'pipe'] }));
  const exited = once(second.child, 'exit'), result = await second.next();
  error(result); assert.ok(!JSON.stringify(result).includes(token)); assert.ok(!JSON.stringify(result).includes(p.dir));
  await exited;
  // A refused second client must not remove the first client's lock.
  assert.ok(await stat(join(p.dir, 'conversation-client.lock'))); await p.close();
  const config = join(p.dir, 'config.json');
  const { chmod } = await import('node:fs/promises'); await chmod(config, 0o644);
  const unsafe = peer(spawn(process.execPath, [clientPath, '--config', config], { stdio: ['pipe', 'pipe', 'pipe'] }));
  const stopped = once(unsafe.child, 'exit'); error(await unsafe.next(), 'PRIVATE_FILE_REQUIRED'); await stopped;
}));
