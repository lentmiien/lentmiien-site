const RUNPOD_API_ORIGIN = 'https://api.runpod.io';
const RUNPOD_API_VERSION = 'v2';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_MAX_ERROR_RESPONSE_BYTES = 64 * 1024;
const MAX_BILLING_BUCKETS = 366;
const MAX_PODS = 200;
const MAX_ACCOUNT_TEMPLATES = 500;
const MAX_POD_BILLING_RECORDS = 5000;
const BILLING_BUCKET_SIZES = Object.freeze(['hour', 'day', 'week', 'month', 'year']);
const CLOUD_TYPES = Object.freeze(['SECURE', 'COMMUNITY']);
const POD_ACTIONS = Object.freeze(['start', 'stop', 'restart', 'terminate']);
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
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
  podBilling: '/v2/billing/pods',
  pods: '/v2/pods',
  accountTemplates: '/v2/templates',
});

const ALLOWED_PATHS = new Set(Object.values(ENDPOINTS));
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);

function normalizeResourceId(value, label = 'Runpod resource') {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!RESOURCE_ID_PATTERN.test(id)) {
    throw new TypeError(`${label} ID is invalid.`);
  }
  return id;
}

function podPath(id, suffix = '') {
  const podId = normalizeResourceId(id, 'Runpod pod');
  if (suffix && suffix !== '/action') {
    throw new TypeError('Runpod pod path suffix is invalid.');
  }
  return `/v2/pods/${podId}${suffix}`;
}

function templatePath(id) {
  return `/v2/templates/${normalizeResourceId(id, 'Runpod template')}`;
}

function allowedDynamicPath(pathname) {
  return /^\/v2\/pods\/[A-Za-z0-9_-]{1,128}(?:\/action)?$/u.test(pathname)
    || /^\/v2\/templates\/[A-Za-z0-9_-]{1,128}$/u.test(pathname);
}

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
    providerCode = null,
    providerTitle = null,
    providerDetail = null,
  } = {}) {
    super(message);
    this.name = 'RunpodApiError';
    this.code = code;
    this.operation = operation;
    this.status = status;
    this.providerCode = providerCode;
    this.providerTitle = providerTitle;
    this.providerDetail = providerDetail;
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
  if (!BILLING_BUCKET_SIZES.includes(bucketSize)) {
    throw new TypeError('Unsupported Runpod billing bucket size.');
  }
  const hasStartTime = options.startTime !== undefined && options.startTime !== null;
  const hasEndTime = options.endTime !== undefined && options.endTime !== null;
  if (hasStartTime || hasEndTime) {
    if (!hasStartTime || !hasEndTime || options.lastN !== undefined) {
      throw new TypeError('Runpod billing ranges require both startTime and endTime without lastN.');
    }
    const startTime = new Date(options.startTime);
    const endTime = new Date(options.endTime);
    if (
      Number.isNaN(startTime.getTime())
      || Number.isNaN(endTime.getTime())
      || startTime >= endTime
    ) {
      throw new TypeError('Runpod billing startTime and endTime must be a valid increasing range.');
    }
    return {
      bucketSize,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    };
  }

  const lastN = Number(options.lastN ?? 30);
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

function sanitizeProviderErrorText(value, maxLength, secrets = []) {
  if (value === undefined || value === null) return '';
  let text = String(value)
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  secrets
    .filter((secret) => typeof secret === 'string' && secret.length >= 4)
    .forEach((secret) => {
      text = text.split(secret).join('[redacted]');
    });
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [redacted]')
    .replace(/\b(api[_ -]?key|authorization|token|secret)\s*[:=]\s*[^,;\s]+/giu, '$1=[redacted]')
    .slice(0, maxLength);
}

function firstProviderErrorObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (body.error && typeof body.error === 'object' && !Array.isArray(body.error)) {
    return body.error;
  }
  if (Array.isArray(body.errors)) {
    return body.errors.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
      || body;
  }
  return body;
}

function extractProviderErrorDetails(responseText, secrets = []) {
  let body;
  try {
    body = JSON.parse(responseText);
  } catch (_) {
    return { providerCode: null, providerTitle: null, providerDetail: null };
  }
  const nested = firstProviderErrorObject(body);
  if (!nested) {
    return { providerCode: null, providerTitle: null, providerDetail: null };
  }
  const root = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const stringError = typeof root.error === 'string' ? root.error : '';
  const providerCode = sanitizeProviderErrorText(
    nested.code ?? nested.errorCode ?? root.code ?? root.errorCode ?? nested.type ?? root.type,
    120,
    secrets
  ) || null;
  const providerTitle = sanitizeProviderErrorText(
    nested.title ?? root.title ?? stringError,
    240,
    secrets
  ) || null;
  const providerDetail = sanitizeProviderErrorText(
    nested.detail
      ?? nested.message
      ?? nested.description
      ?? root.detail
      ?? root.message
      ?? root.description
      ?? stringError,
    1000,
    secrets
  ) || null;
  return { providerCode, providerTitle, providerDetail };
}

