const express = require('express');
const Role = require('../models/role');
const { createRequireCapabilities, PRIVATE_NO_STORE } = require('../middleware/requireCapabilities');
const { repository } = require('../services/connectivityMonitorService');
const { getConnectivityConfig } = require('../utils/connectivityConfig');
const logger = require('../utils/logger');
const { aggregateConnectivity, recentStatus, MAX_SAMPLES } = require('../services/connectivityAnalytics');

const CAPABILITY = 'monitoring.connectivity.read';
function createConnectivityRouter({ store = repository, roleModel = Role, configReader = getConnectivityConfig } = {}) {
  const router = express.Router();
  let lastWarning = 0;
  router.use((_req, res, next) => {
    res.set('Cache-Control', PRIVATE_NO_STORE);
    next();
  });
  router.use((req, res, next) => {
    if (!req.isAuthenticated?.()) return res.status(401).json({ error: 'Authentication required' });
    next();
  });
  router.use(createRequireCapabilities({ capabilities: [CAPABILITY], roleModel,
    roleCapabilityBundles: { admin: [CAPABILITY], family: [], user: [] } }));
  function unavailable(res) {
    if (Date.now() - lastWarning >= 3600000) {
      lastWarning = Date.now();
      Promise.resolve(logger.warning('Connectivity history unavailable; check MongoDB and CONNECTIVITY configuration', {
        category: 'connectivity_monitor',
      })).catch(() => {});
    }
    return res.status(503).json({ error: 'Connectivity history unavailable' });
  }
  router.get('/analytics', async (req, res) => {
    if (Object.keys(req.query).some((key) => key !== 'hours')
      || (req.query.hours !== undefined && !['1', '6', '24', '72'].includes(req.query.hours))) {
      return res.status(400).json({ error: 'Invalid query' });
    }
    try {
      const config = configReader();
      const until = new Date();
      const since = new Date(+until - Number(req.query.hours || 24) * 3600000);
      const retainedSince = new Date(Math.max(+since, +until - config.retentionDays * 86400000));
      const samples = await store.history(retainedSince, MAX_SAMPLES + 1, until);
      return res.json(aggregateConnectivity(samples.slice(0, MAX_SAMPLES), config, {
        since, until, truncated: samples.length > MAX_SAMPLES,
      }));
    } catch { return unavailable(res); }
  });
  router.get('/', (req, res, next) => {
    // Keep the original JSON default for */* clients and old before-pagination URLs.
    if (!req.query.before && req.accepts(['json', 'html']) === 'html') {
      if (Object.keys(req.query).length) return res.status(400).json({ error: 'Invalid query' });
      return res.render('connectivity_dashboard', { pageTitle: 'Connectivity analytics', gtag: false });
    }
    next();
  });
  router.get(['/', '/api'], async (req, res) => {
    // Fixed page size and time window; no request-controlled probe destinations or work.
    if (Object.keys(req.query).some((key) => key !== 'before')
      || (req.query.before !== undefined && (typeof req.query.before !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(req.query.before)))) {
      return res.status(400).json({ error: 'Invalid query' });
    }
    try {
      const config = configReader();
      const before = req.query.before ? new Date(req.query.before) : new Date();
      if (!Number.isFinite(+before) || (req.query.before && before.toISOString() !== req.query.before)) return res.status(400).json({ error: 'Invalid query' });
      const samples = await store.history(new Date(Date.now() - config.retentionDays * 86400000), 360, before);
      const latest = samples[0];
      return res.json({ enabled: config.enabled,
        status: recentStatus(latest, config),
        publicAppConfigured: Boolean(config.publicOrigin),
        intervalMs: config.intervalMs, slowMs: config.slowMs, timeoutMs: config.timeoutMs,
        sustainedMs: config.sustainedMs, cooldownMs: config.cooldownMs, retentionDays: config.retentionDays,
        limit: 360, nextBefore: samples.length === 360 ? samples.at(-1).sampledAt : null,
        samples: samples.map(({ signature, ...sample }) => sample) });
    } catch {
      return unavailable(res);
    }
  });
  return router;
}

module.exports = { createConnectivityRouter, CAPABILITY };
