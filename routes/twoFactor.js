const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const Role = require('../models/role');
const logger = require('../utils/logger');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { createTwoFactorService } = require('../services/twoFactorService');
const { redirectAfterLogin, passwordReminder } = require('../utils/passwordPolicy');
const { SECURITY_CAPABILITY, ROLE_BUNDLES, requiresTwoFactor, verificationReceipt, passwordFingerprint, pendingValid, sessionHasRequiredTwoFactor, beginPendingVerification } = require('../utils/twoFactorSession');

const csrf = createSessionCsrf();
const service = createTwoFactorService();
const passwordValid = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 1024;
const codeValid = value => typeof value === 'string' && /^[0-9a-fA-F-]{6,39}$/.test(value);
const allowedBody = (req, fields) => req.body && !Array.isArray(req.body) && Object.keys(req.query).length === 0
  && Object.keys(req.body).every(key => ['_csrf', ...fields].includes(key));
const logFailure = operation => logger.error('Two-factor authentication operation failed', { category: 'two_factor', metadata: { operation } });
function requestError(error, _req, res, _next) {
  if (['entity.too.large', 'parameters.too.many', 'entity.parse.failed', 'charset.unsupported', 'encoding.unsupported'].includes(error.type)) return res.status(error.status === 413 ? 413 : 400).send('Invalid verification request.');
  logFailure('request');
  return res.status(503).send('Verification is temporarily unavailable. Please try again.');
}
function privateResponse(_req, res, next) {
  res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy': "default-src 'none'; style-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" });
  res.locals.gtag = false;
  next();
}
function render(req, res, mode, extra = {}, status = 200) {
  return res.status(status).render('two_factor', { mode, error: '', user: req.twoFactorUser,
    pending: Boolean(req.session.pendingTwoFactor), csrfToken: req.session.csrfToken, ...extra });
}
async function finishLogin(req, user, receipt) {
  await new Promise((resolve, reject) => req.logIn(user, error => error ? reject(error) : resolve()));
  if (receipt) req.session.twoFactor = receipt;
  req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
}
function passwordLogin(passport, factorService = service) {
  return (req, res, next) => {
    if (!allowedBody(req, ['username', 'password']) || typeof req.body.username !== 'string'
      || !req.body.username.trim() || req.body.username.length > 100 || !passwordValid(req.body.password)) {
      return res.status(400).send('Enter a valid username and password.');
    }
    return passport.authenticate('local', async (error, user) => {
      if (error) { logFailure('password_login'); return res.status(503).send('Sign-in is temporarily unavailable.'); }
      if (!user) return res.redirect('/login?error=credentials');
      try {
        if (requiresTwoFactor(user)) {
          factorService.configured();
          const receipt = factorService.remembered(req, user);
          if (!receipt) {
            await beginPendingVerification(req, user);
            return res.redirect(user.two_factor?.enabled ? '/two-factor/verify' : '/two-factor/setup');
          }
          await finishLogin(req, user, receipt);
        } else {
          await finishLogin(req, user);
        }
        return redirectAfterLogin(req, res);
      } catch (_) {
        logFailure('password_login');
        return res.status(503).send('Sign-in is temporarily unavailable. Ask the site operator to check two-factor configuration.');
      }
    })(req, res, next);
  };
}

