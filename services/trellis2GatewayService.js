const fs = require('fs');
const fsPromises = require('fs/promises');
const { pipeline } = require('stream/promises');
const axios = require('axios');
const FormData = require('form-data');
const logger = require('../utils/logger');
const { validateGlbHeader } = require('../utils/trellis2');

const DEFAULT_GATEWAY_BASE_URL = process.env.TRELLIS2_GATEWAY_BASE_URL ||
  process.env.AI_GATEWAY_BASE_URL ||
  'http://192.168.0.20:8080';
const DEFAULT_INFO_TIMEOUT_MS = readPositiveInteger(process.env.TRELLIS2_INFO_TIMEOUT_MS, 10000);
const DEFAULT_ACTION_TIMEOUT_MS = readPositiveInteger(process.env.TRELLIS2_ACTION_TIMEOUT_MS, 180000);
const DEFAULT_GENERATE_TIMEOUT_MS = readPositiveInteger(process.env.TRELLIS2_GENERATE_TIMEOUT_MS, 7500000);
const SERVICE_PREFIX = '/3d/trellis2';
const MAX_ERROR_BODY_BYTES = 64 * 1024;

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function joinUrl(base, path) {
  const normalizedBase = String(base || '').replace(/\/+$/, '');
  const normalizedPath = String(path || '').startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function parsePossibleJson(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return '';
  try {
    return JSON.parse(normalized);
  } catch {
    return normalized;
  }
}

function extractDetail(data) {
  if (!data) return '';
  if (Buffer.isBuffer(data)) return extractDetail(parsePossibleJson(data.toString('utf8')));
  if (typeof data === 'string') {
    const parsed = parsePossibleJson(data);
    return typeof parsed === 'string' ? parsed.slice(0, 300) : extractDetail(parsed);
  }
  if (typeof data.detail === 'string') return data.detail.slice(0, 300);
  if (Array.isArray(data.detail)) {
    return data.detail
      .map((entry) => entry?.msg || entry?.message || JSON.stringify(entry))
      .join('; ')
      .slice(0, 300);
  }
  if (typeof data.error === 'string') return data.error.slice(0, 300);
  try {
    return JSON.stringify(data).slice(0, 300);
  } catch {
    return '';
  }
}

function buildGatewayErrorMessage(error, fallback = 'TRELLIS.2 request failed.') {
  if (error?.response) {
    const detail = error.gatewayDetail || extractDetail(error.response.data);
    return `Gateway returned ${error.response.status}${detail ? `: ${detail}` : ''}`;
  }
  if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
    return `Unable to reach the AI Gateway at ${DEFAULT_GATEWAY_BASE_URL}.`;
  }
  if (['ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(error?.code)) {
    return 'The TRELLIS.2 generation request timed out.';
  }
  return error?.message || fallback;
}

function buildGenerationFormFields(parameters) {
  return {
    seed: parameters.seed,
    resolution: parameters.resolution,
    preprocess_image: parameters.preprocessImage,
    sparse_structure_steps: parameters.sparseStructureSteps,
    sparse_structure_guidance: parameters.sparseStructureGuidance,
    shape_steps: parameters.shapeSteps,
    shape_guidance: parameters.shapeGuidance,
    texture_steps: parameters.textureSteps,
    texture_guidance: parameters.textureGuidance,
    decimation_target: parameters.decimationTarget,
    texture_size: parameters.textureSize,
    remesh: parameters.remesh,
  };
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') {
    const value = headers.get(name);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  const target = String(name).toLowerCase();
  const key = Object.keys(headers).find((entry) => entry.toLowerCase() === target);
  return key ? headers[key] : null;
}

function finiteHeaderNumber(headers, name) {
  const raw = headerValue(headers, name);
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function extractGenerationResponseMetadata(headers) {
  return {
    gatewayJobId: headerValue(headers, 'x-job-id') || null,
    generationSeconds: finiteHeaderNumber(headers, 'x-generation-seconds'),
    exportSeconds: finiteHeaderNumber(headers, 'x-export-seconds'),
    peakVramMiB: finiteHeaderNumber(headers, 'x-peak-vram-mib'),
    contentType: headerValue(headers, 'content-type') || 'model/gltf-binary',
  };
}

function containerIsRunning(container) {
  if (container?.running === true || container?.container?.running === true) return true;
  const state = String(
    container?.state ||
    container?.status ||
    container?.container?.state ||
    container?.container?.status ||
    '',
  ).toLowerCase();
  return ['running', 'healthy', 'started', 'up'].includes(state);
}

function containerIsUnhealthy(container) {
  if (container?.health?.ok === false || container?.container?.health?.ok === false) return true;
  const healthState = String(
    container?.health?.status ||
    container?.container?.health?.status ||
    '',
  ).toLowerCase();
  return ['unhealthy', 'failed', 'error'].includes(healthState);
}

async function readErrorStream(stream) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
    return extractDetail(stream);
  }

  const chunks = [];
  let capturedBytes = 0;
  for await (const chunk of stream) {
    if (capturedBytes >= MAX_ERROR_BODY_BYTES) continue;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = MAX_ERROR_BODY_BYTES - capturedBytes;
    const captured = buffer.subarray(0, remaining);
    chunks.push(captured);
    capturedBytes += captured.length;
  }
  return extractDetail(Buffer.concat(chunks));
}

