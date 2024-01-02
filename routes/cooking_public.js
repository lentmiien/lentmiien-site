const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/cookingpubliccontroller');

/* GET home page. */
router.get('/', controller.index);

router.post('/api_send_cooking_request', controller.api_send_cooking_request);

module.exports = router;
