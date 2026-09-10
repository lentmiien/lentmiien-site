// Only diagnostic codes are logged. Error messages, URLs, headers and provider
// bodies can contain credentials or personal content, including inside cause.
const CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ENETUNREACH',
  'EHOSTUNREACH', 'ETIMEDOUT', 'ECONNABORTED', 'ESOCKETTIMEDOUT', 'ERR_CANCELED',
  'ERR_NETWORK', 'ERR_BAD_RESPONSE', 'ERR_BAD_REQUEST', 'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET', 'UND_ERR_ABORTED',
  'UPSTREAM_INVALID_RESPONSE',
]);
const NAMES = new Set(['Error', 'TypeError', 'AxiosError', 'AbortError', 'TimeoutError',
  'APIConnectionError', 'APIConnectionTimeoutError', 'APIError', 'RateLimitError',
  'AuthenticationError', 'InternalServerError', 'BadRequestError']);

function upstreamErrorMetadata(error) {
  const codes = [];
  let current = error;
  for (let depth = 0; current && depth < 4; depth += 1, current = current.cause) {
    if (CODES.has(current.code)) codes.push(current.code);
  }
  const status = error?.response?.status ?? error?.status ?? error?.statusCode;
  const statusCode = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  const causeCode = codes.at(-1) || null;
  const phase = ['ENOTFOUND', 'EAI_AGAIN'].includes(causeCode) ? 'dns'
    : ['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT'].includes(causeCode) ? 'connect'
      : ['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(causeCode) ? 'tls'
        : causeCode === 'UPSTREAM_INVALID_RESPONSE' ? 'response_validation'
          : statusCode ? 'response' : 'request';
  return { errorName: NAMES.has(error?.name) ? error.name : 'Error',
    errorCode: codes[0] || null, causeCode, status: statusCode, phase };
}

module.exports = { upstreamErrorMetadata };
