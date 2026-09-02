#!/usr/bin/env node
'use strict';

require('dotenv').config({ quiet: true });

const { RunpodApiV2Service } = require('../services/runpodApiV2Service');
const {
  GLM53_FLASH_LLAMA_CPP_MODEL_ALIAS,
  GLM53_FLASH_LLAMA_CPP_PROVIDER_TEMPLATE_NAME,
  GLM53_FLASH_UD_IQ4_XS_SLUG,
  artifactServerProviderPayload,
  getModelArtifactPreset,
  modelArtifactServingSignal,
} = require('../services/runpodModelArtifactCatalog');

const EXECUTE_FLAG = '--execute';
const DEFAULT_VOLUME_NAME = 'glm-5-3-flash-ud-iq4-xs';
const OLLAMA_CLOUDFLARE_TEMPLATE_NAME = 'lentmiien-ollama-cloudflare-v2';
const DEFAULT_GPU_COUNT = 2;
const DEFAULT_CONTEXT_TOKENS = 16_384;
const DEFAULT_MAX_HOURLY_COST_USD = 4.25;
const DEFAULT_STARTUP_TIMEOUT_MS = 45 * 60 * 1000;
const DEFAULT_INFERENCE_TIMEOUT_MS = 15 * 60 * 1000;
const ACTIVE_PROVIDER_STATUSES = new Set(['PROVISIONING', 'STARTING', 'RUNNING']);
const AVAILABLE_STOCK = new Set(['LOW', 'MEDIUM', 'HIGH']);
const STOCK_RANK = Object.freeze({ HIGH: 0, MEDIUM: 1, LOW: 2 });

