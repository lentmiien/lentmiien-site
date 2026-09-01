const logger = require('../utils/logger');
const { runpodBillingHistoryService } = require('../services/runpodBillingHistoryService');
const { runpodPodManager } = require('../services/runpodPodManager');

const RUNPOD_ADMIN_PATH = '/admin/runpod';
const NOTICE_KEYS = Object.freeze({
  templateSynced: 'template-synced',
  templateFailed: 'template-failed',
  podCreated: 'pod-created',
  podCreateFailed: 'pod-create-failed',
  podStarted: 'pod-started',
  podStartFailed: 'pod-start-failed',
  podStopped: 'pod-stopped',
  podStopFailed: 'pod-stop-failed',
  podDeleted: 'pod-deleted',
  podDeleteFailed: 'pod-delete-failed',
  setupQueued: 'setup-queued',
  setupFailed: 'setup-failed',
  podsSynced: 'pods-synced',
  podsSyncFailed: 'pods-sync-failed',
  billingSynced: 'billing-synced',
  billingSyncFailed: 'billing-sync-failed',
  insufficientBalance: 'insufficient-balance',
  costLimit: 'cost-limit',
});

function redirectWithNotice(res, notice, fragment = 'pods') {
  const target = `${RUNPOD_ADMIN_PATH}?notice=${encodeURIComponent(notice)}#${fragment}`;
  return res.redirect(303, target);
}

function failureNotice(error, fallback) {
  if (error?.status === 402) return NOTICE_KEYS.insufficientBalance;
  if (error?.code === 'RUNPOD_COST_LIMIT_EXCEEDED') return NOTICE_KEYS.costLimit;
  return fallback;
}

function logRejectedOperation(appLogger, action, error) {
  const expectedInputFailure = [
    'RUNPOD_INPUT_INVALID',
    'RUNPOD_DELETE_CONFIRMATION_REQUIRED',
    'RUNPOD_PUBLIC_ACCESS_NOT_ACKNOWLEDGED',
    'RUNPOD_ACTION_CONFLICT',
    'RUNPOD_GPU_UNAVAILABLE',
    'RUNPOD_GPU_COUNT_UNAVAILABLE',
    'RUNPOD_DATACENTER_UNAVAILABLE',
    'RUNPOD_DATACENTER_NETWORKING_UNAVAILABLE',
    'RUNPOD_ACTIVE_POD_LIMIT',
    'RUNPOD_COST_LIMIT_EXCEEDED',
    'RUNPOD_TEMPLATE_NOT_READY',
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
    async saveOllamaTemplate(req, res) {
      try {
        await manager.saveOllamaTemplate(req.body || {}, req.user);
        return redirectWithNotice(res, NOTICE_KEYS.templateSynced, 'workload-templates');
      } catch (error) {
        logRejectedOperation(appLogger, 'template_sync', error);
        return redirectWithNotice(res, NOTICE_KEYS.templateFailed, 'workload-templates');
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

    async startPod(req, res) {
      try {
        await manager.transitionManagedPod(req.params.id, 'start', req.user);
        return redirectWithNotice(res, NOTICE_KEYS.podStarted);
      } catch (error) {
        logRejectedOperation(appLogger, 'start', error);
        return redirectWithNotice(res, NOTICE_KEYS.podStartFailed);
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
  redirectWithNotice,
};
