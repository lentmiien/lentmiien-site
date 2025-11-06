// controllers/image_gen.controller.js
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const ApiDebugLog = require('../models/api_debug_log');

const { Prompt, BulkJob, BulkTestPrompt } = require('../database');

// CHANGE THESE two lines to match your ComfyUI API box
const COMFY_API_BASE = process.env.COMFY_API_BASE; // your personal ComfyUI API base
const COMFY_API_KEY  = process.env.COMFY_API_KEY;
const DEFAULT_TIMEOUT = 15000;

const TMP_DIR = path.join(__dirname, '../tmp_data');
const CACHE_CONFIG = {
  input: { dir: path.join(__dirname, '../public/imgen'), prefix: '/imgen' },
  output: { dir: path.join(__dirname, '../public/imgen'), prefix: '/imgen' },
  video: { dir: path.join(__dirname, '../public/video'), prefix: '/video' }
};
const CACHE_DEFAULT_BUCKET = 'output';
const CACHE_CONCURRENCY = 5;
const IMAGE_INPUT_KEYS = ['image', 'image2', 'image3'];
const JS_FILE_NAME = 'controllers/image_gen.controller.js';

// Track in-flight downloads to avoid duplicate fetches
const inFlightDownloads = new Map(); // `${bucket}:${safeName}` -> Promise

// In-memory maps to tie a queued job to the prompt records used
const jobPromptMap = new Map(); // jobId -> { posId: ObjectId|null, negId: ObjectId|null }
const ratedJobs = new Set();    // jobIds already rated (prevents double rating)
const MAP_TTL_MS = 24 * 60 * 60 * 1000; // drop job mappings after 24h

// Ensure tmp/cache dirs exist
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
for (const cfg of Object.values(CACHE_CONFIG)) {
  if (cfg && cfg.dir && !fs.existsSync(cfg.dir)) {
    fs.mkdirSync(cfg.dir, { recursive: true });
  }
}

function toSerializable(payload) {
  if (payload === undefined || payload === null) return null;
  if (payload instanceof Buffer) {
    return {
      type: 'Buffer',
      encoding: 'base64',
      data: payload.toString('base64')
    };
  }
  if (payload instanceof Error) {
    return {
      name: payload.name,
      message: payload.message,
      stack: payload.stack
    };
  }
  if (payload instanceof Date) {
    return payload.toISOString();
  }
  if (Array.isArray(payload)) {
    return payload.map(item => toSerializable(item));
  }
  if (typeof payload === 'object') {
    try {
      return JSON.parse(JSON.stringify(payload));
    } catch (err) {
      if (typeof payload.toString === 'function') {
        return payload.toString();
      }
      return {
        error: 'Failed to serialize payload',
        message: err.message
      };
    }
  }
  return payload;
}

function headersToObject(headers) {
  if (!headers || typeof headers.forEach !== 'function') return null;
  const result = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return Object.keys(result).length > 0 ? result : null;
}

async function recordApiDebugLog({
  requestUrl,
  requestHeaders = null,
  requestBody = null,
  responseHeaders = null,
  responseBody = null,
  functionName
}) {
  try {
    await ApiDebugLog.create({
      requestUrl,
      requestHeaders: toSerializable(requestHeaders),
      requestBody: toSerializable(requestBody),
      responseHeaders: toSerializable(responseHeaders),
      responseBody: toSerializable(responseBody),
      jsFileName: JS_FILE_NAME,
      functionName
    });
  } catch (logError) {
    logger.error('[API debug] failed to record log', {
      requestUrl,
      functionName,
      message: logError && logError.message ? logError.message : logError
    });
  }
}

// Small helpers
function apiHeaders(extra = {}) {
  return Object.assign({ 'x-api-key': COMFY_API_KEY }, extra);
}
function errorJson(res, status, message, details) {
  return res.status(status).json({ error: message, details });
}

function normalizeInstanceId(raw) {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  return str ? str : null;
}

const BULK_INSTANCE_DEFAULT = '__default__';

function toInstanceKey(instanceId) {
  return normalizeInstanceId(instanceId) || BULK_INSTANCE_DEFAULT;
}

function fromInstanceKey(key) {
  return key === BULK_INSTANCE_DEFAULT ? null : key;
}

function applyInstanceFilter(filter, instanceId) {
  const normalized = normalizeInstanceId(instanceId);
  if (!normalized) {
    filter.$or = [
      { instance_id: { $exists: false } },
      { instance_id: null },
      { instance_id: '' }
    ];
  } else {
    filter.instance_id = normalized;
  }
  return filter;
}

function extractInstanceId(req) {
  if (!req) return null;
  // Accept both snake_case and camelCase for convenience
  return normalizeInstanceId(
    (req.body && (req.body.instance_id ?? req.body.instanceId)) ??
    (req.query && (req.query.instance_id ?? req.query.instanceId))
  );
}

function buildComfyUrl(pathname, { instanceId, query } = {}) {
  const base = COMFY_API_BASE || '';
  if (!base) throw new Error('COMFY_API_BASE is not configured');
  const url = new URL(pathname, base.endsWith('/') ? base : `${base}/`);
  if (instanceId) {
    url.searchParams.set('instance_id', instanceId);
  }
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function toSafeName(name) {
  const str = String(name || '').trim();
  if (!str) return null;
  const base = path.basename(str);
  if (!base || base === '.' || base === '..') return null;
  return base;
}

function getCacheConfig(bucketHint, mediaType) {
  if (bucketHint && CACHE_CONFIG[bucketHint]) return CACHE_CONFIG[bucketHint];
  if (mediaType === 'video') return CACHE_CONFIG.video;
  return CACHE_CONFIG[CACHE_DEFAULT_BUCKET];
}

function buildCacheRecord(name, { bucket, mediaType, instanceId } = {}) {
  const safeName = toSafeName(name);
  if (!safeName) return null;
  const cfg = getCacheConfig(bucket, mediaType);
  if (!cfg) return null;
  const subDir = instanceId ? path.join(cfg.dir, instanceId) : cfg.dir;
  const urlPrefix = instanceId ? `${cfg.prefix}/${encodeURIComponent(instanceId)}` : cfg.prefix;
  const localPath = path.join(subDir, safeName);
  const url = `${urlPrefix}/${encodeURIComponent(safeName)}`;
  return { safeName, localPath, url, bucket: bucket || null, instanceId: instanceId || null };
}

async function writeCacheFile(name, buffer, { bucket, mediaType, instanceId } = {}) {
  const rec = buildCacheRecord(name, { bucket, mediaType, instanceId });
  if (!rec) return null;
  await fsp.mkdir(path.dirname(rec.localPath), { recursive: true });
  await fsp.writeFile(rec.localPath, buffer);
  return rec;
}

async function ensureCached(bucket, name, mediaType, instanceId) {
  const rec = buildCacheRecord(name, { bucket, mediaType, instanceId });
  if (!rec) return null;

  try {
    await fsp.access(rec.localPath, fs.constants.R_OK);
    return rec;
  } catch (_) {
    // continue to download
  }

  const effectiveBucket = bucket || (mediaType === 'video' ? 'video' : CACHE_DEFAULT_BUCKET);
  const keyParts = [effectiveBucket, rec.safeName];
  if (instanceId) keyParts.push(instanceId);
  const key = keyParts.join(':');
  if (!inFlightDownloads.has(key)) {
    const promise = (async () => {
      try {
        const functionName = 'ensureCached';
        const remoteUrl = buildComfyUrl(`/v1/files/${effectiveBucket}/${encodeURIComponent(name)}`, { instanceId });
        const requestHeaders = apiHeaders();
        const fetchOptions = { headers: requestHeaders, signal: AbortSignal.timeout(DEFAULT_TIMEOUT) };
        let logged = false;
        try {
          const r = await fetch(remoteUrl, fetchOptions);
          const responseHeaders = headersToObject(r.headers);
          if (!r.ok) {
            const txt = await r.text().catch(() => '');
            await recordApiDebugLog({
              requestUrl: remoteUrl,
              requestHeaders,
              requestBody: null,
              responseHeaders,
              responseBody: { status: r.status, body: txt },
              functionName
            });
            logged = true;
            throw new Error(`upstream ${r.status} ${txt}`.trim());
          }
          const buf = Buffer.from(await r.arrayBuffer());
          await recordApiDebugLog({
            requestUrl: remoteUrl,
            requestHeaders,
            requestBody: null,
            responseHeaders,
            responseBody: buf,
            functionName
          });
          await fsp.mkdir(path.dirname(rec.localPath), { recursive: true });
          await fsp.writeFile(rec.localPath, buf);
          return rec;
        } catch (fetchError) {
          if (!logged) {
            await recordApiDebugLog({
              requestUrl: remoteUrl,
              requestHeaders,
              requestBody: null,
              responseHeaders: null,
              responseBody: fetchError,
              functionName
            });
          }
          throw fetchError;
        }
      } finally {
        inFlightDownloads.delete(key);
      }
    })();
    inFlightDownloads.set(key, promise);
  }

  try {
    return await inFlightDownloads.get(key);
  } catch (err) {
    logger.warn(`[ensureCached] failed for ${bucket}/${name}: ${err && err.message ? err.message : err}`);
    return null;
  }
}

async function resolveCachedRecord(bucket, name, instanceId) {
  const mediaType = detectMediaType(name);
  const rec = await ensureCached(bucket, name, mediaType, instanceId);
  if (rec) return rec;
  const candidates = [];
  candidates.push(buildCacheRecord(name, { bucket, mediaType, instanceId }));
  if (instanceId) candidates.push(buildCacheRecord(name, { bucket, mediaType, instanceId: null }));
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await fsp.access(candidate.localPath, fs.constants.R_OK);
      return candidate;
    } catch (_) {
      continue;
    }
  }
  return null;
}

