const express = require('express');

const controller = require('../controllers/codexController');
const { PRIVATE_NO_STORE, createSessionCsrf } = require('../middleware/sessionCsrf');

const router = express.Router();
const csrf = createSessionCsrf();

function requireAdmin(req, res, next) {
  if (req.user && req.user.type_user === 'admin') {
    return next();
  }
  if (String(req.headers.accept || '').includes('application/json') || String(req.originalUrl || '').includes('/api/')) {
    return res.status(403).json({ ok: false, error: 'Admin access is required.' });
  }
  return res.status(403).render('accessDenied', {
    title: 'Access Denied',
    message: 'Admin access is required.',
    user: req.user,
  });
}

router.use((_req, res, next) => {
  res.set('Cache-Control', PRIVATE_NO_STORE);
  next();
});
router.use(csrf.issueToken);

router.get('/', controller.renderHome);
router.get('/sessions/:sessionId', controller.renderSession);
router.get('/turns/:turnId', controller.renderTurn);
router.get('/templates', controller.renderPromptTemplates);
router.get('/workspaces', requireAdmin, controller.renderWorkspaces);
router.get('/profiles', requireAdmin, controller.renderProfiles);

router.get('/api/workspaces', controller.listWorkspaces);
router.post('/api/workspaces', csrf.requireToken, requireAdmin, controller.createWorkspace);
router.patch('/api/workspaces/:workspaceId', csrf.requireToken, requireAdmin, controller.updateWorkspace);
router.delete('/api/workspaces/:workspaceId', csrf.requireToken, requireAdmin, controller.deleteWorkspace);

router.get('/api/profiles', controller.listRequestProfiles);
router.post('/api/profiles', csrf.requireToken, requireAdmin, controller.createRequestProfile);
router.patch('/api/profiles/:profileId', csrf.requireToken, requireAdmin, controller.updateRequestProfile);
router.delete('/api/profiles/:profileId', csrf.requireToken, requireAdmin, controller.deleteRequestProfile);

router.get('/api/templates', controller.listPromptTemplates);
router.post('/api/templates', csrf.requireToken, controller.createPromptTemplate);
router.patch('/api/templates/:templateId', csrf.requireToken, controller.updatePromptTemplate);
router.delete('/api/templates/:templateId', csrf.requireToken, controller.deletePromptTemplate);

router.get('/api/sessions', controller.listSessions);
router.post('/api/sessions', csrf.requireToken, controller.createSession);
router.get('/api/sessions/:sessionId', controller.getSession);
router.post('/api/sessions/:sessionId/archive', csrf.requireToken, controller.archiveSession);
router.post('/api/sessions/:sessionId/turns', csrf.requireToken, controller.createFollowupTurn);

router.get('/api/turns/:turnId', controller.getTurn);
router.post('/api/turns/:turnId/cancel', csrf.requireToken, controller.cancelTurn);
router.post('/api/turns/:turnId/retry', csrf.requireToken, controller.retryTurn);
router.get('/api/turns/:turnId/events', controller.getTurnEvents);

router.get('/api/queue', controller.getQueue);
router.get('/api/stats', controller.getStats);
router.patch('/api/pricing', csrf.requireToken, requireAdmin, controller.updatePricing);
router.get('/api/health', controller.getHealth);

module.exports = router;
