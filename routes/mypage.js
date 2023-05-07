const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/mypagecontroller');

/* GET home page. */
router.get('/', controller.mypage);
router.get('/blogpost', controller.blogpost);
router.post('/post_blogpost', controller.post_blogpost);

module.exports = router;