async function mapWithConcurrency(items, limit, iterator) {
  const results = new Array(items.length);
  let index = 0;
  const worker = async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await iterator(items[current], current);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function detectMediaType(name, fallback = 'image') {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (!ext) return fallback;
  if (['.mp4', '.mov', '.mkv', '.webm', '.m4v'].includes(ext)) return 'video';
  if (ext === '.gif') return 'gif';
  if (['.png', '.apng', '.jpg', '.jpeg', '.jfif', '.pjpeg', '.pjp', '.bmp', '.webp', '.tiff'].includes(ext)) return 'image';
  return fallback;
}

function detectMimeType(mediaType, name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (mediaType === 'video') {
    if (ext === '.webm') return 'video/webm';
    if (ext === '.mov') return 'video/quicktime';
    if (ext === '.m4v') return 'video/x-m4v';
    if (ext === '.mkv') return 'video/x-matroska';
    return 'video/mp4';
  }
  if (mediaType === 'gif' || ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.jfif' || ext === '.pjpeg' || ext === '.pjp') return 'image/jpeg';
  if (ext === '.bmp') return 'image/bmp';
  if (ext === '.tiff' || ext === '.tif') return 'image/tiff';
  return 'image/png';
}

function normalizeJobFiles(jobId, files, instanceId) {
  if (!Array.isArray(files)) return [];
  return files.map((entry, index) => {
    const base = typeof entry === 'string' ? { filename: entry } : Object.assign({}, entry);
    const rawName = base.filename || base.name || base.file || base.file_name || `file_${index}`;
    const safeName = toSafeName(rawName) || `file_${index}`;
    const mediaType = base.media_type || detectMediaType(safeName);
    const bucket = base.bucket || (mediaType === 'video' ? 'video' : 'output');
    const cacheRec = buildCacheRecord(safeName, { bucket, mediaType, instanceId });
    const cachedUrl = cacheRec ? cacheRec.url : null;
    const query = new URLSearchParams();
    query.set('filename', safeName);
    if (bucket) query.set('bucket', bucket);
    if (mediaType) query.set('mediaType', mediaType);
    if (instanceId) query.set('instance_id', instanceId);
    const localUrl = `/image_gen/api/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(index)}?${query.toString()}`;
    return Object.assign({}, base, {
      index,
      filename: safeName,
      bucket,
      media_type: mediaType,
      cached_url: cachedUrl,
      remote_url: base.download_url || base.url || base.path || null,
      download_url: localUrl,
      instance_id: base.instance_id || instanceId || null
    });
  });
}

const BULK_PROMPT_STATUSES = Object.freeze(['Pending', 'Processing', 'Paused', 'Completed', 'Canceled']);
const BULK_WORKER_INTERVAL_MS = 4000;
const BULK_JOB_POLL_DELAY_MS = 5000;
const BULK_JOB_POLL_LIMIT = 400;
const BULK_DOWNLOAD_TIMEOUT_MS = 60000;
const GALLERY_BATCH_RATING_VALUES = Object.freeze({
  bad: 0,
  neutral: 0.5,
  good: 1
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractPlaceholders(template) {
  const keys = new Set();
  const regex = /{{\s*([\w.-]+)\s*}}/g;
  let match;
  const text = String(template || '');
  while ((match = regex.exec(text)) !== null) {
    keys.add(match[1]);
  }
  return Array.from(keys);
}

function ensureConsistentPlaceholders(templates) {
  if (!Array.isArray(templates) || !templates.length) return [];
  const baseKeys = extractPlaceholders(templates[0].template);
  const baseSet = new Set(baseKeys);
  for (let i = 1; i < templates.length; i++) {
    const keys = extractPlaceholders(templates[i].template);
    if (keys.length !== baseSet.size) return null;
    for (const key of keys) {
      if (!baseSet.has(key)) return null;
    }
  }
  return baseKeys;
}

function computeAvailableVariables(job) {
  const vars = [];
  const templates = Array.isArray(job?.prompt_templates) ? job.prompt_templates : [];
  if (templates.length > 1) vars.push('template');
  const placeholders = Array.isArray(job?.placeholder_values) ? job.placeholder_values : [];
  for (const entry of placeholders) {
    if (!entry || !entry.key) continue;
    const values = Array.isArray(entry.values) ? entry.values : [];
    if (values.length > 1) vars.push(`placeholder:${entry.key}`);
  }
  const imageInputs = Array.isArray(job?.image_inputs) ? job.image_inputs : [];
  for (const entry of imageInputs) {
    if (!entry || !entry.key) continue;
    const values = Array.isArray(entry.values) ? entry.values : [];
    if (values.length > 1) vars.push(`input:${entry.key}`);
  }
  if (job?.negative_prompt) vars.push('negative');
  return vars;
}

function generatePlaceholderCombinations(defs) {
  if (!Array.isArray(defs) || defs.length === 0) return [{}];
  const combos = [];
  const walk = (index, acc) => {
    if (index >= defs.length) {
      combos.push(Object.assign({}, acc));
      return;
    }
    const entry = defs[index];
    if (!entry || !entry.key) {
      walk(index + 1, acc);
      return;
    }
    const values = Array.isArray(entry.values) && entry.values.length ? entry.values : [''];
    for (const value of values) {
      acc[entry.key] = value;
      walk(index + 1, acc);
    }
    delete acc[entry.key];
  };
  walk(0, {});
  return combos;
}

function generateVariantCombinations(placeholderDefs, imageDefs) {
  const placeholderCombos = generatePlaceholderCombinations(placeholderDefs);
  const imageEntries = Array.isArray(imageDefs)
    ? imageDefs.filter((entry) => entry && entry.key)
    : [];
  if (!imageEntries.length) {
    return placeholderCombos.map((placeholders) => ({
      placeholders: Object.assign({}, placeholders),
      inputs: {}
    }));
  }
  const combos = [];
  for (const placeholderSet of placeholderCombos) {
    const placeholderCopy = Object.assign({}, placeholderSet);
    const walk = (index, inputAcc) => {
      if (index >= imageEntries.length) {
        combos.push({
          placeholders: Object.assign({}, placeholderCopy),
          inputs: Object.assign({}, inputAcc)
        });
        return;
      }
      const entry = imageEntries[index];
      const values = Array.isArray(entry.values) && entry.values.length ? entry.values : [''];
      for (const value of values) {
        inputAcc[entry.key] = value;
        walk(index + 1, inputAcc);
      }
      delete inputAcc[entry.key];
    };
    walk(0, {});
  }
  return combos;
}

function applyTemplateValues(template, values) {
  const text = String(template || '');
  return text.replace(/{{\s*([\w.-]+)\s*}}/g, (_m, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      const val = values[key];
      return val === undefined || val === null ? '' : String(val);
    }
    return '';
  });
}

function buildVariablesObject(job, templateLabel, placeholderValues, negativeUsed, inputValues = {}) {
  const vars = {};
  const templates = Array.isArray(job?.prompt_templates) ? job.prompt_templates : [];
  if (templates.length > 1) vars.template = templateLabel;
  const placeholders = Array.isArray(job?.placeholder_values) ? job.placeholder_values : [];
  for (const entry of placeholders) {
    if (!entry || !entry.key) continue;
    if (Object.prototype.hasOwnProperty.call(placeholderValues, entry.key)) {
      vars[`placeholder:${entry.key}`] = String(placeholderValues[entry.key]);
    }
  }
  const imageInputs = Array.isArray(job?.image_inputs) ? job.image_inputs : [];
  for (const entry of imageInputs) {
    if (!entry || !entry.key) continue;
    if (Object.prototype.hasOwnProperty.call(inputValues, entry.key)) {
      vars[`input:${entry.key}`] = String(inputValues[entry.key]);
    }
  }
  if (job?.negative_prompt) {
    vars.negative = negativeUsed ? 'With negative' : 'No negative';
  }
  return vars;
}

function toPlainVariables(variables) {
  if (!variables) return {};
  if (variables instanceof Map) return Object.fromEntries(variables.entries());
  if (typeof variables.toObject === 'function') return variables.toObject();
  if (typeof variables === 'object') {
    return Object.assign({}, variables);
  }
  return {};
}

function parseGalleryFilters(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (err) {
      logger.warn('[parseGalleryFilters] failed to parse filters JSON', err);
    }
    return {};
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.assign({}, raw);
  }
  return {};
}

async function seedBulkTestPrompts(jobDoc) {
  const job = jobDoc?.toObject ? jobDoc.toObject() : jobDoc;
  if (!job || !job._id) return 0;
  const templates = Array.isArray(job.prompt_templates) ? job.prompt_templates : [];
  if (!templates.length) return 0;
  const combos = generateVariantCombinations(job.placeholder_values || [], job.image_inputs || []);
  const negVariants = job.negative_prompt ? [false, true] : [false];
  const docs = [];
  templates.forEach((tpl, index) => {
    const label = tpl?.label?.trim() || `Prompt ${index + 1}`;
    for (const combo of combos) {
      const placeholderCopy = Object.assign({}, combo?.placeholders || {});
      const inputCopy = Object.assign({}, combo?.inputs || {});
      for (const negativeUsed of negVariants) {
        const placeholderValues = Object.assign({}, placeholderCopy);
        const inputValues = Object.assign({}, inputCopy);
        const promptText = applyTemplateValues(tpl.template, placeholderValues);
        docs.push({
          job: job._id,
          template_index: index,
          template_label: label,
          prompt_text: promptText,
          placeholder_values: placeholderValues,
          input_values: inputValues,
          negative_used: negativeUsed,
          variables: buildVariablesObject(job, label, placeholderValues, negativeUsed, inputValues),
          status: 'Pending',
          instance_id: normalizeInstanceId(job.instance_id) || null
        });
      }
    }
  });
  if (!docs.length) return 0;
  await BulkTestPrompt.insertMany(docs);
  return docs.length;
}

async function refreshJobCounters(jobId) {
  const job = await BulkJob.findById(jobId);
  if (!job) return null;
  const statusCounts = await BulkTestPrompt.aggregate([
    { $match: { job: job._id } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);
  const counters = {
    total: 0,
    pending: 0,
    processing: 0,
    paused: 0,
    completed: 0,
    canceled: 0
  };
  let total = 0;
  for (const entry of statusCounts) {
    total += entry.count || 0;
    const key = entry._id;
    if (key && typeof key === 'string') {
      const lower = key.toLowerCase();
      if (lower === 'pending') counters.pending = entry.count;
      if (lower === 'processing') counters.processing = entry.count;
      if (lower === 'paused') counters.paused = entry.count;
      if (lower === 'completed') counters.completed = entry.count;
      if (lower === 'canceled') counters.canceled = entry.count;
    }
  }
  counters.total = total;
  const progressNumerator = counters.completed + counters.canceled;
  const progress = counters.total > 0 ? progressNumerator / counters.total : 0;
  const updates = {
    counters,
    progress,
    variables_available: computeAvailableVariables(job)
  };
  const unfinished = (counters.pending || 0) + (counters.processing || 0) + (counters.paused || 0);
  const allDone = counters.total > 0 && unfinished === 0;
  if (allDone && job.status !== 'Canceled') {
    updates.status = 'Completed';
    if (!job.completed_at) updates.completed_at = new Date();
  }
  await BulkJob.updateOne({ _id: job._id }, { $set: updates });
  return Object.assign(job.toObject(), updates);
}

async function computeBulkInstanceQueues() {
  const rows = await BulkTestPrompt.aggregate([
    { $match: { status: { $in: ['Pending', 'Processing'] } } },
    {
      $group: {
        _id: { instance: '$instance_id', status: '$status' },
        count: { $sum: 1 }
      }
    }
  ]);
  const map = new Map();
  for (const row of rows) {
    const instance = normalizeInstanceId(row?._id?.instance);
    const key = toInstanceKey(instance);
    const status = String(row?._id?.status || '').toLowerCase();
    const entry = map.get(key) || { pending: 0, processing: 0, total: 0 };
    const count = row?.count || 0;
    if (status === 'pending') entry.pending += count;
    if (status === 'processing') entry.processing += count;
    entry.total += count;
    map.set(key, entry);
  }
  return map;
}

function toObjectId(id) {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  if (mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
  return null;
}

const bulkWorkerState = {
  scheduling: false,
  running: new Map(),
  reschedule: false
};

async function waitForComfyJob(jobId, instanceId) {
  for (let attempt = 0; attempt < BULK_JOB_POLL_LIMIT; attempt++) {
    const functionName = 'waitForComfyJob';
    const url = buildComfyUrl(`/v1/jobs/${encodeURIComponent(jobId)}`, { instanceId });
    const requestHeaders = apiHeaders();
    const fetchOptions = { headers: requestHeaders };
    let responseHeaders = null;
    try {
      const r = await fetch(url, fetchOptions);
      responseHeaders = headersToObject(r.headers);
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        await recordApiDebugLog({
          requestUrl: url,
          requestHeaders,
          requestBody: null,
          responseHeaders,
          responseBody: { status: r.status, body: txt, attempt },
          functionName
        });
        logged = true;
        throw new Error(`job status ${r.status} ${txt}`.trim());
      }
      const json = await r.json();
      await recordApiDebugLog({
        requestUrl: url,
        requestHeaders,
        requestBody: null,
        responseHeaders,
        responseBody: { attempt, data: json },
        functionName
      });
      const status = json?.status;
      if (status === 'completed' || status === 'failed' || status === 'canceled') {
        return json;
      }
      await delay(BULK_JOB_POLL_DELAY_MS);
    } catch (err) {
      if (!logged) {
        await recordApiDebugLog({
          requestUrl: url,
          requestHeaders,
          requestBody: null,
          responseHeaders,
          responseBody: err,
          functionName
        });
      }
      throw err;
    }
  }
  throw new Error('upstream job timeout');
}

async function downloadComfyOutputs(jobId, files, fallbackPrefix, instanceId) {
  const stored = [];
  const list = Array.isArray(files) ? files : [];
  for (let i = 0; i < list.length; i++) {
    const meta = list[i];
    const original = typeof meta === 'string'
      ? meta
      : (meta?.filename || meta?.name || meta?.file || meta?.path || null);
    const fallback = `${fallbackPrefix}_${i}.png`;
    const safeName = toSafeName(original) || toSafeName(fallback) || `bulk_${jobId}_${i}.png`;
    const mediaType = meta?.media_type || detectMediaType(original || fallback);
    const bucket = meta?.bucket || (mediaType === 'video' ? 'video' : 'output');
    const url = buildComfyUrl(`/v1/jobs/${encodeURIComponent(jobId)}/images/${i}`, { instanceId });
    const functionName = 'downloadComfyOutputs';
    const requestHeaders = apiHeaders();
    const fetchOptions = {
      headers: requestHeaders,
      signal: AbortSignal.timeout(BULK_DOWNLOAD_TIMEOUT_MS)
    };
    let responseHeaders = null;
    let logged = false;
    try {
      const r = await fetch(url, fetchOptions);
      responseHeaders = headersToObject(r.headers);
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        await recordApiDebugLog({
          requestUrl: url,
          requestHeaders,
          requestBody: null,
          responseHeaders,
          responseBody: { status: r.status, body: txt, imageIndex: i },
          functionName
        });
        logged = true;
        throw new Error(`image download ${r.status} ${txt}`.trim());
      }
      const buf = Buffer.from(await r.arrayBuffer());
      await recordApiDebugLog({
        requestUrl: url,
        requestHeaders,
        requestBody: null,
        responseHeaders,
        responseBody: { imageIndex: i, mediaType, size: buf.length, data: buf },
        functionName
      });
      const rec = await writeCacheFile(safeName, buf, { bucket, mediaType, instanceId });
      stored.push({
        safeName,
        bucket,
        mediaType,
        instanceId: instanceId || null,
        url: rec?.url || null
      });
    } catch (err) {
      if (!logged) {
        await recordApiDebugLog({
          requestUrl: url,
          requestHeaders,
          requestBody: null,
          responseHeaders,
          responseBody: err,
          functionName
        });
      }
      throw err;
    }
  }
  return stored;
}

async function processBulkPrompt(job, prompt) {
  try {
    const inputs = Object.assign({}, job.base_inputs || {});
    delete inputs.instance_id;
    delete inputs.instanceId;
    inputs.prompt = prompt.prompt_text;
    if (job.negative_prompt) {
      inputs.negative = prompt.negative_used ? job.negative_prompt : '';
    } else {
      delete inputs.negative;
    }
    if (prompt.input_values && typeof prompt.input_values === 'object') {
      for (const [key, value] of Object.entries(prompt.input_values)) {
        if (!key) continue;
        const str = String(value ?? '').trim();
        if (str) inputs[key] = str;
      }
    }

    const instanceId = normalizeInstanceId(prompt.instance_id ?? job.instance_id);
    const payload = { workflow: job.workflow, inputs };
    if (instanceId) payload.instance_id = instanceId;

    const functionName = 'processBulkPrompt';
    const requestUrl = buildComfyUrl('/v1/generate');
    const requestHeaders = apiHeaders({ 'Content-Type': 'application/json' });
    const fetchOptions = {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(payload)
    };
    let responseHeaders = null;
    let logged = false;
    const queuedResp = await fetch(requestUrl, fetchOptions).catch(async (err) => {
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: payload,
        responseHeaders: null,
        responseBody: err,
        functionName
      });
      throw err;
    });
    responseHeaders = headersToObject(queuedResp.headers);
    if (!queuedResp.ok) {
      const txt = await queuedResp.text().catch(() => '');
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: payload,
        responseHeaders,
        responseBody: { status: queuedResp.status, body: txt },
        functionName
      });
      throw new Error(`queue failed ${queuedResp.status} ${txt}`.trim());
    }
    let queued = null;
    let parsedText = null;
    try {
      queued = await queuedResp.json();
    } catch (_) {
      parsedText = await queuedResp.text().catch(() => '');
    }
    await recordApiDebugLog({
      requestUrl,
      requestHeaders,
      requestBody: payload,
      responseHeaders,
      responseBody: queued ?? parsedText,
      functionName
    });
    const comfyJobId = queued?.job_id;
    if (!comfyJobId) throw new Error('missing job id from ComfyUI');

    await BulkTestPrompt.updateOne(
      { _id: prompt._id },
      { $set: { comfy_job_id: comfyJobId, instance_id: instanceId || null } }
    );

    const result = await waitForComfyJob(comfyJobId, instanceId);
    if (result?.status !== 'completed') {
      const errMsg = result?.error || 'upstream generation failed';
      throw new Error(errMsg);
    }
    const stored = await downloadComfyOutputs(comfyJobId, result.files, `bulk_${prompt._id}`, instanceId);
    const primary = stored[0] || null;
    await BulkTestPrompt.updateOne(
      { _id: prompt._id },
      {
        $set: {
          status: 'Completed',
          completed_at: new Date(),
          filename: primary?.safeName || null,
          file_url: primary?.url || null,
          comfy_error: null,
          instance_id: instanceId || null
        }
      }
    );
  } catch (err) {
    logger.error('[bulkWorker] prompt processing failed', err);
    await BulkTestPrompt.updateOne(
      { _id: prompt._id },
      {
        $set: {
          status: 'Canceled',
          comfy_error: String(err?.message || err),
          completed_at: new Date(),
          instance_id: normalizeInstanceId(prompt.instance_id ?? job.instance_id) || null
        }
      }
    );
  } finally {
    await refreshJobCounters(job._id);
  }
}

