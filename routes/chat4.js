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
// const multer = require('multer')
// const upload = multer({ dest: './tmp_data/' })

// Require controller modules.
const controller = require('../controllers/chat4controller');

// Chat4 top page
router.get('/', controller.index);
router.post('/updateconversation/:id', controller.updateconversation);
router.post('/doneconversation/:id', controller.doneconversation);
router.get('/chat/:id', controller.chat);

// Chat4 post
router.post('/post/:id', upload.array('imgs'), controller.post);
router.get('/delete_conversation/:id', controller.delete_conversation);
router.post('/generate_image/:id', controller.generate_image);
router.post('/generate_sound/:id', controller.generate_sound);
router.post('/generate_custom_message', controller.generate_custom_message);

// Knowledge database
router.get('/knowledgelist', controller.knowledgelist);
router.get('/viewknowledge/:id', controller.viewknowledge);
router.post('/saveknowledge', controller.saveknowledge);
router.get('/editknowledge/:id', controller.editknowledge);
router.post('/updateknowledge/:id', controller.updateknowledge);
router.get('/deleteknowledge/:id', controller.deleteknowledge);

// Blog
router.post('/postblog', controller.postblog);

// Health log
router.post('/fetch_messages', controller.fetch_messages);

// Chat4 helper
router.post('/prompt_assist', controller.prompt_assist);

// Agents
router.post('/create_agent', controller.create_agent);
router.post('/teach_agent', controller.teach_agent);
router.post('/ask_agent', controller.ask_agent);

// Bacth
router.post('/batch_prompt/:id', upload.array('imgs'), controller.batch_prompt);
router.get('/batch_status', controller.batch_status);
router.post('/batch_start', controller.batch_start);
router.post('/batch_update/:id', controller.batch_update);
router.post('/batch_import', controller.batch_import);
router.get('/batch_prompt_delete/:id', controller.batch_prompt_delete);

// Ask Category
router.post('/ask_category/:id', upload.array('imgs'), controller.ask_category);

// Redact
router.get('/redact/:id', controller.redact_page);
router.post('/redact/:id', controller.redact_post);

// Fetch messages API
router.get('/api/fetch_messages', controller.fetch_messages);

// Tagger
router.post('/generateTagsForRecipe', controller.generateTagsForRecipe);

// Templates
router.get('/templates', controller.templates_top);
router.post('/template/edit', controller.templates_edit);
router.post('/template/delete', controller.templates_delete);

// Tools test
router.post('/generate_image_tool/:id', upload.array('imgs'), controller.generate_image_tool);

// Whisper test
router.post('/voice_recorder_upload', upload.single('audio'), controller.voice_recorder_upload);

module.exports = router;
