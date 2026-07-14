const express = require('express');
const router = express.Router();

const path = require('path');
const multer = require('multer');
const MAX_UPLOAD_FILE_SIZE = 25 * 1024 * 1024;
const MAX_UPLOAD_FILES = 10;
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
const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_UPLOAD_FILE_SIZE,
    files: MAX_UPLOAD_FILES,
  },
});

// Require controller modules.
const controller = require('../controllers/chat5controller');
const chat5DocumentController = require('../controllers/chat5DocumentController');
const trainingDataController = require('../controllers/trainingDataController');

// Chat5 top page
router.get('/', controller.index);

// Manage model cards
router.get('/ai_model_cards', controller.ai_model_cards);
router.post('/add_model_card', controller.add_model_card);
router.post('/ai_model_cards/:id/deprecation-date', controller.update_model_card_deprecation_date);
router.post('/ai_model_cards/:id/delete', controller.delete_model_card);
router.get('/drafting-presets', controller.viewDraftingPresets);
router.post('/drafting-presets/personality', controller.savePersonalityPreset);
router.post('/drafting-presets/personality/:id/delete', controller.deletePersonalityPreset);
router.post('/drafting-presets/response-type', controller.saveResponseTypePreset);
router.post('/drafting-presets/response-type/:id/delete', controller.deleteResponseTypePreset);
router.get('/story_mode/:id', controller.story_mode);
router.get('/edit_message/:id', controller.edit_message);
router.post('/update_message/:id', upload.array('imgs'), controller.update_message);
router.get('/top', controller.view_chat5_top);
router.post('/training-entries', trainingDataController.createEntry);
router.post('/training-entries/:id/delete', trainingDataController.deleteEntry);
router.get('/chat/:id', controller.view_chat5);
router.get('/voice/:id', controller.view_chat5_voice);
router.post('/chat/:id', controller.post_chat5);

// PDF ingestion for Chat5
router.post('/documents/pdf', upload.single('pdf'), chat5DocumentController.uploadPdf);
router.get('/documents/pdf/:jobId', chat5DocumentController.getJob);
router.delete('/documents/pdf/:jobId', chat5DocumentController.deleteJob);

module.exports = router;