async function readProviderErrorDetails(response, maxResponseBytes, operation, secrets = []) {
  try {
    const responseText = await readResponseText(
      response,
      Math.min(maxResponseBytes, DEFAULT_MAX_ERROR_RESPONSE_BYTES),
      operation
    );
    return extractProviderErrorDetails(responseText, secrets);
  } catch (_) {
    return { providerCode: null, providerTitle: null, providerDetail: null };
  }
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

function ensurePodBilling(body) {
  if (
    !body
    || typeof body !== 'object'
    || !Array.isArray(body.records)
    || !body.metadata
    || typeof body.metadata !== 'object'
  ) {
    throw new RunpodApiError('Runpod returned an invalid response for pod billing history.', {
      code: 'RUNPOD_INVALID_RESPONSE',
      operation: 'pod billing history',
    });
  }
  if (body.records.length > MAX_POD_BILLING_RECORDS) {
    throw new RunpodApiError('Runpod returned too many pod billing records.', {
      code: 'RUNPOD_RESPONSE_TOO_LARGE',
      operation: 'pod billing history',
    });
  }
  return body;
}

function ensureResource(body, operation) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RunpodApiError(`Runpod returned an invalid response for ${operation}.`, {
      code: 'RUNPOD_INVALID_RESPONSE',
      operation,
    });
  }
  normalizeResourceId(body.id, 'Returned Runpod resource');
  return body;
}

function normalizeCloudType(value) {
  const cloud = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!CLOUD_TYPES.includes(cloud)) {
    throw new TypeError('Runpod cloud must be SECURE or COMMUNITY.');
  }
  return cloud;
}

function normalizePodAction(value) {
  const action = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!POD_ACTIONS.includes(action)) {
    throw new TypeError('Unsupported Runpod pod action.');
  }
  return action;
}

