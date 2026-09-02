const {
  OLLAMA_MODEL,
  OLLAMA_DOWNLOADER_MODEL,
  OLLAMA_CLOUDFLARE_TEMPLATE_SLUG,
  RunpodManagementError,
  RunpodPodManager,
  cloudflareGatewayStartArgs,
  chooseModelDownloadGpu,
  mergeGpuCatalogs,
  normalizeModelName,
  normalizeDownloaderTemplateInput,
  normalizeCloudflareTemplateInput,
  normalizeTemplateInput,
  projectPodUsage,
  providerTemplatePayload,
  publicOllamaUrl,
  usageFieldsForObservation,
  validatedOllamaBaseUrl,
} = require('../../services/runpodPodManager');
const { RunpodApiError } = require('../../services/runpodApiV2Service');

const TEMPLATE_ID = '507f1f77bcf86cd799439011';
const POD_RECORD_ID = '507f191e810c19729de860ea';
const VOLUME_RECORD_ID = '507f191e810c19729de860ab';
const FIXED_NOW = new Date('2026-09-01T00:00:00.000Z');

function queryResult(value) {
  const query = {
    lean: jest.fn().mockResolvedValue(value),
  };
  query.sort = jest.fn().mockReturnValue(query);
  query.limit = jest.fn().mockReturnValue(query);
  query.select = jest.fn().mockReturnValue(query);
  return query;
}

function ollamaTemplate(overrides = {}) {
  return {
    _id: TEMPLATE_ID,
    slug: 'ollama',
    name: 'Ollama GPU',
    providerTemplateId: 'provider-template-1',
    providerTemplateName: 'lentmiien-ollama-gpu-v2',
    providerSyncStatus: 'synced',
    image: 'ollama/ollama:latest',
    args: '',
    diskGb: 20,
    ports: ['11434/http'],
    env: {
      OLLAMA_HOST: '0.0.0.0:11434',
      OLLAMA_MODELS: '/root/.ollama/models',
    },
    persistentDiskGb: 10,
    persistentPath: '/root/.ollama',
    setupKind: 'ollama_pull',
    defaultModel: OLLAMA_MODEL,
    servicePort: 11434,
    healthPath: '/api/tags',
    active: true,
    ...overrides,
  };
}

function downloaderTemplate(overrides = {}) {
  return {
    ...ollamaTemplate(),
    slug: 'ollama-downloader',
    name: 'Ollama Model Downloader',
    providerTemplateId: 'provider-downloader-template-1',
    providerTemplateName: 'lentmiien-ollama-model-downloader-v2',
    setupKind: 'ollama_download',
    defaultModel: OLLAMA_DOWNLOADER_MODEL,
    ...overrides,
  };
}

function cloudflareTemplate(overrides = {}) {
  return {
    ...ollamaTemplate(),
    slug: OLLAMA_CLOUDFLARE_TEMPLATE_SLUG,
    name: 'Ollama GPU · Cloudflare Access',
    providerTemplateId: 'provider-cloudflare-template-1',
    providerTemplateName: 'lentmiien-ollama-cloudflare-v2',
    args: cloudflareGatewayStartArgs(),
    ports: [],
    env: {
      OLLAMA_HOST: '127.0.0.1:8080',
      OLLAMA_MODELS: '/root/.ollama/models',
      TUNNEL_TOKEN: '{{ RUNPOD_SECRET_lentmiien_cloudflare_tunnel_token }}',
    },
    defaultModel: 'qwen3.8:27b',
    servicePort: 8080,
    accessMode: 'cloudflare_access',
    gatewayUrl: 'https://llm.lentmiien.com/',
    ...overrides,
  };
}

function gpu(overrides = {}) {
  return {
    id: 'NVIDIA GeForce RTX 4090',
    name: 'RTX 4090',
    memory: 24,
    availability: 'HIGH',
    secure: true,
    price: { secure: 0.5 },
    maxCount: { secure: 4 },
    dataCenters: [{ id: 'EU-SE-1', availability: 'HIGH' }],
    ...overrides,
  };
}

function createFixture({ template = ollamaTemplate(), localPod = null, managerOptions = {} } = {}) {
  const runpodService = {
    listPods: jest.fn().mockResolvedValue([]),
    listNetworkVolumes: jest.fn().mockResolvedValue([]),
    createNetworkVolume: jest.fn(),
    deleteNetworkVolume: jest.fn().mockResolvedValue(true),
    getPod: jest.fn(),
    createPod: jest.fn(),
    transitionPod: jest.fn(),
    deletePod: jest.fn().mockResolvedValue(true),
    getAccountTemplates: jest.fn().mockResolvedValue([]),
    createTemplate: jest.fn(),
    updateTemplate: jest.fn(),
    getGpuTypes: jest.fn().mockResolvedValue([gpu()]),
    getDataCenters: jest.fn().mockResolvedValue([{
      id: 'EU-SE-1',
      globalNetwork: true,
      networkVolumeTypes: ['STANDARD'],
    }]),
  };
  const podModel = {
    find: jest.fn().mockImplementation(() => queryResult([])),
    findOne: jest.fn().mockImplementation(() => queryResult(localPod)),
    create: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    updateMany: jest.fn().mockResolvedValue({ acknowledged: true }),
  };
  const templateModel = {
    find: jest.fn().mockImplementation(() => queryResult([])),
    findOne: jest.fn().mockImplementation(() => queryResult(template)),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  };
  const networkVolumeModel = {
    find: jest.fn().mockImplementation(() => queryResult([])),
    findOne: jest.fn().mockImplementation(() => queryResult(null)),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  };
  const eventModel = { create: jest.fn().mockResolvedValue({}) };
  const appLogger = { warning: jest.fn(), error: jest.fn() };
  const manager = new RunpodPodManager({
    runpodService,
    podModel,
    networkVolumeModel,
    templateModel,
    eventModel,
    appLogger,
    now: () => new Date(FIXED_NOW),
    sleepImpl: jest.fn().mockResolvedValue(),
    maxActivePods: 2,
    maxGpuCount: 4,
    maxHourlyCostUsd: 10,
    defaultAutoStopMinutes: 60,
    maxRuntimeMinutes: 1440,
    ...managerOptions,
  });
  return {
    appLogger,
    eventModel,
    manager,
    networkVolumeModel,
    podModel,
    runpodService,
    templateModel,
  };
}

function validCreateInput(overrides = {}) {
  return {
    name: 'ollama-test',
    templateId: TEMPLATE_ID,
    cloud: 'SECURE',
    gpuId: 'NVIDIA GeForce RTX 4090',
    gpuCount: '1',
    model: OLLAMA_MODEL,
    diskGb: '20',
    persistentDiskGb: '10',
    autoStopMinutes: '60',
    maxHourlyCost: '1.00',
    publicAccessAcknowledged: 'acknowledged',
    ...overrides,
  };
}

