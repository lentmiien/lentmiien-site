const {
  RequestCounterSettingsError,
  REQUEST_COUNTER_LIMIT,
  REQUEST_COUNTER_WINDOW_MS,
  buildCompleteRetentionDayRanges,
  calculateRequestCounterLimitTiming,
  fetchDailyMinuteStats,
  fetchRollingWindowSeries,
  getCurrentRequestCounterStatus,
  normalizeRequestCategory,
  recordAndEvaluateRequest,
  updateRequestCounterSettings,
} = require('../../services/incomingRequestCounterService');

function createLeanQuery(result) {
  const exec = jest.fn().mockResolvedValue(result);
  const lean = jest.fn().mockReturnValue({ exec });
  return { lean, exec };
}

function createFindChain(result) {
  const leanQuery = createLeanQuery(result);
  const select = jest.fn().mockReturnValue(leanQuery);
  const sort = jest.fn().mockReturnValue({ select });
  return { sort, select, leanQuery };
}

function createRequest(overrides = {}) {
  return {
    baseUrl: '/secret-counter',
    originalUrl: '/secret-counter?source=test',
    method: 'GET',
    ip: '203.0.113.10',
    ips: ['203.0.113.10'],
    query: { source: 'test' },
    get: jest.fn((name) => {
      const headers = {
        'user-agent': 'counter-client/1.0',
        referer: 'https://example.test/',
      };
      return headers[name.toLowerCase()];
    }),
    ...overrides,
  };
}

