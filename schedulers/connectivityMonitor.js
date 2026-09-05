const { performance } = require('perf_hooks');
const logger = require('../utils/logger');
const { getConnectivityConfig } = require('../utils/connectivityConfig');
const { createConnectivityMonitor } = require('../services/connectivityMonitorService');

let handle;
function scheduleConnectivityMonitor({ localPort = () => null } = {}) {
  if (handle) return handle;
  let config;
  try { config = getConnectivityConfig(); }
  catch {
    Promise.resolve(logger.error('Connectivity monitor disabled: invalid CONNECTIVITY configuration', {
      category: 'connectivity_monitor',
    })).catch(() => {});
    return null;
  }
  if (!config.enabled) return null;
  const monitor = createConnectivityMonitor({ config, localPort });
  let expected = performance.now();
  const tick = () => {
    const schedulerLatenessMs = Math.max(0, performance.now() - expected);
    const scheduledAt = new Date(Date.now() - schedulerLatenessMs);
    expected = performance.now() + config.intervalMs;
    monitor.tick({ scheduledAt, schedulerLatenessMs }).catch(() => {});
  };
  handle = setInterval(tick, config.intervalMs);
  handle.unref?.();
  tick();
  return handle;
}

module.exports = scheduleConnectivityMonitor;
