const logger = require('../utils/logger');
const { getConnectivityConfig } = require('../utils/connectivityConfig');
const { createConnectivityMonitor } = require('../services/connectivityMonitorService');

let handle;
function scheduleConnectivityMonitor() {
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
  const monitor = createConnectivityMonitor({ config });
  const tick = () => { monitor.tick().catch(() => {}); };
  handle = setInterval(tick, config.intervalMs);
  handle.unref?.();
  tick();
  return handle;
}

module.exports = scheduleConnectivityMonitor;
