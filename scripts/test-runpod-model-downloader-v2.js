#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const mongoose = require('mongoose');
const RunpodPod = require('../models/runpod_pod');
const { RunpodApiV2Service } = require('../services/runpodApiV2Service');
const {
  ACTIVE_PROVIDER_STATUSES,
  OLLAMA_DOWNLOADER_MODEL,
  OLLAMA_NETWORK_MODELS_PATH,
  OLLAMA_NETWORK_VOLUME_PATH,
  RunpodPodManager,
  chooseModelDownloadGpu,
  normalizeDownloaderTemplateInput,
  normalizeModelName,
  normalizeTemplateInput,
  providerPodNetworkVolume,
  providerTemplatePayload,
  publicOllamaUrl,
  readLimitedText,
} = require('../services/runpodPodManager');

const EXECUTE_FLAG = '--execute';
const DEFAULT_VOLUME_NAME = 'ollama-qwen3-8-27b-cache';
const MAX_TEST_HOURLY_COST_USD = 0.99;
const MAX_ACCOUNT_ACTIVE_PODS = 2;
const MIN_SERVING_VRAM_GB = 32;
const ACTIVE_STOCK = new Set(['LOW', 'MEDIUM', 'HIGH']);
const STOCK_RANK = Object.freeze({ HIGH: 0, MEDIUM: 1, LOW: 2 });

