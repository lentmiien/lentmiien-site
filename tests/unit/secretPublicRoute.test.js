const { redactSecretPublicPath } = require('../../utils/secretPublicRoute');

describe('redactSecretPublicPath', () => {
  const environment = {
    PUBLIC_TOBUY_LIST_PATH: '/private-list',
    REQUEST_COUNTER_PATH: '/countersecret',
    DEVICE_USAGE_PATH: '/device-secret',
    MINUTE_LOGGER_PATH: '/minutes',
  };

  test.each([
    ['/private-list', '/secret-public/to-buy'],
    ['/countersecret/status', '/secret-public/request-counter/status'],
    ['/device-secret/check', '/secret-public/device-usage/check'],
    ['/minutes/events', '/secret-public/minute-logger/events'],
  ])('replaces a configured capability path with a stable label', (input, expected) => {
    expect(redactSecretPublicPath(input, environment)).toBe(expected);
  });

  test('does not redact unrelated or merely similar paths', () => {
    expect(redactSecretPublicPath('/public', environment)).toBe('/public');
    expect(redactSecretPublicPath('/minutes-extra', environment)).toBe('/minutes-extra');
  });
});