class RunpodApiV2Service {
  constructor({
    apiKey = process.env.RUNPOD_API_KEY,
    fetchImpl = global.fetch,
    timeoutMs = positiveInteger(process.env.RUNPOD_API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    cacheTtlMs = nonNegativeInteger(process.env.RUNPOD_API_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS),
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
    now = () => Date.now(),
  } = {}) {
    this.apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    this.fetch = fetchImpl;
    this.timeoutMs = positiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS);
    this.cacheTtlMs = nonNegativeInteger(cacheTtlMs, DEFAULT_CACHE_TTL_MS);
    this.maxResponseBytes = positiveInteger(maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES);
    this.maxRequestBytes = positiveInteger(maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES);
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
    if (!ALLOWED_PATHS.has(pathname) && !allowedDynamicPath(pathname)) {
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

  async requestJson(pathname, {
    query = {},
    operation = 'request',
    method = 'GET',
    body,
  } = {}) {
    this.ensureConfigured();
    const normalizedMethod = typeof method === 'string' ? method.toUpperCase() : '';
    if (!ALLOWED_METHODS.has(normalizedMethod)) {
      throw new RunpodApiError('The Runpod API method is not allowed.', {
        code: 'RUNPOD_METHOD_NOT_ALLOWED',
        operation,
      });
    }
    if (normalizedMethod === 'GET' && body !== undefined) {
      throw new RunpodApiError('A Runpod GET request cannot include a body.', {
        code: 'RUNPOD_INVALID_REQUEST',
        operation,
      });
    }

    const url = this.buildUrl(pathname, query);
    let serializedBody;
    if (body !== undefined) {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new RunpodApiError('The Runpod API request body is invalid.', {
          code: 'RUNPOD_INVALID_REQUEST',
          operation,
        });
      }
      serializedBody = JSON.stringify(body);
      if (Buffer.byteLength(serializedBody, 'utf8') > this.maxRequestBytes) {
        throw new RunpodApiError('The Runpod API request is too large.', {
          code: 'RUNPOD_REQUEST_TOO_LARGE',
          operation,
        });
      }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers = {
        Accept: 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'User-Agent': 'lentmiien-site-runpod-v2/2.0',
      };
      if (serializedBody !== undefined) {
        headers['Content-Type'] = 'application/json';
      }
      const response = await this.fetch(url, {
        method: normalizedMethod,
        headers,
        ...(serializedBody === undefined ? {} : { body: serializedBody }),
        redirect: 'error',
        signal: controller.signal,
      });

      if (!response.ok) {
        const providerError = await readProviderErrorDetails(
          response,
          this.maxResponseBytes,
          operation,
          [this.apiKey]
        );
        throw new RunpodApiError(`Runpod could not load ${operation} (HTTP ${response.status}).`, {
          code: 'RUNPOD_HTTP_ERROR',
          operation,
          status: response.status,
          ...providerError,
        });
      }

      if (response.status === 204 || response.status === 205) {
        await cancelResponseBody(response);
        return null;
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
      if (!responseText.trim()) {
        throw new RunpodApiError(`Runpod returned an invalid response for ${operation}.`, {
          code: 'RUNPOD_INVALID_RESPONSE',
          operation,
          status: response.status,
        });
      }
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

  getGpuTypes({ forceRefresh = false, cloud = 'SECURE' } = {}) {
    const normalizedCloud = normalizeCloudType(cloud);
    return this.loadCached(`catalog:gpus:pod:${normalizedCloud}`, async () => {
      const body = await this.requestJson(ENDPOINTS.gpus, {
        operation: 'the GPU catalog',
        query: { include: 'AVAILABILITY', product: 'POD', cloud: normalizedCloud },
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
    const cacheKey = `billing:${JSON.stringify(filters)}`;
    return this.loadCached(cacheKey, async () => {
      const body = await this.requestJson(ENDPOINTS.billing, {
        operation: 'billing history',
        query: filters,
      });
      return ensureBilling(body);
    }, { forceRefresh });
  }

  async getPodBilling(options = {}) {
    const { forceRefresh = false } = options;
    const filters = normalizeBillingOptions(options);
    const podId = options.podId === undefined || options.podId === null || options.podId === ''
      ? null
      : normalizeResourceId(options.podId, 'Runpod pod');
    const cacheKey = `billing:pods:${JSON.stringify(filters)}:${podId || 'all'}`;
    return this.loadCached(cacheKey, async () => {
      const body = await this.requestJson(ENDPOINTS.podBilling, {
        operation: 'pod billing history',
        query: { ...filters, ...(podId ? { podId } : {}) },
      });
      return ensurePodBilling(body);
    }, { forceRefresh });
  }

  async listPods() {
    const body = await this.requestJson(ENDPOINTS.pods, {
      operation: 'the pod list',
    });
    return ensureCollection(body, 'pods', 'the pod list', MAX_PODS);
  }

  async getPod(id) {
    const body = await this.requestJson(podPath(id), {
      operation: 'the pod',
    });
    return ensureResource(body, 'the pod');
  }

  async createPod(input) {
    const body = await this.requestJson(ENDPOINTS.pods, {
      method: 'POST',
      body: input,
      operation: 'pod creation',
    });
    return ensureResource(body, 'pod creation');
  }

  async transitionPod(id, action) {
    const normalizedAction = normalizePodAction(action);
    const body = await this.requestJson(podPath(id, '/action'), {
      method: 'POST',
      body: { action: normalizedAction },
      operation: `pod ${normalizedAction}`,
    });
    if (normalizedAction === 'terminate') return null;
    return ensureResource(body, `pod ${normalizedAction}`);
  }

  async deletePod(id) {
    await this.requestJson(podPath(id), {
      method: 'DELETE',
      operation: 'pod termination',
    });
    return true;
  }

  async getAccountTemplates() {
    const body = await this.requestJson(ENDPOINTS.accountTemplates, {
      operation: 'account templates',
    });
    return ensureCollection(
      body,
      'templates',
      'account templates',
      MAX_ACCOUNT_TEMPLATES
    );
  }

  async createTemplate(input) {
    const body = await this.requestJson(ENDPOINTS.accountTemplates, {
      method: 'POST',
      body: input,
      operation: 'template creation',
    });
    return ensureResource(body, 'template creation');
  }

  async updateTemplate(id, input) {
    const body = await this.requestJson(templatePath(id), {
      method: 'PATCH',
      body: input,
      operation: 'template update',
    });
    return ensureResource(body, 'template update');
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
  CLOUD_TYPES,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_MAX_ERROR_RESPONSE_BYTES,
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  ENDPOINTS,
  MAX_BILLING_BUCKETS,
  MAX_ACCOUNT_TEMPLATES,
  MAX_POD_BILLING_RECORDS,
  MAX_PODS,
  POD_ACTIONS,
  RESOURCE_ID_PATTERN,
  RUNPOD_API_ORIGIN,
  RUNPOD_API_VERSION,
  RunpodApiError,
  RunpodApiV2Service,
  RunpodConfigurationError,
  cancelResponseBody,
  extractProviderErrorDetails,
  normalizeBillingOptions,
  normalizeCloudType,
  normalizePodAction,
  normalizeResourceId,
  podPath,
  publicRunpodError,
  readResponseText,
  templatePath,
};
