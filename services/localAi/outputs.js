const fs = require('fs/promises');
const { constants } = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { z } = require('zod');
const { problem, digest } = require('./policy');
const storage = require('./inputStorage');
const HASH = /^[a-f0-9]{64}$/;
const descriptor = z.object({ artifact_id: z.string().regex(/^out_[a-f0-9]{32}_\d+$/), slot: z.number().int().min(0).max(15), node_id: z.string().max(100),
  sha256: z.string().regex(HASH), bytes: z.number().int().min(1).max(268435456), media_type: z.enum(['image/png', 'video/mp4']),
  width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096), frames: z.number().int().min(1).max(130), url: z.string().max(512),
  duration_seconds: z.number().positive().max(6).optional(), audio: z.literal(true).optional(), video_codec: z.string().regex(/^[a-z0-9_]{1,40}$/).optional(), audio_codec: z.string().regex(/^[a-z0-9_]{1,40}$/).optional(),
}).strict();
function root() {
  const value = process.env.LOCAL_AI_OUTPUT_DATA_DIR || (process.platform === 'win32' ? 'C:/ProgramData/LennartWebLocalAI/outputs' : path.resolve(__dirname, '../../private_data/local-ai-outputs'));
  if (!path.isAbsolute(value) || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)
    || (process.platform === 'win32' && (!/^[A-Za-z]:[\\/]/.test(value) || value.slice(2).includes(':') || /[. ](?:[\\/]|$)/.test(value)))) throw problem('output_storage_config', 503);
  return path.resolve(value);
}
function manifest(job, op) {
  if (op.integrity_error) throw problem('gateway_result_digest_mismatch');
  const r = op.result, p = job.source.workflowPolicy;
  if (!r || Object.keys(r).sort().join(',') !== 'artifacts,schema_version,template_sha256,workflow_id' || r.schema_version !== 2
    || r.workflow_id !== job.request.workflow_id || r.template_sha256 !== job.request.template_sha256 || !HASH.test(op.result_digest)
    || !Array.isArray(r.artifacts) || r.artifacts.length !== p.outputs.length) throw problem('malformed_workflow_result');
  let total = 0;
  r.artifacts.forEach((a, i) => {
    const expected = p.outputs[i];
    if (!descriptor.safeParse(a).success || a.slot !== i || a.slot !== expected.slot || a.node_id !== expected.node_id || expected.count !== 1
      || a.url !== `/batch/operations/${op.id}/outputs/${a.artifact_id}` || !a.artifact_id.endsWith(`_${i}`)
      || a.bytes > p.limits.max_artifact_bytes || a.width * a.height > Math.min(16000000, p.limits.max_pixels)
      || a.width > p.limits.max_width || a.height > p.limits.max_height || a.frames > p.limits.max_frames
      || (expected.kind === 'image' ? a.media_type !== 'image/png' || a.frames !== 1 || a.bytes > 33554432
        : a.media_type !== 'video/mp4' || a.audio !== true || !a.video_codec || !a.audio_codec || !a.duration_seconds || a.duration_seconds > p.limits.max_duration_seconds)) throw problem('malformed_workflow_result');
    total += a.bytes;
  });
  if (total > p.limits.max_output_bytes || new Set(r.artifacts.map(a => a.artifact_id)).size !== r.artifacts.length) throw problem('malformed_workflow_result');
  return r;
}
// Gateway fully decodes/counts video and audio using its pinned CPU ffprobe.
// Site verifies the authenticated immutable descriptor, complete hash and bounded
// ISO BMFF structure. No Windows binary or transcoding is introduced.
function checkMp4(bytes) {
  const fail = () => { throw problem('invalid_output_video'); };
  if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp' || !['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'iso5', 'iso6'].includes(bytes.toString('ascii', 8, 12))) fail();
  let count = 0; const top = new Set();
  function walk(start, end, depth = 0) {
    if (depth > 12) fail();
    while (start < end) {
      if (++count > 100000 || end - start < 8) fail();
      let size = bytes.readUInt32BE(start), header = 8;
      const kind = bytes.toString('ascii', start + 4, start + 8);
      if (size === 1) { if (end - start < 16) fail(); size = Number(bytes.readBigUInt64BE(start + 8)); header = 16; }
      if (!size) size = end - start;
      if (!Number.isSafeInteger(size) || size < header || start + size > end) fail();
      const left = start + header, right = start + size;
      if (!depth) top.add(kind);
      if (['moov', 'trak', 'mdia', 'minf', 'dinf', 'stbl'].includes(kind)) walk(left, right, depth + 1);
      if (kind === 'dref') {
        if (right - left !== 20 || bytes.readUInt32BE(left + 4) !== 1 || bytes.readUInt32BE(left + 8) !== 12
          || bytes.toString('ascii', left + 12, left + 16) !== 'url ' || bytes.readUInt32BE(left + 16) !== 1) fail();
      }
      start = right;
    }
  }
  walk(0, bytes.length);
  if (!top.has('moov') || !top.has('mdat')) fail();
}
async function validate(bytes, a) {
  if (bytes.length !== a.bytes || storage.hash(bytes) !== a.sha256) throw problem('artifact_integrity_failed');
  if (a.media_type === 'image/png') {
    const actual = await storage.validateRaster(bytes);
    if (actual.media_type !== a.media_type || actual.width !== a.width || actual.height !== a.height || actual.frames !== a.frames) throw problem('artifact_dimensions_mismatch');
  } else checkMp4(bytes);
}
async function read(a) {
  if (!descriptor.safeParse(a).success) throw problem('malformed_workflow_result');
  const directory = await storage.ensureStorage(root());
  const file = path.join(directory, a.artifact_id + '.blob');
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== a.bytes) throw problem('artifact_integrity_failed');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const actual = await handle.stat();
    if (actual.ino !== stat.ino || actual.dev !== stat.dev || actual.size !== stat.size) throw problem('artifact_integrity_failed');
    const bytes = await handle.readFile();
    if (bytes.length !== a.bytes || storage.hash(bytes) !== a.sha256) throw problem('artifact_integrity_failed');
    return bytes;
  } finally { await handle.close(); }
}
async function reserve(db, job, op) {
  const max = (key, fallback) => {
    const n = process.env[key] === undefined ? fallback : Number(process.env[key]);
    if (!Number.isSafeInteger(n) || n < 536870912 || n > 64 * 1024 ** 3) throw problem('output_quota_config', 503);
    return n;
  };
  const total = max('LOCAL_AI_OUTPUT_QUOTA_BYTES', 8 * 1024 ** 3), owner = max('LOCAL_AI_OUTPUT_OWNER_QUOTA_BYTES', 2 * 1024 ** 3);
  const bytes = 2 * job.source.workflowPolicy.limits.max_output_bytes + 1048576;
  try { await db.OutputQuota.updateOne({ _id: 'outputs' }, { $setOnInsert: { allocations: [] } }, { upsert: true }); } catch (e) { if (e.code !== 11000) throw e; }
  if (await db.OutputQuota.exists({ _id: 'outputs', 'allocations.id': op.id })) return;
  const ownerBytes = { $sum: { $map: { input: { $filter: { input: '$allocations', as: 'a', cond: { $eq: ['$$a.ownerId', job.ownerId] } } }, as: 'a', in: '$$a.bytes' } } };
  const update = await db.OutputQuota.updateOne({ _id: 'outputs', 'allocations.id': { $ne: op.id }, $expr: { $and: [
    { $lt: [{ $size: '$allocations' }, 10000] }, { $lte: [{ $add: [{ $sum: '$allocations.bytes' }, bytes] }, total] }, { $lte: [{ $add: [ownerBytes, bytes] }, owner] },
  ] } }, { $push: { allocations: { id: op.id, ownerId: job.ownerId, bytes } } });
  if (!update.matchedCount && !await db.OutputQuota.exists({ _id: 'outputs', 'allocations.id': op.id })) throw problem('output_storage_quota', 507);
}
async function collect(gateway, db, job, op) {
  const r = manifest(job, op);
  await reserve(db, job, op);
  const directory = await storage.ensureStorage(root());
  for (const a of r.artifacts) {
    try { await validate(await read(a), a); await storage.syncDirectory(directory); continue; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const space = await fs.statfs(directory);
    if (space.bavail * space.bsize < a.bytes * 2 + 128 * 1024 ** 2) throw problem('output_storage_free_space', 507);
    const target = path.join(directory, a.artifact_id + '.blob'), temp = target + '.part';
    const old = await fs.lstat(temp).catch(e => { if (e.code !== 'ENOENT') throw e; });
    if (old && (!old.isFile() || old.isSymbolicLink() || old.nlink !== 1)) throw problem('output_storage_unsafe', 503);
    const response = await gateway.artifact(op.id, a.artifact_id);
    if (String(response.headers['content-type']).split(';')[0] !== a.media_type || Number(response.headers['content-length']) !== a.bytes
      || response.headers.etag !== `"${a.sha256}"` || response.status !== 200) { response.data.destroy(); throw problem('artifact_metadata_mismatch', 503); }
    const handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW || 0), 0o600);
    const hash = createHash('sha256'); let count = 0;
    const timer = setTimeout(() => response.data.destroy(problem('artifact_transfer_timeout', 503)), 65000);
    try {
      for await (const chunk of response.data) {
        count += chunk.length;
        if (count > a.bytes) throw problem('artifact_integrity_failed');
        hash.update(chunk); await handle.writeFile(chunk);
      }
      if (count !== a.bytes) throw problem('artifact_transfer_incomplete', 503);
      if (hash.digest('hex') !== a.sha256) throw problem('artifact_integrity_failed');
      await handle.sync();
    } catch (e) { response.data.destroy(); if (!e.status) throw problem('artifact_transfer_failed', 503); throw e; }
    finally { clearTimeout(timer); await handle.close(); }
    const bytes = await fs.readFile(temp);
    await validate(bytes, a);
    await fs.rename(temp, target); await storage.syncDirectory(directory);
  }
  // Persist the complete descriptor/provenance in the job before publication/ACK.
  // No allocation is released until every slot exists; partials remain charged.
  await db.OutputQuota.updateOne({ _id: 'outputs', 'allocations.id': op.id }, { $set: { 'allocations.$.bytes': r.artifacts.reduce((n, a) => n + a.bytes, 1048576) } });
  return { ...r, operationId: op.id, resultDigest: op.result_digest, manifestDigest: digest(r), validation: 'gateway-full-decode;site-hash-raster-bmff-v1' };
}
module.exports = { collect, read, manifest, checkMp4, validate, reserve, root };
