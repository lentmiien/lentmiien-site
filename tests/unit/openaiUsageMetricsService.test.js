const {
  buildCompletionInsights,
  buildDeprecationInsights,
  buildSpendingInsights,
  readCompletionMetric,
} = require('../../services/openaiUsageMetricsService');

function dateRange(start, days) {
  const startDate = new Date(`${start}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(startDate.getTime() + (index * 24 * 60 * 60 * 1000));
    return date.toISOString().slice(0, 10);
  });
}

describe('openaiUsageMetricsService', () => {
  test('ranks models inside the recent window instead of by lifetime usage', () => {
    const previousEntries = dateRange('2026-05-02', 30).map((entryDate) => ({
      entry_date: entryDate,
      completions: [{
        model: 'gpt-5-codex',
        num_model_requests: 2,
        input_tokens: 200,
        output_tokens: 50,
      }],
    }));
    const recentEntries = dateRange('2026-06-01', 30).map((entryDate) => ({
      entry_date: entryDate,
      completions: [{
        model: 'gpt-6-codex',
        num_model_requests: 5,
        input_tokens: 400,
        output_tokens: 100,
      }],
    }));
    const lifetimePeak = {
      entry_date: '2025-01-15',
      completions: [{
        model: 'gpt-5-codex',
        num_model_requests: 100000,
        input_tokens: 10000000,
        output_tokens: 1000000,
      }],
    };

    const result = buildCompletionInsights([
      lifetimePeak,
      ...previousEntries,
      ...recentEntries,
    ]);

    expect(result.periodLabel).toBe('Jun 1, 2026 – Jun 30, 2026');
    expect(result.topModel.model).toBe('gpt-6-codex');
    expect(result.models.map((model) => model.model)).toEqual(['gpt-6-codex']);
    expect(result.requests).toBe(150);
    expect(result.requestTrend).toMatchObject({ direction: 'up', percent: 150 });
  });

  test('reports cached input separately instead of double-counting it as total tokens', () => {
    const metric = readCompletionMetric({
      num_model_requests: 3,
      input_tokens: 100,
      output_tokens: 40,
      input_cached_tokens: 60,
      total_tokens: 140,
    });

    expect(metric).toEqual({
      requests: 3,
      inputTokens: 100,
      outputTokens: 40,
      cachedTokens: 60,
      tokens: 140,
    });
  });

  test('anchors the window to the latest stored day and marks untracked days', () => {
    const result = buildCompletionInsights([
      {
        entry_date: '2026-07-08',
        completions: [{ model: 'gpt-latest', num_model_requests: 4, total_tokens: 80 }],
      },
      {
        entry_date: '2026-07-10',
        completions: [{ model: 'gpt-latest', num_model_requests: 6, total_tokens: 120 }],
      },
    ], { windowDays: 3 });

    expect(result.startDate).toBe('2026-07-08');
    expect(result.endDate).toBe('2026-07-10');
    expect(result.trackedDays).toBe(2);
    expect(result.dailyActivity).toEqual([
      expect.objectContaining({ date: '2026-07-08', tracked: true, requests: 4 }),
      expect.objectContaining({ date: '2026-07-09', tracked: false, requests: 0 }),
      expect.objectContaining({ date: '2026-07-10', tracked: true, requests: 6 }),
    ]);
    expect(result.requestTrend.direction).toBe('unavailable');
  });

  test('warns about recently used models deprecated or due within three months', () => {
    const completionInsights = buildCompletionInsights([{
      entry_date: '2026-07-14',
      completions: [
        { model: 'gpt-4o-search-preview-2025-03-11', num_model_requests: 4, total_tokens: 400 },
        { model: 'already-deprecated', num_model_requests: 2, total_tokens: 200 },
        { model: 'outside-warning-window', num_model_requests: 3, total_tokens: 300 },
        { model: 'no-date-set', num_model_requests: 5, total_tokens: 500 },
        { model: 'missing-model-card', num_model_requests: 6, total_tokens: 600 },
      ],
    }]);
    const result = buildDeprecationInsights(completionInsights, [
      {
        api_model: 'gpt-4o-search-preview-2025-03-11',
        deprecation_date: new Date('2026-07-23T00:00:00.000Z'),
      },
      { api_model: 'already-deprecated', deprecation_date: new Date('2026-07-01T00:00:00.000Z') },
      { api_model: 'outside-warning-window', deprecation_date: new Date('2026-10-16T00:00:00.000Z') },
      { api_model: 'no-date-set', deprecation_date: null },
    ], { referenceDate: '2026-07-15' });

    expect(result.warningEndDate).toBe('2026-10-15');
    expect(result.totalAtRiskRequests).toBe(6);
    expect(result.atRiskModels.map((model) => model.apiModel)).toEqual([
      'gpt-4o-search-preview-2025-03-11',
      'already-deprecated',
    ]);
    expect(result.atRiskModels[0]).toMatchObject({
      deprecationDate: '2026-07-23',
      daysUntilDeprecation: 8,
      deprecationStatus: 'scheduled',
    });
    expect(result.atRiskModels[1].deprecationStatus).toBe('deprecated');
    expect(result.unknownModels).toEqual([
      expect.objectContaining({ apiModel: 'missing-model-card', requests: 6 }),
    ]);
    expect(result.isClear).toBe(false);
  });

  test('uses a clamped calendar-month boundary and reports a clear zero state', () => {
    const completionInsights = buildCompletionInsights([{
      entry_date: '2026-01-31',
      completions: [{ model: 'current-model', num_model_requests: 7, total_tokens: 700 }],
    }]);
    const result = buildDeprecationInsights(completionInsights, [{
      api_model: 'current-model',
      deprecation_date: null,
    }], { referenceDate: '2026-01-31' });

    expect(result.warningEndDate).toBe('2026-04-30');
    expect(result.totalAtRiskRequests).toBe(0);
    expect(result.atRiskModels).toEqual([]);
    expect(result.unknownModels).toEqual([]);
    expect(result.isClear).toBe(true);
  });

  test('combines API and ChatGPT costs into an all-time total and centered average', () => {
    const monthlyTimeline = Array.from({ length: 7 }, (_, index) => ({
      month: `2026-${String(index + 1).padStart(2, '0')}`,
      label: `Month ${index + 1}`,
      apiCost: index + 1,
      subscriptionCost: (index + 1) * 10,
    }));

    const result = buildSpendingInsights(monthlyTimeline, [], { currentMonth: '2026-08' });

    expect(result.totalApiSpend).toBe(28);
    expect(result.totalSubscriptionSpend).toBe(280);
    expect(result.totalSpend).toBe(308);
    expect(result.monthsIncluded).toBe(7);
    expect(result.rollingAveragePointCount).toBe(3);
    expect(result.monthlySpending.map((entry) => entry.centeredAverageCost)).toEqual([
      null,
      null,
      33,
      44,
      55,
      null,
      null,
    ]);
    expect(result.monthlySpending[2]).toMatchObject({
      averageWindowStart: '2026-01',
      averageWindowEnd: '2026-05',
    });
  });

  test('does not use the current partial month in a centered spending average', () => {
    const monthlyTimeline = Array.from({ length: 8 }, (_, index) => ({
      month: `2026-${String(index + 1).padStart(2, '0')}`,
      apiCost: 10,
      subscriptionCost: 20,
    }));

    const result = buildSpendingInsights(monthlyTimeline, [], { currentMonth: '2026-07' });

    expect(result.rollingAveragePointCount).toBe(2);
    expect(result.monthsIncluded).toBe(7);
    expect(result.totalSpend).toBe(210);
    expect(result.monthlySpending[3].centeredAverageCost).toBe(30);
    expect(result.monthlySpending[4].centeredAverageCost).toBeNull();
  });

  test('groups API costs by UTC weekday and averages duplicate dates once', () => {
    const result = buildSpendingInsights([
      { month: '2026-07', apiCost: 12, subscriptionCost: 20 },
    ], [
      { entry_date: '2026-07-13', cost: 1 },
      { entry_date: '2026-07-13', cost: 2 },
      { entry_date: '2026-07-14', cost: 4 },
      { entry_date: '2026-07-20', cost: 5 },
      { entry_date: 'not-a-date', cost: 100 },
    ]);

    expect(result.weekdayTrackedDays).toBe(3);
    expect(result.weekdaySpending[0]).toMatchObject({
      label: 'Monday',
      totalCost: 8,
      trackedDays: 2,
      averageCost: 4,
    });
    expect(result.weekdaySpending[1]).toMatchObject({
      label: 'Tuesday',
      totalCost: 4,
      trackedDays: 1,
      averageCost: 4,
    });
    expect(result.weekdaySpending[0].sharePercent).toBeCloseTo(66.7, 1);
  });
});
