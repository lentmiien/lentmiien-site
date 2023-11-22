const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/chat3controller');

/* GET home page. */
router.get('/', controller.index);
router.post('/post', controller.post);

router.post('/img', controller.generate_image);
router.post('/mp3', controller.generate_tts);

module.exports = router;
