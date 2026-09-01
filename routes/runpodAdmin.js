const express = require('express');
const rateLimit = require('express-rate-limit');
const { RoleModel } = require('../database');
const runpodAdminController = require('../controllers/runpodAdminController');
const runpodPodAdminController = require('../controllers/runpodPodAdminController');
const { PRIVATE_NO_STORE, createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const {
  RUNPOD_CAPABILITIES,
  RUNPOD_READ_CAPABILITIES,
  RUNPOD_ROLE_CAPABILITY_BUNDLES,
} = require('../utils/runpodAuthorizationPolicy');

const router = express.Router();
const csrf = createSessionCsrf();
const RUNPOD_FORM_MAX_BYTES = 16 * 1024;
const RUNPOD_FORM_MAX_FIELDS = 20;

function rejectBoundedForm(req, res, status, message) {
  return res
    .status(status)
    .set('Cache-Control', PRIVATE_NO_STORE)
    .render('accessDenied', {
      title: 'Request Rejected',
      message,
      user: req.user,
    });
}

function requireBoundedRunpodForm(req, res, next) {
  if (req.method !== 'POST') return next();
  if (typeof req.is === 'function' && !req.is('application/x-www-form-urlencoded')) {
    return rejectBoundedForm(req, res, 415, 'Runpod controls accept browser form submissions only.');
  }
  const declaredLength = Number(req.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > RUNPOD_FORM_MAX_BYTES) {
    return rejectBoundedForm(req, res, 413, 'The Runpod form is too large.');
  }
  const entries = Object.entries(req.body || {});
  if (
    entries.length > RUNPOD_FORM_MAX_FIELDS
    || entries.some(([key, value]) => (
      typeof value !== 'string'
      || Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8') > RUNPOD_FORM_MAX_BYTES
    ))
    || entries.reduce((size, [key, value]) => (
      size + Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8')
    ), 0) > RUNPOD_FORM_MAX_BYTES
  ) {
    return rejectBoundedForm(req, res, 413, 'The Runpod form is too large or contains unsupported fields.');
  }
  return next();
}

const requireRunpodReadCapabilities = createRequireCapabilities({
  capabilities: RUNPOD_READ_CAPABILITIES,
  roleModel: RoleModel,
  roleCapabilityBundles: RUNPOD_ROLE_CAPABILITY_BUNDLES,
});

const runpodReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => res
    .status(429)
    .set('Cache-Control', PRIVATE_NO_STORE)
    .render('accessDenied', {
      title: 'Too Many Requests',
      message: 'The Runpod monitor can be refreshed up to 30 times per minute.',
      user: req.user,
    }),
});

const runpodMutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => res
    .status(429)
    .set('Cache-Control', PRIVATE_NO_STORE)
    .render('accessDenied', {
      title: 'Too Many Requests',
      message: 'Runpod controls can be used up to 30 times per minute.',
      user: req.user,
    }),
});

const runpodCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => res
    .status(429)
    .set('Cache-Control', PRIVATE_NO_STORE)
    .render('accessDenied', {
      title: 'Pod Creation Paused',
      message: 'Up to three Pod creation attempts are allowed per hour.',
      user: req.user,
    }),
});

function requireCapability(capability) {
  return createRequireCapabilities({
    capabilities: [capability],
    roleModel: RoleModel,
    roleCapabilityBundles: RUNPOD_ROLE_CAPABILITY_BUNDLES,
  });
}

router.use(requireRunpodReadCapabilities);
router.use(csrf.issueToken);
router.use(requireBoundedRunpodForm);
router.get('/', runpodReadLimiter, runpodAdminController.index);
router.post(
  '/templates/ollama',
  runpodMutationLimiter,
  csrf.requireToken,
  requireCapability(RUNPOD_CAPABILITIES.templateManage),
  runpodPodAdminController.saveOllamaTemplate
);
router.post(
  '/pods',
  runpodMutationLimiter,
  runpodCreateLimiter,
  csrf.requireToken,
  requireCapability(RUNPOD_CAPABILITIES.podCreate),
  runpodPodAdminController.createPod
);
router.post(
  '/billing/sync',
  runpodMutationLimiter,
  csrf.requireToken,
  requireCapability(RUNPOD_CAPABILITIES.billingSync),
  runpodPodAdminController.syncBilling
);
router.post(
  '/pods/sync',
  runpodMutationLimiter,
  csrf.requireToken,
  requireCapability(RUNPOD_CAPABILITIES.podSync),
  runpodPodAdminController.syncPods
);
router.post(
  '/pods/:id/start',
  runpodMutationLimiter,
  csrf.requireToken,
  requireCapability(RUNPOD_CAPABILITIES.podStart),
  runpodPodAdminController.startPod
);
router.post(
  '/pods/:id/stop',
  runpodMutationLimiter,
  csrf.requireToken,
  requireCapability(RUNPOD_CAPABILITIES.podStop),
  runpodPodAdminController.stopPod
);
router.post(
  '/pods/:id/setup',
  runpodMutationLimiter,
  csrf.requireToken,
  requireCapability(RUNPOD_CAPABILITIES.podSetup),
  runpodPodAdminController.retrySetup
);
router.post(
  '/pods/:id/delete',
  runpodMutationLimiter,
  csrf.requireToken,
  requireCapability(RUNPOD_CAPABILITIES.podDelete),
  runpodPodAdminController.deletePod
);

module.exports = router;
module.exports.RUNPOD_FORM_MAX_BYTES = RUNPOD_FORM_MAX_BYTES;
module.exports.RUNPOD_FORM_MAX_FIELDS = RUNPOD_FORM_MAX_FIELDS;
module.exports.requireBoundedRunpodForm = requireBoundedRunpodForm;
