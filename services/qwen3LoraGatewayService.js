const axios = require('axios');
const FormData = require('form-data');
const logger = require('../utils/logger');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');

const DEFAULT_GATEWAY_BASE_URL = process.env.AI_GATEWAY_BASE_URL || 'http://192.168.0.20:8080';
const DEFAULT_INFO_TIMEOUT_MS = readPositiveInteger(process.env.QWEN3_LORA_INFO_TIMEOUT_MS, 10000);
const DEFAULT_ACTION_TIMEOUT_MS = readPositiveInteger(process.env.QWEN3_LORA_ACTION_TIMEOUT_MS, 120000);
const DEFAULT_UPLOAD_TIMEOUT_MS = readPositiveInteger(process.env.QWEN3_LORA_UPLOAD_TIMEOUT_MS, 120000);
const DEFAULT_GENERATE_TIMEOUT_MS = readPositiveInteger(process.env.QWEN3_LORA_GENERATE_TIMEOUT_MS, 10 * 60 * 1000);
const SERVICE_PREFIX = '/qwen3-lora';
const JS_FILE_NAME = 'services/qwen3LoraGatewayService.js';
const recordApiDebugLog = createApiDebugLogger(JS_FILE_NAME);

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function joinUrl(base, path) {
  const normalizedBase = String(base || '').replace(/\/+$/, '');
  const normalizedPath = String(path || '').startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function summarizeFile(file) {
  return {
    fileName: file?.originalname || 'dataset.csv',
    fileSize: Buffer.isBuffer(file?.buffer) ? file.buffer.length : 0,
    mimeType: file?.mimetype || null,
  };
}

function getErrorPayload(error) {
  if (error?.response?.data !== undefined) {
    return error.response.data;
  }
  return error?.message || 'Unknown error';
}

function extractDetail(data) {
  if (!data) return '';
  if (typeof data === 'string') return data.slice(0, 300);
  if (typeof data.detail === 'string') return data.detail;
  if (Array.isArray(data.detail)) {
    return data.detail
      .map((entry) => entry?.msg || entry?.message || JSON.stringify(entry))
      .join('; ')
      .slice(0, 300);
  }
  if (typeof data.error === 'string') return data.error;
  try {
    return JSON.stringify(data).slice(0, 300);
  } catch {
    return '';
  }
}

function buildGatewayErrorMessage(
  error,
  fallback = 'Qwen3 LoRA request failed.',
  gatewayBaseUrl = DEFAULT_GATEWAY_BASE_URL,
) {
  if (error?.response) {
    const detail = extractDetail(error.response.data);
    return `Gateway returned ${error.response.status}${detail ? `: ${detail}` : ''}`;
  }
  if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
    return `Unable to reach the AI Gateway at ${gatewayBaseUrl}.`;
  }
  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' || error?.code === 'ESOCKETTIMEDOUT') {
    return 'The AI Gateway request timed out.';
  }
  return error?.message || fallback;
}

function fireAndForgetLog(promise, {
  serviceLabel = 'Qwen3 LoRA',
  logCategory = 'qwen3_lora_gateway',
} = {}) {
  if (!promise || typeof promise.catch !== 'function') {
    return;
  }
  promise.catch((error) => {
    logger.warning(`${serviceLabel} API debug logging failed`, {
      category: logCategory,
      metadata: {
        message: error?.message || String(error),
      },
    });
  });
}

function recordDebugLog(payload, {
  recorder = recordApiDebugLog,
  serviceLabel,
  logCategory,
} = {}) {
  fireAndForgetLog(recorder(payload), { serviceLabel, logCategory });
}

function requestLogMetadata({
  method,
  path,
  requestUrl,
  startedAt,
  error = null,
  response = null,
  errorMessageBuilder = buildGatewayErrorMessage,
}) {
  const durationMs = Date.now() - startedAt;
  const base = {
    method: String(method || 'get').toUpperCase(),
    path,
    requestUrl,
    durationMs,
  };

  if (response) {
    base.status = response.status;
  }

  if (error) {
    base.status = error?.response?.status || null;
    base.code = error?.code || null;
    base.message = error?.message || String(error);
    base.gatewayMessage = errorMessageBuilder(error);
    base.responseDetail = extractDetail(error?.response?.data);
  }

  return base;
}

