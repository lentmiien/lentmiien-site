const express = require('express');
const { rateLimit } = require('express-rate-limit');
const Role = require('../models/role');
const Item = require('../models/amiami_item');
const logger = require('../utils/logger');
const { createRequireCapabilities, PRIVATE_NO_STORE } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { createDuplicateService, ReviewError, PAGE_SIZE } = require('../services/amiamiDuplicateService');

const base = '/admin/amiami-items/duplicates';
const capabilities = ['amiami.items.read', 'amiami.items.merge'];

function createAmiAmiDuplicatesRouter({ service = createDuplicateService(Item), roleModel = Role } = {}) {
  const router = express.Router();
  const csrf = createSessionCsrf();
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': PRIVATE_NO_STORE, 'Referrer-Policy': 'no-referrer' });
    Object.assign(res.locals, { base, gtag: false, pageTitle: 'Review duplicate JAN codes' });
    if (!req.isAuthenticated?.() || !/^[a-f\d]{24}$/i.test(String(req.user?._id || ''))) {
      return res.status(401).send('Sign in to review duplicate AmiAmi items.');
    }
    next();
  });
  router.use(createRequireCapabilities({ capabilities, roleModel, roleCapabilityBundles: { admin: capabilities } }));
  router.use(rateLimit({ windowMs: 60000, limit: 90, keyGenerator: req => String(req.user._id), legacyHeaders: false }));
  router.get('/', async (req, res) => {
    const rows = await service.groups(req.query.after);
    const groups = rows.slice(0, PAGE_SIZE);
    res.render('admin_amiami_duplicates', {
      groups, merged: req.query.merged === '1', paged: req.query.after !== undefined,
      nextUrl: rows.length > PAGE_SIZE && base + '?after=' + encodeURIComponent(groups.at(-1)._id),
    });
  });
  router.get('/group', async (req, res) => {
    const { jan, keep, after } = req.query;
    const group = await service.group(jan, keep, after);
    const items = group.items.slice(0, PAGE_SIZE);
    const query = new URLSearchParams({ jan });
    if (keep) query.set('keep', keep);
    if (items.length) query.set('after', String(items.at(-1)._id));
    res.render('admin_amiami_duplicate_group', {
      jan, keep: group.keep, items, nextUrl: group.items.length > PAGE_SIZE && base + '/group?' + query,
    });
  });
  router.get('/compare/:keep/:remove', csrf.issueToken, async (req, res) => {
    const pair = await service.compare(req.params.keep, req.params.remove);
    res.render('admin_amiami_duplicate_pair', pair);
  });
  router.post('/compare/:keep/:remove', express.urlencoded({ extended: false, limit: '4kb', parameterLimit: 32 }),
    csrf.requireToken, async (req, res) => {
      await service.merge(req.params.keep, req.params.remove, req.body);
      res.redirect(303, base + '?merged=1');
    });
  router.use((error, req, res, _next) => {
    const formError = ['entity.too.large', 'parameters.too.many'].includes(error.type);
    let message = 'The duplicate review could not finish. Reopen the review to check the current entries.';
    let status = 503;
    if (error instanceof ReviewError) {
      status = error.status;
      message = error.message;
    } else if (formError) {
      status = 413;
      message = 'The submitted form is too large.';
    } else {
      logger.error('Unable to complete AmiAmi duplicate review', {
        category: 'amiami-items', metadata: { operation: req.method === 'POST' ? 'merge' : 'review', errorName: error.name },
      });
    }
    res.status(status).render('admin_amiami_duplicates', { message, groups: [] });
  });
  return router;
}

module.exports = { createAmiAmiDuplicatesRouter };
