const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/webhook');

/* GET home page. */
router.post('/openai', controller.openai);

module.exports = router;
