const RUNPOD_API_ORIGIN = 'https://api.runpod.io';
const RUNPOD_API_VERSION = 'v2';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_BILLING_BUCKETS = 366;
const BILLING_BUCKET_SIZES = Object.freeze(['hour', 'day', 'week', 'month', 'year']);
const CATALOG_ITEM_LIMITS = Object.freeze({
  gpus: 500,
  cpus: 200,
  dataCenters: 500,
  templates: 500,
});

const ENDPOINTS = Object.freeze({
  openapi: '/v2/openapi.json',
  gpus: '/v2/catalog/gpus',
  cpus: '/v2/catalog/cpus',
  dataCenters: '/v2/catalog/datacenters',
  templates: '/v2/catalog/templates',
  billing: '/v2/billing',
});

const ALLOWED_PATHS = new Set(Object.values(ENDPOINTS));

class RunpodConfigurationError extends Error {
  constructor(message = 'RUNPOD_API_KEY is not configured.') {
    super(message);
    this.name = 'RunpodConfigurationError';
    this.code = 'RUNPOD_NOT_CONFIGURED';
  }
}

class RunpodApiError extends Error {
  constructor(message, {
    code = 'RUNPOD_API_ERROR',
    operation = null,
    status = null,
  } = {}) {
    super(message);
    this.name = 'RunpodApiError';
    this.code = code;
    this.operation = operation;
    this.status = status;
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeBillingOptions(options = {}) {
  const bucketSize = typeof options.bucketSize === 'string'
    ? options.bucketSize
    : 'day';
  const lastN = Number(options.lastN ?? 30);

  if (!BILLING_BUCKET_SIZES.includes(bucketSize)) {
    throw new TypeError('Unsupported Runpod billing bucket size.');
  }
  if (!Number.isSafeInteger(lastN) || lastN < 1 || lastN > MAX_BILLING_BUCKETS) {
    throw new TypeError(`Runpod billing lastN must be between 1 and ${MAX_BILLING_BUCKETS}.`);
  }

  return { bucketSize, lastN };
}

function publicRunpodError(error) {
  if (error instanceof RunpodConfigurationError) {
    return {
      code: error.code,
      status: null,
      message: 'Runpod is not configured on this server.',
    };
  }
  if (error instanceof RunpodApiError) {
    return {
      code: error.code,
      status: error.status,
      message: error.message,
    };
  }
  return {
    code: 'RUNPOD_API_ERROR',
    status: null,
    message: 'The Runpod API request failed.',
  };
}

async function cancelResponseBody(response) {
  try {
    await response?.body?.cancel?.();
  } catch (_) {
    // Ignore cancellation failures; the original response error is authoritative.
  }
}

async function readResponseText(response, maxResponseBytes, operation) {
  const contentLength = Number.parseInt(response.headers?.get?.('content-length'), 10);
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    await cancelResponseBody(response);
    throw new RunpodApiError(`Runpod returned too much data for ${operation}.`, {
      code: 'RUNPOD_RESPONSE_TOO_LARGE',
      operation,
      status: response.status,
    });
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) {
      throw new RunpodApiError(`Runpod returned too much data for ${operation}.`, {
        code: 'RUNPOD_RESPONSE_TOO_LARGE',
        operation,
        status: response.status,
      });
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxResponseBytes) {
      await reader.cancel().catch(() => {});
      throw new RunpodApiError(`Runpod returned too much data for ${operation}.`, {
        code: 'RUNPOD_RESPONSE_TOO_LARGE',
        operation,
        status: response.status,
      });
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function ensureCollection(body, propertyName, operation, maxItems) {
  if (!body || typeof body !== 'object' || !Array.isArray(body[propertyName])) {
    throw new RunpodApiError(`Runpod returned an invalid response for ${operation}.`, {
      code: 'RUNPOD_INVALID_RESPONSE',
      operation,
    });
  }
  if (body[propertyName].length > maxItems) {
    throw new RunpodApiError(`Runpod returned too many items for ${operation}.`, {
      code: 'RUNPOD_RESPONSE_TOO_LARGE',
      operation,
    });
  }
  return body[propertyName];
}

function ensureBilling(body) {
  if (
    !body
    || typeof body !== 'object'
    || !Array.isArray(body.records)
    || !body.metadata
    || typeof body.metadata !== 'object'
  ) {
    throw new RunpodApiError('Runpod returned an invalid response for billing history.', {
      code: 'RUNPOD_INVALID_RESPONSE',
      operation: 'billing history',
    });
  }
  if (body.records.length > MAX_BILLING_BUCKETS) {
    throw new RunpodApiError('Runpod returned too many billing records.', {
      code: 'RUNPOD_RESPONSE_TOO_LARGE',
      operation: 'billing history',
    });
  }
  return body;
}

class RunpodApiV2Service {
  constructor({
    apiKey = process.env.RUNPOD_API_KEY,
    fetchImpl = global.fetch,
    timeoutMs = positiveInteger(process.env.RUNPOD_API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    cacheTtlMs = nonNegativeInteger(process.env.RUNPOD_API_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS),
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    now = () => Date.now(),
  } = {}) {
    this.apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    this.fetch = fetchImpl;
    this.timeoutMs = positiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS);
    this.cacheTtlMs = nonNegativeInteger(cacheTtlMs, DEFAULT_CACHE_TTL_MS);
    this.maxResponseBytes = positiveInteger(maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES);
    this.now = now;
    this.cache = new Map();
  }

  ensureConfigured() {
    if (!this.apiKey || /[\r\n]/u.test(this.apiKey)) {
      throw new RunpodConfigurationError();
    }
    if (typeof this.fetch !== 'function') {
      throw new RunpodConfigurationError('A Fetch implementation is required.');
    }
  }

  buildUrl(pathname, query = {}) {
    if (!ALLOWED_PATHS.has(pathname)) {
      throw new RunpodApiError('The Runpod API path is not allowed.', {
        code: 'RUNPOD_PATH_NOT_ALLOWED',
      });
    }

    const url = new URL(pathname, RUNPOD_API_ORIGIN);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return url;
  }

  async requestJson(pathname, { query = {}, operation = 'request' } = {}) {
    this.ensureConfigured();
    const url = this.buildUrl(pathname, query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'User-Agent': 'lentmiien-site-runpod-v2/1.0',
        },
        redirect: 'error',
        signal: controller.signal,
      });

      if (!response.ok) {
        await cancelResponseBody(response);
        throw new RunpodApiError(`Runpod could not load ${operation} (HTTP ${response.status}).`, {
          code: 'RUNPOD_HTTP_ERROR',
          operation,
          status: response.status,
        });
      }

      const contentType = response.headers?.get?.('content-type') || '';
      if (contentType && !contentType.toLowerCase().includes('json')) {
        await cancelResponseBody(response);
        throw new RunpodApiError(`Runpod returned an invalid response for ${operation}.`, {
          code: 'RUNPOD_INVALID_RESPONSE',
          operation,
          status: response.status,
        });
      }

      const responseText = await readResponseText(response, this.maxResponseBytes, operation);
      try {
        return JSON.parse(responseText);
      } catch (_) {
        throw new RunpodApiError(`Runpod returned invalid JSON for ${operation}.`, {
          code: 'RUNPOD_INVALID_RESPONSE',
          operation,
          status: response.status,
        });
      }
    } catch (error) {
      if (error instanceof RunpodApiError || error instanceof RunpodConfigurationError) {
        throw error;
      }
      if (error?.name === 'AbortError') {
        throw new RunpodApiError(`Runpod timed out while loading ${operation}.`, {
          code: 'RUNPOD_TIMEOUT',
          operation,
        });
      }
      throw new RunpodApiError(`Runpod could not load ${operation}.`, {
        code: 'RUNPOD_NETWORK_ERROR',
        operation,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  loadCached(cacheKey, loader, { forceRefresh = false } = {}) {
    const inFlight = this.cache.get(cacheKey);
    if (inFlight?.promise) {
      return inFlight.promise;
    }
    if (forceRefresh) {
      this.cache.delete(cacheKey);
    }

    const cached = this.cache.get(cacheKey);
    if (cached?.promise) {
      return cached.promise;
    }
    if (cached && cached.expiresAt > this.now()) {
      return Promise.resolve(cached.value);
    }

    const promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        if (this.cacheTtlMs > 0) {
          this.cache.set(cacheKey, {
            value,
            expiresAt: this.now() + this.cacheTtlMs,
          });
        } else {
          this.cache.delete(cacheKey);
        }
        return value;
      })
      .catch((error) => {
        this.cache.delete(cacheKey);
        throw error;
      });

    this.cache.set(cacheKey, { promise, expiresAt: 0 });
    return promise;
  }

  async getApiMetadata({ forceRefresh = false } = {}) {
    return this.loadCached('openapi', async () => {
      const body = await this.requestJson(ENDPOINTS.openapi, {
        operation: 'the v2 API description',
      });
      const version = typeof body?.info?.version === 'string' ? body.info.version : '';
      if (!version.startsWith('2.')) {
        throw new RunpodApiError('Runpod did not return an API v2 description.', {
          code: 'RUNPOD_VERSION_MISMATCH',
          operation: 'the v2 API description',
        });
      }
      return {
        openapi: typeof body.openapi === 'string' ? body.openapi : 'unknown',
        title: typeof body?.info?.title === 'string' ? body.info.title : 'Runpod REST API',
        version,
      };
    }, { forceRefresh });
  }

  getGpuTypes({ forceRefresh = false } = {}) {
    return this.loadCached('catalog:gpus:pod', async () => {
      const body = await this.requestJson(ENDPOINTS.gpus, {
        operation: 'the GPU catalog',
        query: { include: 'AVAILABILITY', product: 'POD', cloud: 'SECURE' },
      });
      return ensureCollection(body, 'gpus', 'the GPU catalog', CATALOG_ITEM_LIMITS.gpus);
    }, { forceRefresh });
  }

  getCpuTypes({ forceRefresh = false } = {}) {
    return this.loadCached('catalog:cpus:pod', async () => {
      const body = await this.requestJson(ENDPOINTS.cpus, {
        operation: 'the CPU catalog',
        query: { include: 'AVAILABILITY', product: 'POD' },
      });
      return ensureCollection(body, 'cpus', 'the CPU catalog', CATALOG_ITEM_LIMITS.cpus);
    }, { forceRefresh });
  }

  getDataCenters({ forceRefresh = false } = {}) {
    return this.loadCached('catalog:data-centers', async () => {
      const body = await this.requestJson(ENDPOINTS.dataCenters, {
        operation: 'the data center catalog',
      });
      return ensureCollection(
        body,
        'dataCenters',
        'the data center catalog',
        CATALOG_ITEM_LIMITS.dataCenters
      );
    }, { forceRefresh });
  }

  getOfficialTemplates({ forceRefresh = false } = {}) {
    return this.loadCached('catalog:templates:official', async () => {
      const body = await this.requestJson(ENDPOINTS.templates, {
        operation: 'the official template catalog',
        query: { source: 'official' },
      });
      return ensureCollection(
        body,
        'templates',
        'the official template catalog',
        CATALOG_ITEM_LIMITS.templates
      );
    }, { forceRefresh });
  }

  async getBilling(options = {}) {
    const { forceRefresh = false } = options;
    const filters = normalizeBillingOptions(options);
    const cacheKey = `billing:${filters.bucketSize}:${filters.lastN}`;
    return this.loadCached(cacheKey, async () => {
      const body = await this.requestJson(ENDPOINTS.billing, {
        operation: 'billing history',
        query: filters,
      });
      return ensureBilling(body);
    }, { forceRefresh });
  }

  async getDashboard({ bucketSize = 'day', lastN = 30, forceRefresh = false } = {}) {
    this.ensureConfigured();
    const filters = normalizeBillingOptions({ bucketSize, lastN });
    const operations = {
      gpus: () => this.getGpuTypes({ forceRefresh }),
      cpus: () => this.getCpuTypes({ forceRefresh }),
      dataCenters: () => this.getDataCenters({ forceRefresh }),
      templates: () => this.getOfficialTemplates({ forceRefresh }),
      billing: () => this.getBilling({ ...filters, forceRefresh }),
    };

    const entries = Object.entries(operations);
    const settled = await Promise.allSettled(entries.map(([, operation]) => operation()));
    const result = {
      apiVersion: RUNPOD_API_VERSION,
      fetchedAt: new Date(this.now()).toISOString(),
      filters,
      gpus: [],
      cpus: [],
      dataCenters: [],
      templates: [],
      billing: {
        records: [],
        metadata: {
          recordCount: 0,
          totals: {},
        },
      },
      errors: {},
    };

    settled.forEach((entry, index) => {
      const section = entries[index][0];
      if (entry.status === 'fulfilled') {
        result[section] = entry.value;
      } else {
        result.errors[section] = publicRunpodError(entry.reason);
      }
    });

    return result;
  }
}

module.exports = {
  BILLING_BUCKET_SIZES,
  CATALOG_ITEM_LIMITS,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  ENDPOINTS,
  MAX_BILLING_BUCKETS,
  RUNPOD_API_ORIGIN,
  RUNPOD_API_VERSION,
  RunpodApiError,
  RunpodApiV2Service,
  RunpodConfigurationError,
  cancelResponseBody,
  normalizeBillingOptions,
  publicRunpodError,
  readResponseText,
};
