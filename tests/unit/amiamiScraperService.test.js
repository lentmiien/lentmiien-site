const mockGet = jest.fn();
const mockClose = jest.fn();
const mockCurlRequest = jest.fn(() => ({
  get: mockGet,
  close: mockClose,
}));

jest.mock('curl-cffi', () => ({
  CurlRequest: mockCurlRequest,
}));

const {
  buildItemUrl,
  fetchItemDetail,
  fetchNewItemsPage,
  normalizeDetail,
} = require('../../services/amiamiScraperService');

describe('amiamiScraperService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockReset();
  });

  test('fetches an item through the AmiAmi API using its normal item URL as referer', async () => {
    const apiData = {
      RSuccess: true,
      item: {
        gcode: 'FIGURE-100001',
      },
    };
    mockGet.mockResolvedValue({
      statusCode: 200,
      data: apiData,
    });

    const result = await fetchItemDetail('FIGURE-100001', {
      detailRetries: 0,
      requestTimeoutMs: 1234,
    });

    expect(buildItemUrl('FIGURE-100001')).toBe(
      'https://www.amiami.com/eng/detail?gcode=FIGURE-100001',
    );
    expect(mockCurlRequest).toHaveBeenCalledWith(
      { keepAlive: false },
      { maxSize: 1, idleTTL: 1 },
    );
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith(
      'https://api.amiami.com/api/v1.0/item',
      expect.objectContaining({
        impersonate: 'chrome136',
        params: {
          gcode: 'FIGURE-100001',
          lang: 'eng',
        },
        headers: expect.objectContaining({
          Referer: 'https://www.amiami.com/eng/detail?gcode=FIGURE-100001',
          'X-User-Key': 'amiami_dev',
        }),
        timeout: 1234,
        keepAlive: false,
      }),
    );
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(result).toBe(apiData);
  });

  test('does not retry a failed detail response when retries are disabled', async () => {
    mockGet.mockResolvedValue({
      statusCode: 200,
      data: {
        RSuccess: false,
      },
    });

    await expect(fetchItemDetail('FIGURE-404', {
      detailRetries: 0,
    })).rejects.toMatchObject({ code: 'AMIAMI_API_FAILURE', itemCode: 'FIGURE-404', attempts: 1 });

    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  test('fetches the New Products page through the lazy curl client', async () => {
    mockGet.mockResolvedValue({
      statusCode: 200,
      text: '<html>new products</html>',
    });

    await expect(fetchNewItemsPage({ requestTimeoutMs: 4321 }))
      .resolves.toBe('<html>new products</html>');
    expect(mockGet).toHaveBeenCalledWith(
      'https://www.amiami.com/files/eng/new_items/newitem.html',
      expect.objectContaining({
        impersonate: 'chrome136',
        headers: expect.objectContaining({
          Referer: 'https://www.amiami.com/eng/c/new/',
        }),
        timeout: 4321,
        keepAlive: false,
      }),
    );
  });

  test('normalizes the detail payload using the scraper data shape', () => {
    const normalized = normalizeDetail({
      item: {
        gcode: 'FIGURE-100001',
        scode: 'separate_upstream_code',
        gname: 'Example Figure',
        price: '12,345',
        maker_name: 'Example Maker',
        jancode: '4900000000001',
        main_image_url: '/images/example.jpg',
        preorderitem: 1,
      },
      _embedded: {
        series_titles: [{ name: 'Example Series' }],
        character_names: [{ name: 'Example Character' }],
      },
    });

    expect(normalized).toEqual(expect.objectContaining({
      gcode: 'FIGURE-100001',
      scode: 'separate_upstream_code',
      itemName: 'Example Figure',
      price: expect.objectContaining({
        currentJpy: 12345,
      }),
      brand: 'Example Maker',
      seriesTitle: 'Example Series',
      characterName: 'Example Character',
      janCode: '4900000000001',
      flags: expect.objectContaining({
        preOrder: true,
      }),
      imageLinks: ['https://img.amiami.com/images/example.jpg'],
      sourceUrl: 'https://www.amiami.com/eng/detail?gcode=FIGURE-100001',
      apiFetchedAt: expect.any(String),
    }));
  });
});

// HttpHeaders is deliberately modeled on the installed curl-cffi 0.1.50 API:
// case-insensitive first(name) returns a string; get(name) returns string[].
function curlHeaders(values) {
  const entries = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), [value]]));
  return {
    get: (name) => entries[name.toLowerCase()] || null,
    first: (name) => entries[name.toLowerCase()]?.[0],
  };
}

async function failureOf(promise) {
  try {
    await promise;
    throw new Error('Expected request failure');
  } catch (error) {
    expect(error.name).toBe('AmiAmiRequestError');
    return error;
  }
}

