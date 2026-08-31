const { hasCapabilities, normalizeCapabilities } = require('../utils/authorization');
const defaultLogger = require('../utils/logger');

const PRIVATE_NO_STORE = 'private, no-store, max-age=0';

function renderDenied(res, status, title, message, user) {
  return res
    .status(status)
    .set('Cache-Control', PRIVATE_NO_STORE)
    .render('accessDenied', {
      title,
      message,
      user,
    });
}

function createRequireCapabilities({
  capabilities,
  roleModel,
  roleCapabilityBundles = {},
  logger = defaultLogger,
} = {}) {
  const requiredCapabilities = normalizeCapabilities(capabilities);
  if (requiredCapabilities.length === 0) {
    throw new TypeError('At least one capability is required.');
  }

  return async function requireCapabilities(req, res, next) {
    try {
      const allowed = await hasCapabilities(req.user, requiredCapabilities, {
        roleModel,
        roleCapabilityBundles,
      });
      if (allowed) {
        return next();
      }

      return renderDenied(
        res,
        403,
        'Access Denied',
        'You do not have permission to access this page.',
        req.user
      );
    } catch (error) {
      logger.error('Capability authorization lookup failed', {
        category: 'authorization',
        metadata: {
          capabilityCount: requiredCapabilities.length,
          errorName: error?.name || 'Error',
        },
      });
      return renderDenied(
        res,
        503,
        'Authorization Unavailable',
        'Access could not be verified. Please try again.',
        req.user
      );
    }
  };
}

module.exports = {
  PRIVATE_NO_STORE,
  createRequireCapabilities,
};
