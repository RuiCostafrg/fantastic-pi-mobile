// Deterministic RPC peer, used ONLY by project-lifecycle-fixture.js in disposable worktrees.
// No provider, production configuration, device access or shell execution.
import { appendFile, writeFile, access } from 'node:fs/promises';
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
let buffer = '', prompt, timer, settled = false;
function answer() {
  if (settled) return;
  settled = true;
  clearInterval(timer);
  emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'RESULT_' + prompt }], stopReason: 'stop' } });
  emit({ type: 'agent_end' });
  setTimeout(() => emit({ type: 'agent_settled' }), 10);
}
async function record(value) {
  if (value.type === 'prompt') {
    prompt = value.message;
    if (!['CONFIRM_A', 'HOLD_B', 'CANCEL_B'].includes(prompt)) throw new Error('Unknown fixture prompt');
    await appendFile('.fixture-dispatches', prompt + '\n');
    await writeFile('file.txt', prompt + '\n');
    emit({ type: 'tool_execution_start', toolName: 'fixture-write' });
    emit({ type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } });
    if (prompt === 'CONFIRM_A') emit({ type: 'extension_ui_request', id: 'approval-a', method: 'confirm', title: 'Fixture A only' });
    else if (prompt === 'HOLD_B') {
      timer = setInterval(async () => { try { await access('.fixture-release'); answer(); } catch { /* explicitly held */ } }, 20);
    }
  } else if (value.type === 'extension_ui_response') {
    if (prompt !== 'CONFIRM_A' || value.id !== 'approval-a') throw new Error('Wrong fixture approval');
    answer();
  }
}
let queue = Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let n;
  while ((n = buffer.indexOf('\n')) >= 0) {
    const value = JSON.parse(buffer.slice(0, n)); buffer = buffer.slice(n + 1);
    queue = queue.then(() => record(value)).catch(() => process.exit(1));
  }
});
