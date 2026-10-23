const { sessionHasRequiredTwoFactor } = require('../utils/twoFactorSession');
const logger = require('../utils/logger');

function twoFactorGate(req, res, next) {
  if (!req.user || sessionHasRequiredTwoFactor(req.user, req.session)) return next();
  // A pre-rollout, expired, promoted or password-stale session must authenticate
  // again. Never convert an old session directly into a password-verified one.
  res.set('Cache-Control', 'private, no-store');
  req.logout(error => {
    if (error) {
      logger.error('Unable to invalidate an unverified session', { category: 'two_factor' });
      return res.status(503).send('Please sign in again.');
    }
    if (req.path === '/login') return next();
    return ['GET', 'HEAD'].includes(req.method) ? res.redirect('/login') : res.status(401).json({ error: 'Sign in again to verify your account.' });
  });
}

module.exports = twoFactorGate;
