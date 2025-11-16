const { deriveAnalytics, mapToPlainObject, mergeThresholds, DEFAULT_THRESHOLDS } = require('../../utils/healthAnalytics');

describe('healthAnalytics utilities', () => {
  test('deriveAnalytics computes trends, rolling averages, and alerts', () => {
    const entries = [
      { dateOfEntry: '2024-01-01', basicData: { weight: '70' }, medicalRecord: {} },
      { dateOfEntry: '2024-01-02', basicData: { weight: '71' }, medicalRecord: {} },
      { dateOfEntry: '2024-01-03', basicData: { weight: '72' }, medicalRecord: {} },
    ];

    const analytics = deriveAnalytics(entries, {
      windowSize: 2,
      thresholds: { weight: { max: 71.5 } },
    });

    expect(Object.keys(analytics.metricSummaries)).toContain('weight');
    expect(analytics.metricSummaries.weight.trend).toBe('up');
    const rolling = analytics.metricSummaries.weight.rollingAverage;
    expect(rolling[rolling.length - 1].value).toBeCloseTo(71.5, 1);
    expect(analytics.alerts.some((alert) => alert.metric === 'weight')).toBe(true);
  });

  test('deriveAnalytics expands blood pressure readings into systolic/diastolic metrics', () => {
    const entries = [
      { dateOfEntry: '2024-02-01', basicData: {}, medicalRecord: { bloodPressure: '130/90' } },
    ];

    const analytics = deriveAnalytics(entries, { windowSize: 3 });
    expect(Object.keys(analytics.metricSummaries)).toEqual(
      expect.arrayContaining(['bloodpressure_systolic', 'bloodpressure_diastolic'])
    );
  });

  test('mapToPlainObject unwraps Map inputs', () => {
    const map = new Map([['weight', '70']]);
    expect(mapToPlainObject(map)).toEqual({ weight: '70' });
  });

  test('mergeThresholds combines defaults with overrides', () => {
    const result = mergeThresholds(DEFAULT_THRESHOLDS, { weight: { max: 80 } });
    expect(result.weight.max).toBe(80);
    expect(result.weight.min).toBe(DEFAULT_THRESHOLDS.weight.min);
  });
});
