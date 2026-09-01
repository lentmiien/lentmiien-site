const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { runpodPodManager } = require('../services/runpodPodManager');

const RUNPOD_GUARD_INTERVAL_MS = 60 * 1000;
const RUNPOD_SYNC_WARNING_INTERVAL_MS = 15 * 60 * 1000;

function createRunpodPodGuardRunner({ manager = runpodPodManager, appLogger = logger } = {}) {
  let running = false;
  let lastSyncWarningAt = 0;
  return async function tick(reason = 'scheduled') {
    if (running) return { skipped: true };
    running = true;
    try {
      let synchronized = null;
      if (typeof manager.syncProviderPods === 'function') {
        try {
          synchronized = await manager.syncProviderPods(
            { name: 'runpod-state-observer' },
            { recordEvent: false }
          );
        } catch (error) {
          const now = Date.now();
          if (now - lastSyncWarningAt >= RUNPOD_SYNC_WARNING_INTERVAL_MS) {
            lastSyncWarningAt = now;
            appLogger.warning('Runpod usage observer could not refresh provider state', {
              category: 'runpod_management',
              metadata: {
                reason,
                errorCode: typeof error?.code === 'string'
                  ? error.code.slice(0, 80)
                  : 'RUNPOD_SYNC_FAILED',
              },
            });
          }
        }
      }
      const stopped = await manager.stopExpiredPods();
      return {
        skipped: false,
        stopped,
        ...(synchronized ? { synchronized } : {}),
      };
    } catch (error) {
      appLogger.error('Runpod automatic cost guard tick failed', {
        category: 'runpod_management',
        metadata: {
          reason,
          errorCode: typeof error?.code === 'string' ? error.code.slice(0, 80) : 'RUNPOD_GUARD_FAILED',
        },
      });
      return { skipped: false, error };
    } finally {
      running = false;
    }
  };
}

function scheduleRunpodPodGuard() {
  if (!process.env.RUNPOD_API_KEY) {
    logger.notice('Runpod automatic cost guard disabled because the API key is not configured', {
      category: 'runpod_management',
    });
    return;
  }
  const tick = createRunpodPodGuardRunner();
  runpodPodManager.resumePendingProvisioning().catch((error) => {
    logger.error('Failed to resume pending Runpod setup work', {
      category: 'runpod_management',
      metadata: {
        errorCode: typeof error?.code === 'string' ? error.code.slice(0, 80) : 'RUNPOD_SETUP_RECOVERY_FAILED',
      },
    });
  });
  tick('startup').catch(() => {});
  const handle = setInterval(() => {
    if (mongoose.connection.readyState === 1) tick('scheduled').catch(() => {});
  }, RUNPOD_GUARD_INTERVAL_MS);
  handle.unref?.();
  logger.notice('Runpod automatic cost guard started', {
    category: 'runpod_management',
    metadata: { intervalMs: RUNPOD_GUARD_INTERVAL_MS },
  });
}

module.exports = scheduleRunpodPodGuard;
module.exports.RUNPOD_GUARD_INTERVAL_MS = RUNPOD_GUARD_INTERVAL_MS;
module.exports.RUNPOD_SYNC_WARNING_INTERVAL_MS = RUNPOD_SYNC_WARNING_INTERVAL_MS;
module.exports.createRunpodPodGuardRunner = createRunpodPodGuardRunner;
