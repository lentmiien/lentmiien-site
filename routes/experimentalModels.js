const express = require('express');
const multer = require('multer');
const { randomUUID } = require('crypto');
const { rateLimit } = require('express-rate-limit');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { CAPABILITY, BUNDLES, ID, LIMITS, LabError, fail } = require('../services/experimentalModels/policy');
const registry = require('../services/experimentalModels/registry');
const logger = require('../utils/logger');

function createRouter({ store = require('../services/experimentalModels') } = {}) {
  const router = express.Router();
  const csrf = createSessionCsrf();
  let receivingUpload = false;
  let downloads = 0;
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    res.locals.gtag = false;
    if (!req.isAuthenticated?.() || !/^[a-f0-9]{24}$/.test(String(req.user?._id))) return res.status(401).json({ error: 'Login required.' });
    if (req.user.type_user !== 'admin') return res.status(403).json({ error: 'Administrator access required.' });
    next();
  });
  router.use(createRequireCapabilities({ capabilities: [CAPABILITY], roleCapabilityBundles: BUNDLES }));
  router.use(csrf.issueToken);
  router.use((req, res, next) => {
    if (!req.session) return res.status(503).json({ error: 'Browser session unavailable.' });
    // This opaque binding is never sent to the browser or used as a bearer token.
    if (['GET', 'HEAD'].includes(req.method) && !ID.test(req.session.experimentalModelsBinding || '')) req.session.experimentalModelsBinding = randomUUID();
    req.labOwner = String(req.user._id);
    req.labBinding = req.session.experimentalModelsBinding;
    if (Object.keys(req.query).length) fail('invalid_request', 400, 'Query parameters are not supported.');
    next();
  });
  router.get('/', (req, res) => res.render('admin_experimental_models', { pageTitle: 'Experimental Models', experiments: registry.listExperiments() }));
  router.use('/api', rateLimit({ windowMs: 60000, limit: 120, keyGenerator: req => req.labOwner, standardHeaders: 'draft-8', legacyHeaders: false }));
  router.get('/api/experiments', (_req, res) => res.json({ stage: 'foundation', experiments: registry.listExperiments(), limits: LIMITS }));
  router.get('/api/sessions', async (req, res) => res.json({ sessions: await store.list(req.labOwner, req.labBinding) }));
  router.get('/api/sessions/:id', async (req, res) => res.json(await store.get(req.labOwner, req.labBinding, req.params.id)));
  router.get('/api/sessions/:id/files/:fileId', async (req, res, next) => {
    if (downloads >= 2) fail('download_busy', 429, 'Download limit reached. Retry shortly.');
    downloads += 1;
    let handle, stream;
    try {
      const download = await store.download(req.labOwner, req.labBinding, req.params.id, req.params.fileId);
      handle = download.handle;
      const { asset } = download;
      res.set({ 'Content-Type': asset.mime, 'Content-Disposition': `attachment; filename="test-image-${asset.id}.png"`,
        'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Length': String(asset.bytes) });
      if (req.method === 'HEAD' || res.destroyed) { await handle.close(); handle = null; return res.end(); }
      stream = handle.createReadStream({ autoClose: true });
      res.setTimeout(30000, () => res.destroy());
      stream.once('close', () => { downloads -= 1; });
      stream.once('error', next);
      res.once('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) { if (handle && !stream) await handle.close(); throw error; }
    finally { if (!stream) downloads -= 1; }
  });
  router.use('/api', (req, res, next) => ['GET', 'HEAD'].includes(req.method) ? next() : csrf.requireToken(req, res, next));
  router.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && !ID.test(req.labBinding || '')) fail('reload_required', 409, 'Reload the lab before creating test data.');
    next();
  });
  const mutations = rateLimit({ windowMs: 60000, limit: 12, keyGenerator: req => req.labOwner, standardHeaders: 'draft-8', legacyHeaders: false });
  function noBody(req, _res, next) {
    if (req.get('transfer-encoding') || Number(req.get('content-length') || 0) !== 0) fail('invalid_request', 400, 'This operation takes no request body.');
    next();
  }
  router.post('/api/sessions', mutations, noBody, async (req, res) => res.status(201).json(await store.create(req.labOwner, req.labBinding)));
  router.delete('/api/sessions/:id', mutations, noBody, async (req, res) => {
    await store.clear(req.labOwner, req.labBinding, req.params.id);
    res.json({ deleted: true });
  });
  const upload = multer({ storage: multer.memoryStorage(), preservePath: true,
    limits: { fileSize: LIMITS.fileBytes, files: 1, fields: 0, parts: 1, fieldNameSize: 40, headerPairs: 20 } }).single('file');
  router.post('/api/sessions/:id/files', mutations, async (req, res) => {
    await store.get(req.labOwner, req.labBinding, req.params.id); // Ownership before allocating upload memory.
    if (receivingUpload) fail('upload_busy', 429, 'Another upload is being processed. Retry shortly.');
    const length = Number(req.get('content-length'));
    if (!Number.isSafeInteger(length) || length <= 0 || req.get('transfer-encoding')) fail('length_required', 411, 'A bounded Content-Length is required.');
    if (length > LIMITS.fileBytes + 8192) fail('file_limit', 413, 'Upload exceeds 8 MiB.');
    if (!req.is('multipart/form-data')) fail('invalid_type', 415, 'Upload one multipart image file.');
    receivingUpload = true;
    try {
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = error => {
          if (settled) return;
          settled = true; clearTimeout(timer); req.off('aborted', aborted);
          error ? reject(error) : resolve();
        };
        const aborted = () => finish(new LabError('upload_interrupted', 400, 'Upload interrupted.'));
        const timer = setTimeout(() => { finish(new LabError('upload_timeout', 408, 'Upload timed out.')); req.destroy(); }, 30000);
        req.once('aborted', aborted);
        upload(req, res, finish);
      });
      if (req.aborted) fail('upload_interrupted', 400, 'Upload interrupted.');
      res.status(201).json(await store.upload(req.labOwner, req.labBinding, req.params.id, req.file));
    } finally { if (req.file) req.file.buffer = undefined; receivingUpload = false; }
  });
  // A fail-closed seam, not a simulated inference endpoint. No request fields or
  // provider paths are accepted before a verified adapter can validate them.
  router.post('/api/sessions/:id/experiments/:experimentId/runs', mutations, noBody, async (req, _res) => {
    await store.get(req.labOwner, req.labBinding, req.params.id);
    registry.requireAdapter(req.params.experimentId);
  });
  router.use((_req, res) => res.status(404).json({ error: 'Lab route not found.' }));
  router.use((error, req, res, _next) => {
    const status = error instanceof LabError ? error.status : error instanceof multer.MulterError ? 413 : 503;
    if (status >= 500 && error.code !== 'contract_pending') logger.error('Experimental Models operation failed; check private storage permissions and disk space', { category: 'experimental_models', metadata: { status } });
    if (res.headersSent) return res.destroy();
    if (!res.destroyed) res.status(status).json({ code: error instanceof LabError ? error.code : 'lab_unavailable',
      error: error instanceof LabError ? error.message : status === 413 ? 'Upload exceeds file or part limits.' : 'Test storage unavailable. Check application diagnostics.' });
  });
  return router;
}
module.exports = { createRouter };
