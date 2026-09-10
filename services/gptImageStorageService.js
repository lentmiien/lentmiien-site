const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const sharp = require('sharp');
const logger = require('../utils/logger');

const APP_ROOT = path.resolve(__dirname, '..');
const MEDIA_PREFIX = '/gpt-image/media/';
const PRIVATE_NAME = /^gpt-image-private-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;
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
function storageError(code = 'GPT_IMAGE_STORAGE_UNSAFE') {
  return Object.assign(new Error('GPT Image storage is unavailable.'), { code, status: 503 });
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
  const configured = process.env.GPT_IMAGE_STORAGE_DIR;
  if (configured !== undefined && (!path.isAbsolute(configured) || configured.trim() !== configured || /[\x00-\x1f\x7f]/.test(configured))) {
    throw storageError('GPT_IMAGE_STORAGE_CONFIG');
  }
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
  await assertTrustedStorage(ancestor, ancestor !== root);
  await fsp.mkdir(root, { recursive: true, mode: 0o700 });
  await assertNoSymlinks(root);
  await assertTrustedStorage(root);
  return root;
}
// Directory ancestors are deployment-controlled. Reject writable/untrusted
// directories; a trusted sticky ancestor (e.g. /tmp in tests) cannot replace a
// child owned by the app. The storage root itself must never be shared-writable.
async function assertTrustedStorage(root, allowStickyRoot = false) {
  if (process.platform === 'win32') {
    // Windows stat mode bits do not represent NTFS access control. Fail closed
    // unless the pre-provisioned tree passes a fresh native ACL inspection.
    const { promisify } = require('util');
    const execFile = promisify(require('child_process').execFile);
    try {
      await execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(APP_ROOT, 'scripts/assert-gpt-image-acl.ps1'), '-StoragePath', root,
      ], { windowsHide: true, timeout: 10000, maxBuffer: 1024 });
    } catch (_) {
      throw storageError('GPT_IMAGE_STORAGE_PERMISSIONS');
    }
    return;
  }
  let current = root;
  while (true) {
    const stat = await fsp.lstat(current);
    const trustedOwner = typeof process.geteuid !== 'function' || stat.uid === 0 || stat.uid === process.geteuid();
    const stickyAncestor = (current !== root || allowStickyRoot) && (stat.mode & 0o1000);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !trustedOwner || ((stat.mode & 0o022) && !stickyAncestor)) {
      throw storageError('GPT_IMAGE_STORAGE_PERMISSIONS');
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function diagnosticCode(error) {
  const code = error && error.code;
  return typeof code === 'string' && /^(?:E[A-Z0-9]{1,24}|GPT_IMAGE_STORAGE_[A-Z_]{1,32})$/.test(code) ? code : 'UNKNOWN';
}

async function assertStorageReady({ startup = false } = {}) {
  let probePath;
  let handle;
  let created = false;
  let failure;
  let stage = 'path';
  try {
    const root = await ensureStorage();
    probePath = path.join(root, `.gpt-image-probe-${randomUUID()}`);
    stage = 'create';
    handle = await fsp.open(probePath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
    created = true;
    stage = 'write';
    const payload = Buffer.from(randomUUID());
    await handle.writeFile(payload);
    await handle.sync();
    await handle.close();
    handle = null;
    stage = 'read';
    const actual = await readSafeFile(root, path.basename(probePath));
    if (!actual.equals(payload)) throw storageError('GPT_IMAGE_STORAGE_PROBE');
    stage = 'delete';
    await fsp.unlink(probePath);
    created = false;
  } catch (error) {
    failure = error;
  } finally {
    if (handle) {
      try { await handle.close(); } catch (error) { failure ||= error; }
    }
    if (created) {
      try {
        await fsp.unlink(probePath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          failure ||= error;
          logger.error('GPT Image storage probe cleanup failed; check storage permissions and remove leftover .gpt-image-probe files', {
            category: 'gpt_image', metadata: { code: diagnosticCode(error) },
          });
        }
      }
    }
  }
  if (failure) {
    logger.error('GPT Image storage readiness failed; generation disabled until GPT_IMAGE_STORAGE_DIR path, ownership and read/write/delete access pass validation', {
      category: startup ? 'startup:gpt_image' : 'gpt_image',
      metadata: { stage, code: diagnosticCode(failure) },
    });
    throw Object.assign(storageError('GPT_IMAGE_STORAGE_UNAVAILABLE'), { expose: true });
  }
}

// Optional-feature startup failure does not stop the site. Every provider call
// repeats readiness validation, allowing recovery after an operator repairs it.
async function initializeStorage() {
  try {
    await assertStorageReady({ startup: true });
    return true;
  } catch (_) {
    return false;
  }
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
module.exports = { MEDIA_PREFIX, PRIVATE_NAME, MAX_STORED_BYTES, storageRoot, ensureStorage, assertStorageReady, initializeStorage, validateRaster, writeImage, readPrivateImage, readLibraryImage, guardStaticMedia };
