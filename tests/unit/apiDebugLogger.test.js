const mockCreate = jest.fn();

jest.mock('../../models/api_debug_log', () => ({
  create: mockCreate,
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
}));

const {
  SECRET_REDACTION,
  recordApiDebugLog,
  sanitizePayload,
  sanitizeRequestUrl,
} = require('../../utils/apiDebugLogger');

describe('apiDebugLogger secret redaction', () => {
  beforeEach(() => {
    mockCreate.mockReset().mockResolvedValue({});
  });

  test('recursively redacts secret-bearing keys without hiding usage counters', () => {
    const sanitized = sanitizePayload({
      Authorization: 'Bearer abc',
      headers: {
        'x-api-key': 'gateway-key',
        cookie: 'sid=secret',
        'set-cookie': 'sid=secret',
      },
      credentials: {
        client_secret: 'oauth-secret',
        accessToken: 'access-token',
        refresh_token: 'refresh-token',
        csrfToken: 'csrf-token',
        password: 'hunter2',
      },
      usage: {
        prompt_tokens: 12,
        token_count: 34,
      },
    });

    expect(sanitized).toEqual({
      Authorization: SECRET_REDACTION,
      headers: {
        'x-api-key': SECRET_REDACTION,
        cookie: SECRET_REDACTION,
        'set-cookie': SECRET_REDACTION,
      },
      credentials: {
        client_secret: SECRET_REDACTION,
        accessToken: SECRET_REDACTION,
        refresh_token: SECRET_REDACTION,
        csrfToken: SECRET_REDACTION,
        password: SECRET_REDACTION,
      },
      usage: {
        prompt_tokens: 12,
        token_count: 34,
      },
    });
  });

  test('redacts credentials and secret query parameters in request URLs', () => {
    const sanitized = sanitizeRequestUrl(
      'https://user:pass@example.test/jobs?api_key=query-secret&prompt_id=job-1'
    );
    const parsed = new URL(sanitized);

    expect(decodeURIComponent(parsed.username)).toBe(SECRET_REDACTION);
    expect(decodeURIComponent(parsed.password)).toBe(SECRET_REDACTION);
    expect(parsed.searchParams.get('api_key')).toBe(SECRET_REDACTION);
    expect(parsed.searchParams.get('prompt_id')).toBe('job-1');
    const relative = new URL(sanitizeRequestUrl('/jobs?token=secret&job_id=1'), 'https://example.test');
    expect(relative.pathname).toBe('/jobs');
    expect(relative.searchParams.get('token')).toBe(SECRET_REDACTION);
    expect(relative.searchParams.get('job_id')).toBe('1');
  });

  test('persists only sanitized request and response data', async () => {
    await recordApiDebugLog({
      jsFileName: 'service.js',
      functionName: 'request',
      requestUrl: 'https://example.test/?access_token=url-secret',
      requestHeaders: { 'x-api-key': 'header-secret' },
      requestBody: { nested: { password: 'body-secret' } },
      responseHeaders: { 'set-cookie': 'session=secret' },
      responseBody: { refreshToken: 'response-secret' },
    });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      requestUrl: expect.not.stringContaining('url-secret'),
      requestHeaders: { 'x-api-key': SECRET_REDACTION },
      requestBody: { nested: { password: SECRET_REDACTION } },
      responseHeaders: { 'set-cookie': SECRET_REDACTION },
      responseBody: { refreshToken: SECRET_REDACTION },
    }));
  });
});
