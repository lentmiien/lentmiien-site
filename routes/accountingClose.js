const express = require('express');
const { rateLimit } = require('express-rate-limit');
const Role = require('../models/role');
const { resolvePolicy, canCloseAccounts } = require('../services/accountSurfacePolicy');
const { createCloseService } = require('../services/accountingCloseService');
const { createSessionCsrf, PRIVATE_NO_STORE } = require('../middleware/sessionCsrf');
const logger = require('../utils/logger');

function createAccountingClose({ service = createCloseService(), roleModel = Role } = {}) {
  const router = express.Router();
  const csrf = createSessionCsrf();
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': PRIVATE_NO_STORE, 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    res.locals.gtag = false;
    res.locals.closePath = `${req.baseUrl}/`;
    res.locals.ledgerPath = req.baseUrl.toLowerCase().startsWith('/budget/') ? '/budget' : '/accounting';
    if (!req.isAuthenticated?.() || !req.user?._id) return res.status(401).send('Login required.');
    next();
  });
  router.use(async (req, res, next) => {
    try {
      if (!canCloseAccounts(await resolvePolicy(req.user, roleModel))) return res.status(403).send('Account closing unavailable.');
      next();
    } catch (_) {
      logger.warning('Accounting close authorization unavailable', { category: 'accounting' });
      res.status(503).send('Account closing unavailable.');
    }
  });
  router.use(rateLimit({ windowMs: 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, keyGenerator: req => String(req.user._id) }));
  router.use(express.urlencoded({ extended: false, limit: '4kb', parameterLimit: 5 }));
  router.use(csrf.issueToken);
  function failed(res, error) {
    if (error.status === 422) logger.warning('Accounting close requires ledger review or a larger review limit', { category: 'accounting' });
    if (![404, 409, 422].includes(error.status)) logger.error('Accounting month close failed', { category: 'accounting', metadata: { errorName: error.name } });
    return res.status([404, 409, 422].includes(error.status) ? error.status : 503).render('accounting_close', {
      pageTitle: 'Finalize previous month', error: [404, 409, 422].includes(error.status) ? error.message : 'The ledger could not be reviewed or saved. Retry after checking the ledger.', review: null,
    });
  }
  router.get('/', async (req, res) => {
    if (Object.keys(req.query).length) return res.status(400).send('Unexpected review parameters.');
    try {
      const review = await service.preview(req.user._id);
      const saved = req.session.accountingCloseSaved === true;
      delete req.session.accountingCloseSaved;
      res.render('accounting_close', { pageTitle: 'Finalize previous month', review, error: null, saved });
    }
    catch (error) { failed(res, error); }
  });
  router.post('/', csrf.requireToken, async (req, res) => {
    const input = req.body;
    if (!input || Object.keys(input).some(k => !['_csrf', 'accountId', 'token', 'transactionsComplete', 'balancesMatch'].includes(k))
      || typeof input.accountId !== 'string' || !/^[a-f\d]{24}$/i.test(input.accountId)
      || typeof input.token !== 'string' || !/^[a-f\d]{64}$/.test(input.token)
      || input.transactionsComplete !== 'yes' || input.balancesMatch !== 'yes') return res.status(400).send('Both confirmations and a valid account review are required.');
    try {
      await service.close(req.user._id, input);
      req.session.accountingCloseSaved = true;
      res.redirect(303, `${req.baseUrl}/`);
    } catch (error) { failed(res, error); }
  });
  return router;
}
module.exports = { createAccountingClose };
