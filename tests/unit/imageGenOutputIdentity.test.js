const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const mockGateway = { baseUrl: 'https://gateway.example', getStatus: jest.fn(), submitPrompt: jest.fn(), fetchImage: jest.fn() };
const mockBulk = { find: jest.fn(), findOne: jest.fn(), updateOne: jest.fn(), aggregate: jest.fn() };
const mockJobs = { findById: jest.fn() };
const mockGood = { create: jest.fn() };
const mockThumbnail = jest.fn();
let mockCache;
jest.mock('../../database', () => ({
  BulkTestPrompt: mockBulk, BulkJob: mockJobs, GoodImage: mockGood,
  Prompt: { findOneAndUpdate: jest.fn(() => ({ lean: async () => null })) },
}));
jest.mock('../../services/comfyOutputCacheService', () => {
  const actual = jest.requireActual('../../services/comfyOutputCacheService');
  return { ComfyOutputCacheService: jest.fn().mockImplementation(() => ({
    record: (...args) => mockCache.record(...args), verifiedRecord: (...args) => mockCache.verifiedRecord(...args),
    exists: (...args) => mockCache.exists(...args), ensure: (...args) => mockCache.ensure(...args),
  })), };
});
jest.mock('../../services/localImageThumbnailService', () => ({ LocalImageThumbnailService: jest.fn(() => ({ get: mockThumbnail })) }));
jest.mock('../../services/embeddingQueueService', () => ({ enqueueGoodImage: jest.fn() }));
jest.mock('../../services/comfyGatewayService', () => {
  const actual = jest.requireActual('../../services/comfyGatewayService');
  return Object.assign(jest.fn(() => mockGateway), { gatewayLogMetadata: actual.gatewayLogMetadata });
});
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn(), notice: jest.fn() }));
jest.mock('../../utils/apiDebugLogger', () => ({ createApiDebugLogger: () => jest.fn() }));
const controller = require('../../controllers/image_gen.controller');
const { ComfyOutputCacheService } = jest.requireActual('../../services/comfyOutputCacheService');
let directory, jobId;
const remote = subfolder => ({ filename: 'same.png', subfolder, type: 'output', node_id: '8', gateway_view_url: '/comfy/view?filename=wrong.png' });
const response = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis(), setHeader: jest.fn(), set: jest.fn().mockReturnThis(), sendFile: jest.fn(), end: jest.fn() });
const chain = value => ({ select: () => chain(value), sort: () => chain(value), limit: () => chain(value), lean: async () => value });
beforeEach(async () => {
  jest.useFakeTimers();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imgen-controller-'));
  jobId = path.basename(directory);
  mockCache = new ComfyOutputCacheService({ provider: mockGateway.baseUrl, directory, fetchImage: file => mockGateway.fetchImage(file) });
  mockGateway.fetchImage.mockImplementation(async file => ({ buffer: Buffer.from(file.subfolder) }));
  mockGateway.getStatus.mockResolvedValue({ prompt_id: jobId, status: 'completed', outputs: [remote('normal'), remote('uncensored')] });
  mockBulk.findOne.mockReturnValue(chain(null));
});
afterEach(async () => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); await fs.rm(directory, { recursive: true, force: true }); });
async function status(instance) {
  const res = response();
  await controller.getJob({ params: { id: jobId }, query: instance ? { instance_id: instance } : {} }, res);
  return res.json.mock.calls.at(-1)[0];
}
async function download(file, index = file.index, query = {}) {
  const res = response();
  await controller.getJobFile({ params: { id: jobId, index: String(index) }, query: { cache_key: file.cache_key, ...query } }, res);
  return res;
}

