const { Group, Scan, Queue } = require('../../models/document_vault');
const User = require('../../models/useraccount');
const Role = require('../../models/role');
const { hasCapabilities } = require('../../utils/authorization');
const logger = require('../../utils/logger');
const { READ, REVIEW, INTAKE, BUNDLES, sameId, VaultError } = require('./policy');
const { finishJob, isOperator, filingLocked } = require('./workflow');
const { mutate, cleanInterruptedUploads, restoreExpiredRedos } = require('./repository');
const duplicates = require('./duplicates');
const providers = require('./providers');
const { VaultReplyError } = require('./content');

const SLOT = 'document-vault';
const DEADLINE = 20 * 60 * 1000;
const GRACE = 60 * 1000;
const meta = (kind, extra = {}) => ({ category: 'document_vault', metadata: { kind, ...extra } });

async function authorized(group, job) {
  if (![INTAKE, REVIEW].includes(job.authority) || !isOperator(group, job.actorId)) return false;
  const user = await User.findById(job.actorId).select('_id name type_user').lean();
  return hasCapabilities(user, [READ, job.authority], { roleModel: Role, roleCapabilityBundles: BUNDLES });
}
async function state() {
  return await Queue.findById(SLOT).lean() || { version: 0, pauseReason: null, recent: [], active: null };
}
async function resume(version) {
  const result = await Queue.updateOne({ _id: SLOT, pauseReason: { $ne: null }, version, active: null }, {
    $set: { pauseReason: null, recent: [] }, $inc: { version: 1 },
  });
  if (!result.modifiedCount) throw new VaultError(409, 'Queue status changed. Refresh the queue.');
}

async function release(claim, outcome) {
  const { active, recent } = claim;
  const generation = ['generation', 'success', 'interrupted'].includes(outcome);
  const window = generation ? [...recent, outcome === 'success' ? 'ok' : 'error'].slice(-5) : recent;
  let pauseReason = null;
  if (outcome === 'interrupted') pauseReason = 'interrupted';
  else if (window.filter(value => value === 'error').length >= 3) pauseReason = 'generation';
  const updated = await Queue.updateOne({ _id: SLOT, version: claim.version, 'active.jobId': active.jobId }, {
    $set: { active: null, recent: window, pauseReason }, $inc: { version: 1 },
  });
  if (updated.modifiedCount && pauseReason) logger.warning('Document vault queue paused; verify OCR and Chat5 before resuming', meta('queue', { reason: pauseReason }));
}
async function persist(claim, outcome, result) {
  const { groupId, jobId } = claim.active;
  try {
    await mutate({ _id: groupId, state: 'ready', 'jobs._id': jobId }, group => finishJob(group, jobId, outcome, result));
  } catch (error) {
    if (!(error instanceof VaultError) || error.status !== 404) throw error;
    // A page edit can supersede a summary while it runs. An expired worker
    // can also race a completed write. Never publish a stale response.
    const group = await Group.findById(groupId).select('lastJob').lean();
    if (sameId(group?.lastJob?.jobId, jobId)) outcome = group.lastJob.outcome;
  }
  await release(claim, outcome);
}

class VaultWorker {
  constructor({ generate = providers.generate, authorize = authorized, now = Date.now } = {}) {
    this.generate = generate;
    this.authorize = authorize;
    this.now = now;
    this.timer = null;
    this.busy = false;
    this.lastCleanup = 0;
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 3000);
    this.timer.unref();
    void this.tick();
  }
  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.now() - this.lastCleanup > 10 * 60 * 1000) {
        await cleanInterruptedUploads();
        await restoreExpiredRedos();
        this.lastCleanup = this.now();
        try { await duplicates.recover(); }
        catch (error) {
          logger.warning('Document vault duplicate review recovery deferred; check database availability',
            meta('duplicate-review', { errorName: error.name }));
        }
      }
      await this.runOne();
    } catch (error) {
      logger.error('Document vault worker could not advance; check database and queue status', meta('queue', { errorName: error.name }));
    } finally {
      this.busy = false;
    }
  }
  async runOne() {
    const queue = await state();
    if (queue.pauseReason) return;
    if (queue.active) {
      const group = await Group.findById(queue.active.groupId).select('lastJob').lean();
      if (sameId(group?.lastJob?.jobId, queue.active.jobId)) return release(queue, group.lastJob.outcome);
      if (queue.active.expiresAt.getTime() <= this.now()) return persist(queue, 'interrupted');
      return;
    }
    const next = await Group.findOne({ state: 'ready', nextJobAt: { $type: 'date' } })
      .sort({ nextJobAt: 1, _id: 1 }).select({ jobs: { $slice: 1 } }).lean();
    if (!next?.jobs.length) return;
    if (!queue._id) {
      try { await Queue.updateOne({ _id: SLOT }, { $setOnInsert: { version: 0 } }, { upsert: true }); }
      catch (error) { if (error.code !== 11000) throw error; }
    }
    const jobId = next.jobs[0]._id;
    const active = { jobId, groupId: next._id, pageId: next.jobs[0].pageId, kind: next.jobs[0].kind, expiresAt: new Date(this.now() + DEADLINE + GRACE) };
    const claim = await Queue.findOneAndUpdate({ _id: SLOT, version: queue.version, active: null, pauseReason: null },
      { $set: { active }, $inc: { version: 1 } }, { returnDocument: 'after' }).lean();
    if (!claim) return;

    const group = await Group.findOne({ _id: next._id, state: 'ready', 'jobs._id': jobId });
    if (!group) return release(claim, 'superseded');
    const job = group.jobs.id(jobId);
    const expiredRedo = job.pageId ? filingLocked(group, group.pages.id(job.pageId))
      : group.beforeRedoDescription && group.pages.some(page => filingLocked(group, page));
    if (expiredRedo) return persist(claim, 'superseded');
    if (!await this.authorize(group, job)) {
      logger.warning('Document vault job lost its initiating account access', meta(job.kind, { jobId }));
      return persist(claim, 'access');
    }

    const scan = job.pageId && await Scan.findOne({ _id: job.pageId, groupId: group._id }).select('+bytes');
    if (job.pageId && !scan) {
      logger.error('Document vault job is missing its archived scan', meta(job.kind, { jobId }));
      return persist(claim, 'media');
    }
    const remaining = active.expiresAt.getTime() - GRACE - this.now();
    if (remaining <= 0) return persist(claim, 'interrupted');
    const signal = AbortSignal.timeout(remaining);
    let result;
    let outcome = 'success';
    try {
      result = await this.generate({ group, job, scan, signal });
    } catch (error) {
      const uncertain = signal.aborted || [408, 504].includes(error.response?.status)
        || ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ERR_CANCELED', 'EPIPE'].includes(error.code);
      outcome = uncertain ? 'interrupted' : 'generation';
      if (error instanceof VaultReplyError) {
        result = error.reply;
        logger.warning('Document vault could not validate the Chat5 reply; inspect the saved reply in processing controls',
          meta(job.kind, { jobId, outcome, reason: result.reason }));
      } else {
        logger.warning('Document vault generation failed; check service availability and retry the affected stage', meta(job.kind, {
          jobId, outcome, status: error.response?.status || null, errorName: error.name,
        }));
      }
    }
    await persist(claim, outcome, result);
  }
}

module.exports = { VaultWorker, worker: new VaultWorker(), state, resume, authorized };
