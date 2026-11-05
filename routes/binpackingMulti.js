const express = require('express');
const { rateLimit } = require('express-rate-limit');
const Role = require('../models/role');
const logger = require('../utils/logger');
const { hasCapabilities } = require('../utils/authorization');
const { createRequireCapabilities, PRIVATE_NO_STORE } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { CAPABILITIES, ROLE_BUNDLES } = require('../utils/smallestBoxPolicy');
const { requestSchema } = require('../utils/multiBoxValidation');
const credentials = require('../services/packingCredentials');
const { createMultiBoxService } = require('../services/multiBoxService');
const service = createMultiBoxService();

// Both mounts share submission budgets, including browser/API calls by one owner.
function createSubmissionLimits() {
  const options = { windowMs: 60000, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { message: 'Too many packing jobs. Try again in a minute.' } };
  return [rateLimit({ ...options, limit: 5, keyGenerator: req => req.packingOwnerId }),
    rateLimit({ ...options, limit: 30, keyGenerator: () => 'multi-box' })];
}
const submissionLimits = createSubmissionLimits();
function createMultiBoxRouter({ machine = false, packing = service, keys = credentials, roleModel = Role,
  log = logger, limits = submissionLimits } = {}) {
  const router = express.Router();
  const authorization = { roleModel, roleCapabilityBundles: ROLE_BUNDLES };
  const requireCapability = capability => createRequireCapabilities({ capabilities: [capability], ...authorization, logger: log });
  const csrf = createSessionCsrf({ appLogger: log });
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': PRIVATE_NO_STORE, 'Referrer-Policy': 'no-referrer' });
    res.locals.gtag = false;
    if (Object.keys(req.query).length) return res.status(400).json({ message: 'Use JSON fields, not query parameters.' });
    next();
  });
  if (machine) {
    router.use(rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
    router.use(async (req, res, next) => {
      try {
        const count = req.rawHeaders.filter((name, i) => i % 2 === 0 && name.toLowerCase() === 'authorization').length;
        if (count !== 1) return res.status(401).json({ message: 'A bearer packing API key is required.' });
        const principal = await keys.authenticate(req.get('authorization'));
        req.packingOwnerId = principal.ownerId;
        req.verifyPackingAccess = () => keys.authenticate(req.get('authorization'));
        next();
      } catch (error) { next(error); }
    });
  } else {
    router.use((req, res, next) => {
      if (!req.isAuthenticated?.() || !/^[a-f\d]{24}$/i.test(String(req.user?._id || ''))) {
        return res.status(401).json({ message: 'Sign in to use the multi-box packer.' });
      }
      req.packingOwnerId = String(req.user._id);
      req.verifyPackingAccess = async () => {
        if (!await hasCapabilities(req.user, [CAPABILITIES.read, CAPABILITIES.run], authorization)) {
          throw Object.assign(new Error('Access denied'), { status: 403, publicMessage: 'Packing access is no longer available.' });
        }
      };
      next();
    });
    router.use(requireCapability(CAPABILITIES.read), csrf.issueToken);
    router.get('/', (req, res) => res.render('bin_packing_multi', { pageTitle: 'Multi-box Packer' }));
  }
  router.use(rateLimit({ windowMs: 60000, limit: 120, keyGenerator: req => req.packingOwnerId,
    standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many packing requests.' } }));
  router.get('/containers', async (req, res, next) => {
    try { res.json(await packing.containers()); } catch (error) { next(error); }
  });
  if (!machine) router.use('/jobs', requireCapability(CAPABILITIES.run));
  const respondJob = (req, res, job, status) => {
    const statusUrl = `${req.baseUrl}/jobs/${job.jobId}`;
    if (job.status === 'queued' || job.status === 'running') res.set('Retry-After', '5');
    res.status(status).set('Location', statusUrl).json({ ...job, statusUrl });
  };
  router.post('/jobs', ...(machine ? [] : [csrf.requireToken]), ...limits,
    express.json({ limit: '256kb' }), async (req, res, next) => {
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: 'Invalid packing input. Check item IDs, cm dimensions, quantities, flags and options (maximum 500 items).' });
      try {
        const job = await packing.submit(req.packingOwnerId, parsed.data);
        await req.verifyPackingAccess();
        respondJob(req, res, job, 202);
      } catch (error) { next(error); }
    });
  router.get('/jobs/:id', async (req, res, next) => {
    try {
      const job = await packing.poll(req.packingOwnerId, req.params.id);
      await req.verifyPackingAccess();
      respondJob(req, res, job, 200);
    } catch (error) { next(error); }
  });
  router.use((_req, res) => res.status(404).json({ message: 'Packing route not found.' }));
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.too.large') return res.status(413).json({ message: 'Request is too large (256 KiB maximum).' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid JSON.' });
    if (error.status && error.publicMessage && error.status < 500) return res.status(error.status).json({ message: error.publicMessage });
    log.error('Multi-box operation failed; check database, worker origin, availability and queue capacity', {
      category: 'binpacking_multi', metadata: { operation: req.route?.path || 'request', errorName: error.name,
        upstreamStatus: Number.isInteger(error.response?.status) ? error.response.status : undefined },
    });
    res.status(503).json({ message: 'The packing service could not finish this request. Check availability and try again.' });
  });
  return router;
}
module.exports = { createMultiBoxRouter, createSubmissionLimits };
