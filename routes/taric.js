const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { TaricError, fail } = require('../utils/taricContracts');
const { strictJson } = require('../utils/taricProtocol');
const logger = require('../utils/logger');
function privateResponse(_req, res, next) {
  res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' }); next();
}
function uniqueHeader(req, name, required = true) {
  const values = req.rawHeaders.filter((_, i) => i % 2 === 0).filter(h => h.toLowerCase() === name);
  if (values.length > 1 || (required && values.length !== 1)) fail(name === 'authorization' ? 'UNAUTHORIZED' : 'INVALID_REQUEST');
  return req.get(name);
}
function errorHandler(error, req, res, _next) {
  const known = error instanceof TaricError;
  const status = known ? error.status : error.type === 'entity.too.large' ? 413 : error.status === 400 ? 400 : 503;
  if (!known && status === 503) logger.error('TARIC request failed; inspect database and configuration', { category: 'taric', metadata: { code: 'STORAGE_FAILED' } });
  let context = {};
  if (req.taricAction) {
    const { errorStatus, help, STAGES } = require('../utils/taricDiagnostics');
    const transport = errorStatus(error.transport);
    context = { action: req.taricAction, requestId: req.taricRequestId,
      stage: STAGES.has(error.stage) ? error.stage : status === 400 ? 'request.validation' : 'request.operation',
      message: help(known ? error.code : 'STORAGE_FAILED', transport), transport };
    logger.warning('TARIC admin action rejected', { category: 'taric', metadata: {
      ...context, code: known ? error.code : 'STORAGE_FAILED', status,
    } });
  }
  res.status(status).json({ ...context, error: known ? error.code : status === 413 ? 'BODY_TOO_LARGE' : status === 400 ? 'INVALID_REQUEST' : 'STORAGE_FAILED', manual_fallback: true });
}
function rejectCompression(req, _res, next) {
  if (req.get('content-encoding') && req.get('content-encoding') !== 'identity') return next(new TaricError('INVALID_REQUEST'));
  next();
}
function jsonBody(limit) {
  return [rejectCompression, express.raw({ type: 'application/json', limit, inflate: false }), (req, _res, next) => {
    try { if (!Buffer.isBuffer(req.body)) fail('INVALID_REQUEST'); req.body = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(req.body), 'INVALID_REQUEST'); next(); }
    catch (e) { next(e instanceof TaricError ? e : new TaricError('INVALID_REQUEST')); }
  }];
}
function createTaricRouter(service) {
  const router = express.Router(); router.use(privateResponse);
  router.use(rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'RATE_LIMITED', manual_fallback: true }) }));
  // Dedicated authentication precedes parsing. This router is terminal before legacy /api.
  router.use(async (req, _res, next) => {
    try {
      if (Object.keys(req.query).length) fail('INVALID_REQUEST');
      const header = uniqueHeader(req, 'authorization');
      if (!/^Bearer ttk_[A-Za-z0-9_-]{43}$/.test(header || '')) fail('UNAUTHORIZED');
      req.taricPrincipal = await service.authenticate(header.slice(7));
      await service.rate(req.taricPrincipal); next();
    } catch (e) { next(e); }
  });
  router.post('/requests', jsonBody('4kb'), async (req, res) => {
    const result = await service.submit(req.taricPrincipal, uniqueHeader(req, 'idempotency-key'), req.body);
    res.status(result.state === 'queued' || result.state === 'running' ? 202 : 200).set('Location', result.poll_url).json(result);
  });
  router.get('/requests/:id', async (req, res) => {
    const result = await service.retrieve(req.taricPrincipal, req.params.id);
    res.status(['queued', 'running'].includes(result.state) ? 202 : 200).json(result);
  });
  router.post('/requests/:id/feedback', jsonBody('1kb'), async (req, res) => {
    const f = await service.feedback(req.taricPrincipal, uniqueHeader(req, 'idempotency-key'), req.params.id, req.body);
    res.json({ id: f._id, decision: f.decision, selected_code: f.selected_code, verification: f.verification, training_approved: f.training_approved });
  });
  router.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  router.use(errorHandler);
  return router;
}
module.exports = { createTaricRouter, privateResponse, uniqueHeader, errorHandler, rejectCompression, jsonBody };
