const logger = require('../utils/logger');
const {
  RunpodOperationEvent,
  RunpodPod,
  RunpodWorkloadTemplate,
} = require('../database');
const {
  RunpodApiError,
  RunpodApiV2Service,
} = require('./runpodApiV2Service');

const OLLAMA_TEMPLATE_SLUG = 'ollama';
const OLLAMA_PROVIDER_TEMPLATE_NAME = 'lentmiien-ollama-gpu-v2';
const OLLAMA_IMAGE = 'ollama/ollama:latest';
const OLLAMA_MODEL = 'qwen2.5:0.5b';
const OLLAMA_PORT = 11434;
const OLLAMA_PERSISTENT_PATH = '/root/.ollama';
const OLLAMA_PUBLIC_URL_SUFFIX = '.proxy.runpod.net';
const ACTIVE_PROVIDER_STATUSES = new Set(['PROVISIONING', 'STARTING', 'RUNNING']);
const PROVIDER_STATUSES = new Set([
  'PROVISIONING',
  'STARTING',
  'RUNNING',
  'EXITED',
  'ERROR',
  'TERMINATED',
]);
const PROVIDER_ACTIONS = new Set(['start', 'stop', 'restart', 'terminate']);
const AVAILABLE_STOCK = new Set(['LOW', 'MEDIUM', 'HIGH']);
const MODEL_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,79}(?::[a-z0-9][a-z0-9._-]{0,39})?$/;
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const POD_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,79}$/u;
const IMAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/@:+-]{0,498}$/;
const PROXY_POD_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_LOCAL_PODS = 200;
const MAX_PROVIDER_PODS = 200;
const MAX_PROVIDER_TEMPLATES = 500;
const DEFAULT_MAX_ACTIVE_PODS = 2;
const DEFAULT_MAX_GPU_COUNT = 4;
const DEFAULT_MAX_HOURLY_COST_USD = 10;
const DEFAULT_AUTO_STOP_MINUTES = 60;
const DEFAULT_MAX_RUNTIME_MINUTES = 24 * 60;
const DEFAULT_PROVISION_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_OLLAMA_PULL_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const OLLAMA_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const DEFAULT_STORAGE_RATES = Object.freeze({
  containerRunningUsdPerGbMonth: 0.10,
  volumeRunningUsdPerGbMonth: 0.10,
  volumeStoppedUsdPerGbMonth: 0.20,
  hoursPerMonth: 730,
});

class RunpodManagementError extends Error {
  constructor(message, {
    code = 'RUNPOD_MANAGEMENT_ERROR',
    status = 400,
    providerStatus = null,
  } = {}) {
    super(message);
    this.name = 'RunpodManagementError';
    this.code = code;
    this.status = status;
    this.providerStatus = providerStatus;
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function strictInteger(value, { label, min, max }) {
  const raw = typeof value === 'number' ? String(value) : String(value || '').trim();
  if (!/^\d+$/u.test(raw)) {
    throw new RunpodManagementError(`${label} must be a whole number.`, {
      code: 'RUNPOD_INPUT_INVALID',
    });
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new RunpodManagementError(`${label} must be between ${min} and ${max}.`, {
      code: 'RUNPOD_INPUT_INVALID',
    });
  }
  return parsed;
}

function strictMoney(value, { label, min = 0.01, max }) {
  const raw = String(value || '').trim();
  if (!/^\d+(?:\.\d{1,4})?$/u.test(raw)) {
    throw new RunpodManagementError(`${label} must be a valid USD amount.`, {
      code: 'RUNPOD_INPUT_INVALID',
    });
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new RunpodManagementError(`${label} must be between $${min} and $${max}.`, {
      code: 'RUNPOD_INPUT_INVALID',
    });
  }
  return parsed;
}

function safeString(value, maxLength = 240) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength);
}

function safeArray(value, maxItems = 20, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((entry) => safeString(entry, maxLength))
    .filter(Boolean);
}

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedNumber(value, fallback, min, max) {
  const number = finiteNumber(value, fallback);
  return Math.min(max, Math.max(min, number));
}

function normalizeProviderStatus(value) {
  const status = safeString(value, 30).toUpperCase();
  return PROVIDER_STATUSES.has(status) ? status : 'UNKNOWN';
}

function lifecycleGroupForStatus(status, archivedAt = null) {
  if (archivedAt || status === 'TERMINATED') return 'archived';
  if (status === 'EXITED' || status === 'ERROR') return 'stopped';
  return 'running';
}

function normalizeActions(value) {
  return safeArray(value, 10, 20)
    .map((entry) => entry.toLowerCase())
    .filter((entry) => PROVIDER_ACTIONS.has(entry));
}

function actorFromPrincipal(principal = {}) {
  return {
    id: principal?._id || principal?.id || null,
    name: safeString(principal?.name || 'system', 100) || 'system',
  };
}

function publicOllamaUrl(providerPodId, port = OLLAMA_PORT) {
  const id = safeString(providerPodId, 63).toLowerCase();
  if (!PROXY_POD_ID_PATTERN.test(id)) {
    throw new RunpodManagementError('Runpod returned a pod ID that cannot be used for a proxy URL.', {
      code: 'RUNPOD_INVALID_RESPONSE',
      status: 502,
    });
  }
  const normalizedPort = strictInteger(port, {
    label: 'Service port',
    min: 1,
    max: 65535,
  });
  if (`${id}-${normalizedPort}`.length > 63) {
    throw new RunpodManagementError('Runpod returned a pod ID that cannot be used for a proxy URL.', {
      code: 'RUNPOD_INVALID_RESPONSE',
      status: 502,
    });
  }
  return `https://${id}-${normalizedPort}${OLLAMA_PUBLIC_URL_SUFFIX}`;
}

function normalizeModelName(value, fallback = OLLAMA_MODEL) {
  const model = safeString(value || fallback, 120).toLowerCase();
  if (!MODEL_PATTERN.test(model)) {
    throw new RunpodManagementError('Choose a valid Ollama model name.', {
      code: 'RUNPOD_INPUT_INVALID',
    });
  }
  return model;
}

function normalizePodName(value) {
  const name = safeString(value, 80);
  if (!POD_NAME_PATTERN.test(name)) {
    throw new RunpodManagementError(
      'Pod name must start with a letter or number and use at most 80 letters, numbers, spaces, dots, dashes, or underscores.',
      { code: 'RUNPOD_INPUT_INVALID' }
    );
  }
  return name;
}

function normalizeImage(value) {
  const image = safeString(value || OLLAMA_IMAGE, 500);
  if (!IMAGE_PATTERN.test(image)) {
    throw new RunpodManagementError('Choose a valid public container image reference.', {
      code: 'RUNPOD_INPUT_INVALID',
    });
  }
  return image;
}

function normalizeTemplateInput(input = {}) {
  return {
    slug: OLLAMA_TEMPLATE_SLUG,
    name: 'Ollama GPU',
    description: 'Ollama GPU service with persistent models and an automatic post-start model pull.',
    providerTemplateName: normalizePodName(
      input.providerTemplateName || OLLAMA_PROVIDER_TEMPLATE_NAME
    ),
    image: normalizeImage(input.image),
    args: '',
    diskGb: strictInteger(input.diskGb || 20, {
      label: 'Container disk', min: 5, max: 500,
    }),
    ports: [`${OLLAMA_PORT}/http`],
    env: {
      OLLAMA_HOST: `0.0.0.0:${OLLAMA_PORT}`,
      OLLAMA_MODELS: `${OLLAMA_PERSISTENT_PATH}/models`,
    },
    persistentDiskGb: strictInteger(input.persistentDiskGb || 10, {
      label: 'Persistent disk', min: 10, max: 1000,
    }),
    persistentPath: OLLAMA_PERSISTENT_PATH,
    startSsh: false,
    startJupyter: false,
    setupKind: 'ollama_pull',
    defaultModel: normalizeModelName(input.defaultModel),
    servicePort: OLLAMA_PORT,
    healthPath: '/api/tags',
    active: true,
  };
}

function providerTemplatePayload(template) {
  return {
    name: template.providerTemplateName,
    image: template.image,
    args: template.args,
    category: 'NVIDIA',
    disk: template.diskGb,
    ports: template.ports,
    env: template.env,
    mounts: {
      persistent: {
        size: template.persistentDiskGb,
        path: template.persistentPath,
      },
    },
    serverless: false,
    public: false,
    startSsh: false,
    startJupyter: false,
  };
}

function dateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function usageStateForStatus(status, archivedAt = null) {
  const normalizedStatus = normalizeProviderStatus(status);
  if (archivedAt || normalizedStatus === 'TERMINATED') return 'archived';
  if (ACTIVE_PROVIDER_STATUSES.has(normalizedStatus)) return 'running';
  if (normalizedStatus === 'EXITED' || normalizedStatus === 'ERROR') return 'stopped';
  return 'unknown';
}

function nonNegativeNumber(value, fallback = 0) {
  const number = finiteNumber(value, fallback);
  return Math.max(number ?? fallback, 0);
}

function usageFieldsForObservation(
  localPod = {},
  providerPod = {},
  observedAt = new Date(),
  { archivedAt = null } = {}
) {
  const local = podToPlain(localPod) || {};
  const observation = dateOrNull(observedAt) || new Date();
  const providerStatus = typeof providerPod === 'string'
    ? providerPod
    : providerPod?.status;
  const nextState = usageStateForStatus(providerStatus, archivedAt);
  if (local.usageTrackingMode === 'billing_only') {
    return {
      usageState: archivedAt ? 'archived' : nextState,
      usageLastObservedAt: observation,
    };
  }

  const localState = ['running', 'stopped', 'archived'].includes(local.usageState)
    ? local.usageState
    : usageStateForStatus(local.providerStatus, local.archivedAt);
  let stateEnteredAt = dateOrNull(local.usageStateEnteredAt)
    || dateOrNull(local.usageLastObservedAt)
    || dateOrNull(local.lastProviderSyncAt);
  if (!stateEnteredAt && localState === 'running') {
    stateEnteredAt = dateOrNull(providerPod?.startedAt)
      || dateOrNull(local.providerStartedAt)
      || dateOrNull(providerPod?.createdAt)
      || dateOrNull(local.providerCreatedAt);
  }
  if (!stateEnteredAt || stateEnteredAt > observation) stateEnteredAt = observation;

  const elapsedMs = Math.max(0, observation.getTime() - stateEnteredAt.getTime());
  const runningMs = nonNegativeNumber(local.runningMs)
    + (localState === 'running' ? elapsedMs : 0);
  const stoppedMs = nonNegativeNumber(local.stoppedMs)
    + (localState === 'stopped' ? elapsedMs : 0);
  const providerRate = typeof providerPod === 'object'
    ? finiteNumber(providerPod?.cost)
    : null;
  const lastRunningCostPerHour = finiteNumber(
    local.lastRunningCostPerHour,
    finiteNumber(local.estimatedCostPerHour, providerRate > 0 ? providerRate : null)
  );

  return {
    usageTrackingMode: 'observed',
    usageState: nextState,
    usageTrackedSinceAt: dateOrNull(local.usageTrackedSinceAt) || stateEnteredAt,
    usageStateEnteredAt: observation,
    usageLastObservedAt: observation,
    runningMs,
    stoppedMs,
    lastRunningCostPerHour,
  };
}

function projectPodUsage(localPod = {}, providerPod = {}, now = new Date()) {
  const local = podToPlain(localPod) || {};
  const trackingAvailable = local.usageTrackingMode === 'observed'
    && Boolean(
      dateOrNull(local.usageTrackedSinceAt)
      || dateOrNull(local.usageStateEnteredAt)
      || nonNegativeNumber(local.runningMs)
      || nonNegativeNumber(local.stoppedMs)
    );
  const projected = trackingAvailable
    ? usageFieldsForObservation(local, providerPod, now, { archivedAt: local.archivedAt })
    : local;
  const runningMs = nonNegativeNumber(projected.runningMs);
  const stoppedMs = nonNegativeNumber(projected.stoppedMs);
  const runningHours = runningMs / MILLISECONDS_PER_HOUR;
  const stoppedHours = stoppedMs / MILLISECONDS_PER_HOUR;
  const rates = {
    containerRunningUsdPerGbMonth: nonNegativeNumber(
      local.storageRates?.containerRunningUsdPerGbMonth,
      DEFAULT_STORAGE_RATES.containerRunningUsdPerGbMonth
    ),
    volumeRunningUsdPerGbMonth: nonNegativeNumber(
      local.storageRates?.volumeRunningUsdPerGbMonth,
      DEFAULT_STORAGE_RATES.volumeRunningUsdPerGbMonth
    ),
    volumeStoppedUsdPerGbMonth: nonNegativeNumber(
      local.storageRates?.volumeStoppedUsdPerGbMonth,
      DEFAULT_STORAGE_RATES.volumeStoppedUsdPerGbMonth
    ),
    hoursPerMonth: positiveNumber(
      local.storageRates?.hoursPerMonth,
      DEFAULT_STORAGE_RATES.hoursPerMonth
    ),
  };
  const containerDiskGb = nonNegativeNumber(local.diskGb);
  const persistentDiskGb = nonNegativeNumber(local.persistentDiskGb);
  const computeRate = nonNegativeNumber(
    local.lastRunningCostPerHour,
    nonNegativeNumber(local.estimatedCostPerHour)
  );
  const estimatedComputeUsd = runningHours * computeRate;
  const estimatedStorageUsd = (
    runningHours * (
      containerDiskGb * rates.containerRunningUsdPerGbMonth
      + persistentDiskGb * rates.volumeRunningUsdPerGbMonth
    )
    + stoppedHours * persistentDiskGb * rates.volumeStoppedUsdPerGbMonth
  ) / rates.hoursPerMonth;

  return {
    trackingAvailable,
    usageState: safeString(projected.usageState, 20) || 'unknown',
    trackedSinceAt: projected.usageTrackedSinceAt || null,
    lastObservedAt: projected.usageLastObservedAt || null,
    runningMs,
    stoppedMs,
    lifetimeMs: runningMs + stoppedMs,
    estimatedComputeUsd,
    estimatedStorageUsd,
    estimatedTotalUsd: estimatedComputeUsd + estimatedStorageUsd,
  };
}

function providerPodFields(providerPod = {}, now = new Date()) {
  const status = normalizeProviderStatus(providerPod.status);
  const dataCenterId = safeString(providerPod.dataCenterId, 100);
  const providerCreatedAt = dateOrNull(providerPod.createdAt);
  const providerStartedAt = dateOrNull(providerPod.startedAt);
  return {
    providerStatus: status,
    lifecycleGroup: lifecycleGroupForStatus(status),
    validActions: normalizeActions(providerPod.actions),
    providerCostPerHour: finiteNumber(providerPod.cost),
    ...(dataCenterId ? { dataCenterId } : {}),
    ...(providerCreatedAt ? { providerCreatedAt } : {}),
    ...(providerStartedAt ? { providerStartedAt } : {}),
    lastProviderSyncAt: now,
  };
}

function reconciledProviderPodFields(localPod, providerPod = {}, now = new Date(), options = {}) {
  return {
    ...providerPodFields(providerPod, now),
    ...usageFieldsForObservation(localPod, providerPod, now, options),
  };
}

function templateToPlain(template) {
  if (!template) return null;
  return typeof template.toObject === 'function' ? template.toObject() : template;
}

function podToPlain(pod) {
  if (!pod) return null;
  return typeof pod.toObject === 'function' ? pod.toObject() : pod;
}

function mapGpuForPicker(secureGpu = {}, communityGpu = {}) {
  const base = secureGpu.id ? secureGpu : communityGpu;
  return {
    id: safeString(base.id),
    name: safeString(base.name) || safeString(base.id),
    memoryGb: finiteNumber(base.memory),
    manufacturer: safeString(base.manufacturer, 40),
    secure: secureGpu.secure === true,
    community: communityGpu.community === true,
    securePrice: finiteNumber(secureGpu.price?.secure),
    communityPrice: finiteNumber(communityGpu.price?.community),
    secureAvailability: safeString(secureGpu.availability, 20).toUpperCase() || 'NONE',
    communityAvailability: safeString(communityGpu.availability, 20).toUpperCase() || 'NONE',
    secureMaxCount: finiteNumber(secureGpu.maxCount?.secure, 0),
    communityMaxCount: finiteNumber(communityGpu.maxCount?.community, 0),
    secureDataCenters: (Array.isArray(secureGpu.dataCenters) ? secureGpu.dataCenters : [])
      .slice(0, 100)
      .map((entry) => ({
        id: safeString(entry?.id, 100),
        name: safeString(entry?.name, 160),
        availability: safeString(entry?.availability, 20).toUpperCase(),
      }))
      .filter((entry) => entry.id),
    communityDataCenters: (Array.isArray(communityGpu.dataCenters) ? communityGpu.dataCenters : [])
      .slice(0, 100)
      .map((entry) => ({
        id: safeString(entry?.id, 100),
        name: safeString(entry?.name, 160),
        availability: safeString(entry?.availability, 20).toUpperCase(),
      }))
      .filter((entry) => entry.id),
  };
}

