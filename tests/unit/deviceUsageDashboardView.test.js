const {
  mapRecentRequest,
} = require('../../utils/deviceUsageDashboardView');

describe('device usage dashboard view helpers', () => {
  test('formats stored response payloads for recent request previews', () => {
    const mapped = mapRecentRequest({
      receivedAt: new Date('2026-06-19T12:34:00.000Z'),
      packageCategory: 'entertainment',
      packageName: 'com.example.game',
      allowed: false,
      statusText: 'NG',
      action: 'learn_first',
      reasonCode: 'learning_required',
      countsTowardLimit: false,
      learningMinutesTodayAfter: 12,
      countedMinutesInWindowAfter: 4,
      responsePayload: {
        version: 1,
        status: 'NG',
        allowed: false,
        action: 'learn_first',
        messages: {
          en: 'Entertainment is locked until learning is complete.',
        },
      },
    });

    expect(mapped.hasResponseBody).toBe(true);
    expect(mapped.responseBodyPreview).toContain('"status":"NG"');
    expect(mapped.responseBodyPreview.length).toBeLessThanOrEqual(180);
    expect(mapped.responseBodyDisplay).toContain('\n  "status": "NG"');
    expect(mapped.responseBodyDisplay).toContain('"messages": {');
  });

  test('uses N/A when older recent request rows have no stored response body', () => {
    const mapped = mapRecentRequest({
      receivedAt: new Date('2026-06-19T12:34:00.000Z'),
      packageCategory: 'learning',
      packageName: 'com.example.learning',
      allowed: true,
      action: 'allow',
    });

    expect(mapped.hasResponseBody).toBe(false);
    expect(mapped.responseBodyPreview).toBe('N/A');
    expect(mapped.responseBodyDisplay).toBe('N/A');
  });
});
