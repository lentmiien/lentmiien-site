const crypto = require('crypto');
const logger = require('../utils/logger');

const PRIVATE_NO_STORE = 'private, no-store, max-age=0';
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const FETCH_SITE_VALUES = new Set(['cross-site', 'same-origin', 'same-site', 'none']);

function normalizeOrigin(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const origin = new URL(value);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) {
      return null;
    }
    return origin.origin;
  } catch (_) {
    return null;
  }
}

function configuredOrigins(rawValue = process.env.CSRF_ALLOWED_ORIGINS) {
  if (typeof rawValue !== 'string') return [];
  return rawValue
    .split(',')
    .map((entry) => normalizeOrigin(entry.trim()))
    .filter(Boolean);
}

function requestOrigin(req) {
  const host = typeof req.get === 'function' ? req.get('host') : null;
  if (!host || /[\r\n]/u.test(host)) return null;
  const protocol = req.protocol === 'https' ? 'https' : 'http';
  return normalizeOrigin(`${protocol}://${host}`);
}

function requestFetchSite(req) {
  const value = typeof req.get === 'function' ? req.get('sec-fetch-site') : null;
  if (typeof value !== 'string' || value.length > 20) return null;
  const normalized = value.trim().toLowerCase();
  return FETCH_SITE_VALUES.has(normalized) ? normalized : null;
}

function safeEqual(left, right) {
  if (!TOKEN_PATTERN.test(left || '') || !TOKEN_PATTERN.test(right || '')) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function wantsJson(req) {
  return String(req.get?.('accept') || '').includes('application/json')
    || String(req.get?.('content-type') || '').includes('application/json')
    || String(req.originalUrl || '').includes('/api/');
}

function renderDenied(req, res, {
  status = 403,
  title = 'Request Rejected',
  message = 'The form expired or came from an untrusted page. Reload and try again.',
} = {}) {
  const response = res
    .status(status)
    .set('Cache-Control', PRIVATE_NO_STORE);
  if (wantsJson(req)) {
    return response.json({ ok: false, error: message });
  }
  return response.render('accessDenied', {
    title,
    message,
    user: req.user,
  });
}

function createSessionCsrf({
  allowedOrigins = configuredOrigins(),
  appLogger = logger,
  randomBytes = crypto.randomBytes,
} = {}) {
  const explicitOrigins = new Set(allowedOrigins.map(normalizeOrigin).filter(Boolean));

  function issueToken(req, res, next) {
    if (!req.session) {
      appLogger.error('Session unavailable while issuing CSRF token', {
        category: 'csrf',
      });
      return renderDenied(req, res, {
        status: 503,
        title: 'Session Unavailable',
        message: 'A secure form session could not be created. Please try again.',
      });
    }

    if (!TOKEN_PATTERN.test(req.session.csrfToken || '')) {
      req.session.csrfToken = randomBytes(TOKEN_BYTES).toString('base64url');
    }
    res.locals.csrfToken = req.session.csrfToken;
    return next();
  }

  function requireToken(req, res, next) {
    const rawOrigin = typeof req.get === 'function' ? req.get('origin') : null;
    const suppliedOrigin = normalizeOrigin(rawOrigin);
    if (rawOrigin) {
      const expectedOrigin = requestOrigin(req);
      const fetchSite = requestFetchSite(req);
      const trustedOpaqueOrigin = rawOrigin === 'null'
        && fetchSite === 'same-origin'
        && Boolean(expectedOrigin)
        && (explicitOrigins.size === 0 || explicitOrigins.has(expectedOrigin));
      if (
        !trustedOpaqueOrigin
        && (!suppliedOrigin || (!explicitOrigins.has(suppliedOrigin) && suppliedOrigin !== expectedOrigin))
      ) {
        appLogger.warning('Rejected browser mutation from an untrusted origin', {
          category: 'csrf',
          metadata: {
            route: req.route?.path || null,
            originStatus: suppliedOrigin
              ? 'mismatch'
              : (rawOrigin === 'null' ? 'opaque' : 'invalid'),
            suppliedOrigin,
            expectedOrigin,
            fetchSite,
          },
        });
        return renderDenied(req, res);
      }
    }

    const suppliedToken = typeof req.body?._csrf === 'string'
      ? req.body._csrf
      : (typeof req.get === 'function' ? req.get('x-csrf-token') : null);
    if (!safeEqual(req.session?.csrfToken, suppliedToken)) {
      appLogger.warning('Rejected browser mutation with an invalid CSRF token', {
        category: 'csrf',
        metadata: { route: req.route?.path || null },
      });
      return renderDenied(req, res);
    }

    return next();
  }

  return { issueToken, requireToken };
}

module.exports = {
  PRIVATE_NO_STORE,
  TOKEN_PATTERN,
  configuredOrigins,
  createSessionCsrf,
  normalizeOrigin,
  requestFetchSite,
  requestOrigin,
  safeEqual,
  wantsJson,
};
