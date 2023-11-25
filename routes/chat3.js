const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/chat3controller');

/* GET home page. */
router.get('/', controller.index);
router.post('/post', controller.post);

router.post('/img', controller.generate_image);
router.post('/mp3', controller.generate_tts);

router.get('/manage_templates', controller.manage_templates);
router.post('/manage_templates_post', controller.manage_templates_post);
router.post('/manage_templates_delete', controller.manage_templates_delete);

module.exports = router;
