const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/boxcontroller');

router.get('/', controller.index);
router.post('/pack', controller.pack);
router.post('/test', controller.test);

module.exports = router;
