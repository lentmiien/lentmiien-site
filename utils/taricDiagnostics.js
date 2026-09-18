// Private review data only. Never serialize provider envelopes or arbitrary errors.
const PHASES = ['dns', 'connect', 'tls', 'http', 'decode', 'limit', 'json', 'envelope', 'timeout', 'clientabort'];
const SOCKET_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_STREAM_PREMATURE_CLOSE']);
function errorStatus(value) {
  if (!value || !PHASES.includes(value.phase)) return null;
  const out = { phase: value.phase, dispatched: value.dispatched === true, terminal: value.terminal === true };
  for (const key of ['status', 'wireBytes', 'decodedBytes', 'durationMs']) {
    if (Number.isSafeInteger(value[key]) && value[key] >= 0) out[key] = value[key];
  }
  if (SOCKET_CODES.has(value.socketCode)) out.socketCode = value.socketCode;
  if (/^[a-f0-9]{32}$/.test(value.correlationId || '')) out.correlationId = value.correlationId;
  return out;
}
function cleanupStatus(raw) {
  const out = {};
  if (['idle', 'running', 'reclaiming', 'closed', 'expired', 'uncertain'].includes(raw?.state)) out.remoteState = raw.state;
  if (['released', 'idle_timeout', 'hard_timeout', 'shutdown'].includes(raw?.close_reason)) out.closeReason = raw.close_reason;
  if (['no_work_container_inactive', 'runtime_stopped_vram_verified'].includes(raw?.reclaim_basis)) out.reclaimBasis = raw.reclaim_basis;
  if (['drain_worker', 'drain_scheduler', 'verify_owner', 'complete', 'inspect_unused', 'lifecycle_lock', 'inspect_runtime', 'stop_runtime', 'verify_stopped', 'verify_vram'].includes(raw?.cleanup?.phase)) out.cleanupPhase = raw.cleanup.phase;
  if (['no_work', 'full_runtime'].includes(raw?.cleanup?.reclaim_kind)) out.reclaimKind = raw.cleanup.reclaim_kind;
  if (Number.isFinite(raw?.cleanup?.elapsed_sec) && raw.cleanup.elapsed_sec >= 0 && raw.cleanup.elapsed_sec <= 900) out.gatewayElapsedSec = raw.cleanup.elapsed_sec;
  if ([200, 503, 504].includes(raw?.cleanup?.status_code)) out.cleanupStatus = raw.cleanup.status_code;
  if (typeof raw?.reclaim_verified === 'boolean') out.reclaimVerified = raw.reclaim_verified;
  return out;
}
function preview(text) {
  const bytes = Buffer.from(text);
  // Decode only complete UTF-8 sequences, keeping the final preview <= 4096 bytes.
  let visible = bytes.subarray(0, 4096).toString('utf8');
  while (Buffer.byteLength(visible) > 4096) visible = visible.slice(0, -1);
  return { visibleText: visible, outputBytes: bytes.length, truncated: bytes.length > 4096 };
}
function help(code, status) {
  const messages = {
    CLEANUP_PENDING: 'Owned cleanup is not yet verified. The private capability is retained. Continue owned cleanup; inference remains held.',
    BACKEND_RECLAIM_FAILED: 'Gateway cleanup failed. Inspect the safe cleanup phase, then explicitly retry the same owned cleanup. No inference is repeated.',
    OWNERSHIP_LOST: 'This Site process has no matching private owner capability. Use the owning instance, or the standard Gateway recovery/rebuild. After its old fence is safely cleared, acquire new exclusive recovery admission. Do not reset the Mongo hold.',
    EVIDENCE_NOT_FOUND: 'No local JAN match. Supply the AmiAmi item code or classify manually; JAN alone does not trigger an online lookup.',
    JAN_AMBIGUOUS: 'This JAN matches multiple local item codes. Supply the specific AmiAmi item code or classify manually.',
    CATALOG_REJECTED: 'Outside the training-derived test allowlist (v0 has 53 target codes). This does not establish whether the code is legally valid TARIC. Review manually.',
    HTTP_ACCESS_DENIED: 'AmiAmi returned HTTP 403 after TLS. Classify manually; no failed source data was saved. The configured transport has no challenge bypass or automatic fallback.',
    TLS_CHAIN_UNTRUSTED: 'AmiAmi TLS chain verification failed using Node default plus OS trusted certificates. Update the machine trusted CA store through the normal administrator process; do not disable certificate or hostname verification. Classify manually until repaired.',
    FETCH_DISABLED: 'The configured bounded AmiAmi transport is unavailable. At deployment, install the existing curl-cffi bundle (libcurl 8.15.0-IMPERSONATE) with npm run install:curl-cffi, or explicitly choose native mode, which may still return HTTP403. Classify manually until verified.',
    FETCH_FAILED: `The factual lookup failed${status?.phase ? ` (${status.phase})` : ''}. Use manual classification; no source facts were fabricated.`,
    WARM_SESSION_NOT_READY: 'Owned Gateway inference sessions are not configured. Benchmark execution remains unavailable until the reviewed contract is wired.',
    GATEWAY_UPGRADE_REQUIRED: 'The running Gateway does not publish the required owned-session API. Rebuild and recreate its running image with the existing two Compose files and project, then Refresh status. No inference was dispatched by this precheck.',
    READINESS_UNVERIFIED: 'Gateway capability discovery could not be verified. Check the configured origin, proxy/admin credentials and Gateway availability, then Refresh status. No inference was dispatched by this precheck.',
    CONFIG_NOT_READY: 'Check bootstrap, Enable tool, and the imported v0 test catalog. An approved catalog and runtime attestations are required only for normal release.',
    STALE: 'The recovery epoch or record changed, or another worker holds the lease. Read remote status again before retrying.',
    INVALID_REQUEST: 'Check the supplied fields and numeric epoch; refresh the page if its controls are stale.',
    PROVIDER_FAILED: [401, 403].includes(status?.status) ? 'Gateway authentication rejected this action. Check the private proxy credential and X-Admin-Token configuration; keep the existing hold and refresh status.'
      : status?.status === 404 ? 'Gateway did not recognize this operation. Check the running image and routing, then Refresh status. Recovery retains the existing hold.'
        : status?.status === 409 ? 'Gateway exclusive admission is busy. Keep the hold and retry only after the other owner finishes; do not release another reservation.'
          : 'Gateway rejected or could not complete this operation. Check the action, stage and upstream HTTP status. Recovery retains the existing hold and requests no inference.',
    RELEASE_CLOSED: 'Normal mode needs a published independent v1+ benchmark, approved catalog, verified runtime and a current passing run. Manual-confirmation tests do not open normal mode.',
    INFERENCE_UNCERTAIN: 'An existing hold or ambiguous remote operation requires inspection. Read status, cancel all pending work, then recover through exclusive admission.',
    RECOVERY_REQUIRED: 'Remote idle has not been proved. Inspect and cancel pending work before explicit recovery.',
  };
  return messages[code] || null;
}
function readinessError(error) {
  const reason = error instanceof require('./taricContracts').TaricError ? error.code : 'READINESS_UNVERIFIED';
  return { reason, stage: 'gateway.preflight', message: help(reason), transport: errorStatus(error.transport) };
}
const STAGES = new Set(['request.validation', 'request.operation', 'gateway.preflight', 'session.create', 'session.heartbeat', 'session.cleanup', 'recovery.pending', 'recovery.handoff']);
module.exports = { cleanupStatus, errorStatus, preview, help, readinessError, STAGES };
