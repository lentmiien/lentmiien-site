const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/healthcontroller');

// Front-end
router.get('/', controller.top);
router.get('/edit/:date', controller.edit);

// Add a new entry (API)
router.post('/health-entries', controller.addHealthEntry);
// Get one entry (API)
router.get('/health-entries/:date', controller.getHealthEntry);
// Update one entry (API)
router.put('/health-entries/:date', controller.updateHealthEntry);
// Get entries in date range (API)
router.get('/health-entries', controller.getHealthEntries);
// Delete one entry (API)
router.delete('/health-entries/:date', controller.deleteHealthEntry);

module.exports = router;
