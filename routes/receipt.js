const express = require('express');
const router = express.Router();

const path = require('path');
const multer = require('multer');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './tmp_data/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + extension);
  }
});
const upload = multer({ storage: storage });

// Require controller modules.
const controller = require('../controllers/receiptcontroller');

/* GET home page. */
router.get('/', controller.receipt);
router.post('/upload_receipt', upload.array('imgs'), controller.upload_receipt);
router.post('/view_receipt/:id', controller.view_receipt);
router.post('/correct_receipt/:id', controller.correct_receipt);
router.post('/delete_receipt/:id', controller.delete_receipt);

module.exports = router;
