const {
  buildRequestSnapshot,
  recordDummyApiOkRequest,
  updateDummyApiEndpointSettings,
} = require('../../services/dummyApiLogService');

function createLeanQuery(result) {
  const exec = jest.fn().mockResolvedValue(result);
  const lean = jest.fn().mockReturnValue({ exec });
  return { lean, exec };
}

function createRequest(overrides = {}) {
  return {
    method: 'POST',
    originalUrl: '/mydhlapi/test/ok?source=unit',
    baseUrl: '/mydhlapi/test',
    path: '/ok',
    route: { path: '/ok' },
    protocol: 'https',
    hostname: 'example.test',
    ip: '203.0.113.20',
    ips: ['203.0.113.20'],
    headers: {
      'content-type': 'application/json',
      'user-agent': 'dummy-client/1.0',
      referer: 'https://example.test/admin',
    },
    params: {},
    query: { source: 'unit' },
    body: { ok: true, nested: { value: 42 } },
    get: jest.fn((name) => {
      const headers = {
        'user-agent': 'dummy-client/1.0',
        referer: 'https://example.test/admin',
      };
      return headers[name.toLowerCase()];
    }),
    ...overrides,
  };
}

describe('dummyApiLogService', () => {
  test('does not create a request log when the endpoint is disabled', async () => {
    const logModel = {
      create: jest.fn(),
    };

    const result = await recordDummyApiOkRequest(createRequest(), {
      settings: { enabled: false },
      logModel,
      now: new Date('2026-06-01T00:00:00.000Z'),
    });

    expect(result).toEqual({
      enabled: false,
      logged: false,
      log: null,
    });
    expect(logModel.create).not.toHaveBeenCalled();
  });

  test('creates a raw request snapshot when the endpoint is enabled', async () => {
    const logModel = {
      create: jest.fn().mockResolvedValue({ _id: 'log-1' }),
    };
    const now = new Date('2026-06-01T00:00:00.000Z');

    const result = await recordDummyApiOkRequest(createRequest(), {
      settings: { enabled: true },
      logModel,
      now,
    });

    expect(result).toMatchObject({ enabled: true, logged: true });
    expect(logModel.create).toHaveBeenCalledWith(expect.objectContaining({
      receivedAt: now,
      method: 'POST',
      requestPath: '/mydhlapi/test/ok?source=unit',
      raw: expect.objectContaining({
        receivedAt: '2026-06-01T00:00:00.000Z',
        method: 'POST',
        originalUrl: '/mydhlapi/test/ok?source=unit',
        baseUrl: '/mydhlapi/test',
        path: '/ok',
        query: { source: 'unit' },
        body: { ok: true, nested: { value: 42 } },
        userAgent: 'dummy-client/1.0',
        referer: 'https://example.test/admin',
      }),
    }));
  });

  test('updateDummyApiEndpointSettings persists checkbox state and admin user', async () => {
    const settingsModel = {
      findOneAndUpdate: jest.fn().mockReturnValue(createLeanQuery({
        key: 'ok',
        enabled: true,
        updatedBy: 'admin-user',
      })),
    };

    const result = await updateDummyApiEndpointSettings(
      { enabled: 'true' },
      { settingsModel, updatedBy: 'admin-user' }
    );

    expect(settingsModel.findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'ok' },
      {
        $set: {
          enabled: true,
          updatedBy: 'admin-user',
        },
        $setOnInsert: {
          key: 'ok',
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
      key: 'ok',
      enabled: true,
      updatedBy: 'admin-user',
    });
  });

  test('buildRequestSnapshot serializes text bodies as raw JSON values', () => {
    const snapshot = buildRequestSnapshot(
      createRequest({ body: 'plain text payload' }),
      new Date('2026-06-01T00:00:00.000Z')
    );

    expect(snapshot.body).toBe('plain text payload');
  });
});
