const path = require('path');

const {
  HtmlSamplesCacheService,
  DEFAULT_HTML_SAMPLES_CACHE_TTL_MS,
} = require('../../services/htmlSamplesCacheService');

function queryResult(result) {
  const query = {
    exec: jest.fn(() => Promise.resolve(result)),
  };
  query.lean = jest.fn(() => query);
  return query;
}

function createService({
  results = [[]],
  existingFiles,
  ttlMs = DEFAULT_HTML_SAMPLES_CACHE_TTL_MS,
} = {}) {
  let now = 0;
  const model = {
    find: jest.fn(),
  };
  results.forEach((result) => {
    model.find.mockImplementationOnce(() => queryResult(result));
  });
  const fileSystem = {
    existsSync: jest.fn((filePath) => existingFiles
      ? existingFiles.has(path.basename(filePath))
      : true),
  };
  const serviceLogger = {
    notice: jest.fn(),
    warning: jest.fn(),
  };
  const service = new HtmlSamplesCacheService({
    model,
    htmlDirectory: '/public/html',
    fileSystem,
    serviceLogger,
    clock: () => now,
    ttlMs,
  });

  return {
    service,
    model,
    fileSystem,
    serviceLogger,
    setNow(value) {
      now = value;
    },
  };
}

describe('HtmlSamplesCacheService', () => {
  test('builds, sorts, and caches the public samples list for the configured TTL', async () => {
    const entries = [
      {
        filename: 'alpha.html',
        ratings: { looksGood: 4, isFun: 4, hasGoodUi: 4, educational: 4 },
        version: 2,
      },
      {
        filename: 'missing.html',
        ratings: { looksGood: 5 },
      },
      {
        filename: 'beta.HTML',
        ratings: { looksGood: 5, isFun: 5, hasGoodUi: null, educational: 5 },
      },
      { ratings: { looksGood: 5 } },
    ];
    const refreshedEntries = [{
      filename: 'gamma.html',
      ratings: { looksGood: 3 },
    }];
    const {
      service,
      model,
      setNow,
    } = createService({
      results: [entries, refreshedEntries],
      existingFiles: new Set(['alpha.html', 'beta.HTML', 'gamma.html']),
      ttlMs: 100,
    });

    const first = await service.getSamples();
    setNow(99);
    const cached = await service.getSamples();

    expect(model.find).toHaveBeenCalledTimes(1);
    expect(model.find).toHaveBeenCalledWith({ isPublic: true });
    expect(cached).toBe(first);
    expect(first.map((sample) => sample.name)).toEqual(['beta', 'alpha']);
    expect(first[0]).toEqual({
      path: '/html/beta.HTML',
      name: 'beta',
      ratings: [
        { key: 'looksGood', label: 'Looks good', score: 5 },
        { key: 'isFun', label: 'Is fun', score: 5 },
        { key: 'hasGoodUi', label: 'Has good UI', score: null },
        { key: 'educational', label: 'Educational', score: 5 },
      ],
      averageRating: 5,
      version: 1,
    });

    setNow(100);
    await expect(service.getSamples()).resolves.toEqual([
      expect.objectContaining({ name: 'gamma', averageRating: 3 }),
    ]);
    expect(model.find).toHaveBeenCalledTimes(2);
  });

  test('coalesces concurrent refreshes into one database query', async () => {
    let resolveEntries;
    const entriesPromise = new Promise((resolve) => {
      resolveEntries = resolve;
    });
    const query = queryResult(entriesPromise);
    query.exec.mockImplementation(() => entriesPromise);
    const model = {
      find: jest.fn(() => query),
    };
    const service = new HtmlSamplesCacheService({
      model,
      htmlDirectory: '/public/html',
      fileSystem: { existsSync: jest.fn(() => true) },
      serviceLogger: { notice: jest.fn(), warning: jest.fn() },
      clock: () => 0,
    });

    const first = service.getSamples();
    const second = service.getSamples();
    resolveEntries([{ filename: 'shared.html', ratings: {} }]);

    await expect(Promise.all([first, second])).resolves.toEqual([
      [expect.objectContaining({ name: 'shared' })],
      [expect.objectContaining({ name: 'shared' })],
    ]);
    expect(model.find).toHaveBeenCalledTimes(1);
  });

  test('serves stale data and rate-limits retries throughout one failure state', async () => {
    const initialEntries = [{ filename: 'last-good.html', ratings: { looksGood: 4 } }];
    const recoveredEntries = [{ filename: 'recovered.html', ratings: { looksGood: 5 } }];
    const failure = new Error('database unavailable');
    const {
      service,
      model,
      serviceLogger,
      setNow,
    } = createService({ ttlMs: 100 });
    model.find
      .mockReset()
      .mockImplementationOnce(() => queryResult(initialEntries))
      .mockImplementationOnce(() => queryResult(Promise.reject(failure)))
      .mockImplementationOnce(() => queryResult(Promise.reject(failure)))
      .mockImplementationOnce(() => queryResult(recoveredEntries));

    const lastGood = await service.getSamples();
    setNow(100);
    await expect(service.getSamples()).resolves.toBe(lastGood);
    setNow(150);
    await expect(service.getSamples()).resolves.toBe(lastGood);
    expect(model.find).toHaveBeenCalledTimes(2);

    setNow(200);
    await expect(service.getSamples()).resolves.toBe(lastGood);
    expect(model.find).toHaveBeenCalledTimes(3);
    expect(serviceLogger.warning).toHaveBeenCalledTimes(1);
    expect(serviceLogger.warning).toHaveBeenCalledWith(
      'Unable to refresh HTML samples cache',
      {
        category: 'layout',
        metadata: {
          error: 'database unavailable',
          servingStale: true,
        },
      },
    );

    setNow(300);
    await expect(service.getSamples()).resolves.toEqual([
      expect.objectContaining({ name: 'recovered' }),
    ]);
    expect(serviceLogger.notice).toHaveBeenCalledTimes(1);
    expect(serviceLogger.notice).toHaveBeenCalledWith(
      'HTML samples cache refresh recovered',
      { category: 'layout' },
    );
  });

  test('throttles cold-cache failures and recovers from an empty fallback', async () => {
    const failure = new Error('offline');
    const {
      service,
      model,
      serviceLogger,
      setNow,
    } = createService({ ttlMs: 100 });
    model.find
      .mockReset()
      .mockImplementationOnce(() => queryResult(Promise.reject(failure)))
      .mockImplementationOnce(() => queryResult([
        { filename: 'online.html', ratings: { educational: 4 } },
      ]));

    await expect(service.getSamples()).resolves.toEqual([]);
    setNow(50);
    await expect(service.getSamples()).resolves.toEqual([]);
    expect(model.find).toHaveBeenCalledTimes(1);
    expect(serviceLogger.warning).toHaveBeenCalledWith(
      'Unable to refresh HTML samples cache',
      expect.objectContaining({
        metadata: expect.objectContaining({ servingStale: false }),
      }),
    );

    setNow(100);
    await expect(service.getSamples()).resolves.toEqual([
      expect.objectContaining({ name: 'online' }),
    ]);
    expect(serviceLogger.notice).toHaveBeenCalledTimes(1);
  });

  test('invalidation preserves the last-good snapshot while forcing the next refresh', async () => {
    const failure = new Error('temporary failure');
    const {
      service,
      model,
    } = createService();
    model.find
      .mockReset()
      .mockImplementationOnce(() => queryResult([
        { filename: 'cached.html', ratings: {} },
      ]))
      .mockImplementationOnce(() => queryResult(Promise.reject(failure)));

    const cached = await service.getSamples();
    service.invalidate();

    await expect(service.getSamples()).resolves.toBe(cached);
    expect(model.find).toHaveBeenCalledTimes(2);
  });

  test('validates dependencies and cache TTL configuration', () => {
    expect(() => new HtmlSamplesCacheService()).toThrow('requires a rating model');
    expect(() => new HtmlSamplesCacheService({ model: { find: jest.fn() } }))
      .toThrow('requires an HTML directory');
    expect(() => new HtmlSamplesCacheService({
      model: { find: jest.fn() },
      htmlDirectory: '/public/html',
      ttlMs: -1,
    })).toThrow('ttlMs must be a non-negative number');
  });
});
