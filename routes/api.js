const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/apicontroller');

/* GET home page. */
router.all('*', controller.root);

/* Health log */
router.get('/getHealthEntries', controller.getHealthEntries);
router.post('/updateHealthEntry', controller.updateHealthEntry);

module.exports = router;
