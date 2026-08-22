const mongoose = require('mongoose');

const logger = require('../utils/logger');
const { pushoverReminderService } = require('../services/pushoverReminderService');

const REMINDER_POLL_INTERVAL_MS = 60 * 1000;

function createPushoverReminderRunner({
  reminderService = pushoverReminderService,
  log = logger,
  clock = () => new Date(),
} = {}) {
  let running = false;

  return async function tick(reason = 'scheduled') {
    if (running) return { skipped: true };
    running = true;
    const now = clock();

    try {
      const delivery = await reminderService.processDueReminders(now);
      const removed = await reminderService.deleteExpiredHistory(now);
      return { skipped: false, delivery, removed };
    } catch (error) {
      await log.error('Pushover reminder scheduler tick failed', {
        category: 'pushover_reminders',
        metadata: {
          reason,
          error: error.message,
        },
      });
      return { skipped: false, error };
    } finally {
      running = false;
    }
  };
}

function schedulePushoverReminders() {
  const tick = createPushoverReminderRunner();
  let started = false;

  const start = () => {
    if (started) return;
    started = true;
    logger.notice('Pushover reminder scheduler started', {
      category: 'pushover_reminders',
      metadata: { intervalMs: REMINDER_POLL_INTERVAL_MS },
    });
    tick('startup').catch(() => {});
    const handle = setInterval(
      () => tick('scheduled').catch(() => {}),
      REMINDER_POLL_INTERVAL_MS
    );
    handle.unref?.();
  };

  if (mongoose.connection.readyState === 1) {
    start();
  } else {
    logger.notice('Pushover reminder scheduler waiting for MongoDB', {
      category: 'pushover_reminders',
    });
    mongoose.connection.once('connected', start);
  }
}

module.exports = schedulePushoverReminders;
module.exports.REMINDER_POLL_INTERVAL_MS = REMINDER_POLL_INTERVAL_MS;
module.exports.createPushoverReminderRunner = createPushoverReminderRunner;
