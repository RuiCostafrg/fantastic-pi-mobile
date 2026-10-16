import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlugin, piDroidManifest } from '../index.js';

test('optional host adapter contract; no production config, tmux or ADB', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pocket-plugin-'));
  try {
    await mkdir(join(root, 'scripts'));
    const marker = join(root, 'calls.jsonl');
    await writeFile(join(root, 'scripts/bridge-work'), `#!${process.execPath}
import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(marker)}, JSON.stringify({args:process.argv.slice(2), contaminated:!!process.env.PI_POCKET_TOKEN, session:process.env.PI_POCKET_TMUX_SESSION})+'\\n');
if (process.argv[2]==='stop') { console.error('fixture-private-token'); process.exit(1); }
console.log(JSON.stringify({owner:{pid:123,startTicks:'77'},health:{processId:123,secret:'fixture-private-token'},storage:{idle:true,activeTasks:0,totalTasks:2},maintenance:{idle:true,admissionsPaused:false}}));
`, { mode: 0o700 });
    const plugin = createPlugin();
    await plugin.initialize({ checkout: root, session: 'fixture', window: 'bridge' });
    assert.equal(await plugin.onHeartbeat(), null);
    assert.equal(piDroidManifest.tools.filter(t => t.requiresApproval).length, 4);
    assert.equal((await plugin.execute('pocket.start', {})).data.code, 'explicit-consent-required');
    assert.equal((await plugin.execute('pocket.run', { confirmed: true })).success, false);
    assert.equal((await plugin.execute('pocket.stop', { confirmed: true, legacy: true })).success, false);
    await assert.rejects(readFile(marker)); // loading and refused actions execute nothing
    const old = process.env.PI_POCKET_TOKEN;
    process.env.PI_POCKET_TOKEN = 'fixture-private-token';
    try {
      assert.equal((await plugin.getStatus()).ready, true);
      const result = await plugin.execute('pocket.status', {});
      assert.equal(JSON.stringify(result).includes('fixture-private-token'), false);
      assert.equal((await plugin.execute('pocket.start', { confirmed: true })).success, true);
      const stop = await plugin.execute('pocket.stop', { confirmed: true });
      assert.equal(stop.success, false);
      assert.equal(JSON.stringify(stop).includes('fixture-private-token'), false);
    } finally { if (old === undefined) delete process.env.PI_POCKET_TOKEN; else process.env.PI_POCKET_TOKEN = old; }
    const calls = (await readFile(marker, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(c => c.args), [['status'], ['status'], ['start'], ['stop']]);
    assert.ok(calls.every(c => !c.contaminated && c.session === 'fixture'));
    await plugin.destroy();
    assert.equal((await plugin.execute('pocket.start', { confirmed: true })).success, false);
    assert.equal(await plugin.onHeartbeat(), null);
    assert.equal((await readFile(marker, 'utf8')).trim().split('\n').length, 4);
  } finally { await rm(root, { recursive: true, force: true }); }
});
