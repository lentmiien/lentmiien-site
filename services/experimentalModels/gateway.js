const axios = require('axios');
const FormData = require('form-data');
const { LabError, fail } = require('./policy');
const { validateWevis, validateWav, REFERENCE_TASKS, parseInput } = require('./contracts');
const { storageRoot } = require('./storage');

const PATHS = { 'wevisone-vl': '/perception/wevisone-vl', 'ming-tts': '/tts/ming/tasks' };
function redact(value, secrets = []) {
  let text = String(value);
  for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[redacted]');
  return text.replace(/\b(?:Bearer\s+|(?:sk-|ghp_|github_pat_))[A-Za-z0-9._-]+/gi, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/((?:token|api[_-]?key|authorization|secret)["']?\s*[=:]\s*["']?)[^\s,;"'}]+/gi, '$1[redacted]');
}
function safeHeaders(headers = {}) {
  const result = {};
  const type = headers['content-type'];
  if (typeof type === 'string' && /^(?:application\/json|audio\/wav)(?:;\s*charset=utf-8)?$/i.test(type)) result['Content-Type'] = type;
  if (/^\d{1,8}$/.test(String(headers['content-length'] || ''))) result['Content-Length'] = String(headers['content-length']);
  if (typeof headers['cache-control'] === 'string' && /^(?:(?:private|no-store|no-cache|must-revalidate|max-age=0)(?:,\s*)?)+$/.test(headers['cache-control'])) result['Cache-Control'] = headers['cache-control'];
  if (headers['x-generation-complete'] === 'true') result['X-Generation-Complete'] = 'true';
  if (/^\d{1,5}$/.test(String(headers['retry-after'] || '')) && Number(headers['retry-after']) <= 86400) result['Retry-After'] = String(headers['retry-after']);
  return result;
}
const ERROR_MESSAGES = { 404: 'Gateway operation is unsupported. Deploy the updated Gateway and worker.',
  501: 'Gateway worker update required for this operation. No persistent fallback is used.', 401: 'Gateway authentication failed. Check server configuration.', 408: 'Gateway upload read timed out.',
  409: 'Gateway is busy or admission conflicted.', 413: 'Gateway rejected the request size.', 422: 'Gateway rejected the task fields or generation budget.',
  429: 'Gateway GPU queue is busy. Retry manually later.', 499: 'Gateway reported a disconnected request; completion is unknown.',
  502: 'Gateway runtime, response schema or output size failed.', 503: 'Gateway model is unavailable or unconfigured.', 504: 'Gateway timed out; completion is unknown.' };
