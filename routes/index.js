const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/indexcontroller');

/* GET home page. */
router.get('/', controller.index);
router.get('/login', controller.login);

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
router.get('/download_test', controller.download_test);

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
router.get('/scroll_test', controller.scroll_test);

module.exports = router;
