const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_COMPLETION_WINDOW_DAYS = 30;

function formatDateKey(date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(value) {
  const dateKey = typeof value === 'string' ? value.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return null;
  }

  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatDateKey(date) !== dateKey) {
    return null;
  }

  return date;
}

function addUtcDays(date, days) {
  return new Date(date.getTime() + (days * DAY_MS));
}

function formatDateLabel(date, includeYear = true) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(date);
}

function firstFiniteMetric(item, keys) {
  for (const key of keys) {
    if (typeof item?.[key] === 'number' && Number.isFinite(item[key])) {
      return Math.max(0, item[key]);
    }
  }
  return null;
}

function readCompletionMetric(item) {
  const inputMetric = firstFiniteMetric(item, ['input_tokens', 'prompt_tokens']);
  const outputMetric = firstFiniteMetric(item, ['output_tokens', 'completion_tokens']);
  const reportedTotal = firstFiniteMetric(item, ['total_tokens']);
  const genericTotal = firstFiniteMetric(item, ['tokens']);
  const componentTotal = (inputMetric || 0) + (outputMetric || 0);

  return {
    requests: firstFiniteMetric(item, ['num_model_requests', 'request_count', 'num_requests', 'count']) || 0,
    inputTokens: inputMetric || 0,
    outputTokens: outputMetric || 0,
    cachedTokens: firstFiniteMetric(item, ['input_cached_tokens', 'cached_tokens']) || 0,
    tokens: reportedTotal !== null
      ? reportedTotal
      : (inputMetric !== null || outputMetric !== null ? componentTotal : (genericTotal || 0)),
  };
}

function createAggregate() {
  return {
    requests: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    trackedDates: new Set(),
    activeDates: new Set(),
    models: new Map(),
  };
}

function createModelAggregate(model) {
  return {
    model,
    requests: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    activeDates: new Set(),
    latestDate: null,
  };
}

function addMetric(target, metric) {
  target.requests += metric.requests;
  target.tokens += metric.tokens;
  target.inputTokens += metric.inputTokens;
  target.outputTokens += metric.outputTokens;
  target.cachedTokens += metric.cachedTokens;
}

function hasCompletionActivity(metric) {
  return metric.requests > 0
    || metric.tokens > 0
    || metric.inputTokens > 0
    || metric.outputTokens > 0
    || metric.cachedTokens > 0;
}

function aggregateCompletionEntries(entries, startDate, endDate, includeDaily = false) {
  const startKey = formatDateKey(startDate);
  const endKey = formatDateKey(endDate);
  const aggregate = createAggregate();
  const dailyMap = new Map();

  if (includeDaily) {
    for (let date = startDate; date <= endDate; date = addUtcDays(date, 1)) {
      const dateKey = formatDateKey(date);
      dailyMap.set(dateKey, {
        date: dateKey,
        label: formatDateLabel(date, false),
        tracked: false,
        requests: 0,
        tokens: 0,
        models: new Map(),
      });
    }
  }

  entries.forEach((entry) => {
    const entryDate = parseDateKey(entry?.entry_date);
    if (!entryDate) {
      return;
    }

    const dateKey = formatDateKey(entryDate);
    if (dateKey < startKey || dateKey > endKey) {
      return;
    }

    aggregate.trackedDates.add(dateKey);
    const daily = dailyMap.get(dateKey);
    if (daily) {
      daily.tracked = true;
    }

    const completions = Array.isArray(entry.completions) ? entry.completions : [];
    completions.forEach((item) => {
      const metric = readCompletionMetric(item);
      if (!hasCompletionActivity(metric)) {
        return;
      }

      const model = typeof item?.model === 'string' && item.model.trim()
        ? item.model.trim()
        : 'unknown';
      let modelAggregate = aggregate.models.get(model);
      if (!modelAggregate) {
        modelAggregate = createModelAggregate(model);
        aggregate.models.set(model, modelAggregate);
      }

      addMetric(aggregate, metric);
      addMetric(modelAggregate, metric);
      aggregate.activeDates.add(dateKey);
      modelAggregate.activeDates.add(dateKey);
      if (!modelAggregate.latestDate || dateKey > modelAggregate.latestDate) {
        modelAggregate.latestDate = dateKey;
      }

      if (daily) {
        daily.requests += metric.requests;
        daily.tokens += metric.tokens;
        const dailyModel = daily.models.get(model) || { model, requests: 0, tokens: 0 };
        dailyModel.requests += metric.requests;
        dailyModel.tokens += metric.tokens;
        daily.models.set(model, dailyModel);
      }
    });
  });

  return {
    ...aggregate,
    dailyActivity: Array.from(dailyMap.values()).map((day) => ({
      ...day,
      models: Array.from(day.models.values()).sort((a, b) => {
        if (b.requests === a.requests) {
          return b.tokens - a.tokens;
        }
        return b.requests - a.requests;
      }),
    })),
  };
}

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function buildTrend(currentValue, previousValue, comparisonAvailable) {
  if (!comparisonAvailable) {
    return {
      direction: 'unavailable',
      percent: null,
      label: 'Not enough prior data to compare',
    };
  }

  if (previousValue === 0) {
    if (currentValue === 0) {
      return { direction: 'flat', percent: 0, label: 'No change from the previous period' };
    }
    return { direction: 'new', percent: null, label: 'New activity since the previous period' };
  }

  const signedPercent = ((currentValue - previousValue) / previousValue) * 100;
  const percent = Math.round(Math.abs(signedPercent));
  if (percent === 0) {
    return { direction: 'flat', percent: 0, label: 'About the same as the previous period' };
  }

  const direction = signedPercent > 0 ? 'up' : 'down';
  return {
    direction,
    percent,
    label: `${percent}% ${direction === 'up' ? 'higher' : 'lower'} than the previous period`,
  };
}

