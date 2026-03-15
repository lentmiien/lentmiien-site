const express = require('express');

const router = express.Router();
const controller = require('../controllers/learningcontroller');

router.get('/', controller.home);
router.get('/topic/:topicSlug', controller.topic);
router.get('/topic/:topicSlug/:subtopicSlug', controller.subtopic);
router.post('/api/subtopics/:subtopicStableId/items/:itemStableId/submit', controller.submit_item);
router.post('/api/subtopics/:subtopicStableId/reset', controller.reset_progress);

module.exports = router;
