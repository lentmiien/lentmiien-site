const express = require('express');
const { createHistory } = require('../services/taric/history');
const { jsonBody } = require('./taric');
const logger = require('../utils/logger');
// Mounted only after taricAdmin's session, semantic capability, rate and CSRF guards.
function createHistoryRouter(service, history = createHistory({ models: require('../models/taric_tool'), adminPrincipal: service.adminPrincipal })) {
  const router = express.Router();
  const actor = req => String(req.user._id);
  router.get('/', (_req, res) => res.render('admin_taric_history'));
  router.get('/guide', require('../controllers/taricHistoryGuideController').render);
  router.get('/data', async (req, res) => res.json(await history.list(actor(req), req.query)));
  router.post('/jan/preview', jsonBody('4kb'), async (req, res) => res.json(await history.janPreview(actor(req), req.body)));
  router.post('/jan/download', jsonBody('4kb'), async (req, res) => {
    const result = await history.janDownload(actor(req), req.body);
    res.type('text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="taric-filtered-jans.csv"').send(result.csv);
  });
  router.post('/reprocess/preview', jsonBody('4kb'), async (req, res) => res.json(await service.reprocess.preview(actor(req), req.body)));
  router.post('/reprocess/start', jsonBody('4kb'), async (req, res) => {
    const job = await service.reprocess.start(actor(req), req.body);
    res.status(job.active ? 202 : 200).set('Location', job.pollUrl).json(job);
  });
  router.get('/reprocess/:batch', async (req, res) => {
    if (Object.keys(req.query).length) require('../utils/taricContracts').fail('INVALID_REQUEST');
    res.json(await service.reprocess.status(actor(req), req.params.batch));
  });
  router.post('/reprocess/:batch/cancel', jsonBody('1kb'), async (req, res) => res.json(await service.reprocess.cancel(actor(req), req.params.batch, req.body)));
  router.post('/preview', jsonBody('4kb'), async (req, res) => res.json(await history.preview(actor(req), req.body)));
  router.post('/download', jsonBody('4kb'), async (req, res) => {
    const result = await history.download(actor(req), req.body);
    res.type('application/x-ndjson').set('Content-Disposition', `attachment; filename="taric-candidates-${result.id}.jsonl"`).send(result.jsonl);
  });
  router.get('/:id', async (req, res) => {
    if (Object.keys(req.query).length) require('../utils/taricContracts').fail('INVALID_REQUEST');
    res.json(await history.detail(actor(req), req.params.id));
  });
  router.post('/:id/review', jsonBody('8kb'), async (req, res) => res.json(await history.review(actor(req), req.params.id, req.body)));
  router.use((error, _req, res, next) => {
    if (!error.historyStatus) return next(error);
    logger.warning('TARIC history bound reached; narrow base filters or inspect review retention limits', { category: 'taric', metadata: { status: error.historyStatus } });
    res.status(error.historyStatus).json({ error: error.historyCode });
  });
  return router;
}
module.exports = { createHistoryRouter };