async function claimPromptForInstance(instanceId) {
  const jobs = await BulkJob.find(applyInstanceFilter({ status: 'Processing' }, instanceId)).sort({ updated_at: 1 });
  if (!jobs.length) return null;
  for (const job of jobs) {
    const prompt = await BulkTestPrompt.findOneAndUpdate(
      { job: job._id, status: 'Pending' },
      { $set: { status: 'Processing', started_at: new Date() } },
      { sort: { created_at: 1 }, new: true }
    );
    if (!prompt) {
      await refreshJobCounters(job._id);
      continue;
    }
    const jobInstance = normalizeInstanceId(job.instance_id);
    const promptInstance = normalizeInstanceId(prompt.instance_id ?? jobInstance);
    const workerInstance = normalizeInstanceId(instanceId);
    if (!normalizeInstanceId(prompt.instance_id) && promptInstance) {
      await BulkTestPrompt.updateOne(
        { _id: prompt._id },
        { $set: { instance_id: promptInstance } }
      );
      prompt.instance_id = promptInstance;
    }
    if (promptInstance !== workerInstance) {
      await BulkTestPrompt.updateOne(
        { _id: prompt._id },
        {
          $set: {
            status: 'Pending',
            instance_id: promptInstance || null
          },
          $unset: { started_at: 1 }
        }
      );
      wakeBulkWorker();
      continue;
    }
    if (job.status !== 'Processing') {
      await BulkTestPrompt.updateOne(
        { _id: prompt._id },
        { $set: { status: 'Pending' }, $unset: { started_at: 1 } }
      );
      await refreshJobCounters(job._id);
      continue;
    }
    if (!job.started_at) {
      await BulkJob.updateOne(
        { _id: job._id, started_at: { $exists: false } },
        { $set: { started_at: new Date() } }
      );
    }
    return { job, prompt };
  }
  return null;
}

async function runInstanceWorker(instanceKey) {
  if (bulkWorkerState.running.has(instanceKey)) return bulkWorkerState.running.get(instanceKey);
  const worker = (async () => {
    const instanceId = fromInstanceKey(instanceKey);
    try {
      while (true) {
        const work = await claimPromptForInstance(instanceId);
        if (!work) break;
        if (work.skip) continue;
        await processBulkPrompt(work.job, work.prompt);
      }
    } catch (err) {
      logger.error(`[bulkWorker] instance ${instanceKey} error`, err);
    } finally {
      bulkWorkerState.running.delete(instanceKey);
    }
  })();
  bulkWorkerState.running.set(instanceKey, worker);
  return worker;
}

async function collectActiveInstanceKeys() {
  const keys = new Set();
  const jobInstances = await BulkJob.distinct('instance_id', { status: 'Processing' });
  for (const id of jobInstances) keys.add(toInstanceKey(id));
  const promptInstances = await BulkTestPrompt.distinct('instance_id', { status: { $in: ['Pending', 'Processing'] } });
  for (const id of promptInstances) keys.add(toInstanceKey(id));
  return keys;
}

