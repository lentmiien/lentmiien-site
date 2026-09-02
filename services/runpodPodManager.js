const logger = require('../utils/logger');
const {
  RunpodModelArtifact,
  RunpodNetworkVolume,
  RunpodOperationEvent,
  RunpodPod,
  RunpodWorkloadTemplate,
} = require('../database');
const {
  GLM53_FLASH_LLAMA_CPP_MODEL_ALIAS,
  GLM53_FLASH_UD_IQ4_XS_SLUG,
  artifactPreparerTemplate,
  artifactServerTemplate,
  getModelArtifactPreset,
  modelArtifactPreparationSignal,
  modelArtifactServingSignal,
} = require('./runpodModelArtifactCatalog');
const {
  RunpodApiError,
  RunpodApiV2Service,
} = require('./runpodApiV2Service');

const OLLAMA_TEMPLATE_SLUG = 'ollama';
const OLLAMA_PROVIDER_TEMPLATE_NAME = 'lentmiien-ollama-gpu-v2';
const OLLAMA_CLOUDFLARE_TEMPLATE_SLUG = 'ollama-cloudflare';
const OLLAMA_CLOUDFLARE_PROVIDER_TEMPLATE_NAME = 'lentmiien-ollama-cloudflare-v2';
const OLLAMA_DOWNLOADER_TEMPLATE_SLUG = 'ollama-downloader';
const OLLAMA_DOWNLOADER_PROVIDER_TEMPLATE_NAME = 'lentmiien-ollama-model-downloader-v2';
const MODEL_ARTIFACT_PREPARER_TEMPLATE_SLUG = 'glm53-artifact-preparer';
const MODEL_ARTIFACT_SERVER_TEMPLATE_SLUG = 'glm53-llama-cpp-cloudflare';
const OLLAMA_IMAGE = 'ollama/ollama:latest';
const OLLAMA_MODEL = 'qwen2.5:0.5b';
const OLLAMA_DOWNLOADER_MODEL = 'qwen3.8:27b';
const OLLAMA_PORT = 11434;
const OLLAMA_PERSISTENT_PATH = '/root/.ollama';
const OLLAMA_NETWORK_VOLUME_PATH = '/workspace';
const OLLAMA_NETWORK_MODELS_PATH = '/workspace/ollama/models';
const OLLAMA_PUBLIC_URL_SUFFIX = '.proxy.runpod.net';
const OLLAMA_ACCESS_MODES = new Set(['runpod_proxy', 'cloudflare_access']);
const OLLAMA_CLOUDFLARE_ORIGIN_PORT = 8080;
const OLLAMA_CLOUDFLARE_ORIGIN_HOST_HEADER = `localhost:${OLLAMA_CLOUDFLARE_ORIGIN_PORT}`;
const DEFAULT_CLOUDFLARE_GATEWAY_URL = 'https://llm.lentmiien.com';
const DEFAULT_CLOUDFLARE_TUNNEL_SECRET_NAME = 'lentmiien_cloudflare_tunnel_token';
const DEFAULT_LLM_API_SECRET_NAME = 'lentmiien_llm_api_key';
const RUNPOD_SECRET_NAME_PATTERN = /^[a-z][a-z0-9_]{0,79}$/u;
const CLOUDFLARED_VERSION = '2026.8.3';
const CLOUDFLARED_AMD64_SHA256 = 'f29324fe934d1e100617484c78deef803c4dc2cd351d645bbde42e96b4fccc5e';
const CLOUDFLARED_AMD64_URL = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64`;
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
const PROVIDER_RESOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const POD_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,79}$/u;
const IMAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/@:+-]{0,498}$/;
const NETWORK_VOLUME_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,79}$/u;
const NETWORK_VOLUME_TYPES = new Set(['STANDARD', 'HIGH_PERFORMANCE']);
const PROXY_POD_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_LOCAL_PODS = 200;
const MAX_PROVIDER_PODS = 200;
const MAX_PROVIDER_TEMPLATES = 500;
const MAX_LOCAL_NETWORK_VOLUMES = 200;
const MAX_PROVIDER_NETWORK_VOLUMES = 200;
const DEFAULT_MAX_ACTIVE_PODS = 2;
const DEFAULT_MAX_GPU_COUNT = 16;
const DEFAULT_MAX_HOURLY_COST_USD = 100;
const DEFAULT_MAX_NETWORK_VOLUME_GB = 2048;
const DEFAULT_MAX_NETWORK_VOLUME_MONTHLY_COST_USD = 150;
const DEFAULT_STANDARD_STORAGE_USD_PER_GB_MONTH = 0.07;
const DEFAULT_AUTO_STOP_MINUTES = 60;
const DEFAULT_MODEL_DOWNLOAD_AUTO_STOP_MINUTES = 240;
const DEFAULT_MODEL_DOWNLOAD_MAX_HOURLY_COST_USD = 1;
const DEFAULT_MAX_RUNTIME_MINUTES = 24 * 60;
const DEFAULT_PROVISION_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_OLLAMA_PULL_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_OLLAMA_MODEL_DOWNLOAD_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MODEL_ARTIFACT_PREPARATION_TIMEOUT_MS = (4 * 60 + 10) * 60 * 1000;
const DEFAULT_LLAMA_CPP_STARTUP_TIMEOUT_MS = 45 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const AUTO_STOP_CLAIM_LEASE_MS = 5 * 60 * 1000;
const OLLAMA_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;
const OLLAMA_ERROR_RESPONSE_LIMIT_BYTES = 64 * 1024;
const OLLAMA_PULL_STREAM_LIMIT_BYTES = 64 * 1024 * 1024;
const OLLAMA_PULL_LINE_LIMIT_BYTES = 64 * 1024;
const OLLAMA_PULL_MAX_ATTEMPTS = 4;
const OLLAMA_PULL_RETRY_CODES = new Set([
  'OLLAMA_NETWORK_ERROR',
  'OLLAMA_PROXY_TIMEOUT',
  'OLLAMA_PULL_INCOMPLETE',
  'OLLAMA_TIMEOUT',
]);
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
    providerCode = null,
    providerTitle = null,
    providerDetail = null,
  } = {}) {
    super(message);
    this.name = 'RunpodManagementError';
    this.code = code;
    this.status = status;
    this.providerStatus = providerStatus;
    this.providerCode = safeString(providerCode, 120) || null;
    this.providerTitle = safeString(providerTitle, 240) || null;
    this.providerDetail = safeString(providerDetail, 1000) || null;
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

function providerStatusForError(error) {
  if (Number.isSafeInteger(error?.providerStatus)) return error.providerStatus;
  if (error instanceof RunpodApiError && Number.isSafeInteger(error?.status)) {
    return error.status;
  }
  return null;
}

function classifyStartFailure(error) {
  if (error instanceof RunpodManagementError || !(error instanceof RunpodApiError)) {
    return error;
  }
  const providerStatus = Number.isSafeInteger(error.status) ? error.status : null;
  const providerFields = {
    providerStatus,
    providerCode: error.providerCode,
    providerTitle: error.providerTitle,
    providerDetail: error.providerDetail,
  };
  if (providerStatus === 402) {
    return new RunpodManagementError('Runpod reported insufficient account balance for this start.', {
      code: 'RUNPOD_INSUFFICIENT_BALANCE',
      status: 402,
      ...providerFields,
    });
  }
  if (providerStatus === 429) {
    return new RunpodManagementError('Runpod is rate limiting Pod starts. Wait briefly and retry.', {
      code: 'RUNPOD_START_RATE_LIMITED',
      status: 429,
      ...providerFields,
    });
  }
  const capacityText = [
    error.providerCode,
    error.providerTitle,
    error.providerDetail,
  ].map((value) => safeString(value, 1000)).filter(Boolean).join(' ');
  const unavailablePattern = /(?:zero|no|unavailable|not available|insufficient|occupied|capacity|unable to (?:find|allocate|resume|start)).{0,100}(?:gpu|machine|host|worker|capacity)|(?:gpu|machine|host|worker|capacity).{0,100}(?:zero|unavailable|not available|insufficient|occupied|unable)/iu;
  if (providerStatus === 409 || unavailablePattern.test(capacityText)) {
    return new RunpodManagementError(
      'The original GPU for this stopped Pod is unavailable. Wait and retry, or delete and redeploy on currently available hardware.',
      {
        code: 'RUNPOD_START_GPU_UNAVAILABLE',
        status: 409,
        ...providerFields,
      }
    );
  }
  return new RunpodManagementError('Runpod rejected the Pod start request.', {
    code: 'RUNPOD_START_FAILED',
    status: providerStatus || 502,
    ...providerFields,
  });
}

function classifyCreateFailure(error, podPurpose = 'ollama_service') {
  if (!(error instanceof RunpodApiError)) return error;
  const detail = [error.providerTitle, error.providerDetail, error.message]
    .map((value) => safeString(value, 1000))
    .join(' ');
  if (/no longer any instances available|no instances available|insufficient capacity/iu.test(detail)) {
    return new RunpodManagementError(
      podPurpose === 'llama_cpp_service'
        ? 'Runpod has no matching multi-GPU machine in the model volume location right now.'
        : 'Runpod has no matching GPU machine for this Pod right now.',
      {
        code: podPurpose === 'llama_cpp_service'
          ? 'RUNPOD_LLM_GPU_UNAVAILABLE'
          : 'RUNPOD_GPU_UNAVAILABLE',
        status: 409,
        providerStatus: error.status,
        providerCode: error.providerCode,
        providerTitle: error.providerTitle,
        providerDetail: error.providerDetail,
      }
    );
  }
  return error;
}

function operationErrorForPersistence(action, error, now = new Date()) {
  const knownError = error instanceof RunpodManagementError || error instanceof RunpodApiError;
  return {
    action,
    code: safeString(error?.code, 80) || 'RUNPOD_ACTION_FAILED',
    providerCode: safeString(error?.providerCode, 120) || null,
    providerStatus: providerStatusForError(error),
    providerTitle: safeString(error?.providerTitle, 240) || null,
    message: (knownError ? safeString(error.message, 500) : '')
      || 'The Pod operation could not be completed.',
    detail: safeString(error?.providerDetail, 1000) || null,
    occurredAt: now,
  };
}

function networkVolumeOperationErrorForPersistence(action, error, now = new Date()) {
  const knownError = error instanceof RunpodManagementError || error instanceof RunpodApiError;
  return {
    action,
    code: safeString(error?.code, 80) || 'RUNPOD_NETWORK_VOLUME_ACTION_FAILED',
    providerCode: safeString(error?.providerCode, 120) || null,
    providerStatus: providerStatusForError(error),
    providerTitle: safeString(error?.providerTitle, 240) || null,
    message: (knownError ? safeString(error.message, 500) : '')
      || 'The network volume operation could not be completed.',
    detail: safeString(error?.providerDetail, 1000) || null,
    occurredAt: now,
  };
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

function normalizeOllamaAccessMode(value) {
  const accessMode = safeString(value, 40).toLowerCase() || 'runpod_proxy';
  return OLLAMA_ACCESS_MODES.has(accessMode) ? accessMode : 'runpod_proxy';
}

function validatedCloudflareGatewayUrl(value = DEFAULT_CLOUDFLARE_GATEWAY_URL) {
  let gateway;
  try {
    gateway = new URL(value);
  } catch (_) {
    throw new RunpodManagementError('The configured Cloudflare gateway URL is invalid.', {
      code: 'RUNPOD_CLOUDFLARE_CONFIGURATION_INVALID', status: 503,
    });
  }
  if (
    gateway.protocol !== 'https:'
    || gateway.username
    || gateway.password
    || gateway.port
    || gateway.pathname !== '/'
    || gateway.search
    || gateway.hash
  ) {
    throw new RunpodManagementError('The configured Cloudflare gateway must be an HTTPS origin URL.', {
      code: 'RUNPOD_CLOUDFLARE_CONFIGURATION_INVALID', status: 503,
    });
  }
  return gateway;
}

function normalizeRunpodSecretName(value = DEFAULT_CLOUDFLARE_TUNNEL_SECRET_NAME) {
  const secretName = safeString(value, 80).toLowerCase();
  if (!RUNPOD_SECRET_NAME_PATTERN.test(secretName)) {
    throw new RunpodManagementError('The configured Runpod tunnel Secret name is invalid.', {
      code: 'RUNPOD_CLOUDFLARE_CONFIGURATION_INVALID', status: 503,
    });
  }
  return secretName;
}

function runpodSecretReference(secretName) {
  return `{{ RUNPOD_SECRET_${normalizeRunpodSecretName(secretName)} }}`;
}

function cloudflareGatewayStartArgs() {
  const script = [
    'set -Eeuo pipefail',
    'cf=/usr/local/bin/cloudflared',
    `if [ ! -x "$cf" ]; then apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl >/dev/null && curl -fsSLo "$cf" '${CLOUDFLARED_AMD64_URL}' && chmod 0755 "$cf"; fi`,
    `printf '%s  %s\\n' '${CLOUDFLARED_AMD64_SHA256}' "$cf" | sha256sum -c - >/dev/null`,
    '/bin/ollama serve & ollama_pid=$!',
    '"$cf" tunnel --no-autoupdate run & tunnel_pid=$!',
    'trap \'kill "$ollama_pid" "$tunnel_pid" 2>/dev/null || true\' EXIT INT TERM',
    'wait -n "$ollama_pid" "$tunnel_pid"',
    'exit 1',
  ].join('; ');
  return JSON.stringify({
    entrypoint: ['/bin/bash', '-lc'],
    cmd: [script],
  });
}

function ollamaServiceUrl(providerPodId, template = {}, cloudflareGatewayUrl) {
  return normalizeOllamaAccessMode(template.accessMode) === 'cloudflare_access'
    ? validatedCloudflareGatewayUrl(cloudflareGatewayUrl || template.gatewayUrl).toString()
    : publicOllamaUrl(providerPodId, template.servicePort || OLLAMA_PORT);
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

function normalizeNetworkVolumeName(value) {
  const name = safeString(value, 80);
  if (!NETWORK_VOLUME_NAME_PATTERN.test(name)) {
    throw new RunpodManagementError(
      'Volume name must start with a letter or number and use at most 80 letters, numbers, spaces, dots, dashes, or underscores.',
      { code: 'RUNPOD_INPUT_INVALID' }
    );
  }
  return name;
}

function normalizeNetworkVolumeType(value) {
  const type = safeString(value, 40).toUpperCase();
  if (!NETWORK_VOLUME_TYPES.has(type)) {
    throw new RunpodManagementError('Choose a supported network volume storage tier.', {
      code: 'RUNPOD_INPUT_INVALID',
    });
  }
  return type;
}

function normalizeProviderNetworkVolumeType(value) {
  const type = safeString(value, 40).toUpperCase();
  return NETWORK_VOLUME_TYPES.has(type) ? type : 'UNKNOWN';
}

function estimateStandardNetworkVolumeMonthlyCost(sizeGb) {
  const size = Math.max(0, finiteNumber(sizeGb, 0));
  const estimate = Math.min(size, 1024) * DEFAULT_STANDARD_STORAGE_USD_PER_GB_MONTH
    + Math.max(0, size - 1024) * 0.05;
  return Math.round(estimate * 1_000_000) / 1_000_000;
}

function providerPodNetworkVolume(providerPod = {}) {
  const mount = Array.isArray(providerPod?.mounts?.network)
    ? providerPod.mounts.network[0]
    : null;
  return {
    id: safeString(mount?.volumeId, 128),
    path: safeString(mount?.path, 300),
  };
}

function networkVolumeToPlain(volume) {
  if (!volume) return null;
  return typeof volume.toObject === 'function' ? volume.toObject() : volume;
}

function providerNetworkVolumeFields(providerVolume = {}, now = new Date()) {
  const sizeGb = boundedNumber(providerVolume.size, 10, 10, 4096);
  const volumeType = normalizeProviderNetworkVolumeType(providerVolume.type);
  return {
    name: safeString(providerVolume.name, 120),
    dataCenterId: safeString(providerVolume.dataCenter, 100),
    volumeType,
    sizeGb,
    lifecycleGroup: 'active',
    providerPresent: true,
    estimatedMonthlyCostUsd: volumeType === 'STANDARD'
      ? estimateStandardNetworkVolumeMonthlyCost(sizeGb)
      : null,
    lastProviderSyncAt: now,
    archivedAt: null,
  };
}

function mapNetworkVolumeForPage(localVolume, providerVolume, attachedPodCount = 0) {
  const local = networkVolumeToPlain(localVolume) || {};
  const provider = providerVolume || {};
  const providerId = safeString(local.providerNetworkVolumeId || provider.id, 128);
  const type = normalizeProviderNetworkVolumeType(provider.type || local.volumeType);
  const sizeGb = finiteNumber(provider.size, finiteNumber(local.sizeGb));
  return {
    id: local._id?.toString?.() || '',
    providerNetworkVolumeId: providerId,
    name: safeString(provider.name || local.name, 120),
    recordOrigin: safeString(local.recordOrigin, 30) || 'provider_import',
    dataCenterId: safeString(provider.dataCenter || local.dataCenterId, 100),
    volumeType: type,
    sizeGb,
    lifecycleGroup: local.archivedAt ? 'archived' : 'active',
    providerPresent: Boolean(provider.id),
    trackedLocally: Boolean(local._id || local.id),
    estimatedMonthlyCostUsd: type === 'STANDARD' && Number.isFinite(sizeGb)
      ? estimateStandardNetworkVolumeMonthlyCost(sizeGb)
      : finiteNumber(local.estimatedMonthlyCostUsd),
    cachedModels: safeArray(local.cachedModels, 100, 120)
      .map((model) => safeString(model, 120).toLowerCase())
      .filter((model) => MODEL_PATTERN.test(model)),
    modelsUpdatedAt: local.modelsUpdatedAt || null,
    attachedPodCount: Math.max(0, finiteNumber(attachedPodCount, 0)),
    lastProviderSyncAt: local.lastProviderSyncAt || null,
    lastOperationError: local.lastOperationError || null,
    archivedAt: local.archivedAt || null,
  };
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
    accessMode: 'runpod_proxy',
    gatewayUrl: null,
    active: true,
  };
}

function normalizeCloudflareTemplateInput(input = {}, {
  gatewayUrl = DEFAULT_CLOUDFLARE_GATEWAY_URL,
  tunnelSecretName = DEFAULT_CLOUDFLARE_TUNNEL_SECRET_NAME,
} = {}) {
  const normalizedGatewayUrl = validatedCloudflareGatewayUrl(gatewayUrl).toString();
  const normalizedSecretName = normalizeRunpodSecretName(tunnelSecretName);
  return {
    slug: OLLAMA_CLOUDFLARE_TEMPLATE_SLUG,
    name: 'Ollama GPU · Cloudflare Access',
    description: 'Ollama with an outbound-only named Cloudflare Tunnel, a stable Access-protected hostname, and no Runpod proxy port.',
    providerTemplateName: normalizePodName(
      input.providerTemplateName || OLLAMA_CLOUDFLARE_PROVIDER_TEMPLATE_NAME
    ),
    image: normalizeImage(input.image),
    args: cloudflareGatewayStartArgs(),
    diskGb: strictInteger(input.diskGb || 20, {
      label: 'Container disk', min: 5, max: 500,
    }),
    ports: [],
    env: {
      OLLAMA_HOST: `127.0.0.1:${OLLAMA_CLOUDFLARE_ORIGIN_PORT}`,
      OLLAMA_MODELS: `${OLLAMA_PERSISTENT_PATH}/models`,
      TUNNEL_TOKEN: runpodSecretReference(normalizedSecretName),
    },
    persistentDiskGb: strictInteger(input.persistentDiskGb || 10, {
      label: 'Persistent disk', min: 10, max: 1000,
    }),
    persistentPath: OLLAMA_PERSISTENT_PATH,
    startSsh: false,
    startJupyter: false,
    setupKind: 'ollama_pull',
    defaultModel: normalizeModelName(input.defaultModel),
    servicePort: OLLAMA_CLOUDFLARE_ORIGIN_PORT,
    healthPath: '/api/tags',
    accessMode: 'cloudflare_access',
    gatewayUrl: normalizedGatewayUrl,
    active: true,
  };
}

function normalizeDownloaderTemplateInput(input = {}) {
  return {
    slug: OLLAMA_DOWNLOADER_TEMPLATE_SLUG,
    name: 'Ollama Model Downloader',
    description: 'Temporary Ollama Pod that downloads and verifies one model on a selected network volume, then deletes itself.',
    providerTemplateName: normalizePodName(
      input.providerTemplateName || OLLAMA_DOWNLOADER_PROVIDER_TEMPLATE_NAME
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
    persistentDiskGb: 10,
    persistentPath: OLLAMA_PERSISTENT_PATH,
    startSsh: false,
    startJupyter: false,
    setupKind: 'ollama_download',
    defaultModel: normalizeModelName(input.defaultModel, OLLAMA_DOWNLOADER_MODEL),
    servicePort: OLLAMA_PORT,
    healthPath: '/api/tags',
    accessMode: 'runpod_proxy',
    gatewayUrl: null,
    active: true,
  };
}

function normalizeModelArtifactPreparerTemplateInput(
  slug = GLM53_FLASH_UD_IQ4_XS_SLUG
) {
  const preset = getModelArtifactPreset(slug);
  if (!preset) {
    throw new RunpodManagementError('Choose a supported model-artifact preset.', {
      code: 'RUNPOD_INPUT_INVALID',
    });
  }
  const providerTemplate = artifactPreparerTemplate(preset.slug);
  return {
    slug: MODEL_ARTIFACT_PREPARER_TEMPLATE_SLUG,
    name: providerTemplate.name,
    description: 'Private, temporary Hugging Face GGUF and pinned llama.cpp artifact preparer with no exposed ports.',
    providerTemplateName: providerTemplate.providerTemplateName,
    image: providerTemplate.image,
    args: providerTemplate.args,
    diskGb: providerTemplate.diskGb,
    ports: [],
    env: providerTemplate.env,
    persistentDiskGb: providerTemplate.persistentDiskGb,
    persistentPath: providerTemplate.persistentPath,
    startSsh: false,
    startJupyter: false,
    setupKind: 'hf_gguf_prepare',
    defaultModel: preset.slug,
    servicePort: 1,
    healthPath: '/',
    accessMode: 'private_none',
    gatewayUrl: null,
    active: true,
  };
}

function normalizeModelArtifactServerTemplateInput(
  slug = GLM53_FLASH_UD_IQ4_XS_SLUG,
  {
    contextTokens,
    gpuCount = 2,
    gatewayUrl = DEFAULT_CLOUDFLARE_GATEWAY_URL,
    tunnelSecretName = DEFAULT_CLOUDFLARE_TUNNEL_SECRET_NAME,
    llmApiSecretName = DEFAULT_LLM_API_SECRET_NAME,
  } = {}
) {
  const preset = getModelArtifactPreset(slug);
  if (!preset) {
    throw new RunpodManagementError('Choose a supported model-artifact preset.', {
      code: 'RUNPOD_INPUT_INVALID',
    });
  }
  const normalizedGatewayUrl = validatedCloudflareGatewayUrl(gatewayUrl).toString();
  const normalizedTunnelSecretName = normalizeRunpodSecretName(tunnelSecretName);
  const normalizedLlmApiSecretName = normalizeRunpodSecretName(llmApiSecretName);
  const template = artifactServerTemplate(preset.slug, {
    contextTokens,
    gpuCount,
    cloudflareTunnelSecretName: normalizedTunnelSecretName,
    llmApiSecretName: normalizedLlmApiSecretName,
  });
  return {
    slug: MODEL_ARTIFACT_SERVER_TEMPLATE_SLUG,
    name: template.name,
    description: 'Pinned llama.cpp serving for the verified GLM artifact, with an outbound-only Cloudflare Tunnel and two-layer authentication.',
    providerTemplateName: template.providerTemplateName,
    image: template.image,
    args: template.args,
    diskGb: template.diskGb,
    ports: [],
    env: template.env,
    persistentDiskGb: template.persistentDiskGb,
    persistentPath: template.persistentPath,
    startSsh: false,
    startJupyter: false,
    setupKind: 'llama_cpp_serve',
    defaultModel: preset.slug,
    servicePort: template.servicePort,
    healthPath: template.healthPath,
    accessMode: 'cloudflare_access',
    gatewayUrl: normalizedGatewayUrl,
    active: true,
  };
}

function modelArtifactToPlain(artifact) {
  if (!artifact) return null;
  return typeof artifact.toObject === 'function' ? artifact.toObject() : artifact;
}

function mapModelArtifactForPage(artifact = {}) {
  const source = modelArtifactToPlain(artifact) || {};
  return {
    id: source._id?.toString?.() || safeString(source.id, 30),
    slug: safeString(source.slug, 120),
    name: safeString(source.name, 160),
    sourceRepository: safeString(source.sourceRepository, 240),
    sourceRevision: safeString(source.sourceRevision, 40),
    variant: safeString(source.variant, 100),
    runtimeKind: safeString(source.runtimeKind, 40),
    runtimeRepository: safeString(source.runtimeRepository, 240),
    runtimeRevision: safeString(source.runtimeRevision, 40),
    providerNetworkVolumeId: safeString(source.providerNetworkVolumeId, 128),
    dataCenterId: safeString(source.dataCenterId, 100),
    relativeModelPath: safeString(source.relativeModelPath, 500),
    relativeRuntimePath: safeString(source.relativeRuntimePath, 500),
    totalBytes: finiteNumber(source.totalBytes),
    recommendedVolumeGb: finiteNumber(source.recommendedVolumeGb),
    recommendedVramGb: finiteNumber(source.recommendedVramGb),
    defaultContextTokens: finiteNumber(source.defaultContextTokens),
    preparationStatus: safeString(source.preparationStatus, 30) || 'planned',
    preparationStage: safeString(source.preparationStage, 40) || 'planned',
    preparationErrorCode: safeString(source.preparationErrorCode, 80) || null,
    providerPreparationPodId: safeString(source.providerPreparationPodId, 128) || null,
    preparationStartedAt: source.preparationStartedAt || null,
    preparationLastObservedAt: source.preparationLastObservedAt || null,
    preparedAt: source.preparedAt || null,
    verifiedAt: source.verifiedAt || null,
    archivedAt: source.archivedAt || null,
  };
}

function chooseModelDownloadGpu(gpus = [], dataCenterId, maxHourlyCost, requestedGpuId = '') {
  const requestedId = safeString(requestedGpuId, 240);
  const stockRank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const candidates = gpus
    .filter((gpu) => {
      const id = safeString(gpu?.id, 240);
      const price = finiteNumber(gpu?.price?.secure);
      const availability = safeString(gpu?.availability, 20).toUpperCase();
      const location = (Array.isArray(gpu?.dataCenters) ? gpu.dataCenters : []).find((entry) => (
        safeString(entry?.id, 100) === dataCenterId
        && AVAILABLE_STOCK.has(safeString(entry?.availability, 20).toUpperCase())
      ));
      return id
        && (!requestedId || id === requestedId)
        && Number.isFinite(price)
        && price > 0
        && price <= maxHourlyCost
        && Number(gpu?.maxCount?.secure) >= 1
        && AVAILABLE_STOCK.has(availability)
        && location;
    })
    .map((gpu) => {
      const location = gpu.dataCenters.find((entry) => safeString(entry?.id, 100) === dataCenterId);
      return {
        gpu,
        price: finiteNumber(gpu.price.secure),
        locationAvailability: safeString(location?.availability, 20).toUpperCase(),
      };
    })
    .sort((left, right) => (
      left.price - right.price
      || (stockRank[left.locationAvailability] ?? 3) - (stockRank[right.locationAvailability] ?? 3)
      || safeString(left.gpu.name || left.gpu.id, 240)
        .localeCompare(safeString(right.gpu.name || right.gpu.id, 240))
    ));
  return candidates[0]?.gpu || null;
}

function templateEnvironment(template = {}) {
  const source = template.env instanceof Map
    ? Object.fromEntries(template.env.entries())
    : template.env;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  return Object.fromEntries(
    Object.entries(source)
      .slice(0, 50)
      .filter(([key]) => /^[A-Z_][A-Z0-9_]{0,79}$/u.test(key))
      .map(([key, value]) => [key, String(value ?? '').slice(0, 2000)])
  );
}

function providerPodUsesCloudflareTunnel(providerPod = {}, {
  tunnelSecretName = DEFAULT_CLOUDFLARE_TUNNEL_SECRET_NAME,
  providerTemplateId = '',
} = {}) {
  const env = templateEnvironment(providerPod);
  const templateMatches = Boolean(providerTemplateId)
    && safeString(providerPod?.template, 128) === safeString(providerTemplateId, 128);
  return templateMatches
    || safeString(env.TUNNEL_TOKEN, 2000) === runpodSecretReference(tunnelSecretName);
}

function providerTemplatePayload(template) {
  return {
    name: template.providerTemplateName,
    image: template.image,
    args: template.args,
    category: 'NVIDIA',
    disk: template.diskGb,
    ports: template.ports,
    env: templateEnvironment(template),
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
      .filter((entry) => entry.id && AVAILABLE_STOCK.has(entry.availability)),
    communityDataCenters: (Array.isArray(communityGpu.dataCenters) ? communityGpu.dataCenters : [])
      .slice(0, 100)
      .map((entry) => ({
        id: safeString(entry?.id, 100),
        name: safeString(entry?.name, 160),
        availability: safeString(entry?.availability, 20).toUpperCase(),
      }))
      .filter((entry) => entry.id && AVAILABLE_STOCK.has(entry.availability)),
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
  const accessMode = value.accessMode === 'private_none'
    ? 'private_none'
    : normalizeOllamaAccessMode(value.accessMode);
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
    setupKind: safeString(value.setupKind, 40),
    defaultModel: safeString(value.defaultModel, 120),
    servicePort: finiteNumber(value.servicePort),
    accessMode,
    gatewayUrl: accessMode === 'cloudflare_access'
      ? safeString(value.gatewayUrl, 500)
      : '',
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
  const providerNetworkMount = providerPodNetworkVolume(provider);
  const accessMode = local.accessMode === 'private_none'
    ? 'private_none'
    : normalizeOllamaAccessMode(local.accessMode);
  let publicUrl = safeString(local.publicUrl, 500);
  if (
    accessMode === 'runpod_proxy'
    && !publicUrl
    && providerId
    && safeArray(local.ports, 20, 40).includes(`${OLLAMA_PORT}/http`)
  ) {
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
    podPurpose: safeString(local.podPurpose, 30) || 'ollama_service',
    modelArtifactRecordId: local.modelArtifactRecordId?.toString?.()
      || safeString(local.modelArtifactRecordId, 30),
    providerStatus: status,
    lifecycleGroup: lifecycleGroupForStatus(status, archivedAt),
    validActions: actions,
    canStart: !archivedAt && actions.includes('start'),
    canStop: !archivedAt && actions.includes('stop'),
    canExtend: !archivedAt && status === 'RUNNING' && actions.includes('stop'),
    canDelete: !archivedAt && (actions.includes('terminate') || !provider.id),
    setupStatus: safeString(local.setupStatus, 30) || 'not_applicable',
    setupErrorCode: safeString(local.setupErrorCode, 80),
    setupModel: safeString(local.setupModel, 120),
    contextTokens: finiteNumber(local.contextTokens),
    setupStartedAt: local.setupStartedAt || null,
    setupCompletedAt: local.setupCompletedAt || null,
    autoDeleteAfterSetup: local.autoDeleteAfterSetup === true,
    cleanupStatus: safeString(local.cleanupStatus, 30) || 'not_required',
    cleanupErrorCode: safeString(local.cleanupErrorCode, 80),
    accessMode,
    publicUrl,
    cloud: safeString(local.cloud || provider.cloud, 20),
    dataCenterId: safeString(provider.dataCenterId || local.dataCenterId, 100),
    providerNetworkVolumeId: providerNetworkMount.id
      || safeString(local.providerNetworkVolumeId, 128),
    networkVolumeName: safeString(local.networkVolumeName, 120),
    networkVolumeType: normalizeProviderNetworkVolumeType(local.networkVolumeType),
    networkVolumeSizeGb: finiteNumber(local.networkVolumeSizeGb),
    networkVolumeMountPath: providerNetworkMount.path
      || safeString(local.networkVolumeMountPath, 300),
    diskGb: finiteNumber(local.diskGb),
    persistentDiskGb: finiteNumber(local.persistentDiskGb),
    persistentPath: safeString(local.persistentPath, 300),
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
    autoStopMinutes: finiteNumber(local.autoStopMinutes),
    autoStopAt: local.autoStopAt || null,
    lastOperationError: local.lastOperationError && typeof local.lastOperationError === 'object'
      ? {
        action: safeString(local.lastOperationError.action, 20),
        code: safeString(local.lastOperationError.code, 80),
        providerCode: safeString(local.lastOperationError.providerCode, 120),
        providerStatus: providerStatusForError(local.lastOperationError),
        providerTitle: safeString(local.lastOperationError.providerTitle, 240),
        message: safeString(local.lastOperationError.message, 500),
        detail: safeString(local.lastOperationError.detail, 1000),
        occurredAt: local.lastOperationError.occurredAt || null,
      }
      : null,
    createdAt: local.createdAt || null,
    archivedAt,
    providerReachable: Boolean(provider.id),
  };
}

function mapUnmanagedProviderPod(provider = {}) {
  const status = normalizeProviderStatus(provider.status);
  const networkVolume = providerPodNetworkVolume(provider);
  return {
    providerPodId: safeString(provider.id, 128),
    name: safeString(provider.name, 120),
    providerStatus: status,
    lifecycleGroup: lifecycleGroupForStatus(status),
    gpuId: safeString(provider.gpu?.id, 240),
    gpuCount: finiteNumber(provider.gpu?.count),
    cloud: safeString(provider.cloud, 20),
    dataCenterId: safeString(provider.dataCenterId, 100),
    providerNetworkVolumeId: networkVolume.id,
    networkVolumeMountPath: networkVolume.path,
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

function classifyOllamaFailure(pathname, providerStatus, responseText = '') {
  const detail = safeString(responseText, 2000).toLowerCase();
  if (
    providerStatus === 524
    || providerStatus === 504
    || providerStatus === 408
    || detail.includes('a timeout occurred')
  ) {
    return 'OLLAMA_PROXY_TIMEOUT';
  }
  if (
    detail.includes('no space left on device')
    || detail.includes('insufficient disk')
    || detail.includes('not enough disk')
    || providerStatus === 507
  ) {
    return 'OLLAMA_STORAGE_FULL';
  }
  if (
    pathname === '/api/pull'
    && (
      providerStatus === 404
      || /manifest[^.]{0,80}(?:not found|does not exist)/u.test(detail)
      || /model[^.]{0,80}not found/u.test(detail)
    )
  ) {
    return 'OLLAMA_MODEL_NOT_FOUND';
  }
  if (
    detail.includes('newer version of ollama')
    || detail.includes('unsupported model format')
    || detail.includes('unsupported architecture')
  ) {
    return 'OLLAMA_VERSION_UNSUPPORTED';
  }
  if (pathname === '/api/tags' && providerStatus === 403) {
    return 'OLLAMA_GATEWAY_FORBIDDEN';
  }
  if (providerStatus === 429) return 'OLLAMA_RATE_LIMITED';
  return 'OLLAMA_HTTP_ERROR';
}

function ollamaFailureMessage(code) {
  const messages = {
    OLLAMA_MODEL_NOT_FOUND: 'The requested model was not found in the Ollama registry.',
    OLLAMA_PROXY_TIMEOUT: 'The Runpod proxy timed out while Ollama was working.',
    OLLAMA_RATE_LIMITED: 'Ollama temporarily rejected the request because of rate limiting.',
    OLLAMA_STORAGE_FULL: 'The Ollama model disk does not have enough free space.',
    OLLAMA_VERSION_UNSUPPORTED: 'The Ollama runtime does not support this model.',
    OLLAMA_GATEWAY_FORBIDDEN: 'The gateway reached Ollama, but Ollama rejected its origin Host header.',
  };
  return messages[code] || 'The Ollama service returned an error.';
}

async function ollamaHttpError(response, pathname) {
  let responseText = '';
  try {
    responseText = await readLimitedText(response, OLLAMA_ERROR_RESPONSE_LIMIT_BYTES);
  } catch (_) {
    await response.body?.cancel?.().catch?.(() => {});
  }
  const providerStatus = Number.isSafeInteger(response?.status) ? response.status : null;
  const code = classifyOllamaFailure(pathname, providerStatus, responseText);
  return new RunpodManagementError(ollamaFailureMessage(code), {
    code,
    status: code === 'OLLAMA_PROXY_TIMEOUT' ? 504 : 502,
    providerStatus,
  });
}

function parseOllamaPullLine(line, state) {
  const normalized = line.trim();
  if (!normalized) return;
  if (Buffer.byteLength(normalized, 'utf8') > OLLAMA_PULL_LINE_LIMIT_BYTES) {
    throw new RunpodManagementError('Ollama returned an oversized model-pull update.', {
      code: 'OLLAMA_RESPONSE_TOO_LARGE', status: 502,
    });
  }
  let entry;
  try {
    entry = JSON.parse(normalized);
  } catch (_) {
    throw new RunpodManagementError('Ollama returned invalid model-pull data.', {
      code: 'OLLAMA_INVALID_RESPONSE', status: 502,
    });
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new RunpodManagementError('Ollama returned invalid model-pull data.', {
      code: 'OLLAMA_INVALID_RESPONSE', status: 502,
    });
  }
  if (entry.error) {
    const code = classifyOllamaFailure('/api/pull', null, entry.error);
    const normalizedCode = code === 'OLLAMA_HTTP_ERROR' ? 'OLLAMA_PULL_FAILED' : code;
    throw new RunpodManagementError(ollamaFailureMessage(normalizedCode), {
      code: normalizedCode,
      status: 502,
    });
  }
  const status = safeString(entry.status, 160).toLowerCase();
  if (!status) {
    throw new RunpodManagementError('Ollama returned invalid model-pull data.', {
      code: 'OLLAMA_INVALID_RESPONSE', status: 502,
    });
  }
  state.records += 1;
  state.lastStatus = status;
  if (status === 'success') state.success = true;
}

async function readOllamaPullStream(response) {
  const state = { success: false, records: 0, lastStatus: '' };
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > OLLAMA_PULL_STREAM_LIMIT_BYTES) {
      throw new RunpodManagementError('Ollama returned more model-pull data than expected.', {
        code: 'OLLAMA_RESPONSE_TOO_LARGE', status: 502,
      });
    }
    text.split(/\r?\n/u).forEach((line) => parseOllamaPullLine(line, state));
  } else {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let totalBytes = 0;
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > OLLAMA_PULL_STREAM_LIMIT_BYTES) {
          throw new RunpodManagementError('Ollama returned more model-pull data than expected.', {
            code: 'OLLAMA_RESPONSE_TOO_LARGE', status: 502,
          });
        }
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          parseOllamaPullLine(buffer.slice(0, newline), state);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
        }
        if (Buffer.byteLength(buffer, 'utf8') > OLLAMA_PULL_LINE_LIMIT_BYTES) {
          throw new RunpodManagementError('Ollama returned an oversized model-pull update.', {
            code: 'OLLAMA_RESPONSE_TOO_LARGE', status: 502,
          });
        }
      }
      buffer += decoder.decode();
      parseOllamaPullLine(buffer, state);
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    }
  }
  if (!state.records) {
    throw new RunpodManagementError('Ollama returned no model-pull updates.', {
      code: 'OLLAMA_INVALID_RESPONSE', status: 502,
    });
  }
  if (!state.success) {
    throw new RunpodManagementError('The Ollama model-pull stream ended before completion.', {
      code: 'OLLAMA_PULL_INCOMPLETE', status: 502,
    });
  }
  return state;
}

function validatedOllamaBaseUrl(value, {
  accessMode = 'runpod_proxy',
  cloudflareGatewayUrl = DEFAULT_CLOUDFLARE_GATEWAY_URL,
} = {}) {
  let base;
  try {
    base = new URL(value);
  } catch (_) {
    throw new RunpodManagementError('The derived Ollama URL is invalid.', {
      code: 'OLLAMA_URL_INVALID', status: 500,
    });
  }
  if (normalizeOllamaAccessMode(accessMode) === 'cloudflare_access') {
    const configured = validatedCloudflareGatewayUrl(cloudflareGatewayUrl);
    if (base.toString() !== configured.toString()) {
      throw new RunpodManagementError('The Ollama gateway URL does not match the configured origin.', {
        code: 'OLLAMA_URL_INVALID', status: 500,
      });
    }
    return base;
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
    networkVolumeModel = RunpodNetworkVolume,
    modelArtifactModel = RunpodModelArtifact,
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
    maxNetworkVolumeGb = positiveInteger(
      process.env.RUNPOD_MAX_NETWORK_VOLUME_GB,
      DEFAULT_MAX_NETWORK_VOLUME_GB
    ),
    maxNetworkVolumeMonthlyCostUsd = positiveNumber(
      process.env.RUNPOD_MAX_NETWORK_VOLUME_MONTHLY_COST_USD,
      DEFAULT_MAX_NETWORK_VOLUME_MONTHLY_COST_USD
    ),
    highPerformanceStorageUsdPerGbMonth = positiveNumber(
      process.env.RUNPOD_HIGH_PERFORMANCE_STORAGE_USD_PER_GB_MONTH,
      null
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
    modelDownloadTimeoutMs = positiveInteger(
      process.env.RUNPOD_OLLAMA_MODEL_DOWNLOAD_TIMEOUT_MS,
      DEFAULT_OLLAMA_MODEL_DOWNLOAD_TIMEOUT_MS
    ),
    modelArtifactPreparationTimeoutMs = positiveInteger(
      process.env.RUNPOD_MODEL_ARTIFACT_PREPARATION_TIMEOUT_MS,
      DEFAULT_MODEL_ARTIFACT_PREPARATION_TIMEOUT_MS
    ),
    llamaCppStartupTimeoutMs = positiveInteger(
      process.env.RUNPOD_LLAMA_CPP_STARTUP_TIMEOUT_MS,
      DEFAULT_LLAMA_CPP_STARTUP_TIMEOUT_MS
    ),
    pollIntervalMs = positiveInteger(
      process.env.RUNPOD_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS
    ),
    cloudflareGatewayUrl = process.env.RUNPOD_CLOUDFLARE_GATEWAY_URL
      || DEFAULT_CLOUDFLARE_GATEWAY_URL,
    cloudflareTunnelSecretName = process.env.RUNPOD_CLOUDFLARE_TUNNEL_SECRET_NAME
      || DEFAULT_CLOUDFLARE_TUNNEL_SECRET_NAME,
    cloudflareAccessClientId = process.env.RUNPOD_CLOUDFLARE_ACCESS_CLIENT_ID || '',
    cloudflareAccessClientSecret = process.env.RUNPOD_CLOUDFLARE_ACCESS_CLIENT_SECRET || '',
    cloudflareTunnelTokenConfigured = Boolean(process.env.RUNPOD_CLOUDFLARE_TUNNEL_TOKEN),
    llmApiKey = process.env.RUNPOD_LLM_API_KEY || '',
    llmApiSecretName = process.env.RUNPOD_LLM_API_SECRET_NAME || DEFAULT_LLM_API_SECRET_NAME,
  } = {}) {
    this.runpodService = runpodService;
    this.podModel = podModel;
    this.networkVolumeModel = networkVolumeModel;
    this.modelArtifactModel = modelArtifactModel;
    this.templateModel = templateModel;
    this.eventModel = eventModel;
    this.fetch = fetchImpl;
    this.logger = appLogger;
    this.now = now;
    this.sleep = sleepImpl;
    this.maxActivePods = Math.min(maxActivePods, 20);
    this.maxGpuCount = Math.min(maxGpuCount, 32);
    this.maxHourlyCostUsd = Math.min(maxHourlyCostUsd, 500);
    this.maxNetworkVolumeGb = Math.min(maxNetworkVolumeGb, 4096);
    this.maxNetworkVolumeMonthlyCostUsd = Math.min(maxNetworkVolumeMonthlyCostUsd, 500);
    this.highPerformanceStorageUsdPerGbMonth = highPerformanceStorageUsdPerGbMonth;
    this.maxRuntimeMinutes = Math.max(15, Math.min(maxRuntimeMinutes, 7 * 24 * 60));
    this.defaultAutoStopMinutes = Math.max(
      15,
      Math.min(defaultAutoStopMinutes, this.maxRuntimeMinutes)
    );
    this.provisionTimeoutMs = provisionTimeoutMs;
    this.ollamaPullTimeoutMs = ollamaPullTimeoutMs;
    this.modelDownloadTimeoutMs = modelDownloadTimeoutMs;
    this.modelArtifactPreparationTimeoutMs = Math.min(
      modelArtifactPreparationTimeoutMs,
      24 * 60 * 60 * 1000
    );
    this.llamaCppStartupTimeoutMs = Math.min(
      llamaCppStartupTimeoutMs,
      2 * 60 * 60 * 1000
    );
    this.pollIntervalMs = pollIntervalMs;
    this.cloudflareGatewayUrl = validatedCloudflareGatewayUrl(cloudflareGatewayUrl).toString();
    this.cloudflareTunnelSecretName = normalizeRunpodSecretName(cloudflareTunnelSecretName);
    this.cloudflareAccessClientId = String(cloudflareAccessClientId || '').trim().slice(0, 500);
    this.cloudflareAccessClientSecret = String(cloudflareAccessClientSecret || '').trim().slice(0, 1000);
    this.cloudflareTunnelTokenConfigured = cloudflareTunnelTokenConfigured === true;
    this.llmApiKey = String(llmApiKey || '').trim().slice(0, 2000);
    this.llmApiKeyConfigured = Boolean(this.llmApiKey);
    this.llmApiSecretName = normalizeRunpodSecretName(llmApiSecretName);
    this.provisioning = new Map();
    this.creationQueue = Promise.resolve();
    this.templateQueue = Promise.resolve();
    this.networkVolumeQueue = Promise.resolve();
  }

  limits() {
    return {
      maxActivePods: this.maxActivePods,
      maxGpuCount: this.maxGpuCount,
      maxHourlyCostUsd: this.maxHourlyCostUsd,
      maxNetworkVolumeGb: this.maxNetworkVolumeGb,
      maxNetworkVolumeMonthlyCostUsd: this.maxNetworkVolumeMonthlyCostUsd,
      standardStorageUsdPerGbMonth: DEFAULT_STANDARD_STORAGE_USD_PER_GB_MONTH,
      highPerformanceStorageUsdPerGbMonth: this.highPerformanceStorageUsdPerGbMonth,
      defaultAutoStopMinutes: this.defaultAutoStopMinutes,
      defaultModelDownloadAutoStopMinutes: Math.min(
        DEFAULT_MODEL_DOWNLOAD_AUTO_STOP_MINUTES,
        this.maxRuntimeMinutes
      ),
      defaultModelDownloadMaxHourlyCostUsd: Math.min(
        DEFAULT_MODEL_DOWNLOAD_MAX_HOURLY_COST_USD,
        this.maxHourlyCostUsd
      ),
      defaultModelArtifactMaxHourlyCostUsd: Math.min(
        getModelArtifactPreset(GLM53_FLASH_UD_IQ4_XS_SLUG).preparationMaxHourlyCostUsd,
        this.maxHourlyCostUsd
      ),
      maxRuntimeMinutes: this.maxRuntimeMinutes,
    };
  }

  gatewayConfiguration() {
    const serviceTokenConfigured = Boolean(
      this.cloudflareAccessClientId && this.cloudflareAccessClientSecret
    );
    return {
      accessMode: 'cloudflare_access',
      gatewayUrl: this.cloudflareGatewayUrl,
      originHostHeader: OLLAMA_CLOUDFLARE_ORIGIN_HOST_HEADER,
      serviceTokenConfigured,
      serviceTokenPartiallyConfigured: Boolean(
        this.cloudflareAccessClientId || this.cloudflareAccessClientSecret
      ) && !serviceTokenConfigured,
      tunnelTokenConfigured: this.cloudflareTunnelTokenConfigured,
      runpodSecretName: this.cloudflareTunnelSecretName,
      llmApiKeyConfigured: this.llmApiKeyConfigured,
      llmApiSecretName: this.llmApiSecretName,
      readyForTemplate: serviceTokenConfigured && this.cloudflareTunnelTokenConfigured,
      readyForLargeModel: serviceTokenConfigured
        && this.cloudflareTunnelTokenConfigured
        && this.llmApiKeyConfigured,
    };
  }

  async verifyCloudflareAccessServiceToken({ timeoutMs = 15_000 } = {}) {
    if (typeof this.fetch !== 'function') {
      throw new RunpodManagementError('Cloudflare Access connectivity is not configured.', {
        code: 'RUNPOD_CLOUDFLARE_ACCESS_PREFLIGHT_FAILED', status: 503,
      });
    }
    if (!this.gatewayConfiguration().serviceTokenConfigured) {
      throw new RunpodManagementError(
        'Cloudflare Access service-token credentials are not configured on this server.',
        { code: 'RUNPOD_CLOUDFLARE_NOT_CONFIGURED', status: 503 }
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), positiveInteger(timeoutMs, 15_000));
    try {
      const requestStatus = async (headers) => {
        const response = await this.fetch(new URL('/api/tags', this.cloudflareGatewayUrl), {
          headers,
          redirect: 'manual',
          signal: controller.signal,
        });
        try {
          await response.body?.cancel?.();
        } catch (_) {
          // Only the status is needed for this bounded preflight.
        }
        return response.status;
      };
      const accessDenied = (status) => status === 401
        || status === 403
        || (status >= 300 && status < 400);
      const anonymousStatus = await requestStatus({ Accept: 'application/json' });
      if (!accessDenied(anonymousStatus)) {
        throw new RunpodManagementError(
          'Cloudflare Access did not block the anonymous gateway preflight. Protect the entire hostname before renting a GPU.',
          { code: 'RUNPOD_CLOUDFLARE_ACCESS_NOT_ENFORCED', status: 503 }
        );
      }
      const authenticatedStatus = await requestStatus({
        Accept: 'application/json',
        'CF-Access-Client-Id': this.cloudflareAccessClientId,
        'CF-Access-Client-Secret': this.cloudflareAccessClientSecret,
      });
      if (accessDenied(authenticatedStatus)) {
        throw new RunpodManagementError(
          'The Cloudflare Access application did not authorize the configured service token. Add it to a Service Auth policy before renting a GPU.',
          { code: 'RUNPOD_CLOUDFLARE_ACCESS_DENIED', status: 503 }
        );
      }
      return { anonymousStatus, authenticatedStatus };
    } catch (error) {
      if (error instanceof RunpodManagementError) throw error;
      if (error?.name === 'AbortError') {
        throw new RunpodManagementError('The Cloudflare Access preflight timed out.', {
          code: 'RUNPOD_CLOUDFLARE_ACCESS_PREFLIGHT_FAILED', status: 504,
        });
      }
      throw new RunpodManagementError('The Cloudflare Access preflight could not reach the gateway.', {
        code: 'RUNPOD_CLOUDFLARE_ACCESS_PREFLIGHT_FAILED', status: 502,
      });
    } finally {
      clearTimeout(timer);
    }
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
        providerStatus: providerStatusForError(error),
      },
    });
  }

  async persistPodOperationError(
    podRecordId,
    action,
    error,
    actor,
    { filter = {}, fields = {} } = {}
  ) {
    try {
      await this.podModel.updateOne(
        { _id: podRecordId, archivedAt: null, ...filter },
        {
          $set: {
            lastOperationError: operationErrorForPersistence(action, error, this.now()),
            ...fields,
            updatedBy: actor,
          },
        }
      );
    } catch (persistenceError) {
      this.logger.warning('Unable to persist the latest Runpod Pod operation error', {
        category: 'runpod_management',
        metadata: {
          action,
          errorName: safeString(persistenceError?.name, 80) || 'Error',
        },
      });
    }
  }

  async persistNetworkVolumeOperationError(providerNetworkVolumeId, action, error, actor) {
    try {
      await this.networkVolumeModel.updateOne(
        { providerNetworkVolumeId, archivedAt: null },
        {
          $set: {
            lastOperationError: networkVolumeOperationErrorForPersistence(
              action,
              error,
              this.now()
            ),
            updatedBy: actor,
          },
        }
      );
    } catch (persistenceError) {
      this.logger.warning('Unable to persist the latest Runpod network volume operation error', {
        category: 'runpod_management',
        metadata: {
          action,
          errorName: safeString(persistenceError?.name, 80) || 'Error',
        },
      });
    }
  }

  async getAdminState() {
    const operations = {
      templates: () => this.templateModel.find({ active: true }).sort({ name: 1 }).lean(),
      pods: () => this.podModel.find({}).sort({ createdAt: -1 }).limit(MAX_LOCAL_PODS).lean(),
      networkVolumes: () => this.networkVolumeModel.find({})
        .sort({ createdAt: -1 })
        .limit(MAX_LOCAL_NETWORK_VOLUMES)
        .lean(),
      modelArtifacts: () => this.modelArtifactModel.find({})
        .sort({ createdAt: -1 })
        .limit(MAX_LOCAL_NETWORK_VOLUMES)
        .lean(),
      providerPods: () => this.runpodService.listPods(),
      providerNetworkVolumes: () => this.runpodService.listNetworkVolumes(),
      providerTemplates: () => this.runpodService.getAccountTemplates(),
      secureGpus: () => this.runpodService.getGpuTypes({ cloud: 'SECURE' }),
      communityGpus: () => this.runpodService.getGpuTypes({ cloud: 'COMMUNITY' }),
    };
    const entries = Object.entries(operations);
    const settled = await Promise.allSettled(
      entries.map(([, operation]) => Promise.resolve().then(operation))
    );
    const values = {
      templates: [],
      pods: [],
      networkVolumes: [],
      modelArtifacts: [],
      providerPods: [],
      providerNetworkVolumes: [],
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
    const providerNetworkVolumes = values.providerNetworkVolumes.slice(0, MAX_PROVIDER_NETWORK_VOLUMES);
    const providerTemplates = values.providerTemplates.slice(0, MAX_PROVIDER_TEMPLATES);
    const providerPodsById = new Map(providerPods.map((pod) => [safeString(pod?.id, 128), pod]));
    const providerTemplateIds = new Set(
      providerTemplates.map((template) => safeString(template?.id, 128)).filter(Boolean)
    );
    const localProviderPodIds = new Set(
      values.pods.map((pod) => safeString(pod?.providerPodId, 128)).filter(Boolean)
    );
    const providerNetworkVolumesById = new Map(
      providerNetworkVolumes.map((volume) => [safeString(volume?.id, 128), volume])
    );
    const localProviderNetworkVolumeIds = new Set(
      values.networkVolumes
        .map((volume) => safeString(volume?.providerNetworkVolumeId, 128))
        .filter(Boolean)
    );
    const attachedPodCounts = new Map();
    const providerPodIds = new Set(providerPods.map((pod) => safeString(pod?.id, 128)));
    const podsForAttachmentCounts = [
      ...providerPods,
      ...values.pods.filter((pod) => (
        !pod?.archivedAt
        && pod?.lifecycleGroup !== 'archived'
        && !providerPodIds.has(safeString(pod?.providerPodId, 128))
      )),
    ];
    podsForAttachmentCounts.forEach((pod) => {
      const providerMount = providerPodNetworkVolume(pod);
      const volumeId = providerMount.id || safeString(pod?.providerNetworkVolumeId, 128);
      if (!volumeId) return;
      attachedPodCounts.set(volumeId, (attachedPodCounts.get(volumeId) || 0) + 1);
    });
    const pageNow = this.now();
    const mappedPods = values.pods.map((pod) => (
      mapPodForPage(
        pod,
        providerPodsById.get(safeString(pod?.providerPodId, 128)),
        pageNow
      )
    ));
    const mappedNetworkVolumes = values.networkVolumes.map((volume) => {
      const providerId = safeString(volume?.providerNetworkVolumeId, 128);
      return mapNetworkVolumeForPage(
        volume,
        providerNetworkVolumesById.get(providerId),
        attachedPodCounts.get(providerId) || 0
      );
    });
    providerNetworkVolumes
      .filter((volume) => !localProviderNetworkVolumeIds.has(safeString(volume?.id, 128)))
      .forEach((volume) => {
        mappedNetworkVolumes.push(mapNetworkVolumeForPage(
          null,
          volume,
          attachedPodCounts.get(safeString(volume?.id, 128)) || 0
        ));
      });

    return {
      limits: this.limits(),
      gateway: this.gatewayConfiguration(),
      templates: values.templates.map((template) => mapTemplateForPage(template, providerTemplateIds)),
      managedPods: mappedPods.filter((pod) => (
        !['model_download', 'model_artifact_prepare'].includes(pod.podPurpose)
        && pod.lifecycleGroup !== 'archived'
      )),
      archivedPods: mappedPods.filter((pod) => (
        !['model_download', 'model_artifact_prepare'].includes(pod.podPurpose)
        && pod.lifecycleGroup === 'archived'
      )),
      modelDownloads: mappedPods.filter((pod) => pod.podPurpose === 'model_download'),
      modelArtifactPreparations: mappedPods.filter((pod) => (
        pod.podPurpose === 'model_artifact_prepare'
      )),
      modelArtifacts: values.modelArtifacts.map(mapModelArtifactForPage),
      modelArtifactPresets: [mapModelArtifactForPage({
        ...getModelArtifactPreset(GLM53_FLASH_UD_IQ4_XS_SLUG),
        preparationStatus: 'planned',
        preparationStage: 'planned',
      })],
      networkVolumes: mappedNetworkVolumes.filter((volume) => volume.lifecycleGroup === 'active'),
      archivedNetworkVolumes: mappedNetworkVolumes
        .filter((volume) => volume.lifecycleGroup === 'archived'),
      unmanagedProviderPods: providerPods
        .filter((pod) => !localProviderPodIds.has(safeString(pod?.id, 128)))
        .map(mapUnmanagedProviderPod),
      providerTemplateCount: providerTemplates.length,
      gpuOptions: mergeGpuCatalogs(values.secureGpus, values.communityGpus),
      errors,
    };
  }

  estimateNetworkVolumeMonthlyCost(sizeGb, volumeType) {
    if (volumeType === 'STANDARD') {
      return estimateStandardNetworkVolumeMonthlyCost(sizeGb);
    }
    if (volumeType === 'HIGH_PERFORMANCE' && this.highPerformanceStorageUsdPerGbMonth) {
      return sizeGb * this.highPerformanceStorageUsdPerGbMonth;
    }
    return null;
  }

  async trackProviderNetworkVolume(providerVolume, actor, recordOrigin = 'provider_import') {
    const providerNetworkVolumeId = safeString(providerVolume?.id, 128);
    if (!PROVIDER_RESOURCE_ID_PATTERN.test(providerNetworkVolumeId)) {
      throw new RunpodManagementError('Runpod did not return a valid network volume ID.', {
        code: 'RUNPOD_INVALID_RESPONSE',
        status: 502,
      });
    }
    const fields = providerNetworkVolumeFields(providerVolume, this.now());
    if (!fields.name || !fields.dataCenterId) {
      throw new RunpodManagementError('Runpod returned incomplete network volume data.', {
        code: 'RUNPOD_INVALID_RESPONSE',
        status: 502,
      });
    }
    return this.networkVolumeModel.findOneAndUpdate(
      { providerNetworkVolumeId },
      {
        $set: {
          ...fields,
          lastOperationError: null,
          updatedBy: actor,
        },
        $setOnInsert: {
          recordOrigin,
          createdBy: actor,
        },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
  }

  createManagedNetworkVolume(input, principal) {
    const operation = this.networkVolumeQueue.then(() => (
      this._createManagedNetworkVolume(input, principal)
    ));
    this.networkVolumeQueue = operation.catch(() => {});
    return operation;
  }

  async _createManagedNetworkVolume(input = {}, principal) {
    const actor = actorFromPrincipal(principal);
    const name = normalizeNetworkVolumeName(input.name);
    const sizeGb = strictInteger(input.sizeGb, {
      label: 'Network volume size',
      min: 10,
      max: this.maxNetworkVolumeGb,
    });
    const volumeType = normalizeNetworkVolumeType(input.volumeType || 'STANDARD');
    const dataCenterId = safeString(input.dataCenterId, 100);
    if (!PROVIDER_RESOURCE_ID_PATTERN.test(dataCenterId)) {
      throw new RunpodManagementError('Choose a valid network-volume data center.', {
        code: 'RUNPOD_INPUT_INVALID',
      });
    }
    if (input.storageBillingAcknowledged !== 'acknowledged') {
      throw new RunpodManagementError('Acknowledge that network storage bills until deletion.', {
        code: 'RUNPOD_NETWORK_VOLUME_BILLING_NOT_ACKNOWLEDGED',
      });
    }

    const estimatedMonthlyCostUsd = this.estimateNetworkVolumeMonthlyCost(sizeGb, volumeType);
    if (!Number.isFinite(estimatedMonthlyCostUsd)) {
      throw new RunpodManagementError(
        'High-performance storage creation is disabled until its current per-GB rate is configured.',
        { code: 'RUNPOD_NETWORK_VOLUME_RATE_NOT_CONFIGURED', status: 409 }
      );
    }
    const maxMonthlyCost = strictMoney(input.maxMonthlyCost, {
      label: 'Maximum monthly storage cost',
      max: this.maxNetworkVolumeMonthlyCostUsd,
    });
    if (
      estimatedMonthlyCostUsd > maxMonthlyCost
      || estimatedMonthlyCostUsd > this.maxNetworkVolumeMonthlyCostUsd
    ) {
      throw new RunpodManagementError(
        'The estimated network-volume price exceeds the confirmed monthly limit.',
        { code: 'RUNPOD_NETWORK_VOLUME_COST_LIMIT_EXCEEDED', status: 409 }
      );
    }

    const dataCenters = await this.runpodService.getDataCenters({ forceRefresh: true });
    const dataCenter = dataCenters.find((entry) => safeString(entry?.id, 100) === dataCenterId);
    const supportedTypes = safeArray(dataCenter?.networkVolumeTypes, 10, 40)
      .map((entry) => entry.toUpperCase());
    if (!dataCenter || !supportedTypes.includes(volumeType)) {
      throw new RunpodManagementError(
        'The selected data center does not offer that network-volume tier.',
        { code: 'RUNPOD_NETWORK_VOLUME_DATACENTER_UNAVAILABLE', status: 409 }
      );
    }

    let providerVolume;
    let localVolume;
    try {
      providerVolume = await this.runpodService.createNetworkVolume({
        name,
        size: sizeGb,
        dataCenter: dataCenterId,
        type: volumeType,
      });
      localVolume = await this.trackProviderNetworkVolume(providerVolume, actor, 'managed');
      await this.recordEvent({
        resourceType: 'network_volume',
        networkVolumeRecordId: localVolume?._id || null,
        action: 'create',
        outcome: 'succeeded',
        actor,
      });
      return networkVolumeToPlain(localVolume);
    } catch (error) {
      if (providerVolume?.id && !localVolume) {
        try {
          await this.runpodService.deleteNetworkVolume(providerVolume.id);
        } catch (cleanupError) {
          this.logger.error('Failed to delete an untracked Runpod network volume after creation failure', {
            category: 'runpod_management',
            metadata: {
              action: 'network_volume_create_cleanup',
              errorCode: safeString(cleanupError?.code, 80) || 'RUNPOD_CLEANUP_FAILED',
              providerStatus: providerStatusForError(cleanupError),
            },
          });
        }
      }
      await this.recordEvent({
        resourceType: 'network_volume',
        action: 'create',
        outcome: 'failed',
        providerStatus: providerStatusForError(error),
        errorCode: safeString(error?.code, 80) || 'RUNPOD_NETWORK_VOLUME_CREATE_FAILED',
        actor,
      });
      this.logOperationFailure('Runpod network volume creation failed', 'network_volume_create', error);
      throw error;
    }
  }

  async syncProviderNetworkVolumes(principal, { recordEvent = true } = {}) {
    const actor = actorFromPrincipal(principal);
    const providerVolumes = (await this.runpodService.listNetworkVolumes())
      .slice(0, MAX_PROVIDER_NETWORK_VOLUMES);
    const providerIds = new Set();
    let imported = 0;
    let updated = 0;
    for (const providerVolume of providerVolumes) {
      const providerId = safeString(providerVolume?.id, 128);
      if (!PROVIDER_RESOURCE_ID_PATTERN.test(providerId)) continue;
      providerIds.add(providerId);
      const existing = await this.networkVolumeModel.findOne({
        providerNetworkVolumeId: providerId,
      }).lean();
      await this.trackProviderNetworkVolume(
        providerVolume,
        actor,
        existing?.recordOrigin || 'provider_import'
      );
      if (existing) updated += 1;
      else imported += 1;
    }

    const missing = await this.networkVolumeModel.find({
      archivedAt: null,
      providerNetworkVolumeId: { $nin: Array.from(providerIds) },
    }).limit(MAX_LOCAL_NETWORK_VOLUMES).lean();
    const now = this.now();
    for (const volume of missing) {
      await this.networkVolumeModel.updateOne(
        { _id: volume._id, archivedAt: null },
        {
          $set: {
            lifecycleGroup: 'archived',
            providerPresent: false,
            archivedAt: now,
            lastProviderSyncAt: now,
            updatedBy: actor,
          },
        }
      );
    }

    if (recordEvent) {
      await this.recordEvent({
        resourceType: 'network_volume',
        action: 'sync',
        outcome: 'succeeded',
        actor,
      });
    }
    return { imported, updated, archived: missing.length };
  }

  async deleteManagedNetworkVolume(networkVolumeRecordId, confirmation, principal) {
    const actor = actorFromPrincipal(principal);
    const recordId = safeString(networkVolumeRecordId, 30);
    if (!OBJECT_ID_PATTERN.test(recordId)) {
      throw new RunpodManagementError('Network volume not found.', {
        code: 'RUNPOD_NETWORK_VOLUME_NOT_FOUND',
        status: 404,
      });
    }

    const localVolume = await this.networkVolumeModel.findOne({
      _id: recordId,
      archivedAt: null,
    }).lean();
    const providerId = safeString(localVolume?.providerNetworkVolumeId, 128);
    if (!localVolume || !PROVIDER_RESOURCE_ID_PATTERN.test(providerId)) {
      throw new RunpodManagementError('Network volume not found.', {
        code: 'RUNPOD_NETWORK_VOLUME_NOT_FOUND',
        status: 404,
      });
    }

    const [providerVolumes, providerPods] = await Promise.all([
      this.runpodService.listNetworkVolumes(),
      this.runpodService.listPods(),
    ]);
    const providerVolume = providerVolumes.find((volume) => safeString(volume?.id, 128) === providerId);
    const expectedName = safeString(providerVolume?.name || localVolume?.name, 120);
    if (!expectedName || safeString(confirmation, 120) !== expectedName) {
      throw new RunpodManagementError(
        'Type the exact network volume name to confirm permanent deletion.',
        { code: 'RUNPOD_NETWORK_VOLUME_DELETE_CONFIRMATION_REQUIRED' }
      );
    }
    const attached = providerPods.some((pod) => providerPodNetworkVolume(pod).id === providerId);
    if (attached) {
      throw new RunpodManagementError(
        'Delete every Pod attached to this network volume before deleting the volume.',
        { code: 'RUNPOD_NETWORK_VOLUME_IN_USE', status: 409 }
      );
    }

    const tracked = localVolume;
    try {
      if (providerVolume) await this.runpodService.deleteNetworkVolume(providerId);
      const now = this.now();
      await this.networkVolumeModel.updateOne(
        { _id: tracked._id },
        {
          $set: {
            lifecycleGroup: 'archived',
            providerPresent: false,
            archivedAt: now,
            lastProviderSyncAt: now,
            lastOperationError: null,
            updatedBy: actor,
          },
        }
      );
      await this.recordEvent({
        resourceType: 'network_volume',
        networkVolumeRecordId: tracked._id,
        action: 'delete',
        outcome: 'succeeded',
        actor,
      });
      return true;
    } catch (error) {
      await this.persistNetworkVolumeOperationError(providerId, 'delete', error, actor);
      await this.recordEvent({
        resourceType: 'network_volume',
        networkVolumeRecordId: tracked?._id || null,
        action: 'delete',
        outcome: 'failed',
        providerStatus: providerStatusForError(error),
        errorCode: safeString(error?.code, 80) || 'RUNPOD_NETWORK_VOLUME_DELETE_FAILED',
        actor,
      });
      this.logOperationFailure('Runpod network volume deletion failed', 'network_volume_delete', error);
      throw error;
    }
  }

  saveOllamaTemplate(input, principal) {
    const operation = this.templateQueue.then(() => this._saveOllamaTemplate(
      normalizeTemplateInput(input),
      principal
    ));
    this.templateQueue = operation.catch(() => {});
    return operation;
  }

  saveOllamaCloudflareTemplate(input, principal) {
    const gateway = this.gatewayConfiguration();
    if (!gateway.readyForTemplate) {
      throw new RunpodManagementError(
        'Configure the Cloudflare tunnel token and Access service-token credentials before syncing this template.',
        { code: 'RUNPOD_CLOUDFLARE_NOT_CONFIGURED', status: 503 }
      );
    }
    const operation = this.templateQueue.then(() => this._saveOllamaTemplate(
      normalizeCloudflareTemplateInput(input, {
        gatewayUrl: this.cloudflareGatewayUrl,
        tunnelSecretName: this.cloudflareTunnelSecretName,
      }),
      principal
    ));
    this.templateQueue = operation.catch(() => {});
    return operation;
  }

  saveOllamaDownloaderTemplate(input, principal) {
    const operation = this.templateQueue.then(() => this._saveOllamaTemplate(
      normalizeDownloaderTemplateInput(input),
      principal
    ));
    this.templateQueue = operation.catch(() => {});
    return operation;
  }

  saveModelArtifactPreparerTemplate(presetSlug, principal) {
    const operation = this.templateQueue.then(() => this._saveOllamaTemplate(
      normalizeModelArtifactPreparerTemplateInput(presetSlug),
      principal
    ));
    this.templateQueue = operation.catch(() => {});
    return operation;
  }

  saveModelArtifactServerTemplate(presetSlug, principal, options = {}) {
    const gateway = this.gatewayConfiguration();
    if (!gateway.readyForLargeModel) {
      throw new RunpodManagementError(
        'Configure the Cloudflare tunnel, Access service token, and native LLM API key before syncing the large-model template.',
        { code: 'RUNPOD_LLM_GATEWAY_NOT_CONFIGURED', status: 503 }
      );
    }
    const operation = this.templateQueue.then(() => this._saveOllamaTemplate(
      normalizeModelArtifactServerTemplateInput(presetSlug, {
        ...options,
        gatewayUrl: this.cloudflareGatewayUrl,
        tunnelSecretName: this.cloudflareTunnelSecretName,
        llmApiSecretName: this.llmApiSecretName,
      }),
      principal
    ));
    this.templateQueue = operation.catch(() => {});
    return operation;
  }

  async _saveOllamaTemplate(normalized, principal) {
    const actor = actorFromPrincipal(principal);
    let localTemplate = await this.templateModel.findOne({ slug: normalized.slug }).lean();
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
        { slug: normalized.slug },
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
        providerStatus: providerStatusForError(error),
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

  createModelDownload(input, principal) {
    const operation = this.creationQueue.then(() => this._createModelDownload(input, principal));
    this.creationQueue = operation.catch(() => {});
    return operation;
  }

  prepareModelArtifact(input, principal) {
    const operation = this.creationQueue.then(() => (
      this._prepareModelArtifact(input, principal)
    ));
    this.creationQueue = operation.catch(() => {});
    return operation;
  }

  createModelArtifactPod(input, principal) {
    const operation = this.creationQueue.then(() => (
      this._createModelArtifactPod(input, principal)
    ));
    this.creationQueue = operation.catch(() => {});
    return operation;
  }

  async _createModelArtifactPod(input = {}, principal) {
    const artifactId = safeString(input.artifactId, 30);
    if (!OBJECT_ID_PATTERN.test(artifactId)) {
      throw new RunpodManagementError('Choose a verified model artifact.', {
        code: 'RUNPOD_INPUT_INVALID',
      });
    }
    if (input.billingAcknowledged !== 'acknowledged') {
      throw new RunpodManagementError('Acknowledge the large-model GPU cost before creating the Pod.', {
        code: 'RUNPOD_LLM_BILLING_NOT_ACKNOWLEDGED',
      });
    }
    const artifact = await this.modelArtifactModel.findOne({
      _id: artifactId,
      preparationStatus: 'ready',
      archivedAt: null,
    }).lean();
    const preset = artifact ? getModelArtifactPreset(artifact.slug) : null;
    if (!artifact || !preset) {
      throw new RunpodManagementError(
        'Verify and record the approved GLM artifact before creating a serving Pod.',
        { code: 'RUNPOD_MODEL_ARTIFACT_NOT_READY', status: 409 }
      );
    }
    const gpuCount = strictInteger(input.gpuCount || 2, {
      label: 'GPU count', min: 1, max: this.maxGpuCount,
    });
    const contextTokens = strictInteger(input.contextTokens || preset.defaultContextTokens, {
      label: 'Context size', min: 2048, max: 131072,
    });
    const template = await this.saveModelArtifactServerTemplate(preset.slug, principal, {
      contextTokens,
      gpuCount,
    });
    const templateId = template?._id?.toString?.() || safeString(template?._id, 30);
    const name = safeString(input.name, 80) || `glm53-${gpuCount}gpu-${this.now().getTime().toString(36)}`;
    return this._createManagedPod({
      ...input,
      name,
      templateId,
      networkVolumeId: artifact.providerNetworkVolumeId,
      dataCenterId: artifact.dataCenterId,
      cloud: 'SECURE',
      gpuCount: String(gpuCount),
      model: preset.slug,
      diskGb: String(input.diskGb || 40),
      autoStopMinutes: String(input.autoStopMinutes || this.defaultAutoStopMinutes),
    }, principal, {
      podPurpose: 'llama_cpp_service',
      modelArtifactRecordId: artifact._id,
      contextTokens,
      requiredVramGb: preset.recommendedVramGb,
    });
  }

  async _prepareModelArtifact(input = {}, principal) {
    const actor = actorFromPrincipal(principal);
    const presetSlug = safeString(input.presetSlug, 120).toLowerCase();
    const preset = getModelArtifactPreset(presetSlug);
    if (!preset) {
      throw new RunpodManagementError('Choose a supported model-artifact preset.', {
        code: 'RUNPOD_INPUT_INVALID',
      });
    }
    const providerNetworkVolumeId = safeString(input.networkVolumeId, 128);
    if (!PROVIDER_RESOURCE_ID_PATTERN.test(providerNetworkVolumeId)) {
      throw new RunpodManagementError('Choose a network volume for the model artifact.', {
        code: 'RUNPOD_INPUT_INVALID',
      });
    }
    if (input.preparationBillingAcknowledged !== 'acknowledged') {
      throw new RunpodManagementError('Acknowledge the temporary preparation compute cost.', {
        code: 'RUNPOD_ARTIFACT_BILLING_NOT_ACKNOWLEDGED',
      });
    }
    const hardCostLimit = Math.min(preset.preparationMaxHourlyCostUsd, this.maxHourlyCostUsd);
    const maxHourlyCost = strictMoney(
      input.maxHourlyCost || hardCostLimit.toFixed(2),
      { label: 'Maximum artifact-preparation hourly cost', max: hardCostLimit }
    );
    const requestedGpuId = safeString(input.gpuId, 240);
    const [providerPods, providerVolumes] = await Promise.all([
      this.runpodService.listPods(),
      this.runpodService.listNetworkVolumes(),
    ]);
    const volume = providerVolumes.find((entry) => (
      safeString(entry?.id, 128) === providerNetworkVolumeId
    ));
    if (!volume) {
      throw new RunpodManagementError('The selected network volume no longer exists.', {
        code: 'RUNPOD_NETWORK_VOLUME_NOT_FOUND', status: 404,
      });
    }
    if (finiteNumber(volume.size, 0) < preset.recommendedVolumeGb) {
      throw new RunpodManagementError(
        `This preset requires a network volume of at least ${preset.recommendedVolumeGb} GB.`,
        { code: 'RUNPOD_ARTIFACT_VOLUME_TOO_SMALL', status: 409 }
      );
    }
    if (providerPods.some((pod) => providerPodNetworkVolume(pod).id === providerNetworkVolumeId)) {
      throw new RunpodManagementError('The selected model-artifact volume is already attached to a Pod.', {
        code: 'RUNPOD_NETWORK_VOLUME_IN_USE', status: 409,
      });
    }
    const dataCenterId = safeString(volume.dataCenter, 100);
    const existingArtifact = await this.modelArtifactModel.findOne({
      slug: preset.slug,
      providerNetworkVolumeId,
      archivedAt: null,
    }).lean();
    if (existingArtifact?.preparationStatus === 'preparing') {
      throw new RunpodManagementError('This model artifact is already being prepared.', {
        code: 'RUNPOD_ARTIFACT_ALREADY_PREPARING', status: 409,
      });
    }
    if (existingArtifact?.preparationStatus === 'ready') {
      throw new RunpodManagementError('This model artifact is already verified on the selected volume.', {
        code: 'RUNPOD_ARTIFACT_ALREADY_READY', status: 409,
      });
    }
    const trackedVolume = await this.trackProviderNetworkVolume(volume, actor, 'provider_import');
    let artifact = await this.modelArtifactModel.findOneAndUpdate(
      { slug: preset.slug, providerNetworkVolumeId },
      {
        $set: {
          slug: preset.slug,
          name: preset.name,
          sourceKind: preset.sourceKind,
          sourceRepository: preset.sourceRepository,
          sourceRevision: preset.sourceRevision,
          sourceLastModifiedAt: preset.sourceLastModifiedAt,
          variant: preset.variant,
          runtimeKind: preset.runtimeKind,
          runtimeRepository: preset.runtimeRepository,
          runtimeRevision: preset.runtimeRevision,
          relativeModelPath: preset.relativeModelPath,
          relativeRuntimePath: preset.relativeRuntimePath,
          manifest: preset.manifest.map((entry) => ({ ...entry })),
          totalBytes: preset.totalBytes,
          recommendedVolumeGb: preset.recommendedVolumeGb,
          recommendedVramGb: preset.recommendedVramGb,
          defaultContextTokens: preset.defaultContextTokens,
          networkVolumeRecordId: trackedVolume._id,
          providerNetworkVolumeId,
          dataCenterId,
          preparationStatus: 'planned',
          preparationStage: 'planned',
          preparationErrorCode: null,
          preparationPodRecordId: null,
          providerPreparationPodId: null,
          archivedAt: null,
          updatedBy: actor,
        },
        $setOnInsert: {
          createdBy: actor,
        },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    if (providerPods.filter((pod) => (
      ACTIVE_PROVIDER_STATUSES.has(normalizeProviderStatus(pod?.status))
    )).length >= this.maxActivePods) {
      throw new RunpodManagementError(
        `The configured limit of ${this.maxActivePods} active Runpod pods has been reached.`,
        { code: 'RUNPOD_ACTIVE_POD_LIMIT', status: 409 }
      );
    }
    const secureGpus = await this.runpodService.getGpuTypes({
      cloud: 'SECURE',
      forceRefresh: true,
    });
    const gpu = chooseModelDownloadGpu(
      secureGpus,
      dataCenterId,
      maxHourlyCost,
      requestedGpuId
    );
    if (!gpu) {
      throw new RunpodManagementError(
        'No compatible Secure Cloud preparation GPU is currently available in the volume location below the confirmed cost limit.',
        { code: 'RUNPOD_ARTIFACT_GPU_UNAVAILABLE', status: 409 }
      );
    }
    const template = await this.saveModelArtifactPreparerTemplate(preset.slug, principal);
    const startedAt = this.now();
    artifact = await this.modelArtifactModel.findOneAndUpdate(
      { slug: preset.slug, providerNetworkVolumeId },
      {
        $set: {
          slug: preset.slug,
          name: preset.name,
          sourceKind: preset.sourceKind,
          sourceRepository: preset.sourceRepository,
          sourceRevision: preset.sourceRevision,
          sourceLastModifiedAt: preset.sourceLastModifiedAt,
          variant: preset.variant,
          runtimeKind: preset.runtimeKind,
          runtimeRepository: preset.runtimeRepository,
          runtimeRevision: preset.runtimeRevision,
          relativeModelPath: preset.relativeModelPath,
          relativeRuntimePath: preset.relativeRuntimePath,
          manifest: preset.manifest.map((entry) => ({ ...entry })),
          totalBytes: preset.totalBytes,
          recommendedVolumeGb: preset.recommendedVolumeGb,
          recommendedVramGb: preset.recommendedVramGb,
          defaultContextTokens: preset.defaultContextTokens,
          networkVolumeRecordId: trackedVolume._id,
          providerNetworkVolumeId,
          dataCenterId,
          preparationStatus: 'preparing',
          preparationStage: 'provisioning',
          preparationPodRecordId: null,
          providerPreparationPodId: null,
          preparationErrorCode: null,
          preparationStartedAt: startedAt,
          preparationLastObservedAt: startedAt,
          preparedAt: null,
          verifiedAt: null,
          archivedAt: null,
          updatedBy: actor,
        },
        $setOnInsert: { createdBy: actor },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    const price = finiteNumber(gpu?.price?.secure);
    const name = normalizePodName(`prepare-glm53-iq4-${startedAt.getTime().toString(36)}`);
    const autoStopMinutes = Math.min(
      Math.floor(preset.preparationTimeoutSeconds / 60),
      this.maxRuntimeMinutes
    );
    let providerPod;
    let localPod;
    try {
      providerPod = await this.runpodService.createPod({
        name,
        templateId: template.providerTemplateId,
        cloud: 'SECURE',
        gpu: { id: safeString(gpu.id, 240), count: 1 },
        disk: preset.preparationDiskGb,
        mounts: {
          network: [{ volumeId: providerNetworkVolumeId, path: OLLAMA_NETWORK_VOLUME_PATH }],
        },
        dataCenterIds: [dataCenterId],
        globalNetworking: false,
      });
      const providerCost = finiteNumber(providerPod.cost, price);
      if (providerCost > maxHourlyCost || providerCost > hardCostLimit) {
        throw new RunpodManagementError(
          'Runpod returned an artifact-preparation Pod above the confirmed hourly limit.',
          { code: 'RUNPOD_COST_LIMIT_EXCEEDED', status: 409 }
        );
      }
      const providerPodId = safeString(providerPod.id, 128);
      localPod = await this.podModel.create({
        providerPodId,
        name,
        recordOrigin: 'managed',
        podPurpose: 'model_artifact_prepare',
        workloadTemplateId: template._id,
        modelArtifactRecordId: artifact._id,
        providerTemplateId: template.providerTemplateId,
        ...providerPodFields(providerPod, startedAt),
        setupStatus: 'waiting',
        setupModel: preset.slug,
        setupStartedAt: startedAt,
        autoDeleteAfterSetup: true,
        cleanupStatus: 'pending',
        accessMode: 'private_none',
        publicUrl: null,
        cloud: 'SECURE',
        dataCenterId: safeString(providerPod.dataCenterId || dataCenterId, 100),
        gpu: {
          id: safeString(gpu.id, 240),
          name: safeString(gpu.name || gpu.id, 240),
          memoryGb: finiteNumber(gpu.memory),
          count: 1,
          catalogPricePerHour: price,
        },
        diskGb: preset.preparationDiskGb,
        persistentDiskGb: null,
        persistentPath: OLLAMA_NETWORK_VOLUME_PATH,
        networkVolumeRecordId: trackedVolume._id,
        providerNetworkVolumeId,
        networkVolumeName: safeString(volume.name, 120),
        networkVolumeType: normalizeProviderNetworkVolumeType(volume.type),
        networkVolumeSizeGb: finiteNumber(volume.size),
        networkVolumeMountPath: OLLAMA_NETWORK_VOLUME_PATH,
        ports: [],
        estimatedCostPerHour: price,
        providerCostPerHour: providerCost,
        lastRunningCostPerHour: price,
        storageRates: { ...DEFAULT_STORAGE_RATES },
        usageTrackingMode: 'observed',
        usageState: usageStateForStatus(providerPod.status),
        usageTrackedSinceAt: startedAt,
        usageStateEnteredAt: startedAt,
        usageLastObservedAt: startedAt,
        runningMs: 0,
        stoppedMs: 0,
        maxHourlyCostAcknowledged: maxHourlyCost,
        autoStopMinutes,
        autoStopAt: new Date(startedAt.getTime() + autoStopMinutes * 60 * 1000),
        lastActionAt: startedAt,
        createdBy: actor,
        updatedBy: actor,
      });
      artifact = await this.modelArtifactModel.findOneAndUpdate(
        { _id: artifact._id },
        {
          $set: {
            preparationPodRecordId: localPod._id,
            providerPreparationPodId: providerPodId,
            updatedBy: actor,
          },
        },
        { new: true, runValidators: true }
      );
      await this.recordEvent({
        resourceType: 'model_artifact',
        modelArtifactRecordId: artifact._id,
        networkVolumeRecordId: trackedVolume._id,
        podRecordId: localPod._id,
        action: 'artifact_prepare',
        outcome: 'requested',
        actor,
      });
      this.scheduleModelArtifactPreparation(localPod._id, artifact._id, actor);
      return mapModelArtifactForPage(artifact);
    } catch (error) {
      if (providerPod?.id) {
        await this.runpodService.deletePod(providerPod.id).catch((cleanupError) => {
          this.logger.error('Failed to delete a Runpod artifact-preparation Pod after creation failure', {
            category: 'runpod_management',
            metadata: {
              action: 'artifact_prepare_create_cleanup',
              errorCode: safeString(cleanupError?.code, 80) || 'RUNPOD_CLEANUP_FAILED',
              providerStatus: providerStatusForError(cleanupError),
            },
          });
        });
      }
      const failedAt = this.now();
      await this.modelArtifactModel.updateOne(
        { _id: artifact?._id },
        {
          $set: {
            preparationStatus: 'failed',
            preparationStage: 'failed',
            preparationErrorCode: safeString(error?.code, 80) || 'RUNPOD_ARTIFACT_PREPARATION_FAILED',
            preparationLastObservedAt: failedAt,
            updatedBy: actor,
          },
        }
      ).catch(() => {});
      if (localPod?._id) {
        await this.podModel.updateOne(
          { _id: localPod._id },
          {
            $set: {
              providerStatus: 'TERMINATED',
              lifecycleGroup: 'archived',
              setupStatus: 'failed',
              setupErrorCode: safeString(error?.code, 80) || 'RUNPOD_ARTIFACT_PREPARATION_FAILED',
              cleanupStatus: 'completed',
              archivedAt: failedAt,
              updatedBy: actor,
            },
          }
        ).catch(() => {});
      }
      await this.recordEvent({
        resourceType: 'model_artifact',
        modelArtifactRecordId: artifact?._id || null,
        networkVolumeRecordId: trackedVolume?._id || null,
        podRecordId: localPod?._id || null,
        action: 'artifact_prepare',
        outcome: 'failed',
        providerStatus: providerStatusForError(error),
        errorCode: safeString(error?.code, 80) || 'RUNPOD_ARTIFACT_PREPARATION_FAILED',
        actor,
      });
      this.logOperationFailure('Runpod model-artifact preparation could not be started', 'artifact_prepare', error);
      throw error;
    }
  }

  async _createModelDownload(input = {}, principal) {
    const model = normalizeModelName(input.model, OLLAMA_DOWNLOADER_MODEL);
    const providerNetworkVolumeId = safeString(input.networkVolumeId, 128);
    if (!PROVIDER_RESOURCE_ID_PATTERN.test(providerNetworkVolumeId)) {
      throw new RunpodManagementError('Choose a network volume for the model download.', {
        code: 'RUNPOD_INPUT_INVALID',
      });
    }
    if (input.publicAccessAcknowledged !== 'acknowledged') {
      throw new RunpodManagementError('Acknowledge the temporary public Ollama proxy URL.', {
        code: 'RUNPOD_PUBLIC_ACCESS_NOT_ACKNOWLEDGED',
      });
    }
    const maxHourlyCost = strictMoney(
      input.maxHourlyCost || Math.min(
        DEFAULT_MODEL_DOWNLOAD_MAX_HOURLY_COST_USD,
        this.maxHourlyCostUsd
      ).toFixed(2),
      { label: 'Maximum downloader hourly cost', max: this.maxHourlyCostUsd }
    );
    const autoStopMinutes = strictInteger(
      input.autoStopMinutes || Math.min(
        DEFAULT_MODEL_DOWNLOAD_AUTO_STOP_MINUTES,
        this.maxRuntimeMinutes
      ),
      { label: 'Download time limit', min: 15, max: this.maxRuntimeMinutes }
    );
    const diskGb = strictInteger(input.diskGb || 20, {
      label: 'Container disk', min: 5, max: 500,
    });
    const requestedGpuId = safeString(input.gpuId, 240);
    const [providerNetworkVolumes, secureGpus] = await Promise.all([
      this.runpodService.listNetworkVolumes(),
      this.runpodService.getGpuTypes({ cloud: 'SECURE', forceRefresh: true }),
    ]);
    const volume = providerNetworkVolumes.find((entry) => (
      safeString(entry?.id, 128) === providerNetworkVolumeId
    ));
    if (!volume) {
      throw new RunpodManagementError('The selected network volume no longer exists.', {
        code: 'RUNPOD_NETWORK_VOLUME_NOT_FOUND', status: 404,
      });
    }
    const dataCenterId = safeString(volume.dataCenter, 100);
    const selectedGpu = chooseModelDownloadGpu(
      secureGpus,
      dataCenterId,
      maxHourlyCost,
      requestedGpuId
    );
    if (!selectedGpu) {
      throw new RunpodManagementError(
        requestedGpuId
          ? 'The requested downloader GPU is unavailable in the volume location or exceeds the cost limit.'
          : 'No Secure Cloud GPU is currently available in the volume location below the downloader cost limit.',
        { code: 'RUNPOD_DOWNLOAD_GPU_UNAVAILABLE', status: 409 }
      );
    }

    const template = await this.saveOllamaDownloaderTemplate({
      defaultModel: model,
      diskGb,
    }, principal);
    const templateId = template?._id?.toString?.() || safeString(template?._id, 30);
    const modelStem = model.replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 44);
    const name = normalizePodName(
      `download-${modelStem || 'ollama-model'}-${this.now().getTime().toString(36)}`
    );
    return this._createManagedPod({
      name,
      templateId,
      networkVolumeId: providerNetworkVolumeId,
      cloud: 'SECURE',
      gpuId: safeString(selectedGpu.id, 240),
      gpuCount: '1',
      dataCenterId,
      model,
      diskGb: String(diskGb),
      autoStopMinutes: String(autoStopMinutes),
      maxHourlyCost: String(maxHourlyCost),
      publicAccessAcknowledged: 'acknowledged',
    }, principal, {
      podPurpose: 'model_download',
      autoDeleteAfterSetup: true,
    });
  }

  async _createManagedPod(input = {}, principal, options = {}) {
    const actor = actorFromPrincipal(principal);
    const podPurpose = ['model_download', 'llama_cpp_service'].includes(options.podPurpose)
      ? options.podPurpose
      : 'ollama_service';
    const autoDeleteAfterSetup = podPurpose === 'model_download'
      && options.autoDeleteAfterSetup === true;
    const providerNetworkVolumeId = safeString(input.networkVolumeId, 128);
    if (providerNetworkVolumeId && !PROVIDER_RESOURCE_ID_PATTERN.test(providerNetworkVolumeId)) {
      throw new RunpodManagementError('Choose a valid network volume.', {
        code: 'RUNPOD_INPUT_INVALID',
      });
    }
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
    const expectedSetupKind = podPurpose === 'model_download'
      ? 'ollama_download'
      : podPurpose === 'llama_cpp_service'
        ? 'llama_cpp_serve'
        : 'ollama_pull';
    if (template.setupKind !== expectedSetupKind) {
      throw new RunpodManagementError('The selected workload template does not match this operation.', {
        code: 'RUNPOD_TEMPLATE_NOT_READY', status: 409,
      });
    }
    if (['model_download', 'llama_cpp_service'].includes(podPurpose) && !providerNetworkVolumeId) {
      throw new RunpodManagementError('This workload requires a network volume.', {
        code: 'RUNPOD_INPUT_INVALID',
      });
    }
    const accessMode = normalizeOllamaAccessMode(template.accessMode);
    if (
      accessMode === 'cloudflare_access'
      && !this.gatewayConfiguration().serviceTokenConfigured
    ) {
      throw new RunpodManagementError(
        'Cloudflare Access service-token credentials are not configured on this server.',
        { code: 'RUNPOD_CLOUDFLARE_NOT_CONFIGURED', status: 503 }
      );
    }
    if (
      podPurpose === 'llama_cpp_service'
      && !this.gatewayConfiguration().readyForLargeModel
    ) {
      throw new RunpodManagementError(
        'The Cloudflare gateway and native LLM API key must be configured before creating a large-model Pod.',
        { code: 'RUNPOD_LLM_GATEWAY_NOT_CONFIGURED', status: 503 }
      );
    }

    const cloud = safeString(input.cloud, 20).toUpperCase();
    if (!['SECURE', 'COMMUNITY'].includes(cloud)) {
      throw new RunpodManagementError('Choose Secure or Community Cloud.', {
        code: 'RUNPOD_INPUT_INVALID',
      });
    }
    if (providerNetworkVolumeId && cloud !== 'SECURE') {
      throw new RunpodManagementError('Runpod Pod network volumes require Secure Cloud.', {
        code: 'RUNPOD_NETWORK_VOLUME_SECURE_CLOUD_REQUIRED',
        status: 409,
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
    if (
      accessMode === 'runpod_proxy'
      && input.publicAccessAcknowledged !== 'acknowledged'
    ) {
      throw new RunpodManagementError('Acknowledge that the Ollama proxy URL is public.', {
        code: 'RUNPOD_PUBLIC_ACCESS_NOT_ACKNOWLEDGED',
      });
    }

    const [providerPods, gpuCatalog, providerNetworkVolumes] = await Promise.all([
      this.runpodService.listPods(),
      this.runpodService.getGpuTypes({ cloud, forceRefresh: true }),
      providerNetworkVolumeId
        ? this.runpodService.listNetworkVolumes()
        : Promise.resolve([]),
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
    if (
      accessMode === 'cloudflare_access'
      && providerPods.some((pod) => (
        providerPodUsesCloudflareTunnel(pod, {
          tunnelSecretName: this.cloudflareTunnelSecretName,
          providerTemplateId: template.providerTemplateId,
        })
        && ACTIVE_PROVIDER_STATUSES.has(normalizeProviderStatus(pod?.status))
      ))
    ) {
      throw new RunpodManagementError(
        'This named Cloudflare Tunnel already has an active managed connector. Stop it before creating another gateway Pod.',
        { code: 'RUNPOD_GATEWAY_CONNECTOR_CONFLICT', status: 409 }
      );
    }
    if (accessMode === 'cloudflare_access') {
      await this.verifyCloudflareAccessServiceToken();
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
    const requiredVramGb = finiteNumber(options.requiredVramGb);
    const aggregateVramGb = finiteNumber(gpu?.memory, 0) * gpuCount;
    if (Number.isFinite(requiredVramGb) && aggregateVramGb < requiredVramGb) {
      throw new RunpodManagementError(
        `This model requires at least ${requiredVramGb} GB aggregate VRAM for the approved first-run profile.`,
        { code: 'RUNPOD_LLM_VRAM_INSUFFICIENT', status: 409 }
      );
    }
    const estimatedCost = price * gpuCount;
    if (estimatedCost > maxHourlyCost || estimatedCost > this.maxHourlyCostUsd) {
      throw new RunpodManagementError('The current catalog price exceeds the confirmed hourly limit.', {
        code: 'RUNPOD_COST_LIMIT_EXCEEDED', status: 409,
      });
    }

    const selectedNetworkVolume = providerNetworkVolumeId
      ? providerNetworkVolumes.find((volume) => (
        safeString(volume?.id, 128) === providerNetworkVolumeId
      ))
      : null;
    if (providerNetworkVolumeId && !selectedNetworkVolume) {
      throw new RunpodManagementError('The selected network volume no longer exists.', {
        code: 'RUNPOD_NETWORK_VOLUME_NOT_FOUND',
        status: 404,
      });
    }
    if (providerNetworkVolumeId && providerPods.some((pod) => (
      providerPodNetworkVolume(pod).id === providerNetworkVolumeId
    ))) {
      throw new RunpodManagementError(
        'The selected network volume is already attached to another Pod. Delete that Pod before redeploying this writable Ollama volume.',
        { code: 'RUNPOD_NETWORK_VOLUME_IN_USE', status: 409 }
      );
    }
    const requestedDataCenterId = safeString(input.dataCenterId, 100);
    const volumeDataCenterId = safeString(selectedNetworkVolume?.dataCenter, 100);
    if (
      selectedNetworkVolume
      && requestedDataCenterId
      && requestedDataCenterId !== volumeDataCenterId
    ) {
      throw new RunpodManagementError(
        'The selected network volume and data center do not match.',
        { code: 'RUNPOD_NETWORK_VOLUME_DATACENTER_MISMATCH', status: 409 }
      );
    }
    const dataCenterId = volumeDataCenterId || requestedDataCenterId;
    const availableDataCenters = Array.isArray(gpu.dataCenters) ? gpu.dataCenters : [];
    if (dataCenterId && !availableDataCenters.some((entry) => (
      safeString(entry?.id, 100) === dataCenterId
      && AVAILABLE_STOCK.has(safeString(entry?.availability, 20).toUpperCase())
    )) && podPurpose !== 'llama_cpp_service') {
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
    const persistentDiskGb = selectedNetworkVolume
      ? null
      : strictInteger(input.persistentDiskGb || template.persistentDiskGb, {
        label: 'Persistent disk', min: 10, max: 1000,
      });
    const setupModel = normalizeModelName(input.model || template.defaultModel);
    const trackedNetworkVolume = selectedNetworkVolume
      ? await this.trackProviderNetworkVolume(selectedNetworkVolume, actor, 'provider_import')
      : null;
    const runtimeEnv = templateEnvironment(template);
    const providerPayload = {
      name,
      templateId: template.providerTemplateId,
      cloud,
      gpu: { id: gpuId, count: gpuCount },
      disk: diskGb,
      mounts: selectedNetworkVolume
        ? {
          network: [{
            volumeId: providerNetworkVolumeId,
            path: OLLAMA_NETWORK_VOLUME_PATH,
          }],
        }
        : {
          persistent: {
            size: persistentDiskGb,
            path: template.persistentPath,
          },
        },
      ...(selectedNetworkVolume ? {
        env: {
          ...runtimeEnv,
          ...(podPurpose === 'llama_cpp_service' ? {} : {
            OLLAMA_HOST: accessMode === 'cloudflare_access'
              ? `127.0.0.1:${OLLAMA_CLOUDFLARE_ORIGIN_PORT}`
              : `0.0.0.0:${OLLAMA_PORT}`,
            OLLAMA_MODELS: OLLAMA_NETWORK_MODELS_PATH,
          }),
        },
      } : {}),
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
      const serviceUrl = ollamaServiceUrl(
        providerPodId,
        template,
        this.cloudflareGatewayUrl
      );
      const now = this.now();
      const pod = await this.podModel.create({
        providerPodId,
        name,
        recordOrigin: 'managed',
        podPurpose,
        workloadTemplateId: template._id,
        modelArtifactRecordId: options.modelArtifactRecordId || null,
        providerTemplateId: template.providerTemplateId,
        ...providerPodFields(providerPod, now),
        setupStatus: 'pending',
        setupModel,
        contextTokens: finiteNumber(options.contextTokens),
        autoDeleteAfterSetup,
        cleanupStatus: autoDeleteAfterSetup ? 'pending' : 'not_required',
        cleanupErrorCode: null,
        accessMode,
        publicUrl: serviceUrl,
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
        persistentPath: selectedNetworkVolume
          ? OLLAMA_NETWORK_VOLUME_PATH
          : template.persistentPath,
        networkVolumeRecordId: trackedNetworkVolume?._id || null,
        providerNetworkVolumeId: providerNetworkVolumeId || null,
        networkVolumeName: safeString(selectedNetworkVolume?.name, 120),
        networkVolumeType: selectedNetworkVolume
          ? normalizeProviderNetworkVolumeType(selectedNetworkVolume.type)
          : '',
        networkVolumeSizeGb: selectedNetworkVolume
          ? boundedNumber(selectedNetworkVolume.size, 10, 10, 4096)
          : null,
        networkVolumeMountPath: selectedNetworkVolume ? OLLAMA_NETWORK_VOLUME_PATH : '',
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
      const operationError = classifyCreateFailure(error, podPurpose);
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
                providerStatus: providerStatusForError(cleanupError),
              },
            });
          }
        }
      }
      await this.recordEvent({
        resourceType: 'pod',
        action: 'create',
        outcome: 'failed',
        providerStatus: providerStatusForError(operationError),
        errorCode: safeString(operationError?.code, 80) || 'RUNPOD_POD_CREATE_FAILED',
        actor,
      });
      this.logOperationFailure('Runpod pod creation failed', 'create', operationError);
      throw operationError;
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

  scheduleModelArtifactPreparation(
    podRecordId,
    modelArtifactRecordId,
    actor = actorFromPrincipal()
  ) {
    const podId = podRecordId?.toString?.() || safeString(podRecordId, 30);
    const artifactId = modelArtifactRecordId?.toString?.()
      || safeString(modelArtifactRecordId, 30);
    if (!OBJECT_ID_PATTERN.test(podId) || !OBJECT_ID_PATTERN.test(artifactId)) return null;
    const key = `artifact:${artifactId}`;
    if (this.provisioning.has(key)) return this.provisioning.get(key);
    const task = this._monitorModelArtifactPreparation(podId, artifactId, actor)
      .catch(() => null)
      .finally(() => this.provisioning.delete(key));
    this.provisioning.set(key, task);
    return task;
  }

  async _monitorModelArtifactPreparation(podRecordId, modelArtifactRecordId, actor) {
    const pod = await this.findManagedPod(podRecordId);
    const artifact = await this.modelArtifactModel.findOne({
      _id: modelArtifactRecordId,
      archivedAt: null,
    }).lean();
    const preset = getModelArtifactPreset(artifact?.slug);
    if (!artifact || !preset || pod.podPurpose !== 'model_artifact_prepare') {
      throw new RunpodManagementError('The model-artifact preparation record is invalid.', {
        code: 'RUNPOD_ARTIFACT_RECORD_INVALID', status: 409,
      });
    }
    if (artifact.preparationStatus === 'ready' && pod.setupStatus === 'ready') {
      await this.cleanupCompletedModelDownload(pod._id, actor).catch((error) => {
        this.logOperationFailure(
          'Runpod verified model-artifact Pod cleanup failed',
          'artifact_prepare_cleanup',
          error
        );
      });
      return true;
    }
    const deadline = Date.now() + this.modelArtifactPreparationTimeoutMs;
    let currentPod = pod;
    let lastPreparationStage = artifact.preparationStage || 'provisioning';
    let consecutiveLogFailures = 0;
    try {
      while (Date.now() < deadline) {
        const [providerPod, logObservation] = await Promise.all([
          this.runpodService.getPod(pod.providerPodId),
          this.runpodService.getPodLogSnapshot(pod.providerPodId, {
            source: 'container',
            tail: 1000,
            maxWaitMs: 2_000,
          }).then((logs) => ({ logs, error: null })).catch((error) => {
            if (!(error instanceof RunpodApiError)) throw error;
            return { logs: { events: [] }, error };
          }),
        ]);
        const observedAt = this.now();
        const hasLogEvents = Array.isArray(logObservation.logs?.events)
          && logObservation.logs.events.length > 0;
        const signal = hasLogEvents
          ? modelArtifactPreparationSignal(logObservation.logs.events)
          : { status: 'preparing', stage: lastPreparationStage, errorCode: null };
        lastPreparationStage = signal.stage;
        if (logObservation.error) {
          consecutiveLogFailures += 1;
          if (consecutiveLogFailures === 1 || consecutiveLogFailures % 20 === 0) {
            this.logger.warning('Runpod model-artifact logs are temporarily unavailable; verification will retry', {
              category: 'runpod_management',
              metadata: {
                action: 'artifact_prepare_log_observation',
                errorCode: safeString(logObservation.error?.code, 80) || 'RUNPOD_LOG_OBSERVATION_FAILED',
                providerStatus: providerStatusForError(logObservation.error),
                consecutiveFailures: consecutiveLogFailures,
              },
            });
          }
        } else {
          consecutiveLogFailures = 0;
        }
        currentPod = { ...currentPod, ...providerPodFields(providerPod, observedAt) };
        await Promise.all([
          this.podModel.updateOne(
            { _id: pod._id, archivedAt: null },
            {
              $set: {
                ...reconciledProviderPodFields(currentPod, providerPod, observedAt),
                setupStatus: signal.status === 'ready' ? 'ready' : 'downloading',
                setupErrorCode: null,
                ...(signal.status === 'ready' ? { setupCompletedAt: observedAt } : {}),
                updatedBy: actor,
              },
            }
          ),
          this.modelArtifactModel.updateOne(
            { _id: artifact._id, archivedAt: null },
            {
              $set: {
                preparationStatus: signal.status === 'ready' ? 'ready' : 'preparing',
                preparationStage: signal.stage,
                preparationErrorCode: null,
                preparationLastObservedAt: observedAt,
                ...(signal.status === 'ready' ? {
                  preparedAt: observedAt,
                  verifiedAt: observedAt,
                } : {}),
                updatedBy: actor,
              },
            }
          ),
        ]);
        if (signal.status === 'failed') {
          throw new RunpodManagementError('The model-artifact preparation command failed.', {
            code: signal.errorCode || 'RUNPOD_ARTIFACT_PREPARATION_FAILED', status: 502,
          });
        }
        if (signal.status === 'ready') {
          await this.networkVolumeModel.updateOne(
            { providerNetworkVolumeId: artifact.providerNetworkVolumeId, archivedAt: null },
            {
              $addToSet: { cachedModels: preset.slug },
              $set: { modelsUpdatedAt: observedAt, updatedBy: actor },
            }
          ).catch((error) => {
            this.logger.warning('Unable to record the verified Runpod model artifact on its volume', {
              category: 'runpod_management',
              metadata: {
                action: 'artifact_inventory_update',
                errorName: safeString(error?.name, 80) || 'Error',
              },
            });
          });
          await this.recordEvent({
            resourceType: 'model_artifact',
            modelArtifactRecordId: artifact._id,
            networkVolumeRecordId: artifact.networkVolumeRecordId,
            podRecordId: pod._id,
            action: 'artifact_prepare',
            outcome: 'succeeded',
            actor,
          });
          await this.cleanupCompletedModelDownload(pod._id, actor).catch((error) => {
            this.logOperationFailure(
              'Runpod verified model-artifact Pod cleanup failed',
              'artifact_prepare_cleanup',
              error
            );
          });
          return true;
        }
        const status = normalizeProviderStatus(providerPod.status);
        if (['ERROR', 'EXITED', 'TERMINATED'].includes(status)) {
          throw new RunpodManagementError(
            'The model-artifact preparation Pod stopped before verification completed.',
            { code: 'RUNPOD_ARTIFACT_POD_TERMINAL_STATE', status: 502 }
          );
        }
        await this.sleep(this.pollIntervalMs);
      }
      throw new RunpodManagementError('Model-artifact preparation exceeded its time limit.', {
        code: 'RUNPOD_ARTIFACT_PREPARATION_TIMEOUT', status: 504,
      });
    } catch (error) {
      const failedAt = this.now();
      const errorCode = safeString(error?.code, 80) || 'RUNPOD_ARTIFACT_PREPARATION_FAILED';
      await Promise.all([
        this.modelArtifactModel.updateOne(
          { _id: artifact._id, archivedAt: null },
          {
            $set: {
              preparationStatus: 'failed',
              preparationStage: 'failed',
              preparationErrorCode: errorCode,
              preparationLastObservedAt: failedAt,
              updatedBy: actor,
            },
          }
        ).catch(() => {}),
        this.podModel.updateOne(
          { _id: pod._id, archivedAt: null },
          {
            $set: {
              setupStatus: 'failed',
              setupErrorCode: errorCode,
              updatedBy: actor,
            },
          }
        ).catch(() => {}),
      ]);
      await this.recordEvent({
        resourceType: 'model_artifact',
        modelArtifactRecordId: artifact._id,
        networkVolumeRecordId: artifact.networkVolumeRecordId,
        podRecordId: pod._id,
        action: 'artifact_prepare',
        outcome: 'failed',
        providerStatus: providerStatusForError(error),
        errorCode,
        actor,
      });
      await this.cleanupCompletedModelDownload(pod._id, actor).catch((cleanupError) => {
        this.logOperationFailure(
          'Runpod model-artifact preparation Pod cleanup failed',
          'artifact_prepare_cleanup',
          cleanupError
        );
      });
      this.logOperationFailure('Runpod model-artifact preparation failed', 'artifact_prepare', error);
      throw error;
    }
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
    if (
      pod.autoDeleteAfterSetup === true
      && pod.setupStatus === 'ready'
      && pod.cleanupStatus === 'pending'
    ) {
      await this.cleanupCompletedModelDownload(pod._id, actor);
      return;
    }
    const template = await this.templateModel.findOne({
      _id: pod.workloadTemplateId,
      active: true,
    }).lean();
    if (!template || !['ollama_pull', 'ollama_download', 'llama_cpp_serve'].includes(template.setupKind)) {
      await this.podModel.updateOne(
        { _id: pod._id, archivedAt: null },
        { $set: { setupStatus: 'not_applicable', updatedBy: actor } }
      );
      return;
    }
    if (template.setupKind === 'llama_cpp_serve') {
      return this._provisionLlamaCppPod(pod, template, actor);
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
      const accessMode = normalizeOllamaAccessMode(template.accessMode);
      const url = ollamaServiceUrl(providerPod.id, template, this.cloudflareGatewayUrl);
      const accessOptions = accessMode === 'cloudflare_access' ? { accessMode } : {};
      await this.waitForOllama(url, accessOptions);
      await this.podModel.updateOne(
        { _id: pod._id, archivedAt: null },
        { $set: { setupStatus: 'downloading', publicUrl: url, updatedBy: actor } }
      );
      const setupModel = pod.setupModel || template.defaultModel;
      await this.pullOllamaModel(url, setupModel, {
        timeoutMs: pod.podPurpose === 'model_download'
          ? this.modelDownloadTimeoutMs
          : this.ollamaPullTimeoutMs,
        ...accessOptions,
      });
      await this.verifyOllamaModel(url, setupModel, accessOptions);
      const completedAt = this.now();
      await this.recordCachedModel(pod, setupModel, completedAt);
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
      if (pod.autoDeleteAfterSetup === true) {
        await this.cleanupCompletedModelDownload(pod._id, actor).catch((error) => {
          this.logOperationFailure(
            'Runpod model downloader cleanup could not be recorded after setup',
            'model_download_cleanup',
            error
          );
        });
      }
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
        providerStatus: providerStatusForError(error),
        errorCode,
        actor,
      });
      this.logOperationFailure('Runpod Ollama setup failed and the pod was stopped when possible', 'setup', error);
      throw error;
    }
  }

  async _provisionLlamaCppPod(pod, template, actor) {
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
      const url = validatedCloudflareGatewayUrl(
        template.gatewayUrl || this.cloudflareGatewayUrl
      ).toString();
      await this.waitForLlamaCpp(url, { providerPodId: pod.providerPodId });
      await this.verifyLlamaCppModel(url, GLM53_FLASH_LLAMA_CPP_MODEL_ALIAS);
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
      return true;
    } catch (error) {
      const errorCode = safeString(error?.code, 80) || 'RUNPOD_LLAMA_CPP_SETUP_FAILED';
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
        providerStatus: providerStatusForError(error),
        errorCode,
        actor,
      });
      this.logOperationFailure(
        'Runpod llama.cpp setup failed and the Pod was stopped when possible',
        'llama_cpp_setup',
        error
      );
      throw error;
    }
  }

  async llamaCppRequest(baseUrl, pathname, { timeoutMs = 30_000 } = {}) {
    if (typeof this.fetch !== 'function') {
      throw new RunpodManagementError('llama.cpp connectivity is not configured.', {
        code: 'LLAMA_CPP_FETCH_UNAVAILABLE', status: 503,
      });
    }
    if (!this.gatewayConfiguration().serviceTokenConfigured || !this.llmApiKey) {
      throw new RunpodManagementError(
        'Cloudflare Access or native LLM API credentials are unavailable to this server.',
        { code: 'RUNPOD_LLM_GATEWAY_NOT_CONFIGURED', status: 503 }
      );
    }
    const allowedPaths = new Set(['/health', '/v1/models']);
    if (!allowedPaths.has(pathname)) {
      throw new RunpodManagementError('The llama.cpp API path is not allowed.', {
        code: 'LLAMA_CPP_PATH_NOT_ALLOWED', status: 500,
      });
    }
    const base = validatedOllamaBaseUrl(baseUrl, {
      accessMode: 'cloudflare_access',
      cloudflareGatewayUrl: this.cloudflareGatewayUrl,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), positiveInteger(timeoutMs, 30_000));
    try {
      const response = await this.fetch(new URL(pathname, base), {
        headers: {
          Accept: 'application/json, text/plain',
          Authorization: `Bearer ${this.llmApiKey}`,
          'CF-Access-Client-Id': this.cloudflareAccessClientId,
          'CF-Access-Client-Secret': this.cloudflareAccessClientSecret,
        },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel?.().catch?.(() => {});
        throw new RunpodManagementError(
          response.status === 401 || response.status === 403
            ? 'The llama.cpp gateway rejected its configured API credentials.'
            : `The llama.cpp gateway returned HTTP ${response.status}.`,
          {
            code: response.status === 401 || response.status === 403
              ? 'LLAMA_CPP_AUTH_FAILED'
              : 'LLAMA_CPP_HTTP_ERROR',
            status: response.status,
          }
        );
      }
      return await readLimitedText(response, OLLAMA_RESPONSE_LIMIT_BYTES);
    } catch (error) {
      if (error instanceof RunpodManagementError) throw error;
      if (error?.name === 'AbortError') {
        throw new RunpodManagementError('The llama.cpp health request timed out.', {
          code: 'LLAMA_CPP_TIMEOUT', status: 504,
        });
      }
      throw new RunpodManagementError('The llama.cpp gateway could not be reached.', {
        code: 'LLAMA_CPP_NETWORK_ERROR', status: 502,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async waitForLlamaCpp(baseUrl, { providerPodId = '' } = {}) {
    const deadline = Date.now() + this.llamaCppStartupTimeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      if (providerPodId) {
        try {
          const [providerPod, logs] = await Promise.all([
            this.runpodService.getPod(providerPodId),
            this.runpodService.getPodLogSnapshot(providerPodId, {
              source: 'container',
              tail: 500,
              maxWaitMs: 2_000,
            }).catch(() => ({ events: [] })),
          ]);
          const signal = modelArtifactServingSignal(logs.events);
          if (signal.status === 'failed') {
            throw new RunpodManagementError(
              `The llama.cpp serving command failed during ${signal.stage}.`,
              { code: signal.errorCode, status: 502 }
            );
          }
          if (['ERROR', 'EXITED', 'TERMINATED'].includes(normalizeProviderStatus(providerPod.status))) {
            throw new RunpodManagementError(
              'The llama.cpp Pod stopped before the model became reachable.',
              { code: 'RUNPOD_LLAMA_CPP_POD_TERMINAL_STATE', status: 502 }
            );
          }
        } catch (error) {
          if (error instanceof RunpodManagementError) throw error;
          lastError = error;
        }
      }
      try {
        await this.llamaCppRequest(baseUrl, '/health');
        return true;
      } catch (error) {
        lastError = error;
        if (['LLAMA_CPP_AUTH_FAILED', 'RUNPOD_LLM_GATEWAY_NOT_CONFIGURED'].includes(error?.code)) {
          throw error;
        }
        await this.sleep(this.pollIntervalMs);
      }
    }
    throw new RunpodManagementError(
      'The 157 GB GLM model did not become reachable before the 45-minute startup deadline.',
      {
        code: lastError?.code === 'LLAMA_CPP_TIMEOUT'
          ? 'LLAMA_CPP_TIMEOUT'
          : 'LLAMA_CPP_STARTUP_TIMEOUT',
        status: 504,
      }
    );
  }

  async verifyLlamaCppModel(baseUrl, expectedAlias = GLM53_FLASH_LLAMA_CPP_MODEL_ALIAS) {
    const text = await this.llamaCppRequest(baseUrl, '/v1/models');
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (_) {
      throw new RunpodManagementError('llama.cpp returned invalid model data.', {
        code: 'LLAMA_CPP_INVALID_RESPONSE', status: 502,
      });
    }
    const aliases = Array.isArray(payload?.data)
      ? payload.data.map((entry) => safeString(entry?.id, 120))
      : [];
    if (!aliases.includes(expectedAlias)) {
      throw new RunpodManagementError('The expected GLM model alias is missing from llama.cpp.', {
        code: 'LLAMA_CPP_MODEL_MISSING', status: 502,
      });
    }
    return true;
  }

  async recordCachedModel(pod, model, verifiedAt = this.now()) {
    const providerNetworkVolumeId = safeString(pod?.providerNetworkVolumeId, 128);
    if (!providerNetworkVolumeId) return false;
    const normalizedModel = normalizeModelName(model);
    try {
      const result = await this.networkVolumeModel.updateOne(
        { providerNetworkVolumeId, archivedAt: null },
        {
          $addToSet: { cachedModels: normalizedModel },
          $set: { modelsUpdatedAt: verifiedAt },
        }
      );
      return result?.matchedCount !== 0;
    } catch (error) {
      this.logger.warning('Unable to record the verified Ollama model on its Runpod volume', {
        category: 'runpod_management',
        metadata: {
          action: 'model_inventory_update',
          errorName: safeString(error?.name, 80) || 'Error',
        },
      });
      return false;
    }
  }

  async cleanupCompletedModelDownload(podRecordId, actor) {
    const pod = await this.findManagedPod(podRecordId);
    await this.podModel.updateOne(
      { _id: pod._id, archivedAt: null },
      {
        $set: {
          cleanupStatus: 'pending',
          cleanupErrorCode: null,
          updatedBy: actor,
        },
      }
    );
    try {
      try {
        await this.runpodService.deletePod(pod.providerPodId);
      } catch (error) {
        if (!(error instanceof RunpodApiError) || error.status !== 404) throw error;
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
            autoStopClaimedAt: null,
            cleanupStatus: 'completed',
            cleanupErrorCode: null,
            lastOperationError: null,
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
    } catch (error) {
      const errorCode = safeString(error?.code, 80) || 'RUNPOD_DOWNLOAD_CLEANUP_FAILED';
      await this.persistPodOperationError(pod._id, 'delete', error, actor, {
        fields: {
          cleanupStatus: 'failed',
          cleanupErrorCode: errorCode,
        },
      });
      await this.recordEvent({
        resourceType: 'pod',
        podRecordId: pod._id,
        action: 'delete',
        outcome: 'failed',
        providerStatus: providerStatusForError(error),
        errorCode,
        actor,
      });
      this.logOperationFailure(
        'Runpod model downloader cleanup failed after the model was verified',
        'model_download_cleanup',
        error
      );
      await this.stopProviderPodAfterSetupFailure(pod.providerPodId, pod._id, actor, pod);
      return false;
    }
  }

  async waitForRunningPod(providerPodId) {
    const deadline = Date.now() + this.provisionTimeoutMs;
    while (Date.now() < deadline) {
      const pod = await this.runpodService.getPod(providerPodId);
      const status = normalizeProviderStatus(pod.status);
      if (status === 'RUNNING') return pod;
      if (status === 'ERROR' || status === 'TERMINATED' || status === 'EXITED') {
        throw new RunpodManagementError('The Pod stopped before its workload became ready.', {
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
    responseReader = null,
    accessMode = 'runpod_proxy',
  } = {}) {
    if (typeof this.fetch !== 'function') {
      throw new RunpodManagementError('Ollama connectivity is not configured.', {
        code: 'OLLAMA_FETCH_UNAVAILABLE', status: 503,
      });
    }
    const normalizedAccessMode = normalizeOllamaAccessMode(accessMode);
    if (
      normalizedAccessMode === 'cloudflare_access'
      && !this.gatewayConfiguration().serviceTokenConfigured
    ) {
      throw new RunpodManagementError(
        'Cloudflare Access service-token credentials are not configured on this server.',
        { code: 'RUNPOD_CLOUDFLARE_NOT_CONFIGURED', status: 503 }
      );
    }
    const base = validatedOllamaBaseUrl(baseUrl, {
      accessMode: normalizedAccessMode,
      cloudflareGatewayUrl: this.cloudflareGatewayUrl,
    });
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
      const headers = body === undefined
        ? { Accept: 'application/json, text/plain' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' };
      if (normalizedAccessMode === 'cloudflare_access') {
        headers['CF-Access-Client-Id'] = this.cloudflareAccessClientId;
        headers['CF-Access-Client-Secret'] = this.cloudflareAccessClientSecret;
      }
      const response = await this.fetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw await ollamaHttpError(response, pathname);
      }
      const contentType = response.headers?.get?.('content-type') || '';
      if (typeof responseReader === 'function') {
        return await responseReader(response, { contentType });
      }
      return {
        contentType,
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

  async waitForOllama(baseUrl, { accessMode = 'runpod_proxy' } = {}) {
    const deadline = Date.now() + this.provisionTimeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      try {
        await this.ollamaRequest(baseUrl, '/api/tags', { accessMode });
        return true;
      } catch (error) {
        lastError = error;
        if (error?.code === 'OLLAMA_GATEWAY_FORBIDDEN') throw error;
        await this.sleep(this.pollIntervalMs);
      }
    }
    throw new RunpodManagementError('Ollama did not become reachable before the setup timeout.', {
      code: lastError?.code === 'OLLAMA_TIMEOUT' ? 'OLLAMA_TIMEOUT' : 'OLLAMA_STARTUP_TIMEOUT',
      status: 504,
    });
  }

  async pullOllamaModel(baseUrl, model, {
    timeoutMs = this.ollamaPullTimeoutMs,
    accessMode = 'runpod_proxy',
  } = {}) {
    const requested = normalizeModelName(model);
    const boundedTimeoutMs = positiveInteger(timeoutMs, this.ollamaPullTimeoutMs);
    const deadline = Date.now() + boundedTimeoutMs;
    let lastError;
    for (let attempt = 1; attempt <= OLLAMA_PULL_MAX_ATTEMPTS; attempt += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      try {
        await this.ollamaRequest(baseUrl, '/api/pull', {
          method: 'POST',
          body: { model: requested, stream: true },
          timeoutMs: remainingMs,
          responseReader: readOllamaPullStream,
          accessMode,
        });
        return true;
      } catch (error) {
        lastError = error;
        if (!OLLAMA_PULL_RETRY_CODES.has(error?.code)) throw error;
        try {
          await this.verifyOllamaModel(baseUrl, requested, { accessMode });
          return true;
        } catch (_) {
          // Ollama keeps partial blobs, so a new pull request can resume after a proxy cut-off.
        }
        if (attempt >= OLLAMA_PULL_MAX_ATTEMPTS || Date.now() >= deadline) break;
        await this.sleep(Math.min(this.pollIntervalMs, Math.max(1, deadline - Date.now())));
      }
    }
    if (lastError) throw lastError;
    throw new RunpodManagementError('The Ollama model download timed out.', {
      code: 'OLLAMA_TIMEOUT', status: 504,
    });
  }

  async verifyOllamaModel(baseUrl, model, { accessMode = 'runpod_proxy' } = {}) {
    const response = await this.ollamaRequest(baseUrl, '/api/tags', { accessMode });
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
            autoStopClaimedAt: null,
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
          providerStatus: providerStatusForError(error),
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

  async transitionManagedPod(podRecordId, action, principal, options = {}) {
    if (!['start', 'stop'].includes(action)) {
      throw new RunpodManagementError('Unsupported pod action.', {
        code: 'RUNPOD_INPUT_INVALID',
      });
    }
    const actor = actorFromPrincipal(principal);
    const pod = await this.findManagedPod(podRecordId);
    const runMinutes = action === 'start'
      ? strictInteger(options.runMinutes ?? pod.autoStopMinutes ?? this.defaultAutoStopMinutes, {
        label: 'Start duration', min: 15, max: this.maxRuntimeMinutes,
      })
      : null;
    let providerActionAccepted = false;
    try {
      if (action === 'start' && normalizeOllamaAccessMode(pod.accessMode) === 'cloudflare_access') {
        const providerPods = await this.runpodService.listPods();
        const competingConnector = providerPods.find((entry) => (
          safeString(entry?.id, 128) !== safeString(pod.providerPodId, 128)
          && providerPodUsesCloudflareTunnel(entry, {
            tunnelSecretName: this.cloudflareTunnelSecretName,
            providerTemplateId: pod.providerTemplateId,
          })
          && ACTIVE_PROVIDER_STATUSES.has(normalizeProviderStatus(entry?.status))
        ));
        if (competingConnector) {
          throw new RunpodManagementError(
            'Another Pod is already connected to this named Cloudflare Tunnel. Stop it before starting this Pod.',
            { code: 'RUNPOD_GATEWAY_CONNECTOR_CONFLICT', status: 409 }
          );
        }
        await this.verifyCloudflareAccessServiceToken();
      }
      const current = await this.runpodService.getPod(pod.providerPodId);
      if (!normalizeActions(current.actions).includes(action)) {
        throw new RunpodManagementError(`The pod cannot be ${action === 'start' ? 'started' : 'stopped'} in its current state.`, {
          code: 'RUNPOD_ACTION_CONFLICT', status: 409,
        });
      }
      const providerPod = await this.runpodService.transitionPod(pod.providerPodId, action);
      const providerStatus = normalizeProviderStatus(providerPod?.status);
      if (action === 'start' && ['EXITED', 'ERROR', 'TERMINATED'].includes(providerStatus)) {
        throw new RunpodManagementError(
          'The original GPU for this stopped Pod is unavailable. Wait and retry, or delete and redeploy on currently available hardware.',
          {
            code: 'RUNPOD_START_GPU_UNAVAILABLE',
            status: 409,
            providerTitle: `Runpod returned ${providerStatus} after the start request`,
          }
        );
      }
      providerActionAccepted = true;
      const now = this.now();
      const autoStopAt = action === 'start'
        ? new Date(now.getTime() + runMinutes * 60 * 1000)
        : null;
      const updateResult = await this.podModel.updateOne(
        { _id: pod._id, archivedAt: null },
        {
          $set: {
            ...reconciledProviderPodFields(pod, providerPod, now),
            ...(action === 'start' ? { autoStopMinutes: runMinutes } : {}),
            autoStopAt,
            autoStopClaimedAt: null,
            lastOperationError: null,
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
      if (
        action === 'start'
        && (pod.setupStatus !== 'ready' || pod.podPurpose === 'llama_cpp_service')
      ) {
        this.scheduleProvisioning(pod._id, actor);
      }
      return providerPod;
    } catch (error) {
      const operationError = action === 'start' ? classifyStartFailure(error) : error;
      if (action === 'start' && providerActionAccepted) {
        try {
          await this.runpodService.transitionPod(pod.providerPodId, 'stop');
        } catch (cleanupError) {
          this.logger.error('Failed to stop a Runpod pod after start-state persistence failed', {
            category: 'runpod_management',
            metadata: {
              action: 'start_cleanup',
              errorCode: safeString(cleanupError?.code, 80) || 'RUNPOD_STOP_FAILED',
              providerStatus: providerStatusForError(cleanupError),
            },
          });
        }
      }
      await this.persistPodOperationError(pod._id, action, operationError, actor);
      await this.recordEvent({
        resourceType: 'pod',
        podRecordId: pod._id,
        action,
        outcome: 'failed',
        providerStatus: providerStatusForError(operationError),
        errorCode: safeString(operationError?.code, 80) || 'RUNPOD_ACTION_FAILED',
        actor,
      });
      this.logOperationFailure(`Runpod pod ${action} failed`, action, operationError);
      throw operationError;
    }
  }

  async extendManagedPod(podRecordId, input = {}, principal) {
    const actor = actorFromPrincipal(principal);
    const pod = await this.findManagedPod(podRecordId);
    const extensionMinutes = strictInteger(input.extensionMinutes, {
      label: 'Extension duration', min: 15, max: this.maxRuntimeMinutes,
    });
    try {
      const now = this.now();
      const current = await this.runpodService.getPod(pod.providerPodId);
      const currentStatus = normalizeProviderStatus(current.status);
      if (
        currentStatus !== 'RUNNING'
        || !normalizeActions(current.actions).includes('stop')
      ) {
        throw new RunpodManagementError('Only a running Pod with a stop action can be extended.', {
          code: 'RUNPOD_ACTION_CONFLICT', status: 409,
        });
      }
      const existingDeadline = dateOrNull(pod.autoStopAt);
      const existingClaim = dateOrNull(pod.autoStopClaimedAt);
      const staleClaimBefore = new Date(now.getTime() - AUTO_STOP_CLAIM_LEASE_MS);
      if (existingClaim && existingClaim.getTime() > staleClaimBefore.getTime()) {
        throw new RunpodManagementError(
          'Automatic shutdown is already being processed. Refresh the Pod state shortly.',
          { code: 'RUNPOD_ACTION_CONFLICT', status: 409 }
        );
      }
      if (existingDeadline && existingDeadline.getTime() <= now.getTime()) {
        throw new RunpodManagementError(
          'The automatic-stop deadline has already passed. Refresh the Pod state before retrying.',
          { code: 'RUNPOD_ACTION_CONFLICT', status: 409 }
        );
      }
      const deadlineBase = existingDeadline || now;
      const extendedDeadline = new Date(
        deadlineBase.getTime() + extensionMinutes * 60 * 1000
      );
      const maximumDeadline = new Date(
        now.getTime() + this.maxRuntimeMinutes * 60 * 1000
      );
      if (extendedDeadline.getTime() > maximumDeadline.getTime()) {
        throw new RunpodManagementError(
          `The extended deadline must remain within ${this.maxRuntimeMinutes} minutes of now.`,
          { code: 'RUNPOD_RUNTIME_LIMIT_EXCEEDED', status: 409 }
        );
      }
      const updateResult = await this.podModel.updateOne(
        {
          _id: pod._id,
          archivedAt: null,
          autoStopAt: pod.autoStopAt || null,
          $or: [
            { autoStopClaimedAt: null },
            { autoStopClaimedAt: { $lte: staleClaimBefore } },
          ],
        },
        {
          $set: {
            ...reconciledProviderPodFields(pod, current, now),
            autoStopAt: extendedDeadline,
            autoStopClaimedAt: null,
            lastOperationError: null,
            lastActionAt: now,
            updatedBy: actor,
          },
        }
      );
      if (updateResult?.matchedCount === 0) {
        throw new RunpodManagementError(
          'The automatic-stop deadline changed while it was being extended. Refresh and retry.',
          { code: 'RUNPOD_ACTION_CONFLICT', status: 409 }
        );
      }
      await this.recordEvent({
        resourceType: 'pod',
        podRecordId: pod._id,
        action: 'extend',
        outcome: 'succeeded',
        actor,
      });
      return { autoStopAt: extendedDeadline, extensionMinutes };
    } catch (error) {
      await this.persistPodOperationError(pod._id, 'extend', error, actor);
      await this.recordEvent({
        resourceType: 'pod',
        podRecordId: pod._id,
        action: 'extend',
        outcome: 'failed',
        providerStatus: providerStatusForError(error),
        errorCode: safeString(error?.code, 80) || 'RUNPOD_EXTEND_FAILED',
        actor,
      });
      this.logOperationFailure('Runpod Pod automatic-stop extension failed', 'extend', error);
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
        await this.persistPodOperationError(pod._id, 'delete', error, actor);
        await this.recordEvent({
          resourceType: 'pod',
          podRecordId: pod._id,
          action: 'delete',
          outcome: 'failed',
          providerStatus: providerStatusForError(error),
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
          autoStopClaimedAt: null,
          ...(pod.autoDeleteAfterSetup === true ? {
            cleanupStatus: 'completed',
            cleanupErrorCode: null,
          } : {}),
          lastOperationError: null,
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
      const networkMount = providerPodNetworkVolume(providerPod);
      const trackedNetworkVolume = networkMount.id
        ? await this.networkVolumeModel.findOne({
          providerNetworkVolumeId: networkMount.id,
        }).lean()
        : null;
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
          count: boundedNumber(providerPod.gpu?.count, 1, 1, 32),
          catalogPricePerHour: Math.max(finiteNumber(providerPod.cost, 0), 0),
        },
        diskGb: boundedNumber(providerPod.disk, 20, 1, 1000),
        persistentDiskGb: networkMount.id
          ? null
          : boundedNumber(providerPod.mounts?.persistent?.size, 10, 10, 1000),
        persistentPath: networkMount.path
          || safeString(providerPod.mounts?.persistent?.path, 300)
          || '/workspace',
        networkVolumeRecordId: trackedNetworkVolume?._id || null,
        providerNetworkVolumeId: networkMount.id || null,
        networkVolumeName: safeString(trackedNetworkVolume?.name, 120),
        networkVolumeType: normalizeProviderNetworkVolumeType(
          trackedNetworkVolume?.volumeType
        ),
        networkVolumeSizeGb: finiteNumber(trackedNetworkVolume?.sizeGb),
        networkVolumeMountPath: networkMount.path,
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
            autoStopClaimedAt: null,
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
      const claimTime = now;
      try {
        const claimResult = await this.podModel.updateOne(
          {
            _id: pod._id,
            archivedAt: null,
            lifecycleGroup: 'running',
            autoStopAt: pod.autoStopAt,
            $or: [
              { autoStopClaimedAt: null },
              {
                autoStopClaimedAt: {
                  $lte: new Date(now.getTime() - AUTO_STOP_CLAIM_LEASE_MS),
                },
              },
            ],
          },
          {
            $set: {
              autoStopClaimedAt: claimTime,
              updatedBy: actor,
            },
          }
        );
        if (claimResult?.matchedCount === 0) continue;
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
                autoStopClaimedAt: null,
                lastOperationError: null,
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
                autoStopClaimedAt: null,
                lastOperationError: null,
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
        await this.persistPodOperationError(pod._id, 'auto_stop', error, actor, {
          filter: { lifecycleGroup: 'running', autoStopClaimedAt: claimTime },
          fields: {
            autoStopAt: new Date(now.getTime() + 60 * 1000),
            autoStopClaimedAt: null,
          },
        });
        await this.recordEvent({
          resourceType: 'pod',
          podRecordId: pod._id,
          action: 'auto_stop',
          outcome: 'failed',
          providerStatus: providerStatusForError(error),
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
      $or: [
        { setupStatus: { $in: ['pending', 'waiting', 'downloading'] } },
        {
          setupStatus: 'ready',
          autoDeleteAfterSetup: true,
          cleanupStatus: 'pending',
        },
      ],
    }).sort({ updatedAt: 1 }).limit(this.maxActivePods).lean();
    pending.forEach((pod) => {
      const actor = actorFromPrincipal({ name: 'runpod-setup-recovery' });
      if (pod.podPurpose === 'model_artifact_prepare') {
        this.modelArtifactModel.findOne({ preparationPodRecordId: pod._id, archivedAt: null })
          .lean()
          .then((artifact) => {
            if (artifact?._id) {
              this.scheduleModelArtifactPreparation(pod._id, artifact._id, actor);
            }
          })
          .catch((error) => {
            this.logger.warning('Unable to resume a Runpod model-artifact preparation monitor', {
              category: 'runpod_management',
              metadata: {
                action: 'artifact_prepare_recovery',
                errorName: safeString(error?.name, 80) || 'Error',
              },
            });
          });
      } else {
        this.scheduleProvisioning(pod._id, actor);
      }
    });
    return pending.length;
  }
}

const manager = new RunpodPodManager();

module.exports = {
  ACTIVE_PROVIDER_STATUSES,
  AVAILABLE_STOCK,
  DEFAULT_AUTO_STOP_MINUTES,
  DEFAULT_MODEL_DOWNLOAD_AUTO_STOP_MINUTES,
  DEFAULT_MODEL_DOWNLOAD_MAX_HOURLY_COST_USD,
  DEFAULT_MAX_ACTIVE_PODS,
  DEFAULT_MAX_GPU_COUNT,
  DEFAULT_MAX_HOURLY_COST_USD,
  DEFAULT_MAX_NETWORK_VOLUME_GB,
  DEFAULT_MAX_NETWORK_VOLUME_MONTHLY_COST_USD,
  DEFAULT_MAX_RUNTIME_MINUTES,
  DEFAULT_CLOUDFLARE_GATEWAY_URL,
  DEFAULT_CLOUDFLARE_TUNNEL_SECRET_NAME,
  DEFAULT_OLLAMA_PULL_TIMEOUT_MS,
  DEFAULT_OLLAMA_MODEL_DOWNLOAD_TIMEOUT_MS,
  DEFAULT_MODEL_ARTIFACT_PREPARATION_TIMEOUT_MS,
  DEFAULT_LLAMA_CPP_STARTUP_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_PROVISION_TIMEOUT_MS,
  DEFAULT_STORAGE_RATES,
  DEFAULT_STANDARD_STORAGE_USD_PER_GB_MONTH,
  MILLISECONDS_PER_HOUR,
  MODEL_PATTERN,
  OLLAMA_IMAGE,
  OLLAMA_DOWNLOADER_MODEL,
  OLLAMA_DOWNLOADER_PROVIDER_TEMPLATE_NAME,
  OLLAMA_DOWNLOADER_TEMPLATE_SLUG,
  OLLAMA_CLOUDFLARE_ORIGIN_PORT,
  OLLAMA_CLOUDFLARE_PROVIDER_TEMPLATE_NAME,
  OLLAMA_CLOUDFLARE_TEMPLATE_SLUG,
  OLLAMA_MODEL,
  OLLAMA_NETWORK_MODELS_PATH,
  OLLAMA_NETWORK_VOLUME_PATH,
  OLLAMA_PERSISTENT_PATH,
  OLLAMA_PORT,
  OLLAMA_PROVIDER_TEMPLATE_NAME,
  OLLAMA_TEMPLATE_SLUG,
  MODEL_ARTIFACT_PREPARER_TEMPLATE_SLUG,
  MODEL_ARTIFACT_SERVER_TEMPLATE_SLUG,
  RunpodManagementError,
  RunpodPodManager,
  actorFromPrincipal,
  chooseModelDownloadGpu,
  classifyCreateFailure,
  cloudflareGatewayStartArgs,
  lifecycleGroupForStatus,
  mapPodForPage,
  mapNetworkVolumeForPage,
  mergeGpuCatalogs,
  normalizeModelName,
  normalizeDownloaderTemplateInput,
  normalizeModelArtifactPreparerTemplateInput,
  normalizeModelArtifactServerTemplateInput,
  normalizeCloudflareTemplateInput,
  normalizeNetworkVolumeName,
  normalizeNetworkVolumeType,
  normalizePodName,
  normalizeTemplateInput,
  ollamaServiceUrl,
  providerPodFields,
  providerPodNetworkVolume,
  providerPodUsesCloudflareTunnel,
  estimateStandardNetworkVolumeMonthlyCost,
  providerTemplatePayload,
  mapModelArtifactForPage,
  projectPodUsage,
  publicOllamaUrl,
  readLimitedText,
  reconciledProviderPodFields,
  runpodPodManager: manager,
  usageFieldsForObservation,
  usageStateForStatus,
  validatedOllamaBaseUrl,
  validatedCloudflareGatewayUrl,
};
