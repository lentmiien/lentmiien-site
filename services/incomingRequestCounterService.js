const IncomingRequest = require('../models/incoming_request');

const REQUEST_COUNTER_LIMIT = 60;
const REQUEST_COUNTER_WINDOW_MS = 90 * 60 * 1000;

function getHeader(req, name) {
  if (req && typeof req.get === 'function') {
    return req.get(name) || null;
  }

  if (req && req.headers) {
    return req.headers[name.toLowerCase()] || null;
  }

  return null;
}

function getRequestPath(req) {
  return req.originalUrl || req.url || req.path || '/';
}

function getEndpointPath(req, fallback) {
  return fallback || req.baseUrl || req.path || getRequestPath(req);
}

async function recordAndEvaluateRequest(req, options = {}) {
  const model = options.model || IncomingRequest;
  const now = new Date(options.now || Date.now());
  const endpointPath = getEndpointPath(req, options.endpointPath);
  const windowStart = new Date(now.getTime() - REQUEST_COUNTER_WINDOW_MS);
  const recentCount = await model.countDocuments({
    endpointPath,
    receivedAt: { $gte: windowStart },
  });
  const countInWindow = recentCount + 1;
  const allowed = recentCount < REQUEST_COUNTER_LIMIT;
  const responseText = allowed ? 'OK' : 'NG';
  const responseStatusCode = allowed ? 200 : 429;

  await model.create({
    endpointPath,
    requestPath: getRequestPath(req),
    method: req.method || 'GET',
    ip: req.ip || null,
    ips: Array.isArray(req.ips) ? req.ips : [],
    userAgent: getHeader(req, 'user-agent'),
    referer: getHeader(req, 'referer') || getHeader(req, 'referrer'),
    query: req.query || {},
    receivedAt: now,
    windowStart,
    countInWindow,
    allowed,
    responseStatusCode,
    responseText,
  });

  return {
    allowed,
    countInWindow,
    limit: REQUEST_COUNTER_LIMIT,
    windowMs: REQUEST_COUNTER_WINDOW_MS,
    responseStatusCode,
    responseText,
  };
}

module.exports = {
  REQUEST_COUNTER_LIMIT,
  REQUEST_COUNTER_WINDOW_MS,
  recordAndEvaluateRequest,
};
