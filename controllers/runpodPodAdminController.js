const logger = require('../utils/logger');
const { runpodBillingHistoryService } = require('../services/runpodBillingHistoryService');
const { runpodPodManager } = require('../services/runpodPodManager');

const RUNPOD_ADMIN_PATH = '/admin/runpod';
const NOTICE_KEYS = Object.freeze({
  templateSynced: 'template-synced',
  templateFailed: 'template-failed',
  gatewayTemplateSynced: 'gateway-template-synced',
  gatewayTemplateFailed: 'gateway-template-failed',
  cloudflareAccessDenied: 'cloudflare-access-denied',
  cloudflareAccessNotEnforced: 'cloudflare-access-not-enforced',
  modelDownloadCreated: 'model-download-created',
  modelDownloadFailed: 'model-download-failed',
  modelArtifactPreparationCreated: 'model-artifact-preparation-created',
  modelArtifactPreparationFailed: 'model-artifact-preparation-failed',
  modelArtifactGpuUnavailable: 'model-artifact-gpu-unavailable',
  modelArtifactVolumeInUse: 'model-artifact-volume-in-use',
  modelArtifactAlreadyReady: 'model-artifact-already-ready',
  modelArtifactPodCreated: 'model-artifact-pod-created',
  modelArtifactPodFailed: 'model-artifact-pod-failed',
  modelArtifactPodGpuUnavailable: 'model-artifact-pod-gpu-unavailable',
  modelArtifactNotReady: 'model-artifact-not-ready',
  llmGatewayNotConfigured: 'llm-gateway-not-configured',
  podCreated: 'pod-created',
  podCreateFailed: 'pod-create-failed',
  podStarted: 'pod-started',
  podStartFailed: 'pod-start-failed',
  podStartGpuUnavailable: 'pod-start-gpu-unavailable',
  podStartRateLimited: 'pod-start-rate-limited',
  podStopped: 'pod-stopped',
  podStopFailed: 'pod-stop-failed',
  podExtended: 'pod-extended',
  podExtendFailed: 'pod-extend-failed',
  podDeleted: 'pod-deleted',
  podDeleteFailed: 'pod-delete-failed',
  setupQueued: 'setup-queued',
  setupFailed: 'setup-failed',
  podsSynced: 'pods-synced',
  podsSyncFailed: 'pods-sync-failed',
  billingSynced: 'billing-synced',
  billingSyncFailed: 'billing-sync-failed',
  networkVolumeCreated: 'network-volume-created',
  networkVolumeCreateFailed: 'network-volume-create-failed',
  networkVolumeDeleted: 'network-volume-deleted',
  networkVolumeDeleteFailed: 'network-volume-delete-failed',
  networkVolumesSynced: 'network-volumes-synced',
  networkVolumesSyncFailed: 'network-volumes-sync-failed',
  insufficientBalance: 'insufficient-balance',
  costLimit: 'cost-limit',
  storageCostLimit: 'storage-cost-limit',
});

function redirectWithNotice(res, notice, fragment = 'pods') {
  const target = `${RUNPOD_ADMIN_PATH}?notice=${encodeURIComponent(notice)}#${fragment}`;
  return res.redirect(303, target);
}

function failureNotice(error, fallback) {
  if (error?.status === 402) return NOTICE_KEYS.insufficientBalance;
  if (error?.code === 'RUNPOD_COST_LIMIT_EXCEEDED') return NOTICE_KEYS.costLimit;
  if (error?.code === 'RUNPOD_NETWORK_VOLUME_COST_LIMIT_EXCEEDED') {
    return NOTICE_KEYS.storageCostLimit;
  }
  if (error?.code === 'RUNPOD_CLOUDFLARE_ACCESS_DENIED') {
    return NOTICE_KEYS.cloudflareAccessDenied;
  }
  if (error?.code === 'RUNPOD_CLOUDFLARE_ACCESS_NOT_ENFORCED') {
    return NOTICE_KEYS.cloudflareAccessNotEnforced;
  }
  if (error?.code === 'RUNPOD_ARTIFACT_GPU_UNAVAILABLE') {
    return NOTICE_KEYS.modelArtifactGpuUnavailable;
  }
  if (error?.code === 'RUNPOD_ARTIFACT_ALREADY_READY') {
    return NOTICE_KEYS.modelArtifactAlreadyReady;
  }
  if (error?.code === 'RUNPOD_MODEL_ARTIFACT_NOT_READY') {
    return NOTICE_KEYS.modelArtifactNotReady;
  }
  if (error?.code === 'RUNPOD_LLM_GATEWAY_NOT_CONFIGURED') {
    return NOTICE_KEYS.llmGatewayNotConfigured;
  }
  return fallback;
}

