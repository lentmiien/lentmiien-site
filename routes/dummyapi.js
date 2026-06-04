const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/dummyapicontroller');

router.all(
  '/ok',
  express.text({ type: ['text/*', 'application/xml', 'application/*+xml'], limit: '5mb' }),
  controller.ok
);
router.get('/identifiers', controller.shipping_identifiers);
router.post('/shipments', controller.shipping_labels);
router.post('/WEBAPI', controller.japanPostLabel);
router.get('/labels/:trackingNumber.pdf', controller.japanPostLabelPdf);

module.exports = router;
