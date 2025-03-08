const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/gallery');

/* GET home page. */
router.get('/', controller.index);
router.get('/view/:file', controller.view);
router.post('/rate/:file', controller.rate);
router.get('/image/:file', controller.image);

module.exports = router;
