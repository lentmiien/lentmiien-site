// Every side-effecting dependency is isolated: no installer, network, DB or files.
jest.mock('fs/promises', () => ({
  mkdir: jest.fn(), readFile: jest.fn(), writeFile: jest.fn(), rename: jest.fn(),
}));
jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('mongoose', () => ({ connect: jest.fn(), disconnect: jest.fn() }));
jest.mock('../../models/amiami_item', () => ({
  countDocuments: jest.fn(), find: jest.fn(), bulkWrite: jest.fn(), updateOne: jest.fn(),
  collection: { name: 'amiamiitems' },
}));
jest.mock('../../scripts/install-curl-cffi', () => ({ ensureCurlCffiRuntime: jest.fn() }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('../../services/amiamiScraperService', () => ({
  AMIAMI_NEW_ITEMS_URL: 'https://www.amiami.com/files/eng/new_items/newitem.html',
  fetchNewItemsPage: jest.fn(), fetchItemDetail: jest.fn(), normalizeDetail: jest.fn(),
}));

const fs = require('fs/promises');
const mongoose = require('mongoose');
const model = require('../../models/amiami_item');
const installer = require('../../scripts/install-curl-cffi');
const logger = require('../../utils/logger');
const scraper = require('../../services/amiamiScraperService');
const { AmiAmiRequestError } = require('../../utils/amiamiDiagnostics');
const { main, extractNewItems } = require('../../scripts/scrape-amiami-new-items');

const listUrl = scraper.AMIAMI_NEW_ITEMS_URL;
const itemUrl = 'https://api.amiami.com/api/v1.0/item';
const summaryPath = '/mock/summary.json';
const dataPath = '/mock/items.json';
const listing = (gcode) => `<a href="/eng/detail?gcode=${gcode}"><p class="newly-added-items__item__name">Figure</p></a>`;
const args = (storage = 'tmp') => [
  `--storage=${storage}`, `--summary-file=${summaryPath}`, `--data-file=${dataPath}`,
  '--detail-delay-ms=0', '--mongo-uri=mongodb://user:private-password@localhost/test',
];
const requestError = (phase, kind = 'suspected_challenge', itemCode) => new AmiAmiRequestError(kind, {
  phase, target: phase === 'list' ? listUrl : itemUrl, itemCode, attempts: 1, startedAt: Date.now(),
}, { status: 403 });
const savedSummary = () => {
  const call = fs.writeFile.mock.calls.findLast(([file]) => file === `${summaryPath}.tmp`);
  return call ? JSON.parse(call[1]) : null;
};

let originalExitCode;
let exitSpy;
beforeEach(() => {
  jest.resetAllMocks();
  originalExitCode = process.exitCode;
  process.exitCode = undefined;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('Unexpected forced exit'); });
  fs.readFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  scraper.fetchNewItemsPage.mockResolvedValue(listing('FIGURE-1'));
  scraper.fetchItemDetail.mockResolvedValue({ RSuccess: true, item: { gcode: 'FIGURE-1' } });
  scraper.normalizeDetail.mockReturnValue({ gcode: 'FIGURE-1' });
  model.countDocuments.mockResolvedValue(0);
  const query = { select: jest.fn(), sort: jest.fn(), lean: jest.fn().mockResolvedValue([]) };
  query.select.mockReturnValue(query);
  query.sort.mockReturnValue(query);
  model.find.mockReturnValue(query);
});
afterEach(() => {
  expect(exitSpy).not.toHaveBeenCalled();
  process.exitCode = originalExitCode;
  jest.restoreAllMocks();
});

test('import is inert and --help does not initialize or write', async () => {
  await main(['--help']);
  expect(installer.ensureCurlCffiRuntime).not.toHaveBeenCalled();
  expect(mongoose.connect).not.toHaveBeenCalled();
  expect(fs.writeFile).not.toHaveBeenCalled();
});

