#!/usr/bin/env node
// Run through bridge-work so Node loads the same private .env as the server.
import { readFile, readlink, realpath, stat, mkdir, writeFile, readdir, copyFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';

export const bridge = resolve(dirname(fileURLToPath(import.meta.url)), '../bridge');
const data = resolve(bridge, process.env.PI_DATA_DIR ?? 'data');
const session = process.env.PI_POCKET_TMUX_SESSION ?? 'work';
const windowName = process.env.PI_POCKET_TMUX_WINDOW ?? 'pocket-bridge';
if (![session, windowName].every(name => /^[a-zA-Z0-9_-]+$/.test(name))) {
  throw new Error('Invalid dedicated tmux session/window name.');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmux = (...args) => execFileSync('tmux', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";

export async function identity(directory = data, cwd = bridge) {
  const value = (await readFile(join(directory, 'bridge.lock'), 'utf8')).trim();
  const pid = Number(value);
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(pid) || pid > 2147483647)
    throw Object.assign(new Error('Invalid storage owner PID; inspect manually.'), { code: 'OWNER_PID_INVALID' });
  const proc = '/proc/' + pid;
  const command = await readFile(proc + '/cmdline', 'utf8').catch(error => {
    if (error.code === 'ENOENT') throw Object.assign(new Error('Storage owner process is missing; inspect possible children before recovery.'), { code: 'OWNER_PROCESS_MISSING' });
    throw error;
  });
  const args = command.split('\0').filter(Boolean);
  if (await realpath(await readlink(proc + '/cwd')) !== await realpath(cwd) ||
      await realpath(await readlink(proc + '/exe')) !== await realpath(process.execPath) ||
      resolve(cwd, args.at(-1) ?? '') !== join(cwd, 'src/server.js')) {
    throw Object.assign(new Error('Storage owner identity mismatch; no signal sent.'), { code: 'OWNER_IDENTITY_MISMATCH' });
  }
  const fields = (await readFile(proc + '/stat', 'utf8')).split(') ').at(-1).split(' ');
  return { pid, startTicks: fields[19], parent: Number(fields[1]) };
}

// The task table includes model AND repository tasks, including pending/completing.
// Never open Durable here: doing so could resume work or contend for its owner lock.
export function idleEvidence(directory = data) {
  const db = new DatabaseSync(join(directory, 'assistant.sqlite'), { readOnly: true });
  try {
    const rows = db.prepare('SELECT kind, status, count(*) AS count FROM tasks GROUP BY kind, status').all();
    const active = rows.filter(r => r.status !== 'terminal');
    return { idle: active.length === 0, activeTasks: active.reduce((n, r) => n + r.count, 0), totalTasks: rows.reduce((n, r) => n + r.count, 0) };
  } finally { db.close(); }
}

async function api(path, body) {
  const token = process.env.PI_POCKET_TOKEN;
  if (!token || token.length < 32) throw new Error('Missing private pairing configuration.');
  const response = await fetch('http://127.0.0.1:' + (process.env.PORT ?? 8787) + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw Object.assign(new Error('Bridge HTTP ' + response.status), { status: response.status });
  return response.json();
}

async function privateBackup() {
  const destination = join(data, 'maintenance-backups', new Date().toISOString().replaceAll(':', '-') + '-' + process.pid);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(data, 'assistant.sqlite'), { readOnly: true });
  try { await backup(db, join(destination, 'assistant.sqlite')); } finally { db.close(); }
  await copyFile(join(bridge, '.env'), join(destination, 'bridge.env'));
  // Worktrees contain .git pointers, so preserve their existing locations on recovery.
  // No recursive copy of old backups, logs or disposable UI fixtures.
  async function copyTree(from, to) {
    await mkdir(to, { mode: 0o700 });
    for (const entry of await readdir(from, { withFileTypes: true })) {
      if (entry.isDirectory()) await copyTree(join(from, entry.name), join(to, entry.name));
      else if (entry.isFile()) await copyFile(join(from, entry.name), join(to, entry.name));
      else throw new Error('Special file in private state; backup incomplete, stop deferred.');
    }
  }
  for (const name of ['pi-sessions', 'worktrees']) {
    try { await stat(join(data, name)); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    await copyTree(join(data, name), join(destination, name));
  }
  return destination;
}

async function status() {
  // A successful inspection is not proof that the bridge is ready or work stopped.
  // Preserve unknowns as null; never infer idleness from a missing lock/process.
  const result = { state: 'unverified', ready: false, reason: null,
    owner: null, health: null, maintenance: null, storage: null, window: [], tmuxAvailable: null };
  const refuse = (state, reason) => ({ ...result, state, ready: false, reason });
  try { await stat(join(data, 'bridge.lock')); }
  catch (error) { return refuse(error.code === 'ENOENT' ? 'unavailable' : 'unverified', error.code === 'ENOENT' ? 'storage-lock-missing' : 'owner-unreadable'); }
  try { result.owner = await identity(); }
  catch (error) {
    const reasons = { OWNER_PID_INVALID: 'owner-pid-invalid', OWNER_PROCESS_MISSING: 'owner-process-missing', OWNER_IDENTITY_MISMATCH: 'owner-identity-mismatch' };
    return refuse('unverified', reasons[error.code] ?? 'owner-unreadable');
  }
  try { result.storage = idleEvidence(); }
  catch { return refuse('unverified', 'storage-unreadable'); }
  try { result.health = await api('/health'); }
  catch (error) { return refuse('unavailable', error.status === 401 ? 'health-authentication-failed' : 'health-unavailable'); }
  if (result.health?.ok !== true || result.health.protocolVersion !== 4) return refuse('unverified', 'health-unverified');
  if (result.health.processId === undefined) return refuse('unverified', 'health-owner-unverified');
  if (result.health.processId !== result.owner.pid) return refuse('unverified', 'http-owner-mismatch');
  try { result.maintenance = await api('/v1/maintenance'); }
  catch (error) { if (error.status !== 404) return refuse('unverified', 'maintenance-unavailable'); }
  if (result.maintenance !== null) {
    const m = result.maintenance;
    if (typeof m.admissionsPaused !== 'boolean' || !Number.isSafeInteger(m.jobs) || m.jobs < 0 ||
        !Number.isSafeInteger(m.reviews) || m.reviews < 0 || m.idle !== (m.jobs === 0 && m.reviews === 0))
      return refuse('unverified', 'maintenance-unverified');
  }
  try {
    const latest = await identity();
    if (JSON.stringify(latest) !== JSON.stringify(result.owner)) return refuse('unverified', 'owner-changed');
  } catch { return refuse('unverified', 'owner-changed'); }
  try { result.window = windows(); result.tmuxAvailable = true; }
  catch { result.tmuxAvailable = false; }
  return { ...result, state: 'verified', ready: true };
}
function windows() {
  return tmux('list-windows', '-t', session, '-F', '#{window_id} #{window_name}').split('\n').filter(line => line.split(' ').slice(1).join(' ') === windowName);
}
async function stop(legacy) {
  const before = await identity();
  const health = await api('/health');
  if (health.processId !== undefined && health.processId !== before.pid) throw new Error('HTTP and storage owners differ; stop deferred.');
  if (!legacy && health.processId !== before.pid) throw new Error('Owner-aware maintenance required; use the documented initial migration.');
  if (legacy) {
    // Only for the first migration of an older server without the admission gate.
    try { await api('/v1/maintenance'); throw new Error('Use ordinary stop: this bridge supports admission pause.'); }
    catch (e) { if (e.status !== 404) throw e; }
    await api('/health');
  } else {
    const state = await api('/v1/maintenance', { paused: true });
    if (!state.admissionsPaused || !state.idle) throw new Error('Admissions paused, but model/review work is active. Wait; nothing was stopped. Resume explicitly if deferring.');
  }
  if (!idleEvidence().idle) throw new Error('Nonterminal Durable tasks remain; stop deferred.');
  const destination = await privateBackup();
  // Recheck after backup and immediately before signalling, including PID reuse.
  const after = await identity();
  if (JSON.stringify(before) !== JSON.stringify(after) || !idleEvidence().idle) throw new Error('Owner or idle evidence changed; stop deferred.');
  if (!legacy) {
    const state = await api('/v1/maintenance');
    if (!state.admissionsPaused || !state.idle) throw new Error('Maintenance gate changed; stop deferred.');
  }
  process.kill(before.pid, 'SIGTERM');
  for (let i = 0; i < 100; i++) {
    try { await stat(join(data, 'bridge.lock')); }
    catch (e) { if (e.code === 'ENOENT') { console.log('Stopped gracefully. Private backup: ' + destination); return; } throw e; }
    await sleep(100);
  }
  throw new Error('Shutdown did not release storage lock; inspect manually. No forced kill or lock deletion.');
}
async function run() {
  // This process stays in the pane; server output goes to a private file, not history.
  await mkdir(data, { recursive: true, mode: 0o700 });
  try { await stat(join(data, 'bridge.lock')); throw new Error('Storage already locked; refusing launch.'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const { open } = await import('node:fs/promises');
  const log = await open(join(data, 'bridge.log'), 'a', 0o600);
  const child = spawn(process.execPath, ['--env-file=.env', 'src/server.js'], { cwd: bridge, env: process.env, stdio: ['ignore', log.fd, log.fd] });
  await log.close();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill('SIGTERM'));
  child.on('error', () => { console.error('Bridge could not launch; inspect private log.'); process.exitCode = 1; });
  console.log('Fantastic Pi Mobile bridge — explicit launch, no automatic restart. Diagnostics: private data/bridge.log');
  child.once('spawn', async () => {
    try { await writeFile(join(data, 'bridge.pid'), String(child.pid) + '\n', { mode: 0o600 }); }
    catch { child.kill('SIGTERM'); }
  });
  await new Promise(r => child.once('close', (code, signal) => { console.log('Bridge exited (' + (signal ?? code) + '). No replay/restart attempted.'); process.exitCode = code ?? 1; r(); }));
}
async function start() {
  // A pre-existing lock, including a stale lock, is never removed automatically.
  try { await stat(join(data, 'bridge.lock')); throw new Error('Storage lock exists. Use status; inspect crashes manually.'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  tmux('has-session', '-t', session);
  if (windows().length) throw new Error('Dedicated window already exists; inspect it before starting again.');
  const command = 'exec ' + quote(join(dirname(fileURLToPath(import.meta.url)), 'bridge-work')) + ' run';
  const pane = tmux('new-window', '-d', '-P', '-F', '#{pane_id}', '-t', session + ':', '-n', windowName, '-c', bridge, command);
  // Preserve the name and failed/exited pane for deliberate inspection/recovery.
  tmux('set-window-option', '-t', pane, 'automatic-rename', 'off');
  tmux('set-window-option', '-t', pane, 'remain-on-exit', 'on');
  for (let i = 0; i < 50; i++) {
    try {
      const state = await status();
      if (!state.ready) throw new Error('Startup identity is not verified.');
      const panePid = Number(tmux('display-message', '-p', '-t', pane, '#{pane_pid}'));
      if (state.owner.parent !== panePid) throw new Error('Bridge is not owned by the dedicated pane.');
      console.log(JSON.stringify(state, null, 2)); return;
    } catch { await sleep(100); }
  }
  throw new Error('Startup not verified. Inspect dedicated pane/private log; do not blindly retry.');
}

export async function main(args) {
  process.umask(0o077);
  const [command, flag, ...extra] = args;
  if (extra.length || (flag && !(command === 'stop' && flag === '--legacy-submissions-paused'))) throw new Error('Invalid arguments.');
  switch (command) {
    case 'status': console.log(JSON.stringify(await status(), null, 2)); break;
    case 'pause': console.log(JSON.stringify(await api('/v1/maintenance', { paused: true }))); break;
    case 'resume': console.log(JSON.stringify(await api('/v1/maintenance', { paused: false }))); break;
    case 'stop': await stop(Boolean(flag)); break;
    case 'start': await start(); break;
    case 'run': await run(); break;
    default: throw new Error('Usage: scripts/bridge-work status|pause|resume|start|stop');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    // Do not print raw network/child errors, argv, environments or token values.
    const safe = error.message.startsWith('Command failed:') || error.name === 'TypeError' ? 'Local workflow check failed; inspect configuration and tmux metadata.' : error.message;
    console.error(safe); process.exitCode = 1;
  });
}
