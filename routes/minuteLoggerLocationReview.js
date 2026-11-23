const express = require('express');
const controller = require('../controllers/minuteLoggerAdminController');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');

const router = express.Router();
// Location settings are admin-managed across the server-configured Minute Logger endpoint.
const manageMinuteLocations = createRequireCapabilities({
  capabilities: ['minute_logger.locations.manage'],
  roleCapabilityBundles: { admin: ['minute_logger.locations.manage'] },
});
const minuteLocationCsrf = createSessionCsrf();
router.get('/unnamed', manageMinuteLocations, minuteLocationCsrf.issueToken, (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  return controller.unnamedLocationGroups(req, res);
});
router.post('/location-groups/ignore', manageMinuteLocations, minuteLocationCsrf.requireToken, controller.ignoreLocationGroup);
router.post('/location-groups', manageMinuteLocations, minuteLocationCsrf.requireToken, controller.updateLocationGroupSettings);

module.exports = router;
