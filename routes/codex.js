const express = require('express');

const controller = require('../controllers/codexController');

const router = express.Router();

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

router.get('/', controller.renderHome);
router.get('/sessions/:sessionId', controller.renderSession);
router.get('/turns/:turnId', controller.renderTurn);
router.get('/workspaces', requireAdmin, controller.renderWorkspaces);

router.get('/api/workspaces', controller.listWorkspaces);
router.post('/api/workspaces', requireAdmin, controller.createWorkspace);
router.patch('/api/workspaces/:workspaceId', requireAdmin, controller.updateWorkspace);
router.delete('/api/workspaces/:workspaceId', requireAdmin, controller.deleteWorkspace);

router.get('/api/sessions', controller.listSessions);
router.post('/api/sessions', controller.createSession);
router.get('/api/sessions/:sessionId', controller.getSession);
router.post('/api/sessions/:sessionId/archive', controller.archiveSession);
router.post('/api/sessions/:sessionId/turns', controller.createFollowupTurn);

router.get('/api/turns/:turnId', controller.getTurn);
router.post('/api/turns/:turnId/cancel', controller.cancelTurn);
router.post('/api/turns/:turnId/retry', controller.retryTurn);
router.get('/api/turns/:turnId/events', controller.getTurnEvents);

router.get('/api/queue', controller.getQueue);
router.get('/api/health', controller.getHealth);

module.exports = router;