test.each(['tmp', 'db'])('%s fatal list error replaces stale success with a failed summary and shared error log', async (storage) => {
  scraper.fetchNewItemsPage.mockRejectedValue(requestError('list'));
  const summary = await main(args(storage));
  expect(summary).toMatchObject({
    status: 'failed', storage, runId: expect.any(String), startedAt: expect.any(String),
    finishedAt: expect.any(String), elapsedMs: expect.any(Number), sourceItemCount: null,
    detailResults: { attempted: 0, fetched: 0, failed: 0 },
    error: { phase: 'list', status: 403, attempts: 1, code: 'AMIAMI_SUSPECTED_CHALLENGE' },
  });
  expect(savedSummary()).toEqual(summary);
  expect(fs.rename).toHaveBeenCalledWith(`${summaryPath}.tmp`, summaryPath);
  expect(scraper.fetchItemDetail).not.toHaveBeenCalled();
  expect(model.bulkWrite).not.toHaveBeenCalled();
  expect(model.updateOne).not.toHaveBeenCalled();
  expect(fs.writeFile.mock.calls.some(([file]) => file === `${dataPath}.tmp`)).toBe(false);
  expect(logger.error).toHaveBeenCalledWith('AmiAmi scraper run failed', expect.objectContaining({
    category: 'amiami-scraper', metadata: expect.objectContaining({ runId: summary.runId, summaryWritten: true }),
  }));
  expect(mongoose.disconnect).toHaveBeenCalledTimes(storage === 'db' ? 1 : 0);
  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no item fetching started'));
});

test.each(['tmp', 'db'])('%s partial detail failures retain counts and continue to the next item with exit zero', async (storage) => {
  scraper.fetchNewItemsPage.mockResolvedValue(listing('FIGURE-1') + listing('FIGURE-2'));
  scraper.fetchItemDetail.mockRejectedValueOnce(requestError('detail', 'forbidden', 'FIGURE-1'));
  const summary = await main(args(storage));
  expect(summary).toMatchObject({
    status: 'partial', sourceItemCount: 2, processedSourceItemCount: 2,
    newlyDiscoveredCount: 2, detailResults: { attempted: 2, fetched: 1, failed: 1 },
    failures: [{ itemCode: 'FIGURE-1', code: 'AMIAMI_FORBIDDEN', phase: 'detail', attempts: 1 }],
  });
  expect(savedSummary()).toEqual(summary);
  expect(logger.warning).toHaveBeenCalledTimes(1);
  expect(logger.error).not.toHaveBeenCalled();
  expect(process.exitCode).toBeUndefined();
  expect(scraper.fetchItemDetail).toHaveBeenCalledTimes(2);
  if (storage === 'db') {
    expect(model.updateOne).toHaveBeenCalledWith({ gcode: 'FIGURE-1' }, { $set: {
      detailStatus: 'error', detailError: { message: expect.stringContaining('Access denied'), at: expect.any(String) },
    } });
    expect(mongoose.disconnect).toHaveBeenCalledTimes(1);
  } else {
    const data = JSON.parse(fs.writeFile.mock.calls.findLast(([file]) => file === `${dataPath}.tmp`)[1]);
    expect(data.items['FIGURE-1'].detailStatus).toBe('error');
    expect(data.items['FIGURE-2'].detailStatus).toBe('fetched');
  }
});

test('bounds partial failure samples while preserving total counts', async () => {
  scraper.fetchNewItemsPage.mockResolvedValue(Array.from({ length: 14 }, (_, i) => listing(`FIGURE-${i}`)).join(''));
  scraper.fetchItemDetail.mockImplementation(async (gcode) => { throw requestError('detail', 'forbidden', gcode); });
  const summary = await main(args());
  expect(summary.detailResults).toMatchObject({ attempted: 14, failed: 14 });
  expect(summary.failures).toHaveLength(10);
  expect(logger.warning.mock.calls[0][1].metadata.failures).toHaveLength(10);
});

test.each(['tmp', 'db'])('%s persistence failure is fatal, not a fetch failure', async (storage) => {
  const error = Object.assign(new Error('private-password database payload'), { code: 'ENOSPC' });
  if (storage === 'db') model.updateOne.mockRejectedValue(error);
  else fs.writeFile.mockImplementation(async (file) => { if (file === `${dataPath}.tmp`) throw error; });
  const summary = await main(args(storage));
  expect(summary).toMatchObject({
    status: 'failed', error: { phase: 'detail-persistence', itemCode: 'FIGURE-1', systemCode: 'ENOSPC' },
    detailResults: { attempted: 1, fetched: 0, failed: 0 }, failures: [],
  });
  if (storage === 'db') expect(model.updateOne).toHaveBeenCalledTimes(1);
  expect(process.exitCode).toBe(1);
  expect(savedSummary()).toEqual(summary);
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private-password');
});

test('retains upstream failure when persisting its error status also fails', async () => {
  scraper.fetchItemDetail.mockRejectedValue(requestError('detail', 'unavailable', 'FIGURE-1'));
  model.updateOne.mockRejectedValue(new Error('private-password'));
  const summary = await main(args('db'));
  expect(summary.error.phase).toBe('detail-persistence');
  expect(summary.detailResults.failed).toBe(1);
  expect(summary.failures[0].code).toBe('AMIAMI_UNAVAILABLE');
});

