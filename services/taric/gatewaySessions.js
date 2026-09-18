const { fail, TaricError } = require('../../utils/taricContracts');
// Wire contract: Gateway 689c68a, documentation/contracts/qwen3-lora-inference-sessions.json.
// This module alone sees the capability. Never persist or serialize raw responses.
function createGatewaySessions(gateway, { now = Date.now, closePolls = 6, delayMs = 1000 } = {}) {
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
    const raw = validate(await gateway(path(session), { headers: headers(session), signal }), session.id);
    const operation = raw.operations.find(op => op?.operation_id === correlationId);
    return { idle: raw.idle_proven === true, terminal: operation?.state === 'terminal' && operation.resolution === 'completed',
      correlationId: operation?.operation_id, reclaimed: raw.reclaim_verified === true, missing: !operation };
  }
  return {
    async open({ correlationId, signal }) {
      const started = now();
      let response;
      try { response = await gateway(base, { method: 'POST', successStatuses: [201], signal,
        body: { client_id: correlationId, idle_timeout_sec: 120, max_duration_sec: 900 } }); }
      catch (cause) {
        if (cause.transport?.phase === 'http' && cause.transport.status >= 400) throw cause;
        const error = new TaricError('INFERENCE_UNCERTAIN');
        error.transport = require('../../utils/taricDiagnostics').errorStatus(cause.transport); throw error;
      }
      const raw = validate(response);
      if (raw.state !== 'idle' || raw.idle_proven !== true || typeof raw.owner_token !== 'string'
        || !raw.owner_token.length || raw.owner_token.length > 1024) fail('INFERENCE_UNCERTAIN');
      return { id: raw.session_id, ownerToken: raw.owner_token, ...deadlines(raw, started) };
    },
    async renew({ session, signal }) {
      const started = now();
      const raw = validate(await gateway(`${path(session)}/heartbeat`, { method: 'POST', headers: headers(session), signal }), session.id);
      if (!['idle', 'running'].includes(raw.state)) fail('RECOVERY_REQUIRED');
      return deadlines(raw, started, session.hardExpiresAt);
    },
    async generate({ session, body, correlationId, signal }) {
      try {
        return await gateway('/qwen3-lora/generate', { method: 'POST', body, signal, correlationId,
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
    async close({ session, signal }) {
      let raw = validate(await gateway(path(session), { method: 'DELETE', successStatuses: [200, 202],
        headers: headers(session), signal, deadlineMs: 6000 }), session.id);
      for (let i = 0; !raw.reclaim_verified && i < closePolls; i++) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        raw = validate(await gateway(path(session), { headers: headers(session), signal }), session.id);
      }
      return { idle: raw.reclaim_verified === true };
    },
    async probe() { return { idle: false, state: 'idle_unverified' }; },
  };
}
module.exports = { createGatewaySessions };
