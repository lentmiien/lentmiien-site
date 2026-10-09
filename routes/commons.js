const express = require('express');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf, PRIVATE_NO_STORE } = require('../middleware/sessionCsrf');
const { PLAY, ROLE_BUNDLES } = require('../utils/commonsAuthorizationPolicy');
const { config: readConfig } = require('../services/commons/config');
function createCommonsRouter({ roleModel = require('../models/role'), userModel = require('../models/useraccount'), configReader = readConfig, privateOptions = {}, diagnosticsReader = require('../services/commons/runtime').diagnostics } = {}) {
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
  router.use('/api', require('./commonsPrivate').createCommonsPrivateRouter(privateOptions));
  router.get('/', csrf.issueToken, (_req, res) => res.render('commons', { pageTitle: 'Lantern Commons', gtag: false }));
  router.get('/diagnostics', async (req, res) => {
    try {
      const principal = await userModel.findOne({ _id: req.user._id }, 'name type_user', { maxTimeMS: 2000 });
      if (!principal || !await require('../services/commons/policy').permitted(principal, 'diagnostics', roleModel)) return res.status(403).send('Access denied.');
      const config = configReader();
      return res.json({ feature: 'Lantern Commons', runtime: diagnosticsReader(), schemaVersion: 1, maxOnline: config.maxOnline, plots: 12,
        checkpointMs: config.checkpointMs, leaseMs: config.leaseMs, npcEnabled: config.npcEnabled,
        timeZone: 'Asia/Tokyo', ownership: 'Single MongoDB-fenced room owner', documentation: 'documentation/commons/README.md' });
    } catch (_) {
      require('../utils/logger').warning('Commons diagnostics authorization unavailable', { category: 'commons.authorization' });
      return res.status(503).send('Diagnostics unavailable.');
    }
  });
  return router;
}
module.exports = { createCommonsRouter };
