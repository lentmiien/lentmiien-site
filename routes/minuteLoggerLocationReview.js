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
router.use(['/unnamed', '/ignored'], manageMinuteLocations, minuteLocationCsrf.issueToken, (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
router.get('/unnamed', controller.unnamedLocationGroups);
router.get('/ignored', controller.ignoredLocationGroups);
router.post('/location-groups/name-ignored', manageMinuteLocations, minuteLocationCsrf.requireToken, controller.nameIgnoredLocationGroup);
router.post('/location-groups/unignore', manageMinuteLocations, minuteLocationCsrf.requireToken, controller.unignoreLocationGroup);
router.post('/location-groups/ignore', manageMinuteLocations, minuteLocationCsrf.requireToken, controller.ignoreLocationGroup);
router.post('/location-groups', manageMinuteLocations, minuteLocationCsrf.requireToken, controller.updateLocationGroupSettings);

module.exports = router;
