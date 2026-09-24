jest.mock('../../database', () => ({ AmiAmiItem: {} }));

const { createAmiAmiUploadService } = require('../../services/amiamiUploadService');
const { DELAY_MS, LEASE_MS, JOB_LIFETIME_MS } = require('../../utils/amiamiUploadPolicy');
const creator = 'a'.repeat(24);
const html = (...codes) => codes.map(code => `<a href='/eng/detail?gcode=${code}'>x</a>`).join('');

// Isolated atomic Mongo-like slot: only operators used by the service are needed.
function fixture(existing = []) {
  let row = null;
  let clock = 1000000;
  const clone = value => structuredClone(value);
  const matches = (value, filter) => Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('$nin' in expected) return !expected.$nin.includes(value?.[key]);
      if ('$lte' in expected) return value?.[key] <= expected.$lte;
      if ('$gt' in expected) return value?.[key] > expected.$gt;
    }
    return value?.[key] === expected;
  });
  const query = execute => ({ maxTimeMS() { return this; }, lean() { return this; }, select() { return this; }, exec: async () => execute() });
  const jobModel = {
    findById: jest.fn(() => query(() => clone(row))),
    findOneAndUpdate: jest.fn((filter, change, options) => query(() => {
      if (!row || !matches(row, filter)) {
        if (!options.upsert) return null;
        if (row) throw Object.assign(new Error('duplicate slot'), { code: 11000 });
        row = { _id: 'html-upload' };
      }
      Object.assign(row, clone(change.$set));
      return clone(row);
    })),
  };
  const itemModel = { find: jest.fn(() => query(() => existing.map(gcode => ({ gcode })))) };
  const fetch = jest.fn().mockResolvedValue({ status: 'fetched' });
  const authorizeCreator = jest.fn().mockResolvedValue(true);
  const logger = { warning: jest.fn(), error: jest.fn() };
  let available = true;
  const deps = { jobModel, itemModel, attemptMissingItemScrape: fetch, authorizeCreator,
    logger, now: () => clock, ready: () => available };
  const service = createAmiAmiUploadService(deps);
  service.start();
  return { service, deps, jobModel, fetch, authorizeCreator, logger,
    row: () => row, advance: ms => { clock += ms; }, unavailable: () => { available = false; } };
}
let f;
beforeEach(() => { jest.useFakeTimers(); f = fixture(); });
afterEach(() => { f.service.stop(); jest.useRealTimers(); });

test('filters all existing items, deduplicates codes, and persists only the missing queue', async () => {
  f.service.stop(); f = fixture(['FIGURE-1']);
  const result = await f.service.submit(html('FIGURE-1', 'TOY-RBT-9417', 'TOY-RBT-9417'), creator);
  expect(result).toMatchObject({ active: true, totalCodes: 2, queuedCount: 1, skippedExisting: 1 });
  expect(result).not.toHaveProperty('creator');
  expect(result).not.toHaveProperty('codes');
  expect(result).not.toHaveProperty('leaseToken');
  expect(f.row().codes).toEqual(['TOY-RBT-9417']);
  expect(JSON.stringify(f.row())).not.toContain('<a');
  expect(f.fetch).not.toHaveBeenCalled();
});

test('all-existing upload completes without scheduling any item requests', async () => {
  f.service.stop(); f = fixture(['FIGURE-1']);
  expect(await f.service.submit(html('FIGURE-1'), creator)).toMatchObject({ state: 'completed', active: false, queuedCount: 0 });
  await f.service.tick();
  expect(f.fetch).not.toHaveBeenCalled();
});

test('two concurrent uploads admit exactly one globally', async () => {
  const results = await Promise.allSettled([
    f.service.submit(html('FIGURE-1'), creator), f.service.submit(html('FIGURE-2'), creator),
  ]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(r => r.status === 'rejected').reason.status).toBe(409);
  await expect(f.service.submit(html('FIGURE-3'), creator)).rejects.toMatchObject({ status: 409 });
});

