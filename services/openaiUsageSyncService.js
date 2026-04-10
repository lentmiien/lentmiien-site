const logger = require('../utils/logger');
const OpenAIUsage = require('../models/openai_usage');
const { fetchUsageSummaryForPeriod } = require('../usage');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_OPENAI_USAGE_LOOKBACK_DAYS = 31;

let usageSyncPromise = null;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withRetry(operation, options = {}) {
  const {
    attempts = 3,
    baseDelayMs = 500,
    factor = 2,
    label = 'operation',
  } = options;

  let attempt = 0;
  let lastError;

  while (attempt < attempts) {
    attempt += 1;
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const hasNextAttempt = attempt < attempts;
      logger.warning(`${label} attempt ${attempt} failed`, {
        category: 'openai_usage_sync',
        metadata: { error: error.message },
      });
      if (!hasNextAttempt) {
        break;
      }
      const delayMs = baseDelayMs * Math.pow(factor, attempt - 1);
      await delay(delayMs);
    }
  }

  throw lastError;
}

function formatUtcDate(date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildUsageWindows(lookbackDays = DEFAULT_OPENAI_USAGE_LOOKBACK_DAYS) {
  const todayUtcStart = new Date();
  todayUtcStart.setUTCHours(0, 0, 0, 0);

  const windows = [];
  for (let daysAgo = lookbackDays; daysAgo >= 1; daysAgo -= 1) {
    const startDate = new Date(todayUtcStart.getTime() - (daysAgo * DAY_MS));
    const endDate = new Date(startDate.getTime() + DAY_MS);
    windows.push({
      startDate,
      endDate,
      dateString: formatUtcDate(startDate),
    });
  }

  return windows;
}

async function syncOpenAIUsageHistory(options = {}) {
  const {
    lookbackDays = DEFAULT_OPENAI_USAGE_LOOKBACK_DAYS,
  } = options;

  if (!process.env.OPENAI_ADMIN_KEY) {
    return {
      skipped: true,
      reason: 'OPENAI_ADMIN_KEY not configured',
      lookbackDays,
      usageEntriesInserted: 0,
      existingEntriesSkipped: 0,
      insertedDates: [],
    };
  }

  if (usageSyncPromise) {
    return usageSyncPromise;
  }

  usageSyncPromise = (async () => {
    const summary = {
      skipped: false,
      lookbackDays,
      usageEntriesInserted: 0,
      existingEntriesSkipped: 0,
      insertedDates: [],
    };

    const windows = buildUsageWindows(lookbackDays);
    for (const { startDate, endDate, dateString } of windows) {
      const existing = await OpenAIUsage.findOne({ entry_date: dateString }).lean().exec();
      if (existing) {
        summary.existingEntriesSkipped += 1;
        continue;
      }

      const usageSummary = await withRetry(
        async () => {
          const summaryForDay = await fetchUsageSummaryForPeriod(startDate, endDate);
          if (!summaryForDay) {
            throw new Error('Usage summary unavailable');
          }
          return summaryForDay;
        },
        { attempts: 3, baseDelayMs: 750, label: `openai-usage-${dateString}` },
      );

      usageSummary.entry_date = dateString;
      await new OpenAIUsage(usageSummary).save();
      summary.usageEntriesInserted += 1;
      summary.insertedDates.push(dateString);
      logger.notice(`Saved OpenAI usage data for ${dateString}`);
    }

    return summary;
  })().catch((error) => {
    logger.error('OpenAI usage sync failed', {
      category: 'openai_usage_sync',
      metadata: { error: error.message },
    });
    throw error;
  });

  try {
    return await usageSyncPromise;
  } finally {
    usageSyncPromise = null;
  }
}

module.exports = {
  DEFAULT_OPENAI_USAGE_LOOKBACK_DAYS,
  syncOpenAIUsageHistory,
};
