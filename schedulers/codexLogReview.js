const mongoose = require('mongoose');

const logger = require('../utils/logger');
const {
  PUSHOVER_PRIORITIES,
  sendPushoverNotification,
} = require('../utils/pushover');
const {
  codexLogReviewWorkflowService,
} = require('../services/codexLogReviewWorkflowService');

const DEFAULT_INTERVAL_MS = 60 * 1000;
const MINIMUM_INTERVAL_MS = 30 * 1000;
const REPEATED_ERROR_THRESHOLD = 3;

function getIntervalMs(value = process.env.CODEX_LOG_REVIEW_POLL_MS) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MS;
  return Math.max(MINIMUM_INTERVAL_MS, parsed);
}

function createCodexLogReviewRunner({
  workflowService = codexLogReviewWorkflowService,
  log = logger,
  notificationSender = sendPushoverNotification,
} = {}) {
  let running = false;
  let consecutiveErrors = 0;
  let repeatedErrorNotificationSent = false;

  return async function tick(reason = 'scheduled') {
    if (running) return { skipped: true };
    running = true;
    try {
      const result = await workflowService.tick(new Date());
      consecutiveErrors = 0;
      repeatedErrorNotificationSent = false;
      return { skipped: false, result };
    } catch (error) {
      consecutiveErrors += 1;
      await log.error('Codex log review scheduler tick failed', {
        category: 'codex_log_review',
        metadata: {
          reason,
          consecutiveErrors,
          error: error.message,
        },
      });

      if (consecutiveErrors >= REPEATED_ERROR_THRESHOLD && !repeatedErrorNotificationSent) {
        try {
          await notificationSender({
            title: 'Production log workflow scheduler errors',
            message: `The production log review scheduler has failed ${consecutiveErrors} times in a row. Latest error: ${String(error.message || error).slice(0, 500)}`,
            priority: PUSHOVER_PRIORITIES.MEDIUM,
          });
          repeatedErrorNotificationSent = true;
        } catch (notificationError) {
          await log.error('Unable to send Codex log review scheduler error notification', {
            category: 'codex_log_review',
            metadata: { error: notificationError.message },
          });
        }
      }
      return { skipped: false, error };
    } finally {
      running = false;
    }
  };
}

function scheduleCodexLogReview() {
  const intervalMs = getIntervalMs();
  const tick = createCodexLogReviewRunner();
  let started = false;

  const start = () => {
    if (started) return;
    started = true;
    logger.notice('Codex production log review scheduler started', {
      category: 'codex_log_review',
      metadata: { intervalMs },
    });
    tick('startup').catch(() => {});
    const handle = setInterval(() => tick('scheduled').catch(() => {}), intervalMs);
    handle.unref?.();
  };

  if (mongoose.connection.readyState === 1) {
    start();
  } else {
    logger.notice('Codex production log review scheduler waiting for MongoDB', {
      category: 'codex_log_review',
    });
    mongoose.connection.once('connected', start);
  }
}

module.exports = scheduleCodexLogReview;
module.exports.createCodexLogReviewRunner = createCodexLogReviewRunner;
module.exports.getIntervalMs = getIntervalMs;