class Qwen3LoraGatewayService {
  constructor({
    gatewayBaseUrl = DEFAULT_GATEWAY_BASE_URL,
    infoTimeoutMs = DEFAULT_INFO_TIMEOUT_MS,
    actionTimeoutMs = DEFAULT_ACTION_TIMEOUT_MS,
    uploadTimeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS,
    generateTimeoutMs = DEFAULT_GENERATE_TIMEOUT_MS,
    downloadTimeoutMs = actionTimeoutMs,
    servicePrefix = SERVICE_PREFIX,
    serviceLabel = 'Qwen3 LoRA',
    logCategory = 'qwen3_lora_gateway',
    functionPrefix = 'qwen3_lora',
    dashboardContainerPath = '/container',
    apiDebugFileName = JS_FILE_NAME,
  } = {}) {
    this.gatewayBaseUrl = gatewayBaseUrl;
    this.infoTimeoutMs = infoTimeoutMs;
    this.actionTimeoutMs = actionTimeoutMs;
    this.uploadTimeoutMs = uploadTimeoutMs;
    this.generateTimeoutMs = generateTimeoutMs;
    this.downloadTimeoutMs = downloadTimeoutMs;
    this.servicePrefix = servicePrefix;
    this.serviceLabel = serviceLabel;
    this.logCategory = logCategory;
    this.functionPrefix = functionPrefix;
    this.dashboardContainerPath = dashboardContainerPath;
    this.recordApiDebugLog = apiDebugFileName === JS_FILE_NAME
      ? recordApiDebugLog
      : createApiDebugLogger(apiDebugFileName);
  }

