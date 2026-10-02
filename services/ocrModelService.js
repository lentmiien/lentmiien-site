const axios = require('axios');
const logger = require('../utils/logger');

const API_BASE_URL = (process.env.OCR_API_BASE_URL || 'http://192.168.0.20:8080').replace(/\/+$/, '');
const DEFAULT_MODEL = 'hunyuanocr';
const DEFAULT_PROMPT = 'Detect and recognize text in the image, and output the text coordinates in a formatted manner.';
const integer = (defaultValue, minimum, maximum) => ({ type: 'integer', default: defaultValue, minimum, maximum });
const prompt = { type: 'string', default: null, max_length: 4096 };
const MODEL_DEFINITIONS = {
  hunyuanocr: { label: 'HunyuanOCR (default)', parameters: { prompt, max_new_tokens: integer(2048, 1, 8192) } },
  teleocr: { label: 'TeleOCR', parameters: {
    prompt,
    task: { type: 'string', default: 'text', enum: ['text', 'table', 'formula', 'code', 'layout', 'layout_distorted', 'scientific_figure'] },
    max_new_tokens: integer(4096, 1, 8192), max_pixels: integer(2007040, 3136, 4014080),
  } },
  'lightonocr-2': { label: 'LightOnOCR-2', parameters: { prompt, max_new_tokens: integer(2048, 1, 8192) } },
  'unlimited-ocr': { label: 'Unlimited OCR', parameters: {
    prompt, image_mode: { type: 'string', default: 'base', enum: ['base', 'gundam'] },
    max_length: integer(32768, 512, 32768), no_repeat_ngram_size: integer(35, 0, 128), ngram_window: integer(128, 0, 4096),
  } },
};
let cachedCatalog;
let cacheUntil = 0;
let pendingCatalog;

function normalizeCatalog(data) {
  if (!data?.models?.hunyuanocr) throw new Error('Invalid OCR model catalog');
  const models = {};
  for (const [id, definition] of Object.entries(MODEL_DEFINITIONS)) {
    const remote = data.models[id];
    if (!remote?.parameters) continue;
    const parameters = {};
    for (const [key, spec] of Object.entries(definition.parameters)) {
      if (!remote.parameters[key]) continue;
      parameters[key] = { ...spec, ...remote.parameters[key], type: spec.type };
      if (spec.minimum != null) parameters[key].minimum = Math.max(spec.minimum, remote.parameters[key].minimum ?? spec.minimum);
      if (spec.maximum != null) parameters[key].maximum = Math.min(spec.maximum, remote.parameters[key].maximum ?? spec.maximum);
      if (spec.max_length) parameters[key].max_length = Math.min(spec.max_length, remote.parameters[key].max_length ?? spec.max_length);
      if (spec.enum) parameters[key].enum = spec.enum.filter(value => !remote.parameters[key].enum || remote.parameters[key].enum.includes(value));
    }
    models[id] = { label: definition.label, parameters, warning: typeof remote.warning === 'string' ? remote.warning.slice(0, 1000) : null };
  }
  return { models, warning: null };
}

async function getCatalog() {
  if (Date.now() < cacheUntil && cachedCatalog) return cachedCatalog;
  if (pendingCatalog) return pendingCatalog;
  pendingCatalog = (async () => {
    try {
      const { data } = await axios.get(`${API_BASE_URL}/ocr/models`, { timeout: 3000, maxContentLength: 65536, maxRedirects: 0 });
      cachedCatalog = normalizeCatalog(data);
    } catch (error) {
      logger.warning('OCR model discovery unavailable; using cached catalog or Hunyuan defaults', {
        category: 'ocr', metadata: { code: error.code || 'INVALID_CATALOG', status: error.response?.status },
      });
      cachedCatalog = {
        models: cachedCatalog?.models || { hunyuanocr: MODEL_DEFINITIONS.hunyuanocr },
        warning: 'Model discovery is unavailable. Using the last known settings; HunyuanOCR remains the default.',
      };
    }
    cacheUntil = Date.now() + 60000;
    return cachedCatalog;
  })();
  try { return await pendingCatalog; } finally { pendingCatalog = null; }
}

function validateOptions(body, catalog) {
  const model = body.model === undefined || body.model === '' ? DEFAULT_MODEL : body.model;
  if (typeof model !== 'string' || !Object.hasOwn(catalog.models, model)) throw new Error('Select an available OCR model.');
  const options = {};
  const parameters = catalog.models[model].parameters;
  const allowed = new Set(['model', '_csrf', ...Object.keys(parameters)]);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new Error('Unsupported option for the selected OCR model.');
  for (const [key, spec] of Object.entries(parameters)) {
    let value = body[key];
    if (value !== undefined && typeof value !== 'string') throw new Error(`Invalid ${key}.`);
    value = value?.trim();
    if (!value) continue;
    if (spec.type === 'integer') {
      if (!/^\d+$/.test(value)) throw new Error(`${key} must be a whole number.`);
      value = Number(value);
      if (!Number.isSafeInteger(value) || value < spec.minimum || value > spec.maximum) throw new Error(`${key} must be between ${spec.minimum} and ${spec.maximum}.`);
    } else {
      if (value.length > (spec.max_length || 4096)) throw new Error(`${key} is too long.`);
      if (spec.enum && !spec.enum.includes(value)) throw new Error(`Invalid ${key}.`);
    }
    options[key] = value;
  }
  if (model === DEFAULT_MODEL) {
    options.prompt ||= DEFAULT_PROMPT;
    options.max_new_tokens ??= 2048;
  }
  const task = options.task ?? parameters.task?.default;
  const pixels = options.max_pixels ?? parameters.max_pixels?.default;
  if (model === 'teleocr' && ['layout', 'layout_distorted'].includes(task) && pixels < 1073296) {
    throw new Error('TeleOCR layout tasks require a pixel budget of at least 1073296.');
  }
  return { model, options };
}

module.exports = { API_BASE_URL, DEFAULT_MODEL, DEFAULT_PROMPT, MODEL_DEFINITIONS, getCatalog, validateOptions };
