const { fail, TaricError } = require('../../utils/taricContracts');
const { output, payload, TEST_ADAPTER } = require('../../utils/taricProtocol');
// Internal injection contract, NOT a Gateway HTTP contract. No reservation fallback.
// Capability-bearing provider responses stay in this process and never enter Mongo.
function createWarmSessions(adapter = null, { now = Date.now, timeoutMs = 7000 } = {}) {
  const owned = new WeakMap();
  const terminal = new WeakSet();
  let retained = null; let lastTerminal = null; let opening = false;
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
    // One private reachable capability, never evicted on timeout or idle expiry.
    lookup: id => retained?.id === id ? retained : lastTerminal?.id === id ? lastTerminal : null,
    retainedId: () => retained?.id || null,
    describe: id => retained?.id === id ? owned.get(retained)?.cleanup || null : lastTerminal?.id === id ? { reclaimVerified: true } : null,
    preflight: options => adapter?.preflight ? adapter.preflight(options) : Promise.resolve(null),
    async open({ correlationId, signal, adapter: adapterName = TEST_ADAPTER }) {
      if (retained || opening) fail('CLEANUP_PENDING');
      opening = true;
      try {
        if (adapter?.preflight) await adapter.preflight({ signal });
        const raw = await call('open', { adapter: adapterName, correlationId, ttlMs: 120000, hardBudgetMs: 900000, signal });
        if (!raw || typeof raw.id !== 'string' || !raw.id.length || raw.id.length > 200 || !Number.isFinite(raw.expiresAt)
          || !Number.isFinite(raw.hardExpiresAt) || raw.expiresAt <= now() || raw.expiresAt > now() + 120000
          || raw.hardExpiresAt > now() + 900000 || raw.expiresAt > raw.hardExpiresAt) fail('INFERENCE_UNCERTAIN');
        raw.adapterName = adapterName; raw.correlationId = correlationId;
        const handle = Object.freeze({ id: raw.id, hardExpiresAt: raw.hardExpiresAt, ...(raw.capabilityProof ? { capabilityProof: raw.capabilityProof } : {}) });
        owned.set(handle, raw); retained = handle;
        return handle;
      } finally { opening = false; }
    },
    async renew(handle, signal) {
      const raw = session(handle);
      const result = await call('renew', { session: raw, ttlMs: 120000, signal });
      if (!Number.isFinite(result?.expiresAt) || result.expiresAt <= now() || result.expiresAt > Math.min(now() + 120000, raw.hardExpiresAt)) fail('RECOVERY_REQUIRED');
      raw.expiresAt = result.expiresAt;
      return { expiresAt: raw.expiresAt, hardExpiresAt: raw.hardExpiresAt };
    },
    async generate(handle, row, codes, maxTokens, options = {}) {
      const raw = session(handle);
      const body = payload(row, raw.adapterName, maxTokens);
      const envelope = await call('generate', { session: raw, body, correlationId: options.correlationId, signal: options.signal }, 60000);
      if (!require('../../utils/taricProtocol').validEnvelope(envelope, raw.adapterName)) {
        return output({ content: envelope?.content, tool_calls: ['invalid envelope'] }, codes, options.onDiagnostics);
      }
      return output(envelope, codes, options.onDiagnostics);
    },
    async status(handle, correlationId, signal) {
      const result = await call('status', { session: session(handle, true), correlationId, signal });
      return { idle: result?.idle === true, terminal: result?.terminal === true,
        correlated: result?.correlationId === correlationId, reclaimed: result?.reclaimed === true, missing: result?.missing === true };
    },
    async close(handle, { signal, epoch } = {}) {
      if (terminal.has(handle)) return { idle: true };
      const raw = session(handle, true);
      const result = await call('close', { session: raw, correlationId: raw.correlationId, signal, epoch,
        onCleanup: value => { raw.cleanup = require('../../utils/taricDiagnostics').cleanupStatus(value); },
      }, 110000);
      if (result?.idle === true) {
        terminal.add(handle); lastTerminal = handle; owned.delete(handle);
        if (retained === handle) retained = null;
        return { idle: true };
      }
      return { idle: false, reason: result?.reason === 'BACKEND_RECLAIM_FAILED' ? result.reason : 'CLEANUP_PENDING' };
    },
    async probe() {
      const result = adapter?.preflight ? await adapter.probe() : await call('probe', {});
      // Read-only remote status: never opens a session or modifies another owner.
      return { idle: false, state: 'idle_unverified', ...(result?.capabilityProof ? { capabilityProof: result.capabilityProof } : {}), observedAt: new Date(now()).toISOString() };
    },
  };
}
module.exports = { createWarmSessions };
