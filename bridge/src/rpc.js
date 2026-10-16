import { spawn } from 'node:child_process';
import { log } from './log.js';

// RPC uses LF only: Unicode separators are legal inside JSON strings.
export function runPi({ bin, args, cwd, text, signal, onEvent, clients, id, timeoutMs = 600000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    const exited = new Promise(resolve => child.once('close', resolve));
    child.on('spawn', () => log('rpc.started', { requestId: id, pid: child.pid }));
    let buffer = '', stderr = '', answer = '', settled = false, failure;
    let chain = Promise.resolve();
    const send = record => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(record) + '\n'); };
    const kill = () => {
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      const force = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 1500);
      force.unref();
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      log('rpc.finished', { requestId: id, failed: Boolean(error), ...(error ? { errorType: error.constructor?.name ?? 'Error' } : {}) });
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      clients.delete(id);
      kill();
      // A completed job must release its Pi process/session writer before another turn starts.
      exited.then(() => chain).then(() => error ? reject(error) : resolve(answer), reject);
    };
    const aborted = () => finish(new Error('Cancelled'));
    const timer = setTimeout(() => finish(new Error('Pi timed out; inspect the workspace before retrying.')), timeoutMs);
    signal.addEventListener('abort', aborted, { once: true });
    clients.set(id, send);
    child.stdin.on('error', error => finish(error));
    child.on('error', finish);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 8 * 1024 * 1024) return finish(new Error('RPC frame too large'));
      let n;
      while ((n = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, n).replace(/\r$/, '');
        buffer = buffer.slice(n + 1);
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); } catch { finish(new Error('Invalid Pi RPC output')); return; }
        if (event.type === 'message_end' && event.message?.role === 'assistant') {
          const m = event.message;
          const body = (m.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('');
          if (body) answer = body.slice(-100000);
          if (['error', 'aborted'].includes(m.stopReason)) failure = new Error(m.errorMessage ?? m.stopReason);
        }
        // Persist completed messages, tool progress and extension dialogs; no uncommitted text is exposed.
        if (['message_end', 'tool_execution_start', 'tool_execution_end', 'extension_ui_request'].includes(event.type)) {
          chain = chain.then(() => onEvent(event));
          chain.catch(error => finish(error));
        }
        if (event.type === 'response' && event.command === 'prompt') {
          log('rpc.prompt', { requestId: id, success: event.success === true });
          if (!event.success) finish(new Error(event.error ?? 'Pi rejected prompt'));
          else if (event.data?.disposition === 'handled') finish();
        }
        if (event.type === 'agent_settled') finish(failure);
      }
    });
    child.on('close', code => { if (!settled) finish(new Error('Pi exited before settling (' + code + '). ' + stderr)); });
    if (signal.aborted) aborted();
    else send({ id: 'prompt', type: 'prompt', message: text });
  });
}
