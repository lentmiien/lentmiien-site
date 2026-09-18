const { fail, TaricError } = require('../../utils/taricContracts');
const { output, payload, BASE_MODEL, TEST_ADAPTER } = require('../../utils/taricProtocol');
// Internal injection contract, NOT a Gateway HTTP contract. No reservation fallback.
// Capability-bearing provider responses stay in this process and never enter Mongo.
function createWarmSessions(adapter = null, { now = Date.now, timeoutMs = 5000 } = {}) {
  const owned = new WeakMap();
  const required = ['open', 'status', 'renew', 'generate', 'close', 'probe'];
  const ready = () => Boolean(adapter && required.every(k => typeof adapter[k] === 'function'));
  async function call(method, args, deadline = timeoutMs) {
    if (!ready()) fail('WARM_SESSION_NOT_READY');
    const controller = new AbortController();
    const started = now();
    const uncertain = phase => Object.assign(new TaricError('INFERENCE_UNCERTAIN'), {
      transport: require('../../utils/taricDiagnostics').errorStatus({ phase, dispatched: true, terminal: false,
        durationMs: Math.max(0, now() - started), correlationId: args.correlationId }),
    });
    if (args.signal?.aborted) fail('INTERRUPTED');
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const abort = () => { controller.abort(); rejectAbort(uncertain('clientabort')); };
    args.signal?.addEventListener('abort', abort, { once: true });
    let timer;
    try {
      return await Promise.race([adapter[method]({ ...args, signal: controller.signal }), aborted, new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(uncertain('timeout')); }, deadline);
      })]);
    } catch (cause) {
      if (cause instanceof TaricError) throw cause;
      const error = new TaricError('INFERENCE_UNCERTAIN');
      error.transport = require('../../utils/taricDiagnostics').errorStatus(cause?.transport);
      throw error;
    } finally { clearTimeout(timer); args.signal?.removeEventListener('abort', abort); }
  }
  function session(handle, allowExpired = false) {
    const value = owned.get(handle);
    if (!value) fail('FORBIDDEN');
    if (!allowExpired && (value.expiresAt <= now() || value.hardExpiresAt <= now())) fail('RECOVERY_REQUIRED');
    return value;
  }
  return {
    ready,
    async open({ correlationId, signal }) {
      const started = now();
      const raw = await call('open', { adapter: TEST_ADAPTER, correlationId, ttlMs: 90000, hardBudgetMs: 180000, signal });
      if (!raw || !/^[A-Za-z0-9_-]{1,100}$/.test(raw.id || '') || !Number.isFinite(raw.expiresAt)
        || !Number.isFinite(raw.hardExpiresAt) || raw.expiresAt <= now() || raw.expiresAt > started + 90000
        || raw.hardExpiresAt > started + 180000 || raw.expiresAt > raw.hardExpiresAt) fail('INFERENCE_UNCERTAIN');
      const handle = Object.freeze({ id: raw.id });
      owned.set(handle, raw);
      return handle;
    },
    async renew(handle, signal) {
      const raw = session(handle);
      const result = await call('renew', { session: raw, ttlMs: 90000, signal });
      if (!Number.isFinite(result?.expiresAt) || result.expiresAt <= now() || result.expiresAt > Math.min(now() + 90000, raw.hardExpiresAt)) fail('RECOVERY_REQUIRED');
      raw.expiresAt = result.expiresAt;
    },
    async generate(handle, row, codes, maxTokens, options = {}) {
      const raw = session(handle);
      const body = payload(row, TEST_ADAPTER, maxTokens);
      const envelope = await call('generate', { session: raw, body, correlationId: options.correlationId, signal: options.signal }, 60000);
      if (!envelope || envelope.model !== BASE_MODEL || envelope.adapter_name !== TEST_ADAPTER) {
        return output({ content: envelope?.content, tool_calls: ['invalid envelope'] }, codes, options.onDiagnostics);
      }
      return output(envelope, codes, options.onDiagnostics);
    },
    async status(handle, correlationId, signal) {
      const result = await call('status', { session: session(handle, true), correlationId, signal });
      return { idle: result?.idle === true, terminal: result?.terminal === true,
        correlated: result?.correlationId === correlationId };
    },
    async close(handle) {
      const raw = session(handle, true);
      try { const result = await call('close', { session: raw }); return { idle: result?.idle === true }; }
      finally { owned.delete(handle); }
    },
    async probe() {
      const result = await call('probe', {});
      // Read-only remote status: never opens a session or modifies another owner.
      return { idle: result?.idle === true, observedAt: new Date(now()).toISOString() };
    },
  };
}
module.exports = { createWarmSessions };