function modelArtifactPreparationFailureNotice(error) {
  if (error?.code === 'RUNPOD_NETWORK_VOLUME_IN_USE') {
    return NOTICE_KEYS.modelArtifactVolumeInUse;
  }
  return failureNotice(error, NOTICE_KEYS.modelArtifactPreparationFailed);
}

function modelArtifactPodFailureNotice(error) {
  if (['RUNPOD_LLM_GPU_UNAVAILABLE', 'RUNPOD_GPU_UNAVAILABLE'].includes(error?.code)) {
    return NOTICE_KEYS.modelArtifactPodGpuUnavailable;
  }
  return failureNotice(error, NOTICE_KEYS.modelArtifactPodFailed);
}

function startFailureNotice(error) {
  if (error?.code === 'RUNPOD_START_GPU_UNAVAILABLE') {
    return NOTICE_KEYS.podStartGpuUnavailable;
  }
  if (error?.code === 'RUNPOD_START_RATE_LIMITED') {
    return NOTICE_KEYS.podStartRateLimited;
  }
  return failureNotice(error, NOTICE_KEYS.podStartFailed);
}

function logRejectedOperation(appLogger, action, error) {
  const expectedInputFailure = [
    'RUNPOD_INPUT_INVALID',
    'RUNPOD_DELETE_CONFIRMATION_REQUIRED',
    'RUNPOD_PUBLIC_ACCESS_NOT_ACKNOWLEDGED',
    'RUNPOD_ACTION_CONFLICT',
    'RUNPOD_RUNTIME_LIMIT_EXCEEDED',
    'RUNPOD_START_GPU_UNAVAILABLE',
    'RUNPOD_START_RATE_LIMITED',
    'RUNPOD_GPU_UNAVAILABLE',
    'RUNPOD_GPU_COUNT_UNAVAILABLE',
    'RUNPOD_DOWNLOAD_GPU_UNAVAILABLE',
    'RUNPOD_ARTIFACT_GPU_UNAVAILABLE',
    'RUNPOD_ARTIFACT_VOLUME_TOO_SMALL',
    'RUNPOD_ARTIFACT_BILLING_NOT_ACKNOWLEDGED',
    'RUNPOD_ARTIFACT_ALREADY_PREPARING',
    'RUNPOD_ARTIFACT_ALREADY_READY',
    'RUNPOD_LLM_BILLING_NOT_ACKNOWLEDGED',
    'RUNPOD_LLM_GATEWAY_NOT_CONFIGURED',
    'RUNPOD_LLM_GPU_UNAVAILABLE',
    'RUNPOD_LLM_VRAM_INSUFFICIENT',
    'RUNPOD_MODEL_ARTIFACT_NOT_READY',
    'RUNPOD_DATACENTER_UNAVAILABLE',
    'RUNPOD_DATACENTER_NETWORKING_UNAVAILABLE',
    'RUNPOD_ACTIVE_POD_LIMIT',
    'RUNPOD_COST_LIMIT_EXCEEDED',
    'RUNPOD_TEMPLATE_NOT_READY',
    'RUNPOD_NETWORK_VOLUME_BILLING_NOT_ACKNOWLEDGED',
    'RUNPOD_NETWORK_VOLUME_RATE_NOT_CONFIGURED',
    'RUNPOD_NETWORK_VOLUME_COST_LIMIT_EXCEEDED',
    'RUNPOD_NETWORK_VOLUME_DATACENTER_UNAVAILABLE',
    'RUNPOD_NETWORK_VOLUME_NOT_FOUND',
    'RUNPOD_NETWORK_VOLUME_DELETE_CONFIRMATION_REQUIRED',
    'RUNPOD_NETWORK_VOLUME_IN_USE',
    'RUNPOD_NETWORK_VOLUME_DATACENTER_MISMATCH',
    'RUNPOD_NETWORK_VOLUME_SECURE_CLOUD_REQUIRED',
    'RUNPOD_CLOUDFLARE_NOT_CONFIGURED',
    'RUNPOD_CLOUDFLARE_CONFIGURATION_INVALID',
    'RUNPOD_CLOUDFLARE_ACCESS_DENIED',
    'RUNPOD_CLOUDFLARE_ACCESS_NOT_ENFORCED',
    'RUNPOD_GATEWAY_CONNECTOR_CONFLICT',
  ].includes(error?.code);
  appLogger[expectedInputFailure ? 'warning' : 'error']('Runpod admin operation did not complete', {
    category: 'runpod_management',
    metadata: {
      action,
      errorCode: typeof error?.code === 'string' ? error.code.slice(0, 80) : 'RUNPOD_MANAGEMENT_ERROR',
      providerStatus: Number.isSafeInteger(error?.status) ? error.status : null,
    },
  });
}

