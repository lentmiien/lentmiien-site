const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_COMPLETION_WINDOW_DAYS = 30;
const DEFAULT_DEPRECATION_WARNING_MONTHS = 3;
const CENTERED_SPENDING_WINDOW_MONTHS = 5;
const WEEKDAYS = [
  { dayIndex: 1, label: 'Monday', shortLabel: 'Mon' },
  { dayIndex: 2, label: 'Tuesday', shortLabel: 'Tue' },
  { dayIndex: 3, label: 'Wednesday', shortLabel: 'Wed' },
  { dayIndex: 4, label: 'Thursday', shortLabel: 'Thu' },
  { dayIndex: 5, label: 'Friday', shortLabel: 'Fri' },
  { dayIndex: 6, label: 'Saturday', shortLabel: 'Sat' },
  { dayIndex: 0, label: 'Sunday', shortLabel: 'Sun' },
];

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

function addUtcMonthsClamped(date, months) {
  const targetMonthStart = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + months,
    1,
  ));
  const lastDayOfTargetMonth = new Date(Date.UTC(
    targetMonthStart.getUTCFullYear(),
    targetMonthStart.getUTCMonth() + 1,
    0,
  )).getUTCDate();

  targetMonthStart.setUTCDate(Math.min(date.getUTCDate(), lastDayOfTargetMonth));
  return targetMonthStart;
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

function nonNegativeNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0;
}

function buildWeekdaySpending(entries) {
  const dailyCosts = new Map();

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const date = parseDateKey(entry?.entry_date);
    if (!date) {
      return;
    }

    const dateKey = formatDateKey(date);
    dailyCosts.set(dateKey, (dailyCosts.get(dateKey) || 0) + nonNegativeNumber(entry.cost));
  });

  const weekdayMap = new Map(WEEKDAYS.map((weekday) => [weekday.dayIndex, {
    ...weekday,
    totalCost: 0,
    trackedDays: 0,
  }]));

  dailyCosts.forEach((cost, dateKey) => {
    const date = parseDateKey(dateKey);
    const weekday = date ? weekdayMap.get(date.getUTCDay()) : null;
    if (!weekday) {
      return;
    }

    weekday.totalCost += cost;
    weekday.trackedDays += 1;
  });

  const totalApiSpend = Array.from(dailyCosts.values())
    .reduce((total, cost) => total + cost, 0);

  return WEEKDAYS.map(({ dayIndex }) => {
    const weekday = weekdayMap.get(dayIndex);
    return {
      label: weekday.label,
      shortLabel: weekday.shortLabel,
      totalCost: weekday.totalCost,
      trackedDays: weekday.trackedDays,
      averageCost: weekday.trackedDays > 0
        ? weekday.totalCost / weekday.trackedDays
        : 0,
      sharePercent: totalApiSpend > 0
        ? roundToOneDecimal((weekday.totalCost / totalApiSpend) * 100)
        : 0,
    };
  });
}

