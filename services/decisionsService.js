const axios = require('axios');
const sharp = require('sharp');
const logger = require('../utils/logger');

const MODELS = ['liquid-d1-2b-q8', 'd3-mini-q8', 'gpt-6-luna'];
const ALIASES = { 'liquid-d1-2b': MODELS[0], 'd3-mini': MODELS[1], openai: MODELS[2] };
const MAX_BODY = 8 * 1024 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024;
const TIMEOUT = 1200000;

class DecisionError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; this.statusCode = status; }
}
function fail(message, status) { throw new DecisionError(message, status); }
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) fail(`Invalid ${label} fields.`);
}
function text(value, label, max = 6000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`Invalid ${label}.`);
}
function validateQuestion(question) {
  const extra = question?.type === 'choice' ? ['choices'] : question?.type === 'score' ? ['levels'] : [];
  object(question, ['type', 'name', 'instructions', ...extra], 'question');
  if (!['predicate', 'choice', 'score'].includes(question.type)) fail('Unknown decision type.');
  text(question.instructions, 'question instructions', 2000);
  if (question.name !== undefined) text(question.name, 'question name');
  if (question.type === 'choice') {
    if (!Array.isArray(question.choices) || question.choices.length < 2 || question.choices.length > 255) fail('Use 2–255 choices.');
    const seen = new Set();
    for (const choice of question.choices) {
      object(choice, ['value', 'description'], 'choice');
      if (!['string', 'boolean'].includes(typeof choice.value)) fail('Choices must be strings or booleans.');
      if (choice.description !== undefined && typeof choice.description !== 'string') fail('Invalid choice description.');
      const key = JSON.stringify(choice.value);
      if (seen.has(key)) fail('Choice values must be unique, including their type.');
      seen.add(key);
    }
  }
  if (question.type === 'score') {
    if (!Array.isArray(question.levels) || question.levels.length < 2 || question.levels.length > 10) fail('Use 2–10 ordered score levels.');
    for (const level of question.levels) {
      object(level, ['label', 'description'], 'score level');
      text(level.label, 'level label');
      if (level.description !== undefined && typeof level.description !== 'string') fail('Invalid level description.');
    }
  }
}
function textBytes(value) {
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + textBytes(item), 0);
  if (value && typeof value === 'object') return Object.entries(value).reduce((sum, [key, item]) => sum + Buffer.byteLength(key) + (key === 'image_url' ? 0 : textBytes(item)), 0);
  return 0;
}
async function validateImage(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MAX_IMAGE / 3) * 4 + 40) fail('Image exceeds 5 MiB.', 413);
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) fail('Use an inline base64 PNG, JPEG or WebP image; remote URLs are not allowed.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > MAX_IMAGE) fail('Image exceeds 5 MiB.', 413);
  if (bytes.toString('base64') !== match[2]) fail('Invalid image base64.');
  try {
    const decoder = sharp(bytes, { limitInputPixels: 4000000, failOn: 'warning', animated: true }).timeout({ seconds: 5 });
    const metadata = await decoder.metadata();
    if (metadata.format !== match[1] || (metadata.pages || 1) !== 1
      || !metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096
      || metadata.width * metadata.height > 4000000) fail('Image must be single-frame, at most 4 million pixels and 4,096 pixels per edge.');
    // Fully decode under the pixel/time bounds to reject corrupt content, without saving a file.
    await decoder.raw().toBuffer();
  } catch (error) {
    if (error instanceof DecisionError) throw error;
    fail('Image content is invalid or exceeds decoding limits.');
  }
  return dataUrl;
}
async function buildPayload(raw) {
  object(raw, ['model', 'input', 'questions', 'image_data_url'], 'request');
  if (Buffer.byteLength(JSON.stringify(raw)) > MAX_BODY) fail('Request exceeds 8 MiB.', 413);
  if (typeof raw.model !== 'string' || (!MODELS.includes(raw.model) && !Object.hasOwn(ALIASES, raw.model))) fail('Unknown decision model.');
  // Tool callers may send an empty string for an unused optional image field.
  const imageDataUrl = raw.image_data_url === '' ? undefined : raw.image_data_url;
  if (typeof raw.input !== 'string' || raw.input.length > 6000 || (!raw.input.trim() && !imageDataUrl)) fail('Provide evidence text or an image.');
  if (!Array.isArray(raw.questions) || raw.questions.length < 1 || raw.questions.length > 32) fail('Use 1–32 questions.');
  const names = new Set();
  for (const question of raw.questions) {
    validateQuestion(question);
    if (question.name !== undefined && names.has(question.name)) fail('Question names must be unique.');
    if (question.name !== undefined) names.add(question.name);
  }
  const payload = { model: ALIASES[raw.model] || raw.model, input: raw.input, questions: raw.questions };
  if (imageDataUrl !== undefined) {
    payload.input = [{ role: 'user', content: [
      ...(raw.input ? [{ type: 'input_text', text: raw.input }] : []),
      { type: 'input_image', image_url: imageDataUrl },
    ] }];
  }
  if (textBytes(payload) > 6000) fail('Combined text and keys exceed 6,000 UTF-8 bytes.', 413);
  if (Buffer.byteLength(JSON.stringify(payload)) > MAX_BODY) fail('Request exceeds 8 MiB.', 413);
  if (imageDataUrl !== undefined) await validateImage(imageDataUrl);
  return payload;
}

