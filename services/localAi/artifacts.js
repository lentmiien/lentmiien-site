const fs = require('fs/promises');
const constants = require('fs').constants;
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { problem, ID } = require('./policy');
function root() {
  const dir = path.resolve(process.env.LOCAL_AI_BATCH_DATA_DIR || path.join(__dirname, '../../private_data/local-ai'));
  const publicDir = path.resolve(__dirname, '../../public');
  if (dir === publicDir || dir.startsWith(publicDir + path.sep)) throw problem('private_storage_required', 503);
  return dir;
}
function filePath(id) { if (!ID.test(id)) throw problem('invalid_artifact_id'); return path.join(root(), `${id}.png`); }
async function importImage(gateway, job, operation) {
  const a = operation.result?.artifact;
  if (!a || !/^[a-f0-9]{64}$/.test(a.sha256) || !Number.isInteger(a.bytes) || a.bytes < 1 || a.bytes > 33554432 || a.media_type !== 'image/png') throw problem('malformed_image_result');
  const response = await gateway.output(operation.id);
  const bytes = Buffer.from(response.data);
  if (String(response.headers['content-type']).split(';')[0] !== 'image/png' || bytes.length !== a.bytes
    || crypto.createHash('sha256').update(bytes).digest('hex') !== a.sha256
    || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw problem('artifact_integrity_failed');
  if (response.headers['content-length'] && Number(response.headers['content-length']) !== bytes.length) throw problem('artifact_length_mismatch');
  const info = await sharp(bytes, { limitInputPixels: 1536 * 1536 }).metadata();
  const dims = job.request.prompt['5'].inputs;
  if (info.format !== 'png' || info.width !== dims.width || info.height !== dims.height || (info.pages || 1) !== 1) throw problem('artifact_dimensions_mismatch');
  await sharp(bytes, { limitInputPixels: 1536 * 1536 }).raw().toBuffer();
  await fs.mkdir(root(), { recursive: true, mode: 0o700 });
  const target = filePath(operation.id);
  const temp = `${target}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temp, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try { await fs.rename(temp, target); } finally { await fs.unlink(temp).catch(() => {}); }
  // Directory fsync is unavailable on Windows; the file itself is flushed before publication.
  if (process.platform !== 'win32') { const dir = await fs.open(root(), 'r'); try { await dir.sync(); } finally { await dir.close(); } }
  return { artifactId: operation.id, sha256: a.sha256, bytes: a.bytes, mediaType: 'image/png' };
}
async function readImage(result) {
  const handle = await fs.open(filePath(result.artifactId), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== result.bytes || stat.size > 33554432) throw problem('artifact_integrity_failed', 503);
    const bytes = await handle.readFile();
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== result.sha256) throw problem('artifact_integrity_failed', 503);
    return bytes;
  } finally { await handle.close(); }
}
module.exports = { importImage, readImage, filePath };
