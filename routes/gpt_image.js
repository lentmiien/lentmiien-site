const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const controller = require('../controllers/gptImageController');
const { MAX_UPLOAD_IMAGE_COUNT, MAX_UPLOAD_FILE_SIZE_BYTES } = require('../services/gptImageService');

const router = express.Router();
const TMP_DIR = path.join(__dirname, '../tmp_data');

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TMP_DIR),
  filename: (_req, file, cb) => {
    const safeBase = path.basename(file.originalname || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeBase}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
    files: MAX_UPLOAD_IMAGE_COUNT,
  },
  fileFilter: (_req, file, cb) => {
    const ok = /image\/(png|jpe?g|webp)/i.test(file.mimetype);
    cb(ok ? null : new Error('Only PNG, JPEG, and WebP images are supported.'), ok);
  },
});

router.use('/api', express.json({ limit: '512kb' }));

router.get('/', controller.renderIndex);
router.post('/api/generate', (req, res) => {
  upload.array('inputImages', MAX_UPLOAD_IMAGE_COUNT)(req, res, (error) => {
    if (error) {
      const status = error instanceof multer.MulterError ? 400 : 400;
      return res.status(status).json({
        ok: false,
        error: error.message || 'Failed to process uploaded images.',
      });
    }
    return controller.generate(req, res);
  });
});
router.post('/api/images/:id/like', controller.toggleLike);

module.exports = router;