function createTwoFactorRouter({ factorService = service, roleModel = Role } = {}) {
  const router = express.Router();
  const requireSecurity = createRequireCapabilities({ capabilities: [SECURITY_CAPABILITY], roleModel, roleCapabilityBundles: ROLE_BUNDLES });
  router.use(privateResponse);
  router.use(rateLimit({ windowMs: 60000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false }));
  router.use(async (req, res, next) => {
    try {
      const pending = req.session?.pendingTwoFactor;
      const id = req.isAuthenticated?.() ? req.user?._id : pending?.userId;
      if (!/^[a-f\d]{24}$/i.test(String(id || ''))) return res.redirect('/login');
      const user = await factorService.load(id);
      if (!user || (pending ? !pendingValid(user, pending) : !sessionHasRequiredTwoFactor(user, req.session))) {
        delete req.session.pendingTwoFactor;
        delete req.session.twoFactorSetup;
        return res.status(401).render('two_factor', { mode: 'expired', error: '' });
      }
      factorService.configured();
      req.twoFactorUser = user;
      // Apply the shared capability guard to the validated restricted principal
      // without turning a pending login into req.user / Passport authentication.
      return requireSecurity({ user }, res, next);
    } catch (_) {
      logFailure('authorize');
      return res.status(503).send('Account security is temporarily unavailable. Ask the site operator to check configuration.');
    }
  });
  router.use(rateLimit({ windowMs: 60000, limit: 60, keyGenerator: req => String(req.twoFactorUser._id), standardHeaders: 'draft-8', legacyHeaders: false }));
  router.use(csrf.issueToken);
  router.use(express.urlencoded({ extended: false, limit: '4kb', parameterLimit: 4 }));
  router.use(express.json({ limit: '4kb' }));
  router.use((req, res, next) => ['GET', 'HEAD'].includes(req.method) ? next() : csrf.requireToken(req, res, next));
  router.use(rateLimit({ windowMs: 15 * 60000, limit: 10, keyGenerator: req => String(req.twoFactorUser._id),
    skip: req => ['GET', 'HEAD'].includes(req.method), standardHeaders: 'draft-8', legacyHeaders: false,
    message: 'Too many verification attempts. Please try again in 15 minutes.' }));

  router.get('/', (req, res) => {
    if (req.session.pendingTwoFactor) return res.redirect(req.twoFactorUser.two_factor?.enabled ? '/two-factor/verify' : '/two-factor/setup');
    return render(req, res, 'manage');
  });
  router.get('/verify', (req, res) => {
    if (!req.session.pendingTwoFactor) return res.redirect('/two-factor');
    if (!req.twoFactorUser.two_factor?.enabled) return res.redirect('/two-factor/setup');
    return render(req, res, 'verify');
  });
  router.post('/verify', async (req, res) => {
    if (!req.session.pendingTwoFactor || !allowedBody(req, ['code']) || !codeValid(req.body.code)) {
      return render(req, res, 'verify', { error: 'Enter the six-digit authenticator code or one of your recovery codes.' }, 400);
    }
    if (!await factorService.consume(req.twoFactorUser, req.body.code)) {
      return render(req, res, 'verify', { error: 'That code is invalid or has already been used. Wait for a new code, or try an unused recovery code.' }, 400);
    }
    const receipt = verificationReceipt(req.twoFactorUser);
    await finishLogin(req, req.twoFactorUser, receipt);
    factorService.remember(req, res, receipt);
    return redirectAfterLogin(req, res);
  });
  router.get('/setup', async (req, res) => {
    const candidate = req.session.twoFactorSetup;
    if (candidate && pendingValid(req.twoFactorUser, candidate)) {
      return render(req, res, 'setup', await factorService.setupDisplay(req.twoFactorUser, candidate));
    }
    delete req.session.twoFactorSetup;
    if (req.session.pendingTwoFactor && req.twoFactorUser.two_factor?.enabled) return res.redirect('/two-factor/verify');
    return render(req, res, 'start');
  });
  async function reauthenticate(req) {
    return passwordValid(req.body.currentPassword)
      && await bcrypt.compare(req.body.currentPassword, req.twoFactorUser.hash_password)
      && (!req.twoFactorUser.two_factor?.enabled || codeValid(req.body.code) && await factorService.consume(req.twoFactorUser, req.body.code));
  }
  router.post('/setup/start', async (req, res) => {
    const user = req.twoFactorUser;
    if (!allowedBody(req, ['currentPassword', 'code']) || (req.session.pendingTwoFactor
      ? user.two_factor?.enabled : !await reauthenticate(req))) {
      return render(req, res, 'start', { error: 'Verify your current password and, if enabled, a fresh authenticator or recovery code.' }, 400);
    }
    req.session.twoFactorSetup = { ...await factorService.setup(user), userId: String(user._id), credential: passwordFingerprint(user), version: user.two_factor?.version || '' };
    return res.redirect(303, '/two-factor/setup');
  });
  async function showRecovery(req, res, codes) {
    const receipt = verificationReceipt(req.twoFactorUser);
    await finishLogin(req, req.twoFactorUser, receipt);
    factorService.remember(req, res, receipt);
    return render(req, res, 'recovery', { codes, continueTo: passwordReminder(req.twoFactorUser) ? '/settings' : '/mypage' });
  }
  router.post('/setup/confirm', async (req, res) => {
    const candidate = req.session.twoFactorSetup;
    if (!allowedBody(req, ['code']) || !pendingValid(req.twoFactorUser, candidate) || typeof req.body.code !== 'string' || !/^\d{6}$/.test(req.body.code)) {
      return render(req, res, 'expired', { error: 'Setup expired or the code is invalid. Start setup again.' }, 400);
    }
    const codes = await factorService.confirm(req.twoFactorUser, candidate, req.body.code);
    if (!codes) return render(req, res, 'setup', { ...await factorService.setupDisplay(req.twoFactorUser, candidate), error: 'That code was not accepted. Try the current code from your authenticator.' }, 400);
    return showRecovery(req, res, codes);
  });
  router.post('/recovery-codes', async (req, res) => {
    if (req.session.pendingTwoFactor || !req.twoFactorUser.two_factor?.enabled || !allowedBody(req, ['currentPassword', 'code']) || !await reauthenticate(req)) {
      return render(req, res, 'manage', { error: 'Verify your current password and a fresh authenticator or recovery code.' }, 400);
    }
    const codes = await factorService.replaceRecovery(req.twoFactorUser);
    if (!codes) return render(req, res, 'manage', { error: 'Your account changed. Reload and try again.' }, 409);
    return showRecovery(req, res, codes);
  });
  router.post('/disable', async (req, res) => {
    if (req.session.pendingTwoFactor || req.twoFactorUser.type_user === 'admin') return res.status(403).send('Two-factor authentication is required for administrators.');
    if (!allowedBody(req, ['currentPassword', 'code']) || !await reauthenticate(req)) return render(req, res, 'manage', { error: 'Verify your current password and a fresh authenticator or recovery code.' }, 400);
    if (!await factorService.disable(req.twoFactorUser)) return render(req, res, 'manage', { error: 'Your account changed. Reload and try again.' }, 409);
    factorService.forget(req, res);
    delete req.session.twoFactor;
    delete req.session.twoFactorSetup;
    return res.redirect(303, '/settings');
  });
  router.post('/cancel', (req, res, next) => {
    if (!allowedBody(req, [])) return res.sendStatus(400);
    req.session.destroy(error => error ? next(error) : res.redirect(303, '/login'));
  });
  router.use(requestError);
  return router;
}
module.exports = { createTwoFactorRouter, passwordLogin, csrf, privateResponse, requestError };