function scheduleBulkWorkers() {
  if (bulkWorkerState.scheduling) {
    bulkWorkerState.reschedule = true;
    return;
  }
  bulkWorkerState.scheduling = true;
  bulkWorkerState.reschedule = false;
  Promise.resolve().then(async () => {
    try {
      const instanceKeys = await collectActiveInstanceKeys();
      for (const key of instanceKeys) {
        if (!bulkWorkerState.running.has(key)) {
          runInstanceWorker(key).catch((err) => {
            logger.error(`[bulkWorker] runner ${key} error`, err);
          });
        }
      }
    } catch (err) {
      logger.error('[bulkWorker] schedule error', err);
    } finally {
      bulkWorkerState.scheduling = false;
      if (bulkWorkerState.reschedule) {
        scheduleBulkWorkers();
      }
    }
  });
}

function wakeBulkWorker() {
  const timer = setTimeout(() => {
    scheduleBulkWorkers();
  }, 25);
  timer.unref?.();
}

setInterval(() => {
  scheduleBulkWorkers();
}, BULK_WORKER_INTERVAL_MS).unref?.();


// Helper to ensure an unrated use is recorded (create-or-increment)
async function touchPromptUse({ type, workflow, text }) {
  const promptText = (text || '').trim();
  if (!promptText) return null; // ignore empty negatives

  const now = new Date();
  const filter = { type, workflow, prompt: promptText };

  // IMPORTANT: Do not include `unrated_uses` in $setOnInsert to avoid path conflict with $inc
  const update = {
    $setOnInsert: {
      total_score: 0,
      rating_count: 0,
      created_at: now
    },
    $set: { last_used_at: now },
    $inc: { unrated_uses: 1 }
  };

  const opts = {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true // ensures defaults (like unrated_uses: 0) apply on insert before $inc
  };

  const doc = await Prompt.findOneAndUpdate(filter, update, opts).lean();
  return doc;
}

// Landing page
exports.renderLanding = (req, res) => {
  res.render('image_gen/index', {
    title: 'ComfyUI – Image Generation',
  });
};

exports.renderBulkLanding = (req, res) => {
  res.render('image_gen/bulk_index', {
    title: 'ComfyUI  EBulk Jobs',
  });
};

exports.renderBulkCreate = (req, res) => {
  res.render('image_gen/bulk_create', {
    title: 'ComfyUI  ENew Bulk Job',
  });
};

exports.renderBulkJob = (req, res) => {
  res.render('image_gen/bulk_job', {
    title: 'ComfyUI  EBulk Job Detail',
    jobId: req.params.id,
  });
};

exports.renderBulkScoring = (req, res) => {
  res.render('image_gen/bulk_scoring', {
    title: 'ComfyUI  EBulk Scoring',
    jobId: req.params.id,
  });
};

exports.listBulkJobs = async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 100)));
    const jobs = await BulkJob.find({})
      .sort({ created_at: -1 })
      .limit(limit)
      .lean();
    const items = jobs.map((job) => ({
      id: String(job._id),
      name: job.name,
      status: job.status,
      progress: job.progress || 0,
      workflow: job.workflow,
      instance_id: job.instance_id || null,
      counters: Object.assign({
        total: 0,
        pending: 0,
        processing: 0,
        paused: 0,
        completed: 0,
        canceled: 0
      }, job.counters || {}),
      variables: job.variables_available || [],
      created_at: job.created_at,
      updated_at: job.updated_at,
      started_at: job.started_at,
      completed_at: job.completed_at
    }));
    res.json({ items });
  } catch (e) {
    logger.error('[listBulkJobs] error', e);
    return errorJson(res, 500, 'failed to list bulk jobs', String(e.message || e));
  }
};

exports.createBulkJob = async (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const workflow = String(body.workflow || '').trim();
    const instanceId = normalizeInstanceId(body.instance_id ?? body.instanceId);
    if (!name) return errorJson(res, 400, 'name required');
    if (!workflow) return errorJson(res, 400, 'workflow required');

    const templatesInput = Array.isArray(body.templates) ? body.templates : [];
    const templates = templatesInput.map((tpl, idx) => {
      const rawLabel = tpl && typeof tpl.label === 'string' ? tpl.label : `Prompt ${idx + 1}`;
      const rawTemplate = tpl && typeof tpl.template === 'string' ? tpl.template : '';
      const label = rawLabel.trim() || `Prompt ${idx + 1}`;
      const template = rawTemplate.trim();
      return { label, template };
    }).filter(tpl => tpl.template);
    if (!templates.length) return errorJson(res, 400, 'at least one prompt template required');

    const placeholderKeys = ensureConsistentPlaceholders(templates);
    if (placeholderKeys === null) {
      return errorJson(res, 400, 'all templates must use the same placeholder keys');
    }

    const placeholderValuesSource = body.placeholderValues || {};
    const placeholderValues = [];
    for (const key of placeholderKeys) {
      const raw = placeholderValuesSource[key];
      let values = [];
      if (Array.isArray(raw)) {
        values = raw;
      } else if (typeof raw === 'string') {
        values = raw.split(/\r?\n/);
      }
      const cleaned = values.map(v => String(v || '').trim()).filter(Boolean);
      if (!cleaned.length) {
        return errorJson(res, 400, `placeholder "${key}" requires at least one value`);
      }
      placeholderValues.push({ key, values: cleaned });
    }

    const imageInputsSource = (body.imageInputs && typeof body.imageInputs === 'object')
      ? body.imageInputs
      : {};
    const imageInputs = [];
    for (const key of IMAGE_INPUT_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(imageInputsSource, key)) continue;
      const raw = imageInputsSource[key];
      let values = [];
      if (Array.isArray(raw)) {
        values = raw;
      } else if (typeof raw === 'string') {
        values = raw.split(/\r?\n/);
      }
      const cleaned = values.map(v => String(v || '').trim()).filter(Boolean);
      if (!cleaned.length) {
        return errorJson(res, 400, `image input "${key}" requires at least one filename`);
      }
      imageInputs.push({ key, values: cleaned });
    }

    const negativePrompt = typeof body.negativePrompt === 'string'
      ? body.negativePrompt.trim()
      : '';

    const baseInputsRaw = body.baseInputs;
    const baseInputs = (baseInputsRaw && typeof baseInputsRaw === 'object' && !Array.isArray(baseInputsRaw))
      ? Object.assign({}, baseInputsRaw)
      : {};
    delete baseInputs.prompt;
    delete baseInputs.negative;
    delete baseInputs.instance_id;
    delete baseInputs.instanceId;

    const jobData = {
      name,
      workflow,
      prompt_templates: templates,
      placeholder_keys: placeholderKeys,
      placeholder_values: placeholderValues,
      image_inputs: imageInputs,
      negative_prompt: negativePrompt || null,
      base_inputs: baseInputs,
      instance_id: instanceId || null,
      status: 'Created',
      counters: {
        total: 0,
        pending: 0,
        processing: 0,
        paused: 0,
        completed: 0,
        canceled: 0
      },
      progress: 0,
      variables_available: computeAvailableVariables({
        prompt_templates: templates,
        placeholder_values: placeholderValues,
        image_inputs: imageInputs,
        negative_prompt: negativePrompt || null
      })
    };

    const job = await BulkJob.create(jobData);
    const totalPrompts = await seedBulkTestPrompts(job);
    const refreshed = await refreshJobCounters(job._id);

    res.status(201).json({
      id: String(job._id),
      name: job.name,
      total_prompts: totalPrompts,
      counters: refreshed?.counters || jobData.counters,
      status: refreshed?.status || job.status,
      instance_id: job.instance_id || instanceId || null,
    });
  } catch (e) {
    logger.error('[createBulkJob] error', e);
    return errorJson(res, 500, 'failed to create bulk job', String(e.message || e));
  }
};

exports.getBulkJob = async (req, res) => {
  try {
    const jobId = toObjectId(req.params.id);
    if (!jobId) return errorJson(res, 400, 'invalid job id');
    const job = await BulkJob.findById(jobId).lean();
    if (!job) return errorJson(res, 404, 'bulk job not found');

    const scoreAgg = await BulkTestPrompt.aggregate([
      { $match: { job: jobId, score_count: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          total: { $sum: '$score_total' },
          count: { $sum: '$score_count' }
        }
      }
    ]);
    const scoreTotal = scoreAgg[0]?.total || 0;
    const scoreCount = scoreAgg[0]?.count || 0;

    res.json({
      job: Object.assign({}, job, {
        id: String(job._id),
        counters: Object.assign({
          total: 0,
          pending: 0,
          processing: 0,
          paused: 0,
          completed: 0,
          canceled: 0
        }, job.counters || {}),
        variables_available: computeAvailableVariables(job),
        instance_id: job.instance_id || null
      }),
      score: {
        total: scoreTotal,
        count: scoreCount,
        average: scoreCount > 0 ? scoreTotal / scoreCount : 0
      }
    });
  } catch (e) {
    logger.error('[getBulkJob] error', e);
    return errorJson(res, 500, 'failed to load bulk job', String(e.message || e));
  }
};