function safeCode(error) {
  return typeof error?.code === 'string' && error.code.length <= 80
    ? error.code
    : 'RUNPOD_MODEL_DOWNLOADER_TEST_FAILED';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function argumentValue(argv, name, fallback = '') {
  const prefix = `--${name}=`;
  const match = argv.find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function chooseServingGpu(gpus, dataCenterId, maxHourlyCost = MAX_TEST_HOURLY_COST_USD) {
  return gpus
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
        && memory >= MIN_SERVING_VRAM_GB
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

async function waitForProvisioning(manager, podRecordId, podModel = RunpodPod) {
  const id = podRecordId?.toString?.() || String(podRecordId || '');
  const task = manager.provisioning.get(id);
  if (!task) {
    const error = new Error('The background provisioning task was not queued.');
    error.code = 'RUNPOD_TEST_SETUP_NOT_QUEUED';
    throw error;
  }
  await task;
  const record = await podModel.findById(id).lean();
  if (!record) {
    const error = new Error('The managed Pod record disappeared during setup.');
    error.code = 'RUNPOD_TEST_POD_RECORD_MISSING';
    throw error;
  }
  return record;
}

async function waitForPodDeletion(service, providerPodId, {
  timeoutMs = 2 * 60 * 1000,
  pollIntervalMs = 2_000,
  sleepImpl = sleep,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const exists = (await service.listPods()).some((pod) => pod?.id === providerPodId);
    if (!exists) return true;
    await sleepImpl(pollIntervalMs);
  }
  const error = new Error('Deleted Pod remained in the provider list.');
  error.code = 'RUNPOD_TEST_POD_DELETE_TIMEOUT';
  throw error;
}

async function verifyInference(fetchImpl, baseUrl, model, timeoutMs = 5 * 60 * 1000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(new URL('/api/generate', baseUrl), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
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
      const error = new Error('Ollama inference verification failed.');
      error.code = 'RUNPOD_TEST_INFERENCE_HTTP_ERROR';
      error.status = response.status;
      throw error;
    }
    const payload = JSON.parse(await readLimitedText(response, 2 * 1024 * 1024));
    if (payload?.done !== true || (!payload?.response && !payload?.thinking)) {
      const error = new Error('Ollama did not return a completed inference result.');
      error.code = 'RUNPOD_TEST_INFERENCE_INVALID_RESPONSE';
      throw error;
    }
    return true;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Ollama inference verification timed out.');
      timeoutError.code = 'RUNPOD_TEST_INFERENCE_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function deleteManagedTestPod(manager, podModel, podRecordId, actor) {
  if (!podRecordId) return false;
  const record = await podModel.findOne({ _id: podRecordId, archivedAt: null }).lean();
  if (!record) return false;
  await manager.deleteManagedPod(record._id, record.name, actor);
  return true;
}

async function ensureProviderTemplate(service, normalizedTemplate) {
  const existing = (await service.getAccountTemplates()).find((entry) => (
    entry?.name === normalizedTemplate.providerTemplateName
  ));
  const payload = providerTemplatePayload(normalizedTemplate);
  return existing
    ? service.updateTemplate(existing.id, payload)
    : service.createTemplate(payload);
}

async function createAttachedProviderPod(service, {
  name,
  templateId,
  gpuId,
  dataCenterId,
  volumeId,
}) {
  return service.createPod({
    name,
    templateId,
    cloud: 'SECURE',
    gpu: { id: gpuId, count: 1 },
    disk: 20,
    mounts: {
      network: [{ volumeId, path: OLLAMA_NETWORK_VOLUME_PATH }],
    },
    env: {
      OLLAMA_HOST: '0.0.0.0:11434',
      OLLAMA_MODELS: OLLAMA_NETWORK_MODELS_PATH,
    },
    dataCenterIds: [dataCenterId],
    globalNetworking: false,
  });
}

async function runProviderOnlyTest({
  service,
  fetchImpl,
  sleepImpl,
  model,
  requestedVolumeId,
  requestedVolumeName,
  stdout,
  stderr,
}) {
  let providerPodId = null;
  try {
    const [providerPods, volumes, secureGpus] = await Promise.all([
      service.listPods(),
      service.listNetworkVolumes(),
      service.getGpuTypes({ cloud: 'SECURE', forceRefresh: true }),
    ]);
    const activeCount = providerPods.filter((pod) => ACTIVE_PROVIDER_STATUSES.has(pod?.status)).length;
    if (activeCount >= MAX_ACCOUNT_ACTIVE_PODS) {
      const error = new Error('The account already has the maximum allowed active test Pods.');
      error.code = 'RUNPOD_TEST_ACTIVE_LIMIT';
      throw error;
    }
    const volume = volumes.find((entry) => (
      (requestedVolumeId && entry?.id === requestedVolumeId)
      || (!requestedVolumeId && entry?.name === requestedVolumeName)
    ));
    if (!volume) {
      const error = new Error('The requested retained network volume was not found.');
      error.code = 'RUNPOD_TEST_VOLUME_NOT_FOUND';
      throw error;
    }
    if (Number(volume.size) < 30) {
      const error = new Error('The retained volume is too small for the requested model and headroom.');
      error.code = 'RUNPOD_TEST_VOLUME_TOO_SMALL';
      throw error;
    }
    if (providerPods.some((pod) => providerPodNetworkVolume(pod).id === volume.id)) {
      const error = new Error('The retained volume is already attached to another Pod.');
      error.code = 'RUNPOD_NETWORK_VOLUME_IN_USE';
      throw error;
    }
    const downloadGpu = chooseModelDownloadGpu(
      secureGpus,
      volume.dataCenter,
      MAX_TEST_HOURLY_COST_USD
    );
    const servingGpu = chooseServingGpu(secureGpus, volume.dataCenter);
    if (!downloadGpu || !servingGpu) {
      const error = new Error('Compatible sub-$0.99/hour GPU placement is unavailable in the volume location.');
      error.code = !downloadGpu
        ? 'RUNPOD_DOWNLOAD_GPU_UNAVAILABLE'
        : 'RUNPOD_TEST_SERVING_GPU_UNAVAILABLE';
      throw error;
    }
    stdout(`Using the retained ${volume.size} GB ${volume.type} volume in ${volume.dataCenter}.`);
    stdout(`Downloader placement: ${downloadGpu.name || downloadGpu.id} at $${Number(downloadGpu.price.secure).toFixed(4)}/GPU hour.`);
    stdout(`Serving verification: ${servingGpu.name || servingGpu.id} (${servingGpu.memory} GB) at $${Number(servingGpu.price.secure).toFixed(4)}/GPU hour.`);

    const [downloaderTemplate, serviceTemplate] = await Promise.all([
      ensureProviderTemplate(service, normalizeDownloaderTemplateInput({ defaultModel: model })),
      ensureProviderTemplate(service, normalizeTemplateInput({ defaultModel: model })),
    ]);
    const helper = new RunpodPodManager({
      runpodService: service,
      fetchImpl,
      sleepImpl,
      provisionTimeoutMs: 15 * 60 * 1000,
      ollamaPullTimeoutMs: 6 * 60 * 60 * 1000,
      modelDownloadTimeoutMs: 6 * 60 * 60 * 1000,
      pollIntervalMs: 5_000,
    });

    const downloaderPod = await createAttachedProviderPod(service, {
      name: `download-${Date.now().toString(36)}`,
      templateId: downloaderTemplate.id,
      gpuId: downloadGpu.id,
      dataCenterId: volume.dataCenter,
      volumeId: volume.id,
    });
    providerPodId = downloaderPod.id;
    if (Number.isFinite(downloaderPod.cost) && downloaderPod.cost > MAX_TEST_HOURLY_COST_USD) {
      const error = new Error('The provider returned a downloader cost above the test ceiling.');
      error.code = 'RUNPOD_TEST_COST_LIMIT';
      throw error;
    }
    stdout(`Downloader Pod started; waiting for ${model} to be pulled and verified.`);
    const runningDownloader = await helper.waitForRunningPod(providerPodId);
    let publicUrl = publicOllamaUrl(runningDownloader.id);
    await helper.waitForOllama(publicUrl);
    await helper.pullOllamaModel(publicUrl, model, { timeoutMs: 6 * 60 * 60 * 1000 });
    await helper.verifyOllamaModel(publicUrl, model);
    await service.deletePod(providerPodId);
    await waitForPodDeletion(service, providerPodId, { sleepImpl });
    providerPodId = null;
    stdout(`${model} is verified on the volume; the downloader Pod was deleted.`);

    const servingPod = await createAttachedProviderPod(service, {
      name: `serve-${Date.now().toString(36)}`,
      templateId: serviceTemplate.id,
      gpuId: servingGpu.id,
      dataCenterId: volume.dataCenter,
      volumeId: volume.id,
    });
    providerPodId = servingPod.id;
    if (Number.isFinite(servingPod.cost) && servingPod.cost > MAX_TEST_HOURLY_COST_USD) {
      const error = new Error('The provider returned a serving cost above the test ceiling.');
      error.code = 'RUNPOD_TEST_COST_LIMIT';
      throw error;
    }
    stdout('Fresh serving Pod created on the same volume; checking the cached model without another pull.');
    const runningServingPod = await helper.waitForRunningPod(providerPodId);
    publicUrl = publicOllamaUrl(runningServingPod.id);
    await helper.waitForOllama(publicUrl);
    await helper.verifyOllamaModel(publicUrl, model);
    await verifyInference(fetchImpl, publicUrl, model);
    stdout('Fresh-Pod inference succeeded from the retained network-volume model.');
    await service.deletePod(providerPodId);
    await waitForPodDeletion(service, providerPodId, { sleepImpl });
    providerPodId = null;
    stdout('Serving verification Pod was deleted. The populated volume and reusable provider templates remain.');
    return 0;
  } catch (error) {
    stderr(`Runpod model downloader test failed: ${safeCode(error)}${Number.isSafeInteger(error?.status) ? ` (HTTP ${error.status})` : ''}`);
    return 1;
  } finally {
    if (providerPodId) {
      try {
        await service.deletePod(providerPodId);
        await waitForPodDeletion(service, providerPodId, { sleepImpl });
        stdout('Cleanup: the remaining test Pod was deleted; the network volume was kept.');
      } catch (cleanupError) {
        stderr(`URGENT: provider test Pod cleanup failed: ${safeCode(cleanupError)}${Number.isSafeInteger(cleanupError?.status) ? ` (HTTP ${cleanupError.status})` : ''}`);
      }
    }
  }
}

async function main({
  argv = process.argv.slice(2),
  mongooseInstance = mongoose,
  mongoUrl = process.env.MONGOOSE_URL,
  apiKey = process.env.RUNPOD_API_KEY,
  service = new RunpodApiV2Service({ timeoutMs: 60_000, cacheTtlMs: 0 }),
  podModel = RunpodPod,
  managerFactory = (options) => new RunpodPodManager(options),
  fetchImpl = global.fetch,
  stdout = (line) => process.stdout.write(`${line}\n`),
  stderr = (line) => process.stderr.write(`${line}\n`),
  sleepImpl = sleep,
} = {}) {
  const requestedModel = argumentValue(argv, 'model', OLLAMA_DOWNLOADER_MODEL);
  const requestedVolumeId = argumentValue(argv, 'volume-id', process.env.RUNPOD_MODEL_VOLUME_ID || '');
  const requestedVolumeName = argumentValue(
    argv,
    'volume-name',
    process.env.RUNPOD_MODEL_VOLUME_NAME || DEFAULT_VOLUME_NAME
  );
  if (!argv.includes(EXECUTE_FLAG)) {
    stdout('Dry run only. No Runpod or database resource was changed.');
    stdout(`Re-run with ${EXECUTE_FLAG} to download ${requestedModel} to the retained volume, verify it from one fresh serving Pod, and delete both temporary Pods while keeping the volume and templates.`);
    stdout('Optional selectors: --model=<ollama-tag>, --volume-id=<id>, or --volume-name=<exact-name>.');
    return 0;
  }
  if (!apiKey) {
    stderr('Runpod model downloader test failed: RUNPOD_NOT_CONFIGURED');
    return 1;
  }

  let normalizedRequestedModel;
  try {
    normalizedRequestedModel = normalizeModelName(requestedModel, OLLAMA_DOWNLOADER_MODEL);
  } catch (error) {
    stderr(`Runpod model downloader test failed: ${safeCode(error)}`);
    return 1;
  }
  if (!mongoUrl) {
    stdout('MONGOOSE_URL is not configured; running the provider-only v2 workflow without local database records.');
    return runProviderOnlyTest({
      service,
      fetchImpl,
      sleepImpl,
      model: normalizedRequestedModel,
      requestedVolumeId,
      requestedVolumeName,
      stdout,
      stderr,
    });
  }

  const actor = { name: 'runpod-model-downloader-test' };
  const createdProviderPodIds = new Set();
  let manager;
  let downloadRecordId = null;
  let servingRecordId = null;
  try {
    const model = normalizedRequestedModel;
    await mongooseInstance.connect(mongoUrl, { serverSelectionTimeoutMS: 10_000 });
    const [providerPods, volumes, secureGpus] = await Promise.all([
      service.listPods(),
      service.listNetworkVolumes(),
      service.getGpuTypes({ cloud: 'SECURE', forceRefresh: true }),
    ]);
    const activeCount = providerPods.filter((pod) => ACTIVE_PROVIDER_STATUSES.has(pod?.status)).length;
    if (activeCount >= MAX_ACCOUNT_ACTIVE_PODS) {
      const error = new Error('The account already has the maximum allowed active test Pods.');
      error.code = 'RUNPOD_TEST_ACTIVE_LIMIT';
      throw error;
    }
    const volume = volumes.find((entry) => (
      (requestedVolumeId && entry?.id === requestedVolumeId)
      || (!requestedVolumeId && entry?.name === requestedVolumeName)
    ));
    if (!volume) {
      const error = new Error('The requested retained network volume was not found.');
      error.code = 'RUNPOD_TEST_VOLUME_NOT_FOUND';
      throw error;
    }
    if (Number(volume.size) < 30) {
      const error = new Error('The retained volume is too small for the requested model and headroom.');
      error.code = 'RUNPOD_TEST_VOLUME_TOO_SMALL';
      throw error;
    }
    if (providerPods.some((pod) => providerPodNetworkVolume(pod).id === volume.id)) {
      const error = new Error('The retained volume is already attached to another Pod.');
      error.code = 'RUNPOD_NETWORK_VOLUME_IN_USE';
      throw error;
    }
    const servingGpu = chooseServingGpu(secureGpus, volume.dataCenter);
    if (!servingGpu) {
      const error = new Error(`No ${MIN_SERVING_VRAM_GB}+ GB Secure Cloud GPU is available in the volume location below $0.99/hour.`);
      error.code = 'RUNPOD_TEST_SERVING_GPU_UNAVAILABLE';
      throw error;
    }
    stdout(`Using the retained ${volume.size} GB ${volume.type} volume in ${volume.dataCenter}.`);
    stdout(`Serving verification will use ${servingGpu.name || servingGpu.id} (${servingGpu.memory} GB, $${Number(servingGpu.price.secure).toFixed(4)}/GPU hour).`);

    manager = managerFactory({
      runpodService: service,
      fetchImpl,
      sleepImpl,
      maxActivePods: MAX_ACCOUNT_ACTIVE_PODS,
      maxGpuCount: 1,
      maxHourlyCostUsd: MAX_TEST_HOURLY_COST_USD,
      defaultAutoStopMinutes: 60,
      maxRuntimeMinutes: 6 * 60,
      provisionTimeoutMs: 15 * 60 * 1000,
      ollamaPullTimeoutMs: 6 * 60 * 60 * 1000,
      modelDownloadTimeoutMs: 6 * 60 * 60 * 1000,
      pollIntervalMs: 5_000,
    });

    const download = await manager.createModelDownload({
      networkVolumeId: volume.id,
      model,
      maxHourlyCost: MAX_TEST_HOURLY_COST_USD.toFixed(2),
      autoStopMinutes: '360',
      diskGb: '20',
      publicAccessAcknowledged: 'acknowledged',
    }, actor);
    downloadRecordId = download._id;
    createdProviderPodIds.add(download.providerPodId);
    stdout(`Downloader Pod started with ${download.gpu?.name || download.gpu?.id}; waiting for ${model} to be pulled and verified.`);
    const completedDownload = await waitForProvisioning(manager, downloadRecordId, podModel);
    if (completedDownload.setupStatus !== 'ready' || completedDownload.cleanupStatus !== 'completed') {
      const error = new Error('The downloader did not finish verification and automatic cleanup.');
      error.code = completedDownload.setupErrorCode
        || completedDownload.cleanupErrorCode
        || 'RUNPOD_TEST_DOWNLOAD_INCOMPLETE';
      throw error;
    }
    await waitForPodDeletion(service, completedDownload.providerPodId, { sleepImpl });
    createdProviderPodIds.delete(completedDownload.providerPodId);
    stdout(`${model} is verified on the network volume; the downloader Pod was deleted and archived.`);

    const serviceTemplate = await manager.saveOllamaTemplate({
      defaultModel: model,
      diskGb: '20',
      persistentDiskGb: '10',
    }, actor);
    const servingName = `ollama-volume-verify-${Date.now().toString(36)}`;
    const servingPod = await manager.createManagedPod({
      name: servingName,
      templateId: serviceTemplate._id.toString(),
      networkVolumeId: volume.id,
      cloud: 'SECURE',
      gpuId: servingGpu.id,
      gpuCount: '1',
      dataCenterId: volume.dataCenter,
      model,
      diskGb: '20',
      autoStopMinutes: '60',
      maxHourlyCost: MAX_TEST_HOURLY_COST_USD.toFixed(2),
      publicAccessAcknowledged: 'acknowledged',
    }, actor);
    servingRecordId = servingPod._id;
    createdProviderPodIds.add(servingPod.providerPodId);
    stdout('Fresh serving Pod created in the volume location; verifying the cached model without another download.');
    const readyServingPod = await waitForProvisioning(manager, servingRecordId, podModel);
    if (readyServingPod.setupStatus !== 'ready') {
      const error = new Error('The fresh serving Pod did not find and verify the cached model.');
      error.code = readyServingPod.setupErrorCode || 'RUNPOD_TEST_SERVING_SETUP_FAILED';
      throw error;
    }
    const publicUrl = publicOllamaUrl(readyServingPod.providerPodId);
    await verifyInference(fetchImpl, publicUrl, model);
    stdout('Fresh-Pod inference succeeded from the retained network-volume model.');

    await manager.deleteManagedPod(servingRecordId, readyServingPod.name, actor);
    await waitForPodDeletion(service, readyServingPod.providerPodId, { sleepImpl });
    createdProviderPodIds.delete(readyServingPod.providerPodId);
    servingRecordId = null;
    stdout('Serving verification Pod was deleted. The populated network volume and both reusable provider templates remain.');
    return 0;
  } catch (error) {
    stderr(`Runpod model downloader test failed: ${safeCode(error)}${Number.isSafeInteger(error?.status) ? ` (HTTP ${error.status})` : ''}`);
    return 1;
  } finally {
    if (manager) {
      for (const recordId of [servingRecordId, downloadRecordId]) {
        try {
          await deleteManagedTestPod(manager, podModel, recordId, actor);
        } catch (cleanupError) {
          stderr(`URGENT: managed test Pod cleanup failed: ${safeCode(cleanupError)}${Number.isSafeInteger(cleanupError?.status) ? ` (HTTP ${cleanupError.status})` : ''}`);
        }
      }
    }
    for (const providerPodId of createdProviderPodIds) {
      try {
        const exists = (await service.listPods()).some((pod) => pod?.id === providerPodId);
        if (exists) {
          await service.deletePod(providerPodId);
          await waitForPodDeletion(service, providerPodId, { sleepImpl });
          stdout('Cleanup: a remaining test Pod was permanently deleted; the network volume was kept.');
        }
      } catch (cleanupError) {
        stderr(`URGENT: provider test Pod cleanup failed: ${safeCode(cleanupError)}${Number.isSafeInteger(cleanupError?.status) ? ` (HTTP ${cleanupError.status})` : ''}`);
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
  ACTIVE_STOCK,
  DEFAULT_VOLUME_NAME,
  EXECUTE_FLAG,
  MAX_ACCOUNT_ACTIVE_PODS,
  MAX_TEST_HOURLY_COST_USD,
  MIN_SERVING_VRAM_GB,
  argumentValue,
  chooseServingGpu,
  createAttachedProviderPod,
  deleteManagedTestPod,
  ensureProviderTemplate,
  main,
  safeCode,
  runProviderOnlyTest,
  verifyInference,
  waitForPodDeletion,
  waitForProvisioning,
};
