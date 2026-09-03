const {
  NOTICE_KEYS,
  createRunpodPodAdminController,
  failureNotice,
  llamaCppReconfigureFailureNotice,
  modelArtifactPodFailureNotice,
  modelArtifactPreparationFailureNotice,
  startFailureNotice,
} = require('../../controllers/runpodPodAdminController');

function response() {
  return { redirect: jest.fn().mockReturnThis() };
}

function manager() {
  return {
    createManagedNetworkVolume: jest.fn().mockResolvedValue({}),
    deleteManagedNetworkVolume: jest.fn().mockResolvedValue(true),
    syncProviderNetworkVolumes: jest.fn().mockResolvedValue({}),
    saveOllamaTemplate: jest.fn().mockResolvedValue({}),
    saveOllamaCloudflareTemplate: jest.fn().mockResolvedValue({}),
    createModelDownload: jest.fn().mockResolvedValue({}),
    prepareModelArtifact: jest.fn().mockResolvedValue({}),
    createModelArtifactPod: jest.fn().mockResolvedValue({}),
    createManagedPod: jest.fn().mockResolvedValue({}),
    transitionManagedPod: jest.fn().mockResolvedValue({}),
    extendManagedPod: jest.fn().mockResolvedValue({}),
    reconfigureManagedLlamaCppPod: jest.fn().mockResolvedValue({}),
    deleteManagedPod: jest.fn().mockResolvedValue(true),
    retryProvisioning: jest.fn().mockResolvedValue(true),
    syncProviderPods: jest.fn().mockResolvedValue({}),
  };
}

function billingService() {
  return { syncHistory: jest.fn().mockResolvedValue({}) };
}

