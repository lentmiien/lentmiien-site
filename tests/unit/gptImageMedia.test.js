const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const sharp = require('sharp');
const express = require('express');
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('../../models/gpt_image_generation', () => ({ exists: jest.fn(), findById: jest.fn(), aggregate: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../../services/gptImageService', () => ({ ...jest.requireActual('../../services/gptImageService'), createImageGeneration: jest.fn() }));
const storage = require('../../services/gptImageStorageService');
const model = require('../../models/gpt_image_generation');
const service = require('../../services/gptImageService');
const router = require('../../routes/gpt_image');
const controller = require('../../controllers/gptImageController');
let root, staticRoot, originalRoot, server, origin, image;
const token = 'A'.repeat(43);
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'gpt-image-media-'));
  staticRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gpt-image-static-'));
  originalRoot = process.env.GPT_IMAGE_STORAGE_DIR;
  process.env.GPT_IMAGE_STORAGE_DIR = root;
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).png().toBuffer();
  image = await storage.writeImage(png);
  model.exists.mockResolvedValue({ _id: 'a'.repeat(24) });
  service.createImageGeneration.mockResolvedValue({ generationId: 'synthetic', createdCount: 1 });
  const app = express();
  app.set('views', path.join(__dirname, '../../views'));
  app.set('view engine', 'pug');
  app.use((req, res, next) => {
    req.user = req.get('x-anonymous') ? null : { _id: 'a'.repeat(24), name: 'viewer', type_user: req.get('x-role') || 'user' };
    if (req.get('x-incomplete')) req.user = { _id: 'a'.repeat(24) };
    req.isAuthenticated = () => Boolean(req.user);
    req.session = { csrfToken: token };
    next();
  });
  app.use(storage.guardStaticMedia(staticRoot, express.static(staticRoot)));
  app.use('/gpt-image', router);
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  if (originalRoot === undefined) delete process.env.GPT_IMAGE_STORAGE_DIR; else process.env.GPT_IMAGE_STORAGE_DIR = originalRoot;
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(staticRoot, { recursive: true, force: true });
  jest.restoreAllMocks();
});
function request(url, options = {}) { return fetch(origin + url, options); }
test.each(['admin', 'family', 'user', 'custom'])('shared media allows %s and ignores cache validators', async role => {
  const response = await request(image.url, { headers: { 'x-role': role, 'If-None-Match': '*', Range: 'bytes=0-1' } });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(response.headers.get('content-disposition')).toContain('inline; filename="gpt-image-private-');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('etag')).toBeNull();
  expect((await response.arrayBuffer()).byteLength).toBe(image.sizeBytes);
});
test('anonymous GET and HEAD deny before record or file access', async () => {
  for (const method of ['GET', 'HEAD']) {
    const response = await request(image.url, { method, headers: { 'x-anonymous': 'yes' } });
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toContain('no-store');
  }
  expect(model.exists).not.toHaveBeenCalled();
});
test('incomplete authenticated principal fails capability check', async () => {
  expect((await request(image.url, { headers: { 'x-incomplete': 'yes' } })).status).toBe(403);
  expect(model.exists).not.toHaveBeenCalled();
});
test('unregistered private file is not a library object; uploaded references authorize through parent', async () => {
  model.exists.mockResolvedValueOnce(null);
  expect((await request(image.url)).status).toBe(404);
  expect((await request(image.url)).status).toBe(200);
  expect(model.exists).toHaveBeenLastCalledWith({ $or: [
    { outputFileName: image.fileName, outputUrl: image.url },
    { inputImages: { $elemMatch: { fileName: image.fileName, url: image.url } } },
  ] });
});
test.each(['..%2fsecret.png', '%2fetc%2fpasswd', '..%5csecret.png', '%00.png', '%252e%252e%252fsecret', 'bad.svg'])('rejects traversal or unsafe filename %s', async name => {
  const response = await request(`/gpt-image/media/${name}`);
  expect(response.status).toBe(404);
  expect(model.exists).not.toHaveBeenCalled();
});
test('private-file symlink and hardlink are rejected', async () => {
  await fs.unlink(image.absolutePath);
  const target = path.join(staticRoot, 'source.png');
  await fs.writeFile(target, Buffer.from('private data'));
  await fs.symlink(target, image.absolutePath);
  expect((await request(image.url)).status).toBe(404);
  await fs.unlink(image.absolutePath);
  await fs.link(target, image.absolutePath);
  expect((await request(image.url)).status).toBe(404);
});
test('private root symlink is rejected before creating or reading files', async () => {
  const alias = path.join(staticRoot, 'alias');
  await fs.symlink(root, alias);
  process.env.GPT_IMAGE_STORAGE_DIR = alias;
  await expect(storage.ensureStorage()).rejects.toThrow();
});
test('static aliases to private files/directories deny even logged-in users; legacy files stay public', async () => {
  await fs.symlink(image.absolutePath, path.join(staticRoot, 'innocent.png'));
  await fs.symlink(root, path.join(staticRoot, 'nested'));
  await fs.writeFile(path.join(staticRoot, 'legacy.png'), 'public legacy bytes');
  for (const url of ['/innocent.png', `/nested/${image.fileName}`, '/%69nnocent.png']) {
    expect((await request(url, { headers: { 'x-anonymous': 'yes' } })).status).toBe(404);
  }
  const legacy = await request('/legacy.png', { headers: { 'x-anonymous': 'yes' } });
  expect(legacy.status).toBe(200);
  expect(await legacy.text()).toBe('public legacy bytes');
});
test('unsafe public or VUE storage configuration fails closed', async () => {
  process.env.GPT_IMAGE_STORAGE_DIR = path.join(__dirname, '../../public/img/new-private');
  await expect(storage.ensureStorage()).rejects.toThrow();
  process.env.GPT_IMAGE_STORAGE_DIR = root;
  const originalVue = process.env.VUE_PATH;
  process.env.VUE_PATH = root;
  try { await expect(storage.ensureStorage()).rejects.toThrow(); } finally {
    if (originalVue === undefined) delete process.env.VUE_PATH; else process.env.VUE_PATH = originalVue;
  }
});
test('legacy resolution rejects traversal, external URLs and mismatched URL/filename', async () => {
  for (const record of [{ fileName: '../secret', url: '/img/../secret' }, { fileName: 'one.png', url: 'https://example.com/one.png' }, { fileName: 'one.png', url: '/img/two.png' }, { fileName: 'one.png', url: '/gpt-image/media/two.png' }]) {
    await expect(storage.readLibraryImage(record)).rejects.toThrow();
  }
});
test('legacy bytes are resolved under public/img with the URL retained', async () => {
  const read = jest.spyOn(fs, 'open').mockResolvedValue({ stat: async () => ({ isFile: () => true, nlink: 1, size: 3 }), readFile: async () => Buffer.from('old'), close: async () => {} });
  jest.spyOn(fs, 'lstat').mockResolvedValue({ isSymbolicLink: () => false });
  expect(await storage.readLibraryImage({ fileName: 'Old Image.PNG', url: '/img/Old%20Image.PNG' })).toEqual(Buffer.from('old'));
  expect(read.mock.calls[0][0]).toBe(path.resolve(__dirname, '../../public/img/Old Image.PNG'));
});
test.each(['/api/generate', `/api/images/${'a'.repeat(24)}/like`])('CSRF denies %s before mutation', async url => {
  for (const headers of [{}, { 'X-CSRF-Token': 'B'.repeat(43) }, { 'X-CSRF-Token': token, Origin: 'https://hostile.invalid' }]) {
    const response = await request('/gpt-image' + url, { method: 'POST', headers });
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toContain('no-store');
  }
  expect(service.createImageGeneration).not.toHaveBeenCalled();
  expect(model.findById).not.toHaveBeenCalled();
});
test('Studio generation defaults to Sunburst and carries authenticated identity', async () => {
  const body = new FormData(); body.set('prompt', 'Test');
  const response = await request('/gpt-image/api/generate', { method: 'POST', headers: { 'X-CSRF-Token': token }, body });
  expect(response.status).toBe(200);
  expect(service.createImageGeneration).toHaveBeenCalledWith(expect.objectContaining({ rawOptions: expect.objectContaining({ model: 'gpt-image-2.5-sunburst' }), user: expect.objectContaining({ name: 'viewer' }) }));
});
test('shared gallery read falls back for historical models and retains pagination/filtering', async () => {
  model.countDocuments.mockReturnValue({ exec: async () => 21 });
  model.aggregate.mockReturnValueOnce({ exec: async () => [{ _id: 'batch' }] }).mockReturnValueOnce({ exec: async () => [
    { _id: 'a'.repeat(24), generationId: 'batch', prompt: 'old', outputUrl: '/img/old.png' },
    { _id: 'b'.repeat(24), model: 'gpt-image-2.5-flare', prompt: 'new', outputUrl: image.url },
  ] });
  const gallery = await controller.loadGallery({ page: 2, keyword: 'cat', username: 'viewer' });
  expect(gallery.currentPage).toBe(2);
  expect(gallery.items.map(item => item.model)).toEqual(['gpt-image-2', 'gpt-image-2.5-flare']);
  expect(gallery.items[0].outputUrl).toBe('/img/old.png');
  expect(gallery.pagination.prevUrl).toBe('/gpt-image?keyword=cat');
  expect(model.countDocuments).toHaveBeenCalledWith({ promptKeywords: { $all: ['cat'] } });
});

test('shared like succeeds with CSRF and rejects malformed ID without database lookup', async () => {
  const save = jest.fn();
  model.findById.mockReturnValue({ exec: async () => ({ likedByUsers: [], save }) });
  const headers = { 'X-CSRF-Token': token };
  expect((await request('/gpt-image/api/images/bad/like', { method: 'POST', headers })).status).toBe(400);
  expect(model.findById).not.toHaveBeenCalled();
  const response = await request(`/gpt-image/api/images/${'a'.repeat(24)}/like`, { method: 'POST', headers });
  expect(await response.json()).toMatchObject({ liked: true, likeCount: 1 });
  expect(save).toHaveBeenCalled();
});