test('listing storage failure does not start detail requests', async () => {
  model.bulkWrite.mockRejectedValue(new Error('private-password'));
  const summary = await main(args('db'));
  expect(summary.error.phase).toBe('listing-persistence');
  expect(summary.sourceItemCount).toBe(1);
  expect(scraper.fetchItemDetail).not.toHaveBeenCalled();
  expect(mongoose.disconnect).toHaveBeenCalledTimes(1);
});

test('database initialization failure is sanitized, summarized and disconnected', async () => {
  mongoose.connect.mockRejectedValue(new Error('mongodb://user:private-password@localhost/test'));
  const summary = await main(args('db'));
  expect(summary.error.phase).toBe('storage-connect');
  expect(mongoose.disconnect).toHaveBeenCalledTimes(1);
  expect(savedSummary()).toEqual(summary);
  expect(scraper.fetchNewItemsPage).not.toHaveBeenCalled();
  expect(JSON.stringify([summary, logger.error.mock.calls, console.error.mock.calls])).not.toContain('private-password');
});

test('runtime initialization failure creates a failed summary without network or DB use', async () => {
  installer.ensureCurlCffiRuntime.mockRejectedValue(new Error('private-password install error'));
  const summary = await main(args('db'));
  expect(summary.error).toMatchObject({ phase: 'runtime', message: expect.stringContaining('install:curl-cffi') });
  expect(mongoose.connect).not.toHaveBeenCalled();
  expect(mongoose.disconnect).not.toHaveBeenCalled();
  expect(scraper.fetchNewItemsPage).not.toHaveBeenCalled();
  expect(savedSummary()).toEqual(summary);
  expect(process.exitCode).toBe(1);
});

test('argument failure does not echo argument values and uses the default summary path', async () => {
  const summary = await main(['--unknown=private-password']);
  expect(summary.error.phase).toBe('arguments');
  expect(installer.ensureCurlCffiRuntime).not.toHaveBeenCalled();
  expect(fs.writeFile.mock.calls[0][0]).toMatch(/amiami-new-items-summary.json.tmp$/);
  expect(JSON.stringify([summary, console.error.mock.calls, logger.error.mock.calls])).not.toContain('private-password');
});

test('invalid local JSON is a storage-read failure, not an upstream failure', async () => {
  fs.readFile.mockResolvedValue('{private-body');
  const summary = await main(args());
  expect(summary.error.phase).toBe('storage-read');
  expect(scraper.fetchNewItemsPage).not.toHaveBeenCalled();
  expect(JSON.stringify(summary)).not.toContain('private-body');
});

test('summary write failure reports stale-summary risk without masking the original error', async () => {
  scraper.fetchNewItemsPage.mockRejectedValue(requestError('list'));
  fs.rename.mockRejectedValue(Object.assign(new Error('private-path'), { code: 'EACCES' }));
  const summary = await main(args());
  expect(summary.error.phase).toBe('list');
  expect(summary.summaryWriteFailure).toMatchObject({ phase: 'summary', systemCode: 'EACCES' });
  expect(summary.summaryWriteFailure.message).toContain('previous summary may be stale');
  expect(logger.error.mock.calls[0][1].metadata.summaryWritten).toBe(false);
  expect(process.exitCode).toBe(1);
});

test('summary persistence failure after otherwise successful work is fatal', async () => {
  fs.writeFile.mockImplementation(async (file) => { if (file === `${summaryPath}.tmp`) throw new Error('disk'); });
  const summary = await main(args());
  expect(summary).toMatchObject({ status: 'failed', error: { phase: 'summary' }, detailResults: { fetched: 1 } });
  expect(process.exitCode).toBe(1);
});

test('cleanup failure cannot mask the original list failure', async () => {
  scraper.fetchNewItemsPage.mockRejectedValue(requestError('list'));
  mongoose.disconnect.mockRejectedValue(new Error('private-password'));
  const summary = await main(args('db'));
  expect(summary.error.phase).toBe('list');
  expect(summary.cleanupFailure.phase).toBe('cleanup');
  expect(savedSummary()).toEqual(summary);
});

test('cleanup failure after successful work is fatal', async () => {
  mongoose.disconnect.mockRejectedValue(new Error('private-password'));
  const summary = await main(args('db'));
  expect(summary).toMatchObject({ status: 'failed', error: { phase: 'cleanup' }, detailResults: { fetched: 1 } });
  expect(process.exitCode).toBe(1);
});

