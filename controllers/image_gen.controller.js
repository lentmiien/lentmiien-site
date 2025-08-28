// controllers/image_gen.controller.js
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

// CHANGE THESE two lines to match your ComfyUI API box
const COMFY_API_BASE = process.env.COMFY_API_BASE; // your personal ComfyUI API base
const COMFY_API_KEY  = process.env.COMFY_API_KEY;
const DEFAULT_TIMEOUT = 15000;

const TMP_DIR = path.join(__dirname, '../tmp_data');

// Ensure tmp dir exists
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// Small helpers
function apiHeaders(extra = {}) {
  return Object.assign({ 'x-api-key': COMFY_API_KEY }, extra);
}
function errorJson(res, status, message, details) {
  return res.status(status).json({ error: message, details });
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
    const r = await fetch(`${COMFY_API_BASE}/v1/generate`, {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(req.body || {})
    });
    if (!r.ok) return errorJson(res, r.status, 'upstream error', await r.text());
    res.json(await r.json());
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
      console.error('[getJobImage] upstream', r.status, txt);
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
    console.error('[getJobImage] error', e);
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
      console.error('[getFile] upstream', r.status, txt);
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
    console.error('[getFile] error', e);
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

// Simple health pass-through
exports.health = async (req, res) => {
  try {
    const r = await fetch(`${COMFY_API_BASE}/health`);
    res.status(r.ok ? 200 : 502).json({ ok: r.ok });
  } catch {
    res.status(502).json({ ok: false });
  }
};