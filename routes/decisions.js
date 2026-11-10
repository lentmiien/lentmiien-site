const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { hasCapabilities } = require('../utils/authorization');
const { CAPABILITY, BUNDLES } = require('../utils/decisionsAuthorizationPolicy');
const { service: defaultService, DecisionError, MAX_BODY, TIMEOUT } = require('../services/decisionsService');
const logger = require('../utils/logger');

async function refreshAuthorization(req) {
  const stored = await new Promise((resolve, reject) => req.sessionStore.get(req.sessionID, (error, session) => error ? reject(error) : resolve(session)));
  if (!stored || String(stored.passport?.user) !== String(req.user._id)
    || (stored.cookie?.expires && new Date(stored.cookie.expires) <= new Date())) throw new DecisionError('Session expired. Log in again.', 401);
  const { UseraccountModel, RoleModel } = require('../database');
  const user = await UseraccountModel.findById(req.user._id).select('_id name type_user').maxTimeMS(5000).lean();
  if (!await hasCapabilities(user, [CAPABILITY], { roleModel: RoleModel, roleCapabilityBundles: BUNDLES })) throw new DecisionError('Decision access was revoked.', 403);
}

function createRouter({ service = defaultService, roleModel = require('../models/role'), reauthorize = refreshAuthorization } = {}) {
  const router = express.Router();
  const csrf = createSessionCsrf();
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    res.locals.gtag = false;
    if (!req.isAuthenticated?.() || !req.user?._id) return res.status(401).json({ error: 'Login required.' });
    next();
  });
  router.use(createRequireCapabilities({ capabilities: [CAPABILITY], roleModel, roleCapabilityBundles: BUNDLES }));
  router.use(csrf.issueToken);
  router.get('/', (req, res) => res.render('admin_decisions', { pageTitle: 'Decision API tester', user: req.user, storageScope: String(req.user._id) }));
  router.get('/models', async (req, res) => res.json(await service.models()));
  const submissions = rateLimit({ windowMs: 60000, limit: 6, keyGenerator: req => String(req.user._id), standardHeaders: 'draft-8', legacyHeaders: false });
  router.post('/', csrf.requireToken, submissions, express.json({ limit: MAX_BODY, strict: true }), async (req, res) => {
    if (!req.is('application/json')) throw new DecisionError('Use a JSON request.', 415);
    const abort = new AbortController();
    const disconnect = () => { if (!res.writableEnded) abort.abort(); };
    res.once('close', disconnect);
    req.setTimeout(TIMEOUT + 10000);
    res.setTimeout(TIMEOUT + 10000);
    let authorizationError;
    let checking = false;
    const check = async () => {
      if (checking || abort.signal.aborted) return;
      checking = true;
      try { await reauthorize(req); }
      catch (error) { authorizationError = error; abort.abort(); }
      finally { checking = false; }
    };
    const timer = setInterval(check, 15000);
    timer.unref?.();
    try {
      await reauthorize(req);
      let result;
      try { result = await service.evaluate(req.body, req.user._id, { signal: abort.signal }); }
      catch (error) { throw authorizationError || error; }
      await reauthorize(req);
      if (!res.destroyed) res.json(result);
    } finally {
      clearInterval(timer);
      res.off('close', disconnect);
    }
  });
  router.use((error, req, res, next) => {
    const status = error instanceof DecisionError ? error.status : error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 422 : 503;
    if (!(error instanceof DecisionError) && status >= 500) logger.error('Decision tester operation failed', { category: 'ai_gateway_decisions', metadata: { status } });
    if (res.headersSent) return next(error);
    if (error.retryAfter) res.set('Retry-After', error.retryAfter);
    if (!res.destroyed) res.status(status).json({ error: error instanceof DecisionError ? error.message : status === 413 ? 'Request exceeds 8 MiB.' : status === 422 ? 'Invalid JSON request.' : 'Decision tester is unavailable. Check application diagnostics.' });
  });
  return router;
}
module.exports = { createRouter, refreshAuthorization };
