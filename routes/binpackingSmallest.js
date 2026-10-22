const express = require('express');
const { rateLimit } = require('express-rate-limit');
const Catalog = require('../models/packing_container_catalog');
const Role = require('../models/role');
const logger = require('../utils/logger');
const { createRequireCapabilities, PRIVATE_NO_STORE } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { CAPABILITIES, ROLE_BUNDLES } = require('../utils/smallestBoxPolicy');
const { catalogSchema, searchSchema } = require('../utils/smallestBoxValidation');
const { findSmallestBox } = require('../services/smallestBoxService');

function createSmallestBoxRouter({ catalog = Catalog, roleModel = Role, search = findSmallestBox, log = logger } = {}) {
  const router = express.Router();
  const activeOwners = new Set();
  const csrf = createSessionCsrf({ appLogger: log });
  const requireCapability = capability => createRequireCapabilities({ capabilities: [capability],
    roleModel, roleCapabilityBundles: ROLE_BUNDLES, logger: log });
  router.use((req, res, next) => {
    res.set('Cache-Control', PRIVATE_NO_STORE);
    res.locals.gtag = false;
    if (!req.isAuthenticated?.() || !/^[a-f\d]{24}$/i.test(String(req.user?._id || ''))) {
      return res.status(401).json({ success: false, message: 'Sign in to use the box finder.' });
    }
    next();
  });
  router.use(requireCapability(CAPABILITIES.read));
  router.use(express.json({ limit: '64kb' }));
  router.use(csrf.issueToken);
  const limit = max => rateLimit({ windowMs: 60000, limit: max,
    keyGenerator: req => String(req.user._id), standardHeaders: 'draft-8', legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please try again in a minute.' } });
  const invalid = res => res.status(400).json({ success: false,
    message: 'Invalid input. Use unique IDs, valid dimensions and weights, at most 30 boxes or 200 items (7 for bruteforce).' });
  const load = async ownerId => {
    const saved = await catalog.findOne({ ownerId }).lean();
    return (saved?.containers || []).map(({ id, w, d, h, emptyWeight, maxLoadWeight }) => ({ id, w, d, h, emptyWeight, maxLoadWeight }));
  };
  router.get('/', (req, res) => res.render('bin_packing_smallest', {
    pageTitle: 'Smallest Box Finder', algorithms: ['laff', 'plain', 'bruteforce'],
  }));
  router.get('/containers', async (req, res, next) => {
    try { res.json({ containers: await load(req.user._id) }); } catch (error) { next(error); }
  });
  router.put('/containers', requireCapability(CAPABILITIES.write), csrf.requireToken, limit(30), async (req, res, next) => {
    const parsed = catalogSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res);
    try {
      await catalog.findOneAndUpdate({ ownerId: req.user._id }, { $set: parsed.data },
        { upsert: true, runValidators: true, setDefaultsOnInsert: true });
      res.json({ success: true, containers: parsed.data.containers });
    } catch (error) { next(error); }
  });
  router.post('/run', requireCapability(CAPABILITIES.run), csrf.requireToken, limit(5), async (req, res, next) => {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res);
    const owner = String(req.user._id);
    if (activeOwners.has(owner) || activeOwners.size >= 2) {
      return res.status(429).json({ success: false, message: 'A box search is already running. Please try again shortly.' });
    }
    activeOwners.add(owner);
    const abort = new AbortController();
    const onClose = () => abort.abort();
    res.once('close', onClose);
    try {
      const result = await search(await load(req.user._id), parsed.data, { signal: abort.signal });
      if (!abort.signal.aborted) res.json(result);
    } catch (error) {
      if (!abort.signal.aborted) next(error);
    } finally {
      res.off('close', onClose);
      activeOwners.delete(owner);
    }
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.too.large') return res.status(413).json({ success: false, message: 'Request is too large.' });
    if (error.type === 'entity.parse.failed') return invalid(res);
    log.error('Smallest-box operation failed; check database and packing worker availability', {
      category: 'binpacking_smallest', metadata: { operation: req.route?.path || 'request', errorName: error.name,
        status: Number.isInteger(error.response?.status) ? error.response.status : undefined,
        code: ['ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED'].includes(error.code) ? error.code : undefined },
    });
    res.status(503).json({ success: false, message: 'The box operation could not finish. Check service availability and try again.' });
  });
  return router;
}
module.exports = { createSmallestBoxRouter };
