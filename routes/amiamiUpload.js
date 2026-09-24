const express = require('express');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const Role = require('../models/role');
const logger = require('../utils/logger');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { IMPORT, ROLE_BUNDLES, MAX_HTML_BYTES, AmiAmiUploadError } = require('../utils/amiamiUploadPolicy');

function createAmiAmiUploadRouter(service, { roleModel = Role, appLogger = logger } = {}) {
  const router = express.Router();
  const csrf = createSessionCsrf({ appLogger });
  const upload = multer({ storage: multer.memoryStorage(), limits: {
    fileSize: MAX_HTML_BYTES, fieldSize: MAX_HTML_BYTES, files: 1, fields: 1, parts: 3,
  } }).single('file');
  router.use((req, res, next) => {
    res.set({
      'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    if (!req.isAuthenticated?.() || !/^[a-f\d]{24}$/i.test(String(req.user?._id || ''))) {
      return res.status(401).json({ error: 'Sign in to use the import tool.' });
    }
    next();
  });
  router.use(createRequireCapabilities({ capabilities: [IMPORT], roleModel, roleCapabilityBundles: ROLE_BUNDLES, logger: appLogger }));
  router.use(rateLimit({ windowMs: 60000, limit: 120, keyGenerator: req => String(req.user._id), standardHeaders: 'draft-8', legacyHeaders: false }));
  router.use(csrf.issueToken);
  router.get('/', (_req, res) => res.render('admin_amiami_upload'));
  router.get('/status', async (_req, res) => res.json({ job: await service.status() }));
  router.post('/', csrf.requireToken,
    rateLimit({ windowMs: 60000, limit: 5, keyGenerator: req => String(req.user._id), standardHeaders: 'draft-8', legacyHeaders: false,
      message: { error: 'Too many uploads. Wait a minute before trying again.' } }),
    (req, _res, next) => {
      if ((req.get('content-encoding') || 'identity') !== 'identity' || !req.is('multipart/form-data')) {
        return next(new AmiAmiUploadError('INVALID_UPLOAD', 'Submit an uncompressed HTML file or pasted HTML using the form.'));
      }
      upload(req, _res, error => next(error && !(error instanceof multer.MulterError)
        ? new AmiAmiUploadError('INVALID_UPLOAD', 'The HTML upload could not be read. Try uploading it again.') : error));
    }, async (req, res) => {
      try {
        if (Object.keys(req.body || {}).some(key => key !== 'html')
          || (req.body?.html !== undefined && typeof req.body.html !== 'string')) {
          throw new AmiAmiUploadError('INVALID_UPLOAD', 'Choose one HTML file or paste HTML.');
        }
        const pasted = req.body?.html || '';
        if (req.file && (pasted.trim() || !/\.html?$/i.test(req.file.originalname))) {
          throw new AmiAmiUploadError('INVALID_UPLOAD', 'Choose one .html/.htm file or paste HTML, not both.');
        }
        const html = req.file ? new TextDecoder('utf-8', { fatal: true }).decode(req.file.buffer) : pasted;
        const job = await service.submit(html, String(req.user._id));
        res.status(202).json({ job });
      } catch (error) {
        if (error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') {
          throw new AmiAmiUploadError('INVALID_ENCODING', 'Save the HTML file as UTF-8 text.');
        }
        throw error;
      } finally {
        req.file?.buffer?.fill(0);
        if (req.body) delete req.body.html;
      }
    });
  router.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
  router.use(async (error, _req, res, _next) => {
    let status = 503;
    let message = 'The import tool is temporarily unavailable. Please try again later.';
    if (error instanceof AmiAmiUploadError) {
      status = error.status;
      message = error.message;
    } else if (error instanceof multer.MulterError) {
      status = ['LIMIT_FILE_SIZE', 'LIMIT_FIELD_VALUE'].includes(error.code) ? 413 : 400;
      message = status === 413 ? 'HTML must be no larger than 2 MiB.' : 'Upload one HTML file or paste HTML.';
    }
    if (status === 503) {
      await appLogger.error('AmiAmi HTML import request failed', { category: 'amiami-upload' });
    }
    res.status(status).json({ error: message });
  });
  return router;
}

module.exports = { createAmiAmiUploadRouter };
