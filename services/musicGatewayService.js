const axios = require('axios');
const { parseLosslessJson } = require('../utils/losslessJson');
const ACE = 'ace-step-1.5-xl-turbo';
const YUE = 'yue2-3b';
const PROVIDERS = { [ACE]: 'acestep15', [YUE]: 'yue2' };
const EXECUTION_MAX = { [ACE]: 7200, [YUE]: 3630 };
// YuE2 fallbacks stay conservative; verified discovery enables 300s/3630s.
const SPEC = {
  [ACE]: { id: ACE, provider: 'acestep15', defaults: { lyrics: '', instrumental: false, thinking: false, vocal_language: 'unknown', duration: -1, inference_steps: 8, guidance_scale: 7, batch_size: 1, audio_format: 'flac' }, limits: { caption_chars: 512, lyrics_chars: 6000, duration_seconds: [0, 600], inference_steps: [1, 200], guidance_scale: [0, 30], batch_size: [1, 8] }, execution_timeout_sec: 7200, queue_timeout_sec: 900 },
  [YUE]: { id: YUE, provider: 'yue2', defaults: { cot: 'full', max_duration: 20, audio_format: 'flac', abc: null }, limits: { caption_chars: 2000, lyrics_chars: 6000, text_utf8_bytes: 16000, abc_utf8_bytes: 4096, max_duration: [8, 300], audio_format: ['flac', 'wav'], cot: ['full', 'melody', 'none'] }, execution_timeout_sec: 1830, queue_timeout_sec: 900 },
};
class MusicError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}
function fail(message, status) { throw new MusicError(message, status); }
function text(value, max, name, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || [...value].length > max || (required && !value.trim())) fail(`${name} must contain ${required ? '1' : '0'}–${max} characters.`);
  return value;
}
function number(value, min, max, name, integer = true) {
  if (typeof value === 'boolean' || value === null || (typeof value === 'string' && !value.trim()) || !['number', 'string'].includes(typeof value)) fail(`Invalid ${name}.`);
  const n = Number(value);
  if (!Number.isFinite(n) || (integer && !Number.isSafeInteger(n)) || n < min || n > max) fail(`${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`);
  return n;
}
function bool(value, name) {
  if ([true, 'true', 'on', '1'].includes(value)) return true;
  if ([false, 'false', '0', ''].includes(value)) return false;
  fail(`Invalid ${name}.`);
}
function choice(value, options, name) {
  if (!options.includes(value)) fail(`Unsupported ${name}.`);
  return value;
}
function validReference(path) {
  if (typeof path !== 'string' || path.length > 512 || /[%\\\x00-\x1f\x7f?#]/.test(path)) return false;
  if (path.startsWith('yue2:')) return /^yue2:[0-9a-f]{32}\/audio\.(flac|wav)$/.test(path);
  return !path.includes('..') && /^[A-Za-z0-9_-][A-Za-z0-9_. /-]*$/i.test(path)
    && path.split('/').every(part => part && part !== '.');
}
function validPath(path) { return validReference(path) && /\.(flac|wav|mp3|wav32|opus|aac)$/i.test(path); }
function validJobId(id) { return typeof id === 'string' && (/^yue2:[0-9a-f]{32}$/.test(id) || /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/.test(id) && !id.includes('..')); }
function matchesJob(path, id) { return validPath(path) && validJobId(id) && path.startsWith(`${id}/`); }

// Metadata is data only: bounded depth/count/strings, no URLs, paths, credentials,
// prompts or arbitrary response objects in the browser or database.
function sanitizeMetadata(value, depth = 0, seed = false, budget = { nodes: 0, chars: 0 }) {
  if (++budget.nodes > 512 || depth > 6) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? (seed ? String(value) : value) : null;
  if (typeof value === 'string') return (budget.chars += value.length) <= 32768 && value.length <= 4096 && !/(?:https?:\/\/|file:\/\/|Bearer\s)/i.test(value) ? value : undefined;
  if (Array.isArray(value)) return value.slice(0, 32).map(v => sanitizeMetadata(v, depth + 1, seed, budget)).filter(v => v !== undefined);
  if (!value || typeof value !== 'object') return undefined;
  const out = {};
  for (const [key, v] of Object.entries(value).slice(0, 64)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || /(?:url|path|token|secret|password|caption|lyrics|abc|prompt|authorization|cookie)/i.test(key)) continue;
    const clean = sanitizeMetadata(v, depth + 1, seed || /seeds?$/i.test(key), budget);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}
function modelLimits(id, supplied = {}) {
  const baseline = SPEC[id].limits;
  const limits = { ...baseline, ...sanitizeMetadata(supplied) };
  // These public constraint names intentionally contain words omitted from
  // private generation metadata, so copy them through a numeric allowlist.
  for (const key of ['caption_chars', 'lyrics_chars', 'abc_utf8_bytes', 'text_utf8_bytes']) {
    if (baseline[key] === undefined) continue;
    limits[key] = catalogNumber(supplied[key] === undefined ? baseline[key] : supplied[key], 1, baseline[key], `Gateway ${key}`);
  }
  for (const key of ['max_duration', 'duration_seconds', 'inference_steps', 'guidance_scale', 'batch_size']) {
    if (!baseline[key]) continue;
    // An omitted capability must never opt an older Gateway into longer songs.
    const pair = supplied[key] === undefined ? (key === 'max_duration' ? [8, 30] : baseline[key]) : supplied[key];
    if (!Array.isArray(pair) || pair.length !== 2) fail('Invalid Gateway music limits.', 502);
    limits[key] = pair.map(value => catalogNumber(value, baseline[key][0], baseline[key][1], `Gateway ${key}`, key === 'max_duration' || !['duration_seconds', 'guidance_scale'].includes(key)));
    if (limits[key][0] > limits[key][1]) fail('Invalid Gateway music limits.', 502);
  }
  for (const key of ['audio_format', 'cot']) {
    if (!baseline[key]) continue;
    const values = supplied[key] === undefined ? baseline[key] : supplied[key];
    if (!Array.isArray(values) || !values.length || values.length > baseline[key].length || new Set(values).size !== values.length || values.some(value => !baseline[key].includes(value))) fail('Invalid Gateway music choices.', 502);
    limits[key] = values;
  }
  return limits;
}
function catalogNumber(value, min, max, name, integer = true) {
  if (typeof value !== 'number') fail('Invalid Gateway numeric capability.', 502);
  return number(value, min, max, name, integer);
}
function normalizeCatalog(data) {
  if (!data || !Array.isArray(data.models) || data.models.length > 20) fail('Music discovery returned an invalid catalog.', 502);
  const models = data.models.filter(m => m && Object.hasOwn(PROVIDERS, m.id) && PROVIDERS[m.id] === m.provider).map(m => {
    try {
      for (const key of ['limits', 'defaults']) {
        if (m[key] !== undefined && (!m[key] || typeof m[key] !== 'object' || Array.isArray(m[key]))) fail('Invalid Gateway music catalog.', 502);
      }
      for (const key of ['enabled', 'configured']) {
        if (m[key] !== undefined && typeof m[key] !== 'boolean') fail('Invalid Gateway availability.', 502);
      }
      for (const [key, fallback] of Object.entries(SPEC[m.id].defaults)) {
        if (fallback !== null && m.defaults?.[key] !== undefined && typeof m.defaults[key] !== typeof fallback) fail('Invalid Gateway music default.', 502);
      }
      if (m.defaults?.max_duration_seconds !== undefined && typeof m.defaults.max_duration_seconds !== 'number') fail('Invalid Gateway duration default.', 502);
      const model = {
        ...SPEC[m.id], ...sanitizeMetadata(m), id: m.id, provider: m.provider,
        defaults: { ...SPEC[m.id].defaults, ...sanitizeMetadata(m.defaults) },
        limits: modelLimits(m.id, m.limits),
        usable: m.enabled !== false && m.configured !== false && ['startable', 'unknown', 'ready_to_attempt', 'busy'].includes(m.availability),
      };
      model.execution_timeout_sec = catalogNumber(m.execution_timeout_sec === undefined ? SPEC[m.id].execution_timeout_sec : m.execution_timeout_sec, 1, EXECUTION_MAX[m.id], 'Gateway execution budget');
      for (const [key, fallback, max] of [['queue_timeout_sec', 900, 7200], ['preparation_timeout_sec', 900, 3600], ['cleanup_timeout_sec', 600, 1800]]) {
        model[key] = catalogNumber(m[key] === undefined ? fallback : m[key], 1, max, `Gateway ${key}`);
      }
      if (m.id === YUE) model.defaults.max_duration = durationCeiling(m.defaults || {}, SPEC[YUE].defaults.max_duration, model.limits.max_duration);
      // Validate defaults even for disabled providers, before publishing to forms.
      validate({ model: m.id }, { default_model: m.id, models: [{ ...model, usable: true }] }, { promptOnly: true });
      return model;
    } catch (error) {
      if (error instanceof MusicError) fail('Music discovery returned invalid limits, defaults or timing budgets.', 502);
      throw error;
    }
  });
  if (!models.length || new Set(models.map(m => m.id)).size !== models.length) fail('Music discovery returned an invalid catalog.', 502);
  return { default_model: models.some(m => m.id === data.default_model) ? data.default_model : ACE, models, legacy: false, note: 'Stopped/startable models start automatically. Availability is permission to attempt generation.' };
}
function durationCeiling(values, fallback, limits) {
  const supplied = ['max_duration', 'max_duration_seconds'].filter(key => values[key] !== undefined)
    .map(key => number(values[key], Math.max(8, limits[0]), Math.min(300, limits[1]), 'Duration ceiling'));
  if (supplied.length === 2 && supplied[0] !== supplied[1]) fail('Duration aliases must agree.');
  return supplied.length ? supplied[0] : number(fallback, Math.max(8, limits[0]), Math.min(300, limits[1]), 'Duration ceiling');
}
function selectModel(body, catalog) {
  if (body.model !== undefined && body.model_id !== undefined && body.model !== body.model_id) fail('model and model_id must agree.');
  const id = body.model !== undefined ? body.model : body.model_id !== undefined ? body.model_id : catalog.default_model;
  const model = catalog.models.find(m => m.id === id);
  if (!model) fail(catalog.legacy && id === YUE ? 'YuE2 requires the Phase 2 Gateway release. It will not be replaced with ACE.' : 'Unknown music model.', 422);
  if (!model.usable) fail(`Selected music model is ${model.availability || 'unavailable'}. Ask the operator to check Gateway discovery.`, 503);
  return model;
}
function validate(body, catalog, { promptOnly = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 30 || Buffer.byteLength(JSON.stringify(body)) > 32768) fail('Music request is too large or invalid.');
  const m = selectModel(body, catalog);
  const yue = m.id === YUE;
  const common = ['model', 'model_id', 'caption', 'lyrics', 'seed', 'audio_format', 'timeout_sec', '_csrf', 'direction', 'background'];
  const extra = yue ? ['cot', 'abc', 'max_duration', 'max_duration_seconds'] : ['instrumental', 'bpm', 'vocal_language', 'duration', 'thinking', 'load_llm', 'llm_backend', 'inference_steps', 'guidance_scale', 'batch_size'];
  if (Object.keys(body).some(k => ![...common, ...extra].includes(k))) fail('Unsupported settings for the selected music model.');
  const d = m.defaults;
  const payload = { model: m.id };
  if (!promptOnly) {
    payload.caption = text(body.caption, Math.min(m.limits.caption_chars, yue ? 2000 : 512), 'Caption', true);
    payload.lyrics = text(body.lyrics ?? '', Math.min(m.limits.lyrics_chars, 6000), 'Lyrics', yue);
    if (yue && Buffer.byteLength((payload.caption + '\n' + payload.lyrics).normalize('NFC')) > Math.min(m.limits.text_utf8_bytes, 16000)) fail('Combined caption and lyrics exceed the 16000 UTF-8 byte limit.');
  }
  if (body.direction !== undefined) text(body.direction, 2000, 'AI direction');
  if (body.background !== undefined) bool(body.background, 'background');
  if (body.seed !== undefined && !(typeof body.seed === 'string' && !body.seed.trim())) payload.seed = number(body.seed, yue ? 0 : -1, Number.MAX_SAFE_INTEGER, 'Seed');
  payload.audio_format = choice(body.audio_format ?? d.audio_format, yue ? m.limits.audio_format : ['flac', 'wav', 'mp3', 'wav32', 'opus', 'aac'], 'audio format');
  payload.timeout_sec = number(body.timeout_sec ?? m.execution_timeout_sec, 1, Math.min(m.execution_timeout_sec, EXECUTION_MAX[m.id]), 'Execution timeout');
  if (yue) {
    payload.cot = choice(body.cot === 'off' ? 'none' : body.cot ?? d.cot, m.limits.cot, 'planning mode');
    payload.max_duration = durationCeiling(body, d.max_duration, m.limits.max_duration);
    if (body.abc !== undefined && body.abc !== null && body.abc !== '') {
      payload.abc = text(body.abc, 4096, 'ABC score', true);
      if (payload.cot === 'none' || Buffer.byteLength(payload.abc) > Math.min(4096, m.limits.abc_utf8_bytes)) fail('ABC requires full/melody and at most 4096 UTF-8 bytes.');
    }
  } else {
    for (const key of ['instrumental', 'thinking']) payload[key] = body[key] === undefined ? Boolean(d[key]) : bool(body[key], key);
    if (body.load_llm !== undefined && body.load_llm !== '') {
      const load = bool(body.load_llm, 'LM loading');
      // Retain the useful legacy form control: requesting LM loading enables thinking.
      if (body.thinking === undefined) payload.thinking = load;
      if (payload.thinking && !load) fail('Thinking requires LM loading.', 409);
      payload.load = { load_llm: load };
    }
    if (body.llm_backend) payload.load = { ...payload.load, llm_backend: choice(body.llm_backend, ['vllm', 'pt'], 'LM backend') };
    payload.vocal_language = text(body.vocal_language ?? d.vocal_language, 64, 'Vocal language');
    if (body.bpm !== undefined && body.bpm !== '') payload.bpm = number(body.bpm, 1, 300, 'BPM');
    payload.duration = number(body.duration ?? d.duration, -1, m.limits.duration_seconds[1], 'Duration', false);
    if (payload.duration > 0 && payload.duration < m.limits.duration_seconds[0]) fail('Duration is below the Gateway minimum.');
    if (payload.duration < 0 && payload.duration !== -1) fail('Duration must be -1, 0 (automatic), or positive.');
    for (const key of ['inference_steps', 'guidance_scale', 'batch_size']) payload[key] = number(body[key] ?? d[key], m.limits[key][0], m.limits[key][1], key, key !== 'guidance_scale');
  }
  return { payload, model: m, legacy: catalog.legacy, timeoutMs: transportTimeout(m, payload.timeout_sec) };
}
function transportTimeout(model, execution) {
  // Discovery currently publishes queue/execution only. Conservative preparation
  // and cleanup budgets include heavy-container handoff; never silently truncate.
  const queue = number(model.queue_timeout_sec ?? 900, 1, 7200, 'Gateway queue budget');
  const preparation = number(model.preparation_timeout_sec ?? 900, 1, 3600, 'Gateway preparation budget');
  const cleanup = number(model.cleanup_timeout_sec ?? 600, 1, 1800, 'Gateway cleanup budget');
  const total = execution + queue + preparation + cleanup + 60;
  if (total > 18000) fail('Gateway timing configuration exceeds the supported five-hour client budget.', 503);
  return total * 1000;
}
function errorMessage(error) {
  if (error instanceof MusicError) return error.message;
  const status = error?.response?.status;
  return ({ 400: 'Gateway rejected the music request.', 422: 'Gateway rejected the model settings.', 404: 'Music output or endpoint was not found.', 409: 'Gateway reported a busy or incompatible state.', 429: 'Gateway GPU queue wait expired.', 502: 'Gateway could not finalize music output.', 503: 'Selected music provider is disabled or unavailable.', 504: 'Gateway execution timed out. Inspect outputs before manually submitting again.' })[status]
    || 'Music request outcome is uncertain. Automatic generation is paused; inspect Gateway outputs before submitting again.';
}
class MusicGatewayService {
  constructor({ baseUrl = process.env.AI_GATEWAY_BASE_URL || 'http://192.168.0.20:8080', client = axios } = {}) { this.baseUrl = baseUrl; this.client = client; }
  url(path) { return new URL(path, this.baseUrl).toString(); }
  options(extra = {}) { return { timeout: 15000, maxRedirects: 0, maxContentLength: 1024 * 1024, maxBodyLength: 65536, responseType: 'text', transformResponse: [parseLosslessJson], ...extra }; }
  async catalog() {
    try { return normalizeCatalog((await this.client.get(this.url('/music/models'), this.options())).data); }
    catch (error) {
      if (error?.response?.status !== 404) throw error;
      return { default_model: ACE, legacy: true, note: 'Older Gateway release: music discovery is unsupported (404). Only legacy ACE generation is available; deploy Gateway Phase 2 for YuE2.', models: [{ ...SPEC[ACE], usable: true, availability: 'unknown', enabled: true, configured: true }] };
    }
  }
  async generate(request) {
    const payload = { ...request.payload };
    if (request.legacy) delete payload.model;
    const response = await this.client.post(this.url(request.legacy ? '/music/acestep15/generate' : '/music/generate'), payload, this.options({ timeout: request.timeoutMs }));
    const data = response.data;
    if (response.status !== 200 || !data || data.ok === false || !validJobId(data.job_id)) fail('Gateway did not return a finished music generation.', 502);
    if (!request.legacy && (data.ok !== true || data.model !== request.model.id || data.model_id !== request.model.id || !Array.isArray(data.outputs) || !data.outputs.length)) fail('Gateway generation model or output envelope did not match the request.', 502);
    return data;
  }
  async list({ jobId, page = 1, limit = 20, legacy = false } = {}) {
    if (jobId && !validJobId(jobId)) fail('Invalid Gateway job identifier.');
    number(page, 1, 10000, 'Page'); number(limit, 1, 200, 'Limit');
    const { data } = await this.client.get(this.url(legacy ? '/music/acestep15/outputs' : '/music/outputs'), this.options({ params: { page, limit, ...(jobId ? { job_id: jobId } : {}) } }));
    if (!data || !Array.isArray(data.items) || data.items.length > limit || data.ok === false) fail('Gateway output listing is invalid.', 502);
    if (data.items.some(item => !validReference(item.path) || jobId && !item.path.startsWith(`${jobId}/`))) fail('Gateway returned an unrelated or unsafe output.', 502);
    return { ok: true, job_id: jobId || null, total: data.total, page: data.page, limit: data.limit, pages: data.pages, items: data.items.filter(item => validPath(item.path)).map(item => ({ path: item.path, name: String(item.name || item.path).slice(0, 512), size_bytes: item.size_bytes, modified_ts: item.modified_ts })) };
  }
  async jobOutputs(result, request) {
    const items = [];
    for (let page = 1; page <= 2; page++) {
      const listing = await this.list({ jobId: result.job_id, page, limit: 200, legacy: request.legacy });
      items.push(...listing.items);
      if ((listing.pages || 1) <= page) break;
      if (page === 2) fail('Music output listing exceeds the bounded job limit.', 502);
    }
    const expected = Array.isArray(result.outputs) ? result.outputs.map(item => item.path) : [];
    if (!items.length || new Set(items.map(item => item.path)).size !== items.length || expected.some(path => !items.some(item => item.path === path))) fail('Required finalized music outputs are missing.', 502);
    return items;
  }
}
module.exports = { MusicGatewayService, MusicError, ACE, YUE, SPEC, validate, selectModel, normalizeCatalog, sanitizeMetadata, errorMessage, validPath, validJobId, matchesJob, transportTimeout, modelLimits };