test('waits for cleanup and logger before completing; logger rejection still leaves exit nonzero', async () => {
  let finishDisconnect;
  let finishLog;
  mongoose.disconnect.mockImplementation(() => new Promise((resolve) => { finishDisconnect = resolve; }));
  logger.error.mockImplementation(() => new Promise((resolve, reject) => { finishLog = reject; }));
  scraper.fetchNewItemsPage.mockRejectedValue(requestError('list'));
  let finished = false;
  const request = main(args('db')).then((value) => { finished = true; return value; });
  // Flush promises until disconnect is reached, without relying on real timers.
  for (let i = 0; i < 30 && !finishDisconnect; i += 1) await Promise.resolve();
  expect(finishDisconnect).toEqual(expect.any(Function));
  expect(finished).toBe(false);
  expect(fs.writeFile).not.toHaveBeenCalled();
  finishDisconnect();
  for (let i = 0; i < 30 && !finishLog; i += 1) await Promise.resolve();
  expect(finishLog).toEqual(expect.any(Function));
  expect(finished).toBe(false);
  finishLog(new Error('private-password'));
  await request;
  expect(finished).toBe(true);
  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('log write failed'));
});

test.each(['tmp', 'db'])('%s normal list-only runs retain summary fields and legitimately empty lists succeed', async (storage) => {
  scraper.fetchNewItemsPage.mockResolvedValue('<h1>New Products</h1>');
  const summary = await main([...args(storage), '--list-only']);
  expect(summary).toMatchObject({ status: 'success', sourceItemCount: 0, newlyDiscovered: [], pendingDetailCount: 0 });
  expect(logger.warning).not.toHaveBeenCalled();
  expect(logger.error).not.toHaveBeenCalled();
  expect(process.exitCode).toBeUndefined();
  expect(scraper.fetchItemDetail).not.toHaveBeenCalled();
  expect(savedSummary()).toEqual(summary);
});

test('normal list parsing preserves item code and listing data', () => {
  expect(extractNewItems(listing('FIGURE-1'))).toEqual([
    expect.objectContaining({ gcode: 'FIGURE-1', itemName: 'Figure', url: 'https://www.amiami.com/eng/detail?gcode=FIGURE-1' }),
  ]);
});

test.each([false, true])('isolated child exits naturally after draining cleanup/log output (fatal=%s)', (fatal) => {
  const { spawnSync } = require('child_process');
  const script = require.resolve('../../scripts/scrape-amiami-new-items');
  // No real installer, native client, filesystem or MongoDB is used in the child.
  const childSource = `
    const Module = require('module');
    const originalLoad = Module._load;
    const later = (message) => new Promise(resolve => setTimeout(() => { console.log(message); resolve(); }, 10));
    const overrides = {
      'fs/promises': { mkdir: async () => {}, writeFile: async () => {}, rename: async () => {} },
      dotenv: { config: () => {} },
      mongoose: { connect: async () => {}, disconnect: () => later('CLEANUP_DRAINED') },
      '../models/amiami_item': {
        countDocuments: async () => 0, collection: { name: 'test' },
        find: () => ({ select() { return this; }, sort() { return this; }, lean: async () => [] }),
      },
      './install-curl-cffi': { ensureCurlCffiRuntime: async () => {} },
      '../utils/logger': { error: () => later('LOGGER_DRAINED'), warning: () => later('LOGGER_DRAINED') },
      '../services/amiamiScraperService': {
        AMIAMI_NEW_ITEMS_URL: 'https://www.amiami.com/files/eng/new_items/newitem.html',
        fetchNewItemsPage: async () => { ${fatal ? "throw new Error('synthetic failure');" : "return '<h1>New Products</h1>';"} },
      },
    };
    Module._load = function(name, ...rest) {
      return Object.hasOwn(overrides, name) ? overrides[name] : originalLoad.call(this, name, ...rest);
    };
    require(${JSON.stringify(script)}).main(['--storage=db', '--mongo-uri=mongodb://mock/test'])
      .then(() => console.log('RUN_DRAINED'));
  `;
  const child = spawnSync(process.execPath, ['-e', childSource], { encoding: 'utf8', timeout: 5000 });
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(fatal ? 1 : 0);
  expect(child.stdout).toContain('CLEANUP_DRAINED');
  if (fatal) expect(child.stdout).toContain('LOGGER_DRAINED');
  expect(child.stdout.trim().endsWith('RUN_DRAINED')).toBe(true);
});