test('processes one item per tick, persists the 60-second delay, continues failures and reports counts', async () => {
  await f.service.submit(html('FIGURE-1', 'FIGURE-2', 'FIGURE-3'), creator);
  f.fetch.mockResolvedValueOnce({ status: 'failed' }).mockResolvedValueOnce({ status: 'existing' });
  await f.service.tick();
  expect(f.fetch).toHaveBeenCalledTimes(1);
  expect(await f.service.status()).toMatchObject({ failed: 1, cursor: 1, state: 'queued' });
  f.advance(DELAY_MS - 1);
  await f.service.tick();
  expect(f.fetch).toHaveBeenCalledTimes(1);
  f.advance(1);
  await f.service.tick();
  f.advance(DELAY_MS);
  await f.service.tick();
  expect(await f.service.status()).toMatchObject({ state: 'completed', fetched: 1, failed: 1, skippedExisting: 1, cursor: 3 });
  expect(f.fetch.mock.calls.map(args => args[0])).toEqual(['FIGURE-1', 'FIGURE-2', 'FIGURE-3']);
  expect(f.logger.warning).toHaveBeenCalledTimes(1);
});

test('delay starts after the request finishes, also across new jobs', async () => {
  await f.service.submit(html('FIGURE-1'), creator);
  f.fetch.mockImplementationOnce(async () => { f.advance(30000); return { status: 'fetched' }; });
  await f.service.tick();
  await f.service.submit(html('FIGURE-2'), creator);
  f.advance(DELAY_MS - 1);
  await f.service.tick();
  expect(f.fetch).toHaveBeenCalledTimes(1);
  f.advance(1);
  await f.service.tick();
  expect(f.fetch).toHaveBeenCalledTimes(2);
});

test('a rate-limited fallback remains queued and waits rather than losing the item', async () => {
  await f.service.submit(html('FIGURE-1'), creator);
  f.fetch.mockResolvedValueOnce({ status: 'rate-limited' });
  await f.service.tick();
  expect(await f.service.status()).toMatchObject({ cursor: 0, failed: 0, state: 'queued' });
  await f.service.tick();
  expect(f.fetch).toHaveBeenCalledTimes(1);
  f.advance(DELAY_MS);
  await f.service.tick();
  expect(await f.service.status()).toMatchObject({ state: 'completed', fetched: 1 });
});

test('concurrent worker instances cannot fetch in parallel', async () => {
  await f.service.submit(html('FIGURE-1', 'FIGURE-2'), creator);
  const other = createAmiAmiUploadService(f.deps); other.start();
  let release;
  f.fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const first = f.service.tick();
  for (let i = 0; i < 20 && !release; i += 1) await Promise.resolve();
  await other.tick();
  await f.service.tick();
  expect(f.fetch).toHaveBeenCalledTimes(1);
  expect((await other.status()).currentCode).toBe('FIGURE-1');
  release({ status: 'fetched' }); await first;
  other.stop();
});

test('a waiting job resumes after a restart without losing its delay', async () => {
  await f.service.submit(html('FIGURE-1', 'FIGURE-2'), creator);
  await f.service.tick(); f.service.stop();
  const replacement = createAmiAmiUploadService(f.deps); replacement.start();
  await replacement.tick();
  expect(f.fetch).toHaveBeenCalledTimes(1);
  f.advance(DELAY_MS);
  await replacement.tick();
  expect(await replacement.status()).toMatchObject({ state: 'completed', fetched: 2 });
  replacement.stop();
});

test('stale in-flight jobs stop instead of replaying an uncertain item', async () => {
  await f.service.submit(html('FIGURE-1'), creator);
  Object.assign(f.row(), { state: 'running', leaseUntil: new Date(1000000 + LEASE_MS), leaseToken: 'old' });
  f.advance(LEASE_MS);
  await f.service.tick();
  expect(await f.service.status()).toMatchObject({ state: 'failed', message: expect.stringContaining('interrupted') });
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.logger.error).toHaveBeenCalled();
});

test('capability revocation and expired delegation stop the job before fetching', async () => {
  await f.service.submit(html('FIGURE-1'), creator);
  f.authorizeCreator.mockResolvedValue(false);
  await f.service.tick();
  expect(await f.service.status()).toMatchObject({ state: 'failed', message: expect.stringContaining('permission') });
  expect(f.fetch).not.toHaveBeenCalled();
  f.authorizeCreator.mockResolvedValue(true);
  await f.service.submit(html('FIGURE-2'), creator);
  f.advance(JOB_LIFETIME_MS);
  await f.service.tick();
  expect(await f.service.status()).toMatchObject({ state: 'failed', message: expect.stringContaining('expired') });
  expect(f.fetch).not.toHaveBeenCalled();
});

