const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/mypagecontroller');

/* GET home page. */
router.get('/', controller.mypage);

module.exports = router;
