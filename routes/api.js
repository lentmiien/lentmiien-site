const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/apicontroller');

/* GET home page. */
router.all('*', controller.root);

/* Health log */
router.get('/getHealthEntries', controller.getHealthEntries);
router.post('/updateHealthEntry', controller.updateHealthEntry);
router.post('/uploadHealthCsv', controller.uploadHealthCsv);
router.post('/deleteHealthEntry', controller.deleteHealthEntry);

/* Chat */
router.get('/getChatEntries', controller.getChatEntries);

module.exports = router;
