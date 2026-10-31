const express = require('express');
const { rateLimit } = require('express-rate-limit');
const Role = require('../models/role');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { MANAGE, ROLE_BUNDLES } = require('../utils/batchAuthorizationPolicy');
const logger = require('../utils/logger');

function createBatchRetryRouter(service, { roleModel = Role } = {}) {
  const router = express.Router();
  const csrf = createSessionCsrf();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (!req.isAuthenticated?.() || !req.user?._id) return res.status(401).json({ error: 'Sign in to manage batch failures.' });
    return next();
  });
  router.use(createRequireCapabilities({ capabilities: [MANAGE], roleCapabilityBundles: ROLE_BUNDLES, roleModel }));
  router.post('/:id', express.urlencoded({ extended: false, limit: '1kb' }), csrf.requireToken,
    rateLimit({ windowMs: 60000, limit: 10, keyGenerator: req => String(req.user._id) }), async (req, res) => {
      if (!/^prompt-[A-Za-z0-9-]{1,100}$/.test(req.params.id)
        || Object.keys(req.body || {}).some(key => key !== '_csrf')) return res.status(400).json({ error: 'Invalid retry request.' });
      try {
        await service.retryFailedPrompt(req.params.id, req.user);
        return res.redirect(303, '/chat4/batch_status');
      } catch (error) {
        const status = [400, 403, 404, 409].includes(error.status) ? error.status : 503;
        if (status === 503) logger.error('Batch prompt retry request failed', { category: 'batch' });
        return res.status(status).json({ error: status === 503 ? 'Retry unavailable. Inspect the retained prompt and application diagnostics.' : error.message });
      }
    });
  router.use((error, _req, res, _next) => {
    const status = error.type === 'entity.too.large' ? 413 : 400;
    return res.status(status).json({ error: status === 413 ? 'Retry form is too large.' : 'Invalid retry form.' });
  });
  return router;
}

module.exports = { createBatchRetryRouter };
