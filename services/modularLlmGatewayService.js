const axios = require('axios');
const {
  DEFAULT_GATEWAY_BASE_URL,
  normalizeHttpBaseUrl,
} = require('./aiGatewayDocumentationService');

const SERVICE_ID = 'modular_llm';
const SERVICE_PREFIX = '/modular-llm';
const DEFAULT_INFO_TIMEOUT_MS = 10000;
const DEFAULT_RUN_TIMEOUT_MS = 630000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const GATEWAY_RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function assertGatewayRunId(runId) {
  const normalized = typeof runId === 'string' ? runId.trim() : '';
  if (!GATEWAY_RUN_ID_PATTERN.test(normalized)) {
    const error = new Error('Invalid Modular LLM Gateway run ID.');
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function gatewayResponseError(error, fallback = 'The Modular LLM Gateway request failed.') {
  const status = error?.response?.status;
  const payload = error?.response?.data;
  const detailPayload = payload?.detail && typeof payload.detail === 'object'
    && !Array.isArray(payload.detail)
    ? payload.detail
    : payload;
  const arrayDetail = Array.isArray(payload?.detail)
    ? payload.detail
      .map((entry) => entry?.msg || entry?.message)
      .filter(Boolean)
      .join('; ')
    : '';
  const detail = typeof payload === 'string'
    ? payload
    : detailPayload?.error?.message
      || (typeof detailPayload?.error === 'string' ? detailPayload.error : '')
      || detailPayload?.message
      || (typeof payload?.detail === 'string' ? payload.detail : '')
      || arrayDetail;

  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim().slice(0, 4000);
  }

  const statusMessages = {
    409: 'The Modular LLM runtime is already processing another request.',
    413: 'The Modular LLM request is too large.',
    422: 'The Modular LLM input or intermediate schema was rejected.',
    429: 'The shared GPU admission wait timed out.',
    502: 'A Modular LLM stage failed.',
    503: 'The Modular LLM container or GPU could not be prepared.',
    504: 'The Modular LLM execution deadline expired.',
  };
  if (statusMessages[status]) return statusMessages[status];
  if (['ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(error?.code)) {
    return 'The Modular LLM Gateway request timed out.';
  }
  if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
    return 'The Modular LLM Gateway is unreachable.';
  }
  return fallback;
}

class ModularLlmGatewayService {
  constructor({
    gatewayBaseUrl = DEFAULT_GATEWAY_BASE_URL,
    infoTimeoutMs = positiveInteger(
      process.env.MODULAR_LLM_INFO_TIMEOUT_MS,
      DEFAULT_INFO_TIMEOUT_MS,
    ),
    runTimeoutMs = positiveInteger(
      process.env.MODULAR_LLM_RUN_TIMEOUT_MS,
      DEFAULT_RUN_TIMEOUT_MS,
    ),
    httpClient = axios,
  } = {}) {
    this.gatewayBaseUrl = normalizeHttpBaseUrl(gatewayBaseUrl);
    this.infoTimeoutMs = infoTimeoutMs;
    this.runTimeoutMs = runTimeoutMs;
    this.httpClient = httpClient;
  }

  buildUrl(path = '') {
    return `${this.gatewayBaseUrl}${SERVICE_PREFIX}${path}`;
  }

  async getJson(path, options = {}) {
    const response = await this.httpClient.get(this.buildUrl(path), {
      timeout: this.infoTimeoutMs,
      responseType: 'json',
      maxContentLength: MAX_RESPONSE_BYTES,
      headers: { Accept: 'application/json' },
      ...options,
    });
    return response.data;
  }

  getService() {
    return this.getJson('');
  }

  getHealth() {
    return this.getJson('/health');
  }

  getModels() {
    return this.getJson('/models');
  }

  getSchemas() {
    return this.getJson('/schemas');
  }

  async listRuns(limit = 25) {
    const normalizedLimit = Number.isSafeInteger(Number(limit))
      ? Math.min(Math.max(Number(limit), 1), 100)
      : 25;
    const payload = await this.getJson('/runs', { params: { limit: normalizedLimit } });
    if (!payload || !Array.isArray(payload.runs)) {
      throw new Error('The Modular LLM Gateway returned an invalid run list.');
    }
    return payload.runs;
  }

  getRun(runId) {
    const safeRunId = assertGatewayRunId(runId);
    return this.getJson(`/runs/${encodeURIComponent(safeRunId)}`);
  }

  async runPipeline({
    input,
    maxRepairAttempts = 1,
    persist = true,
    includeDiagnostics = true,
  }) {
    const response = await this.httpClient.post(
      this.buildUrl('/pipeline/run'),
      {
        input,
        max_repair_attempts: maxRepairAttempts,
        persist,
        include_diagnostics: includeDiagnostics,
      },
      {
        timeout: this.runTimeoutMs,
        responseType: 'json',
        maxContentLength: MAX_RESPONSE_BYTES,
        maxBodyLength: 64 * 1024,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      },
    );
    return response.data;
  }

  async getRuntimeState() {
    const entries = [
      ['service', () => this.getService()],
      ['health', () => this.getHealth()],
    ];
    const results = await Promise.allSettled(entries.map(([, task]) => task()));
    const state = { fetchedAt: new Date().toISOString(), errors: {} };

    results.forEach((result, index) => {
      const key = entries[index][0];
      if (result.status === 'fulfilled') {
        state[key] = result.value;
      } else {
        state[key] = null;
        state.errors[key] = gatewayResponseError(result.reason);
      }
    });

    return state;
  }

  async getDashboardState() {
    const entries = [
      ['service', () => this.getService()],
      ['health', () => this.getHealth()],
      ['models', () => this.getModels()],
      ['schemas', () => this.getSchemas()],
      ['runs', () => this.listRuns(25)],
    ];
    const results = await Promise.allSettled(entries.map(([, task]) => task()));
    const state = {
      fetchedAt: new Date().toISOString(),
      baseUrl: this.gatewayBaseUrl,
      errors: {},
    };

    results.forEach((result, index) => {
      const key = entries[index][0];
      if (result.status === 'fulfilled') {
        state[key] = result.value;
      } else {
        state[key] = key === 'runs' ? [] : null;
        state.errors[key] = gatewayResponseError(result.reason);
      }
    });

    return state;
  }
}

ModularLlmGatewayService.SERVICE_ID = SERVICE_ID;
ModularLlmGatewayService.SERVICE_PREFIX = SERVICE_PREFIX;
ModularLlmGatewayService.assertGatewayRunId = assertGatewayRunId;
ModularLlmGatewayService.gatewayResponseError = gatewayResponseError;

module.exports = ModularLlmGatewayService;
