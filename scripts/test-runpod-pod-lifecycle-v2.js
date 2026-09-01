#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const {
  RunpodApiV2Service,
} = require('../services/runpodApiV2Service');
const {
  OLLAMA_PROVIDER_TEMPLATE_NAME,
  RunpodPodManager,
  normalizeTemplateInput,
  providerTemplatePayload,
  publicOllamaUrl,
} = require('../services/runpodPodManager');

const EXECUTE_FLAG = '--execute';
const PAUSE_FLAG = '--pause-after-ready';
const MAX_TEST_HOURLY_COST_USD = 1;
const MAX_ACCOUNT_ACTIVE_PODS = 2;
const TEST_MODEL = 'qwen2.5:0.5b';
const PREFERRED_GPU_IDS = Object.freeze([
  'NVIDIA GeForce RTX 4090',
  'NVIDIA RTX A4500',
  'NVIDIA RTX A5000',
]);
const ACTIVE_STATUSES = new Set(['PROVISIONING', 'STARTING', 'RUNNING']);
const STOCK_RANK = Object.freeze({ HIGH: 0, MEDIUM: 1, LOW: 2 });

function safeCode(error) {
  return typeof error?.code === 'string' && error.code.length <= 80
    ? error.code
    : 'RUNPOD_LIFECYCLE_TEST_FAILED';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEnter() {
  if (!process.stdin.isTTY) return Promise.resolve();
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}

function chooseGpu(gpus) {
  return gpus
    .filter((gpu) => (
      PREFERRED_GPU_IDS.includes(gpu?.id)
      && STOCK_RANK[gpu?.availability] !== undefined
      && Number.isFinite(gpu?.price?.secure)
      && gpu.price.secure > 0
      && gpu.price.secure < MAX_TEST_HOURLY_COST_USD
      && Number(gpu?.maxCount?.secure) >= 1
    ))
    .sort((left, right) => (
      STOCK_RANK[left.availability] - STOCK_RANK[right.availability]
      || left.price.secure - right.price.secure
      || PREFERRED_GPU_IDS.indexOf(left.id) - PREFERRED_GPU_IDS.indexOf(right.id)
    ))[0] || null;
}

async function waitForStatus(service, podId, expected, {
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

async function waitForDeletion(service, podId, {
  timeoutMs = 2 * 60 * 1000,
  pollIntervalMs = 2_000,
  sleepImpl = sleep,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pods = await service.listPods();
    if (!pods.some((pod) => pod?.id === podId)) return true;
    await sleepImpl(pollIntervalMs);
  }
  const error = new Error('Deleted Pod remained in the provider list.');
  error.code = 'RUNPOD_TEST_DELETE_TIMEOUT';
  throw error;
}

async function ensureProviderTemplate(service) {
  const template = normalizeTemplateInput({ defaultModel: TEST_MODEL });
  const payload = providerTemplatePayload(template);
  const existing = (await service.getAccountTemplates()).find((entry) => (
    entry?.name === OLLAMA_PROVIDER_TEMPLATE_NAME
  ));
  return existing
    ? service.updateTemplate(existing.id, payload)
    : service.createTemplate(payload);
}

async function main({
  argv = process.argv.slice(2),
  service = new RunpodApiV2Service({ timeoutMs: 60_000, cacheTtlMs: 0 }),
  fetchImpl = global.fetch,
  stdout = (line) => process.stdout.write(`${line}\n`),
  stderr = (line) => process.stderr.write(`${line}\n`),
  sleepImpl = sleep,
  pause = waitForEnter,
  managerFactory = (options) => new RunpodPodManager(options),
} = {}) {
  if (!argv.includes(EXECUTE_FLAG)) {
    stdout('Dry run only. No Runpod resource was changed.');
    stdout(`Re-run with ${EXECUTE_FLAG} to create one sub-$1/hour single-GPU Pod, test Ollama, stop/start it, and permanently delete it.`);
    return 0;
  }

  let podId = null;
  let deleted = false;
  try {
    const currentPods = await service.listPods();
    const activeCount = currentPods.filter((pod) => ACTIVE_STATUSES.has(pod?.status)).length;
    if (activeCount >= MAX_ACCOUNT_ACTIVE_PODS) {
      const error = new Error('Active Pod safety limit reached.');
      error.code = 'RUNPOD_TEST_ACTIVE_LIMIT';
      throw error;
    }

    const gpus = await service.getGpuTypes({ cloud: 'SECURE', forceRefresh: true });
    const gpu = chooseGpu(gpus);
    if (!gpu) {
      const error = new Error('No preferred test GPU is available below the cost ceiling.');
      error.code = 'RUNPOD_TEST_GPU_UNAVAILABLE';
      throw error;
    }
    stdout(`Selected ${gpu.name || gpu.id}: ${gpu.memory} GB VRAM, ${gpu.availability} availability, $${gpu.price.secure.toFixed(4)}/GPU hour.`);

    const template = await ensureProviderTemplate(service);
    stdout('Private Ollama template is ready in Runpod API v2.');
    const created = await service.createPod({
      name: `ollama-v2-test-${Date.now().toString(36)}`,
      templateId: template.id,
      cloud: 'SECURE',
      gpu: { id: gpu.id, count: 1 },
      disk: 20,
      mounts: {
        persistent: { size: 10, path: '/root/.ollama' },
      },
      globalNetworking: false,
    });
    podId = created.id;
    if (Number.isFinite(created.cost) && created.cost >= MAX_TEST_HOURLY_COST_USD) {
      const error = new Error('Created Pod exceeded the test cost limit.');
      error.code = 'RUNPOD_TEST_COST_LIMIT';
      throw error;
    }
    stdout('Created one single-GPU Pod; waiting for RUNNING.');

    await waitForStatus(service, podId, 'RUNNING', { sleepImpl });
    const manager = managerFactory({
      runpodService: service,
      fetchImpl,
      sleepImpl,
      provisionTimeoutMs: 10 * 60 * 1000,
      ollamaPullTimeoutMs: 10 * 60 * 1000,
      pollIntervalMs: 5_000,
    });
    const publicUrl = publicOllamaUrl(podId);
    await manager.waitForOllama(publicUrl);
    stdout(`Ollama is reachable at ${publicUrl}`);
    stdout(`Downloading ${TEST_MODEL} through the Ollama API.`);
    await manager.pullOllamaModel(publicUrl, TEST_MODEL);
    await manager.verifyOllamaModel(publicUrl, TEST_MODEL);
    stdout(`Model ${TEST_MODEL} is installed and visible in Ollama.`);

    if (argv.includes(PAUSE_FLAG)) {
      stdout('READY_FOR_BROWSER_CHECK');
      stdout('Press Enter after the browser check to continue with stop/start/delete verification.');
      await pause();
    }

    await service.transitionPod(podId, 'stop');
    await waitForStatus(service, podId, 'EXITED', { sleepImpl });
    stdout('Stop verified (EXITED).');

    await service.transitionPod(podId, 'start');
    await waitForStatus(service, podId, 'RUNNING', { sleepImpl });
    await manager.waitForOllama(publicUrl);
    await manager.verifyOllamaModel(publicUrl, TEST_MODEL);
    stdout('Start verified; Ollama returned and the persistent model is still present.');

    await service.deletePod(podId);
    await waitForDeletion(service, podId, { sleepImpl });
    deleted = true;
    stdout('Delete verified. The test Pod and its host-local persistent disk were permanently removed.');
    return 0;
  } catch (error) {
    stderr(`Runpod Pod lifecycle test failed: ${safeCode(error)}${Number.isSafeInteger(error?.status) ? ` (HTTP ${error.status})` : ''}`);
    return 1;
  } finally {
    if (podId && !deleted) {
      try {
        await service.deletePod(podId);
        stdout('Cleanup: the test Pod was permanently deleted.');
      } catch (cleanupError) {
        stderr(`URGENT: automatic test Pod cleanup failed: ${safeCode(cleanupError)}${Number.isSafeInteger(cleanupError?.status) ? ` (HTTP ${cleanupError.status})` : ''}`);
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
  PAUSE_FLAG,
  PREFERRED_GPU_IDS,
  TEST_MODEL,
  chooseGpu,
  ensureProviderTemplate,
  main,
  safeCode,
  waitForDeletion,
  waitForStatus,
};
