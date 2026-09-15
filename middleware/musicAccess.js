const { RoleModel } = require('../database');
const { canMusic, CAPABILITIES } = require('../utils/musicAuthorizationPolicy');
const { createSessionCsrf } = require('./sessionCsrf');
const logger = require('../utils/logger');
const csrf = createSessionCsrf();
function requireMusic(capability) {
  return async (req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.locals.gtag = false;
    if (!req.isAuthenticated?.() || !req.user?._id) return res.status(401).json({ error: 'Login required.' });
    try {
      if (!await canMusic(req.user, capability, RoleModel)) return res.status(403).json({ error: 'Music permission required.' });
      next();
    } catch (_) {
      logger.error('Music capability lookup failed', { category: 'authorization' });
      return res.status(503).json({ error: 'Music authorization is unavailable.' });
    }
  };
}
function boundedBody(req, res, next) {
  if (req.body && (Object.keys(req.body).length > 30 || Buffer.byteLength(JSON.stringify(req.body)) > 32768)) return res.status(413).json({ error: 'Music request exceeds limits.' });
  next();
}
module.exports = { requireMusic, CAPABILITIES, csrf, boundedBody };