function gatewayFailure(response) {
  // Arbitrary provider detail strings/objects/validation inputs can contain private
  // prompts, paths and credentials. Preserve only recognized codes, never echo them.
  let batchBusy = false;
  try { batchBusy = JSON.parse(Buffer.from(response.data).toString('utf8')).detail?.code === 'gpu_batch_session_busy'; } catch (_) { /* generic status only */ }
  const status = Object.hasOwn(ERROR_MESSAGES, response.status) ? response.status : 502;
  const error = new LabError(batchBusy ? 'gpu_batch_session_busy' : response.status === 501 ? 'worker_update_required' : response.status === 404 ? 'gateway_unsupported' : 'gateway_error', status,
    batchBusy ? 'Another Gateway batch owns the GPU. Retry manually after it finishes.' : ERROR_MESSAGES[status]);
  error.safeHeaders = safeHeaders(response.headers); error.gatewayStatus = response.status;
  return error;
}
class LabGateway {
  constructor({ http = axios, env = process.env } = {}) { this.http = http; this.env = env; this.discovery = new Map(); }
  config(model) {
    if (!Object.hasOwn(PATHS, model)) fail('unknown_experiment', 404, 'Experiment not found.');
    const token = this.env.MING_ADMIN_TOKEN;
    if (model === 'ming-tts' && (typeof token !== 'string' || !token.trim() || token.length > 4096 || /[\r\n]/.test(token))) fail('missing_configuration', 503, 'Ming requires server-side MING_ADMIN_TOKEN configuration.');
    let base;
    try { base = new URL(this.env.AI_GATEWAY_BASE_URL || 'http://192.168.0.20:8080'); } catch (_) { fail('missing_configuration', 503, 'Invalid AI Gateway server configuration.'); }
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)) fail('missing_configuration', 503, 'AI_GATEWAY_BASE_URL must be a server-configured HTTP origin.');
    const configured = Number(this.env.EXPERIMENTAL_MODELS_TIMEOUT_MS || 2000000);
    if (!Number.isSafeInteger(configured) || configured < 2000000 || configured > 2400000) fail('missing_configuration', 503, 'Experimental Models timeout must be between 2000000 and 2400000 milliseconds.');
    return { origin: base.origin, timeout: configured, headers: model === 'ming-tts' ? { 'X-Ming-Token': token } : {} };
  }
  sanitize(value) {
    // Inspectors and JSON results must not echo the server's private directory,
    // including Windows separator/case variants. JSON strings are parsed first.
    const rootPattern = storageRoot().split(/[\\/]/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\\\/]');
    return redact(value, [this.env.MING_ADMIN_TOKEN]).replace(new RegExp(rootPattern, 'gi'), '[private storage]');
  }
  async send(model, path, { data, headers = {}, maxBytes, timeout, method = 'POST' }) {
    const allowed = model === 'ming-tts' ? ['GET /tts/ming/capabilities', 'POST /tts/ming/tasks', 'POST /tts/ming/tasks/ephemeral']
      : model === 'wevisone-vl' ? ['GET /limits', 'GET /perception/wevisone-vl/capabilities', 'POST /perception/wevisone-vl'] : [];
    if (!allowed.includes(`${method} ${path}`)) fail('unknown_operation', 404, 'Gateway operation is not supported by this experiment.');
    const config = this.config(model), controller = new AbortController();
    const deadline = timeout || config.timeout;
    const timer = setTimeout(() => controller.abort(), deadline); timer.unref?.();
    try {
      const response = await this.http.request({ url: config.origin + path, method, data,
        headers: { ...headers, ...config.headers }, responseType: 'arraybuffer', timeout: deadline, signal: controller.signal,
        maxContentLength: maxBytes, maxBodyLength: path === '/tts/ming/tasks/ephemeral' ? 6320128 : 8404992, maxRedirects: 0, proxy: false, validateStatus: () => true });
      if (!Buffer.isBuffer(response.data)) response.data = Buffer.from(response.data);
      if (response.data.length > maxBytes) fail('response_limit', 502, 'Gateway response exceeded its size limit.');
      if (response.status !== 200) throw gatewayFailure(response);
      if (method === 'POST' && !/(?:^|,\s*)no-store(?:,|$)/i.test(response.headers['cache-control'] || '')) fail('invalid_response', 502, 'Gateway terminal response is missing no-store protection.');
      return response;
    } catch (error) {
      if (error instanceof LabError) throw error;
      if (controller.signal.aborted || ['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED'].includes(error.code)) fail('completion_unknown', 504, 'Site stopped waiting for Gateway. Generation completion is unknown; no automatic retry.');
      fail('gateway_transport', 502, 'Gateway connection or response failed. Generation completion may be unknown; no automatic retry.');
    } finally { clearTimeout(timer); }
  }
  async limits() {
    const response = await this.send('wevisone-vl', '/limits', { method: 'GET', maxBytes: 65536, timeout: 10000 });
    let value;
    try { value = JSON.parse(response.data.toString('utf8')); } catch (_) { fail('invalid_response', 502, 'Invalid Gateway limits response.'); }
    // Expose numeric limits only. No provider strings, paths or unrelated models.
    const numbers = (object, depth = 0) => Object.fromEntries(Object.entries(object && typeof object === 'object' && !Array.isArray(object) ? object : {})
      .slice(0, 80).filter(([key, item]) => /^[a-z][a-z0-9_]{0,60}$/.test(key) && (typeof item === 'number' && Number.isFinite(item) && item >= 0 || depth < 2 && item && typeof item === 'object' && !Array.isArray(item)))
      .map(([key, item]) => [key, typeof item === 'number' ? item : numbers(item, depth + 1)]));
    return { ...numbers({ queue_timeout_sec: value?.queue_timeout_sec, upstream_timeout_sec: value?.upstream_timeout_sec }),
      successors: { wevisone_vl: numbers(value?.successors?.wevisone_vl), ming_tts: numbers(value?.successors?.ming_tts) } };
  }
  async capabilities(model) {
    const config = this.config(model);
    const existing = this.discovery.get(model);
    // Only two registry models; coalesce concurrent reads and cache failures too.
    if (existing && existing.until > Date.now() && existing.origin === config.origin && existing.token === config.headers['X-Ming-Token']) return existing.promise;
    const promise = this.readCapabilities(model);
    this.discovery.set(model, { until: Date.now() + 60000, origin: config.origin, token: config.headers['X-Ming-Token'], promise });
    return promise;
  }
  async requireReference() {
    const capabilities = await this.capabilities('ming-tts');
    if (capabilities.referenceAdapter !== 'available') fail('gateway_unsupported', 503, 'Ephemeral references are unsupported by this Gateway. Deploy the updated Gateway and Ming worker.');
    if (!capabilities.available) fail('model_unavailable', 503, 'Gateway advertises ephemeral references but Ming is currently unavailable.');
  }
  async readCapabilities(model) {
    const path = model === 'ming-tts' ? '/tts/ming/capabilities' : '/perception/wevisone-vl/capabilities';
    let response;
    try { response = await this.send(model, path, { method: 'GET', maxBytes: 65536, timeout: 10000 }); }
    catch (error) {
      if (model === 'ming-tts' && error.gatewayStatus === 404) return { available: false, runtime_verified: false, experimental: true, referenceAdapter: 'unsupported', ephemeral_reference: { version: null }, limits: {} };
      throw error;
    }
    let value;
    try { value = JSON.parse(response.data.toString('utf8')); } catch (_) { fail('invalid_response', 502, 'Invalid Gateway capability response.'); }
    if (!value || typeof value.available !== 'boolean') fail('invalid_response', 502, 'Gateway capability availability is missing.');
    // Local verified schemas provide controls. Discovery cannot enable an unknown
    // operation, expose private catalog data or promote installation to qualification.
    return { available: value.available, runtime_verified: false, experimental: true,
      container_state: ['running', 'stopped', 'starting', 'missing', 'unavailable', 'not_installed'].includes(value.container_state) ? value.container_state : 'unknown',
      optional_installation: typeof value.optional_installation === 'boolean' ? value.optional_installation : null,
      ...(model === 'ming-tts' ? { referenceAdapter: value.ephemeral_reference?.version === 1 ? 'available' : 'unsupported',
        ephemeral_reference: { version: value.ephemeral_reference?.version === 1 ? 1 : null } }
        : { failureInspection: { enabled: false, status: 'contract_pending', advertisedVersion: value.failure_inspection?.version === 1 ? 1 : null } }), limits: await this.limits() };
  }
  async run(model, input, source) {
    input = parseInput(model, input);
    let response;
    if (model === 'wevisone-vl') {
      const form = new FormData();
      form.append('file', source.bytes, { filename: 'image.png', contentType: 'image/png' });
      form.append('task', input.task); form.append('query', input.query); form.append('max_new_tokens', String(input.max_new_tokens));
      if (form.getLengthSync() > 8404992) fail('body_limit', 413, 'Multipart request exceeds Gateway limit.');
      response = await this.send(model, PATHS[model], { data: form, headers: form.getHeaders(), maxBytes: 1048576 });
      if (!/^application\/json(?:;|$)/i.test(response.headers['content-type'] || '')) fail('invalid_response', 502, 'Gateway did not return JSON.');
      let value;
      try { value = JSON.parse(response.data.toString('utf8')); } catch (_) { fail('invalid_response', 502, 'Gateway returned malformed JSON.'); }
      validateWevis(value, input, source.asset);
      // Traverse strings after parsing so JSON-escaped secrets are redacted too.
      const sanitized = JSON.stringify(value, (_key, item) => typeof item === 'string' ? this.sanitize(item) : item);
      return { bytes: Buffer.from(sanitized), mime: 'application/json', metadata: {}, headers: safeHeaders(response.headers), status: 200 };
    }
    if (REFERENCE_TASKS.includes(input.task)) {
      // Recheck at dispatch after any local queue wait. No voice-registry operations.
      await this.requireReference();
      validateWav(source?.bytes, { reference: true });
      const request = mingReferenceRequest(input), data = JSON.stringify(request);
      if (Buffer.byteLength(data) > 16384) fail('body_limit', 413, 'Ming request exceeds 16 KiB.');
      const form = new FormData();
      form.append('file', source.bytes, { filename: 'reference.wav', contentType: 'audio/wav', knownLength: source.bytes.length });
      form.append('request', data);
      form.append('transcript', input.transcript);
      form.append('consent', String(input.consent));
      const length = form.getLengthSync();
      if (length > 6320128) fail('body_limit', 413, 'Ephemeral multipart request exceeds Gateway limit.');
      response = await this.send(model, '/tts/ming/tasks/ephemeral', { data: form,
        headers: { ...form.getHeaders(), 'Content-Length': String(length) }, maxBytes: 6291456 });
    } else {
      const data = JSON.stringify(input);
      if (Buffer.byteLength(data) > 16384) fail('body_limit', 413, 'Ming request exceeds 16 KiB.');
      response = await this.send(model, PATHS[model], { data, headers: { 'Content-Type': 'application/json' }, maxBytes: 6291456 });
    }
    if (!/^audio\/wav(?:;|$)/i.test(response.headers['content-type'] || '') || response.headers['x-generation-complete'] !== 'true') fail('invalid_audio', 502, 'Gateway audio is missing terminal completion headers.');
    return { bytes: response.data, mime: 'audio/wav', metadata: validateWav(response.data), headers: safeHeaders(response.headers), status: 200 };
  }
}
function mingReferenceRequest(input) {
  return { task: input.task, text: input.text, language: input.language, controls: input.controls, max_decode_steps: input.max_decode_steps };
}
module.exports = { mingReferenceRequest, LabGateway, safeHeaders, redact, PATHS };
