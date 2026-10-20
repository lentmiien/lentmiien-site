const { RunpodRequestCoordinator, RunpodApiError, parseRateHeaders } = require('../../services/runpodRequestCoordinator');
const { RunpodApiV2Service } = require('../../services/runpodApiV2Service');
const headers = (values) => new Headers(values);
const json = (body = {}, status = 200, values = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...values } });
const appLogger = () => ({ warning: jest.fn() });

describe('Runpod rate header parsing', () => {
  test('uses the latest exhausted window and preserves the policy without hardcoded quotas', () => {
    expect(parseRateHeaders(headers({
      RateLimit: '"minute";r=0;t=12, "hour";r=0;t=120, "day";r=99;t=400',
      'RateLimit-Policy': '"minute";q=61;w=60, "hour";q=3001;w=3600',
      'Retry-After': '30',
    }), 1000)).toEqual({ retryAt: 121000, invalid: false, windows: [
      { name: 'minute', remaining: 0, resetSeconds: 12, quota: 61, windowSeconds: 60 },
      { name: 'hour', remaining: 0, resetSeconds: 120, quota: 3001, windowSeconds: 3600 },
      { name: 'day', remaining: 99, resetSeconds: 400 },
    ] });
  });
  test('supports HTTP-date, fractional delay and long delays without capping them early', () => {
    expect(parseRateHeaders(headers({ 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }), 0).retryAt).toBe(Date.parse('2026-10-21T07:28:00Z'));
    expect(parseRateHeaders(headers({ 'Retry-After': '0.5' }), 1000).retryAt).toBe(1500);
    expect(parseRateHeaders(headers({ 'Retry-After': '999999999999999999999' }), 1000).retryAt).toBe(Number.MAX_SAFE_INTEGER);
  });
  test.each(['garbage', '"minute";r=0;t=-2', '"minute";r=0;r=1;t=0', 'x'.repeat(5000)])('bounds malformed metadata', (value) => {
    expect(parseRateHeaders(headers({ RateLimit: value }), 1000)).toMatchObject({ invalid: true, retryAt: 61000 });
  });
});

