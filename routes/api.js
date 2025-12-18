const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/apicontroller');

/* GET home page. */
router.all('*', controller.root);

/* Bin packing */
router.post('/binpacking', controller.binPacking);

/* Health log */
router.get('/getHealthEntries', controller.getHealthEntries);
router.post('/updateHealthEntry', controller.updateHealthEntry);
router.post('/uploadHealthCsv', controller.uploadHealthCsv);
router.post('/deleteHealthEntry', controller.deleteHealthEntry);

/* Message inbox */
router.post('/messages', controller.saveIncomingMessage);

/* Chat */
router.get('/getChatEntries', controller.getChatEntries);

/* External */
router.get('/testConnect', controller.testConnect);
router.get('/fetchFeedback', controller.fetchFeedback);
router.post('/setTask', controller.setTask);

module.exports = router;