  servicePath(path = '') {
    const suffix = String(path || '');
    if (!suffix) {
      return this.servicePrefix;
    }
    return `${this.servicePrefix}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
  }

  url(path) {
    return joinUrl(this.gatewayBaseUrl, path);
  }

  gatewayErrorMessage(error, fallback = `${this.serviceLabel} request failed.`) {
    return buildGatewayErrorMessage(error, fallback, this.gatewayBaseUrl);
  }

  async request({
    method = 'get',
    path,
    data,
    params,
    headers,
    timeout,
    functionName,
    requestBodyForLog,
    responseBodyForLog,
    debugLog = true,
  }) {
    const requestUrl = this.url(path);
    const startedAt = Date.now();
    logger.debug(`${this.serviceLabel} gateway request started`, {
      category: this.logCategory,
      metadata: {
        method: String(method || 'get').toUpperCase(),
        path,
        requestUrl,
        timeout: timeout || this.infoTimeoutMs,
        functionName,
      },
    });

    try {
      const response = await axios({
        method,
        url: requestUrl,
        data,
        params,
        headers,
        timeout: timeout || this.infoTimeoutMs,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      if (debugLog) {
        recordDebugLog({
          functionName,
          requestUrl,
          requestBody: requestBodyForLog === undefined ? data || params || null : requestBodyForLog,
          responseHeaders: response.headers || null,
          responseBody: responseBodyForLog === undefined ? response.data : responseBodyForLog,
        }, {
          recorder: this.recordApiDebugLog,
          serviceLabel: this.serviceLabel,
          logCategory: this.logCategory,
        });
      }

      logger.debug(`${this.serviceLabel} gateway request completed`, {
        category: this.logCategory,
        metadata: requestLogMetadata({
          method,
          path,
          requestUrl,
          startedAt,
          response,
          errorMessageBuilder: (requestError) => this.gatewayErrorMessage(requestError),
        }),
      });

      return response.data;
    } catch (error) {
      if (debugLog) {
        recordDebugLog({
          functionName,
          requestUrl,
          requestBody: requestBodyForLog === undefined ? data || params || null : requestBodyForLog,
          responseHeaders: error?.response?.headers || null,
          responseBody: responseBodyForLog === undefined ? getErrorPayload(error) : responseBodyForLog,
        }, {
          recorder: this.recordApiDebugLog,
          serviceLabel: this.serviceLabel,
          logCategory: this.logCategory,
        });
      }

      logger.warning(`${this.serviceLabel} gateway request failed`, {
        category: this.logCategory,
        metadata: requestLogMetadata({
          method,
          path,
          requestUrl,
          startedAt,
          error,
          errorMessageBuilder: (requestError) => this.gatewayErrorMessage(requestError),
        }),
      });

      throw error;
    }
  }

  async getService(path) {
    return this.request({
      method: 'get',
      path: this.servicePath(path),
      timeout: this.infoTimeoutMs,
      functionName: `${this.functionPrefix}_get_${String(path || 'root').replace(/[^a-z0-9]+/gi, '_')}`,
    });
  }

  async getDashboardState() {
    const endpoints = {
      container: {
        path: this.dashboardContainerPath
          ? this.servicePath(this.dashboardContainerPath)
          : this.servicePath(),
        functionName: `${this.functionPrefix}_container_state`,
      },
      health: { path: this.servicePath('/health'), functionName: `${this.functionPrefix}_health` },
      model: { path: this.servicePath('/model'), functionName: `${this.functionPrefix}_model` },
      datasets: { path: this.servicePath('/datasets'), functionName: `${this.functionPrefix}_datasets` },
      jobs: { path: this.servicePath('/train/jobs'), functionName: `${this.functionPrefix}_jobs` },
      adapters: { path: this.servicePath('/adapters'), functionName: `${this.functionPrefix}_adapters` },
      limits: { path: '/limits', functionName: `${this.functionPrefix}_limits` },
    };

    const results = await Promise.all(Object.entries(endpoints).map(async ([key, endpoint]) => {
      try {
        const data = await this.request({
          method: 'get',
          path: endpoint.path,
          timeout: this.infoTimeoutMs,
          functionName: endpoint.functionName,
        });
        return [key, data, null];
      } catch (error) {
        logger.warning(`${this.serviceLabel} dashboard endpoint unavailable`, {
          category: this.logCategory,
          metadata: {
            endpoint: key,
            path: endpoint.path,
            message: this.gatewayErrorMessage(error),
            status: error?.response?.status || null,
            code: error?.code || null,
          },
        });
        return [key, null, this.gatewayErrorMessage(error)];
      }
    }));

    const state = {
      baseUrl: this.gatewayBaseUrl,
      servicePrefix: this.servicePrefix,
      fetchedAt: new Date().toISOString(),
      errors: {},
    };

    results.forEach(([key, data, error]) => {
      state[key] = data;
      if (error) {
        state.errors[key] = error;
      }
    });

    const errorKeys = Object.keys(state.errors);
    if (errorKeys.length) {
      logger.warning(`${this.serviceLabel} dashboard state loaded with endpoint errors`, {
        category: this.logCategory,
        metadata: {
          baseUrl: this.gatewayBaseUrl,
          failedEndpoints: errorKeys,
          errors: state.errors,
        },
      });
    } else {
      logger.debug(`${this.serviceLabel} dashboard state loaded`, {
        category: this.logCategory,
        metadata: { baseUrl: this.gatewayBaseUrl },
      });
    }

    return state;
  }

  async containerAction(action, { wait = true } = {}) {
    const allowed = new Set(['start', 'stop', 'restart']);
    if (!allowed.has(action)) {
      const error = new Error('Unsupported container action.');
      error.statusCode = 400;
      throw error;
    }

    const body = action === 'stop' ? {} : { wait: wait !== false };
    return this.request({
      method: 'post',
      path: this.servicePath(`/container/${action}`),
      data: body,
      timeout: this.actionTimeoutMs,
      functionName: `${this.functionPrefix}_container_${action}`,
    });
  }

  async downloadModel() {
    return this.request({
      method: 'post',
      path: this.servicePath('/model/download'),
      data: {},
      timeout: this.downloadTimeoutMs,
      functionName: `${this.functionPrefix}_model_download`,
    });
  }

  async unloadModel() {
    return this.request({
      method: 'post',
      path: this.servicePath('/model/unload'),
      data: {},
      timeout: this.actionTimeoutMs,
      functionName: `${this.functionPrefix}_model_unload`,
    });
  }

  async uploadDataset({ file, name }) {
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      const error = new Error('CSV file is required.');
      error.statusCode = 400;
      throw error;
    }

    const formData = new FormData();
    const fileSummary = summarizeFile(file);
    formData.append('file', file.buffer, {
      filename: fileSummary.fileName,
      contentType: fileSummary.mimeType || 'text/csv',
    });
    if (typeof name === 'string' && name.trim()) {
      formData.append('name', name.trim());
    }

    return this.request({
      method: 'post',
      path: this.servicePath('/datasets/upload'),
      data: formData,
      headers: formData.getHeaders(),
      timeout: this.uploadTimeoutMs,
      functionName: `${this.functionPrefix}_dataset_upload`,
      requestBodyForLog: {
        ...fileSummary,
        name: typeof name === 'string' ? name.trim() : '',
      },
    });
  }

  async deleteDataset(datasetId) {
    return this.request({
      method: 'delete',
      path: this.servicePath(`/datasets/${encodeURIComponent(datasetId)}`),
      timeout: this.actionTimeoutMs,
      functionName: `${this.functionPrefix}_dataset_delete`,
      requestBodyForLog: { datasetId },
    });
  }

  async createTrainingJob(payload) {
    return this.request({
      method: 'post',
      path: this.servicePath('/train/jobs'),
      data: payload,
      timeout: this.actionTimeoutMs,
      functionName: `${this.functionPrefix}_train_job_create`,
    });
  }

  async getTrainingJob(jobId) {
    return this.request({
      method: 'get',
      path: this.servicePath(`/train/jobs/${encodeURIComponent(jobId)}`),
      timeout: this.infoTimeoutMs,
      functionName: `${this.functionPrefix}_train_job_get`,
      requestBodyForLog: { jobId },
    });
  }

  async generate(payload, options = {}) {
    return this.request({
      method: 'post',
      path: this.servicePath('/generate'),
      data: payload,
      timeout: this.generateTimeoutMs,
      functionName: `${this.functionPrefix}_generate`,
      requestBodyForLog: options.requestBodyForLog,
      responseBodyForLog: options.responseBodyForLog,
      debugLog: options.debugLog !== false,
    });
  }

  async compareGenerations({ targets, payload }) {
    const results = [];

    for (const target of targets) {
      const startedAt = Date.now();
      const adapterName = target.adapter_name || null;
      const label = target.label || adapterName || 'Base model';
      try {
        const data = await this.generate({
          ...payload,
          adapter_name: adapterName,
        });
        results.push({
          ok: true,
          label,
          adapter_name: adapterName,
          duration_ms: Date.now() - startedAt,
          data,
        });
      } catch (error) {
        results.push({
          ok: false,
          label,
          adapter_name: adapterName,
          duration_ms: Date.now() - startedAt,
          status: error?.response?.status || error?.statusCode || 502,
          error: this.gatewayErrorMessage(error),
          detail: error?.response?.data || null,
        });
      }
    }

    return {
      started_at: new Date().toISOString(),
      results,
      finished_at: new Date().toISOString(),
    };
  }
}

module.exports = Qwen3LoraGatewayService;
module.exports.buildGatewayErrorMessage = buildGatewayErrorMessage;
module.exports.DEFAULT_GATEWAY_BASE_URL = DEFAULT_GATEWAY_BASE_URL;
module.exports.SERVICE_PREFIX = SERVICE_PREFIX;