describe('Runpod shared scheduling and safe-read retries', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const create = (options = {}) => new RunpodRequestCoordinator({ appLogger: appLogger(), random: () => 0, ...options });

  test('releases a slot during backoff and gives stop work priority over catalogs', async () => {
    const coordinator = create({ concurrency: 1 });
    const order = [];
    let finish;
    const blocker = coordinator.run(() => new Promise((resolve) => { finish = resolve; }), { safe: false });
    await jest.advanceTimersByTimeAsync(0);
    const read = coordinator.run(async () => { order.push('catalog'); }, { priority: 2 });
    const stop = coordinator.run(async () => { order.push('stop'); }, { safe: false, priority: 0 });
    finish();
    await Promise.all([blocker, read, stop]);
    expect(order).toEqual(['stop', 'catalog']);
    const transient = jest.fn().mockRejectedValueOnce(new RunpodApiError('safe', { status: 503 })).mockResolvedValue('ok');
    const retry = coordinator.run(transient);
    await jest.advanceTimersByTimeAsync(0);
    expect(coordinator.active).toBe(0);
    await coordinator.run(async () => order.push('another stop'), { priority: 0 });
    await jest.advanceTimersByTimeAsync(249);
    expect(transient).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(retry).resolves.toBe('ok');
  });

  test('coordinates 429 across independent JSON and SSE clients and waits all exhausted windows', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(json({}, 429, { 'Retry-After': '1', RateLimit: '"minute";r=0;t=2, "hour";r=0;t=3' }))
      .mockResolvedValueOnce(json({ id: 'pod-1' }))
      .mockResolvedValueOnce(new Response('data: {"source":"container","line":"ok"}\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    const first = new RunpodApiV2Service({ apiKey: 'key', fetchImpl });
    const second = new RunpodApiV2Service({ apiKey: 'key', fetchImpl });
    const reading = first.getPod('pod-1');
    await jest.advanceTimersByTimeAsync(0);
    const logs = second.getPodLogSnapshot('pod-1');
    await jest.advanceTimersByTimeAsync(2999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(reading).resolves.toMatchObject({ id: 'pod-1' });
    await expect(logs).resolves.toMatchObject({ events: [{ source: 'container', line: 'ok', timestamp: null }] });
    expect(first.coordinator.diagnostics()).toMatchObject({ requests: 3, retries: 1, throttled: 1 });
  });

  test.each(['POST', 'PATCH', 'DELETE'])('never replays %s on 429 or ambiguous failures', async (method) => {
    const fetchImpl = jest.fn().mockResolvedValue(json({ detail: 'private' }, 429, { 'Retry-After': '120' }));
    const service = new RunpodApiV2Service({ apiKey: 'key', fetchImpl });
    await expect(service.requestJson('/v2/pods', { method, body: {} })).rejects.toMatchObject({ status: 429, retryable: true, retryAt: Date.now() + 120000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const fetchFailure = jest.fn().mockRejectedValue(new Error('secret transport details'));
    const other = new RunpodApiV2Service({ apiKey: 'key', fetchImpl: fetchFailure });
    await expect(other.requestJson('/v2/pods', { method, body: {} })).rejects.toMatchObject({ code: 'RUNPOD_NETWORK_ERROR' });
    expect(fetchFailure).toHaveBeenCalledTimes(1);
  });

  test('returns a typed cooldown instead of sleeping beyond the total budget', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json({}, 429, { 'Retry-After': '7200' }));
    const service = new RunpodApiV2Service({ apiKey: 'key', fetchImpl, budgetMs: 1000 });
    await expect(service.getPod('pod-1')).rejects.toMatchObject({ code: 'RUNPOD_COOLDOWN', retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(service.coordinator.active).toBe(0);
  });

  test('bounds the queue and cancels queued work without an outbound request', async () => {
    const coordinator = create({ concurrency: 1, queueLimit: 1 });
    let finish;
    const running = coordinator.run(() => new Promise((resolve) => { finish = resolve; }));
    await jest.advanceTimersByTimeAsync(0);
    const controller = new AbortController();
    const unused = jest.fn();
    const waiting = coordinator.run(unused, { signal: controller.signal }).catch((e) => e);
    await expect(coordinator.run(unused)).rejects.toMatchObject({ code: 'RUNPOD_QUEUE_FULL' });
    controller.abort();
    expect(await waiting).toMatchObject({ code: 'RUNPOD_CANCELLED' });
    finish();
    await running;
    expect(unused).not.toHaveBeenCalled();
    expect(coordinator.queue).toHaveLength(0);
  });

  test('aborts a hung stream within its budget and releases its reader and slot', async () => {
    const cancel = jest.fn();
    const fetchImpl = jest.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json' } }));
    const service = new RunpodApiV2Service({ apiKey: 'key', fetchImpl, timeoutMs: 250, readRetries: 0 });
    const result = service.getPod('pod-1').catch((e) => e);
    await jest.advanceTimersByTimeAsync(250);
    expect(await result).toMatchObject({ code: 'RUNPOD_TIMEOUT' });
    expect(cancel).toHaveBeenCalled();
    expect(service.coordinator.active).toBe(0);
  });

  test('bounds attempts for transient errors and does not retry authorization failures', async () => {
    const coordinator = create();
    const attempt = jest.fn().mockRejectedValue(new RunpodApiError('safe', { status: 503 }));
    const result = coordinator.run(attempt, { retries: 2 }).catch((e) => e);
    await jest.advanceTimersByTimeAsync(750);
    expect(await result).toMatchObject({ status: 503 });
    expect(attempt).toHaveBeenCalledTimes(3);
    const forbidden = jest.fn().mockRejectedValue(new RunpodApiError('safe', { status: 403 }));
    await expect(coordinator.run(forbidden)).rejects.toMatchObject({ status: 403 });
    expect(forbidden).toHaveBeenCalledTimes(1);
  });
});

describe('Runpod review transport edge regressions', () => {
  test('SSE 429 retains cooldown metadata for other clients without replaying writes', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json({}, 429, { 'Retry-After': '60' }));
    const service = new RunpodApiV2Service({ apiKey: 'key', fetchImpl, readRetries: 0 });
    await expect(service.getPodLogSnapshot('pod-1')).rejects.toMatchObject({ status: 429, code: 'RUNPOD_RATE_LIMITED', retryable: true });
    await expect(new RunpodApiV2Service({ apiKey: 'key', fetchImpl }).transitionPod('pod-1', 'start'))
      .rejects.toMatchObject({ code: 'RUNPOD_COOLDOWN' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  test('stop displaces lower-priority queued work when the bounded queue is full', async () => {
    const coordinator = new RunpodRequestCoordinator({ concurrency: 1, queueLimit: 1, appLogger: appLogger() });
    let finish;
    const active = coordinator.run(() => new Promise((resolve) => { finish = resolve; }));
    await new Promise(setImmediate);
    const catalog = coordinator.run(async () => 'catalog', { priority: 2 }).catch((e) => e);
    const stop = coordinator.run(async () => 'stopped', { safe: false, priority: 0 });
    expect(await catalog).toMatchObject({ code: 'RUNPOD_QUEUE_FULL' });
    finish();
    await active;
    await expect(stop).resolves.toBe('stopped');
  });
  test('rejects truncated pod lists rather than treating a partial list as complete', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json({ pods: [], pagination: { hasNextPage: true, nextCursor: 'next' } }));
    const service = new RunpodApiV2Service({ apiKey: 'key', fetchImpl });
    await expect(service.listPods()).rejects.toMatchObject({ code: 'RUNPOD_INCOMPLETE_RESPONSE' });
  });
  test('shares cached catalog reads, but a mutation preflight never reuses an older in-flight read', async () => {
    let resolveOld;
    const fetchImpl = jest.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValue(json({ gpus: [{ id: 'new' }] }));
    const first = new RunpodApiV2Service({ apiKey: 'key', fetchImpl });
    const second = new RunpodApiV2Service({ apiKey: 'key', fetchImpl });
    const old = first.getGpuTypes();
    const shared = second.getGpuTypes();
    await new Promise(setImmediate);
    const fresh = await second.getGpuTypes({ forceRefresh: true });
    expect(fresh).toEqual([{ id: 'new' }]);
    resolveOld(json({ gpus: [{ id: 'old' }] }));
    await Promise.all([old, shared]);
    await expect(first.getGpuTypes()).resolves.toEqual([{ id: 'new' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

test('an already-cancelled request never reaches the transport', async () => {
  const controller = new AbortController();
  controller.abort();
  const fetchImpl = jest.fn();
  const service = new RunpodApiV2Service({ apiKey: 'key', fetchImpl });
  await expect(service.getPod('pod-1', { signal: controller.signal })).rejects.toMatchObject({ code: 'RUNPOD_CANCELLED' });
  expect(fetchImpl).not.toHaveBeenCalled();
});
