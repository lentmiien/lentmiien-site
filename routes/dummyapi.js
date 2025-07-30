const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/dummyapicontroller');

router.post('/shipping/labels', controller.shipping_labels);

module.exports = router;
