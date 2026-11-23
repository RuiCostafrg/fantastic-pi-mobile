// B10 fake RPC process. Writes only its disposable worktree; never a provider.
import { appendFile, readFile, writeFile, access } from 'node:fs/promises';
const emit = x => process.stdout.write(JSON.stringify(x) + '\n');
let text, timer, settled = false, queue = Promise.resolve(), buffer = '';
function finish() {
  if (settled) return;
  settled = true; clearInterval(timer);
  emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'B10_RESULT_' + text }], stopReason: 'stop' } });
  emit({ type: 'agent_end' }); setTimeout(() => emit({ type: 'agent_settled' }), 10);
}
async function receive(v) {
  if (v.type === 'prompt') {
    text = v.message;
    if (!['ANDROID_A', 'TERMINAL_A', 'HOLD_B', 'RACE_A', 'APPROVE_A', 'UNCERTAIN_APPROVAL'].includes(text)) throw Error('Unknown fixture prompt');
    const previous = await readFile('context.txt', 'utf8').catch(() => '');
    if (text === 'TERMINAL_A' && previous !== 'ANDROID_A\n') throw Error('Lost next-turn worktree context');
    await appendFile('.b10-dispatches', text + '\n');
    await appendFile('.b10-contexts', JSON.stringify({ text, previous }) + '\n');
    await writeFile('context.txt', previous + text + '\n');
    emit({ type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } });
    if (text === 'ANDROID_A') finish();
    else if (['APPROVE_A', 'UNCERTAIN_APPROVAL'].includes(text)) emit({ type: 'extension_ui_request', id: 'b10-raw', method: 'confirm', title: 'B10 fixture only' });
    else timer = setInterval(async () => { try { await access('.b10-release-' + text); finish(); } catch {} }, 20);
  } else if (v.type === 'extension_ui_response') {
    if (!['APPROVE_A', 'UNCERTAIN_APPROVAL'].includes(text) || v.id !== 'b10-raw') throw Error('Wrong approval');
    await appendFile('.b10-replies', JSON.stringify(v) + '\n');
    if (text === 'APPROVE_A') finish(); // An attempted pipe write is NOT external completion.
  }
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk; let n;
  while ((n = buffer.indexOf('\n')) >= 0) {
    const v = JSON.parse(buffer.slice(0, n)); buffer = buffer.slice(n + 1);
    queue = queue.then(() => receive(v)).catch(() => process.exit(1));
  }
});
