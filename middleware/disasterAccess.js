const { createRequireCapabilities } = require('./requireCapabilities');
const { createSessionCsrf } = require('./sessionCsrf');
const { rateLimit } = require('express-rate-limit');
const { READ, REFRESH, ROLE_BUNDLES } = require('../utils/disasterPolicy');
function disasterAccess(action, roleModel = require('../models/role')) {
  const requireCapability = createRequireCapabilities({ capabilities: [action === 'refresh' ? REFRESH : READ], roleModel, roleCapabilityBundles: ROLE_BUNDLES });
  return (req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    res.locals.gtag = false;
    if (!req.isAuthenticated?.() || !req.user?._id) return res.status(401).json({ ok: false, error: 'Login required.' });
    return requireCapability(req, res, next);
  };
}
const disasterCsrf = createSessionCsrf();
const disasterRefreshLimit = rateLimit({ windowMs: 60000, limit: 1, keyGenerator: req => String(req.user._id), standardHeaders: 'draft-8', legacyHeaders: false,
  message: { ok: false, error: 'Please wait a minute before refreshing sources again.' } });
module.exports = { disasterAccess, disasterCsrf, disasterRefreshLimit };
