// routes/image_gen.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const ctrl = require('../controllers/image_gen.controller');

const router = express.Router();

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

// API proxy endpoints (browser talks to these; server talks to Comfy API)
router.get('/api/health', ctrl.health);
router.get('/api/workflows', ctrl.getWorkflows);
router.post('/api/generate', ctrl.generate);
router.get('/api/jobs/:id', ctrl.getJob);
router.get('/api/jobs/:id/images/:index', ctrl.getJobImage);
router.get('/api/files/:bucket', ctrl.listFiles);
router.get('/api/files/:bucket/:filename', ctrl.getFile);
router.post('/api/files/input', upload.single('image'), ctrl.uploadInput);
router.get('/api/prompts', ctrl.listPrompts);
router.post('/api/rate', ctrl.rateJob);

module.exports = router;