jest.mock('../../database', () => ({ AmiAmiItem: {} }));

const { createAmiAmiUploadService } = require('../../services/amiamiUploadService');
const { MAX_CODES, DELAY_MS, LEASE_MS, JOB_LIFETIME_MS } = require('../../utils/amiamiUploadPolicy');
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
      if ('$in' in expected) return expected.$in.includes(value?.[key]);
      if ('$exists' in expected) return (value?.[key] !== undefined) === expected.$exists;
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
  const itemModel = { find: jest.fn(filter => query(() => existing.map(item => typeof item === 'string' ? { gcode: item } : item)
    .filter(item => filter.gcode.$in.includes(item.gcode) && (!filter.source || (item.source === filter.source
      && item.detailStatus === filter.detailStatus && item.details == null))))) };
  const fetch = jest.fn().mockResolvedValue({ status: 'fetched' });
  const retry = jest.fn().mockResolvedValue({ status: 'fetched' });
  const authorizeCreator = jest.fn().mockResolvedValue(true);
  const logger = { warning: jest.fn(), error: jest.fn() };
  let available = true;
  const deps = { jobModel, itemModel, attemptMissingItemScrape: fetch, retryFailedItemScrape: retry, authorizeCreator,
    logger, now: () => clock, ready: () => available };
  const service = createAmiAmiUploadService(deps);
  service.start();
  return { service, deps, jobModel, fetch, retry, authorizeCreator, logger,
    row: () => row, advance: ms => { clock += ms; }, unavailable: () => { available = false; } };
}
let f;
beforeEach(() => { jest.useFakeTimers(); f = fixture(); });
afterEach(() => { f.service.stop(); jest.useRealTimers(); });

test.each(['html', 'codes'])('normalizes and deduplicates before catalog lookup for %s', async format => {
  f.service.stop(); f = fixture(['FIGURE-1']);
  const codes = ['FIGURE-1-R001', 'FIGURE-1-S002', 'FIGURE-1-D003', 'GOODS-2-R004', 'GOODS-2-D005', 'GOODS-2'];
  const job = await f.service.submit(format === 'html' ? html(...codes) : codes.join('\n'), creator, format);
  expect(job).toMatchObject({ totalCodes: 2, queuedCount: 1, skippedExisting: 1 });
  expect(job).not.toHaveProperty('sizeFallbacks');
  expect(f.deps.itemModel.find).toHaveBeenCalledWith({ gcode: { $in: ['FIGURE-1', 'GOODS-2'] } });
  expect(f.row().sizeFallbacks).toEqual([]);
  await f.service.tick();
  expect(f.fetch.mock.calls).toEqual([['GOODS-2']]);
});

test('failed base queues each distinct original size at the tail and successful recovery clears item failures', async () => {
  await f.service.submit('GOODS-1-S001\nGOODS-1-S002\nGOODS-1-S001\nGOODS-1-R003\nFIGURE-2', creator, 'codes');
  f.fetch.mockResolvedValueOnce({ status: 'failed' });
  await f.service.tick();
  expect(f.row().codes).toEqual(['FIGURE-2', 'GOODS-1-S001', 'GOODS-1-S002']);
  expect(f.row().sizeFallbacks).toEqual([]);
  expect(await f.service.status()).toMatchObject({ totalCodes: 3, queuedCount: 3, cursor: 0, failed: 0, failures: [], state: 'queued' });
  await f.service.tick();
  expect(f.fetch).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 3; i += 1) { f.advance(DELAY_MS); await f.service.tick(); }
  expect(f.fetch.mock.calls).toEqual([['GOODS-1'], ['FIGURE-2'], ['GOODS-1-S001'], ['GOODS-1-S002']]);
  expect(await f.service.status()).toMatchObject({ state: 'completed', fetched: 3, failed: 0, failures: [], cursor: 3 });
  expect(f.logger.warning).toHaveBeenCalledWith('AmiAmi list import item fetch failed', expect.objectContaining({ category: 'amiami-upload' }));
});

