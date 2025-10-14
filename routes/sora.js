const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const controller = require('../controllers/soracontroller');

const router = express.Router();

const tmpDir = path.resolve(__dirname, '..', 'tmp_data');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdir(tmpDir, { recursive: true }, (error) => {
      if (error) {
        cb(error, tmpDir);
      } else {
        cb(null, tmpDir);
      }
    });
  },
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    cb(null, `sora-input-${Date.now()}-${Math.round(Math.random() * 1e6)}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      req.fileValidationError = 'Only image files can be used as a reference.';
      cb(null, false);
    }
  },
});

router.get('/', controller.renderLanding);
router.get('/api/videos', controller.listVideos);
router.get('/api/categories', controller.listCategories);
router.post('/api/videos', (req, res, next) => {
  upload.single('inputImage')(req, res, (error) => {
    if (error) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Image file is too large (max 20 MB).' });
      }
      return next(error);
    }
    controller.startGeneration(req, res).catch(next);
  });
});
router.get('/api/videos/:id/status', controller.getVideoStatus);
router.patch('/api/videos/:id/rating', controller.updateRating);

module.exports = router;
