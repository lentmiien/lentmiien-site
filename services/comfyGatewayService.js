const logger = require('../utils/logger');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');

const DEFAULT_API_BASE = process.env.COMFY_API_BASE || 'http://192.168.0.20:8080';
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_STREAM_HEADER_TIMEOUT_MS = 10000;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60000;
const JS_FILE_NAME = 'services/comfyGatewayService.js';
const recordApiDebugLog = createApiDebugLogger(JS_FILE_NAME);

function positiveTimeout(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function timeoutError(message) {
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}

function headersToObject(headers) {
  if (!headers || typeof headers.forEach !== 'function') return null;
  const result = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return Object.keys(result).length > 0 ? result : null;
}

class ComfyGatewayService {
  constructor({
    baseUrl = DEFAULT_API_BASE,
    apiKey = process.env.COMFY_API_KEY,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    streamHeaderTimeoutMs = process.env.COMFY_STREAM_HEADER_TIMEOUT_MS,
    streamIdleTimeoutMs = process.env.COMFY_STREAM_IDLE_TIMEOUT_MS
  } = {}) {
    if (!baseUrl) throw new Error('COMFY_API_BASE is not configured');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey || null;
    this.timeoutMs = positiveTimeout(timeoutMs, DEFAULT_TIMEOUT_MS);
    this.streamHeaderTimeoutMs = positiveTimeout(streamHeaderTimeoutMs, DEFAULT_STREAM_HEADER_TIMEOUT_MS);
    this.streamIdleTimeoutMs = positiveTimeout(streamIdleTimeoutMs, DEFAULT_STREAM_IDLE_TIMEOUT_MS);
  }

  buildUrl(pathname = '') {
    const base = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
    return new URL(pathname, base).toString();
  }

  apiHeaders(extra = {}) {
    const headers = Object.assign({}, extra);
    if (this.apiKey) headers['x-api-key'] = this.apiKey;
    return headers;
  }

  async fetchJson(pathname, { method = 'GET', headers = {}, body } = {}, { functionName = 'fetchJson', requestBody } = {}) {
    const requestUrl = this.buildUrl(pathname);
    const requestHeaders = this.apiHeaders(headers);
    const fetchOptions = {
      method,
      headers: requestHeaders,
      signal: AbortSignal.timeout(this.timeoutMs)
    };
    if (body !== undefined) fetchOptions.body = body;

    let responseHeaders = null;
    let debugRecorded = false;
    try {
      const r = await fetch(requestUrl, fetchOptions);
      responseHeaders = headersToObject(r.headers);
      let responseBody = null;
      const contentType = r.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        responseBody = await r.json();
      } else {
        responseBody = await r.text().catch(() => '');
      }
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: requestBody ?? body,
        responseHeaders,
        responseBody,
        functionName
      });
      debugRecorded = true;
      if (!r.ok) {
        const errorMsg = (responseBody && responseBody.error) || (typeof responseBody === 'string' ? responseBody : '') || `upstream ${r.status}`;
        const err = new Error(errorMsg);
        err.status = r.status;
        err.response = responseBody;
        throw err;
      }
      return responseBody;
    } catch (err) {
      if (!debugRecorded) {
        await recordApiDebugLog({
          requestUrl,
          requestHeaders,
          requestBody: requestBody ?? body,
          responseHeaders,
          responseBody: err,
          functionName
        });
      }
      throw err;
    }
  }

  async listWorkflows() {
    return this.fetchJson('/comfy/workflows', {}, { functionName: 'listWorkflows' });
  }

  async getWorkflow(name) {
    const workflowName = String(name || '').trim();
    if (!workflowName) throw new Error('workflow name is required');
    const encoded = encodeURIComponent(workflowName);
    return this.fetchJson(`/comfy/workflows/${encoded}`, {}, { functionName: 'getWorkflow', requestBody: { name: workflowName } });
  }

  async getSystemStats() {
    return this.fetchJson('/comfy/system_stats', {}, { functionName: 'getSystemStats' });
  }

  async listInputFiles({ subfolder, recursive, page, limit } = {}) {
    const params = new URLSearchParams();
    if (subfolder !== undefined && subfolder !== null && String(subfolder).trim()) {
      params.set('subfolder', String(subfolder).trim());
    }
    if (recursive !== undefined && recursive !== null && recursive !== '') {
      params.set('recursive', String(recursive));
    }
    if (page !== undefined && page !== null && page !== '') {
      params.set('page', String(page));
    }
    if (limit !== undefined && limit !== null && limit !== '') {
      params.set('limit', String(limit));
    }
    const query = params.toString();
    return this.fetchJson(
      `/comfy/input/files${query ? `?${query}` : ''}`,
      {},
      { functionName: 'listInputFiles', requestBody: Object.fromEntries(params) }
    );
  }

  async uploadInputFile({ buffer, filename, contentType, subfolder, overwrite = false } = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      const err = new Error('a non-empty input file is required');
      err.status = 400;
      throw err;
    }
    const safeFilename = String(filename || '').trim();
    if (!safeFilename) {
      const err = new Error('input filename is required');
      err.status = 400;
      throw err;
    }

    const body = new FormData();
    body.append(
      'file',
      new Blob([buffer], { type: contentType || 'application/octet-stream' }),
      safeFilename
    );
    const normalizedSubfolder = String(subfolder || '').trim();
    if (normalizedSubfolder) body.append('subfolder', normalizedSubfolder);
    if (overwrite === true) body.append('overwrite', 'true');

    return this.fetchJson(
      '/comfy/input/upload',
      { method: 'POST', body },
      {
        functionName: 'uploadInputFile',
        requestBody: {
          filename: safeFilename,
          content_type: contentType || 'application/octet-stream',
          size_bytes: buffer.length,
          subfolder: normalizedSubfolder || null,
          overwrite: overwrite === true
        }
      }
    );
  }

  async openInputFile(inputPath, { range, signal } = {}) {
    const normalizedPath = String(inputPath || '').trim();
    if (!normalizedPath) {
      const err = new Error('input path is required');
      err.status = 400;
      throw err;
    }

    const params = new URLSearchParams({ path: normalizedPath });
    const requestUrl = this.buildUrl(`/comfy/input/view?${params.toString()}`);
    const requestHeaders = this.apiHeaders(range ? { Range: range } : {});
    const functionName = 'openInputFile';
    let responseHeaders = null;
    let debugRecorded = false;
    const headerController = new AbortController();
    const headerTimer = setTimeout(() => {
      headerController.abort(timeoutError('gateway response header timeout'));
    }, this.streamHeaderTimeoutMs);
    headerTimer.unref?.();
    const requestSignal = signal
      ? AbortSignal.any([signal, headerController.signal])
      : headerController.signal;

    try {
      const response = await fetch(requestUrl, {
        headers: requestHeaders,
        signal: requestSignal
      });
      clearTimeout(headerTimer);
      responseHeaders = headersToObject(response.headers);
      if (!response.ok) {
        const responseBody = await response.text().catch(() => '');
        await recordApiDebugLog({
          requestUrl,
          requestHeaders,
          requestBody: { path: normalizedPath, range: range || null },
          responseHeaders,
          responseBody: { status: response.status, body: responseBody },
          functionName
        });
        debugRecorded = true;
        const err = new Error(responseBody || `upstream ${response.status}`);
        err.status = response.status;
        err.response = responseBody;
        throw err;
      }
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: { path: normalizedPath, range: range || null },
        responseHeaders,
        responseBody: { status: response.status },
        functionName
      });
      return response;
    } catch (err) {
      clearTimeout(headerTimer);
      if (!debugRecorded) {
        await recordApiDebugLog({
          requestUrl,
          requestHeaders,
          requestBody: { path: normalizedPath, range: range || null },
          responseHeaders,
          responseBody: err,
          functionName
        });
      }
      throw err;
    }
  }

  async runPrompt(prompt, { wait = true } = {}) {
    if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) {
      throw new Error('prompt JSON object is required');
    }
    const body = { prompt, wait: wait !== false };
    return this.fetchJson(
      '/comfy/run',
      {
        method: 'POST',
        headers: this.apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body)
      },
      { functionName: 'runPrompt', requestBody: body }
    );
  }

  async submitPrompt(prompt, { timeoutSec } = {}) {
    if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) {
      throw new Error('prompt JSON object is required');
    }
    const body = { prompt };
    const numericTimeout = Number(timeoutSec);
    if (Number.isFinite(numericTimeout) && numericTimeout > 0) {
      body.timeout_sec = numericTimeout;
    }
    return this.fetchJson(
      '/comfy/submit',
      {
        method: 'POST',
        headers: this.apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body)
      },
      { functionName: 'submitPrompt', requestBody: body }
    );
  }

  async getStatus(promptId) {
    const id = String(promptId || '').trim();
    if (!id) throw new Error('prompt_id is required');
    const encoded = encodeURIComponent(id);
    return this.fetchJson(`/comfy/status/${encoded}`, {}, { functionName: 'getStatus', requestBody: { prompt_id: id } });
  }

  normalizeGatewayViewUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) throw new Error('gateway_view_url is required');
    return this.buildUrl(raw.startsWith('/') ? raw : `/comfy/view?filename=${encodeURIComponent(raw)}`);
  }

  async fetchImage({ gateway_view_url, filename, type, subfolder } = {}) {
    let requestUrl = null;
    if (gateway_view_url) {
      requestUrl = this.normalizeGatewayViewUrl(gateway_view_url);
    } else if (filename) {
      const u = new URL('/comfy/view', `${this.baseUrl}/`);
      u.searchParams.set('filename', filename);
      if (type) u.searchParams.set('type', type);
      if (subfolder !== undefined && subfolder !== null) {
        u.searchParams.set('subfolder', subfolder);
      }
      requestUrl = u.toString();
    } else {
      throw new Error('filename or gateway_view_url is required');
    }

    const requestHeaders = this.apiHeaders();
    const functionName = 'fetchImage';
    let responseHeaders = null;
    try {
      const r = await fetch(requestUrl, {
        headers: requestHeaders,
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      responseHeaders = headersToObject(r.headers);
      const buf = Buffer.from(await r.arrayBuffer());
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: null,
        responseHeaders,
        responseBody: { size: buf.length, status: r.status },
        functionName
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(txt || `image fetch ${r.status}`);
      }
      return {
        buffer: buf,
        contentType: r.headers.get('content-type') || 'application/octet-stream',
        url: requestUrl
      };
    } catch (err) {
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: null,
        responseHeaders,
        responseBody: err,
        functionName
      });
      logger.error('[ComfyGatewayService] fetchImage failed', err);
      throw err;
    }
  }
}

module.exports = ComfyGatewayService;
