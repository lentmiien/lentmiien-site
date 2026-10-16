const { safeReplacement, problem } = require('./policy');
const logger = require('../../utils/logger');
const { operation } = require('./diagnostics');
const LIMITS = { owner: 100, total: 1000 };
const INDEXES = ['admission_slot_unique', 'admission_owner_slot_unique'];

async function initializeIndexes(db) {
  for (const [name, model] of Object.entries(db)) {
    await operation(`${name}.create_collection`, () => model.createCollection());
    await operation(`${name}.create_indexes`, () => model.createIndexes());
  }
  // Job auto-indexing is disabled: install replacement constraints BEFORE removing
  // the old lifetime constraints. Every intermediate step is safe to repeat.
  const indexes = await operation('Job.verify_indexes', () => db.Job.collection.indexes());
  // Verify the actual constraints before removing any legacy index.
  for (const [field, name] of [['slot', INDEXES[0]], ['ownerSlot', INDEXES[1]]]) {
    const index = indexes.find(entry => entry.name === name);
    const key = field === 'slot' ? { slot: 1 } : { ownerId: 1, ownerSlot: 1 };
    if (!index?.unique || index.sparse || JSON.stringify(index.key) !== JSON.stringify(key)
      || JSON.stringify(index.partialFilterExpression) !== JSON.stringify({ [field]: { $type: 'number' } })) {
      await operation('Job.verify_indexes', () => { throw problem('admission_index_invalid', 503); });
    }
  }
  for (const index of indexes) {
    if (INDEXES.includes(index.name)) continue;
    const key = JSON.stringify(index.key);
    if (key !== JSON.stringify({ slot: 1 }) && key !== JSON.stringify({ ownerId: 1, ownerSlot: 1 })) continue;
    try { await operation('Job.drop_legacy_index', () => db.Job.collection.dropIndex(index.name)); }
    catch (error) { if (error.code !== 27) throw error; } // Another initializer already removed it.
  }
}

function safeTerminal(job) {
  if (job.runId) return false;
  if (job.state === 'cancelled') return job.attempts.length === 0;
  const op = job.attempts.at(-1)?.remote;
  if (job.state === 'failed') return op?.status === 'failed' && safeReplacement(op);
  return job.state === 'succeeded' && job.published === true && job.acknowledged === true && !!job.result
    && op?.status === 'succeeded' && op.termination_proven === true && ['verified', 'not_required'].includes(op.cleanup);
}

async function detachedFromRun(db, job) {
  const runId = job.attempts.at(-1)?.runId;
  if (!runId) return job.attempts.length === 0;
  const run = await db.Run.findById(runId).select('state').lean();
  // A crash between clearing job.runId and closing the manifest must not allow
  // retry/release while the old coordinator can still replay that manifest.
  return run?.state === 'closed' && !await db.Control.exists({ _id: 'scheduler', activeRun: runId });
}

async function releaseCapacity(db, job) {
  if (typeof job.slot !== 'number' || !safeTerminal(job) || !await detachedFromRun(db, job)) return;
  return db.Job.findOneAndUpdate({ _id: job._id, version: job.version, runId: null, slot: job.slot }, {
    $unset: { slot: 1, ownerSlot: 1 }, $set: { admissionReleasedAt: new Date() }, $inc: { version: 1 },
  }, { returnDocument: 'after' }).lean();
}

async function reconcileCapacity(db) {
  // Only admitted work is scanned, bounded by the global quota, never all history.
  // Project proof only: up to 1,000 admitted jobs may each contain large frozen
  // inputs/results. Do not load those payloads on every admission attempt.
  const jobs = await db.Job.aggregate([
    { $match: { slot: { $type: 'number' }, runId: null, state: { $in: ['succeeded', 'cancelled', 'failed'] } } },
    { $project: { version: 1, runId: 1, slot: 1, state: 1, published: 1, acknowledged: 1,
      result: { $ne: [{ $ifNull: ['$result', null] }, null] },
      'attempts.runId': 1, 'attempts.remote.status': 1, 'attempts.remote.termination_proven': 1, 'attempts.remote.cleanup': 1 } },
  ]);
  for (const job of jobs) await releaseCapacity(db, job);
}

async function admit(db, ownerId, write, replay) {
  await reconcileCapacity(db);
  const free = (set, max) => { for (let i = 0; i < max; i += 1) if (!set.has(i)) return i; return -1; };
  for (let tries = 0; tries < 12; tries += 1) {
    const slots = await db.Job.find({ slot: { $type: 'number' } }).select('slot ownerSlot ownerId').lean();
    const slot = free(new Set(slots.map(j => j.slot)), LIMITS.total);
    const ownerSlot = free(new Set(slots.filter(j => j.ownerId === ownerId).map(j => j.ownerSlot)), LIMITS.owner);
    if (slot < 0 || ownerSlot < 0) {
      const existing = await replay();
      if (existing) return existing;
      throw problem('outstanding_work_quota', 507);
    }
    try { return await write({ slot, ownerSlot }); }
    catch (error) {
      if (error.code !== 11000) throw error;
      const existing = await replay();
      if (existing) return existing;
    }
  }
  throw problem('acceptance_busy_retry_same_key', 503);
}

async function releaseAfterAcceptance(db, job) {
  // A repair failure must not turn an already durable cancellation into rejection.
  try { return await releaseCapacity(db, job) || job; }
  catch (error) {
    logger.warning('Local AI admission release pending repair', { category: 'local_ai', metadata: { jobId: job._id } });
    return job;
  }
}
module.exports = { initializeIndexes, safeTerminal, detachedFromRun, releaseCapacity, reconcileCapacity, admit, releaseAfterAcceptance };
