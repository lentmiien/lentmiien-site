const logger = require('../utils/logger');
const { getRetentionDays, pruneOldLogs } = require('../services/logRetentionService');

const DEFAULT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function getPruneIntervalMs(value = process.env.LOG_PRUNE_INTERVAL_MS) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PRUNE_INTERVAL_MS;
}

function scheduleLogRetention() {
  const retentionDays = getRetentionDays();
  const intervalMs = getPruneIntervalMs();
  const run = async () => {
    try {
      const result = await pruneOldLogs({ retentionDays, logger });
      if (result.removed > 0) {
        await logger.notice('Scheduled log retention completed', {
          category: 'log_retention',
          metadata: { retentionDays, removed: result.removed },
        });
      }
    } catch (error) {
      await logger.warning('Scheduled log retention failed', {
        category: 'log_retention',
        metadata: { error: error.message },
      });
    }
  };

  run().catch(() => {});
  const handle = setInterval(() => run().catch(() => {}), intervalMs);
  handle.unref?.();
  return handle;
}

module.exports = scheduleLogRetention;
module.exports.getPruneIntervalMs = getPruneIntervalMs;
