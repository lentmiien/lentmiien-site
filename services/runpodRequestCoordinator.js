const logger = require('../utils/logger');

class RunpodApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'RunpodApiError';
    Object.assign(this, { code: 'RUNPOD_API_ERROR', operation: null, status: null,
      providerCode: null, providerTitle: null, providerDetail: null }, details);
  }
}

function boundedInteger(value, fallback, min, max) {
  const n = Number(value);
  return Number.isSafeInteger(n) && value !== '' && value != null
    ? Math.max(min, Math.min(n, max)) : fallback;
}

// Bound parsing work, never truncate a large valid server delay into an earlier retry.
function parseRateHeaders(headers, now = Date.now()) {
  const get = (name) => String(headers?.get?.(name) || '');
  const policy = get('ratelimit-policy');
  const rate = get('ratelimit');
  const retry = get('retry-after');
  const windows = [];
  let retryAt = 0;
  let invalid = [policy, rate, retry].some((v) => v.length > 4096);
  const parse = (text, fields) => {
    if (!text || text.length > 4096) return [];
    const members = text.split(',');
    if (members.length > 32) { invalid = true; return []; }
    return members.flatMap((member) => {
      const match = member.trim().match(/^"([a-zA-Z0-9_-]{1,32})"((?:\s*;\s*[a-z]+\s*=\s*\d+\s*)+)$/u);
      if (!match) { invalid = true; return []; }
      const values = {};
      for (const part of match[2].split(';').slice(1)) {
        const [key, value] = part.trim().split(/\s*=\s*/u);
        const n = Number(value);
        if (!Number.isSafeInteger(n) || values[key] !== undefined) { invalid = true; return []; }
        values[key] = n;
      }
      if (fields.some((key) => values[key] === undefined)) { invalid = true; return []; }
      return [{ name: match[1], ...values }];
    });
  };
  const policies = parse(policy, ['q', 'w']);
  for (const window of parse(rate, ['r', 't'])) {
    const configured = policies.find((p) => p.name === window.name);
    windows.push({ name: window.name, remaining: window.r, resetSeconds: window.t,
      ...(configured ? { quota: configured.q, windowSeconds: configured.w } : {}) });
    if (window.r === 0) retryAt = Math.max(retryAt, Math.min(Number.MAX_SAFE_INTEGER, now + window.t * 1000));
  }
  if (retry && retry.length <= 4096) {
    if (/^\d+(?:\.\d+)?$/u.test(retry.trim())) {
      const seconds = Number(retry);
      retryAt = Math.max(retryAt, Math.min(Number.MAX_SAFE_INTEGER, now + seconds * 1000));
    } else {
      // Avoid Date.parse accepting arbitrary small integers as calendar years.
      const date = /^[A-Za-z]{3}, /u.test(retry) ? Date.parse(retry) : NaN;
      if (Number.isFinite(date)) retryAt = Math.max(retryAt, date);
      else invalid = true;
    }
  }
  // Malformed metadata gets a conservative fallback; valid long delays remain intact.
  if (invalid) retryAt = Math.max(retryAt, now + 60_000);
  return { retryAt, windows, invalid };
}

function abortError() { return new DOMException('Request aborted', 'AbortError'); }
function withAbort(promise, signal, cancel = () => {}) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      try { cancel(); } catch (_) { /* Cancellation is best effort. */ }
      reject(abortError());
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
  });
}

class RunpodRequestCoordinator {
  constructor({ concurrency = process.env.RUNPOD_API_CONCURRENCY,
    queueLimit = process.env.RUNPOD_API_QUEUE_LIMIT, appLogger = logger, now = Date.now,
    random = Math.random } = {}) {
    this.concurrency = boundedInteger(concurrency, 4, 1, 16);
    this.queueLimit = boundedInteger(queueLimit, 64, 1, 256);
    this.logger = appLogger;
    this.now = now;
    this.random = random;
    this.active = 0;
    this.queue = [];
    this.cooldownUntil = 0;
    this.timer = null;
    this.lastWarning = -Infinity;
    this.stats = { requests: 0, responses: 0, retries: 0, failures: 0, throttled: 0, statuses: {}, windows: [] };
  }

  diagnostics() {
    return { ...this.stats, statuses: { ...this.stats.statuses }, windows: this.stats.windows.map((w) => ({ ...w })),
      active: this.active, queued: this.queue.length, cooldownUntil: this.cooldownUntil };
  }

  observe(response) {
    const rate = parseRateHeaders(response.headers, this.now());
    this.stats.responses += 1;
    const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : 'unknown';
    this.stats.statuses[status] = (this.stats.statuses[status] || 0) + 1;
    if (rate.windows.length) this.stats.windows = rate.windows;
    if (status === 429) {
      this.stats.throttled += 1;
      rate.retryAt = Math.max(rate.retryAt, this.now() + 1000);
    }
    this.cooldownUntil = Math.max(this.cooldownUntil, rate.retryAt);
    if ((status === 429 || rate.invalid) && this.now() - this.lastWarning >= 60_000) {
      this.lastWarning = this.now();
      this.logger.warning('Runpod control-plane throttling requires delayed requests', {
        category: 'runpod_api', metadata: this.diagnostics(),
      });
    }
    return { retryAt: rate.retryAt, retryable: status === 429, quotaWindows: rate.windows };
  }

