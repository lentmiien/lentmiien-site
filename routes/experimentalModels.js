const express = require('express');
const multer = require('multer');
const { randomUUID } = require('crypto');
const { rateLimit } = require('express-rate-limit');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { CAPABILITY, BUNDLES, ID, LIMITS, LabError, fail } = require('../services/experimentalModels/policy');
const registry = require('../services/experimentalModels/registry');
const { referenceError } = require('../services/experimentalModels/referenceDiagnostics');
const logger = require('../utils/logger');
const { LabJobs } = require('../services/experimentalModels/jobs');
const { strictJson } = require('../utils/taricProtocol');
const { dispatchAuthorization } = require('../services/experimentalModels/authorization');

function createRouter({ store = require('../services/experimentalModels'), gateway, jobs = new LabJobs({ store, gateway }), authorize = dispatchAuthorization } = {}) {
  const router = express.Router();
  const csrf = createSessionCsrf();
  let receivingUpload = false;
  let downloads = 0;
  let warningWindow = 0, warningCount = 0;
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
  router.get('/', (req, res) => {
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    return res.render('admin_experimental_models', { pageTitle: 'Experimental Models', experiments: registry.listExperiments() });
  });
  router.use('/api', rateLimit({ windowMs: 60000, limit: 120, keyGenerator: req => req.labOwner, standardHeaders: 'draft-8', legacyHeaders: false }));
  router.get('/api/experiments', (_req, res) => res.json({ stage: 'implemented', experiments: registry.listExperiments(), limits: LIMITS }));
  router.get('/api/experiments/:experimentId/capabilities', async (req, res) => {
    registry.requireAdapter(req.params.experimentId);
    res.json(await jobs.gateway.capabilities(req.params.experimentId));
  });
  router.get('/api/sessions/:id/jobs/:jobId', async (req, res) => res.json(await store.job(req.labOwner, req.labBinding, req.params.id, req.params.jobId)));
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
      res.set({ 'Content-Type': asset.mime, 'Content-Disposition': `attachment; filename="experiment-${asset.id}.${({ 'image/png': 'png', 'audio/wav': 'wav', 'application/json': 'json' })[asset.mime]}"`,
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
    const result = await store.clear(req.labOwner, req.labBinding, req.params.id);
    res.status(result.deleted ? 200 : 202).json(result);
  });
  function uploadRoute(reference) {
    const maxBytes = reference ? LIMITS.referenceBytes : LIMITS.fileBytes;
    const upload = multer({ storage: multer.memoryStorage(), preservePath: true,
      limits: { fileSize: maxBytes, files: 1, fields: 0, parts: 1, fieldNameSize: 40, headerPairs: 20 } }).single('file');
    return async (req, res) => {
      req.labReferenceUpload = reference;
      req.labRequestId = randomUUID();
      await store.exclusive(async () => { store.owned(req.labOwner, req.labBinding, req.params.id); }); // Deny closing sessions before allocating memory.
      if (receivingUpload) fail('upload_busy', 429, 'Another upload is being processed. Retry shortly.');
      const length = Number(req.get('content-length'));
      if (!Number.isSafeInteger(length) || length <= 0 || req.get('transfer-encoding')) fail('length_required', 411, 'A bounded Content-Length is required.');
      if (length > maxBytes + 8192) {
        if (reference) throw referenceError('size');
        fail('file_limit', 413, 'Upload exceeds 8 MiB.');
      }
      if (!req.is('multipart/form-data')) fail('invalid_type', 415, 'Upload one multipart file.');
      receivingUpload = true;
      try {
        await new Promise((resolve, reject) => {
          let settled = false;
          const finish = error => {
            if (settled) return;
            settled = true; clearTimeout(timer); req.off('aborted', aborted);
            error ? reject(error) : resolve();
          };
          const aborted = () => finish(reference ? referenceError('interrupted') : new LabError('upload_interrupted', 400, 'Upload interrupted.'));
          const timer = setTimeout(() => { finish(reference ? referenceError('timeout') : new LabError('upload_timeout', 408, 'Upload timed out.')); req.destroy(); }, 30000);
          req.once('aborted', aborted);
          upload(req, res, finish);
        });
        if (req.aborted) {
          if (reference) throw referenceError('interrupted');
          fail('upload_interrupted', 400, 'Upload interrupted.');
        }
        res.status(201).json(await store.upload(req.labOwner, req.labBinding, req.params.id, req.file, reference));
      } finally { if (req.file) req.file.buffer = undefined; receivingUpload = false; }
    };
  }
  router.post('/api/sessions/:id/files', mutations, uploadRoute(false));
  router.post('/api/sessions/:id/references', mutations, uploadRoute(true));
  const jsonParser = express.raw({ type: 'application/json', limit: 16384, inflate: false });
  const jsonBody = (req, res, next) => {
    const timer = setTimeout(() => { req.destroy(); }, 30000); timer.unref?.();
    jsonParser(req, res, error => {
      clearTimeout(timer);
      if (error) return next(error);
      try {
        req.body = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(req.body));
        next();
      } catch (_) { next(new LabError('invalid_request', 400, 'Use valid UTF-8 JSON with unique keys.')); }
    });
  };
  router.post('/api/sessions/:id/experiments/:experimentId/runs', mutations, async (req, res, next) => {
    await store.get(req.labOwner, req.labBinding, req.params.id);
    registry.requireAdapter(req.params.experimentId);
    const length = Number(req.get('content-length'));
    if (!Number.isSafeInteger(length) || length < 1 || req.get('transfer-encoding')) fail('invalid_request', 400, 'A bounded JSON request body is required.');
    if (length > 16384) fail('body_limit', 413, 'Task request exceeds 16 KiB.');
    if (!req.is('application/json')) fail('invalid_type', 415, 'Use application/json.');
    next();
  }, jsonBody, async (req, res) => {
    const job = await jobs.submit(req.labOwner, req.labBinding, req.params.id, req.params.experimentId, req.body, authorize(req));
    res.status(202).json(job);
  });
  router.use((_req, res) => res.status(404).json({ error: 'Lab route not found.' }));
  router.use((error, req, res, _next) => {
    if (req.labReferenceUpload && error instanceof multer.MulterError) error = referenceError(error.code === 'LIMIT_FILE_SIZE' ? 'size' : 'parts');
    const status = error instanceof LabError ? error.status : error instanceof multer.MulterError || error.type === 'entity.too.large' ? 413 : ['entity.parse.failed', 'encoding.unsupported'].includes(error.type) ? 400 : 503;
    if (status >= 500) logger.error('Experimental Models operation failed; check Gateway configuration or private storage', { category: 'experimental_models', metadata: { status } });
    if (status >= 400 && status < 500 && error.diagnostic) {
      if (Date.now() - warningWindow >= 60000) { warningWindow = Date.now(); warningCount = 0; }
      if (warningCount++ < 12) logger.warning('Experimental Models reference rejected; check the reported input requirement', {
        category: 'experimental_models', metadata: { status, code: error.code, ...error.diagnostic, requestId: req.labRequestId || randomUUID() } });
    }
    if (res.headersSent) return res.destroy();
    if (error.safeHeaders?.['Retry-After']) res.set('Retry-After', error.safeHeaders['Retry-After']);
    if (!res.destroyed) res.status(status).json({ status, ...(error.diagnostic || {}), ...(req.labRequestId ? { requestId: req.labRequestId } : {}), code: error instanceof LabError ? error.code : 'lab_unavailable',
      error: error instanceof LabError ? error.message : status === 413 ? 'Request exceeds file or body limits.' : status === 400 ? 'Invalid request body.' : 'Lab unavailable. Check application diagnostics.' });
  });
  return router;
}
module.exports = { createRouter };
