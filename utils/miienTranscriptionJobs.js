const { randomUUID } = require('crypto');
const { MiienError, fields } = require('../services/miienChatService');
const { validMiienWav } = require('./miienAudio');
const { MiienAsrAdmissionError, requireAsrAdmission } = require('./miienAsrAdmission');
const HANDLE = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const UPLOAD_MS = 60000;
const MAX_JOBS = 8;
function bounded(raw, fallback, min, max) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
function transcriptionLimits(env = process.env) {
  return {
    deadlineMs: bounded(env.MIIEN_ASR_DEADLINE_MS, 2800000, 2700000, 3600000),
    retentionMs: bounded(env.MIIEN_ASR_RETENTION_MS, 300000, 60000, 600000),
  };
}

// Site-local lifecycle only. Durable slots contain no audio/text and deliberately
// have no TTL: transport failure or process death cannot prove Gateway stopped.
class MiienTranscriptionJobs {
  constructor({ chat, asr, slots, authorize, logger, limits = transcriptionLimits() }) {
    Object.assign(this, { chat, asr, slots, authorize, logger, limits });
    this.jobs = new Map();
  }
  timer(fn, delay) { const timer = setTimeout(fn, delay); timer.unref?.(); return timer; }
  view(job) {
    return { id: job.id, status: job.status, deadlineAt: job.deadlineAt,
      remainingMs: Math.max(0, job.deadlineAt - Date.now()), elapsedMs: Math.max(0, Date.now() - job.startedAt),
      ...(job.status === 'ready' ? { text: job.text } : {}), ...(job.error ? { error: job.error } : {}) };
  }
  async reserve(user, conversationId, body) {
    fields(body, []);
    await this.chat.owned(user, conversationId);
    if (this.jobs.size >= MAX_JOBS) throw new MiienError(429, 'Transcription storage is full. Try again later.');
    const owner = String(user._id);
    if ([...this.jobs.values()].some(job => job.owner === owner && job.held)) throw new MiienError(429, 'Previous transcription work is still outstanding. Try later; text input is ready.');
    const job = { id: randomUUID(), owner, conversationId, status: 'awaiting_upload', held: true,
      startedAt: Date.now(), deadlineAt: Date.now() + UPLOAD_MS, text: null };
    // Reserve local memory before asynchronous database admission.
    this.jobs.set(job.id, job);
    try {
      await requireAsrAdmission(this.slots);
      for (let slot = 0; slot < 2; slot++) {
        try {
          await this.slots.create({ _id: `miien-asr-${slot}`, jobId: job.id, principalId: owner,
            conversationId, startedAt: new Date() });
          job.slot = `miien-asr-${slot}`;
          break;
        } catch (error) {
          if (error.code !== 11000) throw new MiienAsrAdmissionError('reservation', 'asr_reservation_failed');
        }
      }
      if (!job.slot) throw new MiienError(429, 'Transcription capacity is occupied. If it persists, an operator must check outstanding Gateway work.');
      job.deadlineAt = Date.now() + UPLOAD_MS;
      job.timer = this.timer(() => {
        job.abortUpload?.();
        this.finish(job, 'expired', 'Audio upload expired. Record again when ready.');
        void this.release(job);
      }, UPLOAD_MS);
      return this.view(job);
    } catch (error) { this.jobs.delete(job.id); throw error; }
  }
  async scoped(user, conversationId, id) {
    if (!HANDLE.test(id || '')) throw new MiienError(404, 'Transcription job unavailable. It may have expired or been lost after restart.');
    await this.chat.owned(user, conversationId);
    const job = this.jobs.get(id);
    if (!job || job.owner !== String(user._id) || job.conversationId !== conversationId) {
      throw new MiienError(404, 'Transcription job unavailable. It may have expired or been lost after restart.');
    }
    return job;
  }
  async get(user, conversationId, id) { return this.view(await this.scoped(user, conversationId, id)); }
  async beginUpload(user, conversationId, id) {
    const job = await this.scoped(user, conversationId, id);
    if (job.status !== 'awaiting_upload') return { job, accepted: false };
    job.status = 'uploading'; // Synchronous transition makes repeated uploads harmless.
    return { job, accepted: true };
  }
  async upload(job, buffer) {
    if (job.status !== 'uploading') return this.view(job);
    if (!validMiienWav(buffer)) {
      this.finish(job, 'failed', 'Record up to 60 seconds of microphone audio.');
      await this.release(job);
      throw new MiienError(400, job.error);
    }
    clearTimeout(job.timer);
    job.status = 'transcribing';
    job.startedAt = Date.now();
    job.deadlineAt = Date.now() + this.limits.deadlineMs;
    job.task = this.run(job, buffer);
    return this.view(job);
  }
  finish(job, status, error) {
    clearTimeout(job.timer);
    job.text = null;
    job.status = status;
    job.error = error;
    job.timer = this.timer(() => {
      job.text = null;
      this.jobs.delete(job.id);
    }, this.limits.retentionMs);
  }
  async release(job) {
    if (!job.held) return;
    try {
      await this.slots.deleteOne({ _id: job.slot, jobId: job.id });
      job.held = false;
    } catch (_) {
      this.logger.error('Miien ASR admission cleanup failed; operator check required', {
        category: 'chat5_miien_asr', metadata: { jobId: job.id },
      });
    }
  }
  async uploadFailed(job, disconnected = false) {
    if (job.status !== 'uploading') return;
    if (disconnected) this.logger.warning('Miien ASR upload disconnected before dispatch; check upload connectivity', {
      category: 'chat5_miien_asr', metadata: { jobId: job.id, elapsedMs: Date.now() - job.startedAt, abortCategory: 'upload_disconnect' },
    });
    this.finish(job, 'failed', 'Audio upload did not finish. No transcription was submitted.');
    await this.release(job);
  }
  async discard(user, conversationId, id, body) {
    fields(body, ['action']);
    if (!['cancel', 'acknowledge'].includes(body.action)) throw new MiienError(400, 'Invalid transcription action.');
    const job = await this.scoped(user, conversationId, id);
    if (body.action === 'acknowledge' && job.status !== 'ready' && job.status !== 'consumed') throw new MiienError(409, 'Transcript is not ready.');
    const before = job.status;
    // Keep the upstream watchdog and admission while accepted work continues.
    job.text = null;
    job.status = body.action === 'acknowledge' ? 'consumed' : 'cancelled';
    job.error = undefined;
    if (['awaiting_upload', 'uploading'].includes(before)) {
      job.abortUpload?.();
      this.finish(job, job.status);
      await this.release(job);
    }
    return this.view(job);
  }
  async run(job, buffer) {
    const controller = new AbortController();
    let dispatched = false, settled = false;
    const timeout = this.timer(() => {
      this.finish(job, job.status === 'cancelled' ? 'cancelled' : 'expired', 'Transcription exceeded its deadline. Upstream work may continue; no retry was made.');
      controller.abort();
      this.logger.warning('Miien ASR deadline reached; verify outstanding Gateway work before releasing admission', {
        category: 'chat5_miien_asr', metadata: { jobId: job.id, elapsedMs: Date.now() - job.startedAt, abortCategory: 'deadline' },
      });
    }, this.limits.deadlineMs);
    job.timer = timeout;
    try {
      const principal = await this.authorize(job.owner);
      if (!principal) throw new MiienError(403, 'Transcription permission is no longer available.');
      await this.chat.owned(principal, job.conversationId);
      if (controller.signal.aborted || job.status === 'cancelled') return;
      dispatched = true;
      const result = await this.asr.transcribeBuffer({ buffer, originalName: 'miien-recording.wav', mimetype: 'audio/wav',
        options: { model: 'whisper-api', language: 'auto' }, privateRequest: true, signal: controller.signal });
      settled = true;
      buffer = null;
      if (controller.signal.aborted || job.status === 'cancelled') return;
      const current = await this.authorize(job.owner);
      if (!current) throw new MiienError(403, 'Transcription permission is no longer available.');
      await this.chat.owned(current, job.conversationId);
      if (controller.signal.aborted || job.status === 'cancelled') return;
      const text = typeof result.data?.text === 'string' ? result.data.text.trim() : '';
      if (!text || text.length > 4000) throw new MiienError(422, 'No usable speech was recognized. Record a shorter message or type instead.');
      this.finish(job, 'ready');
      job.text = text;
    } catch (error) {
      if ([400, 404, 422].includes(error.response?.status)) settled = true;
      if (!controller.signal.aborted && job.status !== 'cancelled') this.finish(job, 'failed',
        error instanceof MiienError ? error.message : 'Transcription failed. Upstream work may continue; no retry was made. Text input is ready.');
      this.logger.warning('Miien ASR failed; inspect Gateway availability and outstanding admission', {
        category: 'chat5_miien_asr', metadata: { jobId: job.id, elapsedMs: Date.now() - job.startedAt,
          httpStatus: Number.isInteger(error.response?.status) && error.response.status >= 400 && error.response.status <= 599 ? error.response.status : null,
          errorCode: ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ERR_CANCELED', 'ERR_NETWORK', 'ERR_BAD_RESPONSE'].includes(error.code) ? error.code : null,
          abortCategory: controller.signal.aborted ? 'deadline' : job.status === 'cancelled' ? 'local_cancel' : 'none',
          upstreamUncertain: dispatched && !settled },
      });
    } finally {
      buffer = null;
      clearTimeout(timeout);
      if (job.status === 'cancelled') this.finish(job, 'cancelled');
      if (!dispatched || settled) await this.release(job);
    }
  }
}
module.exports = { MiienTranscriptionJobs, transcriptionLimits, UPLOAD_MS, MAX_JOBS };
