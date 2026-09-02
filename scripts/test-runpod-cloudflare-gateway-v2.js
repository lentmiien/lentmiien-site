#!/usr/bin/env node
'use strict';

require('dotenv').config({ quiet: true });

const mongoose = require('mongoose');
const RunpodPod = require('../models/runpod_pod');
const { RunpodApiV2Service } = require('../services/runpodApiV2Service');
const {
  ACTIVE_PROVIDER_STATUSES,
  OLLAMA_NETWORK_MODELS_PATH,
  OLLAMA_NETWORK_VOLUME_PATH,
  RunpodPodManager,
  normalizeCloudflareTemplateInput,
  normalizeModelName,
  providerPodNetworkVolume,
  providerPodUsesCloudflareTunnel,
  providerTemplatePayload,
  readLimitedText,
} = require('../services/runpodPodManager');

const EXECUTE_FLAG = '--execute';
const LEAVE_RUNNING_FLAG = '--leave-running';
const PREFLIGHT_ONLY_FLAG = '--preflight-only';
const DEFAULT_VOLUME_NAME = 'ollama-qwen3-8-27b-cache';
const DEFAULT_MODEL = 'qwen3.8:27b';
const MAX_HOURLY_COST_USD = 0.99;
const MIN_VRAM_GB = 32;
const AUTO_STOP_MINUTES = 60;
const ACTIVE_STOCK = new Set(['LOW', 'MEDIUM', 'HIGH']);
const STOCK_RANK = Object.freeze({ HIGH: 0, MEDIUM: 1, LOW: 2 });