function buildSpendingInsights(monthlyTimeline, entries, options = {}) {
  const currentMonth = typeof options.currentMonth === 'string'
    && /^\d{4}-\d{2}$/.test(options.currentMonth)
    ? options.currentMonth
    : null;
  const normalizedTimeline = (Array.isArray(monthlyTimeline) ? monthlyTimeline : [])
    .filter((entry) => typeof entry?.month === 'string' && /^\d{4}-\d{2}$/.test(entry.month))
    .map((entry) => {
      const apiCost = nonNegativeNumber(entry.apiCost);
      const subscriptionCost = nonNegativeNumber(entry.subscriptionCost);
      return {
        month: entry.month,
        label: typeof entry.label === 'string' && entry.label ? entry.label : entry.month,
        apiCost,
        subscriptionCost,
        totalCost: apiCost + subscriptionCost,
      };
    })
    .filter((entry) => !currentMonth || entry.month <= currentMonth)
    .sort((a, b) => a.month.localeCompare(b.month));

  if (!normalizedTimeline.length) {
    return null;
  }

  const windowRadius = Math.floor(CENTERED_SPENDING_WINDOW_MONTHS / 2);
  const monthlySpending = normalizedTimeline.map((entry, index) => {
    const windowStartIndex = index - windowRadius;
    const windowEndIndex = index + windowRadius;
    const hasFullWindow = windowStartIndex >= 0 && windowEndIndex < normalizedTimeline.length;
    const window = hasFullWindow
      ? normalizedTimeline.slice(windowStartIndex, windowEndIndex + 1)
      : [];
    const usesIncompleteMonth = currentMonth
      ? window.some((windowEntry) => windowEntry.month >= currentMonth)
      : false;
    const centeredAverageCost = hasFullWindow && !usesIncompleteMonth
      ? window.reduce((total, windowEntry) => total + windowEntry.totalCost, 0)
        / CENTERED_SPENDING_WINDOW_MONTHS
      : null;

    return {
      ...entry,
      centeredAverageCost,
      averageWindowStart: centeredAverageCost === null ? null : window[0].month,
      averageWindowEnd: centeredAverageCost === null ? null : window[window.length - 1].month,
    };
  });
  const totalApiSpend = normalizedTimeline
    .reduce((total, entry) => total + entry.apiCost, 0);
  const totalSubscriptionSpend = normalizedTimeline
    .reduce((total, entry) => total + entry.subscriptionCost, 0);
  const weekdaySpending = buildWeekdaySpending(entries);

  return {
    totalSpend: totalApiSpend + totalSubscriptionSpend,
    totalApiSpend,
    totalSubscriptionSpend,
    monthsIncluded: normalizedTimeline.length,
    periodStart: normalizedTimeline[0].month,
    periodStartLabel: normalizedTimeline[0].label,
    periodEnd: normalizedTimeline[normalizedTimeline.length - 1].month,
    periodEndLabel: normalizedTimeline[normalizedTimeline.length - 1].label,
    periodEndIsCurrentMonth: currentMonth === normalizedTimeline[normalizedTimeline.length - 1].month,
    rollingWindowMonths: CENTERED_SPENDING_WINDOW_MONTHS,
    rollingAveragePointCount: monthlySpending
      .filter((entry) => entry.centeredAverageCost !== null).length,
    monthlySpending,
    weekdaySpending,
    weekdayTrackedDays: weekdaySpending
      .reduce((total, weekday) => total + weekday.trackedDays, 0),
  };
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

function dateOnlyFromValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return parseDateKey(formatDateKey(value));
  }

  if (typeof value === 'string') {
    return parseDateKey(value);
  }

  return null;
}

function modelDeprecationStatus(daysUntilDeprecation) {
  if (daysUntilDeprecation < 0) {
    const daysPast = Math.abs(daysUntilDeprecation);
    return {
      status: 'deprecated',
      label: `${daysPast} ${daysPast === 1 ? 'day' : 'days'} past deprecation`,
    };
  }

  if (daysUntilDeprecation === 0) {
    return { status: 'today', label: 'Deprecates today' };
  }

  return {
    status: 'scheduled',
    label: `Deprecates in ${daysUntilDeprecation} ${daysUntilDeprecation === 1 ? 'day' : 'days'}`,
  };
}

