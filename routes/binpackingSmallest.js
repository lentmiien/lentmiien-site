const express = require('express');
const { z } = require('zod');
const { rateLimit } = require('express-rate-limit');
const Role = require('../models/role');
const logger = require('../utils/logger');
const { hasCapabilities } = require('../utils/authorization');
const { createRequireCapabilities, PRIVATE_NO_STORE } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { CAPABILITIES, ROLE_BUNDLES } = require('../utils/smallestBoxPolicy');
const { catalogUpdateSchema } = require('../utils/smallestBoxValidation');
const { catalogService } = require('../services/smallestBoxCatalogService');
const { packingOperations } = require('../services/smallestBoxOperations');
const { createServiceCredentials } = require('../services/serviceCredentialService');
const credentials = createServiceCredentials({ namespace: 'packing', capabilities: [CAPABILITIES.read, CAPABILITIES.run],
  ownerCapabilities: [CAPABILITIES.read, CAPABILITIES.run, CAPABILITIES.api], roleCapabilityBundles: ROLE_BUNDLES });

function privateResponse(req, res, next) {
  res.set({ 'Cache-Control': PRIVATE_NO_STORE, 'Referrer-Policy': 'no-referrer' });
  res.locals.gtag = false;
  next();
}
function errorHandler(log) {
  return (error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.too.large') return res.status(413).json({ success: false, message: 'Request is too large.' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'Invalid JSON.' });
    if (error.status && error.publicMessage) {
      if (error.status >= 500) log.error('Shared box catalog requires administrator setup', { category: 'binpacking_smallest', metadata: { code: error.code } });
      return res.status(error.status).json({ success: false, message: error.publicMessage });
    }
    log.error('Smallest-box operation failed; check database and packing worker availability', {
      category: 'binpacking_smallest', metadata: { operation: req.route?.path || 'request', errorName: error.name,
        status: Number.isInteger(error.response?.status) ? error.response.status : undefined,
        code: ['ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED'].includes(error.code) ? error.code : undefined },
    });
    res.status(503).json({ success: false, message: 'The box operation could not finish. Check service availability and try again.' });
  };
}
function createSmallestBoxRouter({ catalog = catalogService, roleModel = Role, operations = packingOperations,
  keys = credentials, log = logger } = {}) {
  const router = express.Router();
  const csrf = createSessionCsrf({ appLogger: log });
  const authorization = { roleModel, roleCapabilityBundles: ROLE_BUNDLES };
  const requireCapability = capability => createRequireCapabilities({ capabilities: [capability], ...authorization, logger: log });
  router.use(privateResponse);
  router.use((req, res, next) => {
    if (!req.isAuthenticated?.() || !/^[a-f\d]{24}$/i.test(String(req.user?._id || ''))) {
      return res.status(401).json({ success: false, message: 'Sign in to use the box finder.' });
    }
    req.packingOwnerId = String(req.user._id);
    next();
  });
  router.use(requireCapability(CAPABILITIES.read));
  // A fully tagged 50-box catalog can exceed 64 KiB; search requests retain their smaller parser.
  router.use((req, res, next) => express.json({ limit: req.path === '/containers' ? '128kb' : '64kb' })(req, res, next));
  router.use(csrf.issueToken);
  const limit = (max, windowMs = 60000) => rateLimit({ windowMs, limit: max,
    keyGenerator: req => req.packingOwnerId, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please try again later.' } });
  router.get('/', async (req, res, next) => {
    try {
      res.render('bin_packing_smallest', { pageTitle: 'Smallest Box Finder', algorithms: ['laff', 'plain', 'bruteforce'],
        canEditBoxes: await hasCapabilities(req.user, [CAPABILITIES.write], authorization),
        canManagePackingApi: await hasCapabilities(req.user, [CAPABILITIES.api], authorization) });
    } catch (error) { next(error); }
  });
  router.get('/containers', async (req, res, next) => {
    try { res.json(await catalog.read()); } catch (error) { next(error); }
  });
  router.put('/containers', requireCapability(CAPABILITIES.write), csrf.requireToken, limit(30), async (req, res, next) => {
    const parsed = catalogUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid catalog. Use up to 50 uniquely named boxes with valid dimensions, weights and tags.' });
    try { res.json({ success: true, ...await catalog.save(parsed.data) }); } catch (error) { next(error); }
  });
  router.post('/run', requireCapability(CAPABILITIES.run), csrf.requireToken, operations.limiter, operations.run);
  router.get('/api-keys', requireCapability(CAPABILITIES.api), async (req, res, next) => {
    try { res.json({ keys: await keys.list(req.packingOwnerId) }); } catch (error) { next(error); }
  });
  router.post('/api-keys', requireCapability(CAPABILITIES.api), csrf.requireToken, limit(10, 3600000), async (req, res, next) => {
    const parsed = z.object({ label: z.string().trim().min(1).max(80), days: z.number().int().min(1).max(365) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Provide a key name and lifetime of 1–365 days.' });
    try {
      const key = await keys.issue(req.packingOwnerId, parsed.data.label, parsed.data.days);
      log.notice('Packing API key issued', { category: 'binpacking_smallest', metadata: { principalId: req.packingOwnerId, keyId: key.id } });
      res.status(201).json(key);
    } catch (error) { next(error); }
  });
  router.delete('/api-keys/:id', requireCapability(CAPABILITIES.api), csrf.requireToken, limit(30), async (req, res, next) => {
    try {
      if (!await keys.revoke(req.packingOwnerId, req.params.id)) return res.status(404).json({ success: false, message: 'API key not found.' });
      log.notice('Packing API key revoked', { category: 'binpacking_smallest', metadata: { principalId: req.packingOwnerId, keyId: req.params.id } });
      res.json({ success: true });
    } catch (error) { next(error); }
  });
  router.use(errorHandler(log));
  return router;
}
function createSmallestBoxApiRouter({ operations = packingOperations, keys = credentials, log = logger } = {}) {
  const router = express.Router();
  router.use(privateResponse);
  router.use(rateLimit({ windowMs: 60000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { success: false, message: 'Too many API requests.' } }));
  router.use(async (req, res, next) => {
    try {
      if (Object.keys(req.query).length) return res.status(400).json({ success: false, message: 'Use the JSON body for search options.' });
      const headers = req.rawHeaders.filter((_, i) => i % 2 === 0).filter(name => name.toLowerCase() === 'authorization');
      if (headers.length !== 1) return res.status(401).json({ success: false, message: 'A bearer API key is required.' });
      const principal = await keys.authenticate(req.get('authorization'));
      req.packingOwnerId = principal.ownerId;
      req.verifyPackingAccess = () => keys.authenticate(req.get('authorization'));
      next();
    } catch (error) { next(error); }
  });
  router.post('/', operations.limiter, express.json({ limit: '64kb' }), operations.run);
  router.use((_req, res) => res.status(404).json({ success: false, message: 'API route not found.' }));
  router.use(errorHandler(log));
  return router;
}
module.exports = { createSmallestBoxRouter, createSmallestBoxApiRouter };
