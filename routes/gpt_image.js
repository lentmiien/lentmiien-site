const express = require('express');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const controller = require('../controllers/gptImageController');
const logger = require('../utils/logger');
const { MAX_UPLOAD_IMAGE_COUNT, MAX_UPLOAD_FILE_SIZE_BYTES } = require('../services/gptImageService');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { GPT_IMAGE_CAPABILITIES, gptImageRoleBundles } = require('../utils/gptImageAuthorizationPolicy');

const router = express.Router();
const csrf = createSessionCsrf();
router.use((req, res, next) => {
  res.set({ 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive' });
  res.locals.gtag = false;
  if (!req.isAuthenticated?.() || !req.user) return res.status(401).json({ ok: false, error: 'Login required.' });
  return next();
});
function requireCapability(capability) {
  return (req, res, next) => createRequireCapabilities({
    capabilities: [capability], roleCapabilityBundles: gptImageRoleBundles(req.user),
  })(req, res, next);
}
router.use(requireCapability(GPT_IMAGE_CAPABILITIES.read));
router.get('/media/:fileName', controller.serveMedia);
router.use(csrf.issueToken);
router.use('/api', express.json({ limit: '512kb' }));
const mutationLimit = rateLimit({ windowMs: 60 * 1000, limit: 30, keyGenerator: req => String(req.user._id || req.user.name), standardHeaders: 'draft-8', legacyHeaders: false });
const generationLimit = rateLimit({ windowMs: 60 * 1000, limit: 5, keyGenerator: req => String(req.user._id || req.user.name), standardHeaders: 'draft-8', legacyHeaders: false });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE_BYTES, files: MAX_UPLOAD_IMAGE_COUNT, fields: 35, fieldSize: 128 * 1024, parts: 43 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Only PNG, JPEG, and WebP images are supported.'), ok);
  },
});
// Bound multipart memory even before generation-service concurrency is acquired.
let activeUploads = 0;
function boundUploads(req, res, next) {
  if (activeUploads >= 2) return res.status(429).json({ ok: false, error: 'Image generation is busy. Please try again shortly.' });
  activeUploads += 1;
  let released = false;
  const release = () => { if (!released) { released = true; activeUploads -= 1; } };
  res.once('finish', release);
  res.once('close', release);
  return next();
}
router.get('/', controller.renderIndex);
router.post('/api/generate', requireCapability(GPT_IMAGE_CAPABILITIES.generate), csrf.requireToken, generationLimit, boundUploads, (req, res) => {
  upload.array('inputImages', MAX_UPLOAD_IMAGE_COUNT)(req, res, error => {
    if (error) return res.status(400).json({ ok: false, error: 'Invalid image upload or upload limits exceeded.' });
    return controller.generate(req, res);
  });
});
router.post('/api/images/:id/like', requireCapability(GPT_IMAGE_CAPABILITIES.like), csrf.requireToken, mutationLimit, controller.toggleLike);
router.use((error, _req, res, _next) => {
  const status = error.status >= 400 && error.status < 500 ? error.status : 500;
  if (status === 500) logger.error('Unhandled GPT Image request failure', {
    category: 'gpt_image', metadata: { code: error.code || 'UNKNOWN' },
  });
  return res.status(status).json({ ok: false, error: status === 500 ? 'Unable to process the image request.' : 'Invalid image request.' });
});
module.exports = router;
