#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const { RunpodApiV2Service } = require('../services/runpodApiV2Service');
const {
  OLLAMA_NETWORK_MODELS_PATH,
  OLLAMA_NETWORK_VOLUME_PATH,
  OLLAMA_PROVIDER_TEMPLATE_NAME,
  RunpodPodManager,
  normalizeTemplateInput,
  providerTemplatePayload,
  publicOllamaUrl,
} = require('../services/runpodPodManager');

const EXECUTE_FLAG = '--execute';
const MAX_TEST_HOURLY_COST_USD = 1;
const MAX_ACCOUNT_ACTIVE_PODS = 2;
const TEST_MODEL = 'qwen2.5:0.5b';
const TEST_VOLUME_SIZE_GB = 10;
const ACTIVE_STATUSES = new Set(['PROVISIONING', 'STARTING', 'RUNNING']);
const AVAILABLE_STOCK = new Set(['LOW', 'MEDIUM', 'HIGH']);
const PREFERRED_GPU_IDS = Object.freeze([
  'NVIDIA GeForce RTX 4090',
  'NVIDIA RTX A4500',
  'NVIDIA RTX A5000',
]);
const STOCK_RANK = Object.freeze({ HIGH: 0, MEDIUM: 1, LOW: 2 });

function safeCode(error) {
  return typeof error?.code === 'string' && error.code.length <= 80
    ? error.code
    : 'RUNPOD_NETWORK_VOLUME_TEST_FAILED';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function choosePlacement(gpus, dataCenters) {
  const standardDataCenters = new Set(
    dataCenters
      .filter((dataCenter) => Array.isArray(dataCenter?.networkVolumeTypes)
        && dataCenter.networkVolumeTypes.includes('STANDARD'))
      .map((dataCenter) => dataCenter.id)
  );
  const candidates = [];
  gpus.forEach((gpu) => {
    if (
      !PREFERRED_GPU_IDS.includes(gpu?.id)
      || !AVAILABLE_STOCK.has(gpu?.availability)
      || !Number.isFinite(gpu?.price?.secure)
      || gpu.price.secure <= 0
      || gpu.price.secure >= MAX_TEST_HOURLY_COST_USD
      || Number(gpu?.maxCount?.secure) < 1
    ) return;
    (Array.isArray(gpu.dataCenters) ? gpu.dataCenters : []).forEach((placement) => {
      if (
        standardDataCenters.has(placement?.id)
        && AVAILABLE_STOCK.has(placement?.availability)
      ) {
        candidates.push({ gpu, dataCenterId: placement.id, availability: placement.availability });
      }
    });
  });
  return candidates.sort((left, right) => (
    STOCK_RANK[left.availability] - STOCK_RANK[right.availability]
    || left.gpu.price.secure - right.gpu.price.secure
    || PREFERRED_GPU_IDS.indexOf(left.gpu.id) - PREFERRED_GPU_IDS.indexOf(right.gpu.id)
  ))[0] || null;
}

async function waitForPodStatus(service, podId, expected, {
  timeoutMs = 10 * 60 * 1000,
  pollIntervalMs = 5_000,
  sleepImpl = sleep,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pod = await service.getPod(podId);
    if (pod.status === expected) return pod;
    if (['ERROR', 'TERMINATED'].includes(pod.status) && pod.status !== expected) {
      const error = new Error('Pod entered a terminal state.');
      error.code = 'RUNPOD_TEST_TERMINAL_STATE';
      throw error;
    }
    await sleepImpl(pollIntervalMs);
  }
  const error = new Error('Pod status wait timed out.');
  error.code = 'RUNPOD_TEST_STATUS_TIMEOUT';
  throw error;
}

async function waitForPodDeletion(service, podId, {
  timeoutMs = 2 * 60 * 1000,
  pollIntervalMs = 2_000,
  sleepImpl = sleep,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await service.listPods()).some((pod) => pod?.id === podId)) return true;
    await sleepImpl(pollIntervalMs);
  }
  const error = new Error('Deleted Pod remained in the provider list.');
  error.code = 'RUNPOD_TEST_POD_DELETE_TIMEOUT';
  throw error;
}

