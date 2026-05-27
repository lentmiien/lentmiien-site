const {
  RequestCounterSettingsError,
  REQUEST_COUNTER_LIMIT,
  REQUEST_COUNTER_WINDOW_MS,
  fetchRollingWindowSeries,
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
});