function buildCompletionInsights(entries, options = {}) {
  const requestedWindowDays = Number(options.windowDays);
  const windowDays = Number.isInteger(requestedWindowDays) && requestedWindowDays > 0
    ? requestedWindowDays
    : DEFAULT_COMPLETION_WINDOW_DAYS;
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  const validEntryDates = normalizedEntries
    .map((entry) => parseDateKey(entry?.entry_date))
    .filter(Boolean)
    .sort((a, b) => a - b);

  if (!validEntryDates.length) {
    return null;
  }

  const endDate = validEntryDates[validEntryDates.length - 1];
  const startDate = addUtcDays(endDate, -(windowDays - 1));
  const previousEndDate = addUtcDays(startDate, -1);
  const previousStartDate = addUtcDays(previousEndDate, -(windowDays - 1));
  const latestWeekStartDate = addUtcDays(endDate, -6);
  const latestWeekStartKey = formatDateKey(latestWeekStartDate);

  const recent = aggregateCompletionEntries(normalizedEntries, startDate, endDate, true);
  const previous = aggregateCompletionEntries(normalizedEntries, previousStartDate, previousEndDate);
  const minimumComparisonCoverage = Math.max(1, Math.ceil(windowDays * 0.8));
  const comparisonAvailable = recent.trackedDates.size >= minimumComparisonCoverage
    && previous.trackedDates.size >= minimumComparisonCoverage;

  const models = Array.from(recent.models.values())
    .map((model) => ({
      model: model.model,
      requests: model.requests,
      tokens: model.tokens,
      inputTokens: model.inputTokens,
      outputTokens: model.outputTokens,
      cachedTokens: model.cachedTokens,
      activeDays: model.activeDates.size,
      latestDate: model.latestDate,
      latestDateLabel: model.latestDate
        ? formatDateLabel(parseDateKey(model.latestDate), false)
        : 'N/A',
      requestShare: recent.requests > 0
        ? roundToOneDecimal((model.requests / recent.requests) * 100)
        : 0,
    }))
    .sort((a, b) => {
      if (b.requests === a.requests) {
        if (b.tokens === a.tokens) {
          return b.latestDate.localeCompare(a.latestDate);
        }
        return b.tokens - a.tokens;
      }
      return b.requests - a.requests;
    });

  const topModel = models[0] || null;
  const activeModelsLast7Days = models.filter((model) => model.latestDate >= latestWeekStartKey).length;
  const cacheRate = recent.inputTokens > 0
    ? roundToOneDecimal(Math.min(100, (recent.cachedTokens / recent.inputTokens) * 100))
    : 0;

  return {
    periodDays: windowDays,
    startDate: formatDateKey(startDate),
    endDate: formatDateKey(endDate),
    periodLabel: `${formatDateLabel(startDate)} – ${formatDateLabel(endDate)}`,
    previousStartDate: formatDateKey(previousStartDate),
    previousEndDate: formatDateKey(previousEndDate),
    trackedDays: recent.trackedDates.size,
    previousTrackedDays: previous.trackedDates.size,
    activeDays: recent.activeDates.size,
    requests: recent.requests,
    tokens: recent.tokens,
    inputTokens: recent.inputTokens,
    outputTokens: recent.outputTokens,
    cachedTokens: recent.cachedTokens,
    cacheRate,
    requestsPerActiveDay: recent.activeDates.size > 0
      ? roundToOneDecimal(recent.requests / recent.activeDates.size)
      : 0,
    requestTrend: buildTrend(recent.requests, previous.requests, comparisonAvailable),
    tokenTrend: buildTrend(recent.tokens, previous.tokens, comparisonAvailable),
    comparisonAvailable,
    activeModels: models.length,
    activeModelsLast7Days,
    topModel,
    models,
    dailyActivity: recent.dailyActivity,
    hasActivity: recent.requests > 0 || recent.tokens > 0,
  };
}

module.exports = {
  DEFAULT_COMPLETION_WINDOW_DAYS,
  buildCompletionInsights,
  readCompletionMetric,
};
