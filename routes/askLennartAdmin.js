const express = require('express');
const rateLimit = require('express-rate-limit');

const Role = require('../models/role');
const askLennartController = require('../controllers/askLennartController');
const { PRIVATE_NO_STORE, createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const {
  CHAT_TOOL_CAPABILITIES,
  CHAT_TOOL_ROLE_CAPABILITY_BUNDLES,
} = require('../utils/chatToolAuthorizationPolicy');

const router = express.Router();
const csrf = createSessionCsrf();
const MAX_FORM_BODY_BYTES = 256 * 1024;
const MAX_DECODED_FIELD_BYTES = (20000 * 4) + 1024;
const requireHumanRequestManagement = createRequireCapabilities({
  capabilities: [CHAT_TOOL_CAPABILITIES.humanRequestManage],
  roleModel: Role,
  roleCapabilityBundles: CHAT_TOOL_ROLE_CAPABILITY_BUNDLES,
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => res
    .status(429)
    .set('Cache-Control', PRIVATE_NO_STORE)
    .render('accessDenied', {
      title: 'Too Many Requests',
      message: 'The human request inbox can be refreshed up to 60 times per minute.',
      user: req.user,
    }),
});

const mutationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => res
    .status(429)
    .set('Cache-Control', PRIVATE_NO_STORE)
    .render('accessDenied', {
      title: 'Too Many Requests',
      message: 'Up to 30 human request responses can be submitted per hour.',
      user: req.user,
    }),
});

function rejectForm(req, res, status, message) {
  return res.status(status).set('Cache-Control', PRIVATE_NO_STORE).render('accessDenied', {
    title: 'Request Rejected',
    message,
    user: req.user,
  });
}

function requireBoundedForm(req, res, next) {
  if (typeof req.is === 'function' && !req.is('application/x-www-form-urlencoded')) {
    return rejectForm(req, res, 415, 'Human request responses accept browser form submissions only.');
  }
  const contentLength = Number(req.get?.('content-length'));
  const entries = Object.entries(req.body || {});
  const allowedFields = new Set(['_csrf', 'response']);
  const invalid = (Number.isFinite(contentLength) && contentLength > MAX_FORM_BODY_BYTES)
    || entries.length > 2
    || entries.some(([key, value]) => (
      !allowedFields.has(key)
      || typeof value !== 'string'
      || Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8') > MAX_DECODED_FIELD_BYTES
    ));
  if (invalid) {
    return rejectForm(
      req,
      res,
      413,
      'The human request response is too large or contains unsupported fields.'
    );
  }
  return next();
}

router.use((_req, res, next) => {
  res.set('Cache-Control', PRIVATE_NO_STORE);
  next();
});
router.use(requireHumanRequestManagement);
router.use(csrf.issueToken);
router.get('/', readLimiter, askLennartController.index);
router.post(
  '/:requestId/respond',
  mutationLimiter,
  requireBoundedForm,
  csrf.requireToken,
  askLennartController.respond
);

module.exports = router;