function mergeGpuCatalogs(secureGpus = [], communityGpus = []) {
  const secure = new Map(secureGpus.map((gpu) => [safeString(gpu?.id), gpu]));
  const community = new Map(communityGpus.map((gpu) => [safeString(gpu?.id), gpu]));
  const ids = new Set([...secure.keys(), ...community.keys()]);
  ids.delete('');
  const availabilityRank = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3 };
  return Array.from(ids)
    .map((id) => mapGpuForPicker(secure.get(id) || {}, community.get(id) || {}))
    .sort((left, right) => {
      const leftAvailability = Math.min(
        availabilityRank[left.secureAvailability] ?? 4,
        availabilityRank[left.communityAvailability] ?? 4
      );
      const rightAvailability = Math.min(
        availabilityRank[right.secureAvailability] ?? 4,
        availabilityRank[right.communityAvailability] ?? 4
      );
      const leftPrice = Math.min(left.securePrice ?? Infinity, left.communityPrice ?? Infinity);
      const rightPrice = Math.min(right.securePrice ?? Infinity, right.communityPrice ?? Infinity);
      return leftAvailability - rightAvailability
        || leftPrice - rightPrice
        || (right.memoryGb ?? 0) - (left.memoryGb ?? 0)
        || left.name.localeCompare(right.name);
    });
}

function mapTemplateForPage(template, providerTemplateIds) {
  const value = templateToPlain(template) || {};
  return {
    id: value._id?.toString?.() || safeString(value.id, 80),
    slug: safeString(value.slug, 80),
    name: safeString(value.name, 120),
    description: safeString(value.description, 1000),
    providerTemplateId: safeString(value.providerTemplateId, 128),
    providerTemplateName: safeString(value.providerTemplateName, 120),
    providerPresent: providerTemplateIds.has(safeString(value.providerTemplateId, 128)),
    providerSyncStatus: safeString(value.providerSyncStatus, 20),
    image: safeString(value.image, 500),
    diskGb: finiteNumber(value.diskGb),
    persistentDiskGb: finiteNumber(value.persistentDiskGb),
    persistentPath: safeString(value.persistentPath, 300),
    defaultModel: safeString(value.defaultModel, 120),
    servicePort: finiteNumber(value.servicePort),
    active: value.active === true,
    providerSyncedAt: value.providerSyncedAt || null,
  };
}

function mapPodForPage(localPod, providerPod, now = new Date()) {
  const local = podToPlain(localPod) || {};
  const provider = providerPod || {};
  const status = provider.id
    ? normalizeProviderStatus(provider.status)
    : normalizeProviderStatus(local.providerStatus);
  const archivedAt = local.archivedAt || null;
  const actions = provider.id ? normalizeActions(provider.actions) : normalizeActions(local.validActions);
  const providerId = safeString(local.providerPodId || provider.id, 128);
  const usage = projectPodUsage(local, provider, now);
  let publicUrl = safeString(local.publicUrl, 500);
  if (!publicUrl && providerId && safeArray(local.ports, 20, 40).includes(`${OLLAMA_PORT}/http`)) {
    try {
      publicUrl = publicOllamaUrl(providerId, OLLAMA_PORT);
    } catch (_) {
      publicUrl = '';
    }
  }
  return {
    id: local._id?.toString?.() || safeString(local.id, 80),
    providerPodId: providerId,
    name: safeString(local.name || provider.name, 120),
    recordOrigin: safeString(local.recordOrigin, 30) || 'managed',
    providerStatus: status,
    lifecycleGroup: lifecycleGroupForStatus(status, archivedAt),
    validActions: actions,
    canStart: !archivedAt && actions.includes('start'),
    canStop: !archivedAt && actions.includes('stop'),
    canDelete: !archivedAt && (actions.includes('terminate') || !provider.id),
    setupStatus: safeString(local.setupStatus, 30) || 'not_applicable',
    setupErrorCode: safeString(local.setupErrorCode, 80),
    setupModel: safeString(local.setupModel, 120),
    publicUrl,
    cloud: safeString(local.cloud || provider.cloud, 20),
    dataCenterId: safeString(provider.dataCenterId || local.dataCenterId, 100),
    gpuId: safeString(provider.gpu?.id || local.gpu?.id, 240),
    gpuName: safeString(local.gpu?.name || provider.gpu?.id, 240),
    gpuMemoryGb: finiteNumber(local.gpu?.memoryGb),
    gpuCount: finiteNumber(provider.gpu?.count ?? local.gpu?.count),
    costPerHour: finiteNumber(provider.cost ?? local.providerCostPerHour ?? local.estimatedCostPerHour),
    lastRunningCostPerHour: finiteNumber(
      local.lastRunningCostPerHour,
      finiteNumber(local.estimatedCostPerHour)
    ),
    estimatedCostPerHour: finiteNumber(local.estimatedCostPerHour),
    usageTrackingMode: safeString(local.usageTrackingMode, 20) || 'unknown',
    usage,
    billing: {
      available: Boolean(local.billingSyncedAt),
      totalUsd: nonNegativeNumber(local.billingTotalUsd),
      computeUsd: nonNegativeNumber(local.billingComputeUsd),
      storageUsd: nonNegativeNumber(local.billingStorageUsd),
      firstPeriodAt: local.billingFirstPeriodAt || null,
      lastPeriodEndAt: local.billingLastPeriodEndAt || null,
      syncedAt: local.billingSyncedAt || null,
    },
    autoStopAt: local.autoStopAt || null,
    createdAt: local.createdAt || null,
    archivedAt,
    providerReachable: Boolean(provider.id),
  };
}

function mapUnmanagedProviderPod(provider = {}) {
  const status = normalizeProviderStatus(provider.status);
  return {
    providerPodId: safeString(provider.id, 128),
    name: safeString(provider.name, 120),
    providerStatus: status,
    lifecycleGroup: lifecycleGroupForStatus(status),
    gpuId: safeString(provider.gpu?.id, 240),
    gpuCount: finiteNumber(provider.gpu?.count),
    cloud: safeString(provider.cloud, 20),
    dataCenterId: safeString(provider.dataCenterId, 100),
    costPerHour: finiteNumber(provider.cost),
  };
}