function argumentValue(argv, name, fallback = '') {
  const prefix = `--${name}=`;
  const argument = argv.find((entry) => entry.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

function safeCode(error) {
  const providerText = [error?.providerTitle, error?.providerDetail, error?.message]
    .map((value) => String(value || ''))
    .join(' ');
  if (/no longer any instances available|no instances available|insufficient capacity/iu.test(providerText)) {
    return 'RUNPOD_GLM53_GPU_UNAVAILABLE';
  }
  return typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/u.test(error.code)
    ? error.code
    : 'RUNPOD_GLM53_TEST_FAILED';
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function chooseServingGpu(gpus, dataCenterId, {
  gpuCount = DEFAULT_GPU_COUNT,
  maxHourlyCost = DEFAULT_MAX_HOURLY_COST_USD,
  requestedGpuId = '',
} = {}) {
  return (Array.isArray(gpus) ? gpus : [])
    .filter((gpu) => {
      const id = String(gpu?.id || '');
      const name = String(gpu?.name || '');
      const memoryGb = Number(gpu?.memory);
      const price = Number(gpu?.price?.secure);
      const availability = String(gpu?.availability || '').toUpperCase();
      return id
        && (!requestedGpuId ? /RTX PRO 6000/iu.test(name) : id === requestedGpuId)
        && Number.isFinite(memoryGb)
        && memoryGb >= 90
        && Number.isFinite(price)
        && price > 0
        && price * gpuCount <= maxHourlyCost
        && AVAILABLE_STOCK.has(availability)
        && Number(gpu?.maxCount?.secure) >= gpuCount;
    })
    .map((gpu) => ({
      gpu,
      placement: (Array.isArray(gpu.dataCenters) ? gpu.dataCenters : [])
        .find((entry) => entry?.id === dataCenterId),
    }))
    .sort((left, right) => (
      (left.placement ? 0 : 1) - (right.placement ? 0 : 1)
      || (STOCK_RANK[String(left.placement?.availability || left.gpu.availability || '').toUpperCase()] ?? 3)
        - (STOCK_RANK[String(right.placement?.availability || right.gpu.availability || '').toUpperCase()] ?? 3)
      || (left.gpu.name === 'RTX PRO 6000' ? 0 : 1) - (right.gpu.name === 'RTX PRO 6000' ? 0 : 1)
      || Number(left.gpu.price.secure) - Number(right.gpu.price.secure)
      || String(left.gpu.name || left.gpu.id).localeCompare(String(right.gpu.name || right.gpu.id))
    ))[0]?.gpu || null;
}

function activeTunnelPod(pods, templates) {
  const tunnelTemplateIds = new Set((Array.isArray(templates) ? templates : [])
    .filter((template) => [
      OLLAMA_CLOUDFLARE_TEMPLATE_NAME,
      GLM53_FLASH_LLAMA_CPP_PROVIDER_TEMPLATE_NAME,
    ].includes(String(template?.name || '')))
    .map((template) => String(template?.id || ''))
    .filter(Boolean));
  return (Array.isArray(pods) ? pods : []).find((pod) => {
    const environment = pod?.env && typeof pod.env === 'object' && !Array.isArray(pod.env)
      ? pod.env
      : {};
    return ACTIVE_PROVIDER_STATUSES.has(String(pod?.status || '').toUpperCase())
      && (
        tunnelTemplateIds.has(String(pod?.template || pod?.templateId || ''))
        || Boolean(environment.TUNNEL_TOKEN)
      );
  }) || null;
}

async function ensureProviderTemplate(service, options = {}) {
  const payload = artifactServerProviderPayload(GLM53_FLASH_UD_IQ4_XS_SLUG, options);
  const templates = await service.getAccountTemplates();
  const existing = templates.find((template) => template?.name === payload.name);
  return existing
    ? service.updateTemplate(existing.id, payload)
    : service.createTemplate(payload);
}

async function waitForPodDeletion(service, providerPodId, {
  timeoutMs = 2 * 60 * 1000,
  sleepImpl = sleep,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await service.listPods()).some((pod) => pod?.id === providerPodId)) return true;
    await sleepImpl(2_000);
  }
  const error = new Error('The GLM test Pod remained after deletion.');
  error.code = 'RUNPOD_GLM53_TEST_DELETE_TIMEOUT';
  throw error;
}

function accessHeaders(env, { includeNativeKey = true } = {}) {
  const headers = {
    Accept: 'application/json',
    'CF-Access-Client-Id': env.RUNPOD_CLOUDFLARE_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': env.RUNPOD_CLOUDFLARE_ACCESS_CLIENT_SECRET,
  };
  if (includeNativeKey) headers.Authorization = `Bearer ${env.RUNPOD_LLM_API_KEY}`;
  return headers;
}

async function cancelBody(response) {
  try {
    await response.body?.cancel?.();
  } catch (_) {
    // Only status is needed.
  }
}

async function verifyGatewayPreflight(fetchImpl, gatewayUrl, env) {
  const anonymous = await fetchImpl(new URL('/health', gatewayUrl), {
    headers: { Accept: 'application/json' },
    redirect: 'manual',
  });
  const anonymousStatus = anonymous.status;
  await cancelBody(anonymous);
  if (![401, 403].includes(anonymousStatus) && !(anonymousStatus >= 300 && anonymousStatus < 400)) {
    const error = new Error('Cloudflare Access did not block an anonymous request.');
    error.code = 'RUNPOD_GATEWAY_ANONYMOUS_ACCESS';
    throw error;
  }

  const authenticated = await fetchImpl(new URL('/health', gatewayUrl), {
    headers: accessHeaders(env),
    redirect: 'manual',
  });
  const authenticatedStatus = authenticated.status;
  await cancelBody(authenticated);
  if ([401, 403].includes(authenticatedStatus) || (authenticatedStatus >= 300 && authenticatedStatus < 400)) {
    const error = new Error('Cloudflare Access rejected the configured service token.');
    error.code = 'RUNPOD_CLOUDFLARE_ACCESS_DENIED';
    throw error;
  }
  return { anonymousStatus, authenticatedStatus };
}

function servingLogSignal(events = []) {
  const { errorCode, ...signal } = modelArtifactServingSignal(events);
  return { ...signal, code: errorCode };
}

async function waitForGateway(service, fetchImpl, providerPodId, gatewayUrl, env, {
  timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  pollIntervalMs = 15_000,
  sleepImpl = sleep,
  onStage = () => {},
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastStage = '';
  let lastStatus = null;
  while (Date.now() < deadline) {
    const [pod, logs] = await Promise.all([
      service.getPod(providerPodId),
      service.getPodLogSnapshot(providerPodId, {
        source: 'container',
        tail: 300,
        maxWaitMs: 2_000,
      }).catch(() => ({ events: [] })),
    ]);
    if (['ERROR', 'EXITED', 'TERMINATED'].includes(pod?.status)) {
      const error = new Error('The GLM serving Pod entered a terminal state before readiness.');
      error.code = 'RUNPOD_GLM53_POD_TERMINAL_STATE';
      throw error;
    }
    const signal = servingLogSignal(logs.events);
    if (signal.status === 'failed') {
      const error = new Error('The GLM serving command reported a failure.');
      error.code = signal.code;
      throw error;
    }
    if (signal.stage !== lastStage) {
      lastStage = signal.stage;
      onStage(signal.stage);
    }
    try {
      const response = await fetchImpl(new URL('/health', gatewayUrl), {
        headers: accessHeaders(env),
        redirect: 'error',
      });
      lastStatus = response.status;
      await cancelBody(response);
      if (response.ok) return { pod, signal, status: response.status };
    } catch (_) {
      // Tunnel and model startup are asynchronous; bounded polling continues.
    }
    await sleepImpl(pollIntervalMs);
  }
  const error = new Error(`The GLM gateway did not become healthy (last HTTP ${lastStatus || 'unavailable'}).`);
  error.code = 'RUNPOD_GLM53_STARTUP_TIMEOUT';
  throw error;
}

async function requestJson(fetchImpl, url, options, {
  timeoutMs = DEFAULT_INFERENCE_TIMEOUT_MS,
  maxBytes = 2 * 1024 * 1024,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: controller.signal });
    if (!response.ok) {
      await cancelBody(response);
      const error = new Error(`The GLM gateway returned HTTP ${response.status}.`);
      error.code = 'RUNPOD_GLM53_HTTP_ERROR';
      error.status = response.status;
      throw error;
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      const error = new Error('The GLM gateway response exceeded the safety limit.');
      error.code = 'RUNPOD_GLM53_RESPONSE_TOO_LARGE';
      throw error;
    }
    return JSON.parse(text);
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error('The GLM gateway request timed out.');
      timeout.code = 'RUNPOD_GLM53_INFERENCE_TIMEOUT';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyInference(fetchImpl, gatewayUrl, env) {
  const headers = {
    ...accessHeaders(env),
    'Content-Type': 'application/json',
  };
  const models = await requestJson(fetchImpl, new URL('/v1/models', gatewayUrl), { headers }, {
    timeoutMs: 30_000,
  });
  if (!Array.isArray(models?.data) || !models.data.some((model) => (
    model?.id === GLM53_FLASH_LLAMA_CPP_MODEL_ALIAS
  ))) {
    const error = new Error('The GLM alias was not returned by the model endpoint.');
    error.code = 'RUNPOD_GLM53_MODEL_ALIAS_MISSING';
    throw error;
  }
  const completion = await requestJson(
    fetchImpl,
    new URL('/v1/chat/completions', gatewayUrl),
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: GLM53_FLASH_LLAMA_CPP_MODEL_ALIAS,
        messages: [{ role: 'user', content: 'Reply with exactly: RUNPOD GLM OK' }],
        max_tokens: 32,
        temperature: 0,
        stream: false,
      }),
    },
    { timeoutMs: DEFAULT_INFERENCE_TIMEOUT_MS }
  );
  const message = completion?.choices?.[0]?.message;
  const output = String(message?.content || message?.reasoning_content || '').trim();
  if (!completion?.id || !output) {
    const error = new Error('The GLM completion response did not contain generated output.');
    error.code = 'RUNPOD_GLM53_INFERENCE_INVALID_RESPONSE';
    throw error;
  }
  return {
    model: completion.model || GLM53_FLASH_LLAMA_CPP_MODEL_ALIAS,
    finishReason: completion.choices[0].finish_reason || '',
    outputLength: output.length,
    usage: completion.usage || null,
  };
}

