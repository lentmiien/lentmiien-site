const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/gallerycontroller');

/* GET home page. */
router.get('/', controller.index);
router.get('/view', controller.view);
router.post('/rate/:file', controller.rate);
router.get('/slideshow/random', controller.random_slideshow);
router.get('/slideshow/category', controller.category_slideshow);
router.get('/image/:file', controller.image);

module.exports = router;
