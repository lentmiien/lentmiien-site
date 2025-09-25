// controllers/image_gen.controller.js
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const logger = require('../utils/logger');

const { Prompt } = require('../database');

// CHANGE THESE two lines to match your ComfyUI API box
const COMFY_API_BASE = process.env.COMFY_API_BASE; // your personal ComfyUI API base
const COMFY_API_KEY  = process.env.COMFY_API_KEY;
const DEFAULT_TIMEOUT = 15000;

const TMP_DIR = path.join(__dirname, '../tmp_data');

// In-memory maps to tie a queued job to the prompt records used
const jobPromptMap = new Map(); // jobId -> { posId: ObjectId|null, negId: ObjectId|null }
const ratedJobs = new Set();    // jobIds already rated (prevents double rating)
const MAP_TTL_MS = 24 * 60 * 60 * 1000; // drop job mappings after 24h

// Ensure tmp dir exists
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// Small helpers
function apiHeaders(extra = {}) {
  return Object.assign({ 'x-api-key': COMFY_API_KEY }, extra);
}
function errorJson(res, status, message, details) {
  return res.status(status).json({ error: message, details });
}

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

// Proxy: list workflows
exports.getWorkflows = async (req, res) => {
  try {
    const r = await fetch(`${COMFY_API_BASE}/v1/workflows`, { headers: apiHeaders() });
    if (!r.ok) return errorJson(res, r.status, 'upstream error', await r.text());
    res.json(await r.json());
  } catch (e) {
    return errorJson(res, 502, 'failed to reach ComfyUI API', String(e.message || e));
  }
};

// Proxy: generate
exports.generate = async (req, res) => {
  try {
    const body = req.body || {};
    const { workflow, inputs } = body;
    if (!workflow || !inputs) return errorJson(res, 400, 'workflow and inputs required');

    // 1) Queue upstream job first
    const r = await fetch(`${COMFY_API_BASE}/v1/generate`, {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      // signal: AbortSignal.timeout(30000)
    });
    if (!r.ok) return errorJson(res, r.status, 'upstream error', await r.text());
    const queued = await r.json();

    // 2) Record prompt uses (ignore empty negative) and map them to this job
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

    return res.json(queued);
  } catch (e) {
    return errorJson(res, 502, 'failed to queue generation', String(e.message || e));
  }
};

// Proxy: job status
exports.getJob = async (req, res) => {
  try {
    const r = await fetch(`${COMFY_API_BASE}/v1/jobs/${encodeURIComponent(req.params.id)}`, {
      headers: apiHeaders()
    });
    if (!r.ok) return errorJson(res, r.status, 'upstream error', await r.text());
    res.json(await r.json());
  } catch (e) {
    return errorJson(res, 502, 'failed to fetch job', String(e.message || e));
  }
};

// Proxy: stream job image
exports.getJobImage = async (req, res) => {
  try {
    const url = `${COMFY_API_BASE}/v1/jobs/${encodeURIComponent(req.params.id)}/images/${encodeURIComponent(req.params.index)}`;
    const r = await fetch(url, { headers: apiHeaders(), signal: AbortSignal.timeout(DEFAULT_TIMEOUT) });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      logger.error('[getJobImage] upstream', r.status, txt);
      return errorJson(res, r.status, 'upstream error', txt);
    }
    const ct = r.headers.get('content-type') || 'image/png';
    const ab = await r.arrayBuffer();
    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.end(Buffer.from(ab));
  } catch (e) {
    const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    logger.error('[getJobImage] error', e);
    return errorJson(res, 502, isTimeout ? 'upstream timeout' : 'failed to stream image', String(e.message || e));
  }
};

// Proxy: list input/output
exports.listFiles = async (req, res) => {
  const bucket = req.params.bucket;
  if (!['input', 'output'].includes(bucket)) return errorJson(res, 400, 'bucket must be input or output');
  try {
    const r = await fetch(`${COMFY_API_BASE}/v1/files/${bucket}`, { headers: apiHeaders() });
    if (!r.ok) return errorJson(res, r.status, 'upstream error', await r.text());
    res.json(await r.json());
  } catch (e) {
    return errorJson(res, 502, 'failed to list files', String(e.message || e));
  }
};

// Proxy: stream file by name
exports.getFile = async (req, res) => {
  const bucket = req.params.bucket;
  if (!['input', 'output'].includes(bucket)) return errorJson(res, 400, 'bucket must be input or output');
  const name = req.params.filename;
  try {
    const url = `${COMFY_API_BASE}/v1/files/${bucket}/${encodeURIComponent(name)}`;
    const r = await fetch(url, { headers: apiHeaders(), signal: AbortSignal.timeout(DEFAULT_TIMEOUT) });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      logger.error('[getFile] upstream', r.status, txt);
      return errorJson(res, r.status, 'upstream error', txt);
    }
    const ct = r.headers.get('content-type') || 'application/octet-stream';
    const ab = await r.arrayBuffer();
    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Disposition', `inline; filename="${name.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.end(Buffer.from(ab));
  } catch (e) {
    const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    logger.error('[getFile] error', e);
    return errorJson(res, 502, isTimeout ? 'upstream timeout' : 'failed to stream file', String(e.message || e));
  }
};

// Upload to input/ (saves to tmp_data, forwards to Comfy API, then deletes temp)
exports.uploadInput = async (req, res) => {
  if (!req.file) return errorJson(res, 400, 'missing file "image"');
  const tmpPath = req.file.path;
  const fileName = req.file.originalname;
  try {
    const buf = await fsp.readFile(tmpPath);
    // Node 18+: FormData & Blob available globally
    const fd = new FormData();
    const blob = new Blob([buf], { type: req.file.mimetype || 'application/octet-stream' });
    fd.append('image', blob, fileName);
    const r = await fetch(`${COMFY_API_BASE}/v1/files/input`, {
      method: 'POST',
      headers: apiHeaders(), // do not set Content-Type; fetch will set the boundary
      body: fd
    });
    if (!r.ok) return errorJson(res, r.status, 'upstream error', await r.text());
    const json = await r.json().catch(() => ({}));
    res.json(json);
  } catch (e) {
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
  try {
    const r = await fetch(`${COMFY_API_BASE}/health`);
    res.status(r.ok ? 200 : 502).json({ ok: r.ok });
  } catch {
    res.status(502).json({ ok: false });
  }
};
