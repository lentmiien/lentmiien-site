const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { privateAccess } = require('../services/commons/privateAccess');
const logger = require('../utils/logger');
const publicErrors = new Set(['INVALID_INPUT', 'DAY_CHANGED', 'REVISION_CONFLICT', 'TASK_GONE',
  'UNAUTHORIZED', 'FORBIDDEN', 'TOO_FAR', 'SESSION_EXPIRED', 'BUSY', 'SUMMARY_UNAVAILABLE']);
function createCommonsPrivateRouter({ access = privateAccess, panels, diary } = {}) {
  const router = express.Router();
  const csrf = createSessionCsrf();
  const sources = () => panels || (panels = require('../services/commons/panels').createPanels());
  const journal = () => diary || (diary = require('../services/commons/diary').createDiary());
  router.use(rateLimit({ windowMs: 60000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: req => String(req.user._id), message: { error: 'BUSY' } }));
  router.use(express.json({ limit: '64kb' }));
  function endpoint(surface, operation) {
    return async (req, res) => {
      let grant;
      try {
        if (surface !== 'diary' && Object.keys(req.query).length) return res.status(400).json({ error: 'INVALID_INPUT' });
        grant = await access.open(req, surface);
        const result = await operation(req, grant);
        await grant.check();
        return res.json(result);
      } catch (error) {
        const code = publicErrors.has(error.code) ? error.code : error.message === 'UNAUTHORIZED' ? 'UNAUTHORIZED' : 'UNAVAILABLE';
        if (code === 'UNAVAILABLE' || code === 'SUMMARY_UNAVAILABLE') logger.warning('Commons private operation failed', { category: 'commons.private', metadata: { operation: surface, code } });
        const status = code === 'INVALID_INPUT' ? 400 : ['DAY_CHANGED', 'REVISION_CONFLICT', 'TASK_GONE'].includes(code) ? 409
          : ['UNAUTHORIZED', 'FORBIDDEN', 'TOO_FAR', 'SESSION_EXPIRED'].includes(code) ? 403 : code === 'BUSY' ? 429 : 503;
        return res.status(status).json({ error: code });
      } finally { grant?.release?.(); }
    };
  }
  router.get('/quests', endpoint('quests', (_req, grant) => sources().quests(grant.principal)));
  router.post('/quests/done', csrf.requireToken, endpoint('quest-done', async (req, grant) => {
    const principal = await grant.check(); return sources().complete(principal, req.body);
  }));
  router.get('/statistics', endpoint('statistics', () => sources().statistics()));
  router.get('/diagnostics', endpoint('diagnostics', () => sources().diagnostics()));
  router.get('/stock', endpoint('stock', () => sources().stock()));
  router.get('/diary', endpoint('diary', (req, grant) => journal().read(grant.principal._id, req.query)));
  router.post('/diary', csrf.requireToken, endpoint('diary-save', (req, grant) => journal().save(grant.principal._id, req.body, grant.check)));
  router.use((error, _req, res, _next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'INVALID_INPUT' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'INVALID_INPUT' });
    logger.warning('Commons private request failed', { category: 'commons.private', metadata: { errorName: error?.name || 'Error' } });
    return res.status(503).json({ error: 'UNAVAILABLE' });
  });
  return router;
}
module.exports = { createCommonsPrivateRouter };
