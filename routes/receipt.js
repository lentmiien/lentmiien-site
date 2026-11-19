const express = require('express');
const multer = require('multer');
const { isObjectIdOrHexString } = require('mongoose');
const { rateLimit } = require('express-rate-limit');
const Role = require('../models/role');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf, PRIVATE_NO_STORE } = require('../middleware/sessionCsrf');
const controller = require('../controllers/receiptcontroller');

const router = express.Router();
const csrf = createSessionCsrf();
const READ = 'finance.receipt.read';
const WRITE = 'finance.receipt.write';
const roleCapabilityBundles = { admin: [READ, WRITE], family: [], user: [] };
const requireCap = capability => createRequireCapabilities({ capabilities: [capability], roleModel: Role, roleCapabilityBundles });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10, fields: 12, fieldSize: 64 * 1024, parts: 23 },
}).array('imgs', 10);
const throttle = rateLimit({ windowMs: 60000, limit: 10, keyGenerator: req => String(req.user._id),
  standardHeaders: 'draft-8', legacyHeaders: false });
let receiving = 0;

router.use((req, res, next) => {
  res.set('Cache-Control', PRIVATE_NO_STORE);
  res.locals.gtag = false;
  if (!isObjectIdOrHexString(req.user?._id)) return res.sendStatus(403);
  next();
}, csrf.issueToken);
router.get('/mappings', controller.mapping_rules_page);
router.post('/mappings', controller.create_mapping_rule);
router.get('/mappings/:id/edit', controller.edit_mapping_rule_page);
router.post('/mappings/:id', controller.update_mapping_rule);
router.post('/mappings/:id/priority', controller.update_mapping_rule_priority);
router.post('/mappings/:id/delete', controller.delete_mapping_rule);

router.use(requireCap(READ));
router.get('/', controller.receipt);
router.get('/history', controller.receipt_history);
router.get('/scan/:id', controller.receipt_scan);
router.get('/add-entry/:id', controller.receipt_entry_form);
router.post('/add-entry/:id', requireCap(WRITE), csrf.requireToken, controller.submit_receipt_entry);
router.get('/view_receipt/:id', controller.view_receipt);
router.post('/correct_receipt/:id', requireCap(WRITE), csrf.requireToken, controller.correct_receipt);
router.post('/delete_receipt/:id', requireCap(WRITE), csrf.requireToken, controller.delete_receipt);

router.post('/upload_receipt', requireCap(WRITE), throttle,
  (req, res, next) => req.get('x-csrf-token') ? csrf.requireToken(req, res, next) : next(),
  async (req, res) => {
    const reject = (status, message) => req.accepts(['html', 'json']) === 'json'
      ? res.status(status).json({ error: message }) : res.status(status).send(message);
    if (!req.is('multipart/form-data')) return reject(415, 'Choose image files to upload.');
    const size = Number(req.get('content-length'));
    if (!Number.isSafeInteger(size) || size < 1) return reject(411, 'The upload must include its content length.');
    if (size > 64 * 1024 * 1024) return reject(413, 'Upload at most 64 MiB per batch.');
    if (receiving >= 2) return reject(429, 'Receipt uploads are busy. Try again shortly.');
    receiving++;
    try {
      try {
        await new Promise((resolve, rejectUpload) => upload(req, res, err => err ? rejectUpload(err) : resolve()));
      } catch {
        return reject(400, 'Invalid upload. Choose up to 10 images of at most 25 MiB each.');
      }
      // Native multipart forms supply the token as a field. Check it before
      // decoding, looking up a receipt, or invoking the extraction service.
      await csrf.requireToken(req, res, () => controller.upload_receipt(req, res));
    } finally {
      receiving--;
    }
  });

module.exports = router;
