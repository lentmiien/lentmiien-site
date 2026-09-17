const express = require('express');
const { rateLimit } = require('express-rate-limit');
const Role = require('../models/role');
const { createRequireCapabilities, PRIVATE_NO_STORE } = require('../middleware/requireCapabilities');
const logger = require('../utils/logger');
const { createExportService, parseOptions, ExportError } = require('../services/chat5ExportService');

const CAPABILITY = 'chat.conversation.export';
const ROLE_BUNDLES = { admin: [CAPABILITY], family: [CAPABILITY], user: [CAPABILITY] };

function createChat5ExportRouter({ exportConversation = createExportService(), roleModel = Role, log = logger, rateLimitMax = 6 } = {}) {
  const router = express.Router({ mergeParams: true });
  let active = 0;
  const activePrincipals = new Set();
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': PRIVATE_NO_STORE, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.locals.gtag = false;
    if (!req.isAuthenticated?.() || !req.user?._id) return res.status(401).json({ error: 'Sign in again, then retry the export.' });
    next();
  });
  router.use(createRequireCapabilities({ capabilities: ['chat5', CAPABILITY], roleModel, roleCapabilityBundles: ROLE_BUNDLES, logger: log }));
  router.use(rateLimit({ windowMs: 60 * 1000, limit: rateLimitMax, keyGenerator: req => String(req.user._id),
    standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many exports. Wait one minute and try again.' } }));
  router.get('/', async (req, res) => {
    const key = String(req.user._id);
    if (active >= 2 || activePrincipals.has(key)) return res.status(429).json({ error: 'An export is already running. Please try again shortly.' });
    active += 1; activePrincipals.add(key);
    try {
      const options = parseOptions(req.query);
      const { body, manifest } = await exportConversation(req.params.id, req.user, options);
      const summary = manifest?.summary;
      if (summary && (summary.missing_references || summary.duplicate_positions || summary.unknown_records)) {
        log.warning('Chat5 source export found reference integrity issues; inspect export diagnostics', {
          category: 'chat5_export', metadata: { missing: summary.missing_references, duplicates: summary.duplicate_positions, unknown: summary.unknown_records },
        });
      }
      // Filename uses only the validated ID and fixed format, never titles or source text.
      const filename = `chat5-${req.params.id.toLowerCase()}-source-v1.${options.format}`;
      res.set({
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': options.format === 'json' ? 'application/json; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
      });
      return res.send(body);
    } catch (error) {
      const status = error instanceof ExportError ? error.status : 503;
      if ([409, 413].includes(status)) log.warning('Chat5 source export interrupted; retry after changes settle or reduce export scope', { category: 'chat5_export', metadata: { status } });
      if (status === 503) log.error('Chat5 source export failed; check database availability and export implementation', { category: 'chat5_export' });
      return res.status(status).json({ error: error instanceof ExportError ? error.message : 'Export is unavailable. Please try again later.' });
    } finally {
      active -= 1; activePrincipals.delete(key);
    }
  });
  return router;
}
module.exports = { createChat5ExportRouter, CAPABILITY, ROLE_BUNDLES };
