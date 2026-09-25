const { randomUUID } = require('crypto');
const { parseItemCodes } = require('./amiamiUploadParser');
const { ACTIVE_STATES, DELAY_MS, JOB_LIFETIME_MS, LEASE_MS, AmiAmiUploadError } = require('../utils/amiamiUploadPolicy');

const SLOT = 'html-upload';
const MAX_TIME_MS = 5000;

function publicJob(job) {
  if (!job) return null;
  // Never return creator IDs, the pending code array or worker ownership tokens.
  const fields = ['jobId', 'state', 'totalCodes', 'queuedCount', 'cursor', 'fetched', 'failed',
    'skippedExisting', 'currentCode', 'failures', 'message', 'startedAt', 'finishedAt', 'nextFetchAt'];
  const result = Object.fromEntries(fields.map(field => [field, job[field]]));
  return { ...result, active: ACTIVE_STATES.includes(job.state), delaySeconds: DELAY_MS / 1000 };
}

function createAmiAmiUploadService({ jobModel, itemModel, attemptMissingItemScrape,
  authorizeCreator, logger, ready = () => true, now = Date.now }) {
  let timer = null;
  let busy = false;
  let stopped = true;
  let reportedStorageFailure = false;
  const read = () => jobModel.findById(SLOT).maxTimeMS(MAX_TIME_MS).lean().exec();
  const update = (filter, values, options = {}) => jobModel.findOneAndUpdate(filter, { $set: values }, {
    new: true, maxTimeMS: MAX_TIME_MS, ...options,
  }).lean().exec();
  const log = (level, message, metadata) => logger[level](message, { category: 'amiami-upload', metadata });

  async function submit(input, creator, format = 'html') {
    if (!/^[a-f\d]{24}$/i.test(String(creator || '')) || !await authorizeCreator(String(creator))) {
      throw new AmiAmiUploadError('FORBIDDEN', 'Import permission is required.', 403);
    }
    const previous = await read();
    if (previous && ACTIVE_STATES.includes(previous.state)) {
      throw new AmiAmiUploadError('JOB_ACTIVE', 'An import is already running. Wait for it to finish.', 409);
    }
    const codes = parseItemCodes(input, format);
    const existing = await itemModel.find({ gcode: { $in: codes } }).select('gcode').maxTimeMS(MAX_TIME_MS).lean().exec();
    const known = new Set(existing.map(item => item.gcode));
    const pending = codes.filter(code => !known.has(code));
    const at = now();
    const values = {
      jobId: randomUUID(), creator, state: pending.length ? 'queued' : 'completed', codes: pending,
      totalCodes: codes.length, queuedCount: pending.length, cursor: 0, fetched: 0, failed: 0,
      skippedExisting: codes.length - pending.length, failures: [], currentCode: null,
      message: pending.length ? null : 'All item codes are already in the catalog.',
      startedAt: new Date(at), finishedAt: pending.length ? null : new Date(at),
      expiresAt: new Date(at + JOB_LIFETIME_MS),
      nextFetchAt: new Date(Math.max(at, new Date(previous?.nextFetchAt || 0).getTime())),
      leaseToken: null, leaseUntil: null,
    };
    try {
      // The fixed _id unique index is the global admission lock. Concurrent
      // upserts against an active or replaced job fail with duplicate key.
      const job = await update({ _id: SLOT, state: { $nin: ACTIVE_STATES },
        ...(previous ? { jobId: previous.jobId } : {}) }, values, { upsert: true });
      return publicJob(job);
    } catch (error) {
      if (error.code === 11000) throw new AmiAmiUploadError('JOB_ACTIVE', 'Another upload was accepted. Reload to view its progress.', 409);
      throw error;
    }
  }

  async function finishFailure(job, message) {
    const changed = await update({ _id: SLOT, jobId: job.jobId, leaseToken: job.leaseToken, state: 'running' }, {
      state: 'failed', message, finishedAt: new Date(now()), currentCode: null,
      leaseToken: null, leaseUntil: null, nextFetchAt: new Date(now() + DELAY_MS), codes: [],
    });
    if (changed) await log('error', 'AmiAmi list import stopped', { jobId: job.jobId, reason: message });
  }

  async function tick() {
    if (busy || stopped || !ready()) return;
    busy = true;
    let job;
    try {
      // Never repeat a request whose result may have been saved before a crash.
      const interrupted = await update({ _id: SLOT, state: 'running', leaseUntil: { $lte: new Date(now()) } }, {
        state: 'failed', message: 'The worker was interrupted during an item. Upload the list again to continue with missing items.',
        finishedAt: new Date(now()), currentCode: null, leaseToken: null, leaseUntil: null,
        nextFetchAt: new Date(now() + DELAY_MS), codes: [],
      });
      if (interrupted) await log('error', 'AmiAmi list import worker claim expired', { jobId: interrupted.jobId });
      if (stopped || !ready()) return;
      job = await update({ _id: SLOT, state: 'queued', nextFetchAt: { $lte: new Date(now()) } }, {
        state: 'running', leaseToken: randomUUID(), leaseUntil: new Date(now() + LEASE_MS),
      });
      if (!job) return;
      if (new Date(job.expiresAt).getTime() <= now()) {
        return await finishFailure(job, 'The 24-hour import window expired. Upload the list again to continue.');
      }
      if (!await authorizeCreator(String(job.creator))) {
        return await finishFailure(job, 'The submitting account no longer has import permission.');
      }
      const code = job.codes[job.cursor];
      if (!code) return await finishFailure(job, 'The stored import queue is invalid. Upload the list again.');
      // Fencing immediately before dispatch; progress from replaced/stale workers
      // can never modify another job. Stop/recovery also cannot overlap local work.
      const owned = await update({ _id: SLOT, jobId: job.jobId, leaseToken: job.leaseToken,
        state: 'running', leaseUntil: { $gt: new Date(now()) } }, { currentCode: code });
      if (!owned) return;
      if (stopped || !ready()) {
        await update({ _id: SLOT, jobId: job.jobId, leaseToken: job.leaseToken }, {
          state: 'queued', leaseToken: null, leaseUntil: null, currentCode: null,
        });
        return;
      }
      // The fallback rechecks existence just before fetching and inserts only
      // missing records, so another writer cannot cause existing data to refresh.
      const result = await attemptMissingItemScrape(code);
      if (!['fetched', 'failed', 'existing', 'rate-limited'].includes(result?.status)) {
        throw new Error('Unexpected fallback outcome');
      }
      const rateLimited = result.status === 'rate-limited';
      const cursor = job.cursor + (rateLimited ? 0 : 1);
      const failures = [...job.failures];
      if (result.status === 'failed' && failures.length < 10) {
        failures.push({ itemCode: code, message: 'Item details could not be fetched. See the item error and AmiAmi application logs.' });
      }
      const complete = cursor >= job.codes.length;
      await update({ _id: SLOT, jobId: job.jobId, state: 'running', leaseToken: job.leaseToken }, {
        state: complete ? 'completed' : 'queued', cursor,
        fetched: job.fetched + (result.status === 'fetched' ? 1 : 0),
        failed: job.failed + (result.status === 'failed' ? 1 : 0),
        skippedExisting: job.skippedExisting + (result.status === 'existing' ? 1 : 0), failures,
        message: rateLimited ? 'Waiting for the existing item-fetch budget.' : null,
        nextFetchAt: new Date(now() + DELAY_MS), finishedAt: complete ? new Date(now()) : null,
        currentCode: null, leaseToken: null, leaseUntil: null, ...(complete ? { codes: [] } : {}),
      });
      if (result.status === 'failed') await log('warning', 'AmiAmi list import item fetch failed', { jobId: job.jobId, itemCode: code });
      reportedStorageFailure = false;
    } catch (_) {
      if (job) {
        try {
          await finishFailure(job, 'Storage or worker processing failed. Check application logs, then upload the list again.');
        } catch (_) { /* Leave the claim to expire if storage remains unavailable. */ }
      }
      if (!reportedStorageFailure) {
        await log('error', 'AmiAmi list import storage or worker operation failed', { jobId: job?.jobId || null });
        reportedStorageFailure = true;
      }
    } finally {
      busy = false;
    }
  }

  function start() {
    stopped = false;
    if (timer) return;
    // Worker lifecycle, not a page request, drives progress.
    timer = setInterval(() => { tick().catch(() => {}); }, 5000);
    timer.unref?.();
  }

  function stop() {
    stopped = true;
    clearInterval(timer);
    timer = null;
  }

  return { submit, status: async () => publicJob(await read()), tick, start, stop };
}

module.exports = { createAmiAmiUploadService, publicJob };