describe('incoming request counter service', () => {
  test('allows the request while the previous 90-minute count is below 60', async () => {
    const model = {
      countDocuments: jest.fn().mockResolvedValue(59),
      create: jest.fn().mockResolvedValue({}),
    };
    const now = new Date('2026-05-27T00:00:00.000Z');

    const result = await recordAndEvaluateRequest(createRequest(), {
      model,
      now,
      settings: { maxRequests: 60, windowMinutes: 90 },
    });

    expect(result).toMatchObject({
      allowed: true,
      countInWindow: 60,
      limit: REQUEST_COUNTER_LIMIT,
      windowMs: REQUEST_COUNTER_WINDOW_MS,
      responseStatusCode: 200,
      responseText: 'OK',
    });
    expect(model.countDocuments).toHaveBeenCalledWith({
      endpointPath: '/secret-counter',
      receivedAt: { $gte: new Date('2026-05-26T22:30:00.000Z') },
    });
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({
      endpointPath: '/secret-counter',
      requestPath: '/secret-counter?source=test',
      method: 'GET',
      ip: '203.0.113.10',
      userAgent: 'counter-client/1.0',
      referer: 'https://example.test/',
      category: 'unknown',
      query: { source: 'test' },
      receivedAt: now,
      countInWindow: 60,
      allowed: true,
      responseStatusCode: 200,
      responseText: 'OK',
    }));
  });

  test('categorizes requests by the package query parameter', async () => {
    const model = {
      countDocuments: jest.fn().mockResolvedValue(4),
      create: jest.fn().mockResolvedValue({}),
    };

    await recordAndEvaluateRequest(createRequest({
      originalUrl: '/secret-counter?package=com.example.app',
      query: { package: 'com.example.app' },
    }), {
      model,
      now: new Date('2026-05-27T00:00:00.000Z'),
      settings: { maxRequests: 60, windowMinutes: 90 },
    });

    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({
      category: 'com.example.app',
      query: { package: 'com.example.app' },
    }));
  });

  test('normalizes missing and empty request categories to unknown', () => {
    expect(normalizeRequestCategory(undefined)).toBe('unknown');
    expect(normalizeRequestCategory('   ')).toBe('unknown');
    expect(normalizeRequestCategory(['', 'client-package'])).toBe('client-package');
  });

  test('blocks the request once 60 requests already exist in the window', async () => {
    const model = {
      countDocuments: jest.fn().mockResolvedValue(60),
      create: jest.fn().mockResolvedValue({}),
    };

    const result = await recordAndEvaluateRequest(createRequest(), {
      model,
      now: new Date('2026-05-27T00:00:00.000Z'),
      settings: { maxRequests: 60, windowMinutes: 90 },
    });

    expect(result).toMatchObject({
      allowed: false,
      countInWindow: 61,
      responseStatusCode: 429,
      responseText: 'NG',
    });
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({
      countInWindow: 61,
      allowed: false,
      responseStatusCode: 429,
      responseText: 'NG',
    }));
  });

  test('uses live settings for the limit and rolling window length', async () => {
    const model = {
      countDocuments: jest.fn().mockResolvedValue(119),
      create: jest.fn().mockResolvedValue({}),
    };
    const now = new Date('2026-05-27T00:00:00.000Z');

    const result = await recordAndEvaluateRequest(createRequest(), {
      model,
      now,
      settings: { maxRequests: 120, windowMinutes: 45 },
    });

    expect(result).toMatchObject({
      allowed: true,
      countInWindow: 120,
      limit: 120,
      windowMinutes: 45,
      responseStatusCode: 200,
      responseText: 'OK',
    });
    expect(model.countDocuments).toHaveBeenCalledWith({
      endpointPath: '/secret-counter',
      receivedAt: { $gte: new Date('2026-05-26T23:15:00.000Z') },
    });
  });

  test('updateRequestCounterSettings validates and persists admin changes', async () => {
    const settingsModel = {
      findOneAndUpdate: jest.fn().mockReturnValue(createLeanQuery({
        key: 'default',
        maxRequests: 120,
        windowMinutes: 45,
        updatedBy: 'admin-user',
      })),
    };

    const result = await updateRequestCounterSettings(
      { maxRequests: '120', windowMinutes: '45' },
      { settingsModel, updatedBy: 'admin-user' }
    );

    expect(settingsModel.findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'default' },
      {
        $set: {
          maxRequests: 120,
          windowMinutes: 45,
          updatedBy: 'admin-user',
        },
        $setOnInsert: {
          key: 'default',
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );
    expect(result).toMatchObject({
      maxRequests: 120,
      windowMinutes: 45,
      windowMs: 45 * 60 * 1000,
      updatedBy: 'admin-user',
    });
  });

  test('updateRequestCounterSettings rejects out-of-range values', async () => {
    await expect(updateRequestCounterSettings(
      { maxRequests: '0', windowMinutes: '45' },
      { settingsModel: {} }
    )).rejects.toBeInstanceOf(RequestCounterSettingsError);
  });

  test('fetchRollingWindowSeries builds per-minute rolling counts', async () => {
    const rows = [
      { receivedAt: new Date('2026-05-27T00:00:30.000Z') },
      { receivedAt: new Date('2026-05-27T00:01:45.000Z') },
      { receivedAt: new Date('2026-05-27T00:03:00.000Z') },
    ];
    const chain = createFindChain(rows);
    const model = {
      find: jest.fn().mockReturnValue({ sort: chain.sort }),
    };

    const series = await fetchRollingWindowSeries(
      '/secret-counter',
      { windowMinutes: 3, windowMs: 3 * 60 * 1000 },
      {
        model,
        now: new Date('2026-05-27T00:03:30.000Z'),
      }
    );

    expect(model.find).toHaveBeenCalledWith({
      endpointPath: '/secret-counter',
      receivedAt: {
        $gte: new Date('2026-05-26T23:58:00.000Z'),
        $lte: new Date('2026-05-27T00:03:30.000Z'),
      },
    });
    expect(chain.sort).toHaveBeenCalledWith({ receivedAt: 1 });
    expect(chain.select).toHaveBeenCalledWith({ receivedAt: 1 });
    expect(series.map((point) => point.count)).toEqual([2, 2, 3]);
    expect(series.map((point) => point.timestamp)).toEqual([
      '2026-05-27T00:01:00.000Z',
      '2026-05-27T00:02:00.000Z',
      '2026-05-27T00:03:00.000Z',
    ]);
  });

  test('calculateRequestCounterLimitTiming accounts for minutes sliding out before the limit is reached', () => {
    const now = new Date('2026-05-27T00:10:00.000Z');
    const timing = calculateRequestCounterLimitTiming(
      [
        new Date('2026-05-27T00:05:30.000Z'),
        new Date('2026-05-27T00:06:30.000Z'),
      ],
      { maxRequests: 4, windowMinutes: 5 },
      now
    );

    expect(timing).toEqual({
      mode: 'until_max',
      minutes: 4,
    });
  });

  test('calculateRequestCounterLimitTiming reports infinity when the limit exceeds the window length', () => {
    const now = new Date('2026-05-27T00:10:00.000Z');
    const timing = calculateRequestCounterLimitTiming(
      [
        new Date('2026-05-27T00:08:00.000Z'),
        new Date('2026-05-27T00:09:00.000Z'),
      ],
      { maxRequests: 4, windowMinutes: 3 },
      now
    );

    expect(timing).toEqual({
      mode: 'infinite',
      minutes: null,
    });
  });

  test('calculateRequestCounterLimitTiming reports time until dropping below the limit', () => {
    const now = new Date('2026-05-27T00:10:00.000Z');
    const timing = calculateRequestCounterLimitTiming(
      [
        new Date('2026-05-27T00:05:30.000Z'),
        new Date('2026-05-27T00:06:30.000Z'),
        new Date('2026-05-27T00:07:00.000Z'),
        new Date('2026-05-27T00:08:00.000Z'),
      ],
      { maxRequests: 3, windowMinutes: 5 },
      now
    );

    expect(timing).toEqual({
      mode: 'until_below_max',
      minutes: 2,
    });
  });

  test('buildCompleteRetentionDayRanges includes only full local days in retention', () => {
    const ranges = buildCompleteRetentionDayRanges(new Date(2026, 4, 28, 15, 0, 0));

    expect(ranges.map((range) => range.dateKey)).toEqual([
      '2026-05-22',
      '2026-05-23',
      '2026-05-24',
      '2026-05-25',
      '2026-05-26',
      '2026-05-27',
    ]);
  });

  test('fetchDailyMinuteStats counts category minutes per complete day', async () => {
    const model = {
      aggregate: jest.fn((pipeline) => {
        const start = pipeline[0].$match.receivedAt.$gte;
        const dateKey = [
          start.getFullYear(),
          String(start.getMonth() + 1).padStart(2, '0'),
          String(start.getDate()).padStart(2, '0'),
        ].join('-');
        const rows = {
          '2026-05-22': [{ _id: null, minutes: 10 }, { _id: 'package-a', minutes: 2 }],
          '2026-05-23': [{ _id: 'package-a', minutes: 20 }],
          '2026-05-24': [],
          '2026-05-25': [{ _id: 'package-b', minutes: 7 }],
          '2026-05-26': [{ _id: '', minutes: 4 }, { _id: 'package-b', minutes: 5 }],
          '2026-05-27': [{ _id: 'package-c', minutes: 15 }],
        };
        return Promise.resolve(rows[dateKey] || []);
      }),
    };

    const stats = await fetchDailyMinuteStats('/secret-counter', {
      model,
      now: new Date(2026, 4, 28, 15, 0, 0),
    });

    expect(stats.map((row) => ({
      dateKey: row.dateKey,
      totalMinutes: row.totalMinutes,
      categories: row.categories,
    }))).toEqual([
      {
        dateKey: '2026-05-22',
        totalMinutes: 12,
        categories: [{ name: 'unknown', minutes: 10 }, { name: 'package-a', minutes: 2 }],
      },
      {
        dateKey: '2026-05-23',
        totalMinutes: 20,
        categories: [{ name: 'package-a', minutes: 20 }],
      },
      { dateKey: '2026-05-24', totalMinutes: 0, categories: [] },
      {
        dateKey: '2026-05-25',
        totalMinutes: 7,
        categories: [{ name: 'package-b', minutes: 7 }],
      },
      {
        dateKey: '2026-05-26',
        totalMinutes: 9,
        categories: [{ name: 'unknown', minutes: 4 }, { name: 'package-b', minutes: 5 }],
      },
      {
        dateKey: '2026-05-27',
        totalMinutes: 15,
        categories: [{ name: 'package-c', minutes: 15 }],
      },
    ]);
    expect(model.aggregate).toHaveBeenCalledTimes(6);
  });

  test('getCurrentRequestCounterStatus counts the rolling window without saving a request', async () => {
    const model = {
      countDocuments: jest.fn().mockResolvedValue(42),
      create: jest.fn(),
    };
    const now = new Date('2026-05-27T00:00:00.000Z');

    const result = await getCurrentRequestCounterStatus('/secret-counter', {
      model,
      now,
      settings: { maxRequests: 60, windowMinutes: 90 },
    });

    expect(model.countDocuments).toHaveBeenCalledWith({
      endpointPath: '/secret-counter',
      receivedAt: { $gte: new Date('2026-05-26T22:30:00.000Z') },
    });
    expect(model.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      endpointPath: '/secret-counter',
      status: 'OK',
      allowed: true,
      countInWindow: 42,
      limit: 60,
      remaining: 18,
      windowMinutes: 90,
      wouldReturnStatusCode: 200,
    });
  });

  test('getCurrentRequestCounterStatus reports NG when the current count reaches the limit', async () => {
    const model = {
      countDocuments: jest.fn().mockResolvedValue(60),
      create: jest.fn(),
    };

    const result = await getCurrentRequestCounterStatus('/secret-counter', {
      model,
      now: new Date('2026-05-27T00:00:00.000Z'),
      settings: { maxRequests: 60, windowMinutes: 90 },
    });

    expect(model.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'NG',
      allowed: false,
      countInWindow: 60,
      limit: 60,
      remaining: 0,
      wouldReturnStatusCode: 429,
    });
  });
});
