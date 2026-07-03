const express = require('express');
const router = express.Router();

const path = require('path');
const multer = require('multer');
const MAX_UPLOAD_FILE_SIZE = 25 * 1024 * 1024;
const MAX_UPLOAD_FILES = 10;
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
const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_UPLOAD_FILE_SIZE,
    files: MAX_UPLOAD_FILES,
  },
});

// Require controller modules.
const controller = require('../controllers/receiptcontroller');

/* GET home page. */
router.get('/', controller.receipt);
router.get('/history', controller.receipt_history);
router.get('/mappings', controller.mapping_rules_page);
router.post('/mappings', controller.create_mapping_rule);
router.get('/mappings/:id/edit', controller.edit_mapping_rule_page);
router.post('/mappings/:id', controller.update_mapping_rule);
router.post('/mappings/:id/priority', controller.update_mapping_rule_priority);
router.post('/mappings/:id/delete', controller.delete_mapping_rule);
router.get('/add-entry/:id', controller.receipt_entry_form);
router.post('/add-entry/:id', controller.submit_receipt_entry);
router.post('/upload_receipt', upload.array('imgs'), controller.upload_receipt);
router.get('/view_receipt/:id', controller.view_receipt);
router.post('/correct_receipt/:id', controller.correct_receipt);
router.get('/delete_receipt/:id', controller.delete_receipt);

module.exports = router;
