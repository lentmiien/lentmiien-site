const express = require('express');
const controller = require('../controllers/modelPreviewController');

const router = express.Router();

router.get('/:source/:jobId', controller.renderPreview);

module.exports = router;
