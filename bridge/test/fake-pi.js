// Deterministic RPC peer: never calls a model or touches a device.
let buffer = '', prompt;
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const answer = () => {
  emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello\u2028world' }], stopReason: prompt === 'failure' ? 'error' : 'stop', errorMessage: 'Provider failed' } });
  emit({ type: 'agent_end' });
  setTimeout(() => emit({ type: 'agent_settled' }), 10);
};
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let n;
  while ((n = buffer.indexOf('\n')) >= 0) {
    const record = JSON.parse(buffer.slice(0, n)); buffer = buffer.slice(n + 1);
    if (record.type === 'prompt') {
      prompt = record.message;
      emit({ type: 'response', command: 'prompt', success: true, data: { disposition: prompt === '/handled' ? 'handled' : 'started' } });
      if (prompt === '/handled' || prompt === 'hang') continue;
      if (prompt === 'confirm') emit({ type: 'extension_ui_request', id: 'dialog', method: 'confirm', title: 'Allow test?' });
      else answer();
    } else if (record.type === 'extension_ui_response') answer();
  }
});
