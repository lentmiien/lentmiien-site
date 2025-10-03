const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const router = express.Router();

const controller = require('../controllers/tmpfilescontroller');

const TMP_DIR = path.join(__dirname, '../tmp_data');

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function sanitizeFilename(filename) {
  const base = path.basename(filename);
  const safe = base
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  const withoutSeparator = safe.split(controller.FILE_NAME_SEPARATOR).join('_');
  const withoutLeadingDot = withoutSeparator.replace(/^\.+/, '');
  const trimmed = withoutLeadingDot.replace(/^_+/, '').replace(/_+$/, '');
  return trimmed.length ? trimmed : 'upload';
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TMP_DIR);
  },
  filename: (req, file, cb) => {
    const sanitized = sanitizeFilename(file.originalname);
    const stamped = `${Date.now()}${controller.FILE_NAME_SEPARATOR}${sanitized}`;
    cb(null, stamped);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: controller.MAX_FILE_SIZE_BYTES }
});

router.get('/', controller.renderPage);
router.get('/files', controller.listFiles);
router.get('/download/:fileName', controller.downloadFile);

router.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'File exceeds 10MB limit.' });
        }
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: 'Failed to process upload.' });
    }

    controller.uploadFile(req, res);
  });
});

module.exports = router;