const HumanToolRequestService = require('./humanToolRequestService');
const logger = require('../utils/logger');

const DEFAULT_RECOVERY_INTERVAL_MS = 60 * 1000;

function recoveryInterval(env = process.env) {
  const parsed = Number.parseInt(env.HUMAN_TOOL_RECOVERY_INTERVAL_MS, 10);
  if (!Number.isInteger(parsed)) return DEFAULT_RECOVERY_INTERVAL_MS;
  return Math.max(15 * 1000, Math.min(10 * 60 * 1000, parsed));
}

async function recoverInterruptedHumanToolResponses({
  service = new HumanToolRequestService(),
  log = logger,
} = {}) {
  try {
    const summary = await service.recoverInterruptedResponses();
    if (summary.modifiedCount > 0 || summary.expiredCount > 0) {
      await log.notice('Reconciled durable human tool calls', {
        category: 'human_tool_request',
        metadata: {
          expired: summary.expiredCount || 0,
          requeued: summary.modifiedCount || 0,
        },
      });
    }
    return summary;
  } catch (error) {
    await log.error('Failed to reconcile durable human tool calls', {
      category: 'human_tool_request',
      metadata: { errorName: error?.name || 'Error' },
    });
    return {
      expiredCount: 0,
      matchedCount: 0,
      modifiedCount: 0,
      error: error?.message || String(error),
    };
  }
}

function scheduleHumanToolRequestRecovery({
  service = new HumanToolRequestService(),
  log = logger,
  env = process.env,
  setIntervalFn = setInterval,
} = {}) {
  const intervalMs = recoveryInterval(env);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await recoverInterruptedHumanToolResponses({ service, log });
    } finally {
      running = false;
    }
  };

  const scheduledTick = () => tick().catch(() => {});
  scheduledTick();
  const handle = setIntervalFn(scheduledTick, intervalMs);
  handle?.unref?.();
  return handle;
}

module.exports = {
  recoverInterruptedHumanToolResponses,
  recoveryInterval,
  scheduleHumanToolRequestRecovery,
};
