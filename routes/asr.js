const express = require('express');
const multer = require('multer');
const controller = require('../controllers/asrcontroller');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

const handleAsrUpload = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'Audio file exceeds the 25MB limit.'
        : 'Unable to process the uploaded audio.';
      return res.status(400).json({ error: message });
    }
    return controller.transcribe(req, res, next);
  });
};

router.get('/', controller.renderTool);
router.get('/jobs', controller.listJobs);
router.get('/jobs/:jobId', controller.getJob);
router.post('/transcribe', handleAsrUpload);

module.exports = router;
