const express = require('express');
const multer = require('multer');
const controller = require('../controllers/ocrcontroller');

const router = express.Router();
const MAX_FILES_PER_JOB = Number(process.env.OCR_JOB_MAX_FILES || 5);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB per file
    files: MAX_FILES_PER_JOB,
  },
});

router.get('/', controller.renderTool);
router.get('/jobs', controller.listJobs);
router.get('/jobs/:jobId/view/:fileId?', controller.renderJobPage);
router.get('/jobs/:jobId', controller.getJobDetails);
router.post('/jobs', upload.array('images', MAX_FILES_PER_JOB), controller.enqueueJob);
router.patch('/jobs/:jobId/files/:fileId', controller.updateFileResult);
router.delete('/jobs/:jobId', controller.deleteJob);

module.exports = router;