test('successful base does not fetch size variants, and R/D failures never retry their originals', async () => {
  await f.service.submit('GOODS-1-S001\nGOODS-1-S002\nFIGURE-2-R001\nFIGURE-3-D001', creator, 'codes');
  f.fetch.mockResolvedValueOnce({ status: 'fetched' }).mockResolvedValue({ status: 'failed' });
  for (let i = 0; i < 4; i += 1) { await f.service.tick(); f.advance(DELAY_MS); }
  expect(f.fetch.mock.calls).toEqual([['GOODS-1'], ['FIGURE-2'], ['FIGURE-3']]);
  expect(await f.service.status()).toMatchObject({ state: 'completed', fetched: 1, failed: 2 });
});

test('size fallback persists across restart, honors pacing/rate limits and stops after one failed attempt', async () => {
  await f.service.submit('GOODS-1-S001', creator, 'codes');
  f.fetch.mockResolvedValueOnce({ status: 'rate-limited' }).mockResolvedValueOnce({ status: 'failed' });
  await f.service.tick();
  expect(f.row().sizeFallbacks).toHaveLength(1);
  f.advance(DELAY_MS); await f.service.tick();
  f.service.stop();
  f.service = createAmiAmiUploadService(f.deps); f.service.start();
  await f.service.tick();
  expect(f.fetch).toHaveBeenCalledTimes(2);
  f.fetch.mockResolvedValueOnce({ status: 'rate-limited' }).mockResolvedValue({ status: 'failed' });
  f.advance(DELAY_MS); await f.service.tick();
  expect(f.row().codes).toEqual(['GOODS-1-S001']);
  expect(f.row().cursor).toBe(0);
  f.advance(DELAY_MS); await f.service.tick();
  f.advance(DELAY_MS); await f.service.tick();
  expect(f.fetch.mock.calls).toEqual([['GOODS-1'], ['GOODS-1'], ['GOODS-1-S001'], ['GOODS-1-S001']]);
  expect(await f.service.status()).toMatchObject({ state: 'completed', failed: 1, failures: [{ itemCode: 'GOODS-1-S001', message: expect.any(String) }] });
});

test.each([false, true])('original size fallback uses the chosen failed-placeholder policy: %s', async retryFailed => {
  await f.service.submit('GOODS-1-S001', creator, 'codes', { retryFailed });
  const fetch = retryFailed ? f.retry : f.fetch;
  fetch.mockResolvedValueOnce({ status: 'failed' });
  await f.service.tick();
  f.advance(DELAY_MS); await f.service.tick();
  expect(fetch.mock.calls).toEqual([['GOODS-1'], ['GOODS-1-S001']]);
  expect(await f.service.status()).toMatchObject({ state: 'completed', fetched: 1, failed: 0 });
});

test('existing failed bases can fall back to sizes without refreshing the base placeholder', async () => {
  f.service.stop(); f = fixture([{ gcode: 'GOODS-1', detailStatus: 'error' }]);
  expect(await f.service.submit('GOODS-1-S001', creator, 'codes')).toMatchObject({ queuedCount: 1, skippedErrors: 0 });
  f.fetch.mockResolvedValueOnce({ status: 'existing', item: { detailStatus: 'error' } });
  await f.service.tick();
  f.advance(DELAY_MS); await f.service.tick();
  expect(f.fetch.mock.calls).toEqual([['GOODS-1'], ['GOODS-1-S001']]);
  expect(f.retry).not.toHaveBeenCalled();
  expect(await f.service.status()).toMatchObject({ state: 'completed', fetched: 1, failed: 0, skippedExisting: 0, skippedErrors: 0 });
});

test('revoked permission prevents an already queued original-size attempt', async () => {
  await f.service.submit('GOODS-1-S001', creator, 'codes');
  f.fetch.mockResolvedValueOnce({ status: 'failed' });
  await f.service.tick();
  f.authorizeCreator.mockResolvedValue(false);
  f.advance(DELAY_MS); await f.service.tick();
  expect(f.fetch.mock.calls).toEqual([['GOODS-1']]);
  expect(await f.service.status()).toMatchObject({ state: 'failed', message: expect.stringContaining('permission') });
});

