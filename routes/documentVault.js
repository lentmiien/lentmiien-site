const express = require('express');
const multer = require('multer');
const { randomUUID } = require('crypto');
const { rateLimit } = require('express-rate-limit');
const Role = require('../models/role');
const logger = require('../utils/logger');
const { hasCapabilities } = require('../utils/authorization');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf, PRIVATE_NO_STORE } = require('../middleware/sessionCsrf');
const { READ, INTAKE, REVIEW, RESUME, BUNDLES, MAX_BATCH, MAX_FILE, MAX_PAGES, PAGE_SIZE, validId, VaultError } = require('../services/documentVault/policy');
const repo = require('../services/documentVault/repository');
const queue = require('../services/documentVault/worker');
const workflow = require('../services/documentVault/workflow');
const { reviewFields, isInvoiceTag, physicalLocation, archiveFilters } = require('../services/documentVault/content');

const base = '/document-vault';
const mutationForm = express.urlencoded({ extended: false, limit: '420kb', parameterLimit: 18 });
const smallForm = express.urlencoded({ extended: false, limit: '2kb', parameterLimit: 4 });
const uploadForm = multer({ storage: multer.memoryStorage(), limits: {
  files: MAX_PAGES, fileSize: MAX_FILE + 1, fields: 102, fieldSize: 100, fieldNameSize: 40, parts: MAX_PAGES + 103,
} }).array('scans', MAX_PAGES);

function allowFields(body, keys) {
  if (!body || Object.keys(body).some(key => !keys.includes(key) && key !== '_csrf')) throw new VaultError(422, 'Invalid form fields.');
}
function integer(value) {
  if (typeof value !== 'string' || !/^\d{1,9}$/.test(value)) throw new VaultError(422, 'Invalid form version or page number.');
  return Number(value);
}
function stateLabel(row) {
  if (row.state === 'group') return row.summaryState === 'failed' ? 'Group description failed' : 'Awaiting group description';
  if (row.state === 'failed') return row.failedStage === 'ocr' ? 'OCR failed' : 'Classification failed';
  if (row.state === 'ocr') return 'Awaiting OCR';
  if (row.state === 'chat') return 'Awaiting classification';
  if (row.summaryState === 'failed') return 'Group description failed';
  if (row.state === 'stored') return 'Filed';
  if (row.state === 'review') return 'Ready for review';
  return 'Awaiting group description';
}
const noticeText = {
  uploaded: 'Upload received. Your pages are in the queue.',
  queued: 'Added to the work queue.',
  filed: 'Review saved.',
  resumed: 'Processing resumed.',
  location: 'Storage location updated.',
};

