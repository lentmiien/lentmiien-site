const express = require('express');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const Role = require('../models/role');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { MANAGE, ROLE_BUNDLES } = require('../utils/taricAuthorizationPolicy');
const { fail, object } = require('../utils/taricContracts');
const { sha, strictJson } = require('../utils/taricProtocol');
const { preview, MAX_IMPORT_BYTES } = require('../services/taric/importer');
const { privateResponse, errorHandler, rejectCompression, jsonBody } = require('./taric');
function createTaricAdminRouter(service, { roleModel = Role } = {}) {
  const router = express.Router(); const csrf = createSessionCsrf();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 1, fieldSize: 8192, parts: 2 } }).single('file');
  router.use(privateResponse, (_req, res, next) => {
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"); next();
  });
  router.use((req, res, next) => req.isAuthenticated?.() ? next() : res.status(401).json({ error: 'UNAUTHORIZED' }));
  router.use(createRequireCapabilities({ capabilities: [MANAGE], roleModel, roleCapabilityBundles: ROLE_BUNDLES }));
  router.use(rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
  router.use(csrf.issueToken);
  // Header CSRF before upload/body allocation, with the same shared session defense.
  router.use((req, res, next) => ['GET', 'HEAD'].includes(req.method) ? next() : csrf.requireToken(req, res, next));
  router.get('/', (req, res) => res.render('admin_taric', { user: req.user }));
  router.post('/test', jsonBody('4kb'), async (req, res) => {
    if (req.body.test !== true) fail('INVALID_REQUEST');
    const principal = await service.adminPrincipal(String(req.user._id));
    res.status(202).json(await service.submit(principal, require('./taric').uniqueHeader(req, 'idempotency-key'), req.body));
  });
  router.get('/test/:id', async (req, res) => {
    const principal = await service.adminPrincipal(String(req.user._id));
    res.json(await service.retrieve(principal, req.params.id));
  });
  router.post('/inference/resume', jsonBody('1kb'), async (req, res) => {
    object(req.body, ['confirmIdle'], 'INVALID_REQUEST');
    if (req.body.confirmIdle !== true) fail('INVALID_REQUEST');
    await service.resumeInference(); res.json({ ok: true });
  });
  router.get('/state', async (_req, res) => res.json(await service.readiness()));
  router.get('/adapters', async (_req, res) => res.json(await service.transport.adapters()));
  router.post('/credential/rotate', async (req, res) => {
    const secret = await service.rotate(String(req.user._id));
    // One response only. Never session flash, query parameter, log, or persistent UI state.
    res.json({ secret, expires_in_days: 90 });
  });
  router.post('/credential/revoke', async (_req, res) => { await service.revoke(); res.json({ ok: true }); });
  router.post('/config', jsonBody('256kb'), async (req, res) => { await service.saveConfig(req.body); res.json({ ok: true }); });
  router.post('/imports', rejectCompression, (req, res, next) => upload(req, res, e => e ? next(Object.assign(new Error('Upload rejected'), { status: e.code === 'LIMIT_FILE_SIZE' ? 413 : 400, type: e.code === 'LIMIT_FILE_SIZE' ? 'entity.too.large' : undefined })) : next()), async (req, res) => {
    if (!req.file || req.file.fieldname !== 'file' || !/\.csv$/i.test(req.file.originalname)) fail('IMPORT_INVALID');
    const meta = strictJson(req.body.metadata || '{}', 'IMPORT_INVALID');
    object(meta, ['action', 'version', 'review', 'expectedSha'], 'IMPORT_INVALID');
    try {
      if (meta.action === 'preview') return res.json((await preview(req.file.buffer)).manifest);
      if (meta.action !== 'import' || meta.expectedSha !== sha(req.file.buffer)) fail('IMPORT_INVALID');
      res.json(await service.importBenchmark(req.file.buffer, meta.version, meta.review, String(req.user._id)));
    } finally { req.file.buffer.fill(0); }
  });
  router.post('/benchmarks/:id/publish', async (req, res) => { await service.publish(req.params.id, String(req.user._id)); res.json({ ok: true }); });
  router.post('/benchmarks/:id/runs', jsonBody('4kb'), async (req, res) => {
    object(req.body, ['adapter'], 'INVALID_REQUEST');
    res.status(202).json(await service.queueRun(req.params.id, req.body.adapter, String(req.user._id)));
  });
  router.post('/runs/:id/cancel', async (req, res) => { await service.cancelRun(req.params.id); res.json({ ok: true }); });
  router.get('/inspect/:kind', async (req, res) => res.json(await service.inspect(req.params.kind, req.query.before)));
  router.get('/inspect/:kind/:id', async (req, res) => res.json(await service.detail(req.params.kind, req.params.id, Number(req.query.offset || 0))));
  router.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  router.use(errorHandler);
  return router;
}
module.exports = { createTaricAdminRouter };
