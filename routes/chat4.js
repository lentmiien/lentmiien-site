const express = require('express');
const router = express.Router();

const multer = require('multer')
const upload = multer({ dest: './tmp_data/' })

// Require controller modules.
const controller = require('../controllers/chat4controller');

// Chat4 top page
router.get('/', controller.index);
router.get('/chat/:id', controller.chat);

// Chat4 post
router.post('/post/:id', upload.array('imgs'), controller.post);
router.post('/generate_image/:id', controller.generate_image);
router.post('/generate_sound/:id', controller.generate_sound);

// Knowledge database
router.get('/knowledgelist', controller.knowledgelist);
router.get('/viewknowledge/:id', controller.viewknowledge);
router.post('/saveknowledge', controller.saveknowledge);
router.get('/editknowledge/:id', controller.editknowledge);
router.post('/updateknowledge/:id', controller.updateknowledge);

module.exports = router;
