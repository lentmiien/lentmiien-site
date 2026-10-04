const fs = require('fs/promises');
const { constants } = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const sharp = require('sharp');
const logger = require('../utils/logger');

const SETTINGS = Object.freeze({
  version: 'v1', size: 512, quality: 80, maxPixels: 40_000_000,
  maxSourceBytes: 100 * 1024 * 1024, maxThumbnailBytes: 2 * 1024 * 1024,
  concurrency: 2, maxPending: 32, timeoutSeconds: 15,
  retentionMs: 7 * 24 * 60 * 60 * 1000, cleanupIntervalMs: 60 * 60 * 1000,
  maxCacheBytes: 512 * 1024 * 1024, maxCacheEntries: 4096,
});
const EXTENSIONS = /\.(png|jpe?g|webp|gif|avif|tiff?)$/i;
const FORMATS = new Set(['png', 'jpeg', 'webp', 'gif', 'heif', 'tiff']);
function unavailable(status = 422) {
  return Object.assign(new Error('Thumbnail unavailable.'), { status });
}
function sourceVersion(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}
function isWebp(buffer) {
  return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP';
}

class GoodImageThumbnailService {
  constructor({ sourceDir = path.join(__dirname, '../public/img'),
    cacheDir = path.join(__dirname, '../cache/image-gen-thumbnails'), settings = {} } = {}) {
    this.sourceDir = path.resolve(sourceDir);
    this.cacheDir = path.resolve(cacheDir);
    this.settings = { ...SETTINGS, ...settings };
    this.inFlight = new Map();
    this.active = 0;
    this.queue = [];
    this.nextCleanup = 0;
  }

  async slot(work) {
    if (this.active >= this.settings.concurrency) {
      if (this.queue.length >= this.settings.maxPending) throw unavailable(503);
      await new Promise(resolve => this.queue.push(resolve));
    } else {
      this.active += 1;
    }
    try { return await work(); } finally {
      const next = this.queue.shift();
      if (next) next(); else this.active -= 1;
    }
  }

  async get(record) {
    const filename = record?.filename;
    const id = String(record?._id || '');
    if (!/^[a-f\d]{24}$/i.test(id) || typeof filename !== 'string'
      || filename.length > 255 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename)
      || !EXTENSIONS.test(filename)) throw unavailable(404);
    const key = `${id}:${filename}`;
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const pending = this.slot(() => this.load(id, filename));
    this.inFlight.set(key, pending);
    try { return await pending; } finally { this.inFlight.delete(key); }
  }

  async openSource(filename) {
    // Only direct children are accepted. Reject root and file symlinks; the FD
    // remains bound to the inspected inode even if the pathname is replaced.
    if (await fs.realpath(this.sourceDir) !== this.sourceDir) throw unavailable(404);
    const sourcePath = path.join(this.sourceDir, filename);
    if (path.dirname(sourcePath) !== this.sourceDir) throw unavailable(404);
    const handle = await fs.open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile()) throw unavailable(404);
      if (stat.size <= 0n || stat.size > BigInt(this.settings.maxSourceBytes)) throw unavailable(413);
      if (await fs.realpath(sourcePath) !== sourcePath) throw unavailable(404);
      return { handle, stat };
    } catch (error) { await handle.close(); throw error; }
  }

  async prepareCache() {
    await fs.mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
    if (await fs.realpath(this.cacheDir) !== this.cacheDir) throw unavailable(503);
  }

  async readCache(file) {
    let handle;
    try {
      handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > this.settings.maxThumbnailBytes || stat.size < 12) return null;
      const buffer = await handle.readFile();
      return isWebp(buffer) ? buffer : null;
    } catch (error) {
      if (['ENOENT', 'ELOOP'].includes(error.code)) return null;
      throw error;
    } finally { await handle?.close(); }
  }

  async load(id, filename) {
    let handle;
    try {
      const source = await this.openSource(filename);
      handle = source.handle;
      const version = sourceVersion(source.stat);
      const hash = createHash('sha256').update(`${this.settings.version}:${id}:${filename}:${version}`).digest('hex');
      await this.prepareCache();
      await this.cleanup();
      const target = path.join(this.cacheDir, `${hash}.webp`);
      let buffer = await this.readCache(target);
      if (!buffer) {
        // Read at most the inspected size, then verify the same source version.
        // FileHandle.readFile alone could grow without bound during an overwrite.
        const input = Buffer.alloc(Number(source.stat.size));
        let offset = 0;
        while (offset < input.length) {
          const { bytesRead } = await handle.read(input, offset, input.length - offset, offset);
          if (!bytesRead) throw unavailable(409);
          offset += bytesRead;
        }
        if (sourceVersion(await handle.stat({ bigint: true })) !== version) throw unavailable(409);
        const image = sharp(input, { limitInputPixels: this.settings.maxPixels, pages: 1, page: 0, failOn: 'warning' });
        const metadata = await image.metadata();
        if (!FORMATS.has(metadata.format)) throw unavailable(415);
        buffer = await image.autoOrient()
          .resize(this.settings.size, this.settings.size, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: this.settings.quality })
          .timeout({ seconds: this.settings.timeoutSeconds }).toBuffer();
        if (buffer.length > this.settings.maxThumbnailBytes) throw unavailable(413);
        if (sourceVersion(await handle.stat({ bigint: true })) !== version) throw unavailable(409);
        const temporary = path.join(this.cacheDir, `${hash}.${randomUUID()}.tmp`);
        try {
          await fs.writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 });
          await fs.rename(temporary, target);
        } finally { await fs.rm(temporary, { force: true }); }
      }
      return { buffer, etag: `"${this.settings.version}-${hash}"`,
        lastModified: new Date(Number(source.stat.mtimeMs)).toUTCString() };
    } catch (error) {
      const status = error.status || (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code) ? 404 : 422);
      logger.warning('Saved image thumbnail unavailable; check local source and cache storage', {
        category: 'image-gen-thumbnail', metadata: { status, code: error.code || 'DECODE_OR_STORAGE', recordId: id },
      });
      throw unavailable(status);
    } finally { await handle?.close(); }
  }

  async cleanup() {
    const now = Date.now();
    if (now < this.nextCleanup) return;
    this.nextCleanup = now + this.settings.cleanupIntervalMs;
    try {
      const entries = [];
      // Never scan public/img: this namespace contains derivatives only.
      const directory = await fs.opendir(this.cacheDir);
      for await (const entry of directory) {
        if (!entry.isFile() || !/^[a-f\d]{64}(\.webp|\.[a-f\d-]+\.tmp)$/.test(entry.name)) continue;
        const file = path.join(this.cacheDir, entry.name);
        const stat = await fs.lstat(file).catch(() => null);
        if (stat?.isFile()) entries.push({ file, size: stat.size, modified: stat.mtimeMs });
      }
      entries.sort((a, b) => b.modified - a.modified);
      let bytes = 0;
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        bytes += entry.size;
        if (now - entry.modified > this.settings.retentionMs || index >= this.settings.maxCacheEntries
          || bytes > this.settings.maxCacheBytes) await fs.rm(entry.file, { force: true });
      }
    } catch (error) {
      logger.warning('Saved image thumbnail cache cleanup failed', {
        category: 'image-gen-thumbnail', metadata: { code: error.code || 'UNKNOWN' },
      });
    }
  }
}
module.exports = { GoodImageThumbnailService, SETTINGS };