describe('Runpod workload and picker helpers', () => {
  test('accrues running and stopped observations without double counting checkpoints', () => {
    const running = {
      providerStatus: 'RUNNING',
      usageTrackingMode: 'observed',
      usageState: 'running',
      usageTrackedSinceAt: new Date('2026-09-01T00:00:00Z'),
      usageStateEnteredAt: new Date('2026-09-01T00:00:00Z'),
      runningMs: 0,
      stoppedMs: 0,
      estimatedCostPerHour: 0.5,
    };
    const stoppedObservation = usageFieldsForObservation(
      running,
      { status: 'EXITED', cost: 0 },
      new Date('2026-09-01T00:30:00Z')
    );
    const secondObservation = usageFieldsForObservation(
      { ...running, ...stoppedObservation, providerStatus: 'EXITED' },
      { status: 'EXITED', cost: 0 },
      new Date('2026-09-01T01:30:00Z')
    );

    expect(stoppedObservation).toEqual(expect.objectContaining({
      usageState: 'stopped',
      runningMs: 30 * 60 * 1000,
      stoppedMs: 0,
    }));
    expect(secondObservation).toEqual(expect.objectContaining({
      usageState: 'stopped',
      runningMs: 30 * 60 * 1000,
      stoppedMs: 60 * 60 * 1000,
    }));
  });

  test('projects observed compute and lifecycle-dependent storage cost separately', () => {
    const usage = projectPodUsage({
      usageTrackingMode: 'observed',
      usageState: 'stopped',
      usageTrackedSinceAt: new Date('2026-09-01T00:00:00Z'),
      usageStateEnteredAt: new Date('2026-09-01T01:00:00Z'),
      runningMs: 60 * 60 * 1000,
      stoppedMs: 0,
      lastRunningCostPerHour: 0.5,
      diskGb: 20,
      persistentDiskGb: 10,
    }, { status: 'EXITED' }, new Date('2026-09-01T02:00:00Z'));

    expect(usage.runningMs).toBe(60 * 60 * 1000);
    expect(usage.stoppedMs).toBe(60 * 60 * 1000);
    expect(usage.estimatedComputeUsd).toBeCloseTo(0.5);
    expect(usage.estimatedStorageUsd).toBeCloseTo(5 / 730);
    expect(usage.estimatedTotalUsd).toBeCloseTo(0.5 + 5 / 730);
    expect(projectPodUsage({ usageTrackingMode: 'billing_only' }).trackingAvailable).toBe(false);
  });

  test('builds a private provider template with a fixed Ollama endpoint and persistent model path', () => {
    const normalized = normalizeTemplateInput({
      image: 'ollama/ollama:latest',
      defaultModel: 'qwen2.5:0.5b',
      diskGb: '25',
      persistentDiskGb: '15',
    });

    expect(providerTemplatePayload(normalized)).toEqual(expect.objectContaining({
      image: 'ollama/ollama:latest',
      category: 'NVIDIA',
      disk: 25,
      ports: ['11434/http'],
      env: {
        OLLAMA_HOST: '0.0.0.0:11434',
        OLLAMA_MODELS: '/root/.ollama/models',
      },
      mounts: { persistent: { size: 15, path: '/root/.ollama' } },
      public: false,
      serverless: false,
      startSsh: false,
      startJupyter: false,
    }));
  });

  test('builds a reusable downloader recipe and selects the cheapest compatible Secure GPU', () => {
    const normalized = normalizeDownloaderTemplateInput({
      defaultModel: 'qwen3.8:27b',
      diskGb: '25',
    });
    const selected = chooseModelDownloadGpu([
      gpu({
        id: 'expensive',
        price: { secure: 0.8 },
        dataCenters: [{ id: 'EU-RO-1', availability: 'HIGH' }],
      }),
      gpu({
        id: 'cheap',
        price: { secure: 0.3 },
        availability: 'LOW',
        dataCenters: [{ id: 'EU-RO-1', availability: 'LOW' }],
      }),
    ], 'EU-RO-1', 1);

    expect(normalized).toEqual(expect.objectContaining({
      slug: 'ollama-downloader',
      setupKind: 'ollama_download',
      defaultModel: 'qwen3.8:27b',
      diskGb: 25,
    }));
    expect(selected.id).toBe('cheap');
    expect(chooseModelDownloadGpu([
      gpu({ id: 'wrong-region' }),
    ], 'EU-RO-1', 1)).toBeNull();
  });

  test('merges Secure and Community catalog choices by stable GPU ID', () => {
    const choices = mergeGpuCatalogs(
      [gpu()],
      [gpu({
        secure: false,
        community: true,
        availability: 'MEDIUM',
        price: { community: 0.32 },
        maxCount: { community: 2 },
      })]
    );

    expect(choices).toEqual([expect.objectContaining({
      id: 'NVIDIA GeForce RTX 4090',
      memoryGb: 24,
      securePrice: 0.5,
      communityPrice: 0.32,
      secureAvailability: 'HIGH',
      communityAvailability: 'MEDIUM',
    })]);
  });

  test('derives only a canonical Runpod proxy URL and validates bounded model names', () => {
    const url = publicOllamaUrl('abc-123', 11434);
    expect(url).toBe('https://abc-123-11434.proxy.runpod.net');
    expect(validatedOllamaBaseUrl(url).href).toBe(`${url}/`);
    expect(() => publicOllamaUrl('../metadata', 11434)).toThrow(RunpodManagementError);
    expect(() => validatedOllamaBaseUrl('https://attacker.proxy.runpod.net')).toThrow(RunpodManagementError);
    expect(() => validatedOllamaBaseUrl(`${url}/redirect`)).toThrow(RunpodManagementError);
    expect(normalizeModelName('QWEN2.5:0.5B')).toBe('qwen2.5:0.5b');
    expect(() => normalizeModelName('http://127.0.0.1/model')).toThrow(RunpodManagementError);
  });

  test('builds an outbound-only Cloudflare profile with a Runpod Secret reference', () => {
    const normalized = normalizeCloudflareTemplateInput({
      defaultModel: 'qwen3.8:27b',
      diskGb: '25',
    }, {
      gatewayUrl: 'https://llm.lentmiien.com',
      tunnelSecretName: 'lentmiien_cloudflare_tunnel_token',
    });
    const start = JSON.parse(normalized.args);

    expect(normalized).toEqual(expect.objectContaining({
      slug: 'ollama-cloudflare',
      accessMode: 'cloudflare_access',
      gatewayUrl: 'https://llm.lentmiien.com/',
      ports: [],
      servicePort: 8080,
      env: expect.objectContaining({
        OLLAMA_HOST: '127.0.0.1:8080',
        TUNNEL_TOKEN: '{{ RUNPOD_SECRET_lentmiien_cloudflare_tunnel_token }}',
      }),
    }));
    expect(start.entrypoint).toEqual(['/bin/bash', '-lc']);
    expect(start.cmd[0]).toContain('tunnel --no-autoupdate run');
    expect(start.cmd[0]).not.toContain('--http-host-header');
    expect(normalized.args).not.toContain('cloudflare-token-value');
    expect(providerTemplatePayload(normalized).ports).toEqual([]);
  });

  test('accepts only the exact configured Cloudflare gateway origin', () => {
    expect(validatedOllamaBaseUrl('https://llm.lentmiien.com/', {
      accessMode: 'cloudflare_access',
      cloudflareGatewayUrl: 'https://llm.lentmiien.com',
    }).href).toBe('https://llm.lentmiien.com/');
    expect(() => validatedOllamaBaseUrl('https://llm.lentmiien.com.attacker.test/', {
      accessMode: 'cloudflare_access',
      cloudflareGatewayUrl: 'https://llm.lentmiien.com',
    })).toThrow(RunpodManagementError);
    expect(() => validatedOllamaBaseUrl('https://llm.lentmiien.com/api/tags', {
      accessMode: 'cloudflare_access',
      cloudflareGatewayUrl: 'https://llm.lentmiien.com',
    })).toThrow(RunpodManagementError);
  });
});

