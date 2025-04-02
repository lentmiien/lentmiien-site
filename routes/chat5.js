const express = require('express');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/chat5controller');

// Chat5 top page
router.get('/', controller.index);

// Manage model cards
router.get('/ai_model_cards', controller.ai_model_cards);
router.post('/add_model_card', controller.add_model_card);
router.get('/story_mode/:id', controller.story_mode);

module.exports = router;
