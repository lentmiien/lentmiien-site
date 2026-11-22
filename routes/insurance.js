const express = require('express');
const { z } = require('zod');
const { once } = require('node:events');
const { rateLimit } = require('express-rate-limit');
const Role = require('../models/role');
const claims = require('../services/insuranceService');
const vault = require('../services/documentVault/repository');
const { READ, BUNDLES, PAGE_SIZE, validId, VaultError } = require('../services/documentVault/policy');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf, PRIVATE_NO_STORE } = require('../middleware/sessionCsrf');
const logger = require('../utils/logger');

const MAX_ZIP_SCANS = 128;
const id = z.string().regex(/^[a-f0-9]{24}$/i).transform(value => value.toLowerCase());
const query = z.object({
  offset: z.string().regex(/^\d{1,7}$/).default('0').transform(Number),
  date: z.iso.date().optional(), owner: id.optional(),
}).strict();
const form = z.object({
  ids: z.union([id, z.array(id).min(1).max(PAGE_SIZE)]),
  status: z.enum(['processing', 'dismissed', 'completed', 'expired']),
  from: z.enum(['unreviewed', 'processing']),
  submittedOn: z.iso.date().optional(),
  _csrf: z.string().optional(),
}).strict();
function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw new VaultError(422, 'Check the invoice selection and submission date.');
  return result.data;
}
const limit = max => rateLimit({ windowMs: 60000, limit: max, keyGenerator: req => String(req.user._id),
  standardHeaders: 'draft-8', legacyHeaders: false });

function createRouter() {
  const router = express.Router();
  const csrf = createSessionCsrf();
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': PRIVATE_NO_STORE, 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' });
    res.locals.gtag = false;
    if (!req.isAuthenticated?.() || !validId(String(req.user?._id))) return res.status(401).send('Sign in to open Insurance.');
    next();
  });
  router.use(createRequireCapabilities({ capabilities: [READ], roleModel: Role, roleCapabilityBundles: BUNDLES }), csrf.issueToken);
  function listing(view, download = null) {
    return async (req, res) => {
      const options = parse(query, req.query);
      if (view === 'batch' ? !(options.date && options.owner) : options.date || options.owner) {
        throw new VaultError(422, 'Choose a dated insurance batch.');
      }
      const allScans = download === 'all';
      if (allScans) options.offset = 0;
      const includeSummary = !download && view !== 'batch';
      const data = await claims.list(req.user._id, { ...options, view, includeSummary }, allScans ? MAX_ZIP_SCANS : PAGE_SIZE);
      if (download) {
        if (allScans && data.more) throw new VaultError(422, 'This selection exceeds 128 scans. Download each results page separately.');
        if (!data.rows.length) throw new VaultError(404, 'No scans are available for this selection.');
        const { ZipArchive } = await import('archiver');
        const zip = new ZipArchive({ store: true });
        const cancel = new AbortController();
        res.on('close', () => { cancel.abort(); zip.abort(); });
        zip.on('error', () => res.destroy());
        res.attachment('insurance-' + (options.date || 'processing') + '-' + (options.offset + 1) + '.zip');
        zip.pipe(res);
        for (const row of data.rows) {
          const scan = await vault.image(String(row._id), req.user._id);
          cancel.signal.throwIfAborted();
          const entry = once(zip, 'entry', { signal: cancel.signal });
          zip.append(scan.bytes, { name: String(row._id) + '.' + scan.mime.split('/')[1] });
          await entry;
        }
        await zip.finalize();
        return;
      }
      res.render('insurance', { ...data, ...options, view, pageSize: PAGE_SIZE });
    };
  }
  router.get('/', listing('unreviewed'));
  router.get('/processing', listing('processing'));
  router.get('/batches', listing('batches'));
  router.get('/batch', listing('batch'));
  const downloadLimit = limit(8);
  router.get('/processing/scans.zip', downloadLimit, listing('processing', 'page'));
  router.get('/batch/scans.zip', downloadLimit, listing('batch', 'page'));

  router.get('/processing/all-scans.zip', downloadLimit, listing('processing', 'all'));
  router.get('/batch/all-scans.zip', downloadLimit, listing('batch', 'all'));

  router.post('/status', limit(60), express.urlencoded({ extended: false, limit: '4kb', parameterLimit: PAGE_SIZE + 4 }), csrf.requireToken, async (req, res) => {
    const body = parse(form, req.body);
    const ids = [...new Set([body.ids].flat())];
    if ((body.status === 'completed') !== Boolean(body.submittedOn)) throw new VaultError(422, 'Enter the date this claim was submitted.');
    await claims.transition(req.user._id, ids, body.from, body.status, body.submittedOn);
    res.redirect(303, body.from === 'processing' ? '/insurance/processing' : '/insurance/');
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) {
      if (!res.destroyed) {
        logger.error('Insurance scan download interrupted; check vault storage', { category: 'insurance' });
        res.destroy();
      }
      return;
    }
    const status = error instanceof VaultError ? error.status : error.status === 413 ? 413 : 503;
    if (status === 503) logger.error('Insurance request failed; check vault and claim storage', {
      category: 'insurance', metadata: { errorName: error.name },
    });
    res.status(status).render('insurance', { view: 'error', message: error instanceof VaultError ? error.message : 'Insurance request could not be completed.' });
  });
  return router;
}
module.exports = { createRouter };
