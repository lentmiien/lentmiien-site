const { TaricError, fail } = require('../../utils/taricContracts');
const { hash } = require('../../utils/taricProtocol');
const { errorStatus } = require('../../utils/taricDiagnostics');

// These are explicit routes in Gateway 689c68a. Generation is published through
// FastAPI's proxy path; requiring a literal /generate would reject that contract.
const REQUIRED = [
  ['/qwen3-lora/inference-sessions', 'post', '201'],
  ['/qwen3-lora/inference-sessions/{session_id}', 'get', '200'],
  ['/qwen3-lora/inference-sessions/{session_id}', 'delete', '200'],
  ['/qwen3-lora/inference-sessions/{session_id}/heartbeat', 'post', '200'],
];
function validate(document) {
  if (!document || !/^3\.\d+\.\d+$/.test(document.openapi || '')
    || !document.paths || Array.isArray(document.paths) || typeof document.paths !== 'object') fail('READINESS_UNVERIFIED');
  const operation = (path, method, status) => {
    const op = document.paths[path]?.[method];
    return op && typeof op === 'object' && !Array.isArray(op) && typeof op.operationId === 'string'
      && op.operationId.length > 0 && op.responses?.[status] && typeof op.responses[status].description === 'string';
  };
  if (!REQUIRED.every(args => operation(...args))
    || !['/qwen3-lora/generate', '/qwen3-lora/{path}'].some(path => operation(path, 'post', '200'))) fail('GATEWAY_UPGRADE_REQUIRED');
}
function createGatewayCapabilities(gateway, { now = Date.now, ttlMs = 15000, fingerprint = () => '' } = {}) {
  let cached; let lastFailure; let revision = 0;
  const ttl = Math.max(0, Math.min(30000, Number.isFinite(ttlMs) ? ttlMs : 15000));
  const invalidate = () => { cached = null; revision++; };
  async function preflight({ force = false, signal } = {}) {
    const key = fingerprint();
    if (!force && cached?.key === key && now() - cached.at < ttl) return cached.proof;
    invalidate();
    const generation = revision;
    let received = false;
    try {
      // Never probe unknown owned routes: old Gateway catchalls can start GPU.
      const document = await gateway('/openapi.json', { signal, deadlineMs: 4000,
        maxBytes: 2 * 1024 * 1024, maxWireBytes: 2 * 1024 * 1024 });
      received = true;
      validate(document);
      const proof = Object.freeze({ digest: hash(document), observedAt: new Date(now()).toISOString(), protocol: 'owned-v1' });
      if (generation === revision) cached = { key, at: now(), proof };
      lastFailure = null;
      return proof;
    } catch (cause) {
      const error = new TaricError(['GATEWAY_UPGRADE_REQUIRED', 'CONFIG_NOT_READY'].includes(cause?.code) ? cause.code : 'READINESS_UNVERIFIED');
      error.stage = 'gateway.preflight'; error.inferenceDispatched = false;
      error.transport = errorStatus(cause?.transport || (received ? { phase: 'envelope', status: 200, dispatched: true, terminal: true } : null));
      const signature = hash({ code: error.code, phase: error.transport?.phase, status: error.transport?.status });
      if (signature !== lastFailure) require('../../utils/logger').warning('TARIC Gateway capability check failed; inspect deployment and refresh status', {
        category: 'taric', metadata: { code: error.code, stage: error.stage, transport: error.transport },
      });
      lastFailure = signature;
      throw error;
    }
  }
  return { preflight, invalidate };
}
module.exports = { createGatewayCapabilities, validate, REQUIRED };
