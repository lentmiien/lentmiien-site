const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { fail, LabError } = require('./policy');
const { requireAdapter } = require('./registry');
const { LabGateway, PATHS, mingReferenceRequest } = require('./gateway');
const logger = require('../../utils/logger');

async function authorizedWithin(check) {
  let timer;
  try {
    return await Promise.race([check(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new LabError('authorization_unavailable', 503, 'Dispatch authorization timed out. No Gateway request was made.')), 10000);
      timer.unref?.();
    })]);
  } finally { clearTimeout(timer); }
}
class LabJobs {
  constructor({ store, gateway = new LabGateway() }) {
    this.store = store; this.gateway = gateway; this.pending = []; this.running = false;
    store.onSessionClosing = id => {
      this.pending = this.pending.filter(entry => {
        if (entry.sessionId !== id) return true;
        entry.input = null; entry.authorize = null;
        return false;
      });
    };
  }
  async submit(owner, binding, sessionId, model, body, authorize) {
    const adapter = requireAdapter(model), input = adapter.parse(body);
    this.gateway.config(model); // Missing credentials fail before admission or any network request.
    if (model === 'ming-tts' && input.fileId) await this.gateway.requireReference();
    const job = await this.store.exclusive(async () => {
      const session = this.store.owned(owner, binding, sessionId);
      if (this.pending.length >= this.store.limits.pendingJobs) fail('queue_full', 429, 'Site experiment queue is full. Retry manually later.');
      if (session.jobs.some(j => ['queued', 'waiting_gateway'].includes(j.state))) fail('session_busy', 409, 'This session already has a pending experiment.');
      if (session.jobs.length >= this.store.limits.sessionJobs || session.assets.length >= this.store.limits.sessionFiles) fail('job_limit', 429, 'Session result/job limit reached. Clear test data first.');
      if (model === 'wevisone-vl' && !session.assets.some(a => a.id === input.fileId && a.mime === 'image/png')) fail('not_found', 404, 'Staged image not found.');
      if (model === 'ming-tts' && input.fileId && !session.assets.some(a => a.id === input.fileId && a.mime === 'audio/wav' && a.audio)) fail('not_found', 404, 'Staged reference not found.');
      const asset = input.fileId && session.assets.find(a => a.id === input.fileId);
      const preview = model === 'ming-tts' && asset ? { method: 'POST', endpoint: '/tts/ming/tasks/ephemeral', contentType: 'multipart/form-data',
        file: { mime: asset.mime, bytes: asset.bytes, audio: asset.audio },
        fields: { request: mingReferenceRequest(input), transcript: input.transcript, consent: input.consent }
      } : { method: 'POST', endpoint: PATHS[model],
        ...(asset ? { contentType: 'multipart/form-data', file: { ...asset }, fields: { task: input.task, query: input.query, max_new_tokens: input.max_new_tokens } }
          : { contentType: 'application/json', json: input }) };
      const value = { id: randomUUID(), model, state: 'queued', createdAt: this.store.now(), reservedBytes: adapter.resultBytes, reservedMetadataBytes: 2048,
        request: JSON.stringify(preview, (_key, value) => typeof value === 'string' ? this.gateway.sanitize(value) : value, 2), ...(input.fileId ? { fileId: input.fileId } : {}) };
      this.store.checkQuota(session, adapter.resultBytes + value.reservedMetadataBytes + Buffer.byteLength(JSON.stringify(value)) + 64);
      session.jobs.push(value);
      try { await this.store.save(session); } catch (error) { session.deletePending = true; throw error; }
      this.pending.push({ owner, binding, sessionId, jobId: value.id, input, authorize });
      return { ...value };
    });
    // Detach from the HTTP request; navigation and poll disconnects do not abort it.
    this.kick();
    return job;
  }
  kick() {
    if (this.running) return;
    this.running = true;
    this.draining = this.drain().catch(() => {
      logger.error('Experimental Models queue failed; inspect private storage and restart recovery', { category: 'experimental_models' });
    }).finally(() => { this.running = false; if (this.pending.length) this.kick(); });
  }
  async drain() {
    while (this.pending.length) {
      const entry = this.pending.shift();
      let leased = false, source, job;
      try {
        // Fresh account and browser-session checks, never cached request roles.
        if (!await authorizedWithin(entry.authorize)) fail('authorization_revoked', 403, 'Experiment authorization expired before dispatch.');
        await this.store.exclusive(async () => {
          const session = this.store.owned(entry.owner, entry.binding, entry.sessionId);
          job = session.jobs.find(j => j.id === entry.jobId);
          if (!job || job.state !== 'queued') return;
          this.store.lease(session.id); leased = true;
          if (job.fileId) {
            const asset = session.assets.find(a => a.id === job.fileId && a.mime === (job.model === 'ming-tts' ? 'audio/wav' : 'image/png'));
            if (!asset) fail('not_found', 404, 'Staged source not found.');
            source = { asset, bytes: await this.store.safeRead(this.store.directory(session.id), `${asset.id}.${asset.mime === 'audio/wav' ? 'wav' : 'png'}`, this.store.limits.fileBytes) };
          }
          job.state = 'waiting_gateway'; job.startedAt = this.store.now();
          // Persist uncertainty before forwarding. A restart never replays this job.
          await this.store.save(session);
        }, true);
        if (!leased) continue;
        const result = await this.gateway.run(job.model, entry.input, source);
        await this.store.exclusive(async () => {
          const session = this.store.sessions.get(entry.sessionId);
          if (session.deletePending || session.expiresAt <= this.store.now()) return;
          if (!Buffer.isBuffer(result.bytes) || !result.bytes.length || result.bytes.length > job.reservedBytes) fail('result_limit', 502, 'Result exceeds reserved storage.');
          const asset = { id: randomUUID(), mime: result.mime, bytes: result.bytes.length };
          const ext = result.mime === 'audio/wav' ? 'wav' : 'json';
          const handle = await fs.open(path.join(this.store.directory(session.id), `${asset.id}.${ext}`), 'wx', 0o600);
          session.assets.push(asset); // Reserve the actual file even if write/close fails.
          try {
            try { await handle.writeFile(result.bytes); await handle.sync(); } finally { await handle.close(); }
          } catch (error) { session.deletePending = true; throw error; }
          job.reservedBytes = 0; job.reservedMetadataBytes = 0;
          Object.assign(job, { state: 'succeeded', endedAt: this.store.now(), resultId: asset.id, status: 200, headers: result.headers });
          if (result.mime === 'audio/wav') job.audio = result.metadata;
          try { await this.store.save(session); } catch (error) { session.deletePending = true; throw error; }
        }, true);
      } catch (error) {
        const safe = error instanceof LabError ? error : new LabError('job_failed', 503, 'Experiment failed. Check application diagnostics.');
        logger.warning('Experimental Models job failed; check Gateway availability or private storage', { category: 'experimental_models', metadata: { code: safe.code, status: safe.status } });
        await this.store.exclusive(async () => {
          const session = this.store.sessions.get(entry.sessionId);
          const current = session?.jobs.find(j => j.id === entry.jobId);
          if (!current || current.state === 'cancelled') return;
          Object.assign(current, { state: (['completion_unknown', 'gateway_transport'].includes(safe.code) || [499, 504].includes(safe.gatewayStatus)) ? 'interrupted' : 'failed',
            endedAt: this.store.now(), reservedBytes: 0, reservedMetadataBytes: 0, error: safe.message, code: safe.code, status: safe.gatewayStatus || safe.status,
            headers: safe.safeHeaders || {} });
          await this.store.save(session);
        }, true);
      } finally {
        source = null; entry.input = null; entry.authorize = null;
        if (leased) this.store.release(entry.sessionId);
        await this.store.exclusive(() => this.store.sweepUnlocked(), true);
      }
    }
  }
}
module.exports = { LabJobs };
