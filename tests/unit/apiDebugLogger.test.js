const mockCreate = jest.fn();
const mockDb = new (require('events').EventEmitter)();

jest.mock('../../models/api_debug_log', () => ({
  create: mockCreate,
  db: mockDb,
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warning: jest.fn(),
}));

let {
  SECRET_REDACTION,
  recordApiDebugLog,
  sanitizePayload,
  sanitizeRequestUrl,
} = require('../../utils/apiDebugLogger');

describe('apiDebugLogger secret redaction', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    mockDb.removeAllListeners();
    mockDb.readyState = 1;
    ({ SECRET_REDACTION, recordApiDebugLog, sanitizePayload, sanitizeRequestUrl } = require('../../utils/apiDebugLogger'));
    mockCreate.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('defers sanitized startup records without waiting on MongoDB and flushes once on connection', async () => {
    mockDb.readyState = 0;
    await recordApiDebugLog({ responseBody: { token: 'startup-secret' } });
    expect(mockCreate).not.toHaveBeenCalled();
    mockDb.readyState = 1;
    mockDb.emit('connected');
    mockDb.emit('connected');
    await jest.advanceTimersByTimeAsync(0);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ responseBody: { token: SECRET_REDACTION } }));
    expect(require('../../utils/logger').warning).not.toHaveBeenCalled();
  });

  test('expires unavailable records and reports a single summary without their payloads', async () => {
    mockDb.readyState = 0;
    await recordApiDebugLog({ requestBody: 'private startup content' });
    await recordApiDebugLog({ requestBody: 'another private request' });
    await jest.advanceTimersByTimeAsync(60_000);
    mockDb.readyState = 1;
    mockDb.emit('connected');
    expect(mockCreate).not.toHaveBeenCalled();
    const log = require('../../utils/logger');
    expect(log.warning).toHaveBeenCalledTimes(1);
    expect(log.warning.mock.calls[0][1].metadata.droppedEntries).toBe(2);
    expect(JSON.stringify(log.warning.mock.calls)).not.toContain('private');
  });

  test('disconnect during a flush retains remaining records for a later connection', async () => {
    mockDb.readyState = 0;
    await recordApiDebugLog({ functionName: 'first' });
    await recordApiDebugLog({ functionName: 'second' });
    let finishWrite;
    mockCreate.mockImplementationOnce(() => new Promise(resolve => { finishWrite = resolve; }));
    mockDb.readyState = 1;
    mockDb.emit('connected');
    mockDb.readyState = 0;
    finishWrite({});
    await jest.advanceTimersByTimeAsync(0);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    mockDb.readyState = 1;
    mockDb.emit('connected');
    await jest.advanceTimersByTimeAsync(0);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][0].functionName).toBe('second');
  });

  test.each([['count', 55, 'small'], ['bytes', 20, 'x'.repeat(60_000)]])('bounds pending debug records by %s', async (_, count, responseBody) => {
    mockDb.readyState = 0;
    for (let i = 0; i < count; i += 1) await recordApiDebugLog({ responseBody });
    mockDb.readyState = 1;
    mockDb.emit('connected');
    await jest.advanceTimersByTimeAsync(0);
    expect(mockCreate.mock.calls.length).toBeLessThan(count);
    expect(mockCreate.mock.calls.length).toBeGreaterThan(0);
    expect(require('../../utils/logger').warning).toHaveBeenCalledTimes(1);
  });

  test('failed writes stay diagnostic failures and are never replayed after reconnection', async () => {
    mockCreate.mockRejectedValueOnce(new Error('private provider content'));
    await recordApiDebugLog({});
    mockDb.emit('connected');
    await jest.advanceTimersByTimeAsync(0);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(require('../../utils/logger').warning).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(require('../../utils/logger').warning.mock.calls)).not.toContain('private');
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
