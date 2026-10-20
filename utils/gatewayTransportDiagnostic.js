const CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE',
  'ENOTFOUND', 'EAI_AGAIN', 'ERR_CANCELED', 'ERR_NETWORK', 'ERR_BAD_RESPONSE', 'ERR_BAD_REQUEST']);
function gatewayTransportDiagnostic(error) {
  const status = error?.response?.status;
  const upstreamStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  return { failureKind: upstreamStatus === null ? 'transport' : 'http', upstreamStatus,
    transportCode: CODES.has(error?.code) ? error.code : null };
}
module.exports = { gatewayTransportDiagnostic };