test('duplicate filenames keep index identity through status, downloads and favorites', async () => {
  mockGateway.submitPrompt.mockResolvedValue(await mockGateway.getStatus());
  const generated = response();
  await controller.generate({ body: { prompt: { 8: { class_type: 'SaveImage' } }, prompt_text: 'Synthetic test' } }, generated);
  const files = (await status()).files;
  expect(files.map(file => file.subfolder)).toEqual(['normal', 'uncensored']);
  expect(files[0].cached_url).not.toEqual(files[1].cached_url);
  expect(files[0].cached_url).toContain('/files/0?cache_key=');
  expect(files[1].cached_url).toContain('/files/1?cache_key=');
  for (const file of files) {
    const res = await download(file, file.index, { filename: 'wrong.png', bucket: 'input' });
    expect(await fs.readFile(res.sendFile.mock.calls[0][0], 'utf8')).toBe(file.subfolder);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  }
  const copiedBytes = [];
  jest.spyOn(fs, 'copyFile').mockImplementation(async source => { copiedBytes.push(await fs.readFile(source, 'utf8')); });
  mockGood.create.mockImplementation(async fields => ({ _id: 'a'.repeat(24), ...fields }));
  const rated = response();
  await controller.rateJob({ body: { job_id: jobId, rating: 'good' } }, rated);
  expect(copiedBytes).toEqual(['normal', 'uncensored']);
  expect(rated.json.mock.calls[0][0].saved).toHaveLength(2);
  expect(mockGateway.fetchImage).toHaveBeenCalledTimes(2);
});

test('terminal memoization is isolated by instance, and failed output caching retries', async () => {
  let failNormal = true;
  mockGateway.fetchImage.mockImplementation(async file => {
    if (file.subfolder === 'normal' && failNormal) { failNormal = false; throw new Error('private provider failure'); }
    return { buffer: Buffer.from(file.subfolder) };
  });
  const first = await status();
  expect(first.files[0]).toMatchObject({ cached: false, cached_url: null });
  expect(JSON.stringify(first.files)).not.toContain('gateway_view_url":"/');
  const second = await status();
  expect(second.files.every(file => file.cached)).toBe(true);
  expect(mockGateway.getStatus).toHaveBeenCalledTimes(2);
  const third = await status('second-instance');
  expect(third.files[0].cached_url).not.toBe(second.files[0].cached_url);
  expect(mockGateway.fetchImage).toHaveBeenCalledTimes(5);
});

test('deleted local terminal bytes recover from validated Gateway status', async () => {
  const first = await status();
  const rec = mockCache.verifiedRecord(jobId, first.files[0]);
  await fs.unlink(rec.localPath);
  await status();
  expect(mockGateway.getStatus).toHaveBeenCalledTimes(2);
  expect(await fs.readFile(rec.localPath, 'utf8')).toBe('normal');
});