test('error placeholders remain visible as incomplete until an explicit bounded recovery import', async () => {
  f.service.stop(); f = fixture([
    { gcode: 'FIGURE-1', source: 'amiami-api-lookup', detailStatus: 'error', details: null },
    { gcode: 'FIGURE-2', source: 'amiami-api-lookup', detailStatus: 'fetched', details: { itemName: 'Preserved' } },
  ]);
  const ordinary = await f.service.submit('FIGURE-1\nFIGURE-2', creator, 'codes');
  expect(ordinary).toMatchObject({ state: 'completed', skippedErrors: 1, queuedCount: 0 });
  expect(ordinary.message).toContain('still have fetch errors');
  const recovery = await f.service.submit('FIGURE-1\nFIGURE-2\nFIGURE-3', creator, 'codes', { retryFailed: true });
  expect(recovery).toMatchObject({ queuedCount: 2, skippedExisting: 1, skippedErrors: 0, retryFailed: true });
  await f.service.tick();
  expect(f.retry).toHaveBeenCalledWith('FIGURE-1');
  await f.service.tick();
  expect(f.retry).toHaveBeenCalledTimes(1);
  f.advance(DELAY_MS);
  await f.service.tick();
  expect(f.retry).toHaveBeenLastCalledWith('FIGURE-3');
  expect(f.fetch).not.toHaveBeenCalled();
});

test('recovery imports recheck permission before dispatch', async () => {
  await f.service.submit('FIGURE-1', creator, 'codes', { retryFailed: true });
  f.authorizeCreator.mockResolvedValue(false);
  await f.service.tick();
  expect(f.retry).not.toHaveBeenCalled();
  expect(await f.service.status()).toMatchObject({ state: 'failed' });
});
test('a failed record appearing after submission is reported as a skipped error', async () => {
  await f.service.submit('FIGURE-1', creator, 'codes');
  f.fetch.mockResolvedValue({ status: 'existing', item: { detailStatus: 'error' } });
  await f.service.tick();
  expect(await f.service.status()).toMatchObject({ state: 'completed', skippedExisting: 1, skippedErrors: 1, fetched: 0 });
});

test('code lists filter existing records and use the same single-job queue and delay as HTML', async () => {
  f.service.stop(); f = fixture(['FIGURE-1']);
  const result = await f.service.submit('FIGURE-1\r\nTOY-RBT-9417\r\nTOY-RBT-9417\r\nFIGURE-2', creator, 'codes');
  expect(result).toMatchObject({ totalCodes: 3, queuedCount: 2, skippedExisting: 1 });
  expect(f.row().codes).toEqual(['TOY-RBT-9417', 'FIGURE-2']);
  expect(await f.service.submit(html('TOY-RBT-9417'), creator)).toMatchObject({ totalCodes: 3, queuedCount: 2 });
  await f.service.tick();
  f.advance(DELAY_MS - 1);
  await f.service.tick();
  expect(f.fetch.mock.calls).toEqual([['TOY-RBT-9417']]);
  f.advance(1);
  await f.service.tick();
  expect(f.fetch.mock.calls).toEqual([['TOY-RBT-9417'], ['FIGURE-2']]);
  expect(await f.service.status()).toMatchObject({ state: 'completed', fetched: 2 });
});

test('invalid code-list row rejects the whole submission before catalog lookup or queue writes', async () => {
  await expect(f.service.submit('FIGURE-1\nprivate invalid input', creator, 'codes')).rejects.toMatchObject({ code: 'INVALID_CODE' });
  expect(f.deps.itemModel.find).not.toHaveBeenCalled();
  expect(f.jobModel.findOneAndUpdate).not.toHaveBeenCalled();
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.row()).toBeNull();
});

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

test('concurrent uploads append to one shared job without losing items or duplicating codes', async () => {
  const results = await Promise.allSettled([
    f.service.submit(html('FIGURE-1', 'FIGURE-2'), creator), f.service.submit(html('FIGURE-2', 'FIGURE-3'), creator),
  ]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2);
  expect(results[0].value.jobId).toBe(results[1].value.jobId);
  expect(f.row().codes).toEqual(['FIGURE-1', 'FIGURE-2', 'FIGURE-3']);
  expect(await f.service.status()).toMatchObject({ totalCodes: 3, queuedCount: 3 });
  await Promise.all([f.service.submit('FIGURE-4', creator, 'codes'), f.service.submit('FIGURE-5', creator, 'codes')]);
  expect(f.row().codes).toEqual(['FIGURE-1', 'FIGURE-2', 'FIGURE-3', 'FIGURE-4', 'FIGURE-5']);
});