async function inspectGlbFile(filePath) {
  const file = await fsPromises.open(filePath, 'r');
  try {
    const stat = await file.stat();
    const header = Buffer.alloc(12);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (bytesRead !== header.length) {
      throw new Error('The generated model is not a complete GLB file.');
    }
    return {
      ...validateGlbHeader(header, stat.size),
      sizeBytes: stat.size,
    };
  } finally {
    await file.close();
  }
}

class Trellis2GatewayService {
  constructor({
    gatewayBaseUrl = DEFAULT_GATEWAY_BASE_URL,
    infoTimeoutMs = DEFAULT_INFO_TIMEOUT_MS,
    actionTimeoutMs = DEFAULT_ACTION_TIMEOUT_MS,
    generateTimeoutMs = DEFAULT_GENERATE_TIMEOUT_MS,
    adminToken = process.env.TRELLIS2_ADMIN_TOKEN || process.env.LLM_ADMIN_TOKEN || '',
  } = {}) {
    this.gatewayBaseUrl = gatewayBaseUrl;
    this.infoTimeoutMs = infoTimeoutMs;
    this.actionTimeoutMs = actionTimeoutMs;
    this.generateTimeoutMs = generateTimeoutMs;
    this.adminToken = adminToken;
  }

  servicePath(path = '') {
    const suffix = String(path || '');
    return `${SERVICE_PREFIX}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
  }

  url(path) {
    return joinUrl(this.gatewayBaseUrl, path);
  }

  async getJson(path, timeout = this.infoTimeoutMs) {
    const response = await axios.get(this.url(this.servicePath(path)), { timeout });
    return response.data;
  }

  getContainerState() {
    return this.getJson('/container');
  }

  getHealth() {
    return this.getJson('/health');
  }

  getLastJob() {
    return this.getJson('/jobs/last');
  }

  async startContainer() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.adminToken) {
      headers['X-Admin-Token'] = this.adminToken;
    }
    const response = await axios.post(
      this.url(this.servicePath('/container/start')),
      { wait: true, timeout_sec: 120 },
      { headers, timeout: this.actionTimeoutMs },
    );
    return response.data;
  }

  async restartContainer() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.adminToken) {
      headers['X-Admin-Token'] = this.adminToken;
    }
    const response = await axios.post(
      this.url(this.servicePath('/container/restart')),
      { wait: true, stop_timeout_sec: 30, start_timeout_sec: 120 },
      { headers, timeout: this.actionTimeoutMs },
    );
    return response.data;
  }

  async ensureContainerRunning() {
    const container = await this.getContainerState();
    if (containerIsRunning(container) && !containerIsUnhealthy(container)) {
      return container;
    }

    if (containerIsRunning(container)) {
      logger.warning('Restarting unhealthy TRELLIS.2 container for queued generation', {
        category: 'trellis2_gateway',
        metadata: { health: container?.health?.status || 'unhealthy' },
      });
      return this.restartContainer();
    }

    logger.notice('Starting TRELLIS.2 container for queued generation', {
      category: 'trellis2_gateway',
      metadata: { state: container?.state || container?.status || 'stopped' },
    });
    return this.startContainer();
  }

  async generateToFile({
    inputPath,
    inputFileName,
    inputMimeType,
    outputPath,
    parameters,
  }) {
    if (!inputPath || !outputPath) {
      throw new Error('Input and output file paths are required for TRELLIS.2 generation.');
    }

    const requestUrl = this.url(this.servicePath('/generate'));
    const formData = new FormData();
    formData.append('image', fs.createReadStream(inputPath), {
      filename: inputFileName || 'image.png',
      contentType: inputMimeType || 'application/octet-stream',
    });
    Object.entries(buildGenerationFormFields(parameters)).forEach(([key, value]) => {
      formData.append(key, String(value));
    });

    const startedAt = Date.now();
    logger.notice('Submitting TRELLIS.2 generation to gateway', {
      category: 'trellis2_gateway',
      metadata: {
        requestUrl,
        inputFileName: inputFileName || null,
        resolution: parameters.resolution,
        textureSize: parameters.textureSize,
        decimationTarget: parameters.decimationTarget,
      },
    });

    try {
      const response = await axios({
        method: 'post',
        url: requestUrl,
        data: formData,
        headers: formData.getHeaders(),
        responseType: 'stream',
        timeout: this.generateTimeoutMs,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      await pipeline(response.data, fs.createWriteStream(outputPath, { flags: 'wx' }));
      const glb = await inspectGlbFile(outputPath);

      logger.notice('TRELLIS.2 gateway generation completed', {
        category: 'trellis2_gateway',
        metadata: {
          status: response.status,
          durationMs: Date.now() - startedAt,
          outputBytes: glb.sizeBytes,
          gatewayJobId: headerValue(response.headers, 'x-job-id'),
        },
      });

      return {
        status: response.status,
        headers: response.headers || {},
        ...glb,
      };
    } catch (error) {
      if (error?.response?.data) {
        try {
          error.gatewayDetail = await readErrorStream(error.response.data);
        } catch (detailError) {
          logger.debug('Unable to read TRELLIS.2 gateway error body', {
            category: 'trellis2_gateway',
            metadata: { message: detailError.message },
          });
        }
      }
      await fsPromises.unlink(outputPath).catch((unlinkError) => {
        if (unlinkError.code !== 'ENOENT') {
          logger.warning('Unable to remove partial TRELLIS.2 output', {
            category: 'trellis2_gateway',
            metadata: { message: unlinkError.message },
          });
        }
      });

      logger.warning('TRELLIS.2 gateway generation failed', {
        category: 'trellis2_gateway',
        metadata: {
          status: error?.response?.status || null,
          code: error?.code || null,
          durationMs: Date.now() - startedAt,
          message: buildGatewayErrorMessage(error),
        },
      });
      throw error;
    }
  }
}

module.exports = Trellis2GatewayService;
module.exports.DEFAULT_GATEWAY_BASE_URL = DEFAULT_GATEWAY_BASE_URL;
module.exports.SERVICE_PREFIX = SERVICE_PREFIX;
module.exports.buildGatewayErrorMessage = buildGatewayErrorMessage;
module.exports.buildGenerationFormFields = buildGenerationFormFields;
module.exports.containerIsRunning = containerIsRunning;
module.exports.containerIsUnhealthy = containerIsUnhealthy;
module.exports.extractDetail = extractDetail;
module.exports.extractGenerationResponseMetadata = extractGenerationResponseMetadata;
module.exports.inspectGlbFile = inspectGlbFile;
