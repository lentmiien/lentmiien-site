const express = require('express');
const controller = require('../controllers/soracontroller');

const router = express.Router();

router.get('/', controller.renderLanding);
router.get('/api/videos', controller.listVideos);
router.get('/api/categories', controller.listCategories);
router.post('/api/videos', controller.startGeneration);
router.get('/api/videos/:id/status', controller.getVideoStatus);
router.patch('/api/videos/:id/rating', controller.updateRating);

module.exports = router;