async function readLimitedText(response, limitBytes = OLLAMA_RESPONSE_LIMIT_BYTES) {
  const contentLength = Number.parseInt(response.headers?.get?.('content-length'), 10);
  if (Number.isFinite(contentLength) && contentLength > limitBytes) {
    await response.body?.cancel?.().catch?.(() => {});
    throw new RunpodManagementError('Ollama returned more data than expected.', {
      code: 'OLLAMA_RESPONSE_TOO_LARGE', status: 502,
    });
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > limitBytes) {
      throw new RunpodManagementError('Ollama returned more data than expected.', {
        code: 'OLLAMA_RESPONSE_TOO_LARGE', status: 502,
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
    if (totalBytes > limitBytes) {
      await reader.cancel().catch(() => {});
      throw new RunpodManagementError('Ollama returned more data than expected.', {
        code: 'OLLAMA_RESPONSE_TOO_LARGE', status: 502,
      });
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function validatedOllamaBaseUrl(value) {
  let base;
  try {
    base = new URL(value);
  } catch (_) {
    throw new RunpodManagementError('The derived Ollama URL is invalid.', {
      code: 'OLLAMA_URL_INVALID', status: 500,
    });
  }
  const proxyLabel = base.hostname.endsWith(OLLAMA_PUBLIC_URL_SUFFIX)
    ? base.hostname.slice(0, -OLLAMA_PUBLIC_URL_SUFFIX.length)
    : '';
  const separator = proxyLabel.lastIndexOf('-');
  const podId = separator > 0 ? proxyLabel.slice(0, separator) : '';
  const servicePort = separator > 0 ? proxyLabel.slice(separator + 1) : '';
  if (
    base.protocol !== 'https:'
    || base.username
    || base.password
    || base.port
    || base.pathname !== '/'
    || base.search
    || base.hash
    || proxyLabel.length > 63
    || !PROXY_POD_ID_PATTERN.test(podId)
    || !/^\d{1,5}$/u.test(servicePort)
    || Number(servicePort) < 1
    || Number(servicePort) > 65535
  ) {
    throw new RunpodManagementError('The derived Ollama URL is invalid.', {
      code: 'OLLAMA_URL_INVALID', status: 500,
    });
  }
  return base;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class RunpodPodManager {
  constructor({
    runpodService = new RunpodApiV2Service(),
    podModel = RunpodPod,
    templateModel = RunpodWorkloadTemplate,
    eventModel = RunpodOperationEvent,
    fetchImpl = global.fetch,
    appLogger = logger,
    now = () => new Date(),
    sleepImpl = sleep,
    maxActivePods = positiveInteger(process.env.RUNPOD_MAX_ACTIVE_PODS, DEFAULT_MAX_ACTIVE_PODS),
    maxGpuCount = positiveInteger(process.env.RUNPOD_MAX_GPU_COUNT, DEFAULT_MAX_GPU_COUNT),
    maxHourlyCostUsd = positiveNumber(
      process.env.RUNPOD_MAX_HOURLY_COST_USD,
      DEFAULT_MAX_HOURLY_COST_USD
    ),
    defaultAutoStopMinutes = positiveInteger(
      process.env.RUNPOD_DEFAULT_AUTO_STOP_MINUTES,
      DEFAULT_AUTO_STOP_MINUTES
    ),
    maxRuntimeMinutes = positiveInteger(
      process.env.RUNPOD_MAX_RUNTIME_MINUTES,
      DEFAULT_MAX_RUNTIME_MINUTES
    ),
    provisionTimeoutMs = positiveInteger(
      process.env.RUNPOD_PROVISION_TIMEOUT_MS,
      DEFAULT_PROVISION_TIMEOUT_MS
    ),
    ollamaPullTimeoutMs = positiveInteger(
      process.env.RUNPOD_OLLAMA_PULL_TIMEOUT_MS,
      DEFAULT_OLLAMA_PULL_TIMEOUT_MS
    ),
    pollIntervalMs = positiveInteger(
      process.env.RUNPOD_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS
    ),
  } = {}) {
    this.runpodService = runpodService;
    this.podModel = podModel;
    this.templateModel = templateModel;
    this.eventModel = eventModel;
    this.fetch = fetchImpl;
    this.logger = appLogger;
    this.now = now;
    this.sleep = sleepImpl;
    this.maxActivePods = Math.min(maxActivePods, 20);
    this.maxGpuCount = Math.min(maxGpuCount, 16);
    this.maxHourlyCostUsd = Math.min(maxHourlyCostUsd, 100);
    this.maxRuntimeMinutes = Math.max(15, Math.min(maxRuntimeMinutes, 7 * 24 * 60));
    this.defaultAutoStopMinutes = Math.max(
      15,
      Math.min(defaultAutoStopMinutes, this.maxRuntimeMinutes)
    );
    this.provisionTimeoutMs = provisionTimeoutMs;
    this.ollamaPullTimeoutMs = ollamaPullTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.provisioning = new Map();
    this.creationQueue = Promise.resolve();
    this.templateQueue = Promise.resolve();
  }

  limits() {
    return {
      maxActivePods: this.maxActivePods,
      maxGpuCount: this.maxGpuCount,
      maxHourlyCostUsd: this.maxHourlyCostUsd,
      defaultAutoStopMinutes: this.defaultAutoStopMinutes,
      maxRuntimeMinutes: this.maxRuntimeMinutes,
    };
  }

  async recordEvent(event) {
    try {
      await this.eventModel.create(event);
    } catch (error) {
      this.logger.warning('Unable to persist Runpod operation audit event', {
        category: 'runpod_management',
        metadata: {
          action: safeString(event?.action, 40),
          outcome: safeString(event?.outcome, 40),
          errorName: safeString(error?.name, 80) || 'Error',
        },
      });
    }
  }

  logOperationFailure(message, action, error) {
    this.logger.error(message, {
      category: 'runpod_management',
      metadata: {
        action,
        errorCode: safeString(error?.code, 80) || 'RUNPOD_MANAGEMENT_ERROR',
        providerStatus: Number.isSafeInteger(error?.status) ? error.status : null,
      },
    });
  }

  async getAdminState() {
    const operations = {
      templates: () => this.templateModel.find({ active: true }).sort({ name: 1 }).lean(),
      pods: () => this.podModel.find({}).sort({ createdAt: -1 }).limit(MAX_LOCAL_PODS).lean(),
      providerPods: () => this.runpodService.listPods(),
      providerTemplates: () => this.runpodService.getAccountTemplates(),
      secureGpus: () => this.runpodService.getGpuTypes({ cloud: 'SECURE' }),
      communityGpus: () => this.runpodService.getGpuTypes({ cloud: 'COMMUNITY' }),
    };
    const entries = Object.entries(operations);
    const settled = await Promise.allSettled(entries.map(([, operation]) => operation()));
    const values = {
      templates: [],
      pods: [],
      providerPods: [],
      providerTemplates: [],
      secureGpus: [],
      communityGpus: [],
    };
    const errors = {};
    settled.forEach((result, index) => {
      const key = entries[index][0];
      if (result.status === 'fulfilled') {
        values[key] = Array.isArray(result.value) ? result.value : [];
      } else {
        errors[key] = {
          code: safeString(result.reason?.code, 80) || 'RUNPOD_MANAGEMENT_ERROR',
          status: Number.isSafeInteger(result.reason?.status) ? result.reason.status : null,
        };
      }
    });

    const providerPods = values.providerPods.slice(0, MAX_PROVIDER_PODS);
    const providerTemplates = values.providerTemplates.slice(0, MAX_PROVIDER_TEMPLATES);
    const providerPodsById = new Map(providerPods.map((pod) => [safeString(pod?.id, 128), pod]));
    const providerTemplateIds = new Set(
      providerTemplates.map((template) => safeString(template?.id, 128)).filter(Boolean)
    );
    const localProviderPodIds = new Set(
      values.pods.map((pod) => safeString(pod?.providerPodId, 128)).filter(Boolean)
    );
    const pageNow = this.now();
    const mappedPods = values.pods.map((pod) => (
      mapPodForPage(
        pod,
        providerPodsById.get(safeString(pod?.providerPodId, 128)),
        pageNow
      )
    ));

    return {
      limits: this.limits(),
      templates: values.templates.map((template) => mapTemplateForPage(template, providerTemplateIds)),
      managedPods: mappedPods.filter((pod) => pod.lifecycleGroup !== 'archived'),
      archivedPods: mappedPods.filter((pod) => pod.lifecycleGroup === 'archived'),
      unmanagedProviderPods: providerPods
        .filter((pod) => !localProviderPodIds.has(safeString(pod?.id, 128)))
        .map(mapUnmanagedProviderPod),
      providerTemplateCount: providerTemplates.length,
      gpuOptions: mergeGpuCatalogs(values.secureGpus, values.communityGpus),
      errors,
    };
  }

  saveOllamaTemplate(input, principal) {
    const operation = this.templateQueue.then(() => this._saveOllamaTemplate(input, principal));
    this.templateQueue = operation.catch(() => {});
    return operation;
  }

  async _saveOllamaTemplate(input, principal) {
    const normalized = normalizeTemplateInput(input);
    const actor = actorFromPrincipal(principal);
    let localTemplate = await this.templateModel.findOne({ slug: OLLAMA_TEMPLATE_SLUG }).lean();
    let providerTemplate;
    try {
      const providerTemplates = await this.runpodService.getAccountTemplates();
      providerTemplate = providerTemplates.find((entry) => (
        safeString(entry?.id, 128) === safeString(localTemplate?.providerTemplateId, 128)
      )) || providerTemplates.find((entry) => (
        safeString(entry?.name, 120) === normalized.providerTemplateName
      ));
      const payload = providerTemplatePayload(normalized);
      providerTemplate = providerTemplate
        ? await this.runpodService.updateTemplate(providerTemplate.id, payload)
        : await this.runpodService.createTemplate(payload);

      const providerTemplateId = safeString(providerTemplate?.id, 128);
      if (!providerTemplateId) {
        throw new RunpodManagementError('Runpod did not return a template ID.', {
          code: 'RUNPOD_INVALID_RESPONSE', status: 502,
        });
      }
      const now = this.now();
      localTemplate = await this.templateModel.findOneAndUpdate(
        { slug: OLLAMA_TEMPLATE_SLUG },
        {
          $set: {
            ...normalized,
            providerTemplateId,
            providerSyncStatus: 'synced',
            providerSyncErrorCode: null,
            providerSyncedAt: now,
            updatedBy: actor,
          },
          $setOnInsert: { createdBy: actor },
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );
      await this.recordEvent({
        resourceType: 'template',
        templateRecordId: localTemplate?._id || null,
        action: 'template_sync',
        outcome: 'succeeded',
        actor,
      });
      return templateToPlain(localTemplate);
    } catch (error) {
      if (localTemplate?._id) {
        await this.templateModel.updateOne(
          { _id: localTemplate._id },
          {
            $set: {
              providerSyncStatus: 'failed',
              providerSyncErrorCode: safeString(error?.code, 80) || 'RUNPOD_TEMPLATE_SYNC_FAILED',
              updatedBy: actor,
            },
          }
        ).catch(() => {});
      }
      await this.recordEvent({
        resourceType: 'template',
        templateRecordId: localTemplate?._id || null,
        action: 'template_sync',
        outcome: 'failed',
        providerStatus: Number.isSafeInteger(error?.status) ? error.status : null,
        errorCode: safeString(error?.code, 80) || 'RUNPOD_TEMPLATE_SYNC_FAILED',
        actor,
      });
      this.logOperationFailure('Runpod workload template synchronization failed', 'template_sync', error);
      throw error;
    }
  }

  createManagedPod(input, principal) {
    const operation = this.creationQueue.then(() => this._createManagedPod(input, principal));
    this.creationQueue = operation.catch(() => {});
    return operation;
  }

  async _createManagedPod(input = {}, principal) {
    const actor = actorFromPrincipal(principal);
    const templateId = safeString(input.templateId, 30);
    if (!OBJECT_ID_PATTERN.test(templateId)) {
      throw new RunpodManagementError('Choose a valid workload template.', {
        code: 'RUNPOD_INPUT_INVALID',
      });
    }
    const template = await this.templateModel.findOne({ _id: templateId, active: true }).lean();
    if (!template || !safeString(template.providerTemplateId, 128)) {
      throw new RunpodManagementError('Sync the selected workload template before creating a pod.', {
        code: 'RUNPOD_TEMPLATE_NOT_READY', status: 409,
      });
    }

    const cloud = safeString(input.cloud, 20).toUpperCase();
    if (!['SECURE', 'COMMUNITY'].includes(cloud)) {
      throw new RunpodManagementError('Choose Secure or Community Cloud.', {
        code: 'RUNPOD_INPUT_INVALID',
      });
    }
    const gpuId = safeString(input.gpuId, 240);
    if (!gpuId) {
      throw new RunpodManagementError('Choose a GPU.', { code: 'RUNPOD_INPUT_INVALID' });
    }
    const gpuCount = strictInteger(input.gpuCount || 1, {
      label: 'GPU count', min: 1, max: this.maxGpuCount,
    });
    const maxHourlyCost = strictMoney(input.maxHourlyCost, {
      label: 'Maximum hourly cost', max: this.maxHourlyCostUsd,
    });
    const autoStopMinutes = strictInteger(
      input.autoStopMinutes || this.defaultAutoStopMinutes,
      { label: 'Auto-stop time', min: 15, max: this.maxRuntimeMinutes }
    );
    if (input.publicAccessAcknowledged !== 'acknowledged') {
      throw new RunpodManagementError('Acknowledge that the Ollama proxy URL is public.', {
        code: 'RUNPOD_PUBLIC_ACCESS_NOT_ACKNOWLEDGED',
      });
    }

    const [providerPods, gpuCatalog] = await Promise.all([
      this.runpodService.listPods(),
      this.runpodService.getGpuTypes({ cloud, forceRefresh: true }),
    ]);
    const activePodCount = providerPods.filter((pod) => (
      ACTIVE_PROVIDER_STATUSES.has(normalizeProviderStatus(pod?.status))
    )).length;
    if (activePodCount >= this.maxActivePods) {
      throw new RunpodManagementError(
        `The configured limit of ${this.maxActivePods} active Runpod pod${this.maxActivePods === 1 ? '' : 's'} has been reached.`,
        { code: 'RUNPOD_ACTIVE_POD_LIMIT', status: 409 }
      );
    }

    const gpu = gpuCatalog.find((entry) => safeString(entry?.id, 240) === gpuId);
    const price = cloud === 'SECURE'
      ? finiteNumber(gpu?.price?.secure)
      : finiteNumber(gpu?.price?.community);
    const availability = safeString(gpu?.availability, 20).toUpperCase();
    const providerMaxCount = cloud === 'SECURE'
      ? finiteNumber(gpu?.maxCount?.secure, 0)
      : finiteNumber(gpu?.maxCount?.community, 0);
    if (!gpu || !AVAILABLE_STOCK.has(availability) || !Number.isFinite(price)) {
      throw new RunpodManagementError('The selected GPU is not currently available in that cloud.', {
        code: 'RUNPOD_GPU_UNAVAILABLE', status: 409,
      });
    }
    if (gpuCount > providerMaxCount) {
      throw new RunpodManagementError('The selected GPU count is not offered on one machine.', {
        code: 'RUNPOD_GPU_COUNT_UNAVAILABLE', status: 409,
      });
    }
    const estimatedCost = price * gpuCount;
    if (estimatedCost > maxHourlyCost || estimatedCost > this.maxHourlyCostUsd) {
      throw new RunpodManagementError('The current catalog price exceeds the confirmed hourly limit.', {
        code: 'RUNPOD_COST_LIMIT_EXCEEDED', status: 409,
      });
    }

    const dataCenterId = safeString(input.dataCenterId, 100);
    const availableDataCenters = Array.isArray(gpu.dataCenters) ? gpu.dataCenters : [];
    if (dataCenterId && !availableDataCenters.some((entry) => (
      safeString(entry?.id, 100) === dataCenterId
      && AVAILABLE_STOCK.has(safeString(entry?.availability, 20).toUpperCase())
    ))) {
      throw new RunpodManagementError('The selected GPU is not available in that data center.', {
        code: 'RUNPOD_DATACENTER_UNAVAILABLE', status: 409,
      });
    }
    const globalNetworking = input.globalNetworking === 'on' || input.globalNetworking === true;
    if (globalNetworking && (cloud !== 'SECURE' || !dataCenterId)) {
      throw new RunpodManagementError(
        'Global networking requires Secure Cloud and an explicit eligible data center.',
        { code: 'RUNPOD_INPUT_INVALID' }
      );
    }
    if (globalNetworking) {
      const dataCenters = await this.runpodService.getDataCenters({ forceRefresh: true });
      const selectedDataCenter = dataCenters.find((entry) => (
        safeString(entry?.id, 100) === dataCenterId
      ));
      if (selectedDataCenter?.globalNetwork !== true) {
        throw new RunpodManagementError('The selected data center does not support global networking.', {
          code: 'RUNPOD_DATACENTER_NETWORKING_UNAVAILABLE', status: 409,
        });
      }
    }

    const name = normalizePodName(input.name);
    const diskGb = strictInteger(input.diskGb || template.diskGb, {
      label: 'Container disk', min: 5, max: 500,
    });
    const persistentDiskGb = strictInteger(input.persistentDiskGb || template.persistentDiskGb, {
      label: 'Persistent disk', min: 10, max: 1000,
    });
    const setupModel = normalizeModelName(input.model || template.defaultModel);
    const providerPayload = {
      name,
      templateId: template.providerTemplateId,
      cloud,
      gpu: { id: gpuId, count: gpuCount },
      disk: diskGb,
      mounts: {
        persistent: {
          size: persistentDiskGb,
          path: template.persistentPath,
        },
      },
      globalNetworking,
      ...(dataCenterId ? { dataCenterIds: [dataCenterId] } : {}),
    };

    let providerPod;
    try {
      providerPod = await this.runpodService.createPod(providerPayload);
      const providerCost = finiteNumber(providerPod.cost, estimatedCost);
      if (providerCost > maxHourlyCost || providerCost > this.maxHourlyCostUsd) {
        throw new RunpodManagementError(
          'Runpod returned a pod cost above the confirmed hourly limit, so creation was rejected and cleanup was requested.',
          { code: 'RUNPOD_COST_LIMIT_EXCEEDED', status: 409 }
        );
      }
      const providerPodId = safeString(providerPod.id, 128);
      const now = this.now();
      const pod = await this.podModel.create({
        providerPodId,
        name,
        recordOrigin: 'managed',
        workloadTemplateId: template._id,
        providerTemplateId: template.providerTemplateId,
        ...providerPodFields(providerPod, now),
        setupStatus: 'pending',
        setupModel,
        publicUrl: publicOllamaUrl(providerPodId, template.servicePort),
        cloud,
        dataCenterId: safeString(providerPod.dataCenterId || dataCenterId, 100) || null,
        gpu: {
          id: gpuId,
          name: safeString(gpu.name || gpu.id, 240),
          memoryGb: finiteNumber(gpu.memory),
          count: gpuCount,
          catalogPricePerHour: price,
        },
        diskGb,
        persistentDiskGb,
        persistentPath: template.persistentPath,
        ports: safeArray(template.ports, 20, 40),
        estimatedCostPerHour: estimatedCost,
        providerCostPerHour: providerCost,
        lastRunningCostPerHour: estimatedCost,
        storageRates: { ...DEFAULT_STORAGE_RATES },
        usageTrackingMode: 'observed',
        usageState: usageStateForStatus(providerPod.status),
        usageTrackedSinceAt: now,
        usageStateEnteredAt: now,
        usageLastObservedAt: now,
        runningMs: 0,
        stoppedMs: 0,
        maxHourlyCostAcknowledged: maxHourlyCost,
        autoStopMinutes,
        autoStopAt: new Date(now.getTime() + autoStopMinutes * 60 * 1000),
        lastActionAt: now,
        createdBy: actor,
        updatedBy: actor,
      });
      await this.recordEvent({
        resourceType: 'pod',
        podRecordId: pod._id,
        action: 'create',
        outcome: 'succeeded',
        actor,
      });
      this.scheduleProvisioning(pod._id, actor);
      return podToPlain(pod);
    } catch (error) {
      if (providerPod?.id) {
        const persisted = await this.podModel.findOne({ providerPodId: providerPod.id }).lean().catch(() => null);
        if (!persisted) {
          try {
            await this.runpodService.deletePod(providerPod.id);
          } catch (cleanupError) {
            this.logger.error('Failed to delete an unpersisted Runpod pod after creation failure', {
              category: 'runpod_management',
              metadata: {
                action: 'create_cleanup',
                errorCode: safeString(cleanupError?.code, 80) || 'RUNPOD_CLEANUP_FAILED',
                providerStatus: Number.isSafeInteger(cleanupError?.status)
                  ? cleanupError.status
                  : null,
              },
            });
          }
        }
      }
      await this.recordEvent({
        resourceType: 'pod',
        action: 'create',
        outcome: 'failed',
        providerStatus: Number.isSafeInteger(error?.status) ? error.status : null,
        errorCode: safeString(error?.code, 80) || 'RUNPOD_POD_CREATE_FAILED',
        actor,
      });
      this.logOperationFailure('Runpod pod creation failed', 'create', error);
      throw error;
    }
  }

  scheduleProvisioning(podRecordId, actor = actorFromPrincipal()) {
    const id = podRecordId?.toString?.() || safeString(podRecordId, 30);
    if (!OBJECT_ID_PATTERN.test(id)) return null;
    if (this.provisioning.has(id)) return this.provisioning.get(id);
    const task = this._provisionPod(id, actor)
      .catch(() => null)
      .finally(() => this.provisioning.delete(id));
    this.provisioning.set(id, task);
    return task;
  }

  async retryProvisioning(podRecordId, principal) {
    const pod = await this.findManagedPod(podRecordId);
    await this.podModel.updateOne(
      { _id: pod._id, archivedAt: null },
      {
        $set: {
          setupStatus: 'pending',
          setupErrorCode: null,
          updatedBy: actorFromPrincipal(principal),
        },
      }
    );
    this.scheduleProvisioning(pod._id, actorFromPrincipal(principal));
    return true;
  }

  async _provisionPod(podRecordId, actor) {
    const pod = await this.findManagedPod(podRecordId);
    const template = await this.templateModel.findOne({
      _id: pod.workloadTemplateId,
      active: true,
    }).lean();
    if (!template || template.setupKind !== 'ollama_pull') {
      await this.podModel.updateOne(
        { _id: pod._id, archivedAt: null },
        { $set: { setupStatus: 'not_applicable', updatedBy: actor } }
      );
      return;
    }
    const startTime = this.now();
    await this.podModel.updateOne(
      { _id: pod._id, archivedAt: null },
      {
        $set: {
          setupStatus: 'waiting',
          setupErrorCode: null,
          setupStartedAt: startTime,
          updatedBy: actor,
        },
      }
    );
    await this.recordEvent({
      resourceType: 'pod',
      podRecordId: pod._id,
      action: 'setup',
      outcome: 'requested',
      actor,
    });

    try {
      const providerPod = await this.waitForRunningPod(pod.providerPodId);
      const url = publicOllamaUrl(providerPod.id, template.servicePort);
      await this.waitForOllama(url);
      await this.podModel.updateOne(
        { _id: pod._id, archivedAt: null },
        { $set: { setupStatus: 'downloading', publicUrl: url, updatedBy: actor } }
      );
      await this.pullOllamaModel(url, pod.setupModel || template.defaultModel);
      await this.verifyOllamaModel(url, pod.setupModel || template.defaultModel);
      const completedAt = this.now();
      await this.podModel.updateOne(
        { _id: pod._id, archivedAt: null },
        {
          $set: {
            ...reconciledProviderPodFields(pod, providerPod, completedAt),
            setupStatus: 'ready',
            setupErrorCode: null,
            setupCompletedAt: completedAt,
            publicUrl: url,
            updatedBy: actor,
          },
        }
      );
      await this.recordEvent({
        resourceType: 'pod',
        podRecordId: pod._id,
        action: 'setup',
        outcome: 'succeeded',
        actor,
      });
    } catch (error) {
      const errorCode = safeString(error?.code, 80) || 'RUNPOD_SETUP_FAILED';
      await this.podModel.updateOne(
        { _id: pod._id, archivedAt: null },
        {
          $set: {
            setupStatus: 'failed',
            setupErrorCode: errorCode,
            updatedBy: actor,
          },
        }
      ).catch(() => {});
      await this.stopProviderPodAfterSetupFailure(pod.providerPodId, pod._id, actor, pod);
      await this.recordEvent({
        resourceType: 'pod',
        podRecordId: pod._id,
        action: 'setup',
        outcome: 'failed',
        providerStatus: Number.isSafeInteger(error?.status) ? error.status : null,
        errorCode,
        actor,
      });
      this.logOperationFailure('Runpod Ollama setup failed and the pod was stopped when possible', 'setup', error);
      throw error;
    }
  }

  async waitForRunningPod(providerPodId) {
    const deadline = Date.now() + this.provisionTimeoutMs;
    while (Date.now() < deadline) {
      const pod = await this.runpodService.getPod(providerPodId);
      const status = normalizeProviderStatus(pod.status);
      if (status === 'RUNNING') return pod;
      if (status === 'ERROR' || status === 'TERMINATED' || status === 'EXITED') {
        throw new RunpodManagementError('The pod stopped before Ollama became ready.', {
          code: 'RUNPOD_PROVISIONING_FAILED', status: 502,
        });
      }
      await this.sleep(this.pollIntervalMs);
    }
    throw new RunpodManagementError('The pod did not become ready before the setup timeout.', {
      code: 'RUNPOD_PROVISIONING_TIMEOUT', status: 504,
    });
  }

  async ollamaRequest(baseUrl, pathname, {
    method = 'GET',
    body,
    timeoutMs = 15_000,
  } = {}) {
    if (typeof this.fetch !== 'function') {
      throw new RunpodManagementError('Ollama connectivity is not configured.', {
        code: 'OLLAMA_FETCH_UNAVAILABLE', status: 503,
      });
    }
    const base = validatedOllamaBaseUrl(baseUrl);
    const allowedPaths = new Set(['/', '/api/tags', '/api/pull']);
    if (!allowedPaths.has(pathname)) {
      throw new RunpodManagementError('The Ollama API path is not allowed.', {
        code: 'OLLAMA_PATH_NOT_ALLOWED', status: 500,
      });
    }
    const url = new URL(pathname, base);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetch(url, {
        method,
        headers: body === undefined
          ? { Accept: 'application/json, text/plain' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel?.().catch?.(() => {});
        throw new RunpodManagementError('The Ollama service is not ready.', {
          code: 'OLLAMA_HTTP_ERROR', status: 502, providerStatus: response.status,
        });
      }
      return {
        contentType: response.headers?.get?.('content-type') || '',
        text: await readLimitedText(response),
      };
    } catch (error) {
      if (error instanceof RunpodManagementError) throw error;
      if (error?.name === 'AbortError') {
        throw new RunpodManagementError('The Ollama request timed out.', {
          code: 'OLLAMA_TIMEOUT', status: 504,
        });
      }
      throw new RunpodManagementError('The Ollama service could not be reached.', {
        code: 'OLLAMA_NETWORK_ERROR', status: 502,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async waitForOllama(baseUrl) {
    const deadline = Date.now() + this.provisionTimeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      try {
        await this.ollamaRequest(baseUrl, '/api/tags');
        return true;
      } catch (error) {
        lastError = error;
        await this.sleep(this.pollIntervalMs);
      }
    }
    throw new RunpodManagementError('Ollama did not become reachable before the setup timeout.', {
      code: lastError?.code === 'OLLAMA_TIMEOUT' ? 'OLLAMA_TIMEOUT' : 'OLLAMA_STARTUP_TIMEOUT',
      status: 504,
    });
  }

  async pullOllamaModel(baseUrl, model) {
    const response = await this.ollamaRequest(baseUrl, '/api/pull', {
      method: 'POST',
      body: { model: normalizeModelName(model), stream: false },
      timeoutMs: this.ollamaPullTimeoutMs,
    });
    let result;
    try {
      result = JSON.parse(response.text);
    } catch (_) {
      throw new RunpodManagementError('Ollama returned invalid JSON while downloading the model.', {
        code: 'OLLAMA_INVALID_RESPONSE', status: 502,
      });
    }
    if (safeString(result?.status, 40).toLowerCase() !== 'success') {
      throw new RunpodManagementError('Ollama did not confirm the model download.', {
        code: 'OLLAMA_PULL_FAILED', status: 502,
      });
    }
    return true;
  }

  async verifyOllamaModel(baseUrl, model) {
    const response = await this.ollamaRequest(baseUrl, '/api/tags');
    let result;
    try {
      result = JSON.parse(response.text);
    } catch (_) {
      throw new RunpodManagementError('Ollama returned invalid model data.', {
        code: 'OLLAMA_INVALID_RESPONSE', status: 502,
      });
    }
    const requested = normalizeModelName(model);
    const available = Array.isArray(result?.models)
      ? result.models.map((entry) => safeString(entry?.name, 120).toLowerCase())
      : [];
    if (!available.includes(requested)) {
      throw new RunpodManagementError('The requested Ollama model is not present after setup.', {
        code: 'OLLAMA_MODEL_MISSING', status: 502,
      });
    }
    return true;
  }

  async stopProviderPodAfterSetupFailure(providerPodId, podRecordId, actor, localPod = {}) {
    try {
      const providerPod = await this.runpodService.getPod(providerPodId);
      if (!normalizeActions(providerPod.actions).includes('stop')) return;
      const stoppedPod = await this.runpodService.transitionPod(providerPodId, 'stop');
      const now = this.now();
      await this.podModel.updateOne(
        { _id: podRecordId, archivedAt: null },
        {
          $set: {
            ...reconciledProviderPodFields(localPod, stoppedPod, now),
            autoStopAt: null,
            lastActionAt: now,
            updatedBy: actor,
          },
        }
      );
    } catch (error) {
      this.logger.error('Failed to stop a Runpod pod after setup failure', {
        category: 'runpod_management',
        metadata: {
          action: 'setup_failure_stop',
          errorCode: safeString(error?.code, 80) || 'RUNPOD_STOP_FAILED',
          providerStatus: Number.isSafeInteger(error?.status) ? error.status : null,
        },
      });
    }
  }

  async findManagedPod(podRecordId) {
    const id = safeString(podRecordId, 30);
    if (!OBJECT_ID_PATTERN.test(id)) {
      throw new RunpodManagementError('Pod not found.', {
        code: 'RUNPOD_POD_NOT_FOUND', status: 404,
      });
    }
    const pod = await this.podModel.findOne({ _id: id, archivedAt: null }).lean();
    if (!pod || !safeString(pod.providerPodId, 128)) {
      throw new RunpodManagementError('Pod not found.', {
        code: 'RUNPOD_POD_NOT_FOUND', status: 404,
      });
    }
    return pod;
  }

  async transitionManagedPod(podRecordId, action, principal) {
    if (!['start', 'stop'].includes(action)) {
      throw new RunpodManagementError('Unsupported pod action.', {
        code: 'RUNPOD_INPUT_INVALID',
      });
    }
    const actor = actorFromPrincipal(principal);
    const pod = await this.findManagedPod(podRecordId);
    let providerActionAccepted = false;
    try {
      const current = await this.runpodService.getPod(pod.providerPodId);
      if (!normalizeActions(current.actions).includes(action)) {
        throw new RunpodManagementError(`The pod cannot be ${action === 'start' ? 'started' : 'stopped'} in its current state.`, {
          code: 'RUNPOD_ACTION_CONFLICT', status: 409,
        });
      }
      const providerPod = await this.runpodService.transitionPod(pod.providerPodId, action);
      providerActionAccepted = true;
      const now = this.now();
      const autoStopAt = action === 'start'
        ? new Date(now.getTime() + pod.autoStopMinutes * 60 * 1000)
        : null;
      const updateResult = await this.podModel.updateOne(
        { _id: pod._id, archivedAt: null },
        {
          $set: {
            ...reconciledProviderPodFields(pod, providerPod, now),
            autoStopAt,
            lastActionAt: now,
            updatedBy: actor,
          },
        }
      );
      if (updateResult?.matchedCount === 0) {
        throw new RunpodManagementError('The local pod record changed during the provider action.', {
          code: 'RUNPOD_ACTION_CONFLICT', status: 409,
        });
      }
      await this.recordEvent({
        resourceType: 'pod',
        podRecordId: pod._id,
        action,
        outcome: 'succeeded',
        actor,
      });
      if (action === 'start' && pod.setupStatus !== 'ready') {
        this.scheduleProvisioning(pod._id, actor);
      }
      return providerPod;
    } catch (error) {
      if (action === 'start' && providerActionAccepted) {
        try {
          await this.runpodService.transitionPod(pod.providerPodId, 'stop');
        } catch (cleanupError) {
          this.logger.error('Failed to stop a Runpod pod after start-state persistence failed', {
            category: 'runpod_management',
            metadata: {
              action: 'start_cleanup',
              errorCode: safeString(cleanupError?.code, 80) || 'RUNPOD_STOP_FAILED',
              providerStatus: Number.isSafeInteger(cleanupError?.status)
                ? cleanupError.status
                : null,
            },
          });
        }
      }
      await this.recordEvent({
        resourceType: 'pod',
        podRecordId: pod._id,
        action,
        outcome: 'failed',
        providerStatus: Number.isSafeInteger(error?.status) ? error.status : null,
        errorCode: safeString(error?.code, 80) || 'RUNPOD_ACTION_FAILED',
        actor,
      });
      this.logOperationFailure(`Runpod pod ${action} failed`, action, error);
      throw error;
    }
  }

  async deleteManagedPod(podRecordId, confirmation, principal) {
    const actor = actorFromPrincipal(principal);
    const pod = await this.findManagedPod(podRecordId);
    if (safeString(confirmation, 120) !== pod.name) {
      throw new RunpodManagementError('Type the exact pod name to confirm permanent deletion.', {
        code: 'RUNPOD_DELETE_CONFIRMATION_REQUIRED',
      });
    }
    try {
      await this.runpodService.deletePod(pod.providerPodId);
    } catch (error) {
      if (!(error instanceof RunpodApiError) || error.status !== 404) {
        await this.recordEvent({
          resourceType: 'pod',
          podRecordId: pod._id,
          action: 'delete',
          outcome: 'failed',
          providerStatus: Number.isSafeInteger(error?.status) ? error.status : null,
          errorCode: safeString(error?.code, 80) || 'RUNPOD_DELETE_FAILED',
          actor,
        });
        this.logOperationFailure('Runpod pod termination failed', 'delete', error);
        throw error;
      }
    }
    const now = this.now();
    await this.podModel.updateOne(
      { _id: pod._id, archivedAt: null },
      {
        $set: {
          ...usageFieldsForObservation(pod, 'TERMINATED', now, { archivedAt: now }),
          providerStatus: 'TERMINATED',
          lifecycleGroup: 'archived',
          validActions: [],
          providerCostPerHour: 0,
          autoStopAt: null,
          archivedAt: now,
          lastActionAt: now,
          lastProviderSyncAt: now,
          updatedBy: actor,
        },
      }
    );
    await this.recordEvent({
      resourceType: 'pod',
      podRecordId: pod._id,
      action: 'delete',
      outcome: 'succeeded',
      actor,
    });
    return true;
  }

  async syncProviderPods(principal, { recordEvent = true } = {}) {
    const actor = actorFromPrincipal(principal);
    const providerPods = await this.runpodService.listPods();
    const providerIds = new Set();
    const now = this.now();
    let imported = 0;
    let updated = 0;
    for (const providerPod of providerPods.slice(0, MAX_PROVIDER_PODS)) {
      const providerPodId = safeString(providerPod?.id, 128);
      if (!providerPodId) continue;
      providerIds.add(providerPodId);
      const existing = await this.podModel.findOne({ providerPodId }).lean();
      const statusFields = providerPodFields(providerPod, now);
      if (existing) {
        await this.podModel.updateOne(
          { _id: existing._id },
          {
            $set: {
              ...statusFields,
              ...usageFieldsForObservation(existing, providerPod, now),
              updatedBy: actor,
            },
          }
        );
        updated += 1;
        continue;
      }
      const ports = safeArray(providerPod.ports, 20, 40);
      const isOllama = ports.includes(`${OLLAMA_PORT}/http`);
      const providerStatus = normalizeProviderStatus(providerPod.status);
      const usageState = usageStateForStatus(providerStatus);
      const usageStartedAt = usageState === 'running'
        ? dateOrNull(providerPod.startedAt) || dateOrNull(providerPod.createdAt) || now
        : now;
      await this.podModel.create({
        providerPodId,
        name: safeString(providerPod.name, 120) || `Imported ${providerPodId.slice(0, 8)}`,
        recordOrigin: 'provider_import',
        providerTemplateId: safeString(providerPod.template, 128) || null,
        ...statusFields,
        setupStatus: isOllama ? 'pending' : 'not_applicable',
        setupModel: isOllama ? OLLAMA_MODEL : '',
        publicUrl: isOllama ? publicOllamaUrl(providerPodId, OLLAMA_PORT) : null,
        cloud: ['SECURE', 'COMMUNITY'].includes(safeString(providerPod.cloud, 20).toUpperCase())
          ? safeString(providerPod.cloud, 20).toUpperCase()
          : 'UNKNOWN',
        gpu: {
          id: safeString(providerPod.gpu?.id, 240) || 'Unknown GPU',
          name: safeString(providerPod.gpu?.id, 240),
          count: boundedNumber(providerPod.gpu?.count, 1, 1, 16),
          catalogPricePerHour: Math.max(finiteNumber(providerPod.cost, 0), 0),
        },
        diskGb: boundedNumber(providerPod.disk, 20, 1, 1000),
        persistentDiskGb: boundedNumber(providerPod.mounts?.persistent?.size, 10, 10, 1000),
        persistentPath: safeString(providerPod.mounts?.persistent?.path, 300) || '/workspace',
        ports,
        estimatedCostPerHour: Math.max(finiteNumber(providerPod.cost, 0), 0),
        lastRunningCostPerHour: Math.max(finiteNumber(providerPod.cost, 0), 0),
        storageRates: { ...DEFAULT_STORAGE_RATES },
        usageTrackingMode: 'observed',
        usageState,
        usageTrackedSinceAt: usageStartedAt,
        usageStateEnteredAt: now,
        usageLastObservedAt: now,
        runningMs: usageState === 'running'
          ? Math.max(0, now.getTime() - usageStartedAt.getTime())
          : 0,
        stoppedMs: 0,
        maxHourlyCostAcknowledged: Math.max(finiteNumber(providerPod.cost, 0), 0.01),
        autoStopMinutes: this.defaultAutoStopMinutes,
        autoStopAt: ACTIVE_PROVIDER_STATUSES.has(normalizeProviderStatus(providerPod.status))
          ? new Date(now.getTime() + this.defaultAutoStopMinutes * 60 * 1000)
          : null,
        createdBy: actor,
        updatedBy: actor,
      });
      imported += 1;
    }

    const missing = await this.podModel.find({
      archivedAt: null,
      providerPodId: { $nin: Array.from(providerIds) },
    }).limit(MAX_LOCAL_PODS).lean();
    for (const pod of missing) {
      await this.podModel.updateOne(
        { _id: pod._id, archivedAt: null },
        {
          $set: {
            ...usageFieldsForObservation(pod, 'TERMINATED', now, { archivedAt: now }),
            providerStatus: 'TERMINATED',
            lifecycleGroup: 'archived',
            validActions: [],
            providerCostPerHour: 0,
            autoStopAt: null,
            archivedAt: now,
            lastProviderSyncAt: now,
            updatedBy: actor,
          },
        }
      );
    }
    if (recordEvent) {
      await this.recordEvent({
        resourceType: 'pod',
        action: 'sync',
        outcome: 'succeeded',
        actor,
      });
    }
    return { imported, updated, archived: missing.length };
  }

  async stopExpiredPods() {
    const now = this.now();
    const expired = await this.podModel.find({
      lifecycleGroup: 'running',
      archivedAt: null,
      autoStopAt: { $ne: null, $lte: now },
    }).sort({ autoStopAt: 1 }).limit(this.maxActivePods).lean();
    let stopped = 0;
    for (const pod of expired) {
      const actor = actorFromPrincipal({ name: 'runpod-auto-stop' });
      try {
        const current = await this.runpodService.getPod(pod.providerPodId);
        const currentStatus = normalizeProviderStatus(current.status);
        if (normalizeActions(current.actions).includes('stop')) {
          const providerPod = await this.runpodService.transitionPod(pod.providerPodId, 'stop');
          await this.podModel.updateOne(
            { _id: pod._id, archivedAt: null },
            {
              $set: {
                ...reconciledProviderPodFields(pod, providerPod, now),
                autoStopAt: null,
                lastActionAt: now,
                updatedBy: actor,
              },
            }
          );
          stopped += 1;
          await this.recordEvent({
            resourceType: 'pod',
            podRecordId: pod._id,
            action: 'auto_stop',
            outcome: 'succeeded',
            actor,
          });
        } else if (!ACTIVE_PROVIDER_STATUSES.has(currentStatus)) {
          const archivedAt = currentStatus === 'TERMINATED' ? now : null;
          await this.podModel.updateOne(
            { _id: pod._id, archivedAt: null },
            {
              $set: {
                ...reconciledProviderPodFields(pod, current, now, { archivedAt }),
                ...(archivedAt ? { archivedAt } : {}),
                autoStopAt: null,
                updatedBy: actor,
              },
            }
          );
        } else {
          throw new RunpodManagementError(
            'Runpod did not offer a stop action for an active pod whose cost guard expired.',
            { code: 'RUNPOD_ACTION_CONFLICT', status: 409 }
          );
        }
      } catch (error) {
        await this.recordEvent({
          resourceType: 'pod',
          podRecordId: pod._id,
          action: 'auto_stop',
          outcome: 'failed',
          providerStatus: Number.isSafeInteger(error?.status) ? error.status : null,
          errorCode: safeString(error?.code, 80) || 'RUNPOD_AUTO_STOP_FAILED',
          actor,
        });
        this.logOperationFailure('Automatic Runpod pod stop failed', 'auto_stop', error);
      }
    }
    return stopped;
  }

  async resumePendingProvisioning() {
    const pending = await this.podModel.find({
      archivedAt: null,
      setupStatus: { $in: ['pending', 'waiting', 'downloading'] },
    }).sort({ updatedAt: 1 }).limit(this.maxActivePods).lean();
    pending.forEach((pod) => {
      this.scheduleProvisioning(pod._id, actorFromPrincipal({ name: 'runpod-setup-recovery' }));
    });
    return pending.length;
  }
}

const manager = new RunpodPodManager();

module.exports = {
  ACTIVE_PROVIDER_STATUSES,
  AVAILABLE_STOCK,
  DEFAULT_AUTO_STOP_MINUTES,
  DEFAULT_MAX_ACTIVE_PODS,
  DEFAULT_MAX_GPU_COUNT,
  DEFAULT_MAX_HOURLY_COST_USD,
  DEFAULT_MAX_RUNTIME_MINUTES,
  DEFAULT_OLLAMA_PULL_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_PROVISION_TIMEOUT_MS,
  DEFAULT_STORAGE_RATES,
  MILLISECONDS_PER_HOUR,
  MODEL_PATTERN,
  OLLAMA_IMAGE,
  OLLAMA_MODEL,
  OLLAMA_PERSISTENT_PATH,
  OLLAMA_PORT,
  OLLAMA_PROVIDER_TEMPLATE_NAME,
  OLLAMA_TEMPLATE_SLUG,
  RunpodManagementError,
  RunpodPodManager,
  actorFromPrincipal,
  lifecycleGroupForStatus,
  mapPodForPage,
  mergeGpuCatalogs,
  normalizeModelName,
  normalizePodName,
  normalizeTemplateInput,
  providerPodFields,
  providerTemplatePayload,
  projectPodUsage,
  publicOllamaUrl,
  readLimitedText,
  reconciledProviderPodFields,
  runpodPodManager: manager,
  usageFieldsForObservation,
  usageStateForStatus,
  validatedOllamaBaseUrl,
};