describe('Runpod Pod admin mutation controller', () => {
  test.each([
    ['createNetworkVolume', 'createManagedNetworkVolume', {}, {}, NOTICE_KEYS.networkVolumeCreated, 'network-volumes'],
    ['deleteNetworkVolume', 'deleteManagedNetworkVolume', { id: 'volume-id' }, { confirmation: 'volume-name' }, NOTICE_KEYS.networkVolumeDeleted, 'network-volumes'],
    ['syncNetworkVolumes', 'syncProviderNetworkVolumes', {}, {}, NOTICE_KEYS.networkVolumesSynced, 'network-volumes'],
    ['saveOllamaTemplate', 'saveOllamaTemplate', {}, {}, NOTICE_KEYS.templateSynced, 'workload-templates'],
    ['saveOllamaCloudflareTemplate', 'saveOllamaCloudflareTemplate', {}, {}, NOTICE_KEYS.gatewayTemplateSynced, 'workload-templates'],
    ['createModelDownload', 'createModelDownload', {}, {}, NOTICE_KEYS.modelDownloadCreated, 'model-downloader'],
    ['prepareModelArtifact', 'prepareModelArtifact', {}, {}, NOTICE_KEYS.modelArtifactPreparationCreated, 'model-artifacts'],
    ['createModelArtifactPod', 'createModelArtifactPod', {}, {}, NOTICE_KEYS.modelArtifactPodCreated, 'pods'],
    ['createPod', 'createManagedPod', {}, {}, NOTICE_KEYS.podCreated, 'pods'],
    ['startPod', 'transitionManagedPod', { id: 'local-id' }, { runMinutes: '240' }, NOTICE_KEYS.podStarted, 'pods'],
    ['stopPod', 'transitionManagedPod', { id: 'local-id' }, {}, NOTICE_KEYS.podStopped, 'pods'],
    ['extendPod', 'extendManagedPod', { id: 'local-id' }, { extensionMinutes: '60' }, NOTICE_KEYS.podExtended, 'pods'],
    ['reconfigureLlamaCppPod', 'reconfigureManagedLlamaCppPod', { id: 'local-id' }, { contextTokens: '32768', reloadAcknowledged: 'acknowledged' }, NOTICE_KEYS.llamaCppReconfigured, 'pods'],
    ['deletePod', 'deleteManagedPod', { id: 'local-id' }, { confirmation: 'pod-name' }, NOTICE_KEYS.podDeleted, 'archived-pods'],
    ['retrySetup', 'retryProvisioning', { id: 'local-id' }, {}, NOTICE_KEYS.setupQueued, 'pods'],
    ['syncPods', 'syncProviderPods', {}, {}, NOTICE_KEYS.podsSynced, 'pods'],
  ])('redirects %s through a fixed 303 notice after success', async (
    controllerMethod,
    managerMethod,
    params,
    body,
    notice,
    fragment
  ) => {
    const service = manager();
    const controller = createRunpodPodAdminController({
      manager: service,
      billingHistoryService: billingService(),
    });
    const res = response();
    const req = { params, body, user: { name: 'admin' } };

    await controller[controllerMethod](req, res);

    expect(service[managerMethod]).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      303,
      `/admin/runpod?notice=${encodeURIComponent(notice)}#${fragment}`
    );
  });

  test('synchronizes durable billing with the validated principal', async () => {
    const service = billingService();
    const controller = createRunpodPodAdminController({
      manager: manager(),
      billingHistoryService: service,
    });
    const res = response();
    const user = { name: 'admin' };

    await controller.syncBilling({ body: {}, params: {}, user }, res);

    expect(service.syncHistory).toHaveBeenCalledWith(user);
    expect(res.redirect).toHaveBeenCalledWith(
      303,
      '/admin/runpod?notice=billing-synced#billing-history'
    );
  });

  test('passes only the expected local ID, action, confirmation, body, and principal fields', async () => {
    const service = manager();
    const controller = createRunpodPodAdminController({ manager: service });
    const user = { name: 'admin' };

    await controller.createPod({ body: { gpuId: 'gpu' }, user }, response());
    await controller.createModelDownload({
      body: { networkVolumeId: 'volume-id', model: 'qwen3.8:27b' }, user,
    }, response());
    await controller.prepareModelArtifact({
      body: { presetSlug: 'glm-5-3-flash-ud-iq4-xs', networkVolumeId: 'volume-id' }, user,
    }, response());
    await controller.createModelArtifactPod({
      body: { artifactId: 'artifact-id', gpuId: 'gpu' }, user,
    }, response());
    await controller.createNetworkVolume({ body: { sizeGb: '50' }, user }, response());
    await controller.deleteNetworkVolume({
      params: { id: 'volume-id' }, body: { confirmation: 'volume-name' }, user,
    }, response());
    await controller.startPod({ params: { id: 'pod-id' }, body: { runMinutes: '240' }, user }, response());
    await controller.stopPod({ params: { id: 'pod-id' }, user }, response());
    await controller.extendPod({
      params: { id: 'pod-id' }, body: { extensionMinutes: '60' }, user,
    }, response());
    await controller.reconfigureLlamaCppPod({
      params: { id: 'pod-id' },
      body: { contextTokens: '32768', reloadAcknowledged: 'acknowledged' },
      user,
    }, response());
    await controller.deletePod({ params: { id: 'pod-id' }, body: { confirmation: 'exact' }, user }, response());

    expect(service.createManagedPod).toHaveBeenCalledWith({ gpuId: 'gpu' }, user);
    expect(service.createModelDownload).toHaveBeenCalledWith({
      networkVolumeId: 'volume-id', model: 'qwen3.8:27b',
    }, user);
    expect(service.prepareModelArtifact).toHaveBeenCalledWith({
      presetSlug: 'glm-5-3-flash-ud-iq4-xs', networkVolumeId: 'volume-id',
    }, user);
    expect(service.createModelArtifactPod).toHaveBeenCalledWith({
      artifactId: 'artifact-id', gpuId: 'gpu',
    }, user);
    expect(service.createManagedNetworkVolume).toHaveBeenCalledWith({ sizeGb: '50' }, user);
    expect(service.deleteManagedNetworkVolume).toHaveBeenCalledWith(
      'volume-id',
      'volume-name',
      user
    );
    expect(service.transitionManagedPod).toHaveBeenNthCalledWith(
      1,
      'pod-id',
      'start',
      user,
      { runMinutes: '240' }
    );
    expect(service.transitionManagedPod).toHaveBeenNthCalledWith(2, 'pod-id', 'stop', user);
    expect(service.extendManagedPod).toHaveBeenCalledWith(
      'pod-id',
      { extensionMinutes: '60' },
      user
    );
    expect(service.reconfigureManagedLlamaCppPod).toHaveBeenCalledWith(
      'pod-id',
      { contextTokens: '32768', reloadAcknowledged: 'acknowledged' },
      user
    );
    expect(service.deleteManagedPod).toHaveBeenCalledWith('pod-id', 'exact', user);
  });

  test('maps cost and payment failures to fixed notices without leaking provider details', async () => {
    const secret = 'provider-body-with-secret';
    const service = manager();
    service.createManagedPod.mockRejectedValue(Object.assign(new Error(secret), {
      code: 'RUNPOD_COST_LIMIT_EXCEEDED',
      status: 409,
    }));
    const appLogger = { warning: jest.fn(), error: jest.fn() };
    const controller = createRunpodPodAdminController({ manager: service, appLogger });
    const res = response();

    await controller.createPod({ body: {}, user: { name: 'admin' } }, res);

    expect(res.redirect).toHaveBeenCalledWith(
      303,
      '/admin/runpod?notice=cost-limit#pod-creator'
    );
    expect(JSON.stringify(appLogger.warning.mock.calls)).not.toContain(secret);
    expect(failureNotice({ status: 402 }, 'fallback')).toBe(NOTICE_KEYS.insufficientBalance);
    expect(failureNotice({ code: 'RUNPOD_CLOUDFLARE_ACCESS_DENIED' }, 'fallback'))
      .toBe(NOTICE_KEYS.cloudflareAccessDenied);
    expect(failureNotice({ code: 'RUNPOD_CLOUDFLARE_ACCESS_NOT_ENFORCED' }, 'fallback'))
      .toBe(NOTICE_KEYS.cloudflareAccessNotEnforced);
    expect(modelArtifactPreparationFailureNotice({ code: 'RUNPOD_ARTIFACT_GPU_UNAVAILABLE' }))
      .toBe(NOTICE_KEYS.modelArtifactGpuUnavailable);
    expect(modelArtifactPreparationFailureNotice({ code: 'RUNPOD_NETWORK_VOLUME_IN_USE' }))
      .toBe(NOTICE_KEYS.modelArtifactVolumeInUse);
    expect(modelArtifactPodFailureNotice({ code: 'RUNPOD_LLM_GPU_UNAVAILABLE' }))
      .toBe(NOTICE_KEYS.modelArtifactPodGpuUnavailable);
    expect(llamaCppReconfigureFailureNotice({
      code: 'RUNPOD_LLAMA_CPP_RELOAD_DEADLINE_TOO_CLOSE',
    })).toBe(NOTICE_KEYS.llamaCppReloadDeadlineTooClose);
  });

  test('maps an unavailable original GPU start to specific fixed guidance', async () => {
    const secret = 'provider-detail-secret';
    const service = manager();
    service.transitionManagedPod.mockRejectedValue(Object.assign(new Error(secret), {
      code: 'RUNPOD_START_GPU_UNAVAILABLE',
      providerStatus: 409,
    }));
    const appLogger = { warning: jest.fn(), error: jest.fn() };
    const controller = createRunpodPodAdminController({ manager: service, appLogger });
    const res = response();

    await controller.startPod({
      params: { id: 'pod-id' }, body: { runMinutes: '60' }, user: { name: 'admin' },
    }, res);

    expect(res.redirect).toHaveBeenCalledWith(
      303,
      '/admin/runpod?notice=pod-start-gpu-unavailable#pods'
    );
    expect(startFailureNotice({ code: 'RUNPOD_START_RATE_LIMITED' }))
      .toBe(NOTICE_KEYS.podStartRateLimited);
    expect(JSON.stringify(appLogger.warning.mock.calls)).not.toContain(secret);
  });
});