async function waitForVolumeDeletion(service, volumeId, {
  timeoutMs = 2 * 60 * 1000,
  pollIntervalMs = 2_000,
  sleepImpl = sleep,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await service.listNetworkVolumes()).some((volume) => volume?.id === volumeId)) return true;
    await sleepImpl(pollIntervalMs);
  }
  const error = new Error('Deleted network volume remained in the provider list.');
  error.code = 'RUNPOD_TEST_VOLUME_DELETE_TIMEOUT';
  throw error;
}

async function ensureProviderTemplate(service) {
  const normalized = normalizeTemplateInput({ defaultModel: TEST_MODEL });
  const payload = providerTemplatePayload(normalized);
  const existing = (await service.getAccountTemplates()).find((entry) => (
    entry?.name === OLLAMA_PROVIDER_TEMPLATE_NAME
  ));
  return existing
    ? service.updateTemplate(existing.id, payload)
    : service.createTemplate(payload);
}

async function createAttachedPod(service, templateId, placement, volumeId, suffix) {
  return service.createPod({
    name: `volume-v2-${suffix}-${Date.now().toString(36)}`,
    templateId,
    cloud: 'SECURE',
    gpu: { id: placement.gpu.id, count: 1 },
    disk: 20,
    mounts: {
      network: [{ volumeId, path: OLLAMA_NETWORK_VOLUME_PATH }],
    },
    env: {
      OLLAMA_HOST: '0.0.0.0:11434',
      OLLAMA_MODELS: OLLAMA_NETWORK_MODELS_PATH,
    },
    dataCenterIds: [placement.dataCenterId],
    globalNetworking: false,
  });
}

