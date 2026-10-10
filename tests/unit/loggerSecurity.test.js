const logger = require('../../utils/logger');
const axios = require('axios');
const fs = require('fs');

describe('logger secret handling', () => {
  test('normalizes real AxiosErrors before toJSON and protects both sinks', async () => {
    const environment = process.env.NODE_ENV;
    const worker = process.env.JEST_WORKER_ID;
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const append = jest.spyOn(fs.promises, 'appendFile').mockResolvedValue();
    const mkdir = jest.spyOn(fs.promises, 'mkdir').mockResolvedValue();
    const secret = 'synthetic-callback-credential';
    const speech = 'synthetic private speech';
    const image = 'synthetic-private-image-base64';
    const payload = JSON.stringify({ webhook_url: `https://example.test/webhook?token=${secret}`, messages: [{ content: speech, images: [image] }] });
    const error = new axios.AxiosError('Request failed with status code 413', 'ERR_BAD_RESPONSE', {
      data: payload, headers: { Authorization: secret },
    }, {}, { status: 413, data: payload });
    const toJSON = jest.spyOn(error, 'toJSON');
    const outer = new Error('Gateway call failed', { cause: error });
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.JEST_WORKER_ID;
      await logger.error('Synthetic failure', { metadata: { error, nested: [outer], data: payload, serialized: payload } });
      await logger.error(error);
      expect(toJSON).not.toHaveBeenCalled();
      expect(append).toHaveBeenCalledTimes(2);
      const output = JSON.stringify([consoleError.mock.calls, append.mock.calls]);
      for (const privateValue of [secret, speech, image]) expect(output).not.toContain(privateValue);
      expect(output).toContain('ERR_BAD_RESPONSE');
      expect(JSON.parse(append.mock.calls[0][1]).metadata.error.status).toBe(413);
    } finally {
      if (environment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = environment;
      if (worker === undefined) delete process.env.JEST_WORKER_ID;
      else process.env.JEST_WORKER_ID = worker;
      consoleError.mockRestore(); append.mockRestore(); mkdir.mockRestore(); toJSON.mockRestore();
    }
  });

  test('sanitizes URLs and bounds hostile metadata without calling serialization hooks', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const toJSON = jest.fn(() => ({ value: 'synthetic-hook-secret' }));
    const metadata = {
      url: 'https://synthetic-user:synthetic-password@example.test/webhook?token=synthetic-query-secret&text=synthetic-query-text#synthetic-fragment',
      relativeUrl: '/webhook/ollama?token=synthetic-relative-secret',
      hook: { toJSON, count: 2 },
      huge: 'x'.repeat(500000), array: Array.from({ length: 10000 }, () => ({ huge: 'y'.repeat(5000) })),
    };
    metadata.circular = metadata;
    Object.defineProperty(metadata, 'getter', { enumerable: true, get() { throw new Error('must not call accessors'); } });
    try {
      await logger.warning('Failed https://example.test/hook?token=synthetic-message-secret', { metadata });
      const output = JSON.stringify(warning.mock.calls);
      for (const value of ['synthetic-user', 'synthetic-password', 'synthetic-query-secret', 'synthetic-query-text', 'synthetic-fragment', 'synthetic-message-secret', 'synthetic-hook-secret', 'synthetic-relative-secret']) {
        expect(output).not.toContain(value);
      }
      expect(output).toContain('example.test');
      expect(output.length).toBeLessThan(40000);
      expect(toJSON).not.toHaveBeenCalled();
      expect(output).not.toContain('Unable to serialize');
    } finally { warning.mockRestore(); }
  });

  test('redacts sensitive metadata and excludes arbitrary Error properties', async () => {
    const consoleWarning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = Object.assign(new Error('request failed'), {
      code: 'EFAIL',
      request: {
        headers: { authorization: 'Bearer nested-secret' },
      },
    });

    await logger.warning('Security logger test', {
      category: 'test',
      metadata: {
        authorization: 'Bearer top-secret',
        nested: { apiKey: 'api-key-secret' },
        error,
      },
    });

    const serialized = JSON.stringify(consoleWarning.mock.calls);
    expect(serialized).not.toContain('top-secret');
    expect(serialized).not.toContain('api-key-secret');
    expect(serialized).not.toContain('nested-secret');
    expect(serialized).toContain('[redacted secret]');
    expect(serialized).toContain('EFAIL');
    consoleWarning.mockRestore();
  });

  test('redacts sensitive keys when an object is used as the message', async () => {
    const consoleWarning = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await logger.warning({
      authorization: 'Bearer object-message-secret',
      nested: { refreshToken: 'nested-object-secret' },
    });

    const serialized = JSON.stringify(consoleWarning.mock.calls);
    expect(serialized).not.toContain('object-message-secret');
    expect(serialized).not.toContain('nested-object-secret');
    expect(serialized).toContain('[redacted secret]');
    consoleWarning.mockRestore();
  });
});
