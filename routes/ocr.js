const express = require('express');
const multer = require('multer');
const controller = require('../controllers/ocrcontroller');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { MODEL_TEST_CAPABILITY, capabilityOptions, canTestModels } = require('../utils/ocrAuthorization');
const { rateLimit } = require('express-rate-limit');

const router = express.Router();
const csrf = createSessionCsrf();
const requireModelTesting = createRequireCapabilities({ capabilities: [MODEL_TEST_CAPABILITY], ...capabilityOptions });
router.use(async (req, res, next) => {
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.locals.gtag = false;
  if (!req.user) return res.status(401).json({ error: 'Login required.' });
  try {
    req.ocrCanTestModels = await canTestModels(req.user);
    return next();
  } catch (error) { return next(error); }
});
router.use(csrf.issueToken);
const MAX_FILES_PER_JOB = Math.min(5, Math.max(1, Number(process.env.OCR_JOB_MAX_FILES) || 5));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB per file
    files: MAX_FILES_PER_JOB,
    fields: 12,
    fieldSize: 16 * 1024,
    parts: MAX_FILES_PER_JOB + 12,
  },
});

router.get('/', controller.renderTool);
router.get('/jobs', controller.listJobs);
router.get('/jobs/:jobId/view{/:fileId}', controller.renderJobPage);
router.get('/jobs/:jobId', controller.getJobDetails);
router.get('/jobs/:jobId/files/:fileId/preview', requireModelTesting, controller.servePreview);
const submissionLimit = rateLimit({ windowMs: 60000, limit: 10, keyGenerator: req => String(req.user._id || req.user.name), standardHeaders: 'draft-8', legacyHeaders: false });
let activeUploads = 0;
const boundUploads = (req, res, next) => {
  if (activeUploads >= 2) return res.status(429).json({ error: 'Uploads are busy. Please try again shortly.' });
  activeUploads += 1;
  let released = false;
  const release = () => { if (!released) { released = true; activeUploads -= 1; } };
  res.once('finish', release);
  res.once('close', release);
  next();
};
router.post('/jobs', csrf.requireToken, submissionLimit, boundUploads, (req, res, next) => {
  upload.array('images', MAX_FILES_PER_JOB)(req, res, error => {
    if (error) return res.status(400).json({ error: 'Invalid upload or upload limits exceeded.' });
    if (req.body.model && req.body.model !== 'hunyuanocr') return requireModelTesting(req, res, next);
    return next();
  });
}, controller.enqueueJob);
router.post('/jobs/:jobId/files/:fileId/embed-high-quality', csrf.requireToken, controller.embedFileHighQuality);
router.patch('/jobs/:jobId/files/:fileId', csrf.requireToken, controller.updateFileResult);
router.delete('/jobs/:jobId', csrf.requireToken, controller.deleteJob);

module.exports = router;
