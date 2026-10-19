import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlugin, piDroidManifest } from '../index.js';

test('unavailable/unverified inspection is not readiness and never exposes partial or private metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fantastic-pi-mobile-plugin-state-'));
  try {
    await mkdir(join(root, 'scripts'));
    const fixture = join(root, 'state.json');
    await writeFile(join(root, 'scripts/bridge-work'), `#!${process.execPath}
import { readFileSync } from 'node:fs';
console.log(readFileSync(${JSON.stringify(fixture)}, 'utf8'));
`, { mode: 0o700 });
    const plugin = createPlugin();
    await plugin.initialize({ checkout: root });
    for (const [state, reason] of [['unavailable', 'storage-lock-missing'], ['unverified', 'http-owner-mismatch'], ['unverified', 'fixture-private-token']]) {
      await writeFile(fixture, JSON.stringify({ state, ready: false, reason,
        owner: { pid: 123, startTicks: '77' }, health: { processId: 123, secret: 'fixture-private-token' },
        storage: { idle: true, activeTasks: 0, totalTasks: 2 } }));
      const status = await plugin.getStatus();
      assert.equal(status.ready, false);
      assert.equal(status.metadata.ready, false);
      assert.equal(status.metadata.state, state);
      assert.equal(status.metadata.reason, reason === 'fixture-private-token' ? 'identity-unverified' : reason);
      assert.equal('owner' in status.metadata, false);
      assert.equal(JSON.stringify(status).includes('fixture-private-token'), false);
    }
    await plugin.destroy();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('optional host adapter contract; no production config, tmux or ADB', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fantastic-pi-mobile-plugin-'));
  try {
    await mkdir(join(root, 'scripts'));
    const marker = join(root, 'calls.jsonl');
    await writeFile(join(root, 'scripts/bridge-work'), `#!${process.execPath}
import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(marker)}, JSON.stringify({args:process.argv.slice(2), contaminated:!!process.env.FANTASTIC_PI_MOBILE_TOKEN, session:process.env.FANTASTIC_PI_MOBILE_TMUX_SESSION})+'\\n');
if (process.argv[2]==='stop') { console.error('fixture-private-token'); process.exit(1); }
console.log(JSON.stringify({owner:{pid:123,startTicks:'77'},health:{processId:123,secret:'fixture-private-token'},storage:{idle:true,activeTasks:0,totalTasks:2},maintenance:{idle:true,admissionsPaused:false}}));
`, { mode: 0o700 });
    const plugin = createPlugin();
    await plugin.initialize({ checkout: root, session: 'fixture', window: 'bridge' });
    assert.equal(await plugin.onHeartbeat(), null);
    assert.equal(piDroidManifest.tools.filter(t => t.requiresApproval).length, 4);
    assert.equal((await plugin.execute('fantastic-pi-mobile.start', {})).data.code, 'explicit-consent-required');
    assert.equal((await plugin.execute('fantastic-pi-mobile.run', { confirmed: true })).success, false);
    assert.equal((await plugin.execute('fantastic-pi-mobile.stop', { confirmed: true, legacy: true })).success, false);
    await assert.rejects(readFile(marker)); // loading and refused actions execute nothing
    const old = process.env.FANTASTIC_PI_MOBILE_TOKEN;
    process.env.FANTASTIC_PI_MOBILE_TOKEN = 'fixture-private-token';
    try {
      assert.equal((await plugin.getStatus()).ready, true);
      const result = await plugin.execute('fantastic-pi-mobile.status', {});
      assert.equal(JSON.stringify(result).includes('fixture-private-token'), false);
      assert.equal((await plugin.execute('fantastic-pi-mobile.start', { confirmed: true })).success, true);
      const stop = await plugin.execute('fantastic-pi-mobile.stop', { confirmed: true });
      assert.equal(stop.success, false);
      assert.equal(JSON.stringify(stop).includes('fixture-private-token'), false);
    } finally { if (old === undefined) delete process.env.FANTASTIC_PI_MOBILE_TOKEN; else process.env.FANTASTIC_PI_MOBILE_TOKEN = old; }
    const calls = (await readFile(marker, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(c => c.args), [['status'], ['status'], ['start'], ['stop']]);
    assert.ok(calls.every(c => !c.contaminated && c.session === 'fixture'));
    await plugin.destroy();
    assert.equal((await plugin.execute('fantastic-pi-mobile.start', { confirmed: true })).success, false);
    assert.equal(await plugin.onHeartbeat(), null);
    assert.equal((await readFile(marker, 'utf8')).trim().split('\n').length, 4);
  } finally { await rm(root, { recursive: true, force: true }); }
});
