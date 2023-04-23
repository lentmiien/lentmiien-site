const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/indexcontroller');

/* GET home page. */
router.get('/', controller.index);
router.get('/login', controller.login);

module.exports = router;