exports.updateBulkJobStatus = async (req, res) => {
  try {
    const jobId = toObjectId(req.params.id);
    if (!jobId) return errorJson(res, 400, 'invalid job id');
    const action = String(req.body?.action || '').trim().toLowerCase();
    const allowed = ['start', 'pause', 'resume', 'cancel', 'redo_canceled', 'set_instance'];
    if (!allowed.includes(action)) return errorJson(res, 400, 'invalid action');

    const job = await BulkJob.findById(jobId);
    if (!job) return errorJson(res, 404, 'bulk job not found');

    const updates = { updated_at: new Date() };
    let shouldWake = false;
    const requestBody = req.body || {};
    const hasInstanceField = Object.prototype.hasOwnProperty.call(requestBody, 'instance_id')
      || Object.prototype.hasOwnProperty.call(requestBody, 'instanceId');
    const requestedInstance = hasInstanceField
      ? normalizeInstanceId(requestBody.instance_id ?? requestBody.instanceId)
      : undefined;

    if (action === 'set_instance') {
      if (!hasInstanceField) return errorJson(res, 400, 'instance_id required');
      const newInstanceId = requestedInstance || null;
      updates.instance_id = newInstanceId;
      await BulkTestPrompt.updateMany(
        { job: jobId, status: { $in: ['Pending', 'Paused'] } },
        { $set: { instance_id: newInstanceId } }
      );
      await BulkJob.updateOne({ _id: jobId }, { $set: updates });
      const refreshed = await refreshJobCounters(jobId);
      if (job.status === 'Processing') wakeBulkWorker();
      return res.json({ job: refreshed || (await BulkJob.findById(jobId).lean()) });
    }

    if (action === 'start' || action === 'resume') {
      if (job.status === 'Completed') return errorJson(res, 409, 'job already completed');
      if (job.status === 'Canceled') return errorJson(res, 409, 'job canceled');
      updates.status = 'Processing';
      if (!job.started_at) updates.started_at = new Date();
      await BulkTestPrompt.updateMany(
        { job: jobId, status: 'Paused' },
        { $set: { status: 'Pending' } }
      );
      shouldWake = true;
    } else if (action === 'pause') {
      if (job.status === 'Completed') return errorJson(res, 409, 'job already completed');
      if (job.status === 'Canceled') return errorJson(res, 409, 'job canceled');
      updates.status = 'Paused';
      await BulkTestPrompt.updateMany(
        { job: jobId, status: 'Pending' },
        { $set: { status: 'Paused' } }
      );
    } else if (action === 'cancel') {
      if (job.status === 'Canceled') {
        return res.json({ job: job.toObject() });
      }
      updates.status = 'Canceled';
      updates.completed_at = new Date();
      await BulkTestPrompt.updateMany(
        { job: jobId, status: { $nin: ['Completed', 'Canceled'] } },
        {
          $set: {
            status: 'Canceled',
            comfy_error: 'Canceled by user',
            completed_at: new Date()
          }
        }
      );
    } else if (action === 'redo_canceled') {
      const resetResult = await BulkTestPrompt.updateMany(
        { job: jobId, status: 'Canceled' },
        {
          $set: {
            status: 'Pending',
            comfy_error: null,
            comfy_job_id: null,
            filename: null,
            file_url: null,
            instance_id: job.instance_id || null,
            score_total: 0,
            score_count: 0
          },
          $unset: {
            started_at: 1,
            completed_at: 1
          }
        }
      );
      if (!resetResult.modifiedCount) {
        const refreshed = await refreshJobCounters(jobId);
        return res.json({ job: refreshed || job.toObject() });
      }
      updates.completed_at = null;
      if (job.status === 'Canceled' || job.status === 'Completed') {
        updates.status = 'Processing';
        shouldWake = true;
      } else if (job.status === 'Processing') {
        shouldWake = true;
      }
    }
    await BulkJob.updateOne({ _id: jobId }, { $set: updates });
    const refreshed = await refreshJobCounters(jobId);
    if (shouldWake) wakeBulkWorker();
    res.json({ job: refreshed || (await BulkJob.findById(jobId).lean()) });
  } catch (e) {
    logger.error('[updateBulkJobStatus] error', e);
    return errorJson(res, 500, 'failed to update job status', String(e.message || e));
  }
};

exports.listBulkTestPrompts = async (req, res) => {
  try {
    const jobId = toObjectId(req.params.id);
    if (!jobId) return errorJson(res, 400, 'invalid job id');
    const filter = { job: jobId };
    const status = String(req.query.status || '').trim();
    if (status) {
      if (!BULK_PROMPT_STATUSES.includes(status)) {
        return errorJson(res, 400, 'invalid status filter');
      }
      filter.status = status;
    }
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
    const prompts = await BulkTestPrompt.find(filter)
      .sort({ created_at: 1 })
      .limit(limit)
      .lean();
    const items = prompts.map((doc) => ({
      id: String(doc._id),
      status: doc.status,
      template_index: doc.template_index,
      template_label: doc.template_label,
      prompt_text: doc.prompt_text,
      placeholder_values: doc.placeholder_values || {},
      input_values: doc.input_values || {},
      negative_used: doc.negative_used,
      filename: doc.filename,
      file_url: doc.file_url,
      comfy_job_id: doc.comfy_job_id,
      comfy_error: doc.comfy_error,
      score_total: doc.score_total || 0,
      score_count: doc.score_count || 0,
      variables: toPlainVariables(doc.variables),
      instance_id: doc.instance_id || null,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
      started_at: doc.started_at,
      completed_at: doc.completed_at
    }));
    res.json({ items });
  } catch (e) {
    logger.error('[listBulkTestPrompts] error', e);
    return errorJson(res, 500, 'failed to list test prompts', String(e.message || e));
  }
};

exports.getBulkMatrix = async (req, res) => {
  try {
    const jobId = toObjectId(req.params.id);
    if (!jobId) return errorJson(res, 400, 'invalid job id');
    const job = await BulkJob.findById(jobId).lean();
    if (!job) return errorJson(res, 404, 'bulk job not found');

    const availableVars = new Set(computeAvailableVariables(job));
    const varA = String(req.query.varA || '').trim() || (job.variables_available?.[0] || '');
    const varB = String(req.query.varB || '').trim() || (job.variables_available?.[1] || '');
    if (!availableVars.has(varA) || !availableVars.has(varB) || varA === varB) {
      return errorJson(res, 400, 'invalid variable selection');
    }

    const prompts = await BulkTestPrompt.find({ job: jobId, status: 'Completed' }).lean();
    const rowValues = new Set();
    const colValues = new Set();
    const matrix = new Map();

    const valueFor = (doc, key) => {
      const vars = toPlainVariables(doc.variables);
    if (vars && Object.prototype.hasOwnProperty.call(vars, key)) return vars[key];
    if (key === 'template') return doc.template_label;
    if (key === 'negative') return doc.negative_used ? 'With negative' : 'No negative';
    if (key.startsWith('placeholder:')) {
      const placeholderKey = key.slice('placeholder:'.length);
      return doc.placeholder_values?.[placeholderKey] || '';
    }
    if (key.startsWith('input:')) {
      const inputKey = key.slice('input:'.length);
      return doc.input_values?.[inputKey] || '';
    }
    return '';
  };

    for (const doc of prompts) {
      const rowKey = valueFor(doc, varA);
      const colKey = valueFor(doc, varB);
      rowValues.add(rowKey);
      colValues.add(colKey);
      const mapKey = `${rowKey}||${colKey}`;
      if (!matrix.has(mapKey)) matrix.set(mapKey, []);
      matrix.get(mapKey).push(doc);
    }

    const rows = Array.from(rowValues);
    const cols = Array.from(colValues);
    const data = rows.map((rowKey) => {
      return {
        value: rowKey,
        columns: cols.map((colKey) => {
          const docs = matrix.get(`${rowKey}||${colKey}`) || [];
          const mapped = docs.map((doc) => {
            const avg = (doc.score_count || 0) > 0 ? doc.score_total / doc.score_count : 0;
            const mediaType = detectMediaType(doc.filename);
            const bucket = mediaType === 'video' ? 'video' : 'output';
            const instanceId = doc.instance_id || job.instance_id || null;
            const cacheRec = doc.filename ? buildCacheRecord(doc.filename, { bucket, mediaType, instanceId }) : null;
            const downloadUrl = doc.filename
              ? `/image_gen/api/files/${bucket}/${encodeURIComponent(doc.filename)}${instanceId ? `?instance_id=${encodeURIComponent(instanceId)}` : ''}`
              : null;
            return {
              id: String(doc._id),
              filename: doc.filename,
              file_url: doc.file_url,
              media_type: mediaType,
              download_url: downloadUrl,
              cached_url: cacheRec ? cacheRec.url : null,
              instance_id: instanceId,
              score_average: avg,
              score_count: doc.score_count || 0,
              comfy_job_id: doc.comfy_job_id,
              completed_at: doc.completed_at
            };
          });
          const avgScore = mapped.length
            ? mapped.reduce((sum, item) => sum + item.score_average, 0) / mapped.length
            : 0;
          return {
            value: colKey,
            prompts: mapped,
            average_score: avgScore
          };
        })
      };
    });

    res.json({
      varA,
      varB,
      rows,
      cols,
      data
    });
  } catch (e) {
    logger.error('[getBulkMatrix] error', e);
    return errorJson(res, 500, 'failed to build comparison matrix', String(e.message || e));
  }
};

exports.listBulkGalleryImages = async (req, res) => {
  try {
    const jobId = toObjectId(req.params.id);
    if (!jobId) return errorJson(res, 400, 'invalid job id');
    const job = await BulkJob.findById(jobId).lean();
    if (!job) return errorJson(res, 404, 'bulk job not found');

    const filters = parseGalleryFilters(req.query.filters);
    const normalizedFilters = {};
    const match = {
      job: jobId,
      status: 'Completed',
      filename: { $ne: null }
    };

    for (const [rawKey, rawValue] of Object.entries(filters || {})) {
      const key = String(rawKey || '').trim();
      const value = String(rawValue ?? '').trim();
      if (!key || !value) continue;
      normalizedFilters[key] = value;
      if (key === 'template') {
        match.template_label = value;
      } else if (key === 'negative') {
        if (value.toLowerCase() === 'with negative') {
          match.negative_used = true;
        } else if (value.toLowerCase() === 'no negative') {
          match.negative_used = false;
        } else if (value) {
          const lower = value.toLowerCase();
          match.negative_used = lower === 'true' || lower === '1';
        }
      } else if (key.startsWith('placeholder:')) {
        const placeholderKey = key.slice('placeholder:'.length);
        if (placeholderKey) {
          match[`placeholder_values.${placeholderKey}`] = value;
        }
      } else if (key.startsWith('input:')) {
        const inputKey = key.slice('input:'.length);
        if (inputKey) {
          match[`input_values.${inputKey}`] = value;
        }
      } else {
        match[`variables.${key}`] = value;
      }
    }

    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 25)));
    const fetchLimit = Math.min(500, Math.max(limit * 4, limit + 20));

    const pipeline = [
      { $match: match },
      {
        $addFields: {
          score_average: {
            $cond: [
              { $gt: ['$score_count', 0] },
              { $divide: ['$score_total', '$score_count'] },
              0
            ]
          }
        }
      },
      {
        $facet: {
          items: [
            { $sort: { score_average: -1, score_count: -1, updated_at: -1, _id: 1 } },
            { $limit: fetchLimit }
          ],
          total: [
            { $count: 'value' }
          ]
        }
      }
    ];

    const [result = {}] = await BulkTestPrompt.aggregate(pipeline);
    const docs = Array.isArray(result.items) ? result.items : [];
    const totalMatches = Array.isArray(result.total) && result.total.length
      ? Number(result.total[0].value) || 0
      : 0;

    const groups = new Map();
    const averages = [];
    docs.forEach((doc) => {
      const avg = Number(doc.score_average) || 0;
      const key = avg.toFixed(6);
      if (!groups.has(key)) {
        groups.set(key, []);
        averages.push({ key, avg });
      }
      groups.get(key).push(doc);
    });
    averages.sort((a, b) => b.avg - a.avg);

    const shuffleInPlace = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    };

    const selectedDocs = [];
    for (const { key } of averages) {
      const group = groups.get(key) || [];
      if (group.length > 1) shuffleInPlace(group);
      for (const doc of group) {
        if (selectedDocs.length >= limit) break;
        selectedDocs.push(doc);
      }
      if (selectedDocs.length >= limit) break;
    }

    const items = selectedDocs.map((doc) => {
      const mediaType = detectMediaType(doc.filename);
      const bucket = mediaType === 'video' ? 'video' : 'output';
      const instanceId = doc.instance_id || job.instance_id || null;
      const cacheRec = doc.filename ? buildCacheRecord(doc.filename, { bucket, mediaType, instanceId }) : null;
      const downloadUrl = doc.filename
        ? `/image_gen/api/files/${bucket}/${encodeURIComponent(doc.filename)}${instanceId ? `?instance_id=${encodeURIComponent(instanceId)}` : ''}`
        : null;
      const scoreTotal = Number(doc.score_total || 0);
      const scoreCount = Number(doc.score_count || 0);
      const scoreAverage = Number.isFinite(doc.score_average) ? Number(doc.score_average) : 0;
      return {
        id: String(doc._id),
        filename: doc.filename,
        media_type: mediaType,
        cached_url: cacheRec ? cacheRec.url : null,
        download_url: downloadUrl,
        instance_id: instanceId,
        score_total: scoreTotal,
        score_count: scoreCount,
        score_average: scoreAverage,
        template_label: doc.template_label,
        placeholder_values: doc.placeholder_values || {},
        input_values: doc.input_values || {},
        variables: toPlainVariables(doc.variables),
        negative_used: !!doc.negative_used,
        completed_at: doc.completed_at
      };
    });

    res.json({
      filters: normalizedFilters,
      limit,
      total: totalMatches,
      returned: items.length,
      instance_id: job.instance_id || null,
      items
    });
  } catch (e) {
    logger.error('[listBulkGalleryImages] error', e);
    return errorJson(res, 500, 'failed to load gallery images', String(e.message || e));
  }
};