class DecisionsService {
  constructor({ client = axios, baseUrl = process.env.AI_GATEWAY_BASE_URL || 'http://192.168.0.20:8080', log = logger, now = Date.now } = {}) {
    this.client = client; this.baseUrl = baseUrl.replace(/\/+$/, ''); this.log = log; this.now = now;
    this.active = new Set(); this.rates = new Map();
  }
  async request(path, payload, signal) {
    try {
      const response = await this.client.request({
        method: payload ? 'POST' : 'GET', url: `${this.baseUrl}${path}`,
        ...(payload ? { data: payload } : {}), signal,
        timeout: payload ? TIMEOUT : 10000, maxRedirects: 0,
        maxBodyLength: MAX_BODY, maxContentLength: 1024 * 1024,
      });
      return response.data;
    } catch (error) {
      if (signal?.aborted) throw new DecisionError('Decision request cancelled.', 499);
      const upstreamStatus = error.response?.status;
      const status = [408, 413, 422, 429, 503, 504].includes(upstreamStatus) ? upstreamStatus : error.code === 'ECONNABORTED' ? 504 : 502;
      this.log.warning('AI Gateway decision request failed', { category: 'ai_gateway_decisions', metadata: { status, operation: payload ? 'evaluate' : 'models' } });
      const failure = new DecisionError(`AI Gateway decision request failed (HTTP ${status}). ${status === 422 ? 'Check the documented input limits.' : status === 503 ? 'Check model availability and Gateway credentials.' : 'Check Gateway diagnostics before retrying.'}`, status);
      const retry = String(error.response?.headers?.['retry-after'] || '');
      if (status === 429 && /^\d{1,6}$/.test(retry)) failure.retryAfter = retry;
      throw failure;
    }
  }
  async models(signal) {
    const data = await this.request('/decisions/models', null, signal);
    if (!Array.isArray(data?.models) || !data.models.some(model => MODELS.includes(model.id))) {
      this.log.warning('AI Gateway decision model catalog is invalid', { category: 'ai_gateway_decisions' });
      fail('Gateway returned an invalid model catalog.', 502);
    }
    return { ...data, models: data.models.filter(model => MODELS.includes(model.id)) };
  }
  async evaluate(raw, principalId, { signal } = {}) {
    if (!principalId) fail('Login required.', 403);
    const id = String(principalId);
    const now = this.now();
    for (const [key, entry] of this.rates) if (entry.until <= now) this.rates.delete(key);
    const rate = this.rates.get(id) || { count: 0, until: now + 60000 };
    if (this.active.has(id) || this.active.size >= 2 || rate.count >= 6 || this.rates.size >= 1000) fail('Decision request limit reached. Wait before retrying.', 429);
    rate.count += 1; this.rates.set(id, rate); this.active.add(id);
    try {
      const payload = await buildPayload(raw);
      if (signal?.aborted) fail('Decision request cancelled.', 499);
      const result = await this.request('/decisions', payload, signal);
      if (result?.model !== payload.model || !Array.isArray(result.answers) || result.answers.length !== payload.questions.length
        || result.answers.some((answer, index) => !answer || ![payload.questions[index].type, 'refusal'].includes(answer.type))) {
        this.log.warning('AI Gateway decision response contract failed', { category: 'ai_gateway_decisions' });
        fail('Gateway returned an invalid decision response.', 502);
      }
      return result;
    } finally { this.active.delete(id); }
  }
}
const service = new DecisionsService();
module.exports = { DecisionsService, DecisionError, buildPayload, validateQuestion, object, MODELS, MAX_BODY, TIMEOUT, service };