test('download rejects mismatched identity, invalid indices, and ambiguous basename endpoints', async () => {
  const { files } = await status();
  const wrong = await download(files[0], 1);
  expect(wrong.status).toHaveBeenCalledWith(404);
  expect(wrong.sendFile).not.toHaveBeenCalled();
  for (const index of ['-1', '1.5', 'nope']) {
    const res = response();
    await controller.getJobFile({ params: { id: jobId, index }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  }
  const legacy = response();
  await controller.getFile({ params: { bucket: 'output', filename: 'same.png' }, query: {} }, legacy);
  expect(legacy.status).toHaveBeenCalledWith(409);
  expect(legacy.sendFile).not.toHaveBeenCalled();
});

test('legacy persisted bulk URLs recover using status and persist full identity', async () => {
  const bulkId = 'a'.repeat(24);
  const doc = { _id: 'b'.repeat(24), job: bulkId, status: 'Completed', comfy_job_id: jobId, filename: 'same.png', file_url: '/imgen/same.png' };
  mockJobs.findById.mockReturnValue(chain({ _id: bulkId }));
  mockBulk.find.mockImplementation(filter => chain(filter.$or ? [doc] : [doc]));
  mockBulk.updateOne.mockImplementation(async (_, update) => { Object.assign(doc, update.$set); });
  const res = response();
  await controller.listBulkTestPrompts({ params: { id: bulkId }, query: {} }, res);
  expect(doc.output_file).toMatchObject({ cache_version: 2, subfolder: 'normal', index: 0 });
  expect(res.json.mock.calls[0][0].items[0].file_url).toBe(doc.output_file.cached_url);
  expect(res.json.mock.calls[0][0].items[0].file_url).not.toContain('/imgen/');
  // Persisted descriptor serves private local bytes when Gateway history has gone.
  mockBulk.findOne.mockReturnValue(chain({ job: bulkId, output_file: doc.output_file }));
  mockGateway.getStatus.mockRejectedValue(new Error('history expired'));
  const fileResponse = await download(doc.output_file);
  expect(await fs.readFile(fileResponse.sendFile.mock.calls[0][0], 'utf8')).toBe('normal');
  expect(mockBulk.findOne).toHaveBeenCalledWith(expect.objectContaining({ comfy_job_id: jobId, status: 'Completed', 'output_file.cache_key': doc.output_file.cache_key }));
});

test('unrecoverable legacy bulk records emit only job-scoped links and never old thumbnails', async () => {
  const bulkId = 'a'.repeat(24), promptId = 'b'.repeat(24);
  const doc = { _id: promptId, job: bulkId, status: 'Completed', comfy_job_id: jobId, filename: 'same.png', file_url: '/imgen/same.png' };
  mockJobs.findById.mockReturnValue(chain({ _id: bulkId }));
  mockBulk.find.mockReturnValue(chain([doc]));
  mockGateway.getStatus.mockRejectedValue(Object.assign(new Error('expired'), { status: 404 }));
  const res = response();
  await controller.listBulkTestPrompts({ params: { id: bulkId }, query: {} }, res);
  expect(res.json.mock.calls[0][0].items[0].file_url).toBe(`/image_gen/api/jobs/${jobId}/files/0`);
  mockBulk.findOne.mockReturnValue(chain(doc));
  const thumbnail = response();
  await controller.getBulkThumbnail({ params: { id: bulkId, promptId }, query: {} }, thumbnail);
  expect(mockThumbnail).not.toHaveBeenCalled();
  expect(mockBulk.updateOne).not.toHaveBeenCalled();
});

test('invalid output keeps its index without blocking or selecting the next file', async () => {
  mockGateway.getStatus.mockResolvedValue({ status: 'completed', outputs: [{ ...remote('unsafe'), filename: '../same.png' }, remote('safe')] });
  const result = await status();
  expect(result.files[0]).toMatchObject({ index: 0, cached: false, cached_url: null });
  expect(result.files[1]).toMatchObject({ index: 1, cached: true, subfolder: 'safe' });
  expect(mockGateway.fetchImage).toHaveBeenCalledTimes(1);
  const rejected = await download(result.files[0]);
  expect(rejected.sendFile).not.toHaveBeenCalled();
  const valid = await download(result.files[1]);
  expect(await fs.readFile(valid.sendFile.mock.calls[0][0], 'utf8')).toBe('safe');
});

test('failed re-fetch never saves a legacy or other-folder favorite', async () => {
  mockGateway.submitPrompt.mockResolvedValue({ prompt_id: jobId, status: 'completed', outputs: [remote('missing')] });
  mockGateway.getStatus.mockResolvedValue({ prompt_id: jobId, status: 'completed', outputs: [remote('missing')] });
  await fs.writeFile(path.join(directory, 'same.png'), 'wrong legacy');
  mockGateway.fetchImage.mockRejectedValue(new Error('unavailable'));
  const generated = response();
  await controller.generate({ body: { prompt: { 8: { class_type: 'SaveImage' } }, prompt_text: 'Synthetic test' } }, generated);
  const copy = jest.spyOn(fs, 'copyFile');
  const rated = response();
  await controller.rateJob({ body: { job_id: jobId, rating: 'good' } }, rated);
  expect(rated.json.mock.calls[0][0].saved).toEqual([]);
  expect(copy).not.toHaveBeenCalled();
  expect(mockGood.create).not.toHaveBeenCalled();
});
