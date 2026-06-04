const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const logger = require('../utils/logger');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');

const DEFAULT_GATEWAY_BASE_URL = process.env.LOCATEANYTHING_GATEWAY_BASE_URL ||
  process.env.AI_GATEWAY_BASE_URL ||
  'http://192.168.0.20:8080';
const DEFAULT_TIMEOUT_MS = readPositiveInteger(process.env.LOCATEANYTHING_TIMEOUT_MS, 300000);
const SERVICE_PATH = '/image/locateanything/file';
const JS_FILE_NAME = 'services/locateAnythingGatewayService.js';
const recordApiDebugLog = createApiDebugLogger(JS_FILE_NAME);

const LOCATEANYTHING_TASKS = Object.freeze([
  'detect_text',
  'detect',
  'ground',
  'ground_single',
  'ground_text',
  'ground_gui',
  'point',
]);

const LOCATEANYTHING_OUTPUT_TYPES = Object.freeze(['box', 'point']);
const LOCATEANYTHING_GENERATION_MODES = Object.freeze(['fast', 'hybrid', 'slow']);

const DEFAULT_LOCATEANYTHING_OPTIONS = Object.freeze({
  task: 'ground_gui',
  query: '',
  categories: [],
  outputType: 'point',
  generationMode: 'hybrid',
  maxImageEdge: 1280,
  maxNewTokens: 256,
  doSample: false,
  temperature: 0,
  topP: 0.9,
  repetitionPenalty: 1.1,
});

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function joinUrl(base, path) {
  const normalizedBase = String(base || '').replace(/\/+$/, '');
  const normalizedPath = String(path || '').startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
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

function buildGatewayErrorMessage(error, fallback = 'LocateAnything request failed.') {
  if (error?.response) {
    const detail = extractDetail(error.response.data);
    return `Gateway returned ${error.response.status}${detail ? `: ${detail}` : ''}`;
  }
  if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
    return `Unable to reach the AI Gateway at ${DEFAULT_GATEWAY_BASE_URL}.`;
  }
  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' || error?.code === 'ESOCKETTIMEDOUT') {
    return 'The AI Gateway request timed out.';
  }
  return error?.message || fallback;
}

function appendIfPresent(formData, key, value) {
  if (value === undefined || value === null || value === '') {
    return;
  }
  formData.append(key, String(value));
}

function buildFormPayload(options) {
  const normalized = { ...DEFAULT_LOCATEANYTHING_OPTIONS, ...(options || {}) };
  return {
    task: normalized.task,
    query: normalized.query,
    categories: Array.isArray(normalized.categories) ? normalized.categories.join(',') : normalized.categories,
    output_type: normalized.outputType,
    generation_mode: normalized.generationMode,
    max_image_edge: normalized.maxImageEdge,
    max_new_tokens: normalized.maxNewTokens,
    do_sample: normalized.doSample,
    temperature: normalized.temperature,
    top_p: normalized.topP,
    repetition_penalty: normalized.repetitionPenalty,
  };
}

function buildRequestMetadata(file, options, requestUrl) {
  return {
    requestUrl,
    fileName: file?.originalname || file?.filename || 'image',
    storedFileName: file?.filename || null,
    fileSize: Number.isFinite(file?.size) ? file.size : 0,
    mimeType: file?.mimetype || null,
    options: { ...DEFAULT_LOCATEANYTHING_OPTIONS, ...(options || {}) },
  };
}

class LocateAnythingGatewayService {
  constructor({
    gatewayBaseUrl = DEFAULT_GATEWAY_BASE_URL,
    requestTimeoutMs = DEFAULT_TIMEOUT_MS,
    servicePath = SERVICE_PATH,
  } = {}) {
    this.gatewayBaseUrl = gatewayBaseUrl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.servicePath = servicePath;
  }

  url(path = this.servicePath) {
    return joinUrl(this.gatewayBaseUrl, path);
  }

  async locateFile({ file, options = {} }) {
    if (!file || !file.path) {
      throw new Error('An uploaded image file path is required.');
    }

    const requestUrl = this.url(this.servicePath);
    const formPayload = buildFormPayload(options);
    const requestMetadata = buildRequestMetadata(file, options, requestUrl);
    const startedAt = Date.now();

    const formData = new FormData();
    formData.append('file', fs.createReadStream(file.path), {
      filename: requestMetadata.fileName,
      contentType: requestMetadata.mimeType || 'application/octet-stream',
    });
    Object.entries(formPayload).forEach(([key, value]) => appendIfPresent(formData, key, value));

    logger.notice('Submitting LocateAnything job to gateway', {
      category: 'locateanything_gateway',
      metadata: {
        requestUrl,
        fileName: requestMetadata.fileName,
        fileSize: requestMetadata.fileSize,
        task: requestMetadata.options.task,
        generationMode: requestMetadata.options.generationMode,
      },
    });

    try {
      const response = await axios.post(requestUrl, formData, {
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: this.requestTimeoutMs,
      });

      await recordApiDebugLog({
        functionName: 'locateanything_file',
        requestUrl,
        requestBody: requestMetadata,
        responseHeaders: response.headers || null,
        responseBody: response.data,
      });

      logger.notice('LocateAnything gateway request completed', {
        category: 'locateanything_gateway',
        metadata: {
          requestUrl,
          status: response.status,
          durationMs: Date.now() - startedAt,
          fileName: requestMetadata.fileName,
          task: requestMetadata.options.task,
        },
      });

      return {
        data: response.data,
        status: response.status,
        headers: response.headers || null,
        request: requestMetadata,
      };
    } catch (error) {
      await recordApiDebugLog({
        functionName: 'locateanything_file',
        requestUrl,
        requestBody: requestMetadata,
        responseHeaders: error?.response?.headers || null,
        responseBody: getErrorPayload(error),
      });

      logger.warning('LocateAnything gateway request failed', {
        category: 'locateanything_gateway',
        metadata: {
          requestUrl,
          status: error?.response?.status || null,
          code: error?.code || null,
          durationMs: Date.now() - startedAt,
          fileName: requestMetadata.fileName,
          task: requestMetadata.options.task,
          message: buildGatewayErrorMessage(error),
        },
      });

      throw error;
    }
  }
}

module.exports = LocateAnythingGatewayService;
module.exports.DEFAULT_LOCATEANYTHING_OPTIONS = DEFAULT_LOCATEANYTHING_OPTIONS;
module.exports.LOCATEANYTHING_TASKS = LOCATEANYTHING_TASKS;
module.exports.LOCATEANYTHING_OUTPUT_TYPES = LOCATEANYTHING_OUTPUT_TYPES;
module.exports.LOCATEANYTHING_GENERATION_MODES = LOCATEANYTHING_GENERATION_MODES;
module.exports.SERVICE_PATH = SERVICE_PATH;
module.exports.buildGatewayErrorMessage = buildGatewayErrorMessage;
module.exports.getErrorPayload = getErrorPayload;
