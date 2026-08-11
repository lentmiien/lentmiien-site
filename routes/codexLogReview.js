const express = require('express');

const controller = require('../controllers/codexLogReviewController');

const router = express.Router();

router.get('/', controller.index);
router.get('/runs/:runId', controller.showRun);
router.post('/runs/:runId/fix', controller.startFix);
router.post('/runs/:runId/commit', controller.startCommit);
router.post('/runs/:runId/retry', controller.retryNow);

module.exports = router;