test('rejects missing authority on submission and never trusts arbitrary creator fields', async () => {
  await expect(f.service.submit(html('FIGURE-1'), 'invalid')).rejects.toMatchObject({ status: 403 });
  f.authorizeCreator.mockResolvedValue(false);
  await expect(f.service.submit(html('FIGURE-1'), creator)).rejects.toMatchObject({ status: 403 });
  expect(f.jobModel.findOneAndUpdate).not.toHaveBeenCalled();
});

test('storage/fallback exceptions are fatal and do not leak error messages', async () => {
  await f.service.submit(html('FIGURE-1', 'FIGURE-2'), creator);
  f.fetch.mockRejectedValue(new Error('mongodb://secret:password@host/private'));
  await f.service.tick();
  expect(await f.service.status()).toMatchObject({ state: 'failed', failed: 0 });
  expect(JSON.stringify([await f.service.status(), f.logger.error.mock.calls])).not.toContain('password');
  f.advance(DELAY_MS);
  await f.service.tick();
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

test('status reads do not advance work and unavailable/stopped workers do nothing', async () => {
  await f.service.submit(html('FIGURE-1'), creator);
  f.jobModel.findOneAndUpdate.mockClear();
  await f.service.status(); await f.service.status();
  expect(f.jobModel.findOneAndUpdate).not.toHaveBeenCalled();
  f.unavailable(); await f.service.tick();
  f.service.stop(); await f.service.tick();
  expect(f.fetch).not.toHaveBeenCalled();
});

test('failure samples stay bounded and exclude the fallback raw item payload', async () => {
  await f.service.submit(html(...Array.from({ length: 12 }, (_, i) => `FIGURE-${i}`)), creator);
  f.fetch.mockResolvedValue({ status: 'failed', item: { detailError: { message: '<html>secret</html>' } } });
  for (let i = 0; i < 12; i += 1) { await f.service.tick(); f.advance(DELAY_MS); }
  const job = await f.service.status();
  expect(job.failed).toBe(12);
  expect(job.failures).toHaveLength(10);
  expect(JSON.stringify(job)).not.toContain('secret');
});

test('integrates the existing fallback with one request, insert-only persistence and an existence recheck', async () => {
  const { createAmiAmiItemFallbackService } = require('../../services/amiamiItemFallbackService');
  const stored = new Map();
  const query = execute => ({ lean() { return this; }, exec: async () => execute() });
  const itemModel = {
    findOne: ({ gcode }) => query(() => stored.get(gcode)),
    findOneAndUpdate: ({ gcode }, update) => query(() => {
      if (!stored.has(gcode)) stored.set(gcode, update.$setOnInsert);
      return stored.get(gcode);
    }),
  };
  const detail = jest.fn(async gcode => ({ item: { gcode } }));
  const fallback = createAmiAmiItemFallbackService({ itemModel, fetchDetail: detail,
    normalize: data => data.item, serviceLogger: f.logger });
  f.fetch.mockImplementation(code => fallback.attemptMissingItemScrape(code));
  await f.service.submit(html('TOY-RBT-9417', 'FIGURE-2'), creator);
  // A separate writer adds the second code after upload filtering.
  stored.set('FIGURE-2', { gcode: 'FIGURE-2', details: { itemName: 'Existing product' } });
  await f.service.tick(); f.advance(DELAY_MS); await f.service.tick();
  expect(detail).toHaveBeenCalledTimes(1);
  expect(detail).toHaveBeenCalledWith('TOY-RBT-9417', { detailRetries: 0, retryDelayMs: 0 });
  expect(stored.get('TOY-RBT-9417')).toMatchObject({ detailStatus: 'fetched', details: { gcode: 'TOY-RBT-9417' } });
  expect(stored.get('FIGURE-2').details.itemName).toBe('Existing product');
  expect(await f.service.status()).toMatchObject({ state: 'completed', fetched: 1, skippedExisting: 1 });
});