test('appending during a fetch preserves the claim, delay, progress and submission-specific retry setting', async () => {
  const initial = await f.service.submit('FIGURE-1\nFIGURE-2', creator, 'codes');
  await f.service.tick();
  f.advance(DELAY_MS);
  let release;
  f.fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const running = f.service.tick();
  for (let i = 0; i < 30 && !release; i += 1) await Promise.resolve();
  expect(release).toBeDefined();
  const claim = f.row().leaseToken;
  const expiry = f.row().expiresAt;
  const appended = await f.service.submit('FIGURE-2-R001\nGOODS-3-S001', 'b'.repeat(24), 'codes', { retryFailed: true });
  expect(appended).toMatchObject({ jobId: initial.jobId, state: 'running', currentCode: 'FIGURE-2', fetched: 1, totalCodes: 3 });
  expect(f.row().leaseToken).toBe(claim);
  expect(f.row().expiresAt).toEqual(expiry);
  expect(f.row().codes).toEqual(['FIGURE-2', 'GOODS-3']);
  release({ status: 'fetched' }); await running;
  await f.service.tick();
  expect(f.retry).not.toHaveBeenCalled();
  f.retry.mockResolvedValueOnce({ status: 'failed' });
  f.advance(DELAY_MS); await f.service.tick();
  expect(f.retry).toHaveBeenCalledWith('GOODS-3');
  expect(f.authorizeCreator).toHaveBeenLastCalledWith('b'.repeat(24));
  f.advance(DELAY_MS); await f.service.tick();
  expect(f.retry).toHaveBeenLastCalledWith('GOODS-3-S001');
  expect(await f.service.status()).toMatchObject({ state: 'completed', fetched: 3, failed: 0, totalCodes: 3 });
});

test('appending sizes to a currently fetching base preserves their submitter and fallback options', async () => {
  await f.service.submit('GOODS-1-S001', creator, 'codes');
  let release;
  f.fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const running = f.service.tick();
  for (let i = 0; i < 30 && !release; i += 1) await Promise.resolve();
  await f.service.submit('GOODS-1-S002\nGOODS-1-S001', 'b'.repeat(24), 'codes', { retryFailed: true });
  release({ status: 'failed' }); await running;
  expect(f.row().codes).toEqual(['GOODS-1-S001', 'GOODS-1-S002']);
  f.advance(DELAY_MS); await f.service.tick();
  expect(f.fetch).toHaveBeenLastCalledWith('GOODS-1-S001');
  f.advance(DELAY_MS); await f.service.tick();
  expect(f.retry).toHaveBeenCalledWith('GOODS-1-S002');
  expect(f.authorizeCreator).toHaveBeenLastCalledWith('b'.repeat(24));
  expect(await f.service.status()).toMatchObject({ state: 'completed', fetched: 2, totalCodes: 2 });
});

test('a worker rebases a stale completion update after a simultaneous append without fetching twice', async () => {
  await f.service.submit('FIGURE-1', creator, 'codes');
  const update = f.jobModel.findOneAndUpdate.getMockImplementation();
  let injected = false;
  f.jobModel.findOneAndUpdate.mockImplementation((filter, change, options) => {
    const query = update(filter, change, options);
    if (!injected && change.$set.state === 'completed') {
      injected = true;
      const exec = query.exec;
      query.exec = async () => {
        await f.service.submit('FIGURE-2', creator, 'codes');
        return exec();
      };
    }
    return query;
  });
  await f.service.tick();
  expect(injected).toBe(true);
  expect(f.fetch.mock.calls).toEqual([['FIGURE-1']]);
  expect(await f.service.status()).toMatchObject({ state: 'queued', totalCodes: 2, fetched: 1 });
  f.advance(DELAY_MS); await f.service.tick();
  expect(f.fetch.mock.calls).toEqual([['FIGURE-1'], ['FIGURE-2']]);
  expect(await f.service.status()).toMatchObject({ state: 'completed', fetched: 2 });
});

