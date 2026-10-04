const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const { GoodImageThumbnailService } = require('../../services/goodImageThumbnailService');
let root, service, sourceDir, cacheDir;
const record = { _id: 'a'.repeat(24), filename: 'fixture.png' };
async function png(width = 1000, height = 600, background = '#ff000080') {
  return sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'good-thumbnails-'));
  sourceDir = path.join(root, 'sources');
  cacheDir = path.join(root, 'cache');
  await fs.mkdir(sourceDir);
  service = new GoodImageThumbnailService({ sourceDir, cacheDir });
  await fs.writeFile(path.join(sourceDir, record.filename), await png());
});
afterEach(async () => { jest.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });
test('generates bounded transparent WebP, reuses disk cache and invalidates same-size overwrites', async () => {
  const first = await service.get(record);
  const meta = await sharp(first.buffer).metadata();
  expect(meta).toMatchObject({ format: 'webp', width: 512, height: 307, hasAlpha: true });
  const files = await fs.readdir(cacheDir);
  expect(files).toHaveLength(1);
  const cachedStat = await fs.stat(path.join(cacheDir, files[0]));
  const restarted = new GoodImageThumbnailService({ sourceDir, cacheDir });
  const hit = await restarted.get(record);
  expect(hit).toEqual(first);
  expect((await fs.stat(path.join(cacheDir, files[0]))).mtimeMs).toBe(cachedStat.mtimeMs);
  // Identical bytes and restored mtime still invalidate through ctime/inode.
  const original = await fs.readFile(path.join(sourceDir, record.filename));
  const stat = await fs.stat(path.join(sourceDir, record.filename));
  await fs.writeFile(path.join(sourceDir, record.filename), original);
  await fs.utimes(path.join(sourceDir, record.filename), stat.atime, stat.mtime);
  expect((await service.get(record)).etag).not.toBe(first.etag);
});
test('does not enlarge; corrects EXIF orientation and strips metadata', async () => {
  await sharp(await png(30, 10)).withMetadata({ orientation: 6 }).jpeg().toFile(path.join(sourceDir, 'rotated.jpg'));
  const result = await service.get({ ...record, filename: 'rotated.jpg' });
  expect(await sharp(result.buffer).metadata()).toMatchObject({ width: 10, height: 30 });
  expect((await sharp(result.buffer).metadata()).orientation).toBeUndefined();
});
test('uses only the first frame of animated input', async () => {
  const pixels = Buffer.concat([Buffer.alloc(8 * 8 * 3, 0), Buffer.alloc(8 * 8 * 3, 255)]);
  const animated = await sharp(pixels, { raw: { width: 8, height: 16, channels: 3, pageHeight: 8 } })
    .gif({ delay: [100, 100], loop: 0 }).toBuffer();
  expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2);
  await fs.writeFile(path.join(sourceDir, 'animated.gif'), animated);
  const result = await service.get({ ...record, filename: 'animated.gif' });
  const meta = await sharp(result.buffer).metadata();
  expect(meta).toMatchObject({ width: 8, height: 8, format: 'webp' });
  expect(meta.pages || 1).toBe(1);
});
test.each(['../fixture.png', '/fixture.png', 'folder/fixture.png', 'folder\\fixture.png', '%2e%2e.png', 'https://remote/image.png', 'image.svg', 'image.pdf'])('rejects unsafe or unsupported filename %s', async filename => {
  await expect(service.get({ ...record, filename })).rejects.toMatchObject({ status: 404 });
  await expect(fs.stat(cacheDir)).rejects.toMatchObject({ code: 'ENOENT' });
});
test('rejects missing, corrupt, disguised SVG, directories, and symlinks including a symlink root', async () => {
  await expect(service.get({ ...record, filename: 'missing.png' })).rejects.toMatchObject({ status: 404 });
  await fs.writeFile(path.join(sourceDir, 'corrupt.png'), 'not an image');
  await expect(service.get({ ...record, filename: 'corrupt.png' })).rejects.toMatchObject({ status: 422 });
  await fs.writeFile(path.join(sourceDir, 'vector.png'), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
  await expect(service.get({ ...record, filename: 'vector.png' })).rejects.toMatchObject({ status: 415 });
  await fs.mkdir(path.join(sourceDir, 'directory.png'));
  await expect(service.get({ ...record, filename: 'directory.png' })).rejects.toMatchObject({ status: 404 });
  await fs.symlink(path.join(sourceDir, record.filename), path.join(sourceDir, 'link.png'));
  await expect(service.get({ ...record, filename: 'link.png' })).rejects.toMatchObject({ status: 404 });
  const link = path.join(root, 'linked-root');
  await fs.symlink(sourceDir, link);
  await expect(new GoodImageThumbnailService({ sourceDir: link, cacheDir }).get(record)).rejects.toMatchObject({ status: 404 });
});
test('enforces source bytes, decoded pixels, and output bytes', async () => {
  service.settings.maxSourceBytes = 5;
  await expect(service.get(record)).rejects.toMatchObject({ status: 413 });
  service.settings.maxSourceBytes = 1000000;
  service.settings.maxPixels = 10;
  await expect(service.get(record)).rejects.toMatchObject({ status: 422 });
  service.settings.maxPixels = 1000000;
  service.settings.maxThumbnailBytes = 5;
  await expect(service.get(record)).rejects.toMatchObject({ status: 413 });
  expect(await fs.readdir(cacheDir)).toEqual([]);
});
test('coalesces same-source work; bounds active and pending work', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const load = jest.spyOn(service, 'load').mockImplementation(() => gate);
  service.settings.concurrency = 1;
  service.settings.maxPending = 1;
  const first = service.get(record);
  const same = service.get(record);
  const queued = service.get({ ...record, _id: 'b'.repeat(24) });
  await expect(service.get({ ...record, _id: 'c'.repeat(24) })).rejects.toMatchObject({ status: 503 });
  expect(load).toHaveBeenCalledTimes(1);
  release({ buffer: Buffer.from('fixture') });
  await Promise.all([first, same, queued]);
  expect(load).toHaveBeenCalledTimes(2);
  expect(service.active).toBe(0);
  expect(service.inFlight.size).toBe(0);
});
test('failed atomic writes leave no temp files and can be retried', async () => {
  jest.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
  await expect(service.get(record)).rejects.toMatchObject({ status: 422 });
  expect(await fs.readdir(cacheDir)).toEqual([]);
  await expect(service.get(record)).resolves.toHaveProperty('buffer');
});
test('regenerates malformed cache files and never follows cache symlinks', async () => {
  await service.get(record);
  const [file] = await fs.readdir(cacheDir);
  await fs.writeFile(path.join(cacheDir, file), 'bad cache');
  const regenerated = await service.get(record);
  expect((await sharp(regenerated.buffer).metadata()).format).toBe('webp');
  await fs.unlink(path.join(cacheDir, file));
  await fs.symlink(path.join(sourceDir, record.filename), path.join(cacheDir, file));
  await service.get(record);
  expect((await fs.lstat(path.join(cacheDir, file))).isSymbolicLink()).toBe(false);
  expect((await sharp(path.join(sourceDir, record.filename)).metadata()).format).toBe('png');
});
test('cleanup expires derivatives and enforces retention/count budgets without scanning originals', async () => {
  await service.prepareCache();
  const old = path.join(cacheDir, `${'a'.repeat(64)}.webp`);
  const recent = path.join(cacheDir, `${'b'.repeat(64)}.webp`);
  await fs.writeFile(old, 'old');
  await fs.utimes(old, new Date(0), new Date(0));
  await fs.writeFile(recent, 'recent');
  service.settings.maxCacheEntries = 1;
  await service.cleanup();
  expect(await fs.readdir(cacheDir)).toEqual([path.basename(recent)]);
  expect(await fs.readdir(sourceDir)).toEqual([record.filename]);
});

test.each(['webp', 'avif', 'tiff'])('supports %s originals through the shared renderer', async format => {
  const filename = `fixture.${format}`;
  await sharp(await png(16, 8)).toFormat(format).toFile(path.join(sourceDir, filename));
  const result = await service.get({ ...record, filename });
  expect(await sharp(result.buffer).metadata()).toMatchObject({ format: 'webp', width: 16, height: 8 });
});
test('cache ancestor symlink is rejected before creating any directory outside the cache root', async () => {
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  const alias = path.join(root, 'cache-alias');
  await fs.symlink(outside, alias);
  service.cacheDir = path.join(alias, 'must-not-create');
  await expect(service.get(record)).rejects.toMatchObject({ status: 503 });
  expect(await fs.readdir(outside)).toEqual([]);
});
