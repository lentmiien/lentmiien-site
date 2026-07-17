const express = require('express');
const multer = require('multer');
const controller = require('../controllers/trellis2Controller');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: controller.MAX_IMAGE_BYTES,
    files: 1,
    fields: 20,
    fieldSize: 1024 * 1024,
  },
});

router.get('/', controller.renderIndex);
router.get('/status', controller.serviceState);
router.post('/jobs', (req, res, next) => {
  upload.single('image')(req, res, (error) => {
    if (error) return controller.handleUploadError(req, res, error);
    return Promise.resolve(controller.createJob(req, res)).catch(next);
  });
});
router.get('/jobs/:jobId', controller.getJob);
router.patch('/jobs/:jobId/share', controller.toggleShare);
router.get('/jobs/:jobId/download', controller.downloadModel);

module.exports = router;
