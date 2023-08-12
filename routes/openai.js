const express = require('express');
const router = express.Router();

const multer = require('multer')
const upload = multer({ dest: './tmp_data/' })

// Require controller modules.
const controller = require('../controllers/openaicontroller');

/* GET home page. */
router.get('/', controller.index);
router.post('/upload_json', upload.single('json'), controller.upload_json);

module.exports = router;
