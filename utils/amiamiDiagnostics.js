const { STATUS_CODES } = require('http');

// Only fixed explanations and allowlisted fields cross the logging/storage boundary.
// Upstream bodies, arbitrary error messages, request options and causes stay private.
const EXPLANATIONS = {
  challenge: 'Cloudflare challenge confirmed by cf-mitigated: challenge.',
  suspected_challenge: 'Suspected Cloudflare challenge; no definitive cf-mitigated header.',
  forbidden: 'Access denied by upstream; this does not establish an IP block, rate limit or item removal.',
  unavailable: 'Requested resource unavailable (HTTP 404/410); permanent item removal is not established.',
  http: 'Upstream rejected the request.',
  timeout: 'Request timed out. Check connectivity and try later.',
  transport: 'Transport failed before a usable response. Check network, DNS and TLS connectivity.',
  invalid_json: 'Expected JSON but received an invalid JSON response; response body omitted.',
  api_failure: 'AmiAmi item API reported failure; item availability is unknown.',
  missing_item: 'AmiAmi item API returned no product; item availability is unknown.',
  unexpected_html: 'Unexpected list response; expected New Products markup. Check the page manually before retrying.',
  dependency: 'curl-cffi failed to initialize. Run `npm run install:curl-cffi` and retry.',
};

function safeItemCode(value) {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)
    ? value : '[invalid item code]';
}

function safeTarget(value) {
  // These are the scraper's only request targets. Never emit credentials, queries,
  // fragments, redirect locations or caller-controlled paths.
  try {
    const url = new URL(value);
    const target = `${url.origin}${url.pathname}`;
    return [
      'https://www.amiami.com/files/eng/new_items/newitem.html',
      'https://api.amiami.com/api/v1.0/item',
    ].includes(target) ? target : '[redacted target]';
  } catch (_) {
    return '[redacted target]';
  }
}

function safeHeaders(headers) {
  const result = {};
  for (const name of ['content-type', 'cf-mitigated', 'cf-ray', 'retry-after']) {
    // curl-cffi 0.1.50 HttpHeaders: first() -> string, get() -> string[].
    let value;
    if (typeof headers?.first === 'function') value = headers.first(name);
    else if (typeof headers?.get === 'function') value = headers.get(name);
    else if (headers && typeof headers === 'object') {
      const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name);
      value = headers[key];
    }
    if (Array.isArray(value)) [value] = value;
    if (typeof value !== 'string' || value.length > 256 || /[\r\n\x00-\x1f\x7f]/.test(value)) continue;
    value = value.trim();
    if (name === 'content-type') {
      const mime = value.match(/^([a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+)(?:\s*;|$)/i);
      if (mime) result[name] = mime[1].toLowerCase();
    } else if (name === 'cf-mitigated' && value.toLowerCase() === 'challenge') {
      result[name] = 'challenge';
    } else if (name === 'cf-ray' && /^[a-f0-9]{8,32}(?:-[a-z0-9]{2,10})?$/i.test(value)) {
      result[name] = value;
    } else if (name === 'retry-after' && (/^\d{1,10}$/.test(value)
      || /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value))) {
      result[name] = value;
    }
  }
  return result;
}

class AmiAmiRequestError extends Error {
  constructor(kind, context, { status = null, headers = {}, retryable = false, cause } = {}) {
    super(EXPLANATIONS[kind], { cause });
    this.name = 'AmiAmiRequestError';
    this.code = kind === 'dependency' ? 'AMIAMI_SCRAPER_UNAVAILABLE' : `AMIAMI_${kind.toUpperCase()}`;
    this.kind = kind;
    this.phase = context.phase;
    this.target = safeTarget(context.target);
    this.itemCode = safeItemCode(context.itemCode);
    this.status = status;
    this.headers = safeHeaders(headers);
    this.retryable = retryable;
    this.setTiming(context);
  }

  setTiming(context) {
    this.attempts = context.attempts;
    this.elapsedMs = Math.max(0, Date.now() - context.startedAt);
    const item = this.itemCode ? ` item=${this.itemCode}` : '';
    const status = this.status === null ? '' : ` HTTP ${this.status} (${STATUS_CODES[this.status] || 'Unknown status'})`;
    const guidance = ['challenge', 'suspected_challenge'].includes(this.kind)
      ? `${this.phase === 'list' ? ' List request failed; no item fetching started.' : ''} Wait and try later, or check AmiAmi manually in a browser.` : '';
    this.message = `AmiAmi ${this.phase}${item}${status} from ${this.target}: ${EXPLANATIONS[this.kind]}${guidance} (attempts=${this.attempts}, elapsedMs=${this.elapsedMs})`;
  }

  toJSON() {
    return {
      code: this.code, phase: this.phase, target: this.target, itemCode: this.itemCode,
      status: this.status, headers: this.headers, attempts: this.attempts,
      elapsedMs: this.elapsedMs, retryable: this.retryable, message: this.message,
    };
  }
}

function operationDiagnostic(error, { phase, itemCode = null }) {
  if (error instanceof AmiAmiRequestError) return error.toJSON();
  const hints = {
    arguments: 'Invalid scraper options. Check --help; argument values are omitted.',
    runtime: 'curl-cffi runtime setup failed. Check the installation and run npm run install:curl-cffi.',
    'storage-connect': 'MongoDB connection failed. Check MONGOOSE_URL or --mongo-uri and database connectivity.',
    'storage-read': 'Could not read scraper storage. Check availability, permissions and stored JSON format.',
    'listing-persistence': 'Could not persist listings. Check storage availability and permissions; earlier writes may have succeeded.',
    'detail-persistence': 'Could not persist item detail status/data. Check storage availability and permissions; earlier writes may have succeeded.',
    'detail-normalize': 'Could not normalize item details. Check the upstream schema.',
    summary: 'Could not persist the run summary. The previous summary may be stale; check disk space and permissions.',
    cleanup: 'Could not disconnect MongoDB cleanly. Check database connectivity and process resources.',
  };
  const diagnostic = {
    code: 'AMIAMI_RUN_FAILURE', phase, itemCode: safeItemCode(itemCode),
    message: hints[phase] || 'Scraper operation failed. Check the run phase and application configuration.',
  };
  // Known system codes help operators without exposing driver messages/URIs.
  if (['EACCES', 'EPERM', 'ENOSPC', 'ENOENT', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(error?.code)) {
    diagnostic.systemCode = error.code;
  }
  return diagnostic;
}

module.exports = { AmiAmiRequestError, operationDiagnostic, safeHeaders, safeItemCode };