describe('RunpodPodManager', () => {
  test('clamps configured automatic-stop windows to the schema-safe range', () => {
    const fixture = createFixture();
    const tooShort = new RunpodPodManager({
      runpodService: fixture.runpodService,
      podModel: fixture.podModel,
      templateModel: fixture.templateModel,
      eventModel: fixture.eventModel,
      defaultAutoStopMinutes: 1,
      maxRuntimeMinutes: 1,
    });
    const tooLong = new RunpodPodManager({
      runpodService: fixture.runpodService,
      podModel: fixture.podModel,
      templateModel: fixture.templateModel,
      eventModel: fixture.eventModel,
      defaultAutoStopMinutes: 20_000,
      maxRuntimeMinutes: 20_000,
    });

    expect(tooShort.limits()).toEqual(expect.objectContaining({
      defaultAutoStopMinutes: 15,
      maxRuntimeMinutes: 15,
    }));
    expect(tooLong.limits()).toEqual(expect.objectContaining({
      defaultAutoStopMinutes: 10_080,
      maxRuntimeMinutes: 10_080,
    }));
  });

  test('assembles local lifecycle records, provider state, and both GPU clouds for the admin page', async () => {
    const localPod = {
      _id: POD_RECORD_ID,
      providerPodId: 'pod-1',
      name: 'managed',
      providerStatus: 'STARTING',
      setupStatus: 'waiting',
      cloud: 'SECURE',
      gpu: { id: gpu().id, name: 'RTX 4090', count: 1 },
      estimatedCostPerHour: 0.5,
      ports: ['11434/http'],
    };
    const fixture = createFixture();
    fixture.templateModel.find.mockReturnValue(queryResult([ollamaTemplate()]));
    fixture.podModel.find.mockReturnValue(queryResult([localPod]));
    fixture.runpodService.listPods.mockResolvedValue([{
      id: 'pod-1',
      name: 'managed',
      status: 'RUNNING',
      actions: ['stop', 'terminate'],
      cost: 0.52,
      gpu: { id: gpu().id, count: 1 },
    }, {
      id: 'pod-untracked',
      name: 'untracked',
      status: 'EXITED',
      actions: ['start', 'terminate'],
      gpu: { id: 'NVIDIA RTX A4500', count: 1 },
    }]);
    fixture.runpodService.getAccountTemplates.mockResolvedValue([{ id: 'provider-template-1' }]);
    fixture.runpodService.getGpuTypes.mockImplementation(({ cloud }) => Promise.resolve(
      cloud === 'SECURE'
        ? [gpu()]
        : [gpu({
          secure: false,
          community: true,
          availability: 'LOW',
          price: { community: 0.3 },
          maxCount: { community: 1 },
        })]
    ));

    const state = await fixture.manager.getAdminState();

    expect(state.templates[0]).toEqual(expect.objectContaining({ providerPresent: true }));
    expect(state.managedPods[0]).toEqual(expect.objectContaining({
      providerStatus: 'RUNNING',
      canStop: true,
      canExtend: true,
      costPerHour: 0.52,
    }));
    expect(state.unmanagedProviderPods).toEqual([
      expect.objectContaining({ providerPodId: 'pod-untracked', lifecycleGroup: 'stopped' }),
    ]);
    expect(state.gpuOptions[0]).toEqual(expect.objectContaining({
      securePrice: 0.5,
      communityPrice: 0.3,
    }));
  });

  test('does not count archived local Pods as network-volume attachments', async () => {
    const fixture = createFixture();
    fixture.networkVolumeModel.find.mockReturnValue(queryResult([{
      _id: VOLUME_RECORD_ID,
      providerNetworkVolumeId: 'volume-123',
      name: 'model-cache',
      dataCenterId: 'EU-SE-1',
      volumeType: 'STANDARD',
      sizeGb: 50,
      lifecycleGroup: 'active',
      providerPresent: true,
    }]));
    fixture.podModel.find.mockReturnValue(queryResult([{
      _id: POD_RECORD_ID,
      providerPodId: 'deleted-pod',
      name: 'deleted-pod',
      providerStatus: 'TERMINATED',
      lifecycleGroup: 'archived',
      archivedAt: FIXED_NOW,
      providerNetworkVolumeId: 'volume-123',
      gpu: { id: 'unknown', count: 1 },
    }]));
    fixture.runpodService.listNetworkVolumes.mockResolvedValue([{
      id: 'volume-123',
      name: 'model-cache',
      dataCenter: 'EU-SE-1',
      type: 'STANDARD',
      size: 50,
    }]);

    const state = await fixture.manager.getAdminState();

    expect(state.networkVolumes).toEqual([
      expect.objectContaining({
        providerNetworkVolumeId: 'volume-123',
        attachedPodCount: 0,
      }),
    ]);
  });

  test('creates and tracks a bounded Standard network volume after explicit billing confirmation', async () => {
    const fixture = createFixture();
    const providerVolume = {
      id: 'volume-123',
      name: 'ollama-model-cache',
      size: 50,
      dataCenter: 'EU-SE-1',
      type: 'STANDARD',
    };
    const trackedVolume = {
      _id: '507f191e810c19729de860ab',
      ...providerVolume,
      providerNetworkVolumeId: providerVolume.id,
      toObject: jest.fn(() => ({
        providerNetworkVolumeId: providerVolume.id,
        name: providerVolume.name,
      })),
    };
    fixture.runpodService.createNetworkVolume.mockResolvedValue(providerVolume);
    fixture.networkVolumeModel.findOneAndUpdate.mockResolvedValue(trackedVolume);

    await expect(fixture.manager.createManagedNetworkVolume({
      name: 'ollama-model-cache',
      sizeGb: '50',
      volumeType: 'STANDARD',
      dataCenterId: 'EU-SE-1',
      maxMonthlyCost: '4.00',
      storageBillingAcknowledged: 'acknowledged',
    }, { name: 'admin' })).resolves.toEqual(expect.objectContaining({
      providerNetworkVolumeId: 'volume-123',
    }));

    expect(fixture.runpodService.createNetworkVolume).toHaveBeenCalledWith({
      name: 'ollama-model-cache',
      size: 50,
      dataCenter: 'EU-SE-1',
      type: 'STANDARD',
    });
    expect(fixture.networkVolumeModel.findOneAndUpdate).toHaveBeenCalledWith(
      { providerNetworkVolumeId: 'volume-123' },
      expect.objectContaining({
        $set: expect.objectContaining({
          dataCenterId: 'EU-SE-1',
          sizeGb: 50,
          estimatedMonthlyCostUsd: 3.5,
        }),
      }),
      expect.objectContaining({ upsert: true, new: true, runValidators: true })
    );
  });

  test('requires storage billing acknowledgement and a confirmed monthly ceiling', async () => {
    const fixture = createFixture();

    await expect(fixture.manager.createManagedNetworkVolume({
      name: 'unconfirmed-volume',
      sizeGb: '50',
      volumeType: 'STANDARD',
      dataCenterId: 'EU-SE-1',
      maxMonthlyCost: '4.00',
    })).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_NETWORK_VOLUME_BILLING_NOT_ACKNOWLEDGED',
    }));
    await expect(fixture.manager.createManagedNetworkVolume({
      name: 'too-expensive-volume',
      sizeGb: '50',
      volumeType: 'STANDARD',
      dataCenterId: 'EU-SE-1',
      maxMonthlyCost: '1.00',
      storageBillingAcknowledged: 'acknowledged',
    })).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_NETWORK_VOLUME_COST_LIMIT_EXCEEDED',
    }));
    expect(fixture.runpodService.createNetworkVolume).not.toHaveBeenCalled();
  });

  test('resolves volume deletion from a local record and archives only after provider deletion', async () => {
    const fixture = createFixture();
    const localVolume = {
      _id: VOLUME_RECORD_ID,
      providerNetworkVolumeId: 'volume-123',
      name: 'ollama-model-cache',
      archivedAt: null,
    };
    fixture.networkVolumeModel.findOne.mockReturnValue(queryResult(localVolume));
    fixture.runpodService.listNetworkVolumes.mockResolvedValue([{
      id: 'volume-123',
      name: 'ollama-model-cache',
      size: 50,
      dataCenter: 'EU-SE-1',
      type: 'STANDARD',
    }]);

    await expect(fixture.manager.deleteManagedNetworkVolume(
      VOLUME_RECORD_ID,
      'ollama-model-cache',
      { name: 'admin' }
    )).resolves.toBe(true);

    expect(fixture.networkVolumeModel.findOne).toHaveBeenCalledWith({
      _id: VOLUME_RECORD_ID,
      archivedAt: null,
    });
    expect(fixture.runpodService.deleteNetworkVolume).toHaveBeenCalledWith('volume-123');
    expect(fixture.networkVolumeModel.updateOne).toHaveBeenCalledWith(
      { _id: VOLUME_RECORD_ID },
      { $set: expect.objectContaining({
        lifecycleGroup: 'archived',
        providerPresent: false,
        archivedAt: FIXED_NOW,
      }) }
    );
  });

  test('hides volume existence behind a generic local-record 404 and blocks attached deletion', async () => {
    const fixture = createFixture();

    await expect(fixture.manager.deleteManagedNetworkVolume(
      'provider-volume-id',
      'anything'
    )).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_NETWORK_VOLUME_NOT_FOUND',
      status: 404,
    }));
    expect(fixture.runpodService.listNetworkVolumes).not.toHaveBeenCalled();

    fixture.networkVolumeModel.findOne.mockReturnValue(queryResult({
      _id: VOLUME_RECORD_ID,
      providerNetworkVolumeId: 'volume-123',
      name: 'ollama-model-cache',
      archivedAt: null,
    }));
    fixture.runpodService.listNetworkVolumes.mockResolvedValue([{
      id: 'volume-123', name: 'ollama-model-cache',
    }]);
    fixture.runpodService.listPods.mockResolvedValue([{
      id: 'pod-1',
      mounts: { network: [{ volumeId: 'volume-123', path: '/workspace' }] },
    }]);

    await expect(fixture.manager.deleteManagedNetworkVolume(
      VOLUME_RECORD_ID,
      'ollama-model-cache'
    )).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_NETWORK_VOLUME_IN_USE',
    }));
    expect(fixture.runpodService.deleteNetworkVolume).not.toHaveBeenCalled();
  });

  test('creates a reusable auto-cleaned model download in the volume data center', async () => {
    const fixture = createFixture();
    const providerVolume = {
      id: 'volume-123',
      name: 'qwen-cache',
      size: 50,
      dataCenter: 'EU-SE-1',
      type: 'STANDARD',
    };
    const localDownloaderTemplate = downloaderTemplate({
      _id: TEMPLATE_ID,
      toObject: () => downloaderTemplate({ _id: TEMPLATE_ID }),
    });
    fixture.runpodService.listNetworkVolumes.mockResolvedValue([providerVolume]);
    fixture.runpodService.createTemplate.mockResolvedValue({ id: 'provider-downloader-template-1' });
    fixture.runpodService.createPod.mockResolvedValue({
      id: 'download-pod-1',
      status: 'PROVISIONING',
      actions: ['stop', 'terminate'],
      cost: 0.55,
      dataCenterId: 'EU-SE-1',
    });
    fixture.templateModel.findOne
      .mockReturnValueOnce(queryResult(null))
      .mockReturnValueOnce(queryResult(downloaderTemplate({ _id: TEMPLATE_ID })));
    fixture.templateModel.findOneAndUpdate.mockResolvedValue(localDownloaderTemplate);
    fixture.networkVolumeModel.findOneAndUpdate.mockResolvedValue({
      _id: VOLUME_RECORD_ID,
      providerNetworkVolumeId: 'volume-123',
      name: 'qwen-cache',
    });
    fixture.podModel.create.mockResolvedValue({
      _id: POD_RECORD_ID,
      providerPodId: 'download-pod-1',
      toObject: () => ({ _id: POD_RECORD_ID, providerPodId: 'download-pod-1' }),
    });
    fixture.manager.scheduleProvisioning = jest.fn();

    await expect(fixture.manager.createModelDownload({
      networkVolumeId: 'volume-123',
      model: 'qwen3.8:27b',
      maxHourlyCost: '1.00',
      autoStopMinutes: '240',
      diskGb: '20',
      publicAccessAcknowledged: 'acknowledged',
    }, { name: 'admin' })).resolves.toEqual(expect.objectContaining({
      providerPodId: 'download-pod-1',
    }));

    expect(fixture.runpodService.createTemplate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'lentmiien-ollama-model-downloader-v2',
      image: 'ollama/ollama:latest',
    }));
    expect(fixture.runpodService.createPod).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'provider-downloader-template-1',
      cloud: 'SECURE',
      gpu: { id: 'NVIDIA GeForce RTX 4090', count: 1 },
      dataCenterIds: ['EU-SE-1'],
      mounts: { network: [{ volumeId: 'volume-123', path: '/workspace' }] },
    }));
    expect(fixture.podModel.create).toHaveBeenCalledWith(expect.objectContaining({
      podPurpose: 'model_download',
      setupModel: 'qwen3.8:27b',
      providerNetworkVolumeId: 'volume-123',
      autoDeleteAfterSetup: true,
      cleanupStatus: 'pending',
      autoStopAt: new Date('2026-09-01T04:00:00.000Z'),
    }));
  });

  test('rejects an unacknowledged model download before provider or template mutation', async () => {
    const fixture = createFixture();

    await expect(fixture.manager.createModelDownload({
      networkVolumeId: 'volume-123',
      model: 'qwen3.8:27b',
    })).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_PUBLIC_ACCESS_NOT_ACKNOWLEDGED',
    }));

    expect(fixture.runpodService.listNetworkVolumes).not.toHaveBeenCalled();
    expect(fixture.runpodService.createTemplate).not.toHaveBeenCalled();
    expect(fixture.runpodService.createPod).not.toHaveBeenCalled();
  });

  test('verifies a downloaded model, records it on the volume, and archives the temporary Pod', async () => {
    const localPod = {
      _id: POD_RECORD_ID,
      providerPodId: 'download-pod-1',
      name: 'download-qwen',
      workloadTemplateId: TEMPLATE_ID,
      providerStatus: 'RUNNING',
      setupStatus: 'pending',
      setupModel: 'qwen3.8:27b',
      podPurpose: 'model_download',
      autoDeleteAfterSetup: true,
      cleanupStatus: 'pending',
      providerNetworkVolumeId: 'volume-123',
      usageTrackingMode: 'observed',
      usageState: 'running',
      usageStateEnteredAt: FIXED_NOW,
      runningMs: 0,
      stoppedMs: 0,
    };
    const fixture = createFixture({
      template: downloaderTemplate(),
      localPod,
    });
    fixture.manager.waitForRunningPod = jest.fn().mockResolvedValue({
      id: 'download-pod-1', status: 'RUNNING', actions: ['stop', 'terminate'],
    });
    fixture.manager.waitForOllama = jest.fn().mockResolvedValue(true);
    fixture.manager.pullOllamaModel = jest.fn().mockResolvedValue(true);
    fixture.manager.verifyOllamaModel = jest.fn().mockResolvedValue(true);

    await expect(fixture.manager._provisionPod(POD_RECORD_ID, { name: 'admin' }))
      .resolves.toBeUndefined();

    expect(fixture.manager.pullOllamaModel).toHaveBeenCalledWith(
      'https://download-pod-1-11434.proxy.runpod.net',
      'qwen3.8:27b',
      { timeoutMs: fixture.manager.modelDownloadTimeoutMs }
    );
    expect(fixture.networkVolumeModel.updateOne).toHaveBeenCalledWith(
      { providerNetworkVolumeId: 'volume-123', archivedAt: null },
      {
        $addToSet: { cachedModels: 'qwen3.8:27b' },
        $set: { modelsUpdatedAt: FIXED_NOW },
      }
    );
    expect(fixture.runpodService.deletePod).toHaveBeenCalledWith('download-pod-1');
    expect(fixture.podModel.updateOne).toHaveBeenCalledWith(
      { _id: POD_RECORD_ID, archivedAt: null },
      { $set: expect.objectContaining({
        setupStatus: 'ready',
        setupCompletedAt: FIXED_NOW,
      }) }
    );
    expect(fixture.podModel.updateOne).toHaveBeenCalledWith(
      { _id: POD_RECORD_ID, archivedAt: null },
      { $set: expect.objectContaining({
        providerStatus: 'TERMINATED',
        lifecycleGroup: 'archived',
        cleanupStatus: 'completed',
        archivedAt: FIXED_NOW,
      }) }
    );
  });

  test('keeps a verified download successful and stops the temporary Pod when cleanup fails', async () => {
    const localPod = {
      _id: POD_RECORD_ID,
      providerPodId: 'download-pod-1',
      name: 'download-qwen',
      workloadTemplateId: TEMPLATE_ID,
      providerStatus: 'RUNNING',
      setupStatus: 'pending',
      setupModel: 'qwen3.8:27b',
      podPurpose: 'model_download',
      autoDeleteAfterSetup: true,
      cleanupStatus: 'pending',
      providerNetworkVolumeId: 'volume-123',
      usageTrackingMode: 'observed',
      usageState: 'running',
      usageStateEnteredAt: FIXED_NOW,
      runningMs: 0,
      stoppedMs: 0,
    };
    const fixture = createFixture({
      template: downloaderTemplate(),
      localPod,
    });
    fixture.manager.waitForRunningPod = jest.fn().mockResolvedValue({
      id: 'download-pod-1', status: 'RUNNING', actions: ['stop', 'terminate'],
    });
    fixture.manager.waitForOllama = jest.fn().mockResolvedValue(true);
    fixture.manager.pullOllamaModel = jest.fn().mockResolvedValue(true);
    fixture.manager.verifyOllamaModel = jest.fn().mockResolvedValue(true);
    fixture.runpodService.deletePod.mockRejectedValue(new RunpodApiError(
      'Runpod could not delete the downloader Pod.',
      { code: 'RUNPOD_HTTP_ERROR', status: 503 }
    ));
    fixture.runpodService.getPod.mockResolvedValue({
      id: 'download-pod-1', status: 'RUNNING', actions: ['stop', 'terminate'],
    });
    fixture.runpodService.transitionPod.mockResolvedValue({
      id: 'download-pod-1', status: 'EXITED', actions: ['start', 'terminate'],
    });

    await expect(fixture.manager._provisionPod(POD_RECORD_ID, { name: 'admin' }))
      .resolves.toBeUndefined();

    expect(fixture.podModel.updateOne).toHaveBeenCalledWith(
      { _id: POD_RECORD_ID, archivedAt: null },
      { $set: expect.objectContaining({
        setupStatus: 'ready',
        setupErrorCode: null,
      }) }
    );
    expect(fixture.podModel.updateOne).toHaveBeenCalledWith(
      { _id: POD_RECORD_ID, archivedAt: null },
      { $set: expect.objectContaining({
        cleanupStatus: 'failed',
        cleanupErrorCode: 'RUNPOD_HTTP_ERROR',
        lastOperationError: expect.objectContaining({
          action: 'delete',
          code: 'RUNPOD_HTTP_ERROR',
          providerStatus: 503,
        }),
      }) }
    );
    expect(fixture.runpodService.transitionPod).toHaveBeenCalledWith(
      'download-pod-1',
      'stop'
    );
    expect(fixture.podModel.updateOne).not.toHaveBeenCalledWith(
      { _id: POD_RECORD_ID, archivedAt: null },
      { $set: expect.objectContaining({ setupStatus: 'failed' }) }
    );
  });

  test('requires explicit public-endpoint acknowledgement before provider work', async () => {
    const fixture = createFixture();

    await expect(fixture.manager.createManagedPod(validCreateInput({
      publicAccessAcknowledged: undefined,
    }))).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_PUBLIC_ACCESS_NOT_ACKNOWLEDGED',
    }));
    expect(fixture.runpodService.listPods).not.toHaveBeenCalled();
    expect(fixture.runpodService.createPod).not.toHaveBeenCalled();
  });

  test('creates a stable Cloudflare gateway Pod without exposing a Runpod HTTP port', async () => {
    const fixture = createFixture({
      template: cloudflareTemplate(),
      managerOptions: {
        fetchImpl: jest.fn()
          .mockResolvedValueOnce(new Response(null, {
            status: 302,
            headers: { Location: 'https://lentmiien.cloudflareaccess.com/cdn-cgi/access/login' },
          }))
          .mockResolvedValueOnce(new Response(null, { status: 502 })),
        cloudflareGatewayUrl: 'https://llm.lentmiien.com',
        cloudflareAccessClientId: 'access-id',
        cloudflareAccessClientSecret: 'access-secret',
        cloudflareTunnelTokenConfigured: true,
      },
    });
    fixture.runpodService.listNetworkVolumes.mockResolvedValue([{
      id: 'volume-123',
      name: 'qwen-cache',
      size: 50,
      dataCenter: 'EU-SE-1',
      type: 'STANDARD',
    }]);
    fixture.networkVolumeModel.findOneAndUpdate.mockResolvedValue({
      _id: VOLUME_RECORD_ID,
      providerNetworkVolumeId: 'volume-123',
      name: 'qwen-cache',
    });
    fixture.runpodService.createPod.mockResolvedValue({
      id: 'gateway-pod-1',
      status: 'PROVISIONING',
      actions: ['stop', 'terminate'],
      cost: 0.55,
      dataCenterId: 'EU-SE-1',
    });
    fixture.podModel.create.mockResolvedValue({
      _id: POD_RECORD_ID,
      providerPodId: 'gateway-pod-1',
      toObject: () => ({ _id: POD_RECORD_ID, providerPodId: 'gateway-pod-1' }),
    });
    fixture.manager.scheduleProvisioning = jest.fn();

    await expect(fixture.manager.createManagedPod(validCreateInput({
      templateId: TEMPLATE_ID,
      networkVolumeId: 'volume-123',
      model: 'qwen3.8:27b',
      dataCenterId: 'EU-SE-1',
      publicAccessAcknowledged: undefined,
    }))).resolves.toEqual(expect.objectContaining({ providerPodId: 'gateway-pod-1' }));

    expect(fixture.runpodService.createPod).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'provider-cloudflare-template-1',
      mounts: { network: [{ volumeId: 'volume-123', path: '/workspace' }] },
      env: {
        OLLAMA_HOST: '127.0.0.1:8080',
        OLLAMA_MODELS: '/workspace/ollama/models',
        TUNNEL_TOKEN: '{{ RUNPOD_SECRET_lentmiien_cloudflare_tunnel_token }}',
      },
    }));
    expect(fixture.podModel.create).toHaveBeenCalledWith(expect.objectContaining({
      accessMode: 'cloudflare_access',
      publicUrl: 'https://llm.lentmiien.com/',
      ports: [],
    }));
  });

  test('prevents two active connectors from sharing the named Cloudflare Tunnel', async () => {
    const fixture = createFixture({
      template: cloudflareTemplate(),
      managerOptions: {
        cloudflareAccessClientId: 'access-id',
        cloudflareAccessClientSecret: 'access-secret',
        cloudflareTunnelTokenConfigured: true,
      },
    });
    fixture.runpodService.listPods.mockResolvedValue([{
      id: 'existing-gateway',
      template: null,
      status: 'RUNNING',
      env: {
        TUNNEL_TOKEN: '{{ RUNPOD_SECRET_lentmiien_cloudflare_tunnel_token }}',
      },
    }]);

    await expect(fixture.manager.createManagedPod(validCreateInput({
      publicAccessAcknowledged: undefined,
    }))).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_GATEWAY_CONNECTOR_CONFLICT',
    }));
    expect(fixture.runpodService.createPod).not.toHaveBeenCalled();
  });

  test('rejects a Cloudflare Access login redirect before creating billable compute', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { Location: 'https://lentmiien.cloudflareaccess.com/cdn-cgi/access/login' },
    }));
    const fixture = createFixture({
      template: cloudflareTemplate(),
      managerOptions: {
        fetchImpl,
        cloudflareAccessClientId: 'access-id',
        cloudflareAccessClientSecret: 'access-secret',
        cloudflareTunnelTokenConfigured: true,
      },
    });

    await expect(fixture.manager.createManagedPod(validCreateInput({
      publicAccessAcknowledged: undefined,
    }))).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_CLOUDFLARE_ACCESS_DENIED',
    }));
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('https://llm.lentmiien.com/api/tags'),
      expect.objectContaining({ redirect: 'manual' })
    );
    expect(fixture.runpodService.createPod).not.toHaveBeenCalled();
  });

  test('rejects an unprotected Cloudflare hostname before creating billable compute', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 502 }));
    const fixture = createFixture({
      template: cloudflareTemplate(),
      managerOptions: {
        fetchImpl,
        cloudflareAccessClientId: 'access-id',
        cloudflareAccessClientSecret: 'access-secret',
        cloudflareTunnelTokenConfigured: true,
      },
    });

    await expect(fixture.manager.createManagedPod(validCreateInput({
      publicAccessAcknowledged: undefined,
    }))).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_CLOUDFLARE_ACCESS_NOT_ENFORCED',
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fixture.runpodService.createPod).not.toHaveBeenCalled();
  });

  test('prevents a stopped gateway Pod from starting beside another tunnel connector', async () => {
    const localPod = {
      _id: POD_RECORD_ID,
      providerPodId: 'stopped-gateway',
      providerTemplateId: 'provider-cloudflare-template-1',
      name: 'stopped-gateway',
      archivedAt: null,
      autoStopMinutes: 60,
      accessMode: 'cloudflare_access',
      setupStatus: 'ready',
    };
    const fixture = createFixture({
      localPod,
      managerOptions: {
        cloudflareAccessClientId: 'access-id',
        cloudflareAccessClientSecret: 'access-secret',
        cloudflareTunnelTokenConfigured: true,
      },
    });
    fixture.runpodService.listPods.mockResolvedValue([{
      id: 'running-gateway',
      template: null,
      status: 'RUNNING',
      env: {
        TUNNEL_TOKEN: '{{ RUNPOD_SECRET_lentmiien_cloudflare_tunnel_token }}',
      },
    }]);

    await expect(fixture.manager.transitionManagedPod(
      POD_RECORD_ID,
      'start',
      { name: 'admin' },
      { runMinutes: '60' }
    )).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_GATEWAY_CONNECTOR_CONFLICT',
    }));
    expect(fixture.runpodService.getPod).not.toHaveBeenCalled();
    expect(fixture.runpodService.transitionPod).not.toHaveBeenCalled();
  });

  test('enforces the provider-wide active Pod ceiling before creation', async () => {
    const fixture = createFixture();
    fixture.manager.maxActivePods = 1;
    fixture.runpodService.listPods.mockResolvedValue([{ id: 'existing', status: 'RUNNING' }]);

    await expect(fixture.manager.createManagedPod(validCreateInput())).rejects.toEqual(
      expect.objectContaining({ code: 'RUNPOD_ACTIVE_POD_LIMIT' })
    );
    expect(fixture.runpodService.createPod).not.toHaveBeenCalled();
  });

  test('creates one bounded provider Pod and records local auto-stop state', async () => {
    const fixture = createFixture();
    fixture.runpodService.createPod.mockResolvedValue({
      id: 'pod-123',
      status: 'PROVISIONING',
      actions: ['stop', 'terminate'],
      cost: 0.55,
      dataCenterId: 'EU-SE-1',
    });
    const createdDocument = {
      _id: POD_RECORD_ID,
      providerPodId: 'pod-123',
      toObject: jest.fn(() => ({ _id: POD_RECORD_ID, providerPodId: 'pod-123' })),
    };
    fixture.podModel.create.mockResolvedValue(createdDocument);
    fixture.manager.scheduleProvisioning = jest.fn();

    const pod = await fixture.manager.createManagedPod(validCreateInput({ dataCenterId: 'EU-SE-1' }), {
      name: 'admin',
    });

    expect(fixture.runpodService.createPod).toHaveBeenCalledWith({
      name: 'ollama-test',
      templateId: 'provider-template-1',
      cloud: 'SECURE',
      gpu: { id: 'NVIDIA GeForce RTX 4090', count: 1 },
      disk: 20,
      mounts: { persistent: { size: 10, path: '/root/.ollama' } },
      globalNetworking: false,
      dataCenterIds: ['EU-SE-1'],
    });
    expect(fixture.podModel.create).toHaveBeenCalledWith(expect.objectContaining({
      providerPodId: 'pod-123',
      publicUrl: 'https://pod-123-11434.proxy.runpod.net',
      autoStopAt: new Date('2026-09-01T01:00:00.000Z'),
      estimatedCostPerHour: 0.5,
      providerCostPerHour: 0.55,
      usageTrackingMode: 'observed',
      usageState: 'running',
      usageTrackedSinceAt: FIXED_NOW,
    }));
    expect(fixture.manager.scheduleProvisioning).toHaveBeenCalledWith(POD_RECORD_ID, expect.objectContaining({
      name: 'admin',
    }));
    expect(pod.providerPodId).toBe('pod-123');
  });

  test('attaches an available regional volume and moves Ollama model storage under its mount', async () => {
    const fixture = createFixture();
    const providerVolume = {
      id: 'volume-123',
      name: 'ollama-model-cache',
      size: 50,
      dataCenter: 'EU-SE-1',
      type: 'STANDARD',
    };
    const trackedVolume = {
      _id: '507f191e810c19729de860ab',
      providerNetworkVolumeId: providerVolume.id,
      name: providerVolume.name,
    };
    fixture.runpodService.listNetworkVolumes.mockResolvedValue([providerVolume]);
    fixture.networkVolumeModel.findOneAndUpdate.mockResolvedValue(trackedVolume);
    fixture.runpodService.createPod.mockResolvedValue({
      id: 'pod-volume',
      status: 'PROVISIONING',
      actions: ['stop', 'terminate'],
      cost: 0.55,
      dataCenterId: 'EU-SE-1',
      mounts: { network: [{ volumeId: 'volume-123', path: '/workspace' }] },
    });
    fixture.podModel.create.mockResolvedValue({
      _id: POD_RECORD_ID,
      providerPodId: 'pod-volume',
      toObject: () => ({ _id: POD_RECORD_ID, providerPodId: 'pod-volume' }),
    });
    fixture.manager.scheduleProvisioning = jest.fn();

    await fixture.manager.createManagedPod(validCreateInput({
      networkVolumeId: 'volume-123',
      dataCenterId: 'EU-SE-1',
      persistentDiskGb: '',
    }), { name: 'admin' });

    expect(fixture.runpodService.createPod).toHaveBeenCalledWith(expect.objectContaining({
      cloud: 'SECURE',
      dataCenterIds: ['EU-SE-1'],
      mounts: { network: [{ volumeId: 'volume-123', path: '/workspace' }] },
      env: {
        OLLAMA_HOST: '0.0.0.0:11434',
        OLLAMA_MODELS: '/workspace/ollama/models',
      },
    }));
    expect(fixture.podModel.create).toHaveBeenCalledWith(expect.objectContaining({
      providerNetworkVolumeId: 'volume-123',
      networkVolumeName: 'ollama-model-cache',
      networkVolumeMountPath: '/workspace',
      persistentDiskGb: null,
    }));
  });

  test('does not attach one writable volume to two provider Pods', async () => {
    const fixture = createFixture();
    fixture.runpodService.listPods.mockResolvedValue([{
      id: 'old-pod',
      status: 'EXITED',
      mounts: { network: [{ volumeId: 'volume-123', path: '/workspace' }] },
    }]);
    fixture.runpodService.listNetworkVolumes.mockResolvedValue([{
      id: 'volume-123',
      name: 'ollama-model-cache',
      size: 50,
      dataCenter: 'EU-SE-1',
      type: 'STANDARD',
    }]);

    await expect(fixture.manager.createManagedPod(validCreateInput({
      networkVolumeId: 'volume-123',
      dataCenterId: 'EU-SE-1',
    }))).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_NETWORK_VOLUME_IN_USE',
    }));
    expect(fixture.runpodService.createPod).not.toHaveBeenCalled();
  });

  test('immediately cleans up a Pod when Runpod returns a rate above the confirmed limit', async () => {
    const fixture = createFixture();
    fixture.runpodService.createPod.mockResolvedValue({
      id: 'pod-costly',
      status: 'PROVISIONING',
      actions: ['stop', 'terminate'],
      cost: 0.8,
    });

    await expect(fixture.manager.createManagedPod(validCreateInput({
      maxHourlyCost: '0.60',
    }))).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_COST_LIMIT_EXCEEDED',
    }));
    expect(fixture.runpodService.deletePod).toHaveBeenCalledWith('pod-costly');
    expect(fixture.podModel.create).not.toHaveBeenCalled();
  });

  test('reports an actionable error if creation cleanup cannot delete the provider Pod', async () => {
    const fixture = createFixture();
    fixture.runpodService.createPod.mockResolvedValue({
      id: 'pod-costly', status: 'PROVISIONING', cost: 0.8,
    });
    fixture.runpodService.deletePod.mockRejectedValue(Object.assign(new Error('provider details'), {
      code: 'RUNPOD_NETWORK_ERROR',
    }));

    await expect(fixture.manager.createManagedPod(validCreateInput({
      maxHourlyCost: '0.60',
    }))).rejects.toEqual(expect.objectContaining({ code: 'RUNPOD_COST_LIMIT_EXCEEDED' }));

    expect(fixture.appLogger.error).toHaveBeenCalledWith(
      'Failed to delete an unpersisted Runpod pod after creation failure',
      {
        category: 'runpod_management',
        metadata: {
          action: 'create_cleanup',
          errorCode: 'RUNPOD_NETWORK_ERROR',
          providerStatus: null,
        },
      }
    );
  });

  test('fails closed by stopping a started Pod when its auto-stop state cannot be persisted', async () => {
    const localPod = {
      _id: POD_RECORD_ID,
      providerPodId: 'pod-123',
      name: 'ollama-test',
      archivedAt: null,
      autoStopMinutes: 60,
      setupStatus: 'ready',
    };
    const fixture = createFixture({ localPod });
    fixture.runpodService.getPod.mockResolvedValue({
      id: 'pod-123', status: 'EXITED', actions: ['start', 'terminate'],
    });
    fixture.runpodService.transitionPod
      .mockResolvedValueOnce({ id: 'pod-123', status: 'STARTING', actions: ['stop', 'terminate'] })
      .mockResolvedValueOnce({ id: 'pod-123', status: 'EXITED', actions: ['start', 'terminate'] });
    fixture.podModel.updateOne.mockRejectedValue(new Error('database unavailable'));

    await expect(fixture.manager.transitionManagedPod(POD_RECORD_ID, 'start', {
      name: 'admin',
    })).rejects.toThrow('database unavailable');

    expect(fixture.runpodService.transitionPod.mock.calls).toEqual([
      ['pod-123', 'start'],
      ['pod-123', 'stop'],
    ]);
  });

  test('starts a stopped Pod for the selected bounded duration and replaces the old deadline', async () => {
    const localPod = {
      _id: POD_RECORD_ID,
      providerPodId: 'pod-123',
      name: 'ollama-test',
      archivedAt: null,
      autoStopMinutes: 60,
      autoStopAt: null,
      setupStatus: 'ready',
    };
    const fixture = createFixture({ localPod });
    fixture.runpodService.getPod.mockResolvedValue({
      id: 'pod-123', status: 'EXITED', actions: ['start', 'terminate'],
    });
    fixture.runpodService.transitionPod.mockResolvedValue({
      id: 'pod-123', status: 'STARTING', actions: ['stop', 'terminate'],
    });

    await fixture.manager.transitionManagedPod(
      POD_RECORD_ID,
      'start',
      { name: 'admin' },
      { runMinutes: '240' }
    );

    expect(fixture.podModel.updateOne).toHaveBeenCalledWith(
      { _id: POD_RECORD_ID, archivedAt: null },
      { $set: expect.objectContaining({
        autoStopMinutes: 240,
        autoStopAt: new Date('2026-09-01T04:00:00.000Z'),
        lastOperationError: null,
      }) }
    );
  });

  test('rejects invalid start and extension durations before provider work', async () => {
    const localPod = {
      _id: POD_RECORD_ID,
      providerPodId: 'pod-123',
      name: 'ollama-test',
      archivedAt: null,
      autoStopMinutes: 60,
    };
    const fixture = createFixture({ localPod });

    await expect(fixture.manager.transitionManagedPod(
      POD_RECORD_ID,
      'start',
      { name: 'admin' },
      { runMinutes: '0' }
    )).rejects.toEqual(expect.objectContaining({ code: 'RUNPOD_INPUT_INVALID' }));
    await expect(fixture.manager.extendManagedPod(
      POD_RECORD_ID,
      { extensionMinutes: 'unbounded' },
      { name: 'admin' }
    )).rejects.toEqual(expect.objectContaining({ code: 'RUNPOD_INPUT_INVALID' }));
    expect(fixture.runpodService.getPod).not.toHaveBeenCalled();
  });

  test('reports unavailable original GPU details beside a Pod after a rejected start', async () => {
    const localPod = {
      _id: POD_RECORD_ID,
      providerPodId: 'pod-123',
      name: 'ollama-test',
      archivedAt: null,
      autoStopMinutes: 60,
      setupStatus: 'ready',
    };
    const fixture = createFixture({ localPod });
    fixture.runpodService.getPod.mockResolvedValue({
      id: 'pod-123', status: 'EXITED', actions: ['start', 'terminate'],
    });
    fixture.runpodService.transitionPod.mockRejectedValue(new RunpodApiError(
      'Runpod could not load pod start (HTTP 409).',
      {
        code: 'RUNPOD_HTTP_ERROR',
        status: 409,
        providerCode: 'ZERO_GPUS',
        providerTitle: 'No GPU available',
        providerDetail: 'The original machine has zero GPUs available.',
      }
    ));

    await expect(fixture.manager.transitionManagedPod(
      POD_RECORD_ID,
      'start',
      { name: 'admin' },
      { runMinutes: '60' }
    )).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_START_GPU_UNAVAILABLE',
      providerStatus: 409,
      providerCode: 'ZERO_GPUS',
    }));

    expect(fixture.podModel.updateOne).toHaveBeenCalledWith(
      { _id: POD_RECORD_ID, archivedAt: null },
      { $set: expect.objectContaining({
        lastOperationError: expect.objectContaining({
          action: 'start',
          code: 'RUNPOD_START_GPU_UNAVAILABLE',
          providerStatus: 409,
          providerCode: 'ZERO_GPUS',
          detail: 'The original machine has zero GPUs available.',
        }),
      }) }
    );
  });

  test('extends a running Pod deadline without issuing another provider lifecycle mutation', async () => {
    const localPod = {
      _id: POD_RECORD_ID,
      providerPodId: 'pod-123',
      name: 'ollama-test',
      archivedAt: null,
      providerStatus: 'RUNNING',
      lifecycleGroup: 'running',
      autoStopAt: new Date('2026-09-01T01:00:00.000Z'),
    };
    const fixture = createFixture({ localPod });
    fixture.runpodService.getPod.mockResolvedValue({
      id: 'pod-123', status: 'RUNNING', actions: ['stop', 'terminate'],
    });

    await expect(fixture.manager.extendManagedPod(
      POD_RECORD_ID,
      { extensionMinutes: '60' },
      { name: 'admin' }
    )).resolves.toEqual({
      autoStopAt: new Date('2026-09-01T02:00:00.000Z'),
      extensionMinutes: 60,
    });

    expect(fixture.runpodService.transitionPod).not.toHaveBeenCalled();
    expect(fixture.podModel.updateOne).toHaveBeenCalledWith(
      {
        _id: POD_RECORD_ID,
        archivedAt: null,
        autoStopAt: new Date('2026-09-01T01:00:00.000Z'),
        $or: [
          { autoStopClaimedAt: null },
          { autoStopClaimedAt: { $lte: new Date('2026-08-31T23:55:00.000Z') } },
        ],
      },
      { $set: expect.objectContaining({
        autoStopAt: new Date('2026-09-01T02:00:00.000Z'),
        autoStopClaimedAt: null,
        lastOperationError: null,
      }) }
    );
    expect(fixture.eventModel.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'extend', outcome: 'succeeded',
    }));
  });

  test('rejects an extension that would exceed the maximum unattended window', async () => {
    const localPod = {
      _id: POD_RECORD_ID,
      providerPodId: 'pod-123',
      name: 'ollama-test',
      archivedAt: null,
      providerStatus: 'RUNNING',
      lifecycleGroup: 'running',
      autoStopAt: new Date('2026-09-01T23:30:00.000Z'),
    };
    const fixture = createFixture({ localPod });
    fixture.runpodService.getPod.mockResolvedValue({
      id: 'pod-123', status: 'RUNNING', actions: ['stop', 'terminate'],
    });

    await expect(fixture.manager.extendManagedPod(
      POD_RECORD_ID,
      { extensionMinutes: '60' },
      { name: 'admin' }
    )).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_RUNTIME_LIMIT_EXCEEDED',
    }));
    expect(fixture.runpodService.transitionPod).not.toHaveBeenCalled();
  });

  test('requires exact-name deletion confirmation and archives only after provider deletion', async () => {
    const localPod = {
      _id: POD_RECORD_ID,
      providerPodId: 'pod-123',
      name: 'ollama-test',
      archivedAt: null,
    };
    const fixture = createFixture({ localPod });

    await expect(fixture.manager.deleteManagedPod(POD_RECORD_ID, 'wrong-name')).rejects.toEqual(
      expect.objectContaining({ code: 'RUNPOD_DELETE_CONFIRMATION_REQUIRED' })
    );
    expect(fixture.runpodService.deletePod).not.toHaveBeenCalled();

    await expect(fixture.manager.deleteManagedPod(POD_RECORD_ID, 'ollama-test', {
      name: 'admin',
    })).resolves.toBe(true);
    expect(fixture.runpodService.deletePod).toHaveBeenCalledWith('pod-123');
    expect(fixture.podModel.updateOne).toHaveBeenCalledWith(
      { _id: POD_RECORD_ID, archivedAt: null },
      { $set: expect.objectContaining({
        providerStatus: 'TERMINATED',
        lifecycleGroup: 'archived',
        archivedAt: FIXED_NOW,
        autoStopAt: null,
      }) }
    );
  });

  test('auto-stop reconciles a Pod that the provider already stopped', async () => {
    const fixture = createFixture();
    fixture.podModel.find.mockReturnValue(queryResult([{
      _id: POD_RECORD_ID,
      providerPodId: 'pod-123',
      lifecycleGroup: 'running',
      autoStopAt: new Date('2026-08-31T23:59:00.000Z'),
    }]));
    fixture.runpodService.getPod.mockResolvedValue({
      id: 'pod-123', status: 'EXITED', actions: ['start', 'terminate'],
    });

    await expect(fixture.manager.stopExpiredPods()).resolves.toBe(0);

    expect(fixture.runpodService.transitionPod).not.toHaveBeenCalled();
    expect(fixture.podModel.updateOne).toHaveBeenCalledWith(
      { _id: POD_RECORD_ID, archivedAt: null },
      { $set: expect.objectContaining({ lifecycleGroup: 'stopped', autoStopAt: null }) }
    );
  });

  test('does not stop a Pod when an extension won the automatic-stop deadline race', async () => {
    const fixture = createFixture();
    fixture.podModel.find.mockReturnValue(queryResult([{
      _id: POD_RECORD_ID,
      providerPodId: 'pod-123',
      lifecycleGroup: 'running',
      autoStopAt: new Date('2026-08-31T23:59:00.000Z'),
    }]));
    fixture.podModel.updateOne.mockResolvedValueOnce({ matchedCount: 0 });

    await expect(fixture.manager.stopExpiredPods()).resolves.toBe(0);

    expect(fixture.runpodService.getPod).not.toHaveBeenCalled();
    expect(fixture.runpodService.transitionPod).not.toHaveBeenCalled();
  });

  test('uses bounded, non-redirecting requests only against a canonical Runpod Ollama proxy', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: jest.fn().mockReturnValue('application/json') },
      text: jest.fn().mockResolvedValue(JSON.stringify({
        models: [{ name: OLLAMA_MODEL }],
      })),
    });
    const fixture = createFixture();
    fixture.manager.fetch = fetchImpl;
    const baseUrl = publicOllamaUrl('pod-123');

    await expect(fixture.manager.verifyOllamaModel(baseUrl, OLLAMA_MODEL)).resolves.toBe(true);

    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(`${baseUrl}/api/tags`);
    expect(options).toEqual(expect.objectContaining({ method: 'GET', redirect: 'error' }));
    await expect(fixture.manager.ollamaRequest(
      'https://example.com/',
      '/api/tags'
    )).rejects.toEqual(expect.objectContaining({ code: 'OLLAMA_URL_INVALID' }));
  });

  test('authenticates exact-host gateway requests with Cloudflare Access headers', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      models: [{ name: 'qwen3.8:27b' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const fixture = createFixture({
      managerOptions: {
        fetchImpl,
        cloudflareGatewayUrl: 'https://llm.lentmiien.com',
        cloudflareAccessClientId: 'access-id',
        cloudflareAccessClientSecret: 'access-secret',
        cloudflareTunnelTokenConfigured: true,
      },
    });

    await expect(fixture.manager.verifyOllamaModel(
      'https://llm.lentmiien.com/',
      'qwen3.8:27b',
      { accessMode: 'cloudflare_access' }
    )).resolves.toBe(true);

    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://llm.lentmiien.com/api/tags');
    expect(options.headers).toEqual(expect.objectContaining({
      'CF-Access-Client-Id': 'access-id',
      'CF-Access-Client-Secret': 'access-secret',
    }));
    await expect(fixture.manager.ollamaRequest(
      'https://llm.lentmiien.com.attacker.test/',
      '/api/tags',
      { accessMode: 'cloudflare_access' }
    )).rejects.toEqual(expect.objectContaining({ code: 'OLLAMA_URL_INVALID' }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('fails gateway readiness immediately when Ollama rejects the origin Host header', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 403 }));
    const fixture = createFixture({
      managerOptions: {
        fetchImpl,
        cloudflareGatewayUrl: 'https://llm.lentmiien.com',
        cloudflareAccessClientId: 'access-id',
        cloudflareAccessClientSecret: 'access-secret',
        cloudflareTunnelTokenConfigured: true,
      },
    });

    await expect(fixture.manager.waitForOllama(
      'https://llm.lentmiien.com/',
      { accessMode: 'cloudflare_access' }
    )).rejects.toEqual(expect.objectContaining({
      code: 'OLLAMA_GATEWAY_FORBIDDEN',
      providerStatus: 403,
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('streams Ollama model-pull progress so large downloads do not wait silently behind the proxy', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response([
      JSON.stringify({ status: 'pulling manifest' }),
      JSON.stringify({ status: 'downloading', digest: 'sha256:test', total: 18_000_000_000, completed: 1 }),
      JSON.stringify({ status: 'success' }),
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
    }));
    const fixture = createFixture();
    fixture.manager.fetch = fetchImpl;

    await expect(fixture.manager.pullOllamaModel(
      publicOllamaUrl('pod-123'),
      'qwen3.8:27b'
    )).resolves.toBe(true);

    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(`${publicOllamaUrl('pod-123')}/api/pull`);
    expect(JSON.parse(options.body)).toEqual({ model: 'qwen3.8:27b', stream: true });
  });

  test('resumes a model pull after a transient Runpod proxy timeout', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(new Response('A timeout occurred', {
        status: 524,
        headers: { 'Content-Type': 'text/plain' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(`${JSON.stringify({ status: 'success' })}\n`, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      }));
    const fixture = createFixture();
    fixture.manager.fetch = fetchImpl;

    await expect(fixture.manager.pullOllamaModel(
      publicOllamaUrl('pod-123'),
      'qwen3.8:27b'
    )).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(new URL(fetchImpl.mock.calls[0][0]).pathname).toBe('/api/pull');
    expect(new URL(fetchImpl.mock.calls[1][0]).pathname).toBe('/api/tags');
    expect(new URL(fetchImpl.mock.calls[2][0]).pathname).toBe('/api/pull');
  });

  test('preserves an actionable model-not-found error and the actual Ollama HTTP status', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'pull model manifest: file does not exist',
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }));
    const fixture = createFixture();
    fixture.manager.fetch = fetchImpl;

    await expect(fixture.manager.pullOllamaModel(
      publicOllamaUrl('pod-123'),
      'missing:27b'
    )).rejects.toEqual(expect.objectContaining({
      code: 'OLLAMA_MODEL_NOT_FOUND',
      providerStatus: 404,
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