function createRouter({ repository = repo, queueService = queue, roleModel = Role } = {}) {
  const router = express.Router();
  const csrf = createSessionCsrf();
  const auth = { roleModel, roleCapabilityBundles: BUNDLES };
  const requireCap = cap => createRequireCapabilities({ capabilities: [cap], ...auth });
  const admitting = new Set();
  const throttle = limit => rateLimit({ windowMs: 60000, limit, keyGenerator: req => String(req.user._id), standardHeaders: 'draft-8', legacyHeaders: false });
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': PRIVATE_NO_STORE, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    res.locals.gtag = false;
    if (!req.isAuthenticated?.() || !validId(String(req.user?._id))) return res.status(401).send('Sign in to open the Document vault.');
    next();
  });
  router.use(requireCap(READ), csrf.issueToken);
  router.use(async (req, res, next) => {
    const [intake, review, resume] = await Promise.all([INTAKE, REVIEW, RESUME].map(cap => hasCapabilities(req.user, [cap], auth)));
    Object.assign(res.locals, { base, intake, review, resume, stateLabel, notice: Object.hasOwn(noticeText, req.query.notice) ? noticeText[req.query.notice] : null });
    next();
  });
  function listing(section) {
    return async (req, res) => {
      const q = req.query.q ?? '';
      const offset = integer(req.query.offset ?? '0');
      if (offset > 100000 || typeof q !== 'string' || q.length > 160) throw new VaultError(422, 'Use a shorter search or a valid page number.');
      const filters = section === 'archive' ? archiveFilters(req.query) : {};
      const [data, status] = await Promise.all([
        repository.list(section, req.user._id, { q: q.trim(), offset, filters }),
        section === 'queue' ? queueService.state() : null,
      ]);
      return res.render('document_vault/list', { section, q, filters, offset, pageSize: PAGE_SIZE, ...data,
        pauseReason: status?.pauseReason, queueVersion: status?.version, activeGroup: String(status?.active?.groupId || ''),
        activePage: String(status?.active?.pageId || ''), activeKind: status?.active?.kind,
      });
    };
  }
  router.get('/', listing('archive'));
  router.get('/queue', requireCap(REVIEW), listing('queue'));
  router.get('/review', requireCap(REVIEW), listing('review'));
  router.get('/review/next', requireCap(REVIEW), async (req, res) => {
    const { rows } = await repository.list('review', req.user._id);
    res.redirect(rows[0] ? base + '/pages/' + rows[0]._id : base + '/review' + (req.query.notice === 'filed' ? '?notice=filed' : ''));
  });
  router.get('/upload', requireCap(INTAKE), async (req, res) => res.render('document_vault/upload', {
    section: 'upload', uploadKey: randomUUID(), accounts: await repository.directory(), userId: String(req.user._id),
  }));
  router.post('/upload', requireCap(INTAKE), csrf.requireToken, throttle(12), async (req, res) => {
    if (!req.is('multipart/form-data')) throw new VaultError(415, 'Choose image files to upload.');
    const size = Number(req.get('content-length'));
    if (!Number.isSafeInteger(size) || size < 1) throw new VaultError(411, 'Send the batch with its content length.');
    if (size > MAX_BATCH + 64 * 1024) throw new VaultError(413, 'The batch exceeds 32 MiB.');
    const actor = String(req.user._id);
    if (admitting.has(actor) || admitting.size >= 2) throw new VaultError(429, 'Another upload is being received. Try again shortly.');
    admitting.add(actor);
    try {
      await new Promise((resolve, reject) => uploadForm(req, res, error => error ? reject(error) : resolve()));
      allowFields(req.body, ['ownerId', 'viewerIds', 'uploadKey']);
      const viewers = req.body.viewerIds || [];
      await repository.upload(actor, req.body.ownerId, Array.isArray(viewers) ? viewers : [viewers], req.files, req.body.uploadKey);
      res.status(201).json({ location: base + (res.locals.review ? '/queue' : '/') + '?notice=uploaded' });
    } finally {
      admitting.delete(actor);
    }
  });
  router.get('/pages/:id', async (req, res) => {
    const detail = await repository.detail(req.params.id, req.user._id, res.locals.review);
    res.render('document_vault/page', { ...detail, isInvoiceTag, section: detail.filed ? 'archive' : detail.page.state === 'review' ? 'review' : 'queue' });
  });
  router.get('/pages/:id/image', async (req, res) => {
    const scan = await repository.image(req.params.id, req.user._id);
    res.set({ 'Content-Type': scan.mime, 'Content-Disposition': 'inline; filename="scan.' + scan.mime.split('/')[1] + '"', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    res.send(scan.bytes);
  });

  router.use('/pages/:id', requireCap(REVIEW), throttle(60));
  async function changePage(req, change) {
    const { id } = req.params;
    const actor = req.user._id;
    return repository.mutate(repository.pageScope(id, actor, true), group => change(group, group.pages.id(id), actor));
  }
  router.post('/pages/:id/review', mutationForm, csrf.requireToken, async (req, res) => {
    allowFields(req.body, ['revision', 'title', 'englishText', 'tags', 'invoice', 'description', 'documentDate', 'totalAmount', 'currency', 'decision', 'yearLabel', 'folderId', 'groupLabel', 'groupDescription', 'groupRevision']);
    const fields = reviewFields(req.body);
    const summaryEdit = req.body.groupDescription
      ? { text: req.body.groupDescription, revision: integer(req.body.groupRevision) } : null;
    await changePage(req, (group, page, actor) => workflow.reviewPage(group, page, actor, integer(req.body.revision), fields, summaryEdit));
    res.redirect(303, base + '/review/next?notice=filed');
  });
  router.post('/pages/:id/location', mutationForm, csrf.requireToken, async (req, res) => {
    allowFields(req.body, ['revision', 'yearLabel', 'folderId', 'groupLabel']);
    const physical = physicalLocation({ ...req.body, decision: 'keep' });
    await changePage(req, (_group, page) => workflow.editLocation(page, integer(req.body.revision), physical));
    res.redirect(303, base + '/pages/' + req.params.id + '?notice=location');
  });
  router.post('/pages/:id/redo', smallForm, csrf.requireToken, async (req, res) => {
    allowFields(req.body, ['revision', 'mode']);
    await changePage(req, (group, page, actor) => workflow.redoPage(group, page, actor, integer(req.body.revision), req.body.mode));
    res.redirect(303, base + '/queue?notice=queued');
  });
  router.post('/pages/:id/redo-group', smallForm, csrf.requireToken, async (req, res) => {
    allowFields(req.body, ['revision']);
    await changePage(req, (group, _page, actor) => workflow.redoGroup(group, actor, integer(req.body.revision)));
    res.redirect(303, base + '/queue?notice=queued');
  });
  router.post('/queue/resume', requireCap(RESUME), smallForm, csrf.requireToken, async (req, res) => {
    allowFields(req.body, ['verified', 'version']);
    if (req.body.verified !== 'yes') throw new VaultError(422, 'Verify the OCR and local Chat5 services before resuming.');
    await queueService.resume(integer(req.body.version));
    res.redirect(303, base + '/queue?notice=resumed');
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = error instanceof VaultError ? error.status : 503;
    let message = error instanceof VaultError ? error.message : 'Document vault is temporarily unavailable.';
    if (error instanceof multer.MulterError || error.type === 'entity.too.large' || error.type === 'parameters.too.many') {
      status = 413;
      message = 'Upload up to 12 images, 8 MiB each and 32 MiB per batch. Check the number and size of form fields.';
    }
    if (status >= 500) logger.error('Document vault request failed; check storage and database availability', {
      category: 'document_vault', metadata: { operation: req.route?.path || 'vault', errorName: error.name },
    });
    if (req.path === '/upload' && req.method === 'POST') return res.status(status).json({ error: message });
    res.status(status).render('document_vault/error', { section: '', message });
  });
  return router;
}
module.exports = { createRouter };