function validateEnvironment(env) {
  const required = [
    'RUNPOD_API_KEY',
    'RUNPOD_CLOUDFLARE_ACCESS_CLIENT_ID',
    'RUNPOD_CLOUDFLARE_ACCESS_CLIENT_SECRET',
    'RUNPOD_CLOUDFLARE_TUNNEL_TOKEN',
    'RUNPOD_LLM_API_KEY',
  ];
  const missing = required.filter((key) => !String(env[key] || '').trim());
  if (missing.length) {
    const error = new Error('Required test credentials are not configured.');
    error.code = 'RUNPOD_GLM53_TEST_ENV_NOT_CONFIGURED';
    throw error;
  }
}

async function main({
  argv = process.argv.slice(2),
  env = process.env,
  service = new RunpodApiV2Service({ timeoutMs: 60_000, cacheTtlMs: 0 }),
  fetchImpl = global.fetch,
  stdout = (line) => process.stdout.write(`${line}\n`),
  stderr = (line) => process.stderr.write(`${line}\n`),
  sleepImpl = sleep,
} = {}) {
  const preset = getModelArtifactPreset(GLM53_FLASH_UD_IQ4_XS_SLUG);
  const volumeIdInput = argumentValue(argv, 'volume-id', env.RUNPOD_GLM53_VOLUME_ID || '');
  const volumeNameInput = argumentValue(argv, 'volume-name', DEFAULT_VOLUME_NAME);
  const requestedGpuId = argumentValue(argv, 'gpu-id', '');
  const contextTokens = Number(argumentValue(argv, 'context-tokens', String(DEFAULT_CONTEXT_TOKENS)));
  const maxHourlyCost = Number(argumentValue(
    argv,
    'max-hourly-cost',
    String(DEFAULT_MAX_HOURLY_COST_USD)
  ));

  if (!argv.includes(EXECUTE_FLAG)) {
    stdout('Dry run only. No Runpod resource was changed.');
    stdout(`Plan: mount the retained ${preset.recommendedVolumeGb} GB GLM volume on one temporary Secure Cloud Pod with exactly two RTX PRO 6000 GPUs, serve ${preset.name} through the authenticated Cloudflare gateway, verify a real OpenAI-compatible completion, and delete only the Pod.`);
    stdout(`Cost guard: no more than $${DEFAULT_MAX_HOURLY_COST_USD.toFixed(2)}/hour; container disk: 40 GB; model and runtime remain on the network volume.`);
    return 0;
  }
  let providerPodId = null;
  let podDeleted = true;
  const startedAt = Date.now();
  try {
    validateEnvironment(env);
    if (!Number.isSafeInteger(contextTokens) || contextTokens < 2048 || contextTokens > 131072) {
      const error = new Error('Context tokens are outside the allowed range.');
      error.code = 'RUNPOD_GLM53_CONTEXT_INVALID';
      throw error;
    }
    if (!Number.isFinite(maxHourlyCost) || maxHourlyCost <= 0 || maxHourlyCost > 5) {
      const error = new Error('The GLM test cost ceiling is invalid.');
      error.code = 'RUNPOD_GLM53_COST_LIMIT_INVALID';
      throw error;
    }
    const gatewayUrl = new URL(env.RUNPOD_CLOUDFLARE_GATEWAY_URL || 'https://llm.lentmiien.com');
    const access = await verifyGatewayPreflight(fetchImpl, gatewayUrl, env);
    stdout(`Cloudflare Access preflight passed (anonymous HTTP ${access.anonymousStatus}; authenticated origin HTTP ${access.authenticatedStatus}).`);

    const [pods, volumes, gpus, templates] = await Promise.all([
      service.listPods(),
      service.listNetworkVolumes(),
      service.getGpuTypes({ cloud: 'SECURE', forceRefresh: true }),
      service.getAccountTemplates(),
    ]);
    if (pods.filter((pod) => ACTIVE_PROVIDER_STATUSES.has(pod?.status)).length >= 2) {
      const error = new Error('The account already has two active Pods.');
      error.code = 'RUNPOD_GLM53_ACTIVE_POD_LIMIT';
      throw error;
    }
    if (activeTunnelPod(pods, templates)) {
      const error = new Error('Another active Pod is already connected to the named Cloudflare Tunnel.');
      error.code = 'RUNPOD_GATEWAY_CONNECTOR_CONFLICT';
      throw error;
    }
    const volume = volumes.find((entry) => (
      (volumeIdInput && entry?.id === volumeIdInput)
      || (!volumeIdInput && entry?.name === volumeNameInput)
    ));
    if (!volume || Number(volume.size) < preset.recommendedVolumeGb) {
      const error = new Error('The retained GLM network volume is missing or undersized.');
      error.code = 'RUNPOD_GLM53_VOLUME_NOT_READY';
      throw error;
    }
    if (pods.some((pod) => pod?.mounts?.network?.some((mount) => mount?.volumeId === volume.id))) {
      const error = new Error('The retained GLM volume is already attached to a Pod.');
      error.code = 'RUNPOD_NETWORK_VOLUME_IN_USE';
      throw error;
    }
    const gpu = chooseServingGpu(gpus, volume.dataCenter, {
      gpuCount: DEFAULT_GPU_COUNT,
      maxHourlyCost,
      requestedGpuId,
    });
    if (!gpu) {
      const error = new Error('Two co-located RTX PRO 6000 GPUs are not currently available in the volume data center below the cost ceiling.');
      error.code = 'RUNPOD_GLM53_GPU_UNAVAILABLE';
      throw error;
    }
    const estimatedCost = Number(gpu.price.secure) * DEFAULT_GPU_COUNT;
    stdout(`Selected 2× ${gpu.name || gpu.id} in ${volume.dataCenter} at $${estimatedCost.toFixed(2)}/hour total.`);

    const template = await ensureProviderTemplate(service, {
      contextTokens,
      gpuCount: DEFAULT_GPU_COUNT,
      cloudflareTunnelSecretName: env.RUNPOD_CLOUDFLARE_TUNNEL_SECRET_NAME
        || 'lentmiien_cloudflare_tunnel_token',
      llmApiSecretName: env.RUNPOD_LLM_API_SECRET_NAME || 'lentmiien_llm_api_key',
    });
    stdout(`Private serving template is ready: ${GLM53_FLASH_LLAMA_CPP_PROVIDER_TEMPLATE_NAME}.`);
    const pod = await service.createPod({
      name: `glm53-2x-pro6000-test-${Date.now().toString(36)}`,
      templateId: template.id,
      cloud: 'SECURE',
      gpu: { id: gpu.id, count: DEFAULT_GPU_COUNT },
      disk: 40,
      mounts: {
        network: [{ volumeId: volume.id, path: '/workspace' }],
      },
      dataCenterIds: [volume.dataCenter],
      globalNetworking: false,
    });
    providerPodId = pod.id;
    podDeleted = false;
    if (Number.isFinite(pod.cost) && pod.cost > maxHourlyCost) {
      const error = new Error('Runpod returned a Pod above the confirmed test ceiling.');
      error.code = 'RUNPOD_GLM53_COST_LIMIT_EXCEEDED';
      throw error;
    }
    stdout(`Test Pod ${providerPodId} created; waiting for the 157 GB model to load from network storage.`);
    await waitForGateway(service, fetchImpl, providerPodId, gatewayUrl, env, {
      sleepImpl,
      onStage: (stage) => stdout(`Serving stage: ${stage}.`),
    });
    stdout('Authenticated gateway health check passed. Running a real chat completion.');
    const inference = await verifyInference(fetchImpl, gatewayUrl, env);
    const elapsedMinutes = (Date.now() - startedAt) / 60_000;
    stdout(`Inference verified (${inference.model}; finish=${inference.finishReason || 'unspecified'}; ${inference.outputLength} output characters).`);
    stdout(`Observed test duration: ${elapsedMinutes.toFixed(1)} minutes; estimated GPU compute: $${(estimatedCost * elapsedMinutes / 60).toFixed(2)}.`);
    return 0;
  } catch (error) {
    stderr(`Runpod GLM-5.3 test failed: ${safeCode(error)}${Number.isSafeInteger(error?.status) ? ` (HTTP ${error.status})` : ''}`);
    const providerDetail = [error?.providerCode, error?.providerTitle, error?.providerDetail]
      .map((value) => String(value || '').replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 500))
      .filter(Boolean)
      .join(' · ');
    if (providerDetail) stderr(`Provider detail: ${providerDetail}`);
    return 1;
  } finally {
    if (providerPodId && !podDeleted) {
      try {
        await service.deletePod(providerPodId);
        await waitForPodDeletion(service, providerPodId, { sleepImpl });
        podDeleted = true;
        stdout('Cleanup verified: the temporary 2-GPU Pod was deleted; the GLM network volume remains.');
      } catch (cleanupError) {
        if (cleanupError?.status === 404) {
          podDeleted = true;
          stdout('Cleanup verified: the temporary 2-GPU Pod was already absent; the GLM network volume remains.');
        } else {
          stderr(`URGENT: automatic GLM test Pod cleanup failed: ${safeCode(cleanupError)} (Pod ${providerPodId}).`);
        }
      }
    }
  }
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  ACTIVE_PROVIDER_STATUSES,
  DEFAULT_CONTEXT_TOKENS,
  DEFAULT_GPU_COUNT,
  DEFAULT_MAX_HOURLY_COST_USD,
  DEFAULT_VOLUME_NAME,
  EXECUTE_FLAG,
  activeTunnelPod,
  accessHeaders,
  argumentValue,
  chooseServingGpu,
  ensureProviderTemplate,
  main,
  requestJson,
  safeCode,
  servingLogSignal,
  validateEnvironment,
  verifyGatewayPreflight,
  verifyInference,
  waitForGateway,
  waitForPodDeletion,
};
