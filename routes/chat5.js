const express = require('express');
const router = express.Router();

const path = require('path');
const multer = require('multer');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './tmp_data/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + extension);
  }
});
const upload = multer({ storage: storage });

// Require controller modules.
const controller = require('../controllers/chat5controller');
const chat5DocumentController = require('../controllers/chat5DocumentController');

// Chat5 top page
router.get('/', controller.index);

// Manage model cards
router.get('/ai_model_cards', controller.ai_model_cards);
router.post('/add_model_card', controller.add_model_card);
router.get('/story_mode/:id', controller.story_mode);
router.get('/edit_message/:id', controller.edit_message);
router.post('/update_message/:id', upload.array('imgs'), controller.update_message);
router.get('/top', controller.view_chat5_top);
router.get('/chat/:id', controller.view_chat5);
router.post('/chat/:id', controller.post_chat5);

// PDF ingestion for Chat5
router.post('/documents/pdf', upload.single('pdf'), chat5DocumentController.uploadPdf);
router.get('/documents/pdf/:jobId', chat5DocumentController.getJob);
router.delete('/documents/pdf/:jobId', chat5DocumentController.deleteJob);

module.exports = router;
