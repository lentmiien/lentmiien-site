const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/embeddingcontroller');

/* GET home page. */
router.get('/', controller.index);

module.exports = router;
