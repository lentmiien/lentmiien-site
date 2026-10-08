const express = require('express');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf, PRIVATE_NO_STORE } = require('../middleware/sessionCsrf');
const { PLAY, OPERATIONS, ROLE_BUNDLES } = require('../utils/commonsAuthorizationPolicy');
const { config: readConfig } = require('../services/commons/config');
function createCommonsRouter({ roleModel = require('../models/role'), configReader = readConfig, diagnosticsReader = require('../services/commons/runtime').diagnostics } = {}) {
  const router = express.Router();
  const csrf = createSessionCsrf();
  router.use((req, res, next) => {
    res.locals.gtag = false;
    res.set({ 'Cache-Control': PRIVATE_NO_STORE, 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    if (!req.isAuthenticated?.()) return res.status(401).render('accessDenied', {
      title: 'Sign in to visit', message: 'Lantern Commons is a private village. Sign in to your account first.', user: null,
    });
    try { if (!configReader().enabled) return res.status(503).send('Lantern Commons is resting.'); }
    catch (_) { return res.status(503).send('Lantern Commons is unavailable.'); }
    return next();
  });
  router.use(createRequireCapabilities({ capabilities: [PLAY], roleModel, roleCapabilityBundles: ROLE_BUNDLES }));
  router.get('/', csrf.issueToken, (_req, res) => res.render('commons', { pageTitle: 'Lantern Commons', gtag: false }));
  router.get('/diagnostics', createRequireCapabilities({ capabilities: [OPERATIONS], roleModel, roleCapabilityBundles: ROLE_BUNDLES }), (req, res) => {
    if (req.user.type_user !== 'admin') return res.status(403).send('Access denied.');
    const config = configReader();
    return res.json({ feature: 'Lantern Commons', runtime: diagnosticsReader(), schemaVersion: 1, maxOnline: config.maxOnline, plots: 12,
      checkpointMs: config.checkpointMs, leaseMs: config.leaseMs, npcEnabled: config.npcEnabled,
      timeZone: 'Asia/Tokyo', ownership: 'Single MongoDB-fenced room owner', documentation: 'documentation/commons/README.md' });
  });
  return router;
}
module.exports = { createCommonsRouter };
