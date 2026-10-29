const logger = require('../utils/logger');
const { LIMITS } = require('../services/experimentalModels/policy');

function scheduleExperimentalModelsCleanup(store = require('../services/experimentalModels')) {
  const tick = async () => {
    try { await store.sweep(); } catch (error) {
      if (error.code === 'storage_busy') return; // Next minute retries; active operations are bounded.
      logger.error('Experimental Models cleanup failed; check private storage permissions and disk space', { category: 'experimental_models' });
    }
  };
  tick();
  const handle = setInterval(tick, LIMITS.sweepMs);
  handle.unref?.();
  return handle;
}
module.exports = scheduleExperimentalModelsCleanup;
