// Metadata only: never pass request bodies, headers, prompts, answers or raw errors.
const fields = new Set(['requestId', 'sessionId', 'status', 'method', 'route', 'httpStatus', 'durationMs', 'pid', 'code', 'success', 'failed', 'errorType']);
export function createLogger(write = line => process.stderr.write(line + '\n')) {
  return (event, data = {}) => {
    const safe = Object.fromEntries(Object.entries(data).filter(([key, value]) => fields.has(key) && ['string', 'number', 'boolean'].includes(typeof value)));
    write(JSON.stringify({ time: new Date().toISOString(), event, ...safe }));
  };
}
export const log = createLogger();
