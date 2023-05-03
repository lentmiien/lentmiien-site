const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/gptdocumentcontroller');

/* GET home page. */
// router.get('/', controller.index);

router.get('/specifications', controller.specifications);

module.exports = router;
