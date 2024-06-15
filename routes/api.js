const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/apicontroller');

/* GET home page. */
router.all('*', controller.root);

/* Health log */
router.get('/getHealthEntries', controller.getHealthEntries);
router.post('/updateHealthEntry', controller.updateHealthEntry);
router.post('/upload_health_csv', controller.upload_health_csv);

module.exports = router;
