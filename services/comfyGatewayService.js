const logger = require('../utils/logger');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');

const DEFAULT_API_BASE = process.env.COMFY_API_BASE || 'http://192.168.0.20:8080';
const DEFAULT_TIMEOUT_MS = 20000;
const JS_FILE_NAME = 'services/comfyGatewayService.js';
const recordApiDebugLog = createApiDebugLogger(JS_FILE_NAME);

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
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = {}) {
    if (!baseUrl) throw new Error('COMFY_API_BASE is not configured');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey || null;
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
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
      if (!r.ok) {
        const errorMsg = (responseBody && responseBody.error) || (typeof responseBody === 'string' ? responseBody : '') || `upstream ${r.status}`;
        const err = new Error(errorMsg);
        err.status = r.status;
        err.response = responseBody;
        throw err;
      }
      return responseBody;
    } catch (err) {
      await recordApiDebugLog({
        requestUrl,
        requestHeaders,
        requestBody: requestBody ?? body,
        responseHeaders,
        responseBody: err,
        functionName
      });
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