test('an append racing the last completion starts a new job and preserves the remaining delay', async () => {
  const initial = await f.service.submit('FIGURE-1', creator, 'codes');
  const update = f.jobModel.findOneAndUpdate.getMockImplementation();
  let injected = false;
  f.jobModel.findOneAndUpdate.mockImplementation((filter, change, options) => {
    const query = update(filter, change, options);
    if (!injected && filter.state?.$in) {
      injected = true;
      const exec = query.exec;
      query.exec = async () => { await f.service.tick(); return exec(); };
    }
    return query;
  });
  const added = await f.service.submit('FIGURE-2', creator, 'codes');
  expect(added.jobId).not.toBe(initial.jobId);
  expect(f.row().codes).toEqual(['FIGURE-2']);
  await f.service.tick();
  expect(f.fetch.mock.calls).toEqual([['FIGURE-1']]);
  f.advance(DELAY_MS); await f.service.tick();
  expect(f.fetch.mock.calls).toEqual([['FIGURE-1'], ['FIGURE-2']]);
});

test('invalid or unauthorized additions leave active work unchanged', async () => {
  await f.service.submit('FIGURE-1', creator, 'codes');
  const before = structuredClone(f.row());
  await expect(f.service.submit('FIGURE-2\ninvalid input', creator, 'codes')).rejects.toMatchObject({ code: 'INVALID_CODE' });
  f.authorizeCreator.mockResolvedValue(false);
  await expect(f.service.submit('FIGURE-2', 'b'.repeat(24), 'codes')).rejects.toMatchObject({ status: 403 });
  expect(f.row()).toEqual(before);
});

test('queue capacity reserves size fallbacks, rejects excess atomically and frees space as items finish', async () => {
  const variants = Array.from({ length: MAX_CODES }, (_, i) => `GOODS-1-S${String(i).padStart(3, '0')}`);
  await f.service.submit(variants.join('\n'), creator, 'codes');
  const before = structuredClone(f.row());
  await expect(f.service.submit('FIGURE-2', creator, 'codes')).rejects.toMatchObject({ code: 'QUEUE_FULL', status: 413 });
  expect(f.row()).toEqual(before);
  await f.service.tick();
  await f.service.submit(Array.from({ length: MAX_CODES }, (_, i) => `FIGURE-${i}`).join('\n'), creator, 'codes');
  await expect(f.service.submit('TOY-1', creator, 'codes')).rejects.toMatchObject({ code: 'QUEUE_FULL' });
  f.advance(DELAY_MS); await f.service.tick();
  await f.service.submit('TOY-1', creator, 'codes');
  expect(f.row().codes).toHaveLength(MAX_CODES);
  expect(f.row().codes.at(-1)).toBe('TOY-1');
  expect(await f.service.status()).toMatchObject({ fetched: 1, totalCodes: MAX_CODES + 1 });
});

test('appended work rechecks its own submitter and cannot extend the original job deadline', async () => {
  await f.service.submit('FIGURE-1', creator, 'codes');
  const secondCreator = 'b'.repeat(24);
  await f.service.submit('FIGURE-2', secondCreator, 'codes');
  await f.service.tick();
  f.authorizeCreator.mockImplementation(async id => id !== secondCreator);
  f.advance(DELAY_MS); await f.service.tick();
  expect(f.fetch.mock.calls).toEqual([['FIGURE-1']]);
  expect(await f.service.status()).toMatchObject({ state: 'failed', message: expect.stringContaining('permission') });
  f.authorizeCreator.mockResolvedValue(true);
  await f.service.submit('FIGURE-3', creator, 'codes');
  f.advance(JOB_LIFETIME_MS);
  const expired = structuredClone(f.row());
  await expect(f.service.submit('FIGURE-4', creator, 'codes')).rejects.toMatchObject({ code: 'JOB_EXPIRED' });
  expect(f.row()).toEqual(expired);
});

test('old persisted queues without version or per-code options accept additions and retain original authority', async () => {
  await f.service.submit('FIGURE-1', creator, 'codes');
  delete f.row().queueVersion;
  delete f.row().codeOptions;
  delete f.row().sizeFallbacks;
  await f.service.submit('FIGURE-2', 'b'.repeat(24), 'codes');
  await f.service.tick();
  expect(f.authorizeCreator).toHaveBeenLastCalledWith(creator);
  f.advance(DELAY_MS); await f.service.tick();
  expect(f.authorizeCreator).toHaveBeenLastCalledWith('b'.repeat(24));
  expect(await f.service.status()).toMatchObject({ state: 'completed', fetched: 2 });
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
