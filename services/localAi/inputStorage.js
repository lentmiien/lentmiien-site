const fs = require('fs/promises');
const { constants } = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const sharp = require('sharp');
const { assertNoSymlinks, assertTrustedStorage, within } = require('../gptImageStorageService');
const { problem } = require('./policy');
const MAX_BYTES = 33554432;
const MAX_PIXELS = 16000000;
const TYPES = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const validId = id => typeof id === 'string' && /^in_[a-f0-9]{32}$/.test(id);
function storageRoot() {
  const value = process.env.LOCAL_AI_INPUT_DATA_DIR || (process.platform === 'win32'
    ? 'C:/ProgramData/LennartWebLocalAI/inputs' : path.resolve(__dirname, '../../private_data/local-ai-inputs'));
  if (!path.isAbsolute(value) || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)
    || (process.platform === 'win32' && (!/^[A-Za-z]:[\\/]/.test(value) || value.slice(2).includes(':') || /[. ](?:[\\/]|$)/.test(value)))) throw problem('input_storage_config', 503);
  return path.resolve(value);
}
async function ensureStorage(root = storageRoot()) {
  const app = path.resolve(__dirname, '../..');
  for (const value of [path.join(app, 'public'), path.join(app, 'games'), path.join(app, 'node_modules'), process.env.VUE_PATH].filter(Boolean)) {
    const mount = path.resolve(value);
    const real = await fs.realpath(mount).catch(e => { if (e.code === 'ENOENT') return mount; throw e; });
    if ([mount, real].some(p => within(p, root) || within(root, p))) throw problem('input_storage_unsafe', 503);
  }
  let ancestor = root;
  while (!await fs.lstat(ancestor).catch(e => { if (e.code === 'ENOENT') return null; throw e; })) ancestor = path.dirname(ancestor);
  await assertNoSymlinks(ancestor);
  await assertTrustedStorage(ancestor, ancestor !== root);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await assertNoSymlinks(root); await assertTrustedStorage(root);
  return root;
}
let decoding = false;
async function validateRaster(bytes) {
  if (decoding) throw problem('input_decoder_busy', 503);
  decoding = true;
  try { return await decodeRaster(bytes); } finally { decoding = false; }
}
async function decodeRaster(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) throw problem('input_too_large', 413);
  const rasterMagic = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    || bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
    || (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    || ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
  if (!rasterMagic) throw problem('unsupported_image');
  let info;
  try {
    // Header inspection does not allocate decoded pixels. Check dimensions before
    // constructing the bounded decoder so oversize rasters consistently get 413.
    info = await sharp(bytes, { limitInputPixels: false, failOn: 'warning', animated: true }).metadata();
    if (!TYPES[info.format]) throw problem('unsupported_image');
    if ((info.pages || 1) !== 1) throw problem('animated_image');
    if (!info.width || !info.height || info.width > 8192 || info.height > 8192 || info.width * info.height > MAX_PIXELS) throw problem('image_dimensions', 413);
    await sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'warning', animated: true }).raw().toBuffer();
  } catch (e) { if (e.status) throw e; throw problem('invalid_image'); }
  return { sha256: hash(bytes), bytes: bytes.length, media_type: TYPES[info.format], width: info.width, height: info.height, frames: 1, normalization: 'identity-v1' };
}
async function syncDirectory(root) {
  if (process.platform === 'win32') return; // File FlushFileBuffers is still required; NTFS directory fsync is unavailable.
  const dir = await fs.open(root, 'r'); try { await dir.sync(); } finally { await dir.close(); }
}
async function read(id, descriptor) {
  if (!validId(id)) throw problem('invalid_artifact_id');
  const root = await ensureStorage();
  const target = path.join(root, `${id}.blob`);
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_BYTES) throw problem('input_integrity_failed', 503);
  const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size !== stat.size) throw problem('input_integrity_failed', 503);
    const bytes = await handle.readFile();
    if (bytes.length !== descriptor.bytes || hash(bytes) !== descriptor.sha256) throw problem('input_integrity_failed', 503);
    return bytes;
  } finally { await handle.close(); }
}
// Caller holds the journal writer fence. The single fixed scratch file is covered
// by its reservation and may be rebuilt only after the previous writer is dead.
async function publish(id, bytes, descriptor) {
  if (!validId(id)) throw problem('invalid_artifact_id');
  const root = await ensureStorage();
  const target = path.join(root, `${id}.blob`), temp = path.join(root, `${id}.part`);
  if (await fs.lstat(target).catch(e => { if (e.code === 'ENOENT') return null; throw e; })) {
    await read(id, descriptor); await syncDirectory(root); return;
  }
  const old = await fs.lstat(temp).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (old && (!old.isFile() || old.isSymbolicLink() || old.nlink !== 1)) throw problem('input_storage_unsafe', 503);
  const handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW || 0), 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temp, target);
  await syncDirectory(root);
}
async function assertSpace() {
  const root = await ensureStorage();
  const stat = await fs.statfs(root);
  if (!Number.isFinite(stat.bavail * stat.bsize) || stat.bavail * stat.bsize < 128 * 1024 * 1024) throw problem('input_storage_free_space', 507);
}
module.exports = { MAX_BYTES, MAX_PIXELS, hash, validId, storageRoot, ensureStorage, validateRaster, read, publish, assertSpace, syncDirectory };
