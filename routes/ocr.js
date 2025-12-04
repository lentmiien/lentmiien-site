const express = require('express');
const multer = require('multer');
const controller = require('../controllers/ocrcontroller');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB guardrail
  },
});

router.get('/', controller.renderTool);
router.post('/', upload.single('image'), controller.handleOcr);

module.exports = router;
