const express = require('express');
const rateLimit = require('express-rate-limit');
const { RoleModel } = require('../database');
const runpodAdminController = require('../controllers/runpodAdminController');
const { PRIVATE_NO_STORE, createRequireCapabilities } = require('../middleware/requireCapabilities');
const {
  RUNPOD_READ_CAPABILITIES,
  RUNPOD_ROLE_CAPABILITY_BUNDLES,
} = require('../utils/runpodAuthorizationPolicy');

const router = express.Router();

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

router.use(requireRunpodReadCapabilities);
router.get('/', runpodReadLimiter, runpodAdminController.index);

module.exports = router;
