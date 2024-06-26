const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/chat3controller');

// Chat3 top page
router.get('/', controller.index);

// Generate content
router.post('/post', controller.post);
router.post('/import', controller.import);
router.post('/img', controller.generate_image);
router.post('/mp3', controller.generate_tts);

// Prompt templates
router.get('/manage_templates', controller.manage_templates);
router.post('/manage_templates_post', controller.manage_templates_post);
router.post('/manage_templates_delete', controller.manage_templates_delete);

// Knowledge
router.get('/manage_knowledge', controller.manage_knowledge);
router.post('/manage_knowledge_add_template', controller.manage_knowledge_add_template);
router.post('/manage_knowledge_delete_template', controller.manage_knowledge_delete_template);
router.get('/manage_knowledge_add', controller.manage_knowledge_add);
router.post('/manage_knowledge_add_post', controller.manage_knowledge_add_post);
router.get('/manage_knowledge_edit', controller.manage_knowledge_edit);
router.post('/manage_knowledge_edit_post', controller.manage_knowledge_edit_post);
router.post('/manage_knowledge_fetch', controller.manage_knowledge_fetch);
router.get('/browse_knowledge', controller.browse_knowledge);

// Set default model
router.post('/set_default_model', controller.set_default_model);

// Simple chat
router.post('/post_simple_chat', controller.post_simple_chat);

// Fetch messages of provided ids
router.post('/fetch_messages', controller.fetch_messages);

// Transfer to chat4
router.get('/transfer_chat/:id', controller.transfer_chat);

module.exports = router;
