const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/dummyapicontroller');

router.get('/identifiers', controller.shipping_identifiers);
router.post('/shipments', controller.shipping_labels);

module.exports = router;