async function main({
  argv = process.argv.slice(2),
  service = new RunpodApiV2Service({ timeoutMs: 60_000, cacheTtlMs: 0 }),
  fetchImpl = global.fetch,
  stdout = (line) => process.stdout.write(`${line}\n`),
  stderr = (line) => process.stderr.write(`${line}\n`),
  sleepImpl = sleep,
  managerFactory = (options) => new RunpodPodManager(options),
} = {}) {
  if (!argv.includes(EXECUTE_FLAG)) {
    stdout('Dry run only. No Runpod resource was changed.');
    stdout(`Re-run with ${EXECUTE_FLAG} to create a disposable 10 GB Standard volume and two sequential sub-$1/hour Pods, verify cross-Pod model reuse, then delete every test resource.`);
    return 0;
  }

  let podId = null;
  let volumeId = null;
  let podDeleted = true;
  let volumeDeleted = true;
  try {
    const [currentPods, gpus, dataCenters] = await Promise.all([
      service.listPods(),
      service.getGpuTypes({ cloud: 'SECURE', forceRefresh: true }),
      service.getDataCenters({ forceRefresh: true }),
    ]);
    if (currentPods.filter((pod) => ACTIVE_STATUSES.has(pod?.status)).length >= MAX_ACCOUNT_ACTIVE_PODS) {
      const error = new Error('Active Pod safety limit reached.');
      error.code = 'RUNPOD_TEST_ACTIVE_LIMIT';
      throw error;
    }
    const placement = choosePlacement(gpus, dataCenters);
    if (!placement) {
      const error = new Error('No preferred GPU has Standard-volume stock below the test cost ceiling.');
      error.code = 'RUNPOD_TEST_PLACEMENT_UNAVAILABLE';
      throw error;
    }
    stdout(`Selected ${placement.gpu.name || placement.gpu.id} in ${placement.dataCenterId}: ${placement.availability} location stock, $${placement.gpu.price.secure.toFixed(4)}/GPU hour.`);

    const template = await ensureProviderTemplate(service);
    const volume = await service.createNetworkVolume({
      name: `volume-v2-test-${Date.now().toString(36)}`,
      size: TEST_VOLUME_SIZE_GB,
      dataCenter: placement.dataCenterId,
      type: 'STANDARD',
    });
    volumeId = volume.id;
    volumeDeleted = false;
    stdout(`Created disposable ${TEST_VOLUME_SIZE_GB} GB Standard volume in ${placement.dataCenterId}.`);

    const manager = managerFactory({
      runpodService: service,
      fetchImpl,
      sleepImpl,
      provisionTimeoutMs: 10 * 60 * 1000,
      ollamaPullTimeoutMs: 10 * 60 * 1000,
      pollIntervalMs: 5_000,
    });

    const firstPod = await createAttachedPod(service, template.id, placement, volumeId, 'writer');
    podId = firstPod.id;
    podDeleted = false;
    if (Number.isFinite(firstPod.cost) && firstPod.cost >= MAX_TEST_HOURLY_COST_USD) {
      const error = new Error('Created Pod exceeded the test cost limit.');
      error.code = 'RUNPOD_TEST_COST_LIMIT';
      throw error;
    }
    stdout('Created the first attached Pod; waiting for RUNNING and Ollama.');
    await waitForPodStatus(service, podId, 'RUNNING', { sleepImpl });
    let publicUrl = publicOllamaUrl(podId);
    await manager.waitForOllama(publicUrl);
    await manager.pullOllamaModel(publicUrl, TEST_MODEL);
    await manager.verifyOllamaModel(publicUrl, TEST_MODEL);
    stdout(`First Pod downloaded ${TEST_MODEL} into the network volume.`);
    await service.deletePod(podId);
    await waitForPodDeletion(service, podId, { sleepImpl });
    podDeleted = true;
    podId = null;
    stdout('First Pod deleted; the independent volume remains.');

    const secondPod = await createAttachedPod(service, template.id, placement, volumeId, 'reader');
    podId = secondPod.id;
    podDeleted = false;
    if (Number.isFinite(secondPod.cost) && secondPod.cost >= MAX_TEST_HOURLY_COST_USD) {
      const error = new Error('Replacement Pod exceeded the test cost limit.');
      error.code = 'RUNPOD_TEST_COST_LIMIT';
      throw error;
    }
    stdout('Created a replacement Pod on the same volume; waiting for Ollama.');
    await waitForPodStatus(service, podId, 'RUNNING', { sleepImpl });
    publicUrl = publicOllamaUrl(podId);
    await manager.waitForOllama(publicUrl);
    await manager.verifyOllamaModel(publicUrl, TEST_MODEL);
    stdout(`Cross-Pod reuse verified: ${TEST_MODEL} was present without a second pull.`);

    await service.deletePod(podId);
    await waitForPodDeletion(service, podId, { sleepImpl });
    podDeleted = true;
    podId = null;
    await service.deleteNetworkVolume(volumeId);
    await waitForVolumeDeletion(service, volumeId, { sleepImpl });
    volumeDeleted = true;
    volumeId = null;
    stdout('Cleanup verified: both test Pods and the disposable network volume were deleted.');
    return 0;
  } catch (error) {
    stderr(`Runpod network-volume test failed: ${safeCode(error)}${Number.isSafeInteger(error?.status) ? ` (HTTP ${error.status})` : ''}`);
    return 1;
  } finally {
    if (podId && !podDeleted) {
      try {
        await service.deletePod(podId);
        await waitForPodDeletion(service, podId, { sleepImpl });
        stdout('Cleanup: the remaining test Pod was permanently deleted.');
      } catch (cleanupError) {
        stderr(`URGENT: automatic test Pod cleanup failed: ${safeCode(cleanupError)}${Number.isSafeInteger(cleanupError?.status) ? ` (HTTP ${cleanupError.status})` : ''}`);
      }
    }
    if (volumeId && !volumeDeleted) {
      try {
        await service.deleteNetworkVolume(volumeId);
        await waitForVolumeDeletion(service, volumeId, { sleepImpl });
        stdout('Cleanup: the disposable test volume was permanently deleted.');
      } catch (cleanupError) {
        stderr(`URGENT: automatic test volume cleanup failed: ${safeCode(cleanupError)}${Number.isSafeInteger(cleanupError?.status) ? ` (HTTP ${cleanupError.status})` : ''}`);
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
  ACTIVE_STATUSES,
  EXECUTE_FLAG,
  MAX_ACCOUNT_ACTIVE_PODS,
  MAX_TEST_HOURLY_COST_USD,
  PREFERRED_GPU_IDS,
  TEST_MODEL,
  TEST_VOLUME_SIZE_GB,
  choosePlacement,
  createAttachedPod,
  ensureProviderTemplate,
  main,
  safeCode,
  waitForPodDeletion,
  waitForPodStatus,
  waitForVolumeDeletion,
};
