const {
  buildCompletionInsights,
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
});
