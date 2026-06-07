const {
  MINUTE_LOGGER_RESPONSE_BODY,
  buildRequestRecord,
  fetchDailyMinuteStats,
  getPackageName,
  parseLocationValue,
  recordMinuteLoggerRequest,
  summarizeLocationGroups,
  summarizeTimeBuckets,
} = require('../../services/minuteLoggerService');

function createLeanQuery(result) {
  const exec = jest.fn().mockResolvedValue(result);
  const lean = jest.fn().mockReturnValue({ exec });
  return { lean, exec };
}

function createRequest(overrides = {}) {
  return {
    baseUrl: '/secret-minute-logger',
    originalUrl: '/secret-minute-logger?source=unit',
    method: 'POST',
    ip: '203.0.113.50',
    ips: ['203.0.113.50'],
    query: { source: 'unit' },
    body: {
      package: 'com.example.app',
      deviceId: 'tablet-01',
      location: '35.4602514,139.54049637',
      extra: { value: 42 },
    },
    headers: {
      'user-agent': 'minute-client/1.0',
      referer: 'https://example.test/',
    },
    get: jest.fn((name) => {
      const headers = {
        'user-agent': 'minute-client/1.0',
        referer: 'https://example.test/',
        'x-package': 'header.package',
        'x-device-id': 'header-device',
      };
      return headers[name.toLowerCase()];
    }),
    ...overrides,
  };
}

describe('minuteLoggerService', () => {
  test('buildRequestRecord stores package, device id, query, and body data', () => {
    const now = new Date('2026-06-07T03:00:00.000Z');
    const record = buildRequestRecord(createRequest(), {
      now,
      endpointPath: '/secret-minute-logger',
    });

    expect(record).toMatchObject({
      endpointPath: '/secret-minute-logger',
      requestPath: '/secret-minute-logger?source=unit',
      method: 'POST',
      ip: '203.0.113.50',
      userAgent: 'minute-client/1.0',
      referer: 'https://example.test/',
      deviceId: 'tablet-01',
      package: 'com.example.app',
      location: {
        raw: '35.4602514,139.54049637',
        latitude: 35.4602514,
        longitude: 139.54049637,
        groupKey: '35.460,139.540',
      },
      query: { source: 'unit' },
      body: {
        package: 'com.example.app',
        deviceId: 'tablet-01',
        location: '35.4602514,139.54049637',
        extra: { value: 42 },
      },
      receivedAt: now,
      responseStatusCode: 200,
      responseBody: MINUTE_LOGGER_RESPONSE_BODY,
    });
  });

  test('uses package from the body before the header fallback', () => {
    expect(getPackageName(createRequest({
      body: {
        unrelated: 'not-a-package',
      },
      query: {},
    }))).toBe('header.package');

    expect(getPackageName(createRequest({
      body: {
        package: 'correct-package',
      },
    }))).toBe('correct-package');
  });

  test('parses location strings and ignores invalid coordinates', () => {
    expect(parseLocationValue('35.4602514,139.54049637')).toMatchObject({
      raw: '35.4602514,139.54049637',
      latitude: 35.4602514,
      longitude: 139.54049637,
      groupKey: '35.460,139.540',
    });

    expect(parseLocationValue('not-a-location')).toBeNull();
    expect(parseLocationValue('95,139')).toBeNull();
  });

  test('records a raw request and increments day and month rollups', async () => {
    const requestModel = {
      create: jest.fn().mockResolvedValue({ _id: 'request-1' }),
    };
    const statModel = {
      findOneAndUpdate: jest.fn().mockReturnValue(createLeanQuery({})),
    };
    const now = new Date('2026-06-07T03:04:00.000Z');

    const result = await recordMinuteLoggerRequest(createRequest(), {
      requestModel,
      statModel,
      endpointPath: '/secret-minute-logger',
      now,
    });

    expect(result).toMatchObject({
      logged: true,
      responseBody: { message: 'OK' },
    });
    expect(requestModel.create).toHaveBeenCalledWith(expect.objectContaining({
      endpointPath: '/secret-minute-logger',
      deviceId: 'tablet-01',
      package: 'com.example.app',
      location: expect.objectContaining({
        latitude: 35.4602514,
        longitude: 139.54049637,
        groupKey: '35.460,139.540',
      }),
      body: expect.objectContaining({
        package: 'com.example.app',
        deviceId: 'tablet-01',
      }),
    }));
    expect(statModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(statModel.findOneAndUpdate).toHaveBeenNthCalledWith(
      1,
      {
        endpointPath: '/secret-minute-logger',
        periodType: 'day',
        periodKey: '2026-06-07',
        deviceId: 'tablet-01',
        package: 'com.example.app',
      },
      expect.objectContaining({
        $inc: { minutes: 1 },
        $setOnInsert: expect.objectContaining({
          periodStart: expect.any(Date),
          expiresAt: expect.any(Date),
        }),
      }),
      expect.objectContaining({
        upsert: true,
      })
    );
    expect(statModel.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        periodType: 'month',
        periodKey: '2026-06',
        package: 'com.example.app',
      }),
      expect.objectContaining({
        $inc: { minutes: 1 },
      }),
      expect.objectContaining({
        upsert: true,
      })
    );
  });

  test('fetchDailyMinuteStats groups rollups by package', async () => {
    const statModel = {
      aggregate: jest.fn().mockResolvedValue([
        { _id: { periodKey: '2026-06-05', package: 'com.example.app' }, minutes: 12 },
        { _id: { periodKey: '2026-06-05', package: 'com.example.other' }, minutes: 3 },
      ]),
    };

    const rows = await fetchDailyMinuteStats('/secret-minute-logger', {
      statModel,
      now: new Date('2026-06-06T10:00:00.000Z'),
      days: 1,
    });

    expect(statModel.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        $match: expect.objectContaining({
          endpointPath: '/secret-minute-logger',
          periodType: 'day',
        }),
      }),
    ]));
    expect(rows).toEqual([
      {
        dateKey: '2026-06-05',
        totalMinutes: 15,
        categories: [
          { name: 'com.example.app', minutes: 12 },
          { name: 'com.example.other', minutes: 3 },
        ],
      },
    ]);
  });

  test('summarizeLocationGroups filters low-count location noise', () => {
    const summary = summarizeLocationGroups([
      {
        groupKey: '35.460,139.540',
        latitude: 35.4602,
        longitude: 139.5404,
        minutes: 8,
        deviceCount: 1,
        packageCount: 2,
      },
      {
        groupKey: '35.461,139.541',
        latitude: 35.461,
        longitude: 139.541,
        minutes: 2,
        deviceCount: 1,
        packageCount: 1,
      },
    ], {
      minMinutes: 3,
    });

    expect(summary).toMatchObject({
      totalLocationMinutes: 10,
      groupedLocationMinutes: 8,
      noiseLocationMinutes: 2,
      noiseGroupCount: 1,
      totalGroupCount: 1,
      noiseThresholdMinutes: 3,
    });
    expect(summary.groups).toEqual([
      expect.objectContaining({
        groupKey: '35.460,139.540',
        minutes: 8,
      }),
    ]);
  });

  test('summarizeTimeBuckets identifies the busiest local period', () => {
    const summary = summarizeTimeBuckets([
      { hour: 9, minutes: 5 },
      { hour: 18, minutes: 20 },
      { hour: 23, minutes: 6 },
    ], 5);

    expect(summary.busiest).toMatchObject({
      key: 'evening',
      label: 'Evening',
      minutes: 20,
      averagePerDay: 4,
    });
  });
});
