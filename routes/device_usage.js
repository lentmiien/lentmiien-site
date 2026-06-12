const express = require('express');
const controller = require('../controllers/deviceUsageController');

const router = express.Router();

router.get('/status', controller.status);
router.get('/', controller.check);
router.post('/', controller.check);

module.exports = router;