function createRunpodPodAdminController({
  manager = runpodPodManager,
  billingHistoryService = runpodBillingHistoryService,
  appLogger = logger,
} = {}) {
  return {
    async createNetworkVolume(req, res) {
      try {
        await manager.createManagedNetworkVolume(req.body || {}, req.user);
        return redirectWithNotice(res, NOTICE_KEYS.networkVolumeCreated, 'network-volumes');
      } catch (error) {
        logRejectedOperation(appLogger, 'network_volume_create', error);
        return redirectWithNotice(
          res,
          failureNotice(error, NOTICE_KEYS.networkVolumeCreateFailed),
          'network-volumes'
        );
      }
    },

    async deleteNetworkVolume(req, res) {
      try {
        await manager.deleteManagedNetworkVolume(
          req.params.id,
          req.body?.confirmation,
          req.user
        );
        return redirectWithNotice(res, NOTICE_KEYS.networkVolumeDeleted, 'network-volumes');
      } catch (error) {
        logRejectedOperation(appLogger, 'network_volume_delete', error);
        return redirectWithNotice(
          res,
          NOTICE_KEYS.networkVolumeDeleteFailed,
          'network-volumes'
        );
      }
    },

    async syncNetworkVolumes(req, res) {
      try {
        await manager.syncProviderNetworkVolumes(req.user);
        return redirectWithNotice(res, NOTICE_KEYS.networkVolumesSynced, 'network-volumes');
      } catch (error) {
        logRejectedOperation(appLogger, 'network_volume_sync', error);
        return redirectWithNotice(
          res,
          NOTICE_KEYS.networkVolumesSyncFailed,
          'network-volumes'
        );
      }
    },

    async saveOllamaTemplate(req, res) {
      try {
        await manager.saveOllamaTemplate(req.body || {}, req.user);
        return redirectWithNotice(res, NOTICE_KEYS.templateSynced, 'workload-templates');
      } catch (error) {
        logRejectedOperation(appLogger, 'template_sync', error);
        return redirectWithNotice(res, NOTICE_KEYS.templateFailed, 'workload-templates');
      }
    },

    async saveOllamaCloudflareTemplate(req, res) {
      try {
        await manager.saveOllamaCloudflareTemplate(req.body || {}, req.user);
        return redirectWithNotice(
          res,
          NOTICE_KEYS.gatewayTemplateSynced,
          'workload-templates'
        );
      } catch (error) {
        logRejectedOperation(appLogger, 'gateway_template_sync', error);
        return redirectWithNotice(
          res,
          NOTICE_KEYS.gatewayTemplateFailed,
          'workload-templates'
        );
      }
    },

    async createPod(req, res) {
      try {
        await manager.createManagedPod(req.body || {}, req.user);
        return redirectWithNotice(res, NOTICE_KEYS.podCreated);
      } catch (error) {
        logRejectedOperation(appLogger, 'create', error);
        return redirectWithNotice(
          res,
          failureNotice(error, NOTICE_KEYS.podCreateFailed),
          'pod-creator'
        );
      }
    },

    async createModelDownload(req, res) {
      try {
        await manager.createModelDownload(req.body || {}, req.user);
        return redirectWithNotice(res, NOTICE_KEYS.modelDownloadCreated, 'model-downloader');
      } catch (error) {
        logRejectedOperation(appLogger, 'model_download_create', error);
        return redirectWithNotice(
          res,
          failureNotice(error, NOTICE_KEYS.modelDownloadFailed),
          'model-downloader'
        );
      }
    },

    async prepareModelArtifact(req, res) {
      try {
        await manager.prepareModelArtifact(req.body || {}, req.user);
        return redirectWithNotice(
          res,
          NOTICE_KEYS.modelArtifactPreparationCreated,
          'model-artifacts'
        );
      } catch (error) {
        logRejectedOperation(appLogger, 'model_artifact_prepare', error);
        return redirectWithNotice(
          res,
          modelArtifactPreparationFailureNotice(error),
          'model-artifacts'
        );
      }
    },

    async createModelArtifactPod(req, res) {
      try {
        await manager.createModelArtifactPod(req.body || {}, req.user);
        return redirectWithNotice(
          res,
          NOTICE_KEYS.modelArtifactPodCreated,
          'pods'
        );
      } catch (error) {
        logRejectedOperation(appLogger, 'llama_cpp_create', error);
        return redirectWithNotice(
          res,
          modelArtifactPodFailureNotice(error),
          'model-library'
        );
      }
    },

    async startPod(req, res) {
      try {
        await manager.transitionManagedPod(req.params.id, 'start', req.user, req.body || {});
        return redirectWithNotice(res, NOTICE_KEYS.podStarted);
      } catch (error) {
        logRejectedOperation(appLogger, 'start', error);
        return redirectWithNotice(res, startFailureNotice(error));
      }
    },

    async stopPod(req, res) {
      try {
        await manager.transitionManagedPod(req.params.id, 'stop', req.user);
        return redirectWithNotice(res, NOTICE_KEYS.podStopped);
      } catch (error) {
        logRejectedOperation(appLogger, 'stop', error);
        return redirectWithNotice(res, NOTICE_KEYS.podStopFailed);
      }
    },

    async extendPod(req, res) {
      try {
        await manager.extendManagedPod(req.params.id, req.body || {}, req.user);
        return redirectWithNotice(res, NOTICE_KEYS.podExtended);
      } catch (error) {
        logRejectedOperation(appLogger, 'extend', error);
        return redirectWithNotice(res, NOTICE_KEYS.podExtendFailed);
      }
    },

    async deletePod(req, res) {
      try {
        await manager.deleteManagedPod(req.params.id, req.body?.confirmation, req.user);
        return redirectWithNotice(res, NOTICE_KEYS.podDeleted, 'archived-pods');
      } catch (error) {
        logRejectedOperation(appLogger, 'delete', error);
        return redirectWithNotice(res, NOTICE_KEYS.podDeleteFailed);
      }
    },

    async retrySetup(req, res) {
      try {
        await manager.retryProvisioning(req.params.id, req.user);
        return redirectWithNotice(res, NOTICE_KEYS.setupQueued);
      } catch (error) {
        logRejectedOperation(appLogger, 'setup', error);
        return redirectWithNotice(res, NOTICE_KEYS.setupFailed);
      }
    },

    async syncPods(req, res) {
      try {
        await manager.syncProviderPods(req.user);
        return redirectWithNotice(res, NOTICE_KEYS.podsSynced);
      } catch (error) {
        logRejectedOperation(appLogger, 'sync', error);
        return redirectWithNotice(res, NOTICE_KEYS.podsSyncFailed);
      }
    },

    async syncBilling(req, res) {
      try {
        await billingHistoryService.syncHistory(req.user);
        return redirectWithNotice(res, NOTICE_KEYS.billingSynced, 'billing-history');
      } catch (error) {
        logRejectedOperation(appLogger, 'billing_sync', error);
        return redirectWithNotice(res, NOTICE_KEYS.billingSyncFailed, 'billing-history');
      }
    },
  };
}

const controller = createRunpodPodAdminController();

module.exports = {
  ...controller,
  NOTICE_KEYS,
  createRunpodPodAdminController,
  failureNotice,
  modelArtifactPodFailureNotice,
  modelArtifactPreparationFailureNotice,
  redirectWithNotice,
  startFailureNotice,
};
