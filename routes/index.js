const express = require('express');
const router = express.Router();

const multer = require('multer')
const upload = multer({ dest: './tmp_data/' })

// Require controller modules.
const controller = require('../controllers/indexcontroller');

/* GET home page. */
router.get('/', controller.index);
router.get('/login', controller.login);

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
router.get('/download_test', controller.download_test);

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
router.get('/scroll_test', controller.scroll_test);

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
router.get('/electricity_usage', controller.electricity_usage);

/****************************/
// TEST TEST TEST TEST TEST //
/****************************/
router.get('/voice_recorder', controller.voice_recorder);
router.post('/voice_recorder_upload', upload.single('audio'), controller.voice_recorder_upload);

module.exports = router;