  acquire({ priority, deadline, notBefore, signal }) {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.queue.length >= this.queueLimit) {
      const displaced = priority === 0
        ? [...this.queue].reverse().find((entry) => entry.priority > priority) : null;
      const error = new RunpodApiError('Runpod request queue is full. Retry later.', { code: 'RUNPOD_QUEUE_FULL', retryable: true });
      if (!displaced) return Promise.reject(error);
      this.queue.splice(this.queue.indexOf(displaced), 1);
      displaced.signal?.removeEventListener('abort', displaced.abort);
      displaced.reject(error);
    }
    return new Promise((resolve, reject) => {
      const entry = { priority, deadline, notBefore, resolve, reject, signal };
      entry.abort = () => { this.queue = this.queue.filter((e) => e !== entry); reject(abortError()); this.drain(); };
      signal?.addEventListener('abort', entry.abort, { once: true });
      this.queue.push(entry);
      this.drain();
    });
  }

  drain() {
    clearTimeout(this.timer);
    this.timer = null;
    const now = this.now();
    this.queue.sort((a, b) => a.priority - b.priority);
    for (const entry of [...this.queue]) {
      const readyAt = Math.max(this.cooldownUntil, entry.notBefore);
      if (now >= entry.deadline || readyAt >= entry.deadline) {
        this.queue.splice(this.queue.indexOf(entry), 1);
        entry.signal?.removeEventListener('abort', entry.abort);
        entry.reject(new RunpodApiError('Runpod request cannot complete within its budget. Retry after the provider cooldown.', {
          code: readyAt >= entry.deadline ? 'RUNPOD_COOLDOWN' : 'RUNPOD_BUDGET_EXCEEDED', retryable: true, retryAt: readyAt,
        }));
      } else if (this.active < this.concurrency && readyAt <= now) {
        this.queue.splice(this.queue.indexOf(entry), 1);
        entry.signal?.removeEventListener('abort', entry.abort);
        this.active += 1;
        entry.resolve(() => { this.active -= 1; this.drain(); });
      }
    }
    if (this.queue.length) {
      const wake = Math.min(...this.queue.map((e) => Math.min(e.deadline, Math.max(this.cooldownUntil, e.notBefore))));
      // Active completions wake ready queues. A timer still enforces queued deadlines.
      const delay = wake <= now ? Math.min(...this.queue.map((e) => e.deadline)) - now : wake - now;
      this.timer = setTimeout(() => this.drain(), Math.max(1, Math.min(delay, 2 ** 31 - 1)));
    }
  }

  async run(attempt, { safe = true, priority = 1, timeoutMs = 10_000, budgetMs = 30_000,
    retries = 2, signal } = {}) {
    const deadline = this.now() + budgetMs;
    let notBefore = 0;
    for (let index = 0; ; index += 1) {
      let release;
      let timer;
      try {
        release = await this.acquire({ priority, deadline, notBefore, signal });
        const controller = new AbortController();
        const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
        timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, Math.max(1, deadline - this.now())));
        return await withAbort(Promise.resolve().then(() => { combined.throwIfAborted(); return attempt(combined); }), combined);
      } catch (original) {
        const error = original?.name === 'AbortError'
          ? new RunpodApiError('Runpod request timed out or was cancelled.', { code: signal?.aborted ? 'RUNPOD_CANCELLED' : 'RUNPOD_TIMEOUT' }) : original;
        const retryable = ['RUNPOD_TIMEOUT', 'RUNPOD_NETWORK_ERROR'].includes(error.code)
          || [408, 429, 500, 502, 503, 504].includes(error.status);
        if (!safe || !retryable || index >= retries || signal?.aborted) {
          this.stats.failures += 1;
          throw error;
        }
        this.stats.retries += 1;
        notBefore = Math.max(error.retryAt || 0, this.now() + Math.min(5000, 250 * 2 ** index) * (1 + this.random()));
      } finally {
        clearTimeout(timer);
        release?.();
      }
    }
  }
}

// All clients using the same transport share quota coordination, even with different keys.
// This is deliberately conservative: keys may belong to the same provider account.
const shared = new WeakMap();
function sharedCoordinator(fetchImpl) {
  if (!shared.has(fetchImpl)) shared.set(fetchImpl, new RunpodRequestCoordinator());
  return shared.get(fetchImpl);
}
module.exports = { RunpodApiError, RunpodRequestCoordinator, boundedInteger, parseRateHeaders, sharedCoordinator, withAbort };