exports.submitBulkGalleryRating = async (req, res) => {
  try {
    const jobId = toObjectId(req.params.id);
    if (!jobId) return errorJson(res, 400, 'invalid job id');
    const jobExists = await BulkJob.exists({ _id: jobId });
    if (!jobExists) return errorJson(res, 404, 'bulk job not found');

    const ratingKey = String(req.body?.rating || '').trim().toLowerCase();
    const ratingValue = GALLERY_BATCH_RATING_VALUES[ratingKey];
    if (ratingValue === undefined) {
      return errorJson(res, 400, 'rating must be one of: good, neutral, bad');
    }

    const rawIds = Array.isArray(req.body?.prompt_ids) ? req.body.prompt_ids : [];
    if (!rawIds.length) return errorJson(res, 400, 'prompt_ids required');
    const dedupedIds = [];
    const seen = new Set();
    rawIds.forEach((raw) => {
      const objId = toObjectId(raw);
      if (!objId) return;
      const key = String(objId);
      if (seen.has(key)) return;
      seen.add(key);
      dedupedIds.push(objId);
    });
    if (!dedupedIds.length) return errorJson(res, 400, 'no valid prompt ids provided');

    const update = await BulkTestPrompt.updateMany(
      {
        _id: { $in: dedupedIds },
        job: jobId,
        status: 'Completed',
        filename: { $ne: null }
      },
      {
        $inc: {
          score_total: ratingValue,
          score_count: 1
        }
      }
    );

    res.json({
      ok: true,
      rating: ratingKey,
      rating_value: ratingValue,
      matched: update.matchedCount || 0,
      modified: update.modifiedCount || 0
    });
  } catch (e) {
    logger.error('[submitBulkGalleryRating] error', e);
    return errorJson(res, 500, 'failed to apply gallery rating', String(e.message || e));
  }
};

exports.getBulkScorePair = async (req, res) => {
  try {
    const jobId = toObjectId(req.params.id);
    if (!jobId) return errorJson(res, 400, 'invalid job id');
    const job = await BulkJob.findById(jobId).lean();
    if (!job) return errorJson(res, 404, 'bulk job not found');
    const docs = await BulkTestPrompt.aggregate([
      { $match: { job: jobId, status: 'Completed', filename: { $ne: null } } },
      { $sample: { size: 2 } }
    ]);
    if (docs.length < 2) return errorJson(res, 404, 'not enough completed images to score');
    const pair = docs.map((doc) => {
      const mediaType = detectMediaType(doc.filename);
      const bucket = mediaType === 'video' ? 'video' : 'output';
      const instanceId = doc.instance_id || job.instance_id || null;
    const cacheRec = doc.filename ? buildCacheRecord(doc.filename, { bucket, mediaType, instanceId }) : null;
    const downloadUrl = doc.filename
      ? `/image_gen/api/files/${bucket}/${encodeURIComponent(doc.filename)}${instanceId ? `?instance_id=${encodeURIComponent(instanceId)}` : ''}`
      : null;
    return {
      id: String(doc._id),
      filename: doc.filename,
      file_url: doc.file_url,
      media_type: mediaType,
      download_url: downloadUrl,
      cached_url: cacheRec ? cacheRec.url : null,
      instance_id: instanceId,
      template_label: doc.template_label,
      negative_used: doc.negative_used,
      variables: toPlainVariables(doc.variables),
      score_average: (doc.score_count || 0) > 0 ? doc.score_total / doc.score_count : 0,
      score_count: doc.score_count || 0
      };
    });
    res.json({ pair });
  } catch (e) {
    logger.error('[getBulkScorePair] error', e);
    return errorJson(res, 500, 'failed to select scoring pair', String(e.message || e));
  }
};

exports.submitBulkScore = async (req, res) => {
  try {
    const jobId = toObjectId(req.params.id);
    if (!jobId) return errorJson(res, 400, 'invalid job id');
    const leftId = toObjectId(req.body?.left_id);
    const rightId = toObjectId(req.body?.right_id);
    const winner = String(req.body?.winner || '').trim().toLowerCase();
    if (!leftId || !rightId) return errorJson(res, 400, 'invalid prompt ids');
    if (!['left', 'right', 'tie'].includes(winner)) return errorJson(res, 400, 'invalid winner');

    const prompts = await BulkTestPrompt.find({ _id: { $in: [leftId, rightId] }, job: jobId }).lean();
    if (prompts.length !== 2) return errorJson(res, 404, 'prompts not found for job');

    const leftInc = { score_count: 1, score_total: 0 };
    const rightInc = { score_count: 1, score_total: 0 };
    if (winner === 'left') {
      leftInc.score_total = 1;
    } else if (winner === 'right') {
      rightInc.score_total = 1;
    } else {
      leftInc.score_total = 0.5;
      rightInc.score_total = 0.5;
    }

    await Promise.all([
      BulkTestPrompt.updateOne({ _id: leftId }, { $inc: leftInc }),
      BulkTestPrompt.updateOne({ _id: rightId }, { $inc: rightInc })
    ]);

    res.json({ ok: true });
  } catch (e) {
    logger.error('[submitBulkScore] error', e);
    return errorJson(res, 500, 'failed to record score', String(e.message || e));
  }
};

// Proxy: list workflows
exports.listInstances = async (_req, res) => {
  const functionName = 'listInstances';
  const requestHeaders = apiHeaders();
  let requestUrl = null;
  try {
    requestUrl = buildComfyUrl('/v1/instances');
    const fetchOptions = { headers: requestHeaders };
    const r = await fetch(requestUrl, fetchOptions);
    const responseHeaders = headersToObject(r.headers);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: null,
        responseHeaders,
        responseBody: { status: r.status, body: txt },
        functionName
      });
      return errorJson(res, r.status, 'upstream error', txt);
    }
    let responseBody = null;
    try {
      responseBody = await r.json();
    } catch (_) {
      responseBody = await r.text().catch(() => '');
    }
    await recordApiDebugLog({
      requestUrl,
      requestHeaders,
      requestBody: null,
      responseHeaders,
      responseBody,
      functionName
    });
    let payload = responseBody;
    try {
      const queueMap = await computeBulkInstanceQueues();
      if (payload && typeof payload === 'object') {
        const queueObject = {};
        for (const [key, summary] of queueMap.entries()) {
          queueObject[key] = summary;
        }
        payload = Object.assign({}, payload);
        payload.bulk_queue = queueObject;
        if (Array.isArray(payload.instances)) {
          payload.instances = payload.instances.map((inst) => {
            if (!inst || typeof inst !== 'object') return inst;
            const normalizedId = normalizeInstanceId(inst.id);
            const summary = queueMap.get(toInstanceKey(normalizedId)) || { pending: 0, processing: 0, total: 0 };
            return Object.assign({}, inst, { bulk_queue: summary });
          });
        }
        if (queueMap.has(BULK_INSTANCE_DEFAULT)) {
          const hasDefault = Array.isArray(payload.instances) && payload.instances.some((inst) => normalizeInstanceId(inst?.id) === null);
          if (!hasDefault) {
            const summary = queueMap.get(BULK_INSTANCE_DEFAULT);
            const list = Array.isArray(payload.instances) ? payload.instances.slice() : [];
            list.push({
              id: null,
              name: 'Default',
              bulk_queue: summary
            });
            payload.instances = list;
          }
        }
      }
    } catch (mergeErr) {
      logger.error('[listInstances] queue merge error', mergeErr);
    }
    res.json(payload);
  } catch (e) {
    await recordApiDebugLog({
      requestUrl,
      requestHeaders,
      requestBody: null,
      responseHeaders: null,
      responseBody: e,
      functionName
    });
    return errorJson(res, 502, 'failed to list instances', String(e.message || e));
  }
};

exports.getWorkflows = async (req, res) => {
  const functionName = 'getWorkflows';
  const requestHeaders = apiHeaders();
  let requestUrl = null;
  try {
    const instanceId = extractInstanceId(req);
    requestUrl = buildComfyUrl('/v1/workflows', { instanceId });
    const r = await fetch(requestUrl, { headers: requestHeaders });
    const responseHeaders = headersToObject(r.headers);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: null,
        responseHeaders,
        responseBody: { status: r.status, body: txt, instanceId },
        functionName
      });
      return errorJson(res, r.status, 'upstream error', txt);
    }
    let responseBody = null;
    try {
      responseBody = await r.json();
    } catch (_) {
      responseBody = await r.text().catch(() => '');
    }
    await recordApiDebugLog({
      requestUrl,
      requestHeaders,
      requestBody: null,
      responseHeaders,
      responseBody,
      functionName
    });
    res.json(responseBody);
  } catch (e) {
    await recordApiDebugLog({
      requestUrl,
      requestHeaders,
      requestBody: null,
      responseHeaders: null,
      responseBody: e,
      functionName: 'getWorkflows'
    });
    return errorJson(res, 502, 'failed to reach ComfyUI API', String(e.message || e));
  }
};

