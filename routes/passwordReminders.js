const express = require('express');
const { rateLimit } = require('express-rate-limit');
const User = require('../models/useraccount');
const Role = require('../models/role');
const logger = require('../utils/logger');
const { createRequireCapabilities, PRIVATE_NO_STORE } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');

function createPasswordRemindersRouter({ userModel = User, roleModel = Role, appLogger = logger } = {}) {
  const router = express.Router();
  const csrf = createSessionCsrf({ appLogger });
  const deny = (res, status, message) => res.status(status).render('accessDenied', { title: 'Password update reminders', message });
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': PRIVATE_NO_STORE, 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    res.locals.gtag = false;
    if (!req.isAuthenticated?.() || !/^[a-f\d]{24}$/i.test(String(req.user?._id || ''))) return deny(res, 401, 'Login required.');
    if (req.user.type_user !== 'admin') return deny(res, 403, 'Administrator access required.');
    next();
  });
  router.use(createRequireCapabilities({
    capabilities: ['admin.password_reminders.request'], roleModel, logger: appLogger,
    roleCapabilityBundles: { admin: ['admin.password_reminders.request'], family: [], user: [], other: [] },
  }));
  router.use(rateLimit({
    windowMs: 60 * 60000, limit: 3, standardHeaders: 'draft-8', legacyHeaders: false,
    skip: req => req.method !== 'POST', keyGenerator: req => String(req.user._id),
    handler: (_req, res) => deny(res, 429, 'Too many reminder requests. Please try again in an hour.'),
  }));
  router.use(express.urlencoded({ extended: false, limit: '1kb', parameterLimit: 2 }));
  router.use(express.json({ limit: '1kb' }));
  router.post('/', csrf.requireToken, async (req, res) => {
    if (!req.body || Array.isArray(req.body) || req.body.confirm !== 'all-users'
      || Object.keys(req.body).some(key => !['_csrf', 'confirm'].includes(key)) || Object.keys(req.query).length) {
      return deny(res, 400, 'Confirm that you want to request password updates from all users.');
    }
    try {
      // Deliberately admin-managed scope: every account, including this admin.
      // Preserve hashes and actual last-change dates; only personal changes clear this flag.
      await userModel.updateMany({}, { $set: { password_change_requested: true } }, { runValidators: true });
      const message = 'Password updates requested. All users will be reminded at each login until they change their password.';
      return res.redirect(303, `/admin?status=success&message=${encodeURIComponent(message)}`);
    } catch (_) {
      appLogger.error('Unable to request password updates for all users', { category: 'account_settings', metadata: { operation: 'request_all_password_updates' } });
      return deny(res, 503, 'The request could not be completed. Please try again.');
    }
  });
  router.use((error, _req, res, _next) => {
    if (['entity.too.large', 'parameters.too.many', 'entity.parse.failed', 'charset.unsupported', 'encoding.unsupported'].includes(error.type)) {
      return deny(res, error.status === 413 ? 413 : 400, 'Invalid password reminder request.');
    }
    appLogger.error('Password reminder request failed', { category: 'account_settings' });
    return deny(res, 503, 'The request could not be completed. Please try again.');
  });
  return router;
}

module.exports = { createPasswordRemindersRouter };
