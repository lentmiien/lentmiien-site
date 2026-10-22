const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { rateLimit } = require('express-rate-limit');
const User = require('../models/useraccount');
const Role = require('../models/role');
const logger = require('../utils/logger');
const { hasCapabilities } = require('../utils/authorization');
const { ROLE_BUNDLES } = require('../utils/userSettingsPolicy');
const { createRequireCapabilities, PRIVATE_NO_STORE } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');

const passwordInput = z.string().min(1).refine(value => Buffer.byteLength(value, 'utf8') <= 1024);
const csrfField = z.string().optional();
const emailInput = z.object({
  _csrf: csrfField,
  email: z.string().trim().max(200).email(),
  currentPassword: passwordInput,
}).strict();
const passwordChangeInput = z.object({
  _csrf: csrfField,
  currentPassword: passwordInput,
  newPassword: z.string().min(12).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72),
  confirmPassword: z.string().max(72),
}).strict().refine(input => input.newPassword === input.confirmPassword);

function createUserSettingsRouter({ userModel = User, roleModel = Role, appLogger = logger } = {}) {
  const router = express.Router();
  const csrf = createSessionCsrf({ appLogger });
  const authorization = { roleModel, roleCapabilityBundles: ROLE_BUNDLES };
  const requireCapability = capability => createRequireCapabilities({
    capabilities: [capability], ...authorization, logger: appLogger,
  });
  const unavailable = (res, status, message) => res.status(status).render('accessDenied', {
    title: 'User settings unavailable', message,
  });
  const logFailure = operation => appLogger.error('Account settings operation failed', {
    category: 'account_settings', metadata: { operation },
  });

  router.use((req, res, next) => {
    res.set({ 'Cache-Control': PRIVATE_NO_STORE, 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    res.locals.gtag = false;
    if (!req.isAuthenticated?.() || !/^[a-f\d]{24}$/i.test(String(req.user?._id || ''))) {
      return unavailable(res, 401, 'Log in to view your account settings.');
    }
    next();
  });
  router.use(requireCapability('account.profile.read'));
  router.use(rateLimit({
    windowMs: 60000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: req => String(req.user._id),
    handler: (_req, res) => unavailable(res, 429, 'Too many settings requests. Please try again shortly.'),
  }));
  router.use(async (req, res, next) => {
    try {
      res.locals.canEditEmail = await hasCapabilities(req.user, ['account.email.write'], authorization);
      res.locals.canChangePassword = await hasCapabilities(req.user, ['account.password.write'], authorization);
      next();
    } catch (_) {
      logFailure('authorize');
      unavailable(res, 503, 'Account access could not be verified. Please try again.');
    }
  });
  router.use(csrf.issueToken);
  router.use(express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 4 }));
  router.use(express.json({ limit: '8kb' }));

  function render(req, res, { status = 200, error = '', email } = {}) {
    const messages = { email: 'Your email address has been updated.', password: 'Your password has been changed.' };
    return res.status(status).render('user_settings', {
      pageTitle: 'User settings',
      account: { name: req.user.name, email: req.user.email, type: req.user.type_user },
      emailValue: email === undefined ? req.user.email : email,
      error,
      success: req.method === 'GET' && typeof req.query.updated === 'string'
        ? messages[req.query.updated] || '' : '',
    });
  }

  router.get('/', (req, res) => {
    if (Object.keys(req.query).some(key => key !== 'updated')
      || (req.query.updated !== undefined && !['email', 'password'].includes(req.query.updated))) {
      return unavailable(res, 400, 'Invalid settings request.');
    }
    return render(req, res);
  });

  const mutationLimit = rateLimit({
    windowMs: 15 * 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: req => String(req.user._id),
    handler: (_req, res) => unavailable(res, 429, 'Too many account change attempts. Please try again in 15 minutes.'),
  });
  function change(section, schema) {
    return async (req, res) => {
      const parsed = schema.safeParse(req.body);
      const email = typeof req.body?.email === 'string' && req.body.email.length <= 200 ? req.body.email : undefined;
      const fail = (status, error) => render(req, res, { status, error, email });
      if (Object.keys(req.query).length || !parsed.success) {
        return fail(400, section === 'email'
          ? 'Enter a valid email address (up to 200 characters) and your current password. Only the email address can be edited here.'
          : 'Enter your current password and matching new passwords, at least 12 characters and no more than 72 UTF-8 bytes.');
      }
      const input = parsed.data;
      try {
        const previousHash = req.user.hash_password;
        if (typeof previousHash !== 'string' || !await bcrypt.compare(input.currentPassword, previousHash)) {
          return fail(400, 'Your current password is incorrect.');
        }
        if (section === 'password' && await bcrypt.compare(input.newPassword, previousHash)) {
          return fail(400, 'Choose a new password that is different from your current password.');
        }
        const changes = section === 'email' ? { email: input.email }
          : { hash_password: await bcrypt.hash(input.newPassword, 12) };
        // Matching the verified hash prevents a concurrent password change/reset
        // from being overwritten by a request carrying the previous credentials.
        const result = await userModel.updateOne({ _id: req.user._id, hash_password: previousHash }, { $set: changes }, { runValidators: true });
        if (result.matchedCount !== 1) {
          return fail(409, 'Your account changed while this form was open. Reload and try again.');
        }
        Object.assign(req.user, changes);
        return res.redirect(303, `/settings?updated=${section}`);
      } catch (_) {
        logFailure(section);
        return fail(503, 'Your changes could not be saved. Please try again.');
      }
    };
  }
  router.post('/email', requireCapability('account.email.write'), csrf.requireToken, mutationLimit, change('email', emailInput));
  router.post('/password', requireCapability('account.password.write'), csrf.requireToken, mutationLimit, change('password', passwordChangeInput));
  router.use((error, _req, res, _next) => {
    if (['entity.too.large', 'parameters.too.many', 'entity.parse.failed', 'charset.unsupported', 'encoding.unsupported'].includes(error.type)) {
      return unavailable(res, error.status === 413 ? 413 : 400, 'Invalid settings request body.');
    }
    logFailure('request');
    return unavailable(res, 503, 'Settings are temporarily unavailable. Please try again.');
  });
  return router;
}

module.exports = { createUserSettingsRouter };