function argumentValue(argv, name, fallback = '') {
  const prefix = `--${name}=`;
  const match = argv.find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function safeCode(error) {
  return typeof error?.code === 'string' && error.code.length <= 80
    ? error.code
    : 'RUNPOD_CLOUDFLARE_GATEWAY_TEST_FAILED';
}

function chooseGatewayGpu(gpus, dataCenterId, maxHourlyCost = MAX_HOURLY_COST_USD) {
  return (Array.isArray(gpus) ? gpus : [])
    .filter((gpu) => {
      const price = Number(gpu?.price?.secure);
      const memory = Number(gpu?.memory);
      const placement = (Array.isArray(gpu?.dataCenters) ? gpu.dataCenters : []).find((entry) => (
        entry?.id === dataCenterId && ACTIVE_STOCK.has(entry?.availability)
      ));
      return Number.isFinite(price)
        && price > 0
        && price <= maxHourlyCost
        && Number.isFinite(memory)
        && memory >= MIN_VRAM_GB
        && Number(gpu?.maxCount?.secure) >= 1
        && ACTIVE_STOCK.has(gpu?.availability)
        && placement;
    })
    .map((gpu) => ({
      gpu,
      placement: gpu.dataCenters.find((entry) => entry?.id === dataCenterId),
    }))
    .sort((left, right) => (
      Number(left.gpu.price.secure) - Number(right.gpu.price.secure)
      || (STOCK_RANK[left.placement.availability] ?? 3)
        - (STOCK_RANK[right.placement.availability] ?? 3)
      || String(left.gpu.name || left.gpu.id).localeCompare(String(right.gpu.name || right.gpu.id))
    ))[0]?.gpu || null;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  const error = new Error('The deleted gateway test Pod remained in the provider list.');
  error.code = 'RUNPOD_GATEWAY_DELETE_TIMEOUT';
  throw error;
}

async function verifyAccessBlocksAnonymous(fetchImpl, gatewayUrl) {
  const response = await fetchImpl(new URL('/api/tags', gatewayUrl), {
    headers: { Accept: 'application/json' },
    redirect: 'manual',
  });
  await response.body?.cancel?.().catch?.(() => {});
  if (response.ok) {
    const error = new Error('Cloudflare Access allowed an anonymous Ollama request.');
    error.code = 'RUNPOD_GATEWAY_ANONYMOUS_ACCESS';
    throw error;
  }
  return response.status;
}

async function verifyGatewayInference({
  fetchImpl,
  gatewayUrl,
  model,
  accessClientId,
  accessClientSecret,
  timeoutMs = 10 * 60 * 1000,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(new URL('/api/generate', gatewayUrl), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'CF-Access-Client-Id': accessClientId,
        'CF-Access-Client-Secret': accessClientSecret,
      },
      body: JSON.stringify({
        model,
        prompt: 'Reply with only the word OK.',
        stream: false,
        options: { num_ctx: 2048, num_predict: 8 },
      }),
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel?.().catch?.(() => {});
      const error = new Error('Authenticated gateway inference failed.');
      error.code = 'RUNPOD_GATEWAY_INFERENCE_HTTP_ERROR';
      error.status = response.status;
      throw error;
    }
    const payload = JSON.parse(await readLimitedText(response, 2 * 1024 * 1024));
    if (payload?.done !== true || (!payload?.response && !payload?.thinking)) {
      const error = new Error('Ollama did not return a completed gateway inference result.');
      error.code = 'RUNPOD_GATEWAY_INFERENCE_INVALID_RESPONSE';
      throw error;
    }
    return true;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error('Authenticated gateway inference timed out.');
      timeout.code = 'RUNPOD_GATEWAY_INFERENCE_TIMEOUT';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForManagedSetup(manager, podRecordId, podModel = RunpodPod) {
  const id = podRecordId?.toString?.() || String(podRecordId || '');
  const task = manager.provisioning.get(id);
  if (!task) {
    const error = new Error('The managed gateway setup task was not queued.');
    error.code = 'RUNPOD_GATEWAY_SETUP_NOT_QUEUED';
    throw error;
  }
  await task;
  const record = await podModel.findById(id).lean();
  if (!record || record.setupStatus !== 'ready') {
    const error = new Error('The managed gateway setup did not complete.');
    error.code = record?.setupErrorCode || 'RUNPOD_GATEWAY_SETUP_FAILED';
    throw error;
  }
  return record;
}

async function runProviderOnlyTest({
  service,
  fetchImpl,
  model,
  volumeIdInput,
  volumeNameInput,
  stdout,
  stderr,
  managerOptions = {},
}) {
  let providerPodId = null;
  try {
    const helper = new RunpodPodManager({
      runpodService: service,
      fetchImpl,
      provisionTimeoutMs: 15 * 60 * 1000,
      pollIntervalMs: 5_000,
      ...managerOptions,
    });
    const accessPreflight = await helper.verifyCloudflareAccessServiceToken();
    stdout(`Cloudflare Access preflight passed (anonymous HTTP ${accessPreflight.anonymousStatus}; authenticated HTTP ${accessPreflight.authenticatedStatus}).`);
    const [providerPods, volumes, gpus] = await Promise.all([
      service.listPods(),
      service.listNetworkVolumes(),
      service.getGpuTypes({ cloud: 'SECURE', forceRefresh: true }),
    ]);
    if (providerPods.filter((pod) => ACTIVE_PROVIDER_STATUSES.has(pod?.status)).length >= 2) {
      const error = new Error('The account already has two active Pods.');
      error.code = 'RUNPOD_TEST_ACTIVE_LIMIT';
      throw error;
    }
    if (providerPods.some((pod) => (
      ACTIVE_PROVIDER_STATUSES.has(pod?.status)
      && providerPodUsesCloudflareTunnel(pod, {
        tunnelSecretName: process.env.RUNPOD_CLOUDFLARE_TUNNEL_SECRET_NAME,
      })
    ))) {
      const error = new Error('The named Cloudflare Tunnel already has an active connector.');
      error.code = 'RUNPOD_GATEWAY_CONNECTOR_CONFLICT';
      throw error;
    }
    const volume = volumes.find((entry) => (
      (volumeIdInput && entry?.id === volumeIdInput)
      || (!volumeIdInput && entry?.name === volumeNameInput)
    ));
    if (!volume) {
      const error = new Error('The retained Qwen network volume was not found.');
      error.code = 'RUNPOD_TEST_VOLUME_NOT_FOUND';
      throw error;
    }
    if (providerPods.some((pod) => providerPodNetworkVolume(pod).id === volume.id)) {
      const error = new Error('The retained Qwen volume is already attached to another Pod.');
      error.code = 'RUNPOD_NETWORK_VOLUME_IN_USE';
      throw error;
    }
    const gpu = chooseGatewayGpu(gpus, volume.dataCenter);
    if (!gpu) {
      const error = new Error('No compatible 32+ GB Secure Cloud GPU is currently available below the test ceiling.');
      error.code = 'RUNPOD_TEST_SERVING_GPU_UNAVAILABLE';
      throw error;
    }
    stdout(`Selected ${gpu.name || gpu.id} (${gpu.memory} GB) in ${volume.dataCenter} at $${Number(gpu.price.secure).toFixed(4)}/GPU hour.`);
    const normalizedTemplate = normalizeCloudflareTemplateInput({
      defaultModel: model,
      diskGb: '20',
      persistentDiskGb: '10',
    }, {
      gatewayUrl: process.env.RUNPOD_CLOUDFLARE_GATEWAY_URL,
      tunnelSecretName: process.env.RUNPOD_CLOUDFLARE_TUNNEL_SECRET_NAME,
    });
    const existingTemplate = (await service.getAccountTemplates()).find((entry) => (
      entry?.name === normalizedTemplate.providerTemplateName
    ));
    const providerTemplate = existingTemplate
      ? await service.updateTemplate(existingTemplate.id, providerTemplatePayload(normalizedTemplate))
      : await service.createTemplate(providerTemplatePayload(normalizedTemplate));
    const providerPod = await service.createPod({
      name: `ollama-gateway-test-${Date.now().toString(36)}`,
      templateId: providerTemplate.id,
      cloud: 'SECURE',
      gpu: { id: gpu.id, count: 1 },
      disk: 20,
      mounts: {
        network: [{ volumeId: volume.id, path: OLLAMA_NETWORK_VOLUME_PATH }],
      },
      env: {
        ...normalizedTemplate.env,
        OLLAMA_MODELS: OLLAMA_NETWORK_MODELS_PATH,
      },
      dataCenterIds: [volume.dataCenter],
      globalNetworking: false,
    });
    providerPodId = providerPod.id;
    if (Number.isFinite(providerPod.cost) && providerPod.cost > MAX_HOURLY_COST_USD) {
      const error = new Error('Runpod returned a Pod cost above the test ceiling.');
      error.code = 'RUNPOD_TEST_COST_LIMIT';
      throw error;
    }
    await helper.waitForRunningPod(providerPodId);
    const gatewayUrl = helper.cloudflareGatewayUrl;
    await helper.waitForOllama(gatewayUrl, { accessMode: 'cloudflare_access' });
    const anonymousStatus = await verifyAccessBlocksAnonymous(fetchImpl, gatewayUrl);
    await helper.verifyOllamaModel(gatewayUrl, model, { accessMode: 'cloudflare_access' });
    await verifyGatewayInference({
      fetchImpl,
      gatewayUrl,
      model,
      accessClientId: process.env.RUNPOD_CLOUDFLARE_ACCESS_CLIENT_ID,
      accessClientSecret: process.env.RUNPOD_CLOUDFLARE_ACCESS_CLIENT_SECRET,
    });
    stdout(`Anonymous request was blocked (HTTP ${anonymousStatus}); authenticated ${model} inference succeeded.`);
    stdout(`Stable gateway verified: ${gatewayUrl}`);
    return 0;
  } catch (error) {
    stderr(`Runpod Cloudflare gateway test failed: ${safeCode(error)}${Number.isSafeInteger(error?.status) ? ` (HTTP ${error.status})` : ''}`);
    return 1;
  } finally {
    if (providerPodId) {
      try {
        await service.deletePod(providerPodId);
        await waitForPodDeletion(service, providerPodId);
        stdout('Cleanup: the provider-only gateway test Pod was deleted; the network volume and private template remain.');
      } catch (cleanupError) {
        stderr(`URGENT: gateway test Pod cleanup failed: ${safeCode(cleanupError)}`);
      }
    }
  }
}

async function main({
  argv = process.argv.slice(2),
  mongooseInstance = mongoose,
  mongoUrl = process.env.MONGOOSE_URL,
  service = new RunpodApiV2Service({ timeoutMs: 60_000, cacheTtlMs: 0 }),
  managerFactory = (options) => new RunpodPodManager(options),
  podModel = RunpodPod,
  fetchImpl = global.fetch,
  stdout = (line) => process.stdout.write(`${line}\n`),
  stderr = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  const modelInput = argumentValue(argv, 'model', DEFAULT_MODEL);
  const volumeIdInput = argumentValue(argv, 'volume-id', process.env.RUNPOD_MODEL_VOLUME_ID || '');
  const volumeNameInput = argumentValue(
    argv,
    'volume-name',
    process.env.RUNPOD_MODEL_VOLUME_NAME || DEFAULT_VOLUME_NAME
  );
  if (!argv.includes(EXECUTE_FLAG)) {
    stdout('Dry run only. No Runpod, Cloudflare, or database resource was changed.');
    stdout(`Re-run with ${EXECUTE_FLAG} to sync the private gateway profile, create one sub-$${MAX_HOURLY_COST_USD}/hour Pod, and verify Cloudflare Access plus ${modelInput} inference.`);
    stdout(`Add ${PREFLIGHT_ONLY_FLAG} to validate only the Cloudflare Access policy without reading or changing Runpod resources.`);
    stdout(`Add ${LEAVE_RUNNING_FLAG} to keep the successful Pod available until its ${AUTO_STOP_MINUTES}-minute automatic-stop deadline.`);
    return 0;
  }
  if (argv.includes(PREFLIGHT_ONLY_FLAG)) {
    try {
      const manager = managerFactory({ runpodService: service, fetchImpl });
      const result = await manager.verifyCloudflareAccessServiceToken();
      stdout(`Cloudflare Access preflight passed (anonymous HTTP ${result.anonymousStatus}; authenticated HTTP ${result.authenticatedStatus}).`);
      stdout('No Runpod resource was read or changed.');
      return 0;
    } catch (error) {
      stderr(`Runpod Cloudflare gateway test failed: ${safeCode(error)}${Number.isSafeInteger(error?.status) ? ` (HTTP ${error.status})` : ''}`);
      return 1;
    }
  }
  if (
    !process.env.RUNPOD_API_KEY
    || !process.env.RUNPOD_CLOUDFLARE_TUNNEL_TOKEN
    || !process.env.RUNPOD_CLOUDFLARE_ACCESS_CLIENT_ID
    || !process.env.RUNPOD_CLOUDFLARE_ACCESS_CLIENT_SECRET
  ) {
    stderr('Runpod Cloudflare gateway test failed: RUNPOD_CLOUDFLARE_NOT_CONFIGURED');
    return 1;
  }

  let normalizedModel;
  try {
    normalizedModel = normalizeModelName(modelInput, DEFAULT_MODEL);
  } catch (error) {
    stderr(`Runpod Cloudflare gateway test failed: ${safeCode(error)}`);
    return 1;
  }
  if (!mongoUrl) {
    stdout('MONGOOSE_URL is not configured; running a provider-only REST v2 check and deleting the Pod immediately after verification.');
    if (argv.includes(LEAVE_RUNNING_FLAG)) {
      stdout('Ignoring --leave-running because the local automatic-stop record cannot be persisted.');
    }
    return runProviderOnlyTest({
      service,
      fetchImpl,
      model: normalizedModel,
      volumeIdInput,
      volumeNameInput,
      stdout,
      stderr,
    });
  }

  const actor = { name: 'runpod-cloudflare-gateway-test' };
  let manager;
  let podRecord = null;
  let succeeded = false;
  try {
    const model = normalizedModel;
    await mongooseInstance.connect(mongoUrl, { serverSelectionTimeoutMS: 10_000 });
    manager = managerFactory({
      runpodService: service,
      fetchImpl,
      provisionTimeoutMs: 15 * 60 * 1000,
      ollamaPullTimeoutMs: 60 * 60 * 1000,
      pollIntervalMs: 5_000,
    });
    const [providerPods, volumes, gpus] = await Promise.all([
      service.listPods(),
      service.listNetworkVolumes(),
      service.getGpuTypes({ cloud: 'SECURE', forceRefresh: true }),
    ]);
    if (providerPods.filter((pod) => ACTIVE_PROVIDER_STATUSES.has(pod?.status)).length >= 2) {
      const error = new Error('The account already has two active Pods.');
      error.code = 'RUNPOD_TEST_ACTIVE_LIMIT';
      throw error;
    }
    const volume = volumes.find((entry) => (
      (volumeIdInput && entry?.id === volumeIdInput)
      || (!volumeIdInput && entry?.name === volumeNameInput)
    ));
    if (!volume) {
      const error = new Error('The retained Qwen network volume was not found.');
      error.code = 'RUNPOD_TEST_VOLUME_NOT_FOUND';
      throw error;
    }
    if (providerPods.some((pod) => providerPodNetworkVolume(pod).id === volume.id)) {
      const error = new Error('The retained Qwen volume is already attached to another Pod.');
      error.code = 'RUNPOD_NETWORK_VOLUME_IN_USE';
      throw error;
    }
    const gpu = chooseGatewayGpu(gpus, volume.dataCenter);
    if (!gpu) {
      const error = new Error('No compatible 32+ GB Secure Cloud GPU is currently available below the test ceiling.');
      error.code = 'RUNPOD_TEST_SERVING_GPU_UNAVAILABLE';
      throw error;
    }
    stdout(`Selected ${gpu.name || gpu.id} (${gpu.memory} GB) in ${volume.dataCenter} at $${Number(gpu.price.secure).toFixed(4)}/GPU hour.`);
    const template = await manager.saveOllamaCloudflareTemplate({
      defaultModel: model,
      diskGb: '20',
      persistentDiskGb: '10',
    }, actor);
    podRecord = await manager.createManagedPod({
      name: `ollama-gateway-${Date.now().toString(36)}`,
      templateId: template._id.toString(),
      networkVolumeId: volume.id,
      cloud: 'SECURE',
      gpuId: gpu.id,
      gpuCount: '1',
      dataCenterId: volume.dataCenter,
      model,
      diskGb: '20',
      autoStopMinutes: String(AUTO_STOP_MINUTES),
      maxHourlyCost: MAX_HOURLY_COST_USD.toFixed(2),
    }, actor);
    const ready = await waitForManagedSetup(manager, podRecord._id, podModel);
    const anonymousStatus = await verifyAccessBlocksAnonymous(fetchImpl, ready.publicUrl);
    await manager.verifyOllamaModel(ready.publicUrl, model, {
      accessMode: 'cloudflare_access',
    });
    await verifyGatewayInference({
      fetchImpl,
      gatewayUrl: ready.publicUrl,
      model,
      accessClientId: process.env.RUNPOD_CLOUDFLARE_ACCESS_CLIENT_ID,
      accessClientSecret: process.env.RUNPOD_CLOUDFLARE_ACCESS_CLIENT_SECRET,
    });
    succeeded = true;
    stdout(`Anonymous request was blocked (HTTP ${anonymousStatus}); authenticated ${model} inference succeeded.`);
    stdout(`Stable gateway: ${ready.publicUrl}`);
    stdout(`Managed Pod: ${ready.name} (${ready.providerPodId}); automatic stop after ${AUTO_STOP_MINUTES} minutes.`);
    if (!argv.includes(LEAVE_RUNNING_FLAG)) {
      await manager.transitionManagedPod(ready._id, 'stop', actor);
      stdout('The verified gateway Pod was stopped. The network volume and private template remain.');
    } else {
      stdout('The verified gateway Pod was intentionally left running for Open WebUI testing.');
    }
    return 0;
  } catch (error) {
    stderr(`Runpod Cloudflare gateway test failed: ${safeCode(error)}${Number.isSafeInteger(error?.status) ? ` (HTTP ${error.status})` : ''}`);
    return 1;
  } finally {
    if (!succeeded && manager && podRecord?._id) {
      try {
        const current = await podModel.findOne({ _id: podRecord._id, archivedAt: null }).lean();
        if (current) {
          await manager.deleteManagedPod(current._id, current.name, actor);
          stdout('Cleanup: the failed gateway Pod was deleted; the network volume was kept.');
        }
      } catch (cleanupError) {
        stderr(`URGENT: gateway test Pod cleanup failed: ${safeCode(cleanupError)}`);
      }
    }
    if (mongooseInstance.connection.readyState !== 0) {
      await mongooseInstance.disconnect().catch(() => {});
    }
  }
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  AUTO_STOP_MINUTES,
  DEFAULT_MODEL,
  DEFAULT_VOLUME_NAME,
  MAX_HOURLY_COST_USD,
  PREFLIGHT_ONLY_FLAG,
  chooseGatewayGpu,
  main,
  runProviderOnlyTest,
  verifyAccessBlocksAnonymous,
  verifyGatewayInference,
  waitForManagedSetup,
  waitForPodDeletion,
};
