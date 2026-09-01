const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { runpodBillingHistoryService } = require('../services/runpodBillingHistoryService');

const DEFAULT_RUNPOD_BILLING_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MIN_RUNPOD_BILLING_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const MAX_RUNPOD_BILLING_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

function billingSyncInterval(value = process.env.RUNPOD_BILLING_SYNC_INTERVAL_MS) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return DEFAULT_RUNPOD_BILLING_SYNC_INTERVAL_MS;
  }
  return Math.min(
    MAX_RUNPOD_BILLING_SYNC_INTERVAL_MS,
    Math.max(MIN_RUNPOD_BILLING_SYNC_INTERVAL_MS, parsed)
  );
}

function createRunpodBillingHistoryRunner({
  billingService = runpodBillingHistoryService,
  appLogger = logger,
} = {}) {
  let running = false;
  return async function tick(reason = 'scheduled') {
    if (running) return { skipped: true };
    running = true;
    try {
      const result = await billingService.syncHistory({ name: 'runpod-billing-scheduler' });
      return { skipped: false, result };
    } catch (error) {
      appLogger.error('Runpod billing history synchronization failed', {
        category: 'runpod_billing',
        metadata: {
          reason,
          errorCode: typeof error?.code === 'string'
            ? error.code.slice(0, 80)
            : 'RUNPOD_BILLING_SYNC_FAILED',
          providerStatus: Number.isSafeInteger(error?.status) ? error.status : null,
        },
      });
      return { skipped: false, error };
    } finally {
      running = false;
    }
  };
}

function scheduleRunpodBillingHistory() {
  if (!process.env.RUNPOD_API_KEY) {
    logger.notice('Runpod billing history synchronization disabled because the API key is not configured', {
      category: 'runpod_billing',
    });
    return;
  }
  const intervalMs = billingSyncInterval();
  const tick = createRunpodBillingHistoryRunner();
  tick('startup').catch(() => {});
  const handle = setInterval(() => {
    if (mongoose.connection.readyState === 1) tick('scheduled').catch(() => {});
  }, intervalMs);
  handle.unref?.();
  logger.notice('Runpod billing history synchronization started', {
    category: 'runpod_billing',
    metadata: { intervalMs },
  });
}

module.exports = scheduleRunpodBillingHistory;
module.exports.DEFAULT_RUNPOD_BILLING_SYNC_INTERVAL_MS = DEFAULT_RUNPOD_BILLING_SYNC_INTERVAL_MS;
module.exports.MAX_RUNPOD_BILLING_SYNC_INTERVAL_MS = MAX_RUNPOD_BILLING_SYNC_INTERVAL_MS;
module.exports.MIN_RUNPOD_BILLING_SYNC_INTERVAL_MS = MIN_RUNPOD_BILLING_SYNC_INTERVAL_MS;
module.exports.billingSyncInterval = billingSyncInterval;
module.exports.createRunpodBillingHistoryRunner = createRunpodBillingHistoryRunner;