// Proxy: generate
exports.generate = async (req, res) => {
  const functionName = 'generate';
  const requestHeaders = apiHeaders({ 'Content-Type': 'application/json' });
  let requestUrl = null;
  let responseHeaders = null;
  let payload = null;
  let queued = null;
  let loggedError = false;
  try {
    const body = req.body || {};
    const workflow = String(body.workflow || '').trim();
    const rawInputs = body.inputs;
    if (!workflow) return errorJson(res, 400, 'workflow required');
    if (!rawInputs || typeof rawInputs !== 'object' || Array.isArray(rawInputs)) {
      return errorJson(res, 400, 'inputs required');
    }
    const instanceId = extractInstanceId(req);
    const inputs = Object.assign({}, rawInputs);
    delete inputs.instance_id;
    delete inputs.instanceId;

    payload = { workflow, inputs };
    if (instanceId) payload.instance_id = instanceId;

    requestUrl = buildComfyUrl('/v1/generate');
    const r = await fetch(requestUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(payload)
    });
    responseHeaders = headersToObject(r.headers);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: payload,
        responseHeaders,
        responseBody: { status: r.status, body: txt, instanceId },
        functionName
      });
      loggedError = true;
      return errorJson(res, r.status, 'upstream error', txt);
    }
    try {
      queued = await r.json();
    } catch (parseError) {
      const txt = await r.text().catch(() => '');
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: payload,
        responseHeaders,
        responseBody: { parseError: parseError.message, body: txt, instanceId },
        functionName
      });
      loggedError = true;
      throw parseError;
    }
    await recordApiDebugLog({
      requestUrl,
      requestHeaders,
      requestBody: payload,
      responseHeaders,
      responseBody: queued,
      functionName
    });

    const posText = (inputs.prompt || '').trim();
    const negText = (inputs.negative || '').trim();
    const [posDoc, negDoc] = await Promise.all([
      posText ? touchPromptUse({ type: 'positive', workflow, text: posText }) : null,
      negText ? touchPromptUse({ type: 'negative', workflow, text: negText }) : null
    ]);

    if (queued?.job_id) {
      jobPromptMap.set(queued.job_id, {
        posId: posDoc ? posDoc._id : null,
        negId: negDoc ? negDoc._id : null
      });
      setTimeout(() => jobPromptMap.delete(queued.job_id), MAP_TTL_MS);
    }

    if (instanceId && !queued.instance_id) {
      queued.instance_id = instanceId;
    }

    return res.json(queued);
  } catch (e) {
    if (!loggedError) {
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: payload,
        responseHeaders,
        responseBody: e,
        functionName
      });
    }
    return errorJson(res, 502, 'failed to queue generation', String(e.message || e));
  }
};

// Proxy: job status
exports.getJob = async (req, res) => {
  const functionName = 'getJob';
  const requestHeaders = apiHeaders();
  let requestUrl = null;
  let responseHeaders = null;
  let loggedError = false;
  try {
    const jobId = encodeURIComponent(req.params.id);
    const instanceHint = extractInstanceId(req);
    requestUrl = buildComfyUrl(`/v1/jobs/${jobId}`, { instanceId: instanceHint });
    const r = await fetch(requestUrl, { headers: requestHeaders });
    responseHeaders = headersToObject(r.headers);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: null,
        responseHeaders,
        responseBody: { status: r.status, body: txt, jobId, instanceHint },
        functionName
      });
      loggedError = true;
      return errorJson(res, r.status, 'upstream error', txt);
    }
    let json = null;
    try {
      json = await r.json();
    } catch (parseError) {
      const txt = await r.text().catch(() => '');
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: null,
        responseHeaders,
        responseBody: { parseError: parseError.message, body: txt, jobId, instanceHint },
        functionName
      });
      loggedError = true;
      throw parseError;
    }
    const instanceId = json?.instance_id || instanceHint || null;
    if (json && Array.isArray(json.files)) {
      json.files = normalizeJobFiles(req.params.id, json.files, instanceId);
    } else {
      json.files = normalizeJobFiles(req.params.id, [], instanceId);
    }
    if (instanceId && !json.instance_id) {
      json.instance_id = instanceId;
    }
    await recordApiDebugLog({
      requestUrl,
      requestHeaders,
      requestBody: null,
      responseHeaders,
      responseBody: json,
      functionName
    });
    res.json(json);
  } catch (e) {
    if (!loggedError) {
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: null,
        responseHeaders,
        responseBody: e,
        functionName
      });
    }
    return errorJson(res, 502, 'failed to fetch job', String(e.message || e));
  }
};

// Proxy: stream job file (image or video)
exports.getJobFile = async (req, res) => {
  const functionName = 'getJobFile';
  const requestHeaders = apiHeaders();
  let requestUrl = null;
  let responseHeaders = null;
  let loggedError = false;
  try {
    const jobId = encodeURIComponent(req.params.id);
    const index = encodeURIComponent(req.params.index);
    const bucket = (req.query?.bucket || '').trim() || null;
    const fileName = req.query?.filename;
    const mediaType = (req.query?.mediaType || '').trim() || detectMediaType(fileName);
    const instanceId = normalizeInstanceId(req.query?.instance_id || req.query?.instanceId);
    requestUrl = buildComfyUrl(`/v1/jobs/${jobId}/files/${index}`, { instanceId });
    const r = await fetch(requestUrl, { headers: requestHeaders, signal: AbortSignal.timeout(DEFAULT_TIMEOUT) });
    responseHeaders = headersToObject(r.headers);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      logger.error('[getJobFile] upstream', r.status, txt);
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: null,
        responseHeaders,
        responseBody: { status: r.status, body: txt, jobId, index, bucket, instanceId },
        functionName
      });
      loggedError = true;
      return errorJson(res, r.status, 'upstream error', txt);
    }
    const ct = r.headers.get('content-type') || detectMimeType(mediaType, fileName);
    const ab = await r.arrayBuffer();
    const buf = Buffer.from(ab);
    if (fileName) {
      try {
        await writeCacheFile(fileName, buf, { bucket, mediaType, instanceId });
      } catch (err) {
        logger.warn('[getJobFile] failed to persist cache', err);
      }
    }
    await recordApiDebugLog({
      requestUrl,
      requestHeaders,
      requestBody: null,
      responseHeaders,
      responseBody: { jobId, index, bucket, mediaType, instanceId, contentType: ct, size: buf.length, fileName, data: buf },
      functionName
    });
    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.end(buf);
  } catch (e) {
    const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    logger.error('[getJobFile] error', e);
    if (!loggedError) {
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: null,
        responseHeaders,
        responseBody: e,
        functionName
      });
    }
    return errorJson(res, 502, isTimeout ? 'upstream timeout' : 'failed to stream file', String(e.message || e));
  }
};

// Back-compat alias for older clients hitting /images/:index
exports.getJobImage = exports.getJobFile;

// Proxy: list input/output
exports.listFiles = async (req, res) => {
  const bucket = req.params.bucket;
  if (!['input', 'output', 'video'].includes(bucket)) return errorJson(res, 400, 'bucket must be input, output, or video');
  const functionName = 'listFiles';
  const requestHeaders = apiHeaders();
  let requestUrl = null;
  let responseHeaders = null;
  let loggedError = false;
  try {
    const instanceId = extractInstanceId(req);
    requestUrl = buildComfyUrl(`/v1/files/${bucket}`, { instanceId });
    const r = await fetch(requestUrl, { headers: requestHeaders });
    responseHeaders = headersToObject(r.headers);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: null,
        responseHeaders,
        responseBody: { status: r.status, body: txt, bucket, instanceId },
        functionName
      });
      loggedError = true;
      return errorJson(res, r.status, 'upstream error', txt);
    }
    let remoteJson = null;
    try {
      remoteJson = await r.json();
    } catch (parseError) {
      const txt = await r.text().catch(() => '');
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: null,
        responseHeaders,
        responseBody: { parseError: parseError.message, body: txt, bucket, instanceId },
        functionName
      });
      loggedError = true;
      throw parseError;
    }
    const remoteFiles = Array.isArray(remoteJson?.files) ? remoteJson.files : [];

    const names = remoteFiles.map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        return item.filename || item.name || item.file || item.file_name || item.path || '';
      }
      return '';
    }).filter(Boolean);

    const cachedEntries = await mapWithConcurrency(names, CACHE_CONCURRENCY, async (original) => {
      const safeName = toSafeName(original);
      if (!safeName) {
        return { original, bucket, name: null, url: null, media_type: detectMediaType(original) };
      }
      const mediaType = detectMediaType(original);
      const cacheRecord = await resolveCachedRecord(bucket, original, instanceId);
      return {
        original,
        name: safeName,
        bucket,
        media_type: mediaType,
        url: cacheRecord ? cacheRecord.url : null,
        instance_id: instanceId || null
      };
    });

    const payload = Object.assign({}, remoteJson, {
      instance_id: remoteJson?.instance_id || instanceId || null,
      files: names,
      cached: cachedEntries
    });
    await recordApiDebugLog({
      requestUrl,
      requestHeaders,
      requestBody: null,
      responseHeaders,
      responseBody: payload,
      functionName
    });
    res.json(payload);
  } catch (e) {
    if (!loggedError) {
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: null,
        responseHeaders,
        responseBody: e,
        functionName
      });
    }
    return errorJson(res, 502, 'failed to list files', String(e.message || e));
  }
};

// Proxy: stream file by name
exports.getFile = async (req, res) => {
  const bucket = req.params.bucket;
  if (!['input', 'output', 'video'].includes(bucket)) return errorJson(res, 400, 'bucket must be input, output, or video');
  const name = req.params.filename;
  const functionName = 'getFile';
  let requestHeaders = null;
  let requestUrl = null;
  let responseHeaders = null;
  let loggedError = false;
  try {
    const instanceId = extractInstanceId(req);
    const cacheRecord = await resolveCachedRecord(bucket, name, instanceId);
    if (cacheRecord && cacheRecord.localPath) {
      res.setHeader('Content-Disposition', `inline; filename="${name.replace(/"/g, '')}"`);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.sendFile(cacheRecord.localPath, (err) => {
        if (err) {
          logger.error('[getFile] failed to send cached file', err);
          return res.status(500).end();
        }
      });
    }

    // Fallback to proxying directly if caching failed
    requestHeaders = apiHeaders();
    requestUrl = buildComfyUrl(`/v1/files/${bucket}/${encodeURIComponent(name)}`, { instanceId });
    const r = await fetch(requestUrl, { headers: requestHeaders, signal: AbortSignal.timeout(DEFAULT_TIMEOUT) });
    responseHeaders = headersToObject(r.headers);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      logger.error('[getFile] upstream', r.status, txt);
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: null,
        responseHeaders,
        responseBody: { status: r.status, body: txt, bucket, name, instanceId },
        functionName
      });
      loggedError = true;
      return errorJson(res, r.status, 'upstream error', txt);
    }
    const mediaType = detectMediaType(name);
    const ct = r.headers.get('content-type') || detectMimeType(mediaType, name);
    const ab = await r.arrayBuffer();
    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Disposition', `inline; filename="${name.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    const buf = Buffer.from(ab);
    try {
      await writeCacheFile(name, buf, { bucket, mediaType, instanceId });
    } catch (err) {
      logger.warn('[getFile] failed to persist fallback cache', err);
    }
    await recordApiDebugLog({
      requestUrl,
      requestHeaders,
      requestBody: null,
      responseHeaders,
      responseBody: { bucket, name, mediaType, instanceId, contentType: ct, size: buf.length, data: buf },
      functionName
    });
    res.end(buf);
  } catch (e) {
    const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    logger.error('[getFile] error', e);
    if (!loggedError) {
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: null,
        responseHeaders: null,
        responseBody: e,
        functionName
      });
    }
    return errorJson(res, 502, isTimeout ? 'upstream timeout' : 'failed to stream file', String(e.message || e));
  }
};

