const express = require('express');
const multer = require('multer');
const controller = require('../controllers/ocrttscontroller');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB
    files: 1,
  },
});

router.get('/', controller.renderTool);
router.get('/jobs', controller.listJobs);
router.get('/jobs/:jobId', controller.getJobDetails);
router.post('/jobs', upload.single('image'), controller.enqueueJob);
router.patch('/jobs/:jobId/text', controller.updateText);
router.post('/jobs/:jobId/audios', controller.createAudio);
router.patch('/jobs/:jobId/audios/:audioId/default', controller.setDefaultAudio);
router.post('/jobs/:jobId/audios/:audioId/played', controller.markAudioPlayed);
router.post('/jobs/:jobId/embed-high-quality', controller.embedHighQuality);

module.exports = router;
