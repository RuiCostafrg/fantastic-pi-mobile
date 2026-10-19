import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const launcher = resolve('../scripts/bridge-work.mjs');
const environment = directory => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PI_') && k !== 'PORT' && k !== 'NODE_OPTIONS')), PI_DATA_DIR: directory });
async function inspect(directory) {
  const { stdout, stderr } = await exec(process.execPath, [launcher, 'status'], { env: environment(directory), timeout: 10000 });
  assert.equal(stderr.includes('ENOENT'), false);
  return JSON.parse(stdout);
}
async function temporary(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'pocket-control-status-'));
  try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('status with missing data reports unavailable without creating storage or assuming work stopped', () => temporary(async directory => {
  const missing = join(directory, 'not-created');
  const state = await inspect(missing);
  assert.equal(state.state, 'unavailable');
  assert.equal(state.ready, false);
  assert.equal(state.reason, 'storage-lock-missing');
  assert.equal(state.owner, null);
  assert.equal(state.storage, null);
  await assert.rejects(stat(missing), { code: 'ENOENT' });
}));

test('status runs through a symlinked checkout entry point', () => temporary(async directory => {
  const linkedCheckout = join(directory, 'fantastic-pi-mobile');
  await symlink(resolve('..'), linkedCheckout);
  const { stdout } = await exec(process.execPath, [join(linkedCheckout, 'scripts/bridge-work.mjs'), 'status'],
    { env: environment(join(directory, 'missing')), timeout: 10000 });
  const state = JSON.parse(stdout);
  assert.equal(state.state, 'unavailable');
  assert.equal(state.reason, 'storage-lock-missing');
}));

test('server entry point through a symlink validates configuration instead of silently exiting', () => temporary(async directory => {
  const linkedCheckout = join(directory, 'fantastic-pi-mobile');
  await symlink(resolve('..'), linkedCheckout);
  await assert.rejects(exec(process.execPath, [join(linkedCheckout, 'bridge/src/server.js')],
    { env: { ...environment(join(directory, 'missing')), FANTASTIC_PI_MOBILE_TOKEN: 'replace-invalid-fixture-token' }, timeout: 10000 }),
    error => error.code === 1 && error.stderr.includes('Set FANTASTIC_PI_MOBILE_TOKEN'));
}));

test('status ignores an old PID hint when no owner lock exists', () => temporary(async directory => {
  await writeFile(join(directory, 'bridge.pid'), String(process.pid));
  const state = await inspect(directory);
  assert.equal(state.reason, 'storage-lock-missing');
  assert.equal(state.ready, false);
  assert.equal(await readFile(join(directory, 'bridge.pid'), 'utf8'), String(process.pid));
}));

test('status reports stale owner as unverified and preserves its lock', () => temporary(async directory => {
  await writeFile(join(directory, 'bridge.lock'), '2147483647');
  const state = await inspect(directory);
  assert.equal(state.state, 'unverified');
  assert.equal(state.reason, 'owner-process-missing');
  assert.equal(state.ready, false);
  assert.equal(await readFile(join(directory, 'bridge.lock'), 'utf8'), '2147483647');
}));

test('status refuses malformed or wrong-process owners with structured reasons', () => temporary(async directory => {
  for (const [value, reason] of [['not-a-pid', 'owner-pid-invalid'], [String(process.pid), 'owner-identity-mismatch']]) {
    await writeFile(join(directory, 'bridge.lock'), value);
    const state = await inspect(directory);
    assert.equal(state.ready, false);
    assert.equal(state.state, 'unverified');
    assert.equal(state.reason, reason);
    assert.equal(await readFile(join(directory, 'bridge.lock'), 'utf8'), value);
  }
}));
