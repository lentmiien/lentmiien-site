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

module.exports = router;
