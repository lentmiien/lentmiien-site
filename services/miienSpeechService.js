const { randomUUID } = require('crypto');
const { prepareSpeechText } = require('../utils/miienSpeechText');
const axios = require('axios');
const { MiienError, fields } = require('./miienChatService');
const { validSpeechWav, MAX_SPEECH_BYTES } = require('../utils/miienAudio');
const DEADLINE_MS = 20 * 60 * 1000;
const RETENTION_MS = 15 * 60 * 1000;
const MAX_JOBS = 8;
const SLOT = 'miien-anny-en';
const BACKEND = 'omni_anny_en';
const ID = /^[a-f\d]{24}$/i;
const HANDLE = /^[a-f\d-]{36}$/i;

class MiienSpeechService {
  constructor({ chat, slots, authorize, logger, http = axios, apiBase = process.env.TTS_API_BASE || 'http://192.168.0.20:8080' }) {
    Object.assign(this, { chat, slots, authorize, logger, http, apiBase });
    this.origin = null;
    this.jobs = new Map();
    this.active = null;
    this.catalog = null;
  }
  requireOrigin() {
    if (this.origin) return this.origin;
    let url;
    try {
      url = new URL(this.apiBase);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !/^\/$/.test(url.pathname)) {
        throw new Error('Invalid origin');
      }
    } catch (_) {
      this.logger.error('Miien speech origin configuration is invalid; check TTS_API_BASE', { category: 'chat5_miien_speech' });
      throw new MiienError(503, 'Anny is unavailable. Text chat is ready; an operator must check speech configuration.');
    }
    this.origin = url.origin;
    return this.origin;
  }
  prune() {
    for (const [id, job] of this.jobs) {
      if (id !== this.active && job.expiresAt && job.expiresAt <= Date.now()) { job.audio = null; this.jobs.delete(id); }
    }
  }
  view(job) {
    return { id: job.id, messageId: job.messageId, voiceId: 'anny_en', backendId: job.backendId, status: job.status,
      preparationVersion: job.preparationVersion, truncated: job.truncated, spokenCharacters: job.spokenCharacters, deadlineAt: job.deadlineAt,
      expiresAt: job.expiresAt || null, error: job.error || null };
  }
  prepare(text) {
    let prepared;
    try { prepared = prepareSpeechText(text); }
    catch (_) {
      this.logger.warning('Miien speech text preparation failed; inspect parser or input bounds', {
        category: 'chat5_miien_speech', metadata: { stage: 'text_preparation' },
      });
      throw new MiienError(422, 'This reply could not be prepared for speech. Text is saved.');
    }
    if (!/[\p{L}\p{N}\p{So}]/u.test(prepared.preview)) throw new MiienError(422, 'This reply has no speakable text. Text is saved.');
    return prepared;
  }
  recordPreparation(job, prepared) {
    const { preview, ...metadata } = prepared;
    Object.assign(job, metadata); // No raw text or preview retained in job metadata.
  }
  async submit(user, conversationId, body) {
    fields(body, ['messageId', 'voiceId']);
    if (typeof body.messageId !== 'string' || !ID.test(body.messageId) || body.voiceId !== 'anny_en') throw new MiienError(400, 'Choose a saved assistant reply and Anny English.');
    const prepared = this.prepare(await this.chat.speechText(user, conversationId, body.messageId));
    // This optional integration must not prevent route startup or text chat.
    // Validate before admission, even when a previous job could be reused.
    this.requireOrigin();
    this.prune();
    const owner = String(user._id);
    const duplicate = [...this.jobs.values()].find(job => job.owner === owner && job.conversationId === conversationId && job.messageId === body.messageId);
    // Active/failed/timeout identity is deliberately independent of content. An
    // edit or preparation-version change must never bypass outstanding work.
    if (duplicate && (duplicate.status !== 'ready' || this.active === duplicate.id
      || (duplicate.audio && duplicate.fingerprint === prepared.fingerprint
        && duplicate.preparationVersion === prepared.preparationVersion))) return this.view(duplicate);
    if (duplicate) { duplicate.audio = null; this.jobs.delete(duplicate.id); }
    if (this.active || this.jobs.size >= MAX_JOBS) throw new MiienError(429, 'Anny is busy or audio storage is full. Try later; text chat is ready.');
    const job = { id: randomUUID(), owner, conversationId, messageId: body.messageId,
      backendId: BACKEND, status: 'preparing',
      deadlineAt: Date.now() + DEADLINE_MS, audio: null };
    this.recordPreparation(job, prepared);
    this.jobs.set(job.id, job);
    this.active = job.id;
    // No provider request is awaited by the browser submission. Authorization and
    // saved content are loaded again immediately before the sole outbound POST.
    job.task = this.run(job);
    return this.view(job);
  }
  async voices(signal) {
    if (this.catalog && this.catalog.until > Date.now()) return this.catalog.voices;
    const response = await this.http.get(`${this.requireOrigin()}/tts/voices`, {
      timeout: 15000, signal, maxRedirects: 0, maxContentLength: 256 * 1024,
    });
    if (!Array.isArray(response.data?.voices) || response.data.voices.length > 1000) throw new Error('Invalid catalog');
    const voices = response.data.voices.filter(v => typeof v?.voice_id === 'string').map(v => v.voice_id);
    this.catalog = { voices, until: Date.now() + 60000 };
    return voices;
  }
  async run(job) {
    let claimed = false;
    let dispatched = false;
    let settled = false;
    let stage = 'admission';
    const controller = new AbortController();
    const finish = (status, error) => {
      job.status = status;
      job.error = error;
      job.expiresAt = Date.now() + RETENTION_MS;
      if (status !== 'ready') job.audio = null;
    };
    const timeout = setTimeout(() => {
      finish('timeout', 'Anny exceeded 20 minutes. Upstream work may continue; text is saved.');
      controller.abort();
      this.logger.warning('Miien speech deadline reached; upstream work may continue', { category: 'chat5_miien_speech' });
    }, Math.max(1, job.deadlineAt - Date.now()));
    timeout.unref?.();
    try {
      try {
        await this.slots.create({ _id: SLOT, jobId: job.id, principalId: job.owner,
          conversationId: job.conversationId, startedAt: new Date() });
        claimed = true;
      } catch (error) {
        if (error.code === 11000) throw new MiienError(409, 'Anny has outstanding work. If it persists, an operator must check Gateway.');
        throw error;
      }
      stage = 'catalog';
      if (!(await this.voices(controller.signal)).includes(job.backendId)) throw new MiienError(503, 'Anny English is unavailable in the voice catalog.');
      stage = 'authorization';
      const principal = await this.authorize(job.owner);
      if (!principal) throw new MiienError(403, 'Speech permission is no longer available.');
      const prepared = this.prepare(await this.chat.speechText(principal, job.conversationId, job.messageId));
      if (controller.signal.aborted) throw new Error('Deadline');
      this.recordPreparation(job, prepared);
      stage = 'synthesis';
      dispatched = true;
      const response = await this.http.post(`${this.requireOrigin()}/tts`, {
        text: prepared.preview, voice_id: job.backendId, timeout_sec: 600,
      }, { responseType: 'arraybuffer', signal: controller.signal,
        timeout: Math.max(1, job.deadlineAt - Date.now()), maxRedirects: 0,
        maxContentLength: MAX_SPEECH_BYTES, maxBodyLength: 8192 });
      settled = true; // A complete HTTP success is settlement, not browser Stop.
      if (controller.signal.aborted) return;
      stage = 'audio_validation';
      if (!validSpeechWav(response.data)) throw new Error('Invalid WAV');
      stage = 'retention_authorization';
      const current = await this.authorize(job.owner);
      if (!current) throw new MiienError(403, 'Speech permission is no longer available.');
      const retained = this.prepare(await this.chat.speechText(current, job.conversationId, job.messageId));
      if (retained.fingerprint !== job.fingerprint) throw new MiienError(409, 'The saved reply changed. Speech audio is no longer available.');
      if (controller.signal.aborted) return;
      job.audio = response.data;
      finish('ready');
    } catch (error) {
      // Validation rejection proves synthesis never began. Transport failures,
      // redirects, oversized responses and Gateway 502 are deliberately ambiguous.
      if ([400, 404, 422].includes(error.response?.status)) settled = true;
      if (job.status !== 'timeout') finish('failed', error instanceof MiienError ? error.message : 'Anny failed. Text is saved; no automatic retry was made.');
      this.logger.warning('Miien speech failed; inspect Gateway availability or outstanding admission slot', {
        category: 'chat5_miien_speech', metadata: { backendId: job.backendId, stage, outcome: job.status,
          httpStatus: Number.isInteger(error.response?.status) && error.response.status >= 400 && error.response.status <= 599 ? error.response.status : null,
          failure: controller.signal.aborted ? 'deadline' : error instanceof MiienError ? 'rejected' : 'provider_or_transport',
          upstreamUncertain: dispatched && !settled },
      });
    } finally {
      clearTimeout(timeout);
      if (claimed && (!dispatched || settled)) {
        try { await this.slots.deleteOne({ _id: SLOT, jobId: job.id }); }
        catch (_) { this.logger.error('Miien speech admission slot cleanup failed; operator check required', { category: 'chat5_miien_speech' }); }
      }
      if (this.active === job.id) this.active = null;
      const cleanup = setTimeout(() => this.prune(), RETENTION_MS + 1000);
      cleanup.unref?.();
    }
  }
  async get(user, conversationId, id, audio = false) {
    if (!HANDLE.test(id || '')) throw new MiienError(404, 'Speech job not found.');
    this.prune();
    const job = this.jobs.get(id);
    if (!job) throw new MiienError(410, 'Speech audio expired or was lost after restart. Text is saved.');
    if (job.owner !== String(user._id) || job.conversationId !== conversationId) throw new MiienError(404, 'Speech job not found.');
    try {
      const prepared = this.prepare(await this.chat.speechText(user, conversationId, job.messageId));
      if (job.status === 'ready' && (prepared.fingerprint !== job.fingerprint
        || prepared.preparationVersion !== job.preparationVersion)) {
        throw new MiienError(409, 'The saved reply changed. Request speech again.');
      }
    }
    catch (error) { job.audio = null; throw error; }
    if (!audio) return this.view(job);
    if (job.status !== 'ready' || !job.audio) throw new MiienError(409, 'Speech audio is not available.');
    return job.audio;
  }
}
module.exports = { MiienSpeechService, DEADLINE_MS, RETENTION_MS, MAX_JOBS };