function buildDeprecationInsights(completionInsights, modelCards, options = {}) {
  if (!completionInsights || !Array.isArray(completionInsights.models)) {
    return null;
  }

  const requestedWarningMonths = Number(options.warningMonths);
  const warningMonths = Number.isInteger(requestedWarningMonths) && requestedWarningMonths > 0
    ? requestedWarningMonths
    : DEFAULT_DEPRECATION_WARNING_MONTHS;
  const referenceDate = dateOnlyFromValue(options.referenceDate) || dateOnlyFromValue(new Date());
  const warningEndDate = addUtcMonthsClamped(referenceDate, warningMonths);
  const warningEndKey = formatDateKey(warningEndDate);
  const modelCardMap = new Map();

  (Array.isArray(modelCards) ? modelCards : []).forEach((card) => {
    const apiModel = typeof card?.api_model === 'string' ? card.api_model.trim() : '';
    if (!apiModel) {
      return;
    }

    const deprecationDate = dateOnlyFromValue(card.deprecation_date);
    const existing = modelCardMap.get(apiModel);
    if (!existing
      || (!existing.deprecationDate && deprecationDate)
      || (existing.deprecationDate && deprecationDate && deprecationDate < existing.deprecationDate)) {
      modelCardMap.set(apiModel, { deprecationDate });
    }
  });

  const atRiskModels = [];
  const unknownModels = [];

  completionInsights.models.forEach((model) => {
    const apiModel = typeof model?.model === 'string' ? model.model.trim() : '';
    if (!apiModel) {
      return;
    }

    const modelCard = modelCardMap.get(apiModel);
    const usage = {
      apiModel,
      requests: nonNegativeNumber(model.requests),
      tokens: nonNegativeNumber(model.tokens),
      latestDate: typeof model.latestDate === 'string' ? model.latestDate : null,
      latestDateLabel: typeof model.latestDateLabel === 'string' ? model.latestDateLabel : 'N/A',
    };

    if (!modelCard) {
      unknownModels.push(usage);
      return;
    }

    if (!modelCard.deprecationDate) {
      return;
    }

    const deprecationDate = modelCard.deprecationDate;
    const deprecationDateKey = formatDateKey(deprecationDate);
    if (deprecationDateKey > warningEndKey) {
      return;
    }

    const daysUntilDeprecation = Math.round(
      (deprecationDate.getTime() - referenceDate.getTime()) / DAY_MS,
    );
    const deprecationStatus = modelDeprecationStatus(daysUntilDeprecation);
    atRiskModels.push({
      ...usage,
      deprecationDate: deprecationDateKey,
      deprecationDateLabel: formatDateLabel(deprecationDate),
      daysUntilDeprecation,
      deprecationStatus: deprecationStatus.status,
      deprecationStatusLabel: deprecationStatus.label,
    });
  });

  atRiskModels.sort((a, b) => {
    if (b.requests === a.requests) {
      return a.deprecationDate.localeCompare(b.deprecationDate);
    }
    return b.requests - a.requests;
  });
  unknownModels.sort((a, b) => b.requests - a.requests);

  const totalAtRiskRequests = atRiskModels
    .reduce((total, model) => total + model.requests, 0);
  const totalUnknownRequests = unknownModels
    .reduce((total, model) => total + model.requests, 0);
  const hasAtRiskUsage = atRiskModels.some((model) => model.requests > 0 || model.tokens > 0);

  return {
    warningMonths,
    referenceDate: formatDateKey(referenceDate),
    referenceDateLabel: formatDateLabel(referenceDate),
    warningEndDate: warningEndKey,
    warningEndDateLabel: formatDateLabel(warningEndDate),
    recentPeriodLabel: completionInsights.periodLabel,
    totalAtRiskRequests,
    totalUnknownRequests,
    atRiskModelCount: atRiskModels.length,
    unknownModelCount: unknownModels.length,
    hasAtRiskUsage,
    hasUnknownModels: unknownModels.length > 0,
    isClear: !hasAtRiskUsage && unknownModels.length === 0,
    atRiskModels,
    unknownModels,
  };
}

module.exports = {
  CENTERED_SPENDING_WINDOW_MONTHS,
  DEFAULT_COMPLETION_WINDOW_DAYS,
  DEFAULT_DEPRECATION_WARNING_MONTHS,
  buildCompletionInsights,
  buildDeprecationInsights,
  buildSpendingInsights,
  buildWeekdaySpending,
  readCompletionMetric,
};
