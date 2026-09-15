const crypto = require('crypto');
const logger = require('../utils/logger');
const { MusicError, errorMessage, sanitizeMetadata } = require('./musicGatewayService');
const RETENTION_MS = 60 * 60 * 1000;
const jobs = new Map();
const terminal = job => ['completed', 'failed'].includes(job.status);
function prune(now = Date.now()) {
  for (const [id, job] of jobs) if (terminal(job) && now - job.completedAt >= RETENTION_MS) jobs.delete(id);
}
function reserve({ ownerId, background = false, admin = false }) {
  prune();
  if (!ownerId) throw new MusicError('Login required.', 401);
  const active = [...jobs.values()].filter(job => !terminal(job));
  if (active.length >= 3 || active.some(job => job.ownerId === ownerId) || background && active.some(job => job.background)) throw new MusicError('Music generation is already active. Wait for its result before starting another.', 429);
  if (jobs.size >= 200) throw new MusicError('Music job history is full. Try again after terminal jobs expire.', 429);
  if (background && [...jobs.values()].some(job => job.ownerId === ownerId && job.status === 'failed')) throw new MusicError('Background generation is paused after a failed or uncertain request. Inspect outputs before manually generating again.', 409);
  const job = { id: crypto.randomUUID(), ownerId, background, admin, status: 'preparing', createdAt: Date.now(), completedAt: null, result: null, saved: [] };
  jobs.set(job.id, job);
  return job;
}
function finish(job, error) {
  job.status = error ? 'failed' : 'completed';
  job.completedAt = Date.now();
  if (error) {
    job.error = errorMessage(error);
    logger.error('Music job failed; inspect Gateway outputs before resubmission', { category: 'music', metadata: { jobId: job.id, model: job.model || null, stage: job.stage || 'prepare', status: error.status || error.response?.status || null } });
  }
  const timer = setTimeout(() => prune(), RETENTION_MS + 1);
  timer.unref?.();
}
function release(job) { jobs.delete(job.id); }
function get(id, ownerId, admin = false) {
  prune();
  const job = jobs.get(id);
  return job && (job.ownerId === ownerId || admin) ? job : null;
}
function serialize(job) {
  return { id: job.id, status: job.status, model: job.model, settings: job.settings, result: job.result, error: job.error || null, completedAt: job.completedAt, saved: job.saved, ai: job.ai || null };
}
function run(job, { request, gateway, authorize, persist }) {
  job.model = request.model.id;
  job.settings = sanitizeMetadata(request.payload);
  job.status = 'queued';
  setImmediate(async () => {
    try {
      if (!await authorize()) throw new MusicError('Music generation permission was revoked.', 403);
      job.status = 'processing';
      job.stage = 'generate';
      const result = await gateway.generate(request);
      job.gatewayJobId = result.job_id;
      job.result = { job_id: result.job_id, model: result.model || null, ...sanitizeMetadata({ seed: result.seed, resolved_settings: result.resolved_settings, provenance: result.provenance, audio_seconds: result.audio_seconds, truncated: result.truncated, duration_cropped: result.duration_cropped }) };
      job.stage = 'outputs';
      const items = await gateway.jobOutputs(result, request);
      job.stage = 'persist';
      job.saved = await persist(items, result);
      if (job.saved.length !== items.length) throw new MusicError('Music output persistence was incomplete. Inspect outputs before generating again.', 502);
      finish(job);
    } catch (error) { finish(job, error); }
  });
}
module.exports = { reserve, release, get, serialize, run, finish, prune, RETENTION_MS };
