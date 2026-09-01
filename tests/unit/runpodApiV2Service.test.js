const {
  MAX_BILLING_BUCKETS,
  RUNPOD_API_ORIGIN,
  RunpodApiError,
  RunpodApiV2Service,
  RunpodConfigurationError,
  normalizeBillingOptions,
} = require('../../services/runpodApiV2Service');

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  const normalizedHeaders = new Map(Object.entries({
    'content-type': 'application/json',
    ...headers,
  }).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => normalizedHeaders.get(String(name).toLowerCase()) || null,
    },
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

function responseForUrl(url) {
  const pathname = url.pathname;
  if (pathname === '/v2/catalog/gpus') return jsonResponse({ gpus: [{ id: 'gpu-1' }] });
  if (pathname === '/v2/catalog/cpus') return jsonResponse({ cpus: [{ id: 'cpu-1' }] });
  if (pathname === '/v2/catalog/datacenters') return jsonResponse({ dataCenters: [{ id: 'dc-1' }] });
  if (pathname === '/v2/catalog/templates') return jsonResponse({ templates: [{ id: 'template-1' }] });
  if (pathname === '/v2/billing') {
    return jsonResponse({
      records: [],
      metadata: { recordCount: 0, totals: { totalAmount: 0 } },
    });
  }
  if (pathname === '/v2/billing/pods') {
    return jsonResponse({ records: [], metadata: { recordCount: 0 } });
  }
  if (pathname === '/v2/openapi.json') {
    return jsonResponse({
      openapi: '3.1.0',
      info: { title: 'Runpod REST API', version: '2.0.0' },
    });
  }
  return jsonResponse({}, { status: 404 });
}

