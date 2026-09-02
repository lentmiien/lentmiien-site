#!/usr/bin/env node
'use strict';

require('dotenv').config({ quiet: true });

const { RunpodApiV2Service } = require('../services/runpodApiV2Service');
const {
  GLM53_FLASH_UD_IQ4_XS_SLUG,
  artifactPreparerProviderPayload,
  getModelArtifactPreset,
  modelArtifactPreparationSignal,
} = require('../services/runpodModelArtifactCatalog');

const EXECUTE_FLAG = '--execute';
const DEFAULT_VOLUME_NAME = 'glm-5-3-flash-ud-iq4-xs';
const ACTIVE_PROVIDER_STATUSES = new Set(['PROVISIONING', 'STARTING', 'RUNNING']);
const AVAILABLE_STOCK = new Set(['LOW', 'MEDIUM', 'HIGH']);
const STOCK_RANK = Object.freeze({ HIGH: 0, MEDIUM: 1, LOW: 2 });
const MAX_ACCOUNT_ACTIVE_PODS = 2;
const POLL_INTERVAL_MS = 15_000;

function argumentValue(argv, name, fallback = '') {
  const prefix = `--${name}=`;
  const argument = argv.find((entry) => entry.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

function safeCode(error) {
  return typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/u.test(error.code)
    ? error.code
    : 'RUNPOD_ARTIFACT_PREPARATION_FAILED';
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function choosePreparationGpu(gpus, dataCenterId, maxHourlyCost, requestedGpuId = '') {
  return (Array.isArray(gpus) ? gpus : [])
    .filter((gpu) => {
      const id = String(gpu?.id || '');
      const price = Number(gpu?.price?.secure);
      const location = (Array.isArray(gpu?.dataCenters) ? gpu.dataCenters : []).find((entry) => (
        entry?.id === dataCenterId && AVAILABLE_STOCK.has(entry?.availability)
      ));
      return id
        && (!requestedGpuId || id === requestedGpuId)
        && Number.isFinite(price)
        && price > 0
        && price <= maxHourlyCost
        && Number(gpu?.maxCount?.secure) >= 1
        && AVAILABLE_STOCK.has(gpu?.availability)
        && location;
    })
    .map((gpu) => ({
      gpu,
      location: gpu.dataCenters.find((entry) => entry?.id === dataCenterId),
    }))
    .sort((left, right) => (
      Number(left.gpu.price.secure) - Number(right.gpu.price.secure)
      || (STOCK_RANK[left.location.availability] ?? 3)
        - (STOCK_RANK[right.location.availability] ?? 3)
      || String(left.gpu.name || left.gpu.id).localeCompare(String(right.gpu.name || right.gpu.id))
    ))[0]?.gpu || null;
}

async function ensureProviderTemplate(service, presetSlug) {
  const payload = artifactPreparerProviderPayload(presetSlug);
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
  const error = new Error('The preparation Pod remained after deletion.');
  error.code = 'RUNPOD_ARTIFACT_POD_DELETE_TIMEOUT';
  throw error;
}

function preparationSignal(logs = []) {
  const signal = modelArtifactPreparationSignal(logs);
  return signal.status === 'failed'
    ? { status: signal.status, stage: signal.stage, code: signal.errorCode }
    : { status: signal.status, stage: signal.stage };
}

async function waitForPreparation(service, providerPodId, preset, {
  timeoutMs = (preset.preparationTimeoutSeconds + 10 * 60) * 1000,
  pollIntervalMs = POLL_INTERVAL_MS,
  sleepImpl = sleep,
  onStage = () => {},
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastStage = '';
  while (Date.now() < deadline) {
    const [pod, logSnapshot] = await Promise.all([
      service.getPod(providerPodId),
      service.getPodLogSnapshot(providerPodId, {
        source: 'container',
        tail: 500,
        maxWaitMs: 2_000,
      }).catch(() => ({ events: [] })),
    ]);
    const signal = preparationSignal(logSnapshot.events);
    const hasLogEvents = Array.isArray(logSnapshot.events) && logSnapshot.events.length > 0;
    if (signal.stage !== lastStage && (hasLogEvents || !lastStage)) {
      lastStage = signal.stage;
      onStage(signal.stage);
    }
    if (signal.status === 'ready') return { pod, signal };
    if (signal.status === 'failed') {
      const error = new Error('The artifact preparation command failed.');
      error.code = signal.code;
      throw error;
    }
    if (['ERROR', 'EXITED', 'TERMINATED'].includes(pod.status)) {
      const error = new Error('The artifact preparation Pod stopped before readiness was verified.');
      error.code = pod.status === 'EXITED'
        ? 'RUNPOD_ARTIFACT_PREPARATION_TIMEOUT_OR_EXIT'
        : 'RUNPOD_ARTIFACT_POD_TERMINAL_STATE';
      throw error;
    }
    await sleepImpl(pollIntervalMs);
  }
  const error = new Error('The artifact preparation monitor timed out.');
  error.code = 'RUNPOD_ARTIFACT_MONITOR_TIMEOUT';
  throw error;
}

async function main({
  argv = process.argv.slice(2),
  service = new RunpodApiV2Service({ timeoutMs: 60_000, cacheTtlMs: 0 }),
  stdout = (line) => process.stdout.write(`${line}\n`),
  stderr = (line) => process.stderr.write(`${line}\n`),
  sleepImpl = sleep,
} = {}) {
  const preset = getModelArtifactPreset(GLM53_FLASH_UD_IQ4_XS_SLUG);
  const volumeId = argumentValue(argv, 'volume-id', process.env.RUNPOD_GLM53_VOLUME_ID || '');
  const volumeName = argumentValue(argv, 'volume-name', DEFAULT_VOLUME_NAME);
  const requestedGpuId = argumentValue(argv, 'gpu-id', '');
  const maxHourlyCost = Number(argumentValue(
    argv,
    'max-hourly-cost',
    String(preset.preparationMaxHourlyCostUsd)
  ));

  if (!argv.includes(EXECUTE_FLAG)) {
    stdout('Dry run only. No Runpod resource was changed.');
    stdout(`Preset: ${preset.name}; ${preset.totalBytes} verified bytes from ${preset.sourceRepository}@${preset.sourceRevision}.`);
    stdout(`Re-run with ${EXECUTE_FLAG} to use the retained ${preset.recommendedVolumeGb} GB volume, create one temporary Secure Cloud Pod below $${preset.preparationMaxHourlyCostUsd.toFixed(2)}/hour, then delete only the Pod after verification.`);
    return 0;
  }
  if (!Number.isFinite(maxHourlyCost) || maxHourlyCost <= 0 || maxHourlyCost > 1) {
    stderr('Runpod artifact preparation failed: RUNPOD_ARTIFACT_COST_LIMIT_INVALID');
    return 1;
  }

  let providerPodId = null;
  let podDeleted = true;
  try {
    const [pods, volumes, gpus] = await Promise.all([
      service.listPods(),
      service.listNetworkVolumes(),
      service.getGpuTypes({ cloud: 'SECURE', forceRefresh: true }),
    ]);
    if (pods.filter((pod) => ACTIVE_PROVIDER_STATUSES.has(pod?.status)).length >= MAX_ACCOUNT_ACTIVE_PODS) {
      const error = new Error('The active Pod safety limit was reached.');
      error.code = 'RUNPOD_ARTIFACT_ACTIVE_POD_LIMIT';
      throw error;
    }
    const volume = volumes.find((entry) => (
      (volumeId && entry?.id === volumeId)
      || (!volumeId && entry?.name === volumeName)
    ));
    if (!volume) {
      const error = new Error('The dedicated artifact volume was not found.');
      error.code = 'RUNPOD_ARTIFACT_VOLUME_NOT_FOUND';
      throw error;
    }
    if (Number(volume.size) < preset.recommendedVolumeGb) {
      const error = new Error('The dedicated artifact volume is too small.');
      error.code = 'RUNPOD_ARTIFACT_VOLUME_TOO_SMALL';
      throw error;
    }
    if (pods.some((pod) => pod?.mounts?.network?.some((mount) => mount?.volumeId === volume.id))) {
      const error = new Error('The dedicated artifact volume is already attached to a Pod.');
      error.code = 'RUNPOD_ARTIFACT_VOLUME_IN_USE';
      throw error;
    }
    const gpu = choosePreparationGpu(gpus, volume.dataCenter, maxHourlyCost, requestedGpuId);
    if (!gpu) {
      const error = new Error('No compatible preparation GPU is currently available.');
      error.code = 'RUNPOD_ARTIFACT_GPU_UNAVAILABLE';
      throw error;
    }
    stdout(`Selected ${gpu.name || gpu.id} in ${volume.dataCenter} at $${Number(gpu.price.secure).toFixed(4)}/GPU hour.`);
    const template = await ensureProviderTemplate(service, preset.slug);
    stdout('Private pinned artifact-preparer template is ready.');
    const pod = await service.createPod({
      name: `prepare-glm53-iq4-${Date.now().toString(36)}`,
      templateId: template.id,
      cloud: 'SECURE',
      gpu: { id: gpu.id, count: 1 },
      disk: preset.preparationDiskGb,
      mounts: {
        network: [{ volumeId: volume.id, path: '/workspace' }],
      },
      dataCenterIds: [volume.dataCenter],
      globalNetworking: false,
    });
    providerPodId = pod.id;
    podDeleted = false;
    if (Number.isFinite(pod.cost) && pod.cost > maxHourlyCost) {
      const error = new Error('Runpod returned a preparation Pod above the confirmed limit.');
      error.code = 'RUNPOD_ARTIFACT_COST_LIMIT_EXCEEDED';
      throw error;
    }
    stdout(`Preparation Pod ${providerPodId} created; the in-container GPU deadline is four hours.`);
    await waitForPreparation(service, providerPodId, preset, {
      sleepImpl,
      onStage: (stage) => stdout(`Preparation stage: ${stage}.`),
    });
    stdout(`Verified ${preset.name} and the pinned llama.cpp runtime on volume ${volume.id}.`);
    return 0;
  } catch (error) {
    stderr(`Runpod artifact preparation failed: ${safeCode(error)}${Number.isSafeInteger(error?.status) ? ` (HTTP ${error.status})` : ''}`);
    return 1;
  } finally {
    if (providerPodId && !podDeleted) {
      try {
        await service.deletePod(providerPodId);
        await waitForPodDeletion(service, providerPodId, { sleepImpl });
        podDeleted = true;
        stdout('Cleanup verified: the temporary preparation Pod was deleted; the network volume remains.');
      } catch (cleanupError) {
        stderr(`URGENT: automatic preparation Pod cleanup failed: ${safeCode(cleanupError)}`);
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
  AVAILABLE_STOCK,
  DEFAULT_VOLUME_NAME,
  EXECUTE_FLAG,
  MAX_ACCOUNT_ACTIVE_PODS,
  POLL_INTERVAL_MS,
  argumentValue,
  choosePreparationGpu,
  ensureProviderTemplate,
  main,
  preparationSignal,
  safeCode,
  waitForPodDeletion,
  waitForPreparation,
};
