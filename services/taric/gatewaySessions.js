const { fail, TaricError } = require('../../utils/taricContracts');
// Wire contract: Gateway 689c68a, documentation/contracts/qwen3-lora-inference-sessions.json.
// This module alone sees the capability. Never persist or serialize raw responses.
function createGatewaySessions(gateway, { now = Date.now, closeDeadlineMs = 100000, delayMs = 1000, capabilities = require('./gatewayCapabilities').createGatewayCapabilities(gateway, { now }) } = {}) {
  const proofs = new WeakMap();
  async function known(session, signal, refresh = false) {
    if (!refresh && proofs.has(session)) return proofs.get(session);
    return capabilities.preflight({ signal });
  }
  const base = '/qwen3-lora/inference-sessions';
  const path = session => `${base}/${encodeURIComponent(session.id)}`;
  const headers = session => ({ 'X-Inference-Session-Token': session.ownerToken });
  function validate(raw, expectedId) {
    if (!raw || typeof raw.session_id !== 'string' || !raw.session_id.length || raw.session_id.length > 200
      || (expectedId && raw.session_id !== expectedId) || !Array.isArray(raw.operations) || raw.operations.length > 256
      || !['idle', 'running', 'reclaiming', 'closed', 'expired', 'uncertain'].includes(raw.state)
      || typeof raw.idle_proven !== 'boolean' || typeof raw.reclaim_verified !== 'boolean') fail('INFERENCE_UNCERTAIN');
    return raw;
  }
  function deadlines(raw, started, hardLimit = started + 900000) {
    if (![raw.hard_remaining_sec, raw.idle_remaining_sec].every(n => Number.isFinite(n) && n >= 0)
      || raw.hard_remaining_sec > 900 || raw.idle_remaining_sec > 120) fail('INFERENCE_UNCERTAIN');
    // Relative server durations measured from BEFORE the call, never trust clock sync.
    const hardExpiresAt = Math.min(hardLimit, started + raw.hard_remaining_sec * 1000);
    return { expiresAt: Math.min(hardExpiresAt, started + raw.idle_remaining_sec * 1000), hardExpiresAt };
  }
  async function status({ session, correlationId, signal }) {
    await known(session, signal);
    const raw = validate(await gateway(path(session), { headers: headers(session), signal }), session.id);
    const operation = raw.operations.find(op => op?.operation_id === correlationId);
    return { idle: raw.idle_proven === true, terminal: operation?.state === 'terminal' && operation.resolution === 'completed',
      correlationId: operation?.operation_id, reclaimed: raw.reclaim_verified === true, missing: !operation };
  }
  return {
    preflight: capabilities.preflight,
    invalidate: capabilities.invalidate,
    async open({ correlationId, signal }) {
      const proof = await capabilities.preflight({ signal });
      const started = now();
      let response;
      try { response = await gateway(base, { method: 'POST', successStatuses: [201], signal, correlationId,
        body: { client_id: correlationId, idle_timeout_sec: 120, max_duration_sec: 900 } }); }
      catch (cause) {
        capabilities.invalidate();
        if ((cause.transport?.phase === 'http' && cause.transport.status >= 400) || cause.transport?.dispatched === false) {
          const error = new TaricError(cause.transport?.status === 409 ? 'ADMISSION_BUSY' : 'PROVIDER_FAILED');
          error.stage = 'session.create'; error.inferenceDispatched = false;
          error.transport = require('../../utils/taricDiagnostics').errorStatus(cause.transport);
          throw error;
        }
        const error = new TaricError('ADMISSION_UNCERTAIN');
        error.stage = 'session.create'; error.inferenceDispatched = false;
        error.transport = require('../../utils/taricDiagnostics').errorStatus(cause.transport); throw error;
      }
      try {
        const raw = validate(response);
        if (raw.state !== 'idle' || raw.idle_proven !== true || typeof raw.owner_token !== 'string'
          || !raw.owner_token.length || raw.owner_token.length > 1024) fail('INFERENCE_UNCERTAIN');
        const session = { id: raw.session_id, ownerToken: raw.owner_token, capabilityProof: proof, ...deadlines(raw, started) };
        proofs.set(session, proof);
        return session;
      } catch (cause) {
        throw Object.assign(new TaricError('ADMISSION_UNCERTAIN'), { stage: 'session.create', inferenceDispatched: false, transport: cause.transport });
      }
    },
    async renew({ session, signal }) {
      await known(session, signal, true);
      const started = now();
      const raw = validate(await gateway(`${path(session)}/heartbeat`, { method: 'POST', headers: headers(session), signal }), session.id);
      if (!['idle', 'running'].includes(raw.state)) fail('RECOVERY_REQUIRED');
      return deadlines(raw, started, session.hardExpiresAt);
    },
    async generate({ session, body, correlationId, signal, onDiagnostic }) {
      await known(session, signal, true);
      try {
        return await gateway('/qwen3-lora/generate', { method: 'POST', body, signal, correlationId, onDiagnostic,
          diagnosticContext: { operationId: correlationId, sessionId: session.id,
            sessionRemainingMs: Math.max(0, Math.floor(session.hardExpiresAt - now())), sessionHardBudgetMs: 900000 },
          deadlineMs: 60000, maxBytes: 1048576, headers: { ...headers(session),
            'X-Inference-Session': session.id, 'X-Inference-Operation': correlationId } });
      } catch (cause) {
        // Any HTTP code could come from upstream/preparation after acceptance. Even
        // duplicate 409 must reconcile the original ID; never infer idle from HTTP.
        const error = new TaricError('INFERENCE_UNCERTAIN');
        error.transport = require('../../utils/taricDiagnostics').errorStatus(cause.transport);
        throw error;
      }
    },
    status,
    async close({ session, signal, correlationId = session.correlationId, epoch, onCleanup }) {
      await known(session, signal);
      const started = Date.now();
      const deadline = started + Math.min(100000, Math.max(1, closeDeadlineMs));
      let raw; let counter = 0; let lastTransport = null;
      const diagnostics = require('../../utils/taricDiagnostics');
      const logger = require('../../utils/logger');
      const observe = value => {
        lastTransport = diagnostics.errorStatus(value);
      };
      const request = async method => {
        counter++;
        try {
          raw = validate(await gateway(path(session), { method, successStatuses: method === 'DELETE' ? [200, 202] : [200],
            headers: headers(session), signal, correlationId, onDiagnostic: observe,
            deadlineMs: Math.max(1, Math.min(method === 'DELETE' ? 6000 : 5000, deadline - Date.now())) }), session.id);
        } catch (error) {
          observe(error.transport);
          if (signal?.aborted) throw error;
          // A lost DELETE reply cannot override a later terminal reclaim proof.
        }
        onCleanup?.(raw);
        const remote = diagnostics.cleanupStatus(raw);
        if (method === 'DELETE' || counter === 2 || counter % 10 === 0 || raw?.reclaim_verified || raw?.state === 'uncertain') {
          logger.warning('TARIC owned cleanup observation', { category: 'taric', metadata: {
            method, counter, epoch, correlationId: lastTransport?.correlationId,
            originClock: 'site', elapsedMs: Date.now() - started, transport: lastTransport, ...remote,
          } });
        }
      };
      await request('DELETE');
      while (!raw?.reclaim_verified && Date.now() < deadline) {
        if (raw?.state === 'uncertain') return { idle: false, reason: 'BACKEND_RECLAIM_FAILED' };
        if (signal?.aborted) fail('INTERRUPTED');
        await new Promise((resolve, reject) => {
          const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new TaricError('INTERRUPTED')); };
          const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); },
            Math.min(Math.max(1, delayMs) * (counter > 5 ? 2 : 1), deadline - Date.now()));
          signal?.addEventListener('abort', abort, { once: true });
        });
        if (Date.now() < deadline) await request('GET');
      }
      if (raw?.reclaim_verified) return { idle: true };
      logger.warning('TARIC owned cleanup deadline exhausted; capability retained', { category: 'taric', metadata: {
        counter, epoch, elapsedMs: Date.now() - started, transport: lastTransport, ...diagnostics.cleanupStatus(raw),
      } });
      return { idle: false, reason: 'CLEANUP_PENDING' };
    },
    async probe() { return { idle: false, state: 'idle_unverified', capabilityProof: await capabilities.preflight({ force: true }) }; },
  };
}
module.exports = { createGatewaySessions };