function guessImageMime(name) {
  return detectMimeType('image', name);
}

// POST /image_gen/api/files/promote
exports.promoteCachedFile = async (req, res) => {
  const functionName = 'promoteCachedFile';
  const requestHeaders = apiHeaders();
  let requestUrl = null;
  let responseHeaders = null;
  let loggedError = false;
  let requestBodyLog = null;
  try {
    const bucket = (req.body?.bucket || 'output').trim();
    const filename = req.body?.filename;
    const instanceId = normalizeInstanceId(req.body?.instance_id ?? req.body?.instanceId);
    if (!filename) return errorJson(res, 400, 'filename required');
    if (!['input', 'output'].includes(bucket)) return errorJson(res, 400, 'bucket must be input or output');
    const safeName = toSafeName(filename);
    if (!safeName) return errorJson(res, 400, 'invalid filename');
    const mediaType = detectMediaType(filename);
    if (mediaType !== 'image') {
      return errorJson(res, 400, 'only image files can be promoted to input');
    }

    const cacheRecord = await resolveCachedRecord(bucket, filename, instanceId);
    if (!cacheRecord || !cacheRecord.localPath) {
      return errorJson(res, 404, 'cached file not found');
    }

    requestUrl = buildComfyUrl('/v1/files/input');
    const buf = await fsp.readFile(cacheRecord.localPath);
    const mime = guessImageMime(safeName);
    const fd = new FormData();
    const blob = new Blob([buf], { type: mime });
    fd.append('image', blob, safeName);
    if (instanceId) fd.append('instance_id', instanceId);
    requestBodyLog = { bucket, filename: safeName, instanceId, mime, size: buf.length, data: buf };

    const r = await fetch(requestUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: fd
    });
    responseHeaders = headersToObject(r.headers);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: requestBodyLog,
        responseHeaders,
        responseBody: { status: r.status, body: txt },
        functionName
      });
      loggedError = true;
      return errorJson(res, r.status, 'upstream error', txt);
    }
    let json = {};
    try {
      json = await r.json();
    } catch (parseError) {
      const txt = await r.text().catch(() => '');
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: requestBodyLog,
        responseHeaders,
        responseBody: { parseError: parseError.message, body: txt },
        functionName
      });
      loggedError = true;
      throw parseError;
    }
    const savedName = json?.filename || json?.file || safeName;

    try {
      await writeCacheFile(savedName, buf, { bucket: 'input', mediaType: detectMediaType(savedName), instanceId });
    } catch (err) {
      logger.warn('[promoteCachedFile] failed to persist cache', err);
    }

    await recordApiDebugLog({
      requestUrl,
      requestHeaders,
      requestBody: requestBodyLog,
      responseHeaders,
      responseBody: { ok: true, filename: savedName, instance_id: instanceId || json?.instance_id || null, raw: json },
      functionName
    });

    res.json({ ok: true, filename: savedName, instance_id: instanceId || json?.instance_id || null });
  } catch (e) {
    logger.error('[promoteCachedFile] error', e);
    if (!loggedError) {
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: requestBodyLog,
        responseHeaders,
        responseBody: e,
        functionName
      });
    }
    return errorJson(res, 500, 'failed to promote cached file', String(e.message || e));
  }
};

// Upload to input/ (saves to tmp_data, forwards to Comfy API, then deletes temp)
exports.uploadInput = async (req, res) => {
  if (!req.file) return errorJson(res, 400, 'missing file "image"');
  const tmpPath = req.file.path;
  const fileName = req.file.originalname;
  const functionName = 'uploadInput';
  const requestHeaders = apiHeaders();
  let requestUrl = null;
  let responseHeaders = null;
  let loggedError = false;
  let requestBodyLog = null;
  try {
    const instanceId = extractInstanceId(req);
    const buf = await fsp.readFile(tmpPath);
    // Node 18+: FormData & Blob available globally
    const fd = new FormData();
    const blob = new Blob([buf], { type: req.file.mimetype || 'application/octet-stream' });
    fd.append('image', blob, fileName);
    if (instanceId) fd.append('instance_id', instanceId);
    requestBodyLog = {
      fileName,
      instanceId,
      mime: req.file.mimetype || 'application/octet-stream',
      size: buf.length,
      data: buf
    };
    requestUrl = buildComfyUrl('/v1/files/input');
    const r = await fetch(requestUrl, {
      method: 'POST',
      headers: requestHeaders, // do not set Content-Type; fetch will set the boundary
      body: fd
    });
    responseHeaders = headersToObject(r.headers);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: requestBodyLog,
        responseHeaders,
        responseBody: { status: r.status, body: txt },
        functionName
      });
      loggedError = true;
      return errorJson(res, r.status, 'upstream error', txt);
    }
    let json = {};
    try {
      json = await r.json();
    } catch (parseError) {
      const txt = await r.text().catch(() => '');
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: requestBodyLog,
        responseHeaders,
        responseBody: { parseError: parseError.message, body: txt },
        functionName
      });
      loggedError = true;
      throw parseError;
    }
    const savedName = json?.filename || json?.file || fileName;
    if (savedName) {
      try {
        await writeCacheFile(savedName, buf, { bucket: 'input', mediaType: detectMediaType(savedName), instanceId });
      } catch (err) {
        logger.warn('[uploadInput] failed to persist cache', err);
      }
    }
    if (instanceId && !json.instance_id) {
      json.instance_id = instanceId;
    }
    await recordApiDebugLog({
      requestUrl,
      requestHeaders,
      requestBody: requestBodyLog,
      responseHeaders,
      responseBody: json,
      functionName
    });
    res.json(json);
  } catch (e) {
    if (!loggedError) {
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: requestBodyLog,
        responseHeaders,
        responseBody: e,
        functionName
      });
    }
    return errorJson(res, 502, 'failed to upload to ComfyUI API', String(e.message || e));
  } finally {
    // best-effort cleanup
    try { await fsp.unlink(tmpPath); } catch {}
  }
};

// POST /image_gen/api/rate
exports.rateJob = async (req, res) => {
  try {
    const { job_id, rating } = req.body || {};
    if (!job_id || !rating) return errorJson(res, 400, 'job_id and rating required');

    if (ratedJobs.has(job_id)) {
      return errorJson(res, 409, 'job already rated');
    }
    const mapping = jobPromptMap.get(job_id);
    if (!mapping) {
      // Mapping may have expired (server restarted or TTL), you can decide to 404 or 410
      return errorJson(res, 410, 'rating window expired for this job');
    }

    const weights = { bad: 0, ok: 0.5, good: 0.8, great: 1 };
    const delta = weights[String(rating).toLowerCase()];
    if (delta === undefined) return errorJson(res, 400, 'invalid rating');

    const now = new Date();
    const updates = [];
    for (const id of [mapping.posId, mapping.negId]) {
      if (!id) continue;
      updates.push(
        Prompt.updateOne(
          { _id: id },
          {
            $inc: { total_score: delta, rating_count: 1, unrated_uses: -1 },
            $set: { last_used_at: now }
          }
        )
      );
    }
    await Promise.all(updates);

    ratedJobs.add(job_id);
    // cleanup later to keep memory tidy
    setTimeout(() => { ratedJobs.delete(job_id); jobPromptMap.delete(job_id); }, MAP_TTL_MS);

    return res.json({ ok: true });
  } catch (e) {
    logger.error('[rateJob] error', e);
    return errorJson(res, 500, 'failed to record rating', String(e.message || e));
  }
};

// GET /image_gen/api/prompts?workflow=...&type=positive|negative&show=all|default&limit=100
exports.listPrompts = async (req, res) => {
  try {
    const workflow = (req.query.workflow || '').trim();
    const type = (req.query.type || 'positive').trim();
    if (!workflow || !['positive','negative'].includes(type)) {
      return errorJson(res, 400, 'workflow and valid type (positive|negative) required');
    }
    const show = (req.query.show || 'default').trim(); // default hides low-use & low-avg
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));

    const docs = await Prompt.find(
      { workflow, type },
      { prompt: 1, total_score: 1, rating_count: 1, unrated_uses: 1, created_at: 1, last_used_at: 1 }
    ).lean();

    const items = [];
    for (const d of docs) {
      const uses = (d.rating_count || 0) + (d.unrated_uses || 0);
      const avg = (d.rating_count || 0) > 0 ? (d.total_score || 0) / d.rating_count : 0;
      // Default filter: hide entries with uses < 5 AND avg < 0.5
      if (show !== 'all') {
        if (uses < 5 && avg < 0.5) continue;
      }
      items.push({
        id: String(d._id),
        prompt: d.prompt,
        workflow,
        type,
        total_score: d.total_score || 0,
        rating_count: d.rating_count || 0,
        unrated_uses: d.unrated_uses || 0,
        uses,
        average: avg,
        created_at: d.created_at,
        last_used_at: d.last_used_at
      });
    }

    // Sort by average desc, then uses desc, then last_used_at desc
    items.sort((a, b) => (b.average - a.average) || (b.uses - a.uses) || (new Date(b.last_used_at) - new Date(a.last_used_at)));
    return res.json({ items: items.slice(0, limit) });
  } catch (e) {
    logger.error('[listPrompts] error', e);
    return errorJson(res, 500, 'failed to list prompts', String(e.message || e));
  }
};

// Simple health pass-through
exports.health = async (req, res) => {
  const functionName = 'health';
  let requestUrl = null;
  let responseHeaders = null;
  try {
    requestUrl = buildComfyUrl('/health');
    const r = await fetch(requestUrl);
    responseHeaders = headersToObject(r.headers);
    let payload = null;
    try {
      payload = await r.json();
    } catch {
      const text = await r.text().catch(() => '');
      payload = { ok: r.ok, message: text };
    }
    if (typeof payload !== 'object' || payload === null) {
      payload = { ok: r.ok };
    } else if (typeof payload.ok === 'undefined') {
      payload.ok = r.ok;
    }
    await recordApiDebugLog({
      requestUrl,
      requestHeaders: null,
      requestBody: null,
      responseHeaders,
      responseBody: payload,
      functionName
    });
    res.status(r.ok ? 200 : 502).json(payload);
  } catch (err) {
    await recordApiDebugLog({
      requestUrl,
      requestHeaders: null,
      requestBody: null,
      responseHeaders,
      responseBody: err,
      functionName
    });
    res.status(502).json({ ok: false, error: String(err?.message || err) });
  }
};
