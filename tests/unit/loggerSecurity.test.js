const logger = require('../../utils/logger');

describe('logger secret handling', () => {
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
