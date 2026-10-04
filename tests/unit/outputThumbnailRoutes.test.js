const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const express = require('express');
let mockRoot;
const mockGet = jest.fn();
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('../../utils/apiDebugLogger', () => ({ createApiDebugLogger: () => jest.fn() }));
jest.mock('../../services/embeddingQueueService', () => ({}));
jest.mock('../../database', () => ({ BulkJob: { findById: jest.fn() }, BulkTestPrompt: { findOne: jest.fn(), find: jest.fn(), aggregate: jest.fn() }, RoleModel: { findOne: jest.fn() } }));
jest.mock('../../models/gpt_image_generation', () => ({ findById: jest.fn() }));
jest.mock('../../services/localImageThumbnailService', () => {
  const actual = jest.requireActual('../../services/localImageThumbnailService');
  return { ...actual, LocalImageThumbnailService: class extends actual.LocalImageThumbnailService {
    constructor(options = {}) { super(options); this.options = options; }
    get(record) {
      const source = typeof this.options.sourceDir === 'function' ? 'private' : this.options.sourceDir?.endsWith('imgen') ? 'bulk' : 'legacy';
      return mockGet(record, source);
    }
  } };
});
const { LocalImageThumbnailService } = jest.requireActual('../../services/localImageThumbnailService');
const { BulkJob, BulkTestPrompt, RoleModel } = require('../../database');
const Gpt = require('../../models/gpt_image_generation');
const { GPT_IMAGE_THUMBNAIL_ROUTE } = require('../../utils/gptImageAuthorizationPolicy');
const bulkRouter = require('../../routes/image_gen');
const gptRouter = require('../../routes/gpt_image');
const jobId = 'a'.repeat(24), promptId = 'b'.repeat(24), imageId = 'c'.repeat(24);
const privateName = 'gpt-image-private-11111111-2222-3333-4444-555555555555.png';
const bulk = `/image_gen/api/bulk/jobs/${jobId}/prompts/${promptId}/thumbnail`;
const gpt = `/gpt-image/api/images/${imageId}/thumbnail`;
const query = value => ({ select: () => ({ lean: async () => value }) });
let server, origin, renderers;
beforeEach(async () => {
  mockRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'output-thumbnails-'));
  renderers = {};
  for (const kind of ['private', 'bulk', 'legacy']) {
    const dir = path.join(mockRoot, kind);
    await fs.mkdir(dir);
    renderers[kind] = new LocalImageThumbnailService({ sourceDir: dir, cacheDir: path.join(mockRoot, kind + '-cache') });
  }
  await fs.mkdir(path.join(mockRoot, 'bulk', 'instance-1'));
  const png = await sharp({ create: { width: 900, height: 450, channels: 4, background: '#ff000080' } }).png().toBuffer();
  await fs.writeFile(path.join(mockRoot, 'private', privateName), png);
  await fs.writeFile(path.join(mockRoot, 'legacy', 'old image.png'), png);
  await fs.writeFile(path.join(mockRoot, 'bulk', 'instance-1', 'result.png'), png);
  mockGet.mockImplementation((record, kind) => renderers[kind].get(record));
  RoleModel.findOne.mockResolvedValue(null);
  BulkJob.findById.mockReturnValue(query({ _id: jobId, instance_id: 'instance-1' }));
  BulkTestPrompt.findOne.mockReturnValue(query({ _id: promptId, filename: 'result.png' }));
  Gpt.findById.mockReturnValue(query({ _id: imageId, outputFileName: privateName, outputUrl: '/gpt-image/media/' + privateName }));
  const app = express();
  app.set('view engine', 'pug');
  app.set('views', path.join(__dirname, '../../views'));
  app.use((req, res, next) => {
    req.user = req.get('x-anonymous') ? null : { _id: imageId, name: 'viewer', type_user: req.get('x-role') || 'admin' };
    if (req.get('x-incomplete')) req.user = { _id: imageId };
    req.isAuthenticated = () => !!req.user;
    next();
  });
  app.use('/image_gen', bulkRouter);
  app.use('/gpt-image', gptRouter);
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await fs.rm(mockRoot, { recursive: true, force: true });
});
function request(url, headers = {}, method = 'GET') {
  return fetch(origin + url, { method, headers: { 'cache-control': 'max-age=0', ...headers } });
}
test.each([gpt, bulk])('GET/HEAD authorize, render, cache and revalidate %s', async url => {
  const response = await request(url);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-cache');
  expect(response.headers.get('content-type')).toBe('image/webp');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(await sharp(bytes).metadata()).toMatchObject({ width: 512, height: 256, hasAlpha: true });
  const etag = response.headers.get('etag');
  for (const headers of [{ 'if-none-match': etag }, { 'if-modified-since': response.headers.get('last-modified') }]) {
    const cached = await request(url, headers);
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');
  }
  const head = await request(url, {}, 'HEAD');
  expect(head.status).toBe(200);
  expect(Number(head.headers.get('content-length'))).toBe(bytes.length);
  expect(await head.text()).toBe('');
  const source = url === bulk ? path.join(mockRoot, 'bulk/instance-1/result.png') : path.join(mockRoot, 'private', privateName);
  await fs.writeFile(source, await sharp({ create: { width: 100, height: 200, channels: 3, background: 'blue' } }).png().toBuffer());
  const changed = await request(url, { 'if-none-match': etag });
  expect(changed.status).toBe(200);
  expect(changed.headers.get('etag')).not.toBe(etag);
});
test.each([gpt, bulk])('denies anonymous, incomplete principals, arbitrary query/IDs before work: %s', async url => {
  expect((await request(url, { 'x-anonymous': '1' })).status).toBe(401);
  expect((await request(url, { 'x-anonymous': '1' }, 'HEAD')).status).toBe(401);
  expect((await request(url, { 'x-incomplete': '1' })).status).toBe(403);
  for (const suffix of ['?path=../secret.png', '?size=10000', '?instance_id=other']) {
    expect((await request(url + suffix)).status).toBe(404);
  }
  expect((await request(url.replace(/\/([a-f\d]{24})\/thumbnail$/, '/..%2fsecret/thumbnail'))).status).toBe(404);
  expect(mockGet).not.toHaveBeenCalled();
  expect(Gpt.findById).not.toHaveBeenCalled();
  expect(BulkJob.findById).not.toHaveBeenCalled();
});
test('bulk capability is separate from gallery/legacy permissions and permits explicit user grant', async () => {
  for (const role of ['user', 'family', 'custom']) expect((await request(bulk, { 'x-role': role })).status).toBe(403);
  RoleModel.findOne.mockResolvedValue({ permissions: ['image_gen', 'comfy.gallery.read'] });
  expect((await request(bulk, { 'x-role': 'user' })).status).toBe(403);
  expect(BulkJob.findById).not.toHaveBeenCalled();
  RoleModel.findOne.mockResolvedValue({ permissions: ['comfy.bulk.read'] });
  expect((await request(bulk, { 'x-role': 'user' })).status).toBe(200);
});
test('bulk child query enforces parent and completion, foreign or deleted objects deny validators', async () => {
  expect((await request(bulk)).status).toBe(200);
  expect(BulkTestPrompt.findOne).toHaveBeenCalledWith({ _id: promptId, job: jobId, status: 'Completed' });
  mockGet.mockClear();
  BulkTestPrompt.findOne.mockReturnValue(query(null));
  expect((await request(bulk, { 'if-none-match': '*' })).status).toBe(404);
  BulkJob.findById.mockReturnValue(query(null));
  expect((await request(bulk, { 'if-none-match': '*' })).status).toBe(404);
  expect(mockGet).not.toHaveBeenCalled();
});
test.each(['admin', 'family', 'user', 'custom'])('GPT shared-library membership includes %s, with no owner inference', async role => {
  expect(GPT_IMAGE_THUMBNAIL_ROUTE).toMatchObject({ capability: 'gpt_image.library.read', scope: 'member' });
  expect((await request(gpt, { 'x-role': role })).status).toBe(200);
  Gpt.findById.mockReturnValue(query(null));
  expect((await request(gpt, { 'x-role': role, 'if-none-match': '*' })).status).toBe(404);
});
test('GPT legacy records use local mapping and preserve encoded original URL', async () => {
  Gpt.findById.mockReturnValue(query({ _id: imageId, outputFileName: 'old image.png', outputUrl: '/img/old%20image.png' }));
  expect((await request(gpt)).status).toBe(200);
  expect(mockGet).toHaveBeenLastCalledWith({ _id: imageId, filename: 'old image.png' }, 'legacy');
  for (const outputUrl of ['https://remote.invalid/old%20image.png', '/img/other.png', '/img/%zz']) {
    Gpt.findById.mockReturnValue(query({ _id: imageId, outputFileName: 'old image.png', outputUrl }));
    expect((await request(gpt)).status).toBe(404);
  }
});
test.each(['../secret', '/tmp', '..\\secret', '%2e%2e', 'a/b'])('bulk rejects unsafe stored instance mapping %s', async directory => {
  BulkTestPrompt.findOne.mockReturnValue(query({ _id: promptId, filename: 'result.png', instance_id: directory }));
  expect((await request(bulk)).status).toBe(404);
});
test('bulk prompt instance takes precedence; legacy records use the root mapping', async () => {
  await fs.copyFile(path.join(mockRoot, 'bulk/instance-1/result.png'), path.join(mockRoot, 'bulk/result.png'));
  BulkJob.findById.mockReturnValue(query({ _id: jobId, instance_id: 'nonexistent' }));
  BulkTestPrompt.findOne.mockReturnValue(query({ _id: promptId, filename: 'result.png', instance_id: 'instance-1' }));
  expect((await request(bulk)).status).toBe(200);
  BulkJob.findById.mockReturnValue(query({ _id: jobId }));
  BulkTestPrompt.findOne.mockReturnValue(query({ _id: promptId, filename: 'result.png' }));
  expect((await request(bulk)).status).toBe(200);
});
test.each([gpt, bulk])('missing/corrupt/symlink sources fail lightly without original fallback: %s', async url => {
  const source = url === bulk ? path.join(mockRoot, 'bulk/instance-1/result.png') : path.join(mockRoot, 'private', privateName);
  await fs.unlink(source);
  expect((await request(url)).status).toBe(404);
  await fs.writeFile(source, 'corrupt');
  const corrupt = await request(url);
  expect(corrupt.status).toBe(422);
  expect(await corrupt.text()).toBe('{"error":"Thumbnail unavailable."}');
  expect(corrupt.headers.get('cache-control')).toBe('private, no-store');
  await fs.unlink(source);
  await fs.symlink(path.join(mockRoot, 'legacy/old image.png'), source);
  expect((await request(url)).status).toBe(404);
});
test('nested symlink and hardlink cannot redirect bulk output reads', async () => {
  await fs.rename(path.join(mockRoot, 'bulk/instance-1'), path.join(mockRoot, 'elsewhere'));
  await fs.symlink(path.join(mockRoot, 'elsewhere'), path.join(mockRoot, 'bulk/instance-1'));
  expect((await request(bulk)).status).toBe(404);
  await fs.unlink(path.join(mockRoot, 'bulk/instance-1'));
  await fs.rename(path.join(mockRoot, 'elsewhere'), path.join(mockRoot, 'bulk/instance-1'));
  await fs.link(path.join(mockRoot, 'bulk/instance-1/result.png'), path.join(mockRoot, 'alias.png'));
  expect((await request(bulk)).status).toBe(404);
});
test.each([gpt, bulk])('disconnect during local conversion sends no late response or operational error: %s', async url => {
  const logger = require('../../utils/logger');
  let release;
  mockGet.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const abort = new AbortController();
  const pending = fetch(origin + url, { signal: abort.signal }).catch(error => error);
  for (let i = 0; i < 100 && !release; i++) await new Promise(resolve => setTimeout(resolve, 2));
  expect(release).toBeDefined();
  abort.abort();
  await pending;
  release({ buffer: Buffer.from('webp'), etag: '"fake"', lastModified: new Date().toUTCString() });
  expect((await request(url)).status).toBe(200);
  expect(logger.error).not.toHaveBeenCalled();
  expect(logger.warning).not.toHaveBeenCalled();
});
test('bulk gallery, matrix and analytics serializers keep original URLs and add scoped thumbnail URLs', async () => {
  const job = { _id: jobId, instance_id: 'instance-1', prompt_templates: [{ label: 'One' }, { label: 'Two' }], negative_prompt: 'bad', negative_prompt_mode: 'compare' };
  BulkJob.findById.mockReturnValue({ lean: async () => job });
  const record = { _id: promptId, filename: 'result.png', template_label: 'One', negative_used: false,
    file_url: '/imgen/instance-1/result.png', score_total: 1, score_count: 1 };
  BulkTestPrompt.find.mockImplementation(filter => filter.$or
    ? { sort: () => ({ limit: () => ({ lean: async () => [] }) }) }
    : { lean: async () => [record] });
  BulkTestPrompt.aggregate.mockResolvedValueOnce([{ items: [record], total: [{ value: 1 }] }]);
  const gallery = await request(`/image_gen/api/bulk/jobs/${jobId}/gallery`);
  expect(gallery.status).toBe(200);
  const galleryItem = (await gallery.json()).items[0];
  const matrix = await request(`/image_gen/api/bulk/jobs/${jobId}/matrix?varA=template&varB=negative`);
  expect(matrix.status).toBe(200);
  const matrixItem = (await matrix.json()).data[0].columns[0].prompts[0];
  BulkTestPrompt.aggregate.mockResolvedValueOnce([{ topImages: [record], lowDefectTop: [record] }]);
  const analytics = await request(`/image_gen/api/bulk/jobs/${jobId}/analytics`);
  expect(analytics.status).toBe(200);
  const data = await analytics.json();
  for (const item of [galleryItem, matrixItem, data.topImages[0], data.lowDefectImages[0]]) {
    expect(item).toMatchObject({ thumbnail_url: bulk, cached_url: '/imgen/instance-1/result.png',
      download_url: '/image_gen/api/files/output/result.png?instance_id=instance-1' });
  }
  expect(mockGet).not.toHaveBeenCalled(); // Listing does no thumbnail conversion.
});

test.each(['../result.png', '/result.png', 'folder/result.png', 'folder\\result.png', '%2e%2e.png', 'result.svg'])('unsafe stored filenames cannot choose a source: %s', async filename => {
  BulkTestPrompt.findOne.mockReturnValue(query({ _id: promptId, filename }));
  expect((await request(bulk)).status).toBe(404);
  Gpt.findById.mockReturnValue(query({ _id: imageId, outputFileName: filename, outputUrl: '/img/' + filename }));
  expect((await request(gpt)).status).toBe(404);
});
test('authorization lookup failure fails closed before accessing records', async () => {
  RoleModel.findOne.mockRejectedValue(new Error('synthetic unavailable'));
  const response = await request(bulk, { 'x-role': 'user' });
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(BulkJob.findById).not.toHaveBeenCalled();
});
