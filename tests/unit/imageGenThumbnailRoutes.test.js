const express = require('express');
const path = require('path');
const fs = require('fs');
const mockGateway = { openInputThumbnail: jest.fn(), openInputFile: jest.fn(), streamIdleTimeoutMs: 5000 };
const mockThumbnail = jest.fn();
jest.mock('../../database', () => ({ GoodImage: { findOne: jest.fn(), find: jest.fn(), countDocuments: jest.fn(), findById: jest.fn() }, RoleModel: { findOne: jest.fn() } }));
jest.mock('../../services/embeddingQueueService', () => ({}));
jest.mock('../../services/goodImageThumbnailService', () => ({
  ...jest.requireActual('../../services/goodImageThumbnailService'),
  GoodImageThumbnailService: jest.fn().mockImplementation(() => ({ get: mockThumbnail })),
}));
jest.mock('../../services/comfyGatewayService', () => {
  const Actual = jest.requireActual('../../services/comfyGatewayService');
  return Object.assign(jest.fn().mockImplementation(() => mockGateway), {
    gatewayHttpStatus: Actual.gatewayHttpStatus, gatewayLogMetadata: Actual.gatewayLogMetadata,
    gatewayClientMessage: Actual.gatewayClientMessage,
  });
});
jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));
jest.mock('../../utils/apiDebugLogger', () => ({ createApiDebugLogger: () => jest.fn() }));
const { GoodImage, RoleModel } = require('../../database');
const { ROUTES } = require('../../utils/imageGenThumbnailPolicy');
const router = require('../../routes/image_gen');
const logger = require('../../utils/logger');
const id = 'a'.repeat(24);
const input = '/api/files/input/thumbnail?path=folder%2Fimage.png';
const gallery = `/api/good-images/${id}/thumbnail`;
let server, origin;
beforeEach(async () => {
  jest.clearAllMocks();
  RoleModel.findOne.mockResolvedValue(null);
  GoodImage.findOne.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: async () => ({ _id: id, filename: 'fixture.png' }) }) });
  mockThumbnail.mockResolvedValue({ buffer: Buffer.from('RIFFxxxxWEBPfixture'), etag: '"source-v1"', lastModified: 'Wed, 01 Oct 2025 00:00:00 GMT' });
  mockGateway.openInputThumbnail.mockImplementation(async () => new Response('RIFFxxxxWEBPfixture', {
    headers: { 'Content-Type': 'image/webp', ETag: '"gateway-v1"', 'Last-Modified': 'Wed, 01 Oct 2025 00:00:00 GMT',
      'Cache-Control': 'public, max-age=9999', 'Set-Cookie': 'unsafe=yes', 'Content-Disposition': 'attachment; filename="unsafe"' },
  }));
  const app = express();
  app.set('view engine', 'pug');
  app.set('views', path.join(__dirname, '../../views'));
  app.use((req, res, next) => {
    req.user = req.get('x-anonymous') ? null : { _id: id, name: 'fixture', type_user: req.get('x-role') || 'admin' };
    req.isAuthenticated = () => Boolean(req.user);
    next();
  });
  app.use('/image_gen', router);
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  origin = `http://127.0.0.1:${server.address().port}/image_gen`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
function request(url, headers = {}, options = {}) { return fetch(origin + url, { ...options, headers: { 'cache-control': 'max-age=0', ...headers } }); }
test('registers thumbnail GET endpoints before legacy wildcard and retains parent authentication', () => {
  expect(ROUTES.map(route => [route.path, route.scope])).toEqual([
    ['/api/bulk/jobs/:id/prompts/:promptId/thumbnail', 'admin-managed'],
    ['/api/files/input/thumbnail', 'admin-managed'], ['/api/good-images/:id/thumbnail', 'admin-managed'],
  ]);
  const source = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
  expect(source).toContain('app.use(\'/image_gen\', isAuthenticated, authorize("image_gen"), imageGenRouter);');
});
test.each([input, gallery])('denies anonymous and missing capabilities before work: %s', async url => {
  expect((await request(url, { 'x-anonymous': 'yes' })).status).toBe(401);
  for (const role of ['family', 'user', 'unrelated']) {
    const result = await request(url, { 'x-role': role });
    expect(result.status).toBe(403);
    expect(result.headers.get('cache-control')).toContain('no-store');
  }
  expect(mockThumbnail).not.toHaveBeenCalled();
  expect(GoodImage.findOne).not.toHaveBeenCalled();
  expect(mockGateway.openInputThumbnail).not.toHaveBeenCalled();
});
test('per-user semantic grants authorize only their declared library scope', async () => {
  RoleModel.findOne.mockImplementation(async query => query.type === 'user' ? { permissions: ['comfy.inputs.read'] } : null);
  expect((await request(input, { 'x-role': 'user' })).status).toBe(200);
  expect((await request(gallery, { 'x-role': 'user' })).status).toBe(403);
  expect(GoodImage.findOne).not.toHaveBeenCalled();
});
test('input proxy returns only safe WebP headers and forwards validators but not Range', async () => {
  const result = await request(input, { 'if-none-match': '"old"', 'if-modified-since': 'Wed, 01 Oct 2025 00:00:00 GMT', Range: 'bytes=0-5' });
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('private, no-cache');
  expect(result.headers.get('content-type')).toBe('image/webp');
  expect(result.headers.get('content-disposition')).toBe('inline');
  expect(result.headers.get('set-cookie')).toBeNull();
  expect(result.headers.get('etag')).toBe('"gateway-v1"');
  expect(result.headers.get('x-content-type-options')).toBe('nosniff');
  expect(await result.text()).toContain('WEBP');
  expect(mockGateway.openInputThumbnail).toHaveBeenCalledWith('folder/image.png', expect.objectContaining({ ifNoneMatch: '"old"', ifModifiedSince: 'Wed, 01 Oct 2025 00:00:00 GMT' }));
  expect(mockGateway.openInputThumbnail.mock.calls[0][1]).not.toHaveProperty('range');
  expect(mockGateway.openInputFile).not.toHaveBeenCalled();
});
test('input 304 ends cleanly without body or error log', async () => {
  mockGateway.openInputThumbnail.mockResolvedValue(new Response(null, { status: 304, headers: { ETag: '"gateway-v1"' } }));
  const result = await request(input, { 'if-none-match': '"gateway-v1"' });
  expect(result.status).toBe(304);
  expect(await result.text()).toBe('');
  expect(result.headers.get('cache-control')).toBe('private, no-cache');
  expect(result.headers.get('etag')).toBe('"gateway-v1"');
  expect(logger.error).not.toHaveBeenCalled();
});
test.each(['../secret.png', '/absolute.png', 'C:/file.png', 'a\\b.png', 'a//b.png', '%2e%2e/file.png', 'a\u0000.png', 'x'.repeat(1025)])('rejects input path %s before Gateway access', async inputPath => {
  expect((await request('/api/files/input/thumbnail?path=' + encodeURIComponent(inputPath))).status).toBe(400);
  expect(mockGateway.openInputThumbnail).not.toHaveBeenCalled();
});
test('rejects array/query controls and malformed gallery IDs without work', async () => {
  for (const url of ['/api/files/input/thumbnail?path=a&path=b', input + '&size=10000', '/api/good-images/bad/thumbnail', gallery + '?filename=other.png']) {
    expect([400, 404]).toContain((await request(url)).status);
  }
  expect(mockGateway.openInputThumbnail).not.toHaveBeenCalled();
  expect(GoodImage.findOne).not.toHaveBeenCalled();
});
test.each([404, 415, 422, 503])('input errors stay non-success with no original fallback: %s', async status => {
  mockGateway.openInputThumbnail.mockRejectedValue(Object.assign(new Error('private provider details'), { status }));
  const result = await request(input);
  expect(result.status).toBe(status);
  expect(await result.text()).not.toContain('private provider details');
  expect(mockGateway.openInputFile).not.toHaveBeenCalled();
});
test.each([
  { 'Content-Type': 'image/png' },
  { 'Content-Type': 'image/webp', 'Content-Length': String(3 * 1024 * 1024) },
])('rejects invalid upstream thumbnail content', async headers => {
  mockGateway.openInputThumbnail.mockResolvedValue(new Response('bad', { headers }));
  expect((await request(input)).status).toBe(502);
});
test('gallery authorizes record before cache lookup and handles ETag/Last-Modified conditionals', async () => {
  const first = await request(gallery);
  expect(first.status).toBe(200);
  expect(first.headers.get('cache-control')).toBe('private, no-cache');
  expect(first.headers.get('content-type')).toBe('image/webp');
  expect(GoodImage.findOne).toHaveBeenCalledWith({ _id: id });
  expect(mockThumbnail).toHaveBeenCalledWith({ _id: id, filename: 'fixture.png' });
  for (const headers of [{ 'if-none-match': 'W/"source-v1"' }, { 'if-modified-since': first.headers.get('last-modified') }]) {
    const response = await request(gallery, headers);
    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
  }
  expect((await request(gallery, { 'if-none-match': '"old"', 'if-modified-since': first.headers.get('last-modified') })).status).toBe(200);
  mockThumbnail.mockResolvedValue({ buffer: Buffer.from('new'), etag: '"source-v2"', lastModified: first.headers.get('last-modified') });
  expect((await request(gallery, { 'if-none-match': '"source-v1"' })).status).toBe(200);
  expect((await request(gallery, {}, { method: 'HEAD' })).status).toBe(200);
});
test('deleted/missing records deny even with matching validators, without touching cache', async () => {
  GoodImage.findOne.mockReturnValue({ select: () => ({ lean: async () => null }) });
  const response = await request(gallery, { 'if-none-match': '"source-v1"' });
  expect(response.status).toBe(404);
  expect(mockThumbnail).not.toHaveBeenCalled();
});
test('gallery failure is generic, never fetches a nonlocal original', async () => {
  mockThumbnail.mockRejectedValue(Object.assign(new Error('/private/source.png'), { status: 422 }));
  const response = await request(gallery);
  expect(response.status).toBe(422);
  expect(await response.text()).not.toContain('/private');
  expect(mockGateway.openInputFile).not.toHaveBeenCalled();
});
test('gallery listing preserves original URLs, pinned results, and adds distinct thumbnails', async () => {
  const record = { _id: id, filename: 'fixture.png' };
  GoodImage.countDocuments.mockResolvedValue(1);
  GoodImage.find.mockReturnValue({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [record] }) }) }) });
  GoodImage.findById.mockReturnValue({ lean: async () => record });
  const response = await request(`/api/good-images?pinned_id=${id}`);
  const data = await response.json();
  expect(data.items).toEqual([]);
  expect(data.pinned).toMatchObject({ public_url: '/img/fixture.png', thumbnail_url: '/image_gen' + gallery });
});
test('bounds a chunked thumbnail even without upstream Content-Length', async () => {
  mockGateway.openInputThumbnail.mockResolvedValue(new Response(Buffer.alloc(3 * 1024 * 1024), { headers: { 'Content-Type': 'image/webp' } }));
  const response = await request(input);
  expect(response.status).toBe(502);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('content-type')).toContain('application/json');
  expect((await response.text()).length).toBeLessThan(500);
});
test('client disconnect aborts Gateway stream without an operational error', async () => {
  let cancelled = false;
  mockGateway.openInputThumbnail.mockImplementation(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(Buffer.from('RIFFxxxxWEBP'))); },
    cancel() { cancelled = true; },
  }), { headers: { 'Content-Type': 'image/webp' } }));
  const abort = new AbortController();
  const response = await request(input, {}, { signal: abort.signal });
  expect(response.status).toBe(200);
  abort.abort();
  for (let i = 0; i < 100 && !cancelled; i++) await new Promise(resolve => setTimeout(resolve, 2));
  expect(cancelled).toBe(true);
  expect(mockGateway.openInputThumbnail.mock.calls[0][1].signal.aborted).toBe(true);
  expect(logger.error).not.toHaveBeenCalled();
});
test('bounds simultaneous thumbnail requests and releases slots on completion', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  mockGateway.openInputThumbnail.mockImplementation(async () => {
    await gate;
    return new Response('webp', { headers: { 'Content-Type': 'image/webp' } });
  });
  const pending = Array.from({ length: 32 }, () => request(input));
  try {
    for (let i = 0; i < 200 && mockGateway.openInputThumbnail.mock.calls.length < 32; i++) {
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    expect(mockGateway.openInputThumbnail).toHaveBeenCalledTimes(32);
    expect((await request(input)).status).toBe(503);
  } finally { release(); await Promise.all(pending); }
  expect((await request(input)).status).toBe(200);
});
