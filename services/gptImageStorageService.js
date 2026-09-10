const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const sharp = require('sharp');
const logger = require('../utils/logger');

const APP_ROOT = path.resolve(__dirname, '..');
const MEDIA_PREFIX = '/gpt-image/media/';
const PRIVATE_NAME = /^gpt-image-private-[0-9a-f-]{36}\.(png|jpg|webp)$/;
const MIME_TYPES = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const MAX_STORED_BYTES = 50 * 1024 * 1024 - 1;
const MAX_INPUT_PIXELS = 40 * 1024 * 1024;
function storageRoot() {
  return path.resolve(process.env.GPT_IMAGE_STORAGE_DIR || path.join(APP_ROOT, 'private_data/gpt-image'));
}
function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function storageError() {
  return Object.assign(new Error('GPT Image storage is unavailable.'), { code: 'GPT_IMAGE_STORAGE_UNSAFE' });
}
async function assertNoSymlinks(target) {
  let current = path.parse(target).root;
  for (const part of target.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fsp.lstat(current);
    if (stat.isSymbolicLink()) throw storageError();
  }
}
async function ensureStorage() {
  const root = storageRoot();
  const staticRoots = [path.join(APP_ROOT, 'public'), path.join(APP_ROOT, 'games'), path.join(APP_ROOT, 'node_modules'), process.env.VUE_PATH].filter(Boolean);
  for (const staticRoot of staticRoots) {
    const resolved = path.resolve(staticRoot);
    if (within(resolved, root) || within(root, resolved)) throw storageError();
    const canonical = await fsp.realpath(resolved).catch(error => {
      if (error.code === 'ENOENT') return resolved;
      throw error;
    });
    if (within(canonical, root) || within(root, canonical)) throw storageError();
  }
  // Check existing ancestors before mkdir, so a symlink cannot redirect creation.
  let ancestor = root;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  await assertNoSymlinks(ancestor);
  await fsp.mkdir(root, { recursive: true, mode: 0o700 });
  await assertNoSymlinks(root);
  return root;
}
async function validateRaster(buffer, expectedFormat) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_STORED_BYTES) {
    throw Object.assign(new Error('Invalid image size.'), { status: 400 });
  }
  try {
    const image = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'warning' });
    const metadata = await image.metadata();
    if (!MIME_TYPES[metadata.format] || (metadata.pages || 1) !== 1 || (expectedFormat && metadata.format !== expectedFormat)) {
      throw new Error('Unsupported raster');
    }
    await image.stats(); // Decode to reject spoofed/truncated uploads, preserving valid original bytes.
    return { format: metadata.format, mimeType: MIME_TYPES[metadata.format] };
  } catch (_) {
    throw Object.assign(new Error('Only valid, single-frame PNG, JPEG and WebP images are supported.'), { status: 400 });
  }
}
async function writeImage(buffer, expectedFormat) {
  const metadata = await validateRaster(buffer, expectedFormat);
  const root = await ensureStorage();
  const extension = metadata.format === 'jpeg' ? 'jpg' : metadata.format;
  const fileName = `gpt-image-private-${randomUUID()}.${extension}`;
  const absolutePath = path.join(root, fileName);
  const handle = await fsp.open(absolutePath, 'wx', 0o600);
  try {
    await handle.writeFile(buffer);
  } catch (error) {
    await fsp.unlink(absolutePath).catch(cleanupError => {
      logger.warning('Failed to remove incomplete GPT Image write', { category: 'gpt_image', metadata: { code: cleanupError.code || 'UNKNOWN' } });
    });
    throw error;
  } finally {
    await handle.close();
  }
  return { fileName, absolutePath, url: `${MEDIA_PREFIX}${fileName}`, mimeType: metadata.mimeType, sizeBytes: buffer.length };
}
async function readSafeFile(root, fileName) {
  if (typeof fileName !== 'string' || !fileName || fileName.length > 240 || path.basename(fileName) !== fileName || /[\\/\x00-\x1f]/.test(fileName)) throw storageError();
  await assertNoSymlinks(root);
  const target = path.join(root, fileName);
  if ((await fsp.lstat(target)).isSymbolicLink()) throw storageError();
  const handle = await fsp.open(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_STORED_BYTES) throw storageError();
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
async function readPrivateImage(fileName) {
  if (!PRIVATE_NAME.test(fileName)) throw storageError();
  return readSafeFile(await ensureStorage(), fileName);
}
async function readLibraryImage({ fileName, url }) {
  if (typeof url === 'string' && url.startsWith(MEDIA_PREFIX)) {
    if (url !== `${MEDIA_PREFIX}${fileName}`) throw storageError();
    return readPrivateImage(fileName);
  }
  // Legacy URLs are never fetched or rewritten. Only registered public/img files
  // can become provider inputs; no arbitrary local path or upstream URL support.
  if (typeof url !== 'string' || !url.startsWith('/img/') || decodeURIComponent(url.slice(5)) !== fileName) throw storageError();
  return readSafeFile(path.join(APP_ROOT, 'public/img'), fileName);
}

// Wrap static mounts (including gzip/game aliases) so a symlink into private
// storage cannot publish a private image under an alternative URL.
function guardStaticMedia(root, middleware) {
  return async (req, res, next) => {
    try {
      const pathname = decodeURIComponent(req.path || '/');
      const candidate = path.resolve(root, `.${pathname}`);
      if (!within(path.resolve(root), candidate)) return res.status(404).end();
      for (const suffix of ['', '.br', '.gz']) {
        const canonical = await fsp.realpath(candidate + suffix).catch(error => {
          if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
          throw error;
        });
        if (canonical && within(storageRoot(), canonical)) {
          return res.status(404).set('Cache-Control', 'private, no-store').end();
        }
      }
      return middleware(req, res, next);
    } catch (error) {
      if (!(error instanceof URIError)) logger.warning('Failed to verify static GPT Image media isolation', {
        category: 'gpt_image', metadata: { code: error.code || 'UNKNOWN' },
      });
      return res.status(404).set('Cache-Control', 'private, no-store').end();
    }
  };
}
module.exports = { MEDIA_PREFIX, PRIVATE_NAME, MAX_STORED_BYTES, storageRoot, ensureStorage, validateRaster, writeImage, readPrivateImage, readLibraryImage, guardStaticMedia };
