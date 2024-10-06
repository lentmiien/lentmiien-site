const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/chat5controller');

// Chat4 top page
router.get('/', controller.index);

module.exports = router;
