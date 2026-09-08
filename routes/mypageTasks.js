const express = require('express');
const Role = require('../models/role');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf, PRIVATE_NO_STORE } = require('../middleware/sessionCsrf');
const { hasCapabilities } = require('../utils/authorization');
const completeMypageTaskApi = (req, res, next) => require('../controllers/scheduleTaskController').completeMypageTaskApi(req, res, next);

const CAPABILITY = 'schedule.task.complete';
const capabilityPolicy = {
  capabilities: [CAPABILITY],
  roleModel: Role,
  roleCapabilityBundles: { admin: [CAPABILITY], family: [CAPABILITY], user: [CAPABILITY] },
};
const csrf = createSessionCsrf();
const router = express.Router();

function privateResponse(req, res, next) {
  res.set('Cache-Control', PRIVATE_NO_STORE);
  next();
}

router.use(privateResponse);
router.use((req, res, next) => {
  if (!req.isAuthenticated?.()) {
    return res.status(401).json({ ok: false, error: 'Login required.' });
  }
  next();
});
router.patch('/:id/done', createRequireCapabilities(capabilityPolicy), csrf.requireToken, completeMypageTaskApi);

const prepareTaskShortcut = [
  privateResponse,
  csrf.issueToken,
  async (req, res, next) => {
    try {
      res.locals.canCompleteMypageTask = await hasCapabilities(req.user, [CAPABILITY], capabilityPolicy);
      res.locals.gtag = false;
      next();
    } catch (error) {
      next(error);
    }
  },
];

module.exports = { router, prepareTaskShortcut };
