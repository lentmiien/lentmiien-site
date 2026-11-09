const { randomUUID } = require('crypto');
const { parseItemList } = require('./amiamiUploadParser');
const { ACTIVE_STATES, MAX_CODES, DELAY_MS, JOB_LIFETIME_MS, LEASE_MS, AmiAmiUploadError } = require('../utils/amiamiUploadPolicy');

const SLOT = 'html-upload';
const MAX_TIME_MS = 5000;
const MAX_QUEUE_UPDATES = 10;
const versionFilter = job => ({ queueVersion: job.queueVersion ?? { $exists: false } });

function publicJob(job) {
  if (!job) return null;
  // Never return creator IDs, the pending code array or worker ownership tokens.
  const fields = ['jobId', 'state', 'totalCodes', 'queuedCount', 'cursor', 'fetched', 'failed',
    'skippedExisting', 'skippedErrors', 'retryFailed', 'currentCode', 'failures', 'message', 'startedAt', 'finishedAt', 'nextFetchAt'];
  const result = Object.fromEntries(fields.map(field => [field, job[field]]));
  return { ...result, active: ACTIVE_STATES.includes(job.state), delaySeconds: DELAY_MS / 1000 };
}

function createAmiAmiUploadService({ jobModel, itemModel, attemptMissingItemScrape, retryFailedItemScrape,
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

  async function submit(input, creator, format = 'html', { retryFailed = false } = {}) {
    if (typeof retryFailed !== 'boolean') throw new AmiAmiUploadError('INVALID_RETRY', 'Choose whether to retry failed placeholders.');
    if (!/^[a-f\d]{24}$/i.test(String(creator || '')) || !await authorizeCreator(String(creator))) {
      throw new AmiAmiUploadError('FORBIDDEN', 'Import permission is required.', 403);
    }
    const { codes, sizeFallbacks } = parseItemList(input, format);
    const existing = await itemModel.find({ gcode: { $in: codes } }).select('gcode detailStatus').maxTimeMS(MAX_TIME_MS).lean().exec();
    // Check eligibility in MongoDB without loading up to 1,000 full product payloads.
    const retryable = retryFailed ? await itemModel.find({ gcode: { $in: codes }, source: 'amiami-api-lookup',
      detailStatus: 'error', details: null }).select('gcode').maxTimeMS(MAX_TIME_MS).lean().exec() : [];
    const retryCodes = new Set(retryable.map(item => item.gcode));
    const sizeBases = new Set(sizeFallbacks.map(entry => entry.baseCode));
    // An earlier failed base lookup still needs the original size-code fallback.
    // Keep it queued so the worker rechecks catalog state and authority first.
    const known = new Set(existing.filter(item => !retryCodes.has(item.gcode)
      && !(item.detailStatus === 'error' && sizeBases.has(item.gcode))).map(item => item.gcode));
    const errors = new Set(existing.filter(item => item.detailStatus === 'error' && known.has(item.gcode)).map(item => item.gcode));
    const optionsFor = code => ({ code, creator, retryFailed });
    const submittedFallbacks = sizeFallbacks.map(entry => ({ ...entry, creator, retryFailed }));
    for (let attempt = 0; attempt < MAX_QUEUE_UPDATES; attempt += 1) {
      const previous = await read();
      const at = now();
      if (previous && ACTIVE_STATES.includes(previous.state)) {
        if (new Date(previous.expiresAt).getTime() <= at) {
          throw new AmiAmiUploadError('JOB_EXPIRED', 'The import window has expired. Wait for the worker to stop it, then upload again.', 409);
        }
        const remaining = previous.codes.slice(previous.cursor);
        const added = codes.filter(code => !previous.codes.includes(code));
        const pending = added.filter(code => !known.has(code));
        const nextCodes = [...remaining, ...pending];
        const fallbacks = [...(previous.sizeFallbacks || [])];
        const originals = new Set(fallbacks.map(entry => entry.originalCode));
        for (const entry of submittedFallbacks) {
          if (nextCodes.includes(entry.baseCode) && !originals.has(entry.originalCode)) {
            fallbacks.push(entry);
            originals.add(entry.originalCode);
          }
        }
        // Reserve room for every potential size replacement before accepting work.
        const reserved = nextCodes.reduce((count, code) => count
          + Math.max(1, fallbacks.filter(entry => entry.baseCode === code).length), 0);
        if (reserved > MAX_CODES || fallbacks.length > MAX_CODES) {
          throw new AmiAmiUploadError('QUEUE_FULL', 'The queue can hold at most 1,000 pending item codes, including possible size fallbacks. Wait for space, then upload again.', 413);
        }
        const changed = await update({ _id: SLOT, jobId: previous.jobId,
          state: { $in: ACTIVE_STATES }, ...versionFilter(previous) }, {
          codes: nextCodes, cursor: 0, sizeFallbacks: fallbacks,
          codeOptions: [...(previous.codeOptions || []).filter(entry => remaining.includes(entry.code)), ...pending.map(optionsFor)],
          queueVersion: (previous.queueVersion || 0) + 1,
          totalCodes: previous.totalCodes + added.length,
          queuedCount: previous.queuedCount + pending.length,
          skippedExisting: previous.skippedExisting + added.length - pending.length,
          skippedErrors: (previous.skippedErrors || 0) + added.filter(code => errors.has(code)).length,
        });
        if (changed) return publicJob(changed);
        continue;
      }
      const pending = codes.filter(code => !known.has(code));
      const skippedErrors = codes.filter(code => errors.has(code)).length;
      const values = {
        jobId: randomUUID(), creator, state: pending.length ? 'queued' : 'completed', codes: pending,
        sizeFallbacks: submittedFallbacks.filter(entry => !known.has(entry.baseCode)),
        codeOptions: pending.map(optionsFor), queueVersion: 0,
        totalCodes: codes.length, queuedCount: pending.length, cursor: 0, fetched: 0, failed: 0,
        skippedExisting: codes.length - pending.length, skippedErrors, retryFailed, failures: [], currentCode: null,
        message: pending.length ? null : skippedErrors
          ? `${skippedErrors} skipped records still have fetch errors. Review their codes and enable retry for failed placeholders.`
          : 'All item codes are already in the catalog.',
        startedAt: new Date(at), finishedAt: pending.length ? null : new Date(at),
        expiresAt: new Date(at + JOB_LIFETIME_MS),
        nextFetchAt: new Date(Math.max(at, new Date(previous?.nextFetchAt || 0).getTime())),
        leaseToken: null, leaseUntil: null,
      };
      try {
        // The fixed _id admits one shared job; competing submissions then append.
        const job = await update({ _id: SLOT, state: { $nin: ACTIVE_STATES },
          ...(previous ? { jobId: previous.jobId } : {}) }, values, { upsert: true });
        return publicJob(job);
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
    }
    throw new AmiAmiUploadError('QUEUE_BUSY', 'The queue is changing. Please submit this list again.', 409);
  }

  async function finishFailure(job, message) {
    const changed = await update({ _id: SLOT, jobId: job.jobId, leaseToken: job.leaseToken, state: 'running' }, {
      state: 'failed', message, finishedAt: new Date(now()), currentCode: null,
      leaseToken: null, leaseUntil: null, nextFetchAt: new Date(now() + DELAY_MS), codes: [], sizeFallbacks: [], codeOptions: [],
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
        nextFetchAt: new Date(now() + DELAY_MS), codes: [], sizeFallbacks: [], codeOptions: [],
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
      const code = job.codes[job.cursor];
      if (!code) return await finishFailure(job, 'The stored import queue is invalid. Upload the list again.');
      const codeOptions = job.codeOptions?.find(entry => entry.code === code) || job;
      if (!await authorizeCreator(String(codeOptions.creator))) {
        return await finishFailure(job, 'The submitting account no longer has import permission.');
      }
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
      // Opt-in recovery rechecks and atomically replaces only empty error placeholders.
      // Ordinary API lookups and imports retain their no-refresh behavior.
      const result = await (codeOptions.retryFailed ? retryFailedItemScrape(code) : attemptMissingItemScrape(code));
      if (!['fetched', 'failed', 'existing', 'rate-limited'].includes(result?.status)) {
        throw new Error('Unexpected fallback outcome');
      }
      await recordResult(job, code, result);
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

  async function recordResult(claim, code, result) {
    // A submission may append while the request is in flight. Rebase progress on
    // the latest queue and retry only the database update, never the item fetch.
    for (let attempt = 0; attempt < MAX_QUEUE_UPDATES; attempt += 1) {
      const job = await read();
      if (!job || job.jobId !== claim.jobId || job.leaseToken !== claim.leaseToken || job.state !== 'running') return;
      if (job.codes[job.cursor] !== code) throw new Error('Import queue changed its current item');
      const rateLimited = result.status === 'rate-limited';
      const baseFailed = result.status === 'failed'
        || (result.status === 'existing' && result.item?.detailStatus === 'error');
      const sizeFallbacks = job.sizeFallbacks || [];
      const originals = baseFailed ? sizeFallbacks.filter(entry => entry.baseCode === code)
        .map(entry => entry.originalCode).filter(original => !job.codes.includes(original)) : [];
      const retrySize = originals.length > 0;
      // Replace the unsuccessful base entry with original sizes at the tail.
      // Consume its fallback metadata atomically with progress, so retries cannot loop.
      const codes = retrySize
        ? [...job.codes.slice(0, job.cursor), ...job.codes.slice(job.cursor + 1), ...originals] : job.codes;
      const cursor = job.cursor + (rateLimited || retrySize ? 0 : 1);
      const failures = [...job.failures];
      if (result.status === 'failed' && !retrySize && failures.length < 10) {
        failures.push({ itemCode: code, message: 'Item details could not be fetched. See the item error and AmiAmi application logs.' });
      }
      const complete = cursor >= codes.length;
      const changed = await update({ _id: SLOT, jobId: job.jobId, state: 'running', leaseToken: job.leaseToken,
        ...versionFilter(job) }, {
        state: complete ? 'completed' : 'queued', cursor,
        codes: complete ? [] : codes,
        sizeFallbacks: complete ? [] : sizeFallbacks.filter(entry => rateLimited || entry.baseCode !== code),
        codeOptions: complete ? [] : [
          ...(job.codeOptions || []).filter(entry => rateLimited || entry.code !== code),
          ...sizeFallbacks.filter(entry => originals.includes(entry.originalCode)).map(entry => ({
            code: entry.originalCode, creator: entry.creator || job.creator, retryFailed: entry.retryFailed ?? job.retryFailed,
          })),
        ],
        queueVersion: (job.queueVersion || 0) + 1,
        totalCodes: job.totalCodes + (retrySize ? originals.length - 1 : 0),
        queuedCount: job.queuedCount + (retrySize ? originals.length - 1 : 0),
        fetched: job.fetched + (result.status === 'fetched' ? 1 : 0),
        failed: job.failed + (result.status === 'failed' && !retrySize ? 1 : 0),
        skippedExisting: job.skippedExisting + (result.status === 'existing' && !retrySize ? 1 : 0), failures,
        skippedErrors: (job.skippedErrors || 0) + (result.status === 'existing' && baseFailed && !retrySize ? 1 : 0),
        message: rateLimited ? 'Waiting for the existing item-fetch budget.' : retrySize
          ? 'Base item details were unavailable. Original -Sxxx codes are queued for one attempt each.' : null,
        nextFetchAt: new Date(now() + DELAY_MS), finishedAt: complete ? new Date(now()) : null,
        currentCode: null, leaseToken: null, leaseUntil: null,
      });
      if (changed) return;
    }
    throw new Error('Import queue update contention');
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
