const express = require('express');
const router = express.Router();

const multer = require('multer')
const upload = multer({ dest: './tmp_data/' })

// Require controller modules.
const controller = require('../controllers/openaicontroller');

/* GET home page. */
router.get('/', controller.index);
router.post('/upload_json', upload.single('json'), controller.upload_json);

/* Manage Open AI API models */
router.get('/manage', controller.manage_methods);
router.post('/manage/add', controller.manage_methods_add);
router.post('/manage/delete', controller.manage_methods_delete);

router.get('/history', controller.get_call_history);

module.exports = router;
