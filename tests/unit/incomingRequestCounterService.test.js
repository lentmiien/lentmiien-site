const {
  RequestCounterSettingsError,
  REQUEST_COUNTER_LIMIT,
  REQUEST_COUNTER_WINDOW_MS,
  buildCompleteRetentionDayRanges,
  fetchDailyMinuteStats,
  fetchRollingWindowSeries,
  getCurrentRequestCounterStatus,
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
      query: { source: 'test' },
      receivedAt: now,
      countInWindow: 60,
      allowed: true,
      responseStatusCode: 200,
      responseText: 'OK',
    }));
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

  test('fetchDailyMinuteStats counts total, OK, and NG minutes per complete day', async () => {
    const model = {
      countDocuments: jest.fn((query) => {
        const start = query.receivedAt.$gte;
        const dateKey = [
          start.getFullYear(),
          String(start.getMonth() + 1).padStart(2, '0'),
          String(start.getDate()).padStart(2, '0'),
        ].join('-');
        const totals = {
          '2026-05-22': 12,
          '2026-05-23': 20,
          '2026-05-24': 0,
          '2026-05-25': 7,
          '2026-05-26': 9,
          '2026-05-27': 15,
        };
        const ng = {
          '2026-05-22': 2,
          '2026-05-23': 0,
          '2026-05-24': 0,
          '2026-05-25': 1,
          '2026-05-26': 4,
          '2026-05-27': 5,
        };
        return Promise.resolve(query.allowed === false ? (ng[dateKey] || 0) : (totals[dateKey] || 0));
      }),
    };

    const stats = await fetchDailyMinuteStats('/secret-counter', {
      model,
      now: new Date(2026, 4, 28, 15, 0, 0),
    });

    expect(stats.map((row) => ({
      dateKey: row.dateKey,
      totalMinutes: row.totalMinutes,
      okMinutes: row.okMinutes,
      ngMinutes: row.ngMinutes,
    }))).toEqual([
      { dateKey: '2026-05-22', totalMinutes: 12, okMinutes: 10, ngMinutes: 2 },
      { dateKey: '2026-05-23', totalMinutes: 20, okMinutes: 20, ngMinutes: 0 },
      { dateKey: '2026-05-24', totalMinutes: 0, okMinutes: 0, ngMinutes: 0 },
      { dateKey: '2026-05-25', totalMinutes: 7, okMinutes: 6, ngMinutes: 1 },
      { dateKey: '2026-05-26', totalMinutes: 9, okMinutes: 5, ngMinutes: 4 },
      { dateKey: '2026-05-27', totalMinutes: 15, okMinutes: 10, ngMinutes: 5 },
    ]);
    expect(model.countDocuments).toHaveBeenCalledTimes(12);
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
