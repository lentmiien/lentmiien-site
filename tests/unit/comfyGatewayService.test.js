const mockRecordApiDebugLog = jest.fn().mockResolvedValue(undefined);

jest.mock('../../utils/apiDebugLogger', () => ({
  createApiDebugLogger: () => mockRecordApiDebugLog,
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
}));

const ComfyGatewayService = require('../../services/comfyGatewayService');

describe('ComfyGatewayService input files', () => {
  let originalFetch;
  let service;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn();
    mockRecordApiDebugLog.mockClear();
    service = new ComfyGatewayService({
      baseUrl: 'http://gateway.test:8080',
      apiKey: 'gateway-key',
      timeoutMs: 5000,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('lists paginated persistent inputs with encoded browse controls', async () => {
    const payload = {
      files: [{ path: 'references/audio/voice sample.wav' }],
      total: 1,
      page: 2,
      limit: 48,
      pages: 2,
    };
    global.fetch.mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(service.listInputFiles({
      subfolder: 'references/audio',
      recursive: true,
      page: 2,
      limit: 48,
    })).resolves.toEqual(payload);

    const [requestUrl, options] = global.fetch.mock.calls[0];
    const url = new URL(requestUrl);
    expect(url.pathname).toBe('/comfy/input/files');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      subfolder: 'references/audio',
      recursive: 'true',
      page: '2',
      limit: '48',
    });
    expect(options.headers).toMatchObject({ 'x-api-key': 'gateway-key' });
  });

  test('uploads generic bytes using the Gateway multipart field names', async () => {
    const payload = {
      ok: true,
      overwritten: true,
      file: { path: 'references/audio/reference.wav' },
    };
    global.fetch.mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(service.uploadInputFile({
      buffer: Buffer.from('wave data'),
      filename: 'reference.wav',
      contentType: 'audio/x-wav',
      subfolder: 'references/audio',
      overwrite: true,
    })).resolves.toEqual(payload);

    const [requestUrl, options] = global.fetch.mock.calls[0];
    expect(new URL(requestUrl).pathname).toBe('/comfy/input/upload');
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({ 'x-api-key': 'gateway-key' });
    expect(options.headers['Content-Type']).toBeUndefined();
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get('subfolder')).toBe('references/audio');
    expect(options.body.get('overwrite')).toBe('true');
    const uploadedFile = options.body.get('file');
    expect(uploadedFile.name).toBe('reference.wav');
    expect(uploadedFile.type).toBe('audio/x-wav');
    await expect(uploadedFile.text()).resolves.toBe('wave data');
  });

  test('opens input previews with an encoded path and byte range', async () => {
    global.fetch.mockResolvedValue(new Response('partial audio', {
      status: 206,
      headers: {
        'content-type': 'audio/x-wav',
        'content-range': 'bytes 0-12/120',
      },
    }));

    const response = await service.openInputFile('references/audio/voice sample.wav', {
      range: 'bytes=0-12',
    });

    const [requestUrl, options] = global.fetch.mock.calls[0];
    const url = new URL(requestUrl);
    expect(url.pathname).toBe('/comfy/input/view');
    expect(url.searchParams.get('path')).toBe('references/audio/voice sample.wav');
    expect(options.headers).toMatchObject({
      'x-api-key': 'gateway-key',
      Range: 'bytes=0-12',
    });
    expect(response.status).toBe(206);
    await expect(response.text()).resolves.toBe('partial audio');
  });

  test('clears the preview header deadline before the response body is streamed', async () => {
    jest.useFakeTimers();
    service = new ComfyGatewayService({
      baseUrl: 'http://gateway.test:8080',
      streamHeaderTimeoutMs: 25,
    });
    global.fetch.mockResolvedValue(new Response('body after headers'));

    try {
      const response = await service.openInputFile('preview.png');
      const requestSignal = global.fetch.mock.calls[0][1].signal;
      await jest.advanceTimersByTimeAsync(100);

      expect(requestSignal.aborted).toBe(false);
      await expect(response.text()).resolves.toBe('body after headers');
    } finally {
      jest.useRealTimers();
    }
  });

  test('aborts a preview that does not return response headers in time', async () => {
    jest.useFakeTimers();
    service = new ComfyGatewayService({
      baseUrl: 'http://gateway.test:8080',
      streamHeaderTimeoutMs: 25,
    });
    global.fetch.mockImplementation((_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }));

    try {
      const request = expect(service.openInputFile('preview.png')).rejects.toMatchObject({
        name: 'TimeoutError',
        message: 'gateway response header timeout',
      });
      await jest.advanceTimersByTimeAsync(25);
      await request;
    } finally {
      jest.useRealTimers();
    }
  });

  test('preserves Gateway upload conflicts for the controller', async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ error: 'destination exists' }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(service.uploadInputFile({
      buffer: Buffer.from('replacement'),
      filename: 'reference.wav',
    })).rejects.toMatchObject({
      status: 409,
      message: 'destination exists',
    });
    expect(mockRecordApiDebugLog).toHaveBeenCalledTimes(1);
  });
});
