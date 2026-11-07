const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { READ, IMPORT, ROLE_BUNDLES, isOwner } = require('../utils/healthCheckPolicy');
const logger = require('../utils/logger');
function createHealthCheckRouter({ service, roleModel } = {}) {
  service ||= require('../services/healthCheckService').createService(require('../models/health_check_history'));
  const router = express.Router(); const csrf = createSessionCsrf();
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    res.locals.gtag = false;
    if (!req.isAuthenticated?.()) return res.status(401).json({ error: 'Sign in to access health checks.' });
    if (!isOwner(req.user)) return res.status(403).json({ error: 'This tool is restricted to the configured owner.' });
    next();
  });
  router.use(createRequireCapabilities({ capabilities: [READ], roleCapabilityBundles: ROLE_BUNDLES, roleModel }));
  router.use(csrf.issueToken);
  router.use((req, res, next) => Object.keys(req.query).length ? res.status(400).json({ error: 'Query parameters are not supported.' }) : next());
  router.get('/', (req, res) => res.render('health_check', { pageTitle: 'Health check history' }));
  router.get('/upload', createRequireCapabilities({ capabilities: [IMPORT], roleCapabilityBundles: ROLE_BUNDLES, roleModel }), (req, res) => res.render('health_check_upload', { pageTitle: 'Import health checks' }));
  router.get('/api/history', async (req, res, next) => {
    try { res.json(await service.read(req.user._id)); } catch (error) { next(error); }
  });
  router.use('/api/import', createRequireCapabilities({ capabilities: [IMPORT], roleCapabilityBundles: ROLE_BUNDLES, roleModel }),
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, keyGenerator: req => String(req.user._id), standardHeaders: 'draft-8', legacyHeaders: false,
      message: { error: 'Too many import requests. Please wait before trying again.' } }),
    csrf.requireToken, express.json({ limit: '3mb' }));
  for (const action of ['mapping', 'preview', 'commit']) router.post(`/api/import/${action}`, async (req, res, next) => {
    try {
      const result = action === 'commit' ? await service.commit(req.user._id, req.body) : await service.review(req.user._id, req.body, action === 'mapping');
      res.json(result);
    } catch (error) { next(error); }
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = [400, 409, 413].includes(error.status) ? error.status : 503;
    if (status === 503) logger.error('Health-check operation failed; verify database availability', { category: 'health_check', metadata: { operation: req.route?.path || 'request' } });
    res.status(status).json({ error: status === 503 ? 'Health-check data is temporarily unavailable. Please retry.' : status === 413 ? 'The upload is too large (maximum 3 MB request).' : error.type === 'entity.parse.failed' ? 'Invalid JSON request.' : error.message });
  });
  return router;
}
module.exports = { createHealthCheckRouter };
