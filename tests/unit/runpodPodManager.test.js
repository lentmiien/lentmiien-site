const {
  OLLAMA_MODEL,
  RunpodManagementError,
  RunpodPodManager,
  mergeGpuCatalogs,
  normalizeModelName,
  normalizeTemplateInput,
  projectPodUsage,
  providerTemplatePayload,
  publicOllamaUrl,
  usageFieldsForObservation,
  validatedOllamaBaseUrl,
} = require('../../services/runpodPodManager');

const TEMPLATE_ID = '507f1f77bcf86cd799439011';
const POD_RECORD_ID = '507f191e810c19729de860ea';
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

function createFixture({ template = ollamaTemplate(), localPod = null } = {}) {
  const runpodService = {
    listPods: jest.fn().mockResolvedValue([]),
    getPod: jest.fn(),
    createPod: jest.fn(),
    transitionPod: jest.fn(),
    deletePod: jest.fn().mockResolvedValue(true),
    getAccountTemplates: jest.fn().mockResolvedValue([]),
    createTemplate: jest.fn(),
    updateTemplate: jest.fn(),
    getGpuTypes: jest.fn().mockResolvedValue([gpu()]),
    getDataCenters: jest.fn().mockResolvedValue([{ id: 'EU-SE-1', globalNetwork: true }]),
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
  const eventModel = { create: jest.fn().mockResolvedValue({}) };
  const appLogger = { warning: jest.fn(), error: jest.fn() };
  const manager = new RunpodPodManager({
    runpodService,
    podModel,
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
  });
  return { appLogger, eventModel, manager, podModel, runpodService, templateModel };
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
});
