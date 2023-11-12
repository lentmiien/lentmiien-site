const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/mypagecontroller');

/* GET home page. */
router.get('/', controller.mypage);

// Blogpost
router.get('/blogpost', controller.blogpost);
router.post('/post_blogpost', controller.post_blogpost);
router.get('/delete_blogpost', controller.delete_blogpost);

router.get('/speektome', controller.speektome);
router.post('/speektome', controller.speektome_post);
router.get('/showtome', controller.showtome);

module.exports = router;
