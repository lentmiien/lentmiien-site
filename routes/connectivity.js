const express = require('express');
const Role = require('../models/role');
const { createRequireCapabilities, PRIVATE_NO_STORE } = require('../middleware/requireCapabilities');
const { repository } = require('../services/connectivityMonitorService');
const { getConnectivityConfig } = require('../utils/connectivityConfig');
const logger = require('../utils/logger');

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
  router.get('/', async (req, res) => {
    // Fixed page size and time window; no request-controlled probe destinations or work.
    if (Object.keys(req.query).some((key) => key !== 'before')
      || (req.query.before !== undefined && (typeof req.query.before !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(req.query.before)))) {
      return res.status(400).json({ error: 'Invalid query' });
    }
    try {
      const config = configReader();
      const before = req.query.before ? new Date(req.query.before) : new Date();
      if (!Number.isFinite(+before)) return res.status(400).json({ error: 'Invalid query' });
      const samples = await store.history(new Date(Date.now() - config.retentionDays * 86400000), 360, before);
      const latest = samples[0];
      return res.json({ enabled: config.enabled,
        status: !config.enabled || !latest || latest.signature !== config.signature || latest.sampledAt > new Date()
          || Date.now() - new Date(latest.sampledAt) > config.maxGapMs ? 'unknown'
          : latest.probes.some((item) => item.degraded) ? 'degraded' : 'ok',
        publicAppConfigured: Boolean(config.publicOrigin),
        intervalMs: config.intervalMs, slowMs: config.slowMs, timeoutMs: config.timeoutMs,
        sustainedMs: config.sustainedMs, cooldownMs: config.cooldownMs, retentionDays: config.retentionDays,
        limit: 360, nextBefore: samples.length === 360 ? samples.at(-1).sampledAt : null,
        samples: samples.map(({ signature, ...sample }) => sample) });
    } catch {
      if (Date.now() - lastWarning >= 3600000) {
        lastWarning = Date.now();
        Promise.resolve(logger.warning('Connectivity history unavailable; check MongoDB and CONNECTIVITY configuration', {
          category: 'connectivity_monitor',
        })).catch(() => {});
      }
      return res.status(503).json({ error: 'Connectivity history unavailable' });
    }
  });
  return router;
}

module.exports = { createConnectivityRouter, CAPABILITY };
