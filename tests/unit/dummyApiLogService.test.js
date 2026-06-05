const {
  buildRequestSnapshot,
  recordDummyApiRequest,
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
    originalUrl: '/ok?source=unit',
    baseUrl: '',
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

    const result = await recordDummyApiRequest(createRequest(), {
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

    const result = await recordDummyApiRequest(createRequest(), {
      settings: { enabled: true },
      logModel,
      now,
    });

    expect(result).toMatchObject({ enabled: true, logged: true });
    expect(logModel.create).toHaveBeenCalledWith(expect.objectContaining({
      receivedAt: now,
      method: 'POST',
      requestPath: '/ok?source=unit',
      raw: expect.objectContaining({
        receivedAt: '2026-06-01T00:00:00.000Z',
        method: 'POST',
        originalUrl: '/ok?source=unit',
        baseUrl: null,
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

  test('buildRequestSnapshot includes multipart file metadata without content', () => {
    const snapshot = buildRequestSnapshot(
      createRequest({
        headers: {
          'content-type': 'multipart/form-data; boundary=unit',
          'user-agent': 'dummy-client/1.0',
        },
        body: {
          description: 'debug upload',
        },
        files: [
          {
            fieldname: 'attachment',
            originalname: 'example.txt',
            encoding: '7bit',
            mimetype: 'text/plain',
            size: 128,
            buffer: Buffer.from('do not persist this'),
            stream: {},
          },
        ],
      }),
      new Date('2026-06-01T00:00:00.000Z')
    );

    expect(snapshot.multipart).toEqual({
      fields: { description: 'debug upload' },
      files: [
        {
          fieldname: 'attachment',
          originalname: 'example.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          size: 128,
        },
      ],
      fileCount: 1,
      error: null,
    });
    expect(JSON.stringify(snapshot.multipart)).not.toContain('do not persist this');
    expect(JSON.stringify(snapshot.multipart)).not.toContain('buffer');
    expect(JSON.stringify(snapshot.multipart)).not.toContain('stream');
  });

  test('buildRequestSnapshot includes multipart parser errors', () => {
    const snapshot = buildRequestSnapshot(
      createRequest({
        headers: {
          'content-type': 'multipart/form-data; boundary=unit',
          'user-agent': 'dummy-client/1.0',
        },
        body: {},
        files: [],
        dummyApiMultipartError: {
          name: 'MulterError',
          code: 'LIMIT_FILE_COUNT',
          field: 'attachment',
          message: 'Too many files',
        },
      }),
      new Date('2026-06-01T00:00:00.000Z')
    );

    expect(snapshot.multipart).toEqual(expect.objectContaining({
      files: [],
      fileCount: 0,
      error: {
        name: 'MulterError',
        code: 'LIMIT_FILE_COUNT',
        field: 'attachment',
        message: 'Too many files',
        detail: null,
      },
    }));
  });
});
