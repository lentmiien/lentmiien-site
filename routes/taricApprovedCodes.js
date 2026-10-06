const express = require('express');
const multer = require('multer');
const { fail } = require('../utils/taricContracts');
const { jsonBody, rejectCompression } = require('./taric');
const { MAX_BYTES } = require('../services/taric/approvedCodes');
// Mounted after the shared TARIC authentication, capability, rate and CSRF guards.
function createApprovedCodesRouter(registry) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 0, parts: 2 } }).single('file');
  const actor = req => String(req.user._id);
  router.get('/', (_req, res) => res.render('admin_taric_codes'));
  router.get('/data', async (req, res) => res.json(await registry.list(actor(req), req.query)));
  router.post('/imports', rejectCompression, (req, res, next) => upload(req, res, e => {
    if (e) { req.file?.buffer?.fill(0); return next(Object.assign(new Error('Upload rejected'), { status: 400, ...(e.code === 'LIMIT_FILE_SIZE' ? { type: 'entity.too.large' } : {}) })); }
    next();
  }), async (req, res) => {
    try {
      if (!req.file || !/\.csv$/i.test(req.file.originalname)) fail('IMPORT_INVALID');
      const expected = req.get('X-Import-Sha');
      if (expected !== undefined && !/^[a-f0-9]{64}$/.test(expected)) fail('IMPORT_INVALID');
      res.json(await registry.importCsv(actor(req), req.file.buffer, expected));
    } finally { req.file?.buffer?.fill(0); }
  });
  router.post('/:code', jsonBody('32kb'), async (req, res) => res.json(await registry.edit(actor(req), req.params.code, req.body)));
  return router;
}
module.exports = { createApprovedCodesRouter };
