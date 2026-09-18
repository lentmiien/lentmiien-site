// Private review data only. Never serialize provider envelopes or arbitrary errors.
const PHASES = ['dns', 'connect', 'tls', 'http', 'decode', 'limit', 'json', 'envelope', 'timeout', 'clientabort'];
const SOCKET_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_STREAM_PREMATURE_CLOSE']);
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
function preview(text) {
  const bytes = Buffer.from(text);
  // Decode only complete UTF-8 sequences, keeping the final preview <= 4096 bytes.
  let visible = bytes.subarray(0, 4096).toString('utf8');
  while (Buffer.byteLength(visible) > 4096) visible = visible.slice(0, -1);
  return { visibleText: visible, outputBytes: bytes.length, truncated: bytes.length > 4096 };
}
function help(code, status) {
  const messages = {
    EVIDENCE_NOT_FOUND: 'No local JAN match. Supply the AmiAmi item code or classify manually; JAN alone does not trigger an online lookup.',
    JAN_AMBIGUOUS: 'This JAN matches multiple local item codes. Supply the specific AmiAmi item code or classify manually.',
    CATALOG_REJECTED: 'Outside the training-derived test allowlist (v0 has 53 target codes). This does not establish whether the code is legally valid TARIC. Review manually.',
    FETCH_FAILED: `The factual lookup failed${status?.phase ? ` (${status.phase})` : ''}. Use manual classification; no source facts were fabricated.`,
    WARM_SESSION_NOT_READY: 'Owned Gateway inference sessions are not configured. Benchmark execution remains unavailable until the reviewed contract is wired.',
    RECOVERY_REQUIRED: 'Remote idle has not been proved. Inspect and cancel pending work before explicit recovery.',
  };
  return messages[code] || null;
}
module.exports = { errorStatus, preview, help };