describe('RunpodApiV2Service', () => {
  test('loads the complete step 1 dashboard exclusively from fixed v2 GET endpoints', async () => {
    const fetchImpl = jest.fn(async (url, options) => responseForUrl(url));
    const service = new RunpodApiV2Service({
      apiKey: 'runpod-test-key',
      fetchImpl,
      cacheTtlMs: 0,
      now: () => Date.parse('2026-09-01T00:00:00.000Z'),
    });

    const dashboard = await service.getDashboard({ bucketSize: 'week', lastN: 12 });

    expect(dashboard).toEqual(expect.objectContaining({
      apiVersion: 'v2',
      fetchedAt: '2026-09-01T00:00:00.000Z',
      gpus: [{ id: 'gpu-1' }],
      cpus: [{ id: 'cpu-1' }],
      dataCenters: [{ id: 'dc-1' }],
      templates: [{ id: 'template-1' }],
      errors: {},
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(5);

    const calls = fetchImpl.mock.calls.map(([url, options]) => ({
      url: String(url),
      options,
    }));
    expect(calls.every((call) => call.url.startsWith(`${RUNPOD_API_ORIGIN}/v2/`))).toBe(true);
    expect(calls.every((call) => call.options.method === 'GET')).toBe(true);
    expect(calls.every((call) => call.options.redirect === 'error')).toBe(true);
    expect(calls.every((call) => call.options.headers.Authorization === 'Bearer runpod-test-key')).toBe(true);

    const gpuUrl = new URL(calls.find((call) => call.url.includes('/catalog/gpus')).url);
    expect(gpuUrl.searchParams.get('include')).toBe('AVAILABILITY');
    expect(gpuUrl.searchParams.get('product')).toBe('POD');
    expect(gpuUrl.searchParams.get('cloud')).toBe('SECURE');
    const billingUrl = new URL(calls.find((call) => call.url.includes('/billing')).url);
    expect(billingUrl.searchParams.get('bucketSize')).toBe('week');
    expect(billingUrl.searchParams.get('lastN')).toBe('12');
  });

  test('verifies the provider description is API version 2', async () => {
    const fetchImpl = jest.fn(async (url) => responseForUrl(url));
    const service = new RunpodApiV2Service({ apiKey: 'key', fetchImpl, cacheTtlMs: 0 });

    await expect(service.getApiMetadata()).resolves.toEqual({
      openapi: '3.1.0',
      title: 'Runpod REST API',
      version: '2.0.0',
    });
    expect(String(fetchImpl.mock.calls[0][0])).toBe(`${RUNPOD_API_ORIGIN}/v2/openapi.json`);
  });

  test('returns partial dashboard errors without leaking provider bodies or credentials', async () => {
    const secret = 'runpod-super-secret';
    const fetchImpl = jest.fn(async (url) => {
      if (url.pathname === '/v2/catalog/gpus') {
        return jsonResponse({ error: `provider body contains ${secret}` }, { status: 401 });
      }
      return responseForUrl(url);
    });
    const service = new RunpodApiV2Service({ apiKey: secret, fetchImpl, cacheTtlMs: 0 });

    const dashboard = await service.getDashboard();

    expect(dashboard.gpus).toEqual([]);
    expect(dashboard.cpus).toEqual([{ id: 'cpu-1' }]);
    expect(dashboard.errors.gpus).toEqual({
      code: 'RUNPOD_HTTP_ERROR',
      status: 401,
      message: 'Runpod could not load the GPU catalog (HTTP 401).',
    });
    expect(JSON.stringify(dashboard.errors)).not.toContain(secret);
    expect(fetchImpl.mock.results[0]).toBeDefined();
  });

  test('retains only bounded, sanitized structured details from provider errors', async () => {
    const secret = 'runpod-test-secret';
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({
      error: {
        code: 'ZERO_GPUS',
        title: 'Original GPU unavailable',
        detail: `The original machine currently has zero GPUs; token=${secret}`,
      },
    }, { status: 409 }));
    const service = new RunpodApiV2Service({ apiKey: secret, fetchImpl, cacheTtlMs: 0 });

    let error;
    try {
      await service.transitionPod('pod-1', 'start');
    } catch (caught) {
      error = caught;
    }

    expect(error).toEqual(expect.objectContaining({
      code: 'RUNPOD_HTTP_ERROR',
      status: 409,
      providerCode: 'ZERO_GPUS',
      providerTitle: 'Original GPU unavailable',
    }));
    expect(error.providerDetail).toContain('zero GPUs');
    expect(error.providerDetail).toContain('[redacted]');
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  test('rejects missing and header-unsafe credentials before making a request', async () => {
    const fetchImpl = jest.fn();

    await expect(new RunpodApiV2Service({ apiKey: '', fetchImpl }).getDashboard())
      .rejects.toBeInstanceOf(RunpodConfigurationError);
    await expect(new RunpodApiV2Service({ apiKey: 'key\nInjected: value', fetchImpl }).getDashboard())
      .rejects.toBeInstanceOf(RunpodConfigurationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects oversized successful responses before parsing them', async () => {
    const response = jsonResponse({ gpus: [] }, {
      headers: { 'content-length': '5000' },
    });
    const service = new RunpodApiV2Service({
      apiKey: 'key',
      fetchImpl: jest.fn().mockResolvedValue(response),
      maxResponseBytes: 100,
      cacheTtlMs: 0,
    });

    await expect(service.getGpuTypes()).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_RESPONSE_TOO_LARGE',
    }));
    expect(response.text).not.toHaveBeenCalled();
  });

  test('rejects malformed JSON and non-allowlisted paths with safe errors', async () => {
    const malformedResponse = jsonResponse({});
    malformedResponse.text.mockResolvedValue('{"credential":"secret-value"');
    const service = new RunpodApiV2Service({
      apiKey: 'key',
      fetchImpl: jest.fn().mockResolvedValue(malformedResponse),
      cacheTtlMs: 0,
    });

    await expect(service.getGpuTypes()).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_INVALID_RESPONSE',
      message: 'Runpod returned invalid JSON for the GPU catalog.',
    }));
    let pathError;
    try {
      service.buildUrl('/v1/catalog/gpus');
    } catch (error) {
      pathError = error;
    }
    expect(pathError).toEqual(expect.objectContaining({ code: 'RUNPOD_PATH_NOT_ALLOWED' }));
  });

  test('bounds provider collection and billing record counts', async () => {
    const oversizedCatalogService = new RunpodApiV2Service({
      apiKey: 'key',
      fetchImpl: jest.fn().mockResolvedValue(jsonResponse({ gpus: Array(501).fill({}) })),
      cacheTtlMs: 0,
    });
    await expect(oversizedCatalogService.getGpuTypes()).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_RESPONSE_TOO_LARGE',
    }));

    const oversizedBillingService = new RunpodApiV2Service({
      apiKey: 'key',
      fetchImpl: jest.fn().mockResolvedValue(jsonResponse({
        records: Array(367).fill({}),
        metadata: {},
      })),
      cacheTtlMs: 0,
    });
    await expect(oversizedBillingService.getBilling()).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_RESPONSE_TOO_LARGE',
    }));
  });

  test('maps an aborted request to a safe timeout error', async () => {
    const fetchImpl = jest.fn((url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('request contained sensitive transport diagnostics');
        error.name = 'AbortError';
        reject(error);
      });
    }));
    const service = new RunpodApiV2Service({
      apiKey: 'key',
      fetchImpl,
      timeoutMs: 1,
      cacheTtlMs: 0,
    });

    await expect(service.getGpuTypes()).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_TIMEOUT',
      message: 'Runpod timed out while loading the GPU catalog.',
    }));
  });

  test('deduplicates concurrent reads and retains successful data for the configured TTL', async () => {
    let now = 1000;
    const fetchImpl = jest.fn(async (url) => responseForUrl(url));
    const service = new RunpodApiV2Service({
      apiKey: 'key',
      fetchImpl,
      cacheTtlMs: 100,
      now: () => now,
    });

    await Promise.all([
      service.getGpuTypes({ forceRefresh: true }),
      service.getGpuTypes({ forceRefresh: true }),
    ]);
    await service.getGpuTypes();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now = 1101;
    await service.getGpuTypes();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('validates billing options before network work', async () => {
    expect(normalizeBillingOptions({ bucketSize: 'month', lastN: MAX_BILLING_BUCKETS }))
      .toEqual({ bucketSize: 'month', lastN: MAX_BILLING_BUCKETS });
    expect(() => normalizeBillingOptions({ bucketSize: 'minute', lastN: 3 })).toThrow(TypeError);
    expect(() => normalizeBillingOptions({ bucketSize: 'day', lastN: MAX_BILLING_BUCKETS + 1 })).toThrow(TypeError);
    expect(normalizeBillingOptions({
      bucketSize: 'month',
      startTime: '2025-11-01T00:00:00Z',
      endTime: '2026-10-01T00:00:00Z',
    })).toEqual({
      bucketSize: 'month',
      startTime: '2025-11-01T00:00:00.000Z',
      endTime: '2026-10-01T00:00:00.000Z',
    });
    expect(() => normalizeBillingOptions({
      bucketSize: 'month',
      startTime: '2025-11-01T00:00:00Z',
    })).toThrow(TypeError);
    expect(() => normalizeBillingOptions({
      bucketSize: 'month',
      startTime: '2025-11-01T00:00:00Z',
      endTime: '2026-10-01T00:00:00Z',
      lastN: 2,
    })).toThrow(TypeError);

    const fetchImpl = jest.fn();
    const service = new RunpodApiV2Service({ apiKey: 'key', fetchImpl });
    await expect(service.getBilling({ bucketSize: 'day', lastN: 0 })).rejects.toBeInstanceOf(TypeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('loads exact per-Pod billing from the fixed v2 endpoint and bounded range', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({
      records: [{
        podId: 'pod-1',
        startTime: '2026-09-01T00:00:00Z',
        endTime: '2026-10-01T00:00:00Z',
        totalAmount: 1,
        gpuAmount: 0.8,
        cpuAmount: 0,
        diskAmount: 0.2,
      }],
      metadata: { recordCount: 1 },
    }));
    const service = new RunpodApiV2Service({ apiKey: 'key', fetchImpl, cacheTtlMs: 0 });

    const result = await service.getPodBilling({
      bucketSize: 'month',
      startTime: '2025-11-01T00:00:00Z',
      endTime: '2026-10-01T00:00:00Z',
      podId: 'pod-1',
    });

    expect(result.records).toHaveLength(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url.pathname).toBe('/v2/billing/pods');
    expect(url.searchParams.get('startTime')).toBe('2025-11-01T00:00:00.000Z');
    expect(url.searchParams.get('endTime')).toBe('2026-10-01T00:00:00.000Z');
    expect(url.searchParams.get('podId')).toBe('pod-1');
    expect(options.method).toBe('GET');
  });

  test('rejects non-v2 API descriptions', async () => {
    const service = new RunpodApiV2Service({
      apiKey: 'key',
      fetchImpl: jest.fn().mockResolvedValue(jsonResponse({
        openapi: '3.1.0',
        info: { title: 'Legacy API', version: '1.9.0' },
      })),
      cacheTtlMs: 0,
    });

    await expect(service.getApiMetadata()).rejects.toBeInstanceOf(RunpodApiError);
    await expect(service.getApiMetadata()).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_VERSION_MISMATCH',
    }));
  });

  test('uses only v2 pod endpoints and explicit methods for lifecycle operations', async () => {
    const fetchImpl = jest.fn(async (url, options) => {
      if (url.pathname === '/v2/pods' && options.method === 'GET') {
        return jsonResponse({ pods: [{ id: 'pod-1' }] });
      }
      if (url.pathname === '/v2/pods' && options.method === 'POST') {
        return jsonResponse({ id: 'pod-1', status: 'PROVISIONING' }, { status: 201 });
      }
      if (url.pathname === '/v2/pods/pod-1' && options.method === 'GET') {
        return jsonResponse({ id: 'pod-1', status: 'RUNNING' });
      }
      if (url.pathname === '/v2/pods/pod-1/action') {
        return jsonResponse({ id: 'pod-1', status: 'EXITED' });
      }
      if (url.pathname === '/v2/pods/pod-1' && options.method === 'DELETE') {
        return jsonResponse(null, { status: 204 });
      }
      return jsonResponse({}, { status: 404 });
    });
    const service = new RunpodApiV2Service({ apiKey: 'key', fetchImpl, cacheTtlMs: 0 });
    const createBody = {
      name: 'Ollama test',
      cloud: 'SECURE',
      gpu: { id: 'NVIDIA GeForce RTX 4090', count: 1 },
    };

    await expect(service.listPods()).resolves.toEqual([{ id: 'pod-1' }]);
    await expect(service.createPod(createBody)).resolves.toEqual(expect.objectContaining({ id: 'pod-1' }));
    await expect(service.getPod('pod-1')).resolves.toEqual(expect.objectContaining({ status: 'RUNNING' }));
    await expect(service.transitionPod('pod-1', 'stop')).resolves.toEqual(expect.objectContaining({ status: 'EXITED' }));
    await expect(service.deletePod('pod-1')).resolves.toBe(true);

    const calls = fetchImpl.mock.calls.map(([url, options]) => ({ url: String(url), options }));
    expect(calls.map((call) => [new URL(call.url).pathname, call.options.method])).toEqual([
      ['/v2/pods', 'GET'],
      ['/v2/pods', 'POST'],
      ['/v2/pods/pod-1', 'GET'],
      ['/v2/pods/pod-1/action', 'POST'],
      ['/v2/pods/pod-1', 'DELETE'],
    ]);
    expect(JSON.parse(calls[1].options.body)).toEqual(createBody);
    expect(JSON.parse(calls[3].options.body)).toEqual({ action: 'stop' });
  });

  test('creates and updates private account templates through v2', async () => {
    const fetchImpl = jest.fn(async (url, options) => {
      if (url.pathname === '/v2/templates' && options.method === 'GET') {
        return jsonResponse({ templates: [{ id: 'template-1' }] });
      }
      return jsonResponse({ id: 'template-1', name: 'Ollama' });
    });
    const service = new RunpodApiV2Service({ apiKey: 'key', fetchImpl, cacheTtlMs: 0 });
    const payload = { name: 'Ollama', image: 'ollama/ollama:latest', public: false };

    await expect(service.getAccountTemplates()).resolves.toHaveLength(1);
    await expect(service.createTemplate(payload)).resolves.toEqual(expect.objectContaining({ id: 'template-1' }));
    await expect(service.updateTemplate('template-1', payload)).resolves.toEqual(expect.objectContaining({ id: 'template-1' }));

    expect(fetchImpl.mock.calls.map(([url, options]) => [url.pathname, options.method])).toEqual([
      ['/v2/templates', 'GET'],
      ['/v2/templates', 'POST'],
      ['/v2/templates/template-1', 'PATCH'],
    ]);
  });

  test('lists, creates, reads, updates, and deletes network volumes through v2', async () => {
    const volume = {
      id: 'volume-1',
      name: 'model-cache',
      size: 50,
      dataCenter: 'EU-RO-1',
      type: 'STANDARD',
    };
    const fetchImpl = jest.fn(async (url, options) => {
      if (url.pathname === '/v2/network-volumes' && options.method === 'GET') {
        return jsonResponse({ networkVolumes: [volume] });
      }
      if (options.method === 'DELETE') return jsonResponse(null, { status: 204 });
      return jsonResponse(volume, { status: options.method === 'POST' ? 201 : 200 });
    });
    const service = new RunpodApiV2Service({ apiKey: 'key', fetchImpl, cacheTtlMs: 0 });
    const createBody = {
      name: 'model-cache',
      size: 50,
      dataCenter: 'EU-RO-1',
      type: 'STANDARD',
    };

    await expect(service.listNetworkVolumes()).resolves.toEqual([volume]);
    await expect(service.createNetworkVolume(createBody)).resolves.toEqual(volume);
    await expect(service.getNetworkVolume('volume-1')).resolves.toEqual(volume);
    await expect(service.updateNetworkVolume('volume-1', { size: 60 })).resolves.toEqual(volume);
    await expect(service.deleteNetworkVolume('volume-1')).resolves.toBe(true);

    expect(fetchImpl.mock.calls.map(([url, options]) => [url.pathname, options.method])).toEqual([
      ['/v2/network-volumes', 'GET'],
      ['/v2/network-volumes', 'POST'],
      ['/v2/network-volumes/volume-1', 'GET'],
      ['/v2/network-volumes/volume-1', 'PATCH'],
      ['/v2/network-volumes/volume-1', 'DELETE'],
    ]);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual(createBody);
  });

  test('rejects resource path injection and oversized mutation bodies before network work', async () => {
    const fetchImpl = jest.fn();
    const service = new RunpodApiV2Service({
      apiKey: 'key',
      fetchImpl,
      maxRequestBytes: 100,
    });

    await expect(service.getPod('../billing')).rejects.toBeInstanceOf(TypeError);
    await expect(service.getNetworkVolume('../pods')).rejects.toBeInstanceOf(TypeError);
    await expect(service.transitionPod('pod-1', 'destroy')).rejects.toBeInstanceOf(TypeError);
    await expect(service.createPod({ name: 'x'.repeat(200) })).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_REQUEST_TOO_LARGE',
    }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
