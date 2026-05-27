const {
  REQUEST_COUNTER_LIMIT,
  REQUEST_COUNTER_WINDOW_MS,
  recordAndEvaluateRequest,
} = require('../../services/incomingRequestCounterService');

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

    const result = await recordAndEvaluateRequest(createRequest(), { model, now });

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
});
