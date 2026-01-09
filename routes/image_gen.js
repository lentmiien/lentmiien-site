// routes/image_gen.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const ctrl = require('../controllers/image_gen.controller');

const router = express.Router();
const BULK_DISABLED = true;

// Ensure tmp folder exists
const TMP_DIR = path.join(__dirname, '../tmp_data');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// Multer storage to tmp_data
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TMP_DIR),
  filename: (_req, file, cb) => {
    const base = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const name = Date.now() + '_' + base;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 64 * 1024 * 1024 }, // 64MB
  fileFilter: (_req, file, cb) => {
    const ok = /image\/(png|jpe?g|webp)/i.test(file.mimetype);
    cb(ok ? null : new Error('Only images are allowed'), ok);
  }
});

// Parse JSON for our API routes
router.use('/api', express.json({ limit: '1mb' }));

// Landing page
router.get('/', ctrl.renderLanding);
router.get('/good', ctrl.renderGoodGallery);
if (!BULK_DISABLED) {
  router.get('/bulk', ctrl.renderBulkLanding);
  router.get('/bulk/new', ctrl.renderBulkCreate);
  router.get('/bulk/:id/score', ctrl.renderBulkScoring);
  router.get('/bulk/:id/slideshow', ctrl.renderBulkSlideshow);
  router.get('/bulk/:id/analytics', ctrl.renderBulkAnalytics);
  router.get('/bulk/:id', ctrl.renderBulkJob);
} else {
  router.get('/bulk*', (_req, res) => res.status(503).send('Bulk image generation is temporarily disabled.'));
}

// API proxy endpoints (browser talks to these; server talks to Comfy API)
router.get('/api/health', ctrl.health);
router.get('/api/instances', ctrl.listInstances);
router.get('/api/workflows', ctrl.getWorkflows);
router.get('/api/workflows/:name', ctrl.getWorkflowDetail);
router.post('/api/generate', ctrl.generate);
router.get('/api/jobs/:id', ctrl.getJob);
router.get('/api/jobs/:id/files/:index', ctrl.getJobFile);
router.get('/api/jobs/:id/images/:index', ctrl.getJobImage); // legacy alias
router.get('/api/files/:bucket', ctrl.listFiles);
router.get('/api/files/:bucket/:filename', ctrl.getFile);
router.post('/api/files/input', upload.single('image'), ctrl.uploadInput);
router.post('/api/files/promote', ctrl.promoteCachedFile);
router.get('/api/prompts', ctrl.listPrompts);
router.post('/api/rate', ctrl.rateJob);
router.get('/api/good-images', ctrl.listGoodImages);
if (!BULK_DISABLED) {
  router.get('/api/bulk/jobs', ctrl.listBulkJobs);
  router.post('/api/bulk/jobs', ctrl.createBulkJob);
  router.get('/api/bulk/jobs/:id', ctrl.getBulkJob);
  router.patch('/api/bulk/jobs/:id/status', ctrl.updateBulkJobStatus);
  router.get('/api/bulk/jobs/:id/prompts', ctrl.listBulkTestPrompts);
  router.get('/api/bulk/jobs/:id/matrix', ctrl.getBulkMatrix);
  router.get('/api/bulk/jobs/:id/gallery', ctrl.listBulkGalleryImages);
  router.get('/api/bulk/jobs/:id/analytics', ctrl.getBulkAnalytics);
  router.get('/api/bulk/jobs/:id/score-pair', ctrl.getBulkScorePair);
  router.post('/api/bulk/jobs/:id/score', ctrl.submitBulkScore);
  router.post('/api/bulk/jobs/:id/gallery/rate', ctrl.submitBulkGalleryRating);
  router.get('/api/bulk/jobs/:id/slideshow/next', ctrl.getBulkSlideshowItem);
  router.post('/api/bulk/jobs/:id/slideshow/rate', ctrl.submitBulkSlideshowRating);
} else {
  router.use('/api/bulk', (_req, res) => res.status(503).json({ error: 'bulk generation temporarily disabled' }));
}

module.exports = router;
