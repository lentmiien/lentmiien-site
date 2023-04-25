const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/chatcontroller');

/* GET home page. */
router.get('/', controller.index);
router.post('/post', controller.post);

module.exports = router;
