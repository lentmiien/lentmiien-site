const express = require('express');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { hasCapabilities } = require('../utils/authorization');
const { config } = require('../services/embeddingGemma2/config');
const { PilotService } = require('../services/embeddingGemma2/service');
const { input, fail, PilotError } = require('../services/embeddingGemma2/contract');
const logger = require('../utils/logger');
const CAPABILITY = 'embeddinggemma2.pilot.manage';
const BUNDLES = { admin: [CAPABILITY], family: [], user: [] };
const ID = /^[a-f0-9]{24}$/;
const SAFE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'audio/wav', 'audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/mp4', 'video/mp4', 'video/quicktime', 'audio/webm', 'video/webm', 'audio/x-matroska', 'video/x-matroska']);
async function refreshAuthorization(req) {
  const stored = await new Promise((resolve, reject) => req.sessionStore.get(req.sessionID, (error, session) => error ? reject(error) : resolve(session)));
  if (!stored || String(stored.passport?.user) !== String(req.user._id) || (stored.cookie?.expires && new Date(stored.cookie.expires) <= new Date())) fail('Session expired. Log in again.', 401);
  const user = await require('../database').UseraccountModel.findById(req.user._id).select('_id name type_user').maxTimeMS(5000).lean();
  if (!await hasCapabilities(user, [CAPABILITY], { roleCapabilityBundles: BUNDLES })) fail('Pilot access was revoked.', 403);
}
function createRouter({ service, settings, reauthorize = refreshAuthorization } = {}) {
  const router = express.Router();
  let configurationError = false;
  try { settings = settings || config(); service = service || new PilotService(settings); }
  catch (_) { configurationError = true; logger.error('EmbeddingGemma2 configuration invalid; playground disabled', { category: 'embeddinggemma2' }); }
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    res.locals.gtag = false;
    if (!req.isAuthenticated?.() || !ID.test(String(req.user?._id))) return res.status(401).json({ error: 'Login required.' });
    next();
  });
  // No role-model grants here: this capability is deliberately restricted to the admin bundle.
  router.use(createRequireCapabilities({ capabilities: [CAPABILITY], roleCapabilityBundles: BUNDLES }));
  const csrf = createSessionCsrf();
  router.use(csrf.issueToken);
  router.use((req, res, next) => {
    if (configurationError || !settings.enabled) return res.status(503).json({ error: 'EmbeddingGemma2 playground is disabled or misconfigured.' });
    next();
  });
  router.get('/', (req, res) => res.render('admin_embeddinggemma2', { pageTitle: 'EmbeddingGemma2 playground', user: req.user, limits: settings }));
  router.use('/api', rateLimit({ windowMs: 60000, limit: 120, keyGenerator: req => String(req.user._id), standardHeaders: 'draft-8', legacyHeaders: false }));
  router.get('/api/records', async (req, res) => {
    if (Object.keys(req.query).some(k => k !== 'before') || (req.query.before !== undefined && !ID.test(req.query.before))) fail('Invalid page cursor.');
    res.json(await service.list(req.user._id, req.query.before));
  });
  router.get('/api/records/:id/media', async (req, res, next) => {
    if (!ID.test(req.params.id) || Object.keys(req.query).length) fail('Record not found.', 404);
    const { handle, stat, mime } = await service.media(req.user._id, req.params.id);
    try {
      if (!SAFE_MIMES.has(mime)) throw new Error('Unsafe stored media type');
      res.set({ 'Content-Type': mime, 'Content-Disposition': 'inline; filename="pilot-media"', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Accept-Ranges': 'bytes' });
      let start = 0; let end = stat.size - 1;
      const range = req.get('range');
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) { await handle.close(); return res.status(416).set('Content-Range', `bytes */${stat.size}`).end(); }
        start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size || (!match[1] && Number(match[2]) === 0)) { await handle.close(); return res.status(416).set('Content-Range', `bytes */${stat.size}`).end(); }
        res.status(206).set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      }
      res.set('Content-Length', String(end - start + 1));
      if (req.method === 'HEAD') { await handle.close(); return res.end(); }
      const stream = handle.createReadStream({ start, end, autoClose: true });
      res.on('close', () => stream.destroy());
      stream.on('error', next);
      stream.pipe(res);
    } catch (error) { await handle.close(); throw error; }
  });
  const mutations = rateLimit({ windowMs: 60000, limit: 6, keyGenerator: req => String(req.user._id), standardHeaders: 'draft-8', legacyHeaders: false });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8388608, files: 1, fields: 5, parts: 6, fieldSize: 65536, fieldNameSize: 40, headerPairs: 50 } }).single('file');
  const json = express.json({ limit: '64kb', strict: true });
  async function operation(req, res, search, deleting = false) {
    if (Object.keys(req.query).length || (deleting && !ID.test(req.params.id))) fail('Invalid request.');
    if (deleting && (Number(req.get('content-length') || 0) !== 0 || req.get('transfer-encoding'))) fail('Delete requests take no body.');
    const lease = await service.acquire();
    let uncertain = false;
    try {
      await service.reconcile(lease);
      if (deleting) {
        await reauthorize(req);
        await service.remove(req.user._id, req.params.id, lease);
        return res.json({ ok: true });
      }
      const length = Number(req.get('content-length'));
      if (!Number.isSafeInteger(length) || length <= 0) fail('Content-Length is required.', 411);
      if (length > 8388608 + 65536) fail('Request exceeds upload limit.', 413);
      const multipart = req.is('multipart/form-data');
      if (!multipart && !req.is('application/json')) fail('Use JSON text or one multipart media file.', 415);
      if (!multipart && length > 65536) fail('Text request exceeds 64 KiB.', 413);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { reject(new PilotError('Upload exceeded 30 seconds.', 408)); req.destroy(); }, 30000);
        const aborted = () => { clearTimeout(timer); reject(new PilotError('Upload interrupted.', 499)); };
        req.once('aborted', aborted);
        (multipart ? upload : json)(req, res, error => { clearTimeout(timer); req.off('aborted', aborted); error ? reject(error) : resolve(); });
      });
      const source = input(req.body, req.file, search);
      // No disconnect-triggered abort or retry: the Gateway owns GPU reclamation.
      req.setTimeout(settings.timeout + 120000);
      res.setTimeout(settings.timeout + 120000);
      const active = () => !req.aborted && !res.destroyed;
      const authorize = () => reauthorize(req);
      const result = search
        ? await service.search(req.user._id, source, req.file, lease, active, authorize)
        : await service.add(req.user._id, source, req.file, lease, active, authorize);
      await reauthorize(req);
      if (active()) res.status(search ? 200 : 201).json(result);
    } catch (error) { uncertain = error.status === 502; throw error; }
    finally { if (req.file) req.file.buffer = undefined; await lease.release(uncertain); }
  }
  router.post('/api/records', csrf.requireToken, mutations, (req, res) => operation(req, res, false));
  router.post('/api/search', csrf.requireToken, mutations, (req, res) => operation(req, res, true));
  router.delete('/api/records/:id', csrf.requireToken, mutations, (req, res) => operation(req, res, false, true));
  router.use((error, req, res, next) => {
    const status = error instanceof PilotError ? error.status : error instanceof multer.MulterError || error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 422 : 503;
    if (status >= 500) logger.error('EmbeddingGemma2 operation failed', { category: 'embeddinggemma2', metadata: { status, errorName: error.name } });
    else if ([408, 413, 429].includes(status)) logger.warning('EmbeddingGemma2 operation rejected by resource limits', { category: 'embeddinggemma2', metadata: { status } });
    if (res.headersSent) { res.destroy(); return; }
    if (!res.destroyed) res.status(status).json({ error: error instanceof PilotError ? error.message : status === 413 ? 'Upload or request exceeds limits.' : status === 422 ? 'Invalid JSON input.' : 'Pilot operation unavailable. Check application diagnostics; reload before retrying.' });
  });
  return router;
}
module.exports = { createRouter, refreshAuthorization, CAPABILITY, BUNDLES };
