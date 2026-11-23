#!/usr/bin/env node
// HTTP observer only. No bridge imports, subprocesses, session files or executor.
import { open, lstat, readFile, rename, realpath } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
const check = (ok, code = 'INVALID_RESPONSE') => { if (!ok) throw new Error(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const id = x => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(x);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const enc = encodeURIComponent;
const emit = x => process.stdout.write(JSON.stringify(x) + '\n');
let lock, lockPath;
async function privateFile(path) {
  const s = await lstat(path); check(s.isFile() && !s.isSymbolicLink() && s.uid === process.getuid() && !(s.mode & 0o077), 'PRIVATE_FILE_REQUIRED');
  return JSON.parse(await readFile(path, 'utf8'));
}
async function main() {
  check(process.argv.length === 4 && process.argv[2] === '--config', 'USE_CONFIG_FILE');
  const configPath = resolve(process.argv[3]);
  const ds = await lstat(dirname(configPath)), directory = await realpath(dirname(configPath));
  check(ds.isDirectory() && !ds.isSymbolicLink() && ds.uid === process.getuid() && !(ds.mode & 0o077), 'PRIVATE_DIRECTORY_REQUIRED');
  // Private state must not live in a source checkout, even if ignored.
  for (let p = directory;; p = dirname(p)) {
    try { await lstat(join(p, '.git')); throw new Error('STATE_IN_GIT'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (dirname(p) === p) break;
  }
  const config = await privateFile(configPath), url = new URL(config.endpoint);
  check(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'INVALID_ENDPOINT');
  check(url.protocol === 'https:' || ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname), 'HTTPS_REQUIRED');
  check(typeof config.token === 'string' && config.token.length >= 16 && !/[\r\n]/.test(config.token), 'INVALID_CREDENTIAL');
  const endpoint = url.origin, credential = createHash('sha256').update(config.token).digest('hex');
  const pageSize = config.pageSize ?? 50; check(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 200, 'INVALID_PAGE_SIZE');
  const statePath = join(directory, 'conversation-state.json');
  lockPath = join(directory, 'conversation-client.lock');
  lock = await open(lockPath, 'wx', 0o600);
  let state;
  try { state = await privateFile(statePath); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  state ??= { version: 1, endpoint, credential, ownerId: null, chats: {}, outbox: {}, responses: {} };
  check(state.version === 1 && state.endpoint === endpoint && state.credential === credential, 'CONNECTION_CHANGED');
  check(['chats', 'outbox', 'responses'].every(k => state[k] && typeof state[k] === 'object' && !Array.isArray(state[k])), 'INVALID_STATE');
  check(uuid(state.ownerId) || state.ownerId === null && ['chats', 'outbox', 'responses'].every(k => !Object.keys(state[k]).length), 'INVALID_STATE');
  async function save() {
    const temp = statePath + '.' + randomUUID();
    const f = await open(temp, 'wx', 0o600);
    try { await f.writeFile(JSON.stringify(state)); await f.sync(); } finally { await f.close(); }
    await rename(temp, statePath);
    const d = await open(directory, 'r'); try { await d.sync(); } finally { await d.close(); }
  }
  async function request(path, body) {
    const response = await fetch(endpoint + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json', 'X-Conversation-Schema': '1', 'X-Conversation-Owner': state.ownerId ?? '', 'X-History-Schema': '1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    // Never print raw exceptions, URLs, server errors or credentials.
    if (!response.ok) throw new Error('HTTP_' + response.status);
    const chunks = []; let length = 0;
    for await (const chunk of response.body) { length += chunk.length; check(length <= 1048576, 'RESPONSE_TOO_LARGE'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async function preflight() {
    const h = await request('/health');
    check(h.protocolVersion === 6 && h.conversationCore === true && h.projectBindings === true && h.eventSchemaVersion === 1 && h.historyImport === true && h.historySchemaVersion === 1, 'CAPABILITY_REQUIRED');
    check(uuid(h.ownerId), 'INVALID_OWNER');
    check(!state.ownerId || state.ownerId === h.ownerId, 'OWNER_CHANGED');
    state.ownerId = h.ownerId; await save();
  }
  function scope(p, chat) {
    check(p.schemaVersion === 1 && p.ownerId === state.ownerId && Array.isArray(p.items));
    if (chat) check(p.conversationId === chat);
  }
  function token(t, chat, kind, project, generation) {
    check(t && t.schemaVersion === 1 && t.ownerId === state.ownerId && t.conversationId === chat && t.kind === kind && t.projectId === project && t.generation === generation && integer(t.sequence));
  }
  async function list() {
    const items = [], seen = new Set(); let next = null, last = '';
    do {
      const p = await request('/v1/conversations?' + new URLSearchParams({ limit: String(pageSize), ...(next ? { token: JSON.stringify(next) } : {}) })); scope(p);
      for (const item of p.items) {
        check(id(item.conversationId) && item.conversationId > last && [undefined, true, false].includes(item.executionAvailable));
        check(item.executionAvailable === false ? item.projectId === null && item.sequence === null && item.currentRun === null : id(item.projectId) && integer(item.sequence));
        if (item.currentRun !== null) check(item.currentRun && id(item.currentRun.runId) && ['queued', 'running', 'done', 'failed', 'cancelled', 'interrupted'].includes(item.currentRun.status));
        if (item.historyEvidence) check(integer(item.historyEvidence.revision) && item.historyEvidence.readOnly === true && item.historyEvidence.executionAuthority === false);
        last = item.conversationId; items.push(item);
      }
      next = p.next;
      if (next) { check(next.schemaVersion === 1 && next.ownerId === state.ownerId && next.kind === 'history-catalogue-page' && next.lastId === last && !seen.has(JSON.stringify(next))); seen.add(JSON.stringify(next)); }
    } while (next);
    return items;
  }
  async function history(chat) {
    let next = null, revision; const items = {}, seen = new Set();
    do {
      const p = await request('/v1/conversations/' + enc(chat) + '/history?' + new URLSearchParams({ limit: String(pageSize), ...(next ? { token: JSON.stringify(next) } : {}) })); scope(p, chat);
      check(p.readOnly === true && p.executionAuthority === false && integer(p.revision) && (revision === undefined || revision === p.revision)); revision = p.revision;
      for (const item of p.items) { check(['evidence', 'import'].includes(item.kind)); items[JSON.stringify(item)] = item; }
      next = p.next;
      if (next) { check(next.schemaVersion === 1 && next.ownerId === state.ownerId && next.conversationId === chat && next.kind === 'history-page' && next.revision === revision && !seen.has(JSON.stringify(next))); seen.add(JSON.stringify(next)); }
    } while (next);
    return Object.values(items);
  }
  function record(c, item) {
    const r = item.record, s = r?.source;
    check(['turn', 'review'].includes(item.kind) && id(item.id) && integer(item.ordinal) && item.ordinal > 0 && integer(item.revision) && s?.id === item.id && (s.sessionId ?? 'pocket') === c.conversationId && s.projectId === c.projectId && r.revision === item.revision && r.ordinal === item.ordinal);
    if (item.kind === 'turn') check(r.runId === item.id && typeof s.text === 'string' && same(r.messages, [
      { id: JSON.stringify([item.id, 'user']), role: 'user', text: s.text },
      { id: JSON.stringify([item.id, 'assistant']), role: 'assistant', text: s.answer ?? '' }
    ]));
    const key = item.kind + ':' + item.id, old = c.records[key];
    if (old?.revision === item.revision) check(same(old, item), 'RECORD_CONFLICT');
    if (!old || old.revision <= item.revision) c.records[key] = item;
  }
  async function read(chat, fresh = false) {
    check(id(chat), 'INVALID_CHAT');
    const catalogue = await list(), entry = catalogue.find(x => x.conversationId === chat); check(entry, 'UNKNOWN_CHAT');
    const evidence = entry.historyEvidence ? await history(chat) : [];
    if (entry.executionAvailable === false) return { conversationId: chat, readOnly: true, evidence };
    const prior = state.chats[chat];
    let c = fresh || !prior ? { conversationId: chat, projectId: entry.projectId, records: {}, after: null } : structuredClone(prior);
    check(c.projectId === entry.projectId, 'PROJECT_CHANGED');
    let next = null, upper; const seen = new Set(); const snapshot = !c.after;
    do {
      // Never mutate a previously committed page while validating its continuation.
      c = structuredClone(c);
      const opts = next ? { token: JSON.stringify(next) } : snapshot ? {} : { after: JSON.stringify(c.after) };
      const p = await request('/v1/conversations/' + enc(chat) + (snapshot ? '' : '/events') + '?' + new URLSearchParams({ limit: String(pageSize), ...opts })); scope(p, chat);
      check(p.consistentRead === true && p.liveWrites === true && p.projectId === c.projectId && typeof p.generation === 'string');
      check(!c.generation || c.generation === p.generation, 'GENERATION_CHANGED'); c.generation = p.generation;
      token(p.after, chat, 'feed-cursor', c.projectId, c.generation);
      if (snapshot) {
        token(p.snapshot, chat, 'snapshot-page', c.projectId, c.generation);
        check(p.highWater === p.after.sequence && (c.highWater === undefined || c.highWater === p.highWater)); c.highWater = p.highWater;
        for (const item of p.items) record(c, item);
      } else {
        token(p.page, chat, 'feed-page', c.projectId, c.generation);
        check(p.page.sequence === c.after.sequence && integer(p.upper) && p.upper >= c.after.sequence && (upper === undefined || upper === p.upper), 'CURSOR_CONFLICT'); upper = p.upper;
        let sequence = c.after.sequence;
        for (const item of p.items) {
          const e = item.event; check(e?.schemaVersion === 1 && e.ownerId === state.ownerId && e.conversationId === chat && e.projectId === c.projectId && e.generation === c.generation && e.sequence === ++sequence, 'EVENT_GAP');
          check(e.type !== 'snapshot.reset', 'SNAPSHOT_REQUIRED');
          check(e.kind === 'turn' ? e.type === 'turn.accepted' || /^run\.(status|progress|result|pending|done|failed|cancelled|interrupted)$/.test(e.type) : e.kind === 'review' && /^review\.(accepted|running|done|failed|cancelled|interrupted)$/.test(e.type), 'UNKNOWN_EVENT');
          record(c, { kind: e.kind, id: e.recordId, ordinal: e.ordinal, revision: e.revision, record: item.record });
        }
        check(p.after.sequence === sequence && sequence <= upper && (p.next === null ? sequence === upper : sequence < upper));
      }
      c.after = p.after; next = p.next;
      if (next) { token(next, chat, snapshot ? 'snapshot-page' : 'feed-page', c.projectId, c.generation); check(next.sequence === p.after.sequence && (snapshot ? next.sequence === c.highWater : next.upper === p.upper), 'CURSOR_CONFLICT'); check(!seen.has(JSON.stringify(next)), 'PAGE_LOOP'); seen.add(JSON.stringify(next)); }
      // Snapshot adopts its cursor only after all pages; interrupted reads restart safely.
      if (!snapshot || !next) {
        if (snapshot) for (const kind of ['turn', 'review']) {
          const rows = Object.values(c.records).filter(r => r.kind === kind).sort((a, b) => a.ordinal - b.ordinal);
          check(rows.every((r, i) => r.ordinal === i + 1 && r.revision <= c.highWater), 'SNAPSHOT_GAP');
        }
        state.chats[chat] = c; await save();
      }
    } while (next);
    return { conversationId: chat, projectId: c.projectId, records: Object.values(c.records).sort((a, b) => a.ordinal - b.ordinal), evidence };
  }
  function job(j, target) { check(j.id === target.requestId && (j.sessionId ?? 'pocket') === target.conversationId && j.projectId === target.projectId && j.text === target.text, 'JOB_CONFLICT'); return j; }
  async function recoverSend(o) {
    // Also gates recovery after an earlier local persistence failure, not just HTTP loss.
    await save();
    let j;
    try { j = await request('/v1/jobs/' + enc(o.requestId)); } catch (e) { if (e.message !== 'HTTP_404') throw e; }
    if (!j) j = await request('/v1/jobs', o);
    job(j, o); state.outbox[o.requestId].accepted = true; await save(); return j;
  }
  async function exact(c) {
    check(id(c.conversationId) && id(c.runId) && id(c.projectId), 'EXACT_TARGET_REQUIRED');
    const j = await request('/v1/jobs/' + enc(c.runId));
    check(j.id === c.runId && (j.sessionId ?? 'pocket') === c.conversationId && j.projectId === c.projectId, 'TARGET_CONFLICT'); return j;
  }
  function receipt(r, o) { check(r && r.ownerId === state.ownerId && ['conversationId', 'projectId', 'runId', 'approvalId', 'responseId'].every(k => r[k] === o[k]) && same(r.answer, o.answer) && ['attempted', 'unknown'].includes(r.delivery), 'RECEIPT_CONFLICT'); return r; }
  async function command(c) {
    if (c.command === 'detach') return { detached: true };
    await preflight();
    if (c.command === 'list') return { conversations: await list() };
    if (['open', 'read'].includes(c.command)) return read(c.conversationId, c.command === 'open');
    if (c.command === 'send') {
      check(typeof c.text === 'string' && c.text.trim(), 'TEXT_REQUIRED');
      const view = await read(c.conversationId, true); check(!view.readOnly, 'READ_ONLY');
      check(!Object.values(state.outbox).some(o => !o.accepted && o.conversationId === c.conversationId), 'RECOVER_OUTBOX_FIRST');
      const requestId = randomUUID(), o = { requestId, conversationId: c.conversationId, projectId: view.projectId, text: c.text };
      state.outbox[requestId] = o; await save(); return recoverSend(o);
    }
    if (c.command === 'recover') {
      const sends = [], answers = [];
      for (const o of Object.values(state.outbox)) if (!o.accepted) sends.push(await recoverSend(o));
      for (const o of Object.values(state.responses)) if (!o.receipt) {
        const j = await exact(o);
        if (j.approvalResponse?.responseId === o.responseId) { o.receipt = receipt(j.approvalResponse, o); await save(); }
        answers.push({ responseId: o.responseId, receipt: o.receipt ?? null, nonReplayable: true });
      }
      return { sends, answers };
    }
    if (c.command === 'answer') {
      const j = await exact(c); check(j.approvalOccurrenceId === c.approvalId && j.pending && !j.stopRequested && ['running', 'queued'].includes(j.status), 'STALE_APPROVAL');
      check(!Object.values(state.responses).some(o => o.approvalId === c.approvalId), 'RECOVER_RESPONSE_FIRST');
      const a = c.answer, raw = j.pending;
      check(a && typeof a === 'object' && !Array.isArray(a), 'ANSWER_REQUIRED');
      let answer;
      if (a.cancelled === true) answer = { cancelled: true };
      else if (raw.method === 'confirm' && typeof a.confirmed === 'boolean') answer = { confirmed: a.confirmed };
      else if (['input', 'editor', 'select'].includes(raw.method) && typeof a.value === 'string' && a.value.length <= 20000 && (raw.method !== 'select' || raw.options?.includes(a.value))) answer = { value: a.value };
      check(answer && same(a, answer), 'EXACT_ANSWER_REQUIRED');
      const responseId = randomUUID(), o = { responseId, conversationId: c.conversationId, projectId: c.projectId, runId: c.runId, approvalId: c.approvalId, answer };
      state.responses[responseId] = o; await save();
      o.receipt = receipt(await request('/v1/conversations/' + enc(o.conversationId) + '/approvals/' + enc(o.approvalId) + '/response', o), o); await save(); return o.receipt;
    }
    if (c.command === 'stop') {
      check(c.confirm === c.runId, 'CONFIRM_EXACT_RUN'); await exact(c);
      const result = await request('/v1/jobs/' + enc(c.runId) + '/cancel', { conversationId: c.conversationId, projectId: c.projectId }); check(result.runId === c.runId); return result;
    }
    throw new Error('UNKNOWN_COMMAND');
  }
  emit({ ready: true });
  for await (const line of createInterface({ input: process.stdin, terminal: false })) {
    try {
      check(Buffer.byteLength(line) <= 65536, 'COMMAND_TOO_LARGE'); const c = JSON.parse(line);
      const result = await command(c); emit({ ok: true, result }); if (c.command === 'detach') break;
    } catch (e) { emit({ ok: false, error: /^(HTTP_\d+|[A-Z][A-Z_]+)$/.test(e.message) ? e.message : 'REQUEST_FAILED' }); }
  }
  process.stdin.destroy();
}
// SIGINT/EOF are detach, never backend cancellation. OS closes local sockets only.
process.on('SIGINT', () => process.exit(0));
process.on('exit', () => { if (lock) { try { unlinkSync(lockPath); } catch {} } });
try { await main(); } catch (e) { emit({ ok: false, error: /^(HTTP_\d+|[A-Z][A-Z_]+)$/.test(e.message) ? e.message : 'CLIENT_UNAVAILABLE' }); process.exitCode = 1; }
finally {
  if (lock) {
    const f = lock; lock = null;
    try { unlinkSync(lockPath); await f.close(); } catch { emit({ ok: false, error: 'LOCAL_CLOSE_FAILED' }); process.exitCode = 1; }
  }
}