describe('AmiAmi request diagnostics (offline)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockReset();
  });

  test.each(['list', 'detail'])('reports a confirmed 403 challenge for %s without exposing bodies or cookies', async (phase) => {
    mockGet.mockResolvedValue({
      status: 403,
      headers: curlHeaders({
        'CF-Mitigated': 'challenge', 'Cf-Ray': '9abcdef012345678-NRT',
        'Content-Type': 'text/html; charset=UTF-8', 'Retry-After': '120',
        'Set-Cookie': 'private-cookie', Authorization: 'private-credential',
        Location: 'https://user:password@example.org/?token=private-token',
      }),
      text: '<title>Just a moment...</title>private-body' + 'x'.repeat(100000),
    });
    const error = await failureOf(phase === 'list' ? fetchNewItemsPage()
      : fetchItemDetail('FIGURE-123', { retryDelayMs: 0 }));
    expect(error).toMatchObject({
      code: 'AMIAMI_CHALLENGE', phase, status: 403, attempts: 1, retryable: false,
      headers: { 'cf-mitigated': 'challenge', 'cf-ray': '9abcdef012345678-NRT', 'content-type': 'text/html', 'retry-after': '120' },
    });
    expect(error.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(error.message).toContain('Wait and try later');
    if (phase === 'list') expect(error.message).toContain('no item fetching started');
    expect(JSON.stringify(error)).not.toMatch(/private-|password|<title>/);
    expect(JSON.stringify(error).length).toBeLessThan(1600);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  test.each(['list', 'detail'].flatMap((phase) => [
    [phase, '<title>Just a moment...</title>', 'AMIAMI_SUSPECTED_CHALLENGE'],
    [phase, '<html>Cloudflare access check</html>', 'AMIAMI_SUSPECTED_CHALLENGE'],
    [phase, '<html>Access denied</html>', 'AMIAMI_FORBIDDEN'],
  ]))('classifies %s 403 markers conservatively: %s', async (phase, text, code) => {
    mockGet.mockResolvedValue({ statusCode: 403, text });
    const error = await failureOf(phase === 'list' ? fetchNewItemsPage()
      : fetchItemDetail('FIGURE-123', { retryDelayMs: 0 }));
    expect(error).toMatchObject({ code, attempts: 1, status: 403 });
    if (code === 'AMIAMI_SUSPECTED_CHALLENGE') expect(error.message).toContain('no definitive');
    else expect(error.message).toContain('does not establish an IP block');
  });

  test.each([400, 401, 403, 404, 410, 422])('does not retry nonretryable HTTP %s', async (status) => {
    mockGet.mockResolvedValue({ status, text: 'private-body' });
    const error = await failureOf(fetchItemDetail('FIGURE-123', { retryDelayMs: 0 }));
    expect(error).toMatchObject({ status, attempts: 1, itemCode: 'FIGURE-123', retryable: false });
    expect(mockGet).toHaveBeenCalledTimes(1);
    if ([404, 410].includes(status)) {
      expect(error.code).toBe('AMIAMI_UNAVAILABLE');
      expect(error.message).toContain('permanent item removal is not established');
    }
  });

  test.each([408, 429, 500, 502, 503])('keeps transient HTTP %s retries and reports actual attempts', async (status) => {
    mockGet.mockResolvedValue({ status, headers: { 'Retry-After': '60' }, text: 'private-body' });
    const error = await failureOf(fetchItemDetail('FIGURE-123', { retryDelayMs: 0 }));
    expect(error).toMatchObject({ status, attempts: 3, retryable: true, headers: { 'retry-after': '60' } });
    expect(mockGet).toHaveBeenCalledTimes(3);
    expect(mockClose).toHaveBeenCalledTimes(3);
  });

  test('recovers after a transient error using the existing retry delay', async () => {
    jest.useFakeTimers();
    try {
      const data = { RSuccess: true, item: { gcode: 'FIGURE-123' } };
      mockGet.mockResolvedValueOnce({ status: 503 }).mockResolvedValueOnce({ status: 200, data });
      const request = fetchItemDetail('FIGURE-123');
      await jest.advanceTimersByTimeAsync(4999);
      expect(mockGet).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await expect(request).resolves.toEqual(data);
      expect(mockGet).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('stops after a challenge following a transient failure', async () => {
    mockGet.mockResolvedValueOnce({ status: 503 }).mockResolvedValue({ status: 403, headers: curlHeaders({ 'cf-mitigated': 'challenge' }) });
    const error = await failureOf(fetchItemDetail('FIGURE-123', { retryDelayMs: 0 }));
    expect(error).toMatchObject({ code: 'AMIAMI_CHALLENGE', attempts: 2 });
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  test.each([
    [28, 'Operation timed out private-token', 'AMIAMI_TIMEOUT'],
    ['ETIMEDOUT', 'private-token', 'AMIAMI_TIMEOUT'],
    ['ECONNRESET', 'failed https://user:password@example.org?token=private-token', 'AMIAMI_TRANSPORT'],
  ])('sanitizes transport failure %s, retaining its cause internally', async (code, message, expected) => {
    const cause = Object.assign(new Error(message), { code });
    mockGet.mockRejectedValue(cause);
    const error = await failureOf(fetchItemDetail('FIGURE-123', { retryDelayMs: 0 }));
    expect(error).toMatchObject({ code: expected, attempts: 3, status: null, cause });
    expect(JSON.stringify(error)).not.toMatch(/private-token|password/);
    expect(mockClose).toHaveBeenCalledTimes(3);
  });

  test('list failures still make one attempt even for transient status', async () => {
    mockGet.mockResolvedValue({ status: 503 });
    const error = await failureOf(fetchNewItemsPage({ detailRetries: 5 }));
    expect(error).toMatchObject({ attempts: 1, phase: 'list' });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  test('malformed JSON is bounded and retains existing retry behavior', async () => {
    mockGet.mockResolvedValue({ status: 200, text: '{private-body' + 'x'.repeat(100000) });
    const error = await failureOf(fetchItemDetail('FIGURE-123', { retryDelayMs: 0 }));
    expect(error).toMatchObject({ code: 'AMIAMI_INVALID_JSON', attempts: 3, status: 200 });
    expect(JSON.stringify(error)).not.toContain('private-body');
  });

  test.each([
    [{ RSuccess: false, message: 'private-body' }, 'AMIAMI_API_FAILURE'],
    [{ RSuccess: true }, 'AMIAMI_MISSING_ITEM'],
    [{ RSuccess: true, item: {} }, 'AMIAMI_MISSING_ITEM'],
    [{ RSuccess: true, item: [] }, 'AMIAMI_MISSING_ITEM'],
  ])('reports API failures without asserting removal', async (data, code) => {
    mockGet.mockResolvedValue({ status: 200, data });
    const error = await failureOf(fetchItemDetail('FIGURE-123', { retryDelayMs: 0 }));
    expect(error).toMatchObject({ code, attempts: 1 });
    expect(error.message).toContain('item availability is unknown');
    expect(JSON.stringify(error)).not.toContain('private-body');
  });

  test('parses valid JSON text normally', async () => {
    const data = { RSuccess: true, item: { gcode: 'FIGURE-123' } };
    mockGet.mockResolvedValue({ status: 200, text: JSON.stringify(data) });
    await expect(fetchItemDetail('FIGURE-123')).resolves.toEqual(data);
  });

  test.each([
    ['<title>Just a moment...</title>', {}, 'AMIAMI_SUSPECTED_CHALLENGE'],
    ['<html>checking</html>', { 'cf-mitigated': 'challenge' }, 'AMIAMI_CHALLENGE'],
    ['<title>Service Unavailable</title><a>New Products</a>', {}, 'AMIAMI_UNEXPECTED_HTML'],
    ['<html><h1>Something else</h1></html>', {}, 'AMIAMI_UNEXPECTED_HTML'],
    ['', {}, 'AMIAMI_UNEXPECTED_HTML'],
  ])('rejects HTTP 200 challenge/error/unexpected list HTML', async (text, headers, code) => {
    mockGet.mockResolvedValue({ status: 200, text, headers });
    const error = await failureOf(fetchNewItemsPage());
    expect(error).toMatchObject({ code, status: 200, attempts: 1 });
  });

  test.each([
    '<html><h1>New Products</h1><section class="newly-added-items"></section></html>',
    '<a href="/eng/detail?gcode=FIGURE-123">Figure</a>',
  ])('accepts normal or recognizable empty lists', async (text) => {
    mockGet.mockResolvedValue({ status: 200, text });
    await expect(fetchNewItemsPage()).resolves.toBe(text);
  });

  test('handles array-returning headers and suppresses injected/oversized header values and item codes', async () => {
    mockGet.mockResolvedValue({ status: 403, headers: {
      get: (name) => ({
        'cf-mitigated': ['challenge'], 'cf-ray': ['fake-ray\r\nSet-Cookie: private'],
        'content-type': ['text/html; token=private'], 'retry-after': ['x'.repeat(500)],
      })[name],
    } });
    const error = await failureOf(fetchItemDetail('FIGURE-1?token=private', { retryDelayMs: 0 }));
    expect(error).toMatchObject({ itemCode: '[invalid item code]', headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' } });
    expect(JSON.stringify(error)).not.toContain('private');
  });
});

test('diagnostic target never includes credentials, query, fragment or unknown URLs', () => {
  const { AmiAmiRequestError } = require('../../utils/amiamiDiagnostics');
  const context = { phase: 'detail', attempts: 0, startedAt: Date.now(), itemCode: 'FIGURE-1' };
  const error = new AmiAmiRequestError('transport', {
    ...context, target: 'https://user:private-password@api.amiami.com/api/v1.0/item?token=private-token#private-fragment',
  });
  expect(error.target).toBe('https://api.amiami.com/api/v1.0/item');
  expect(JSON.stringify(error)).not.toContain('private-');
  expect(new AmiAmiRequestError('transport', { ...context, target: 'https://unknown.example/private-path' }).target)
    .toBe('[redacted target]');
});
