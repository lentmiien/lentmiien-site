const {
  EXECUTE_FLAG,
  choosePreparationGpu,
  main,
  preparationSignal,
  waitForPreparation,
} = require('../../scripts/prepare-runpod-glm53-artifact-v2');

function gpu(overrides = {}) {
  return {
    id: 'NVIDIA RTX PRO 4500 Blackwell',
    name: 'RTX PRO 4500',
    availability: 'HIGH',
    price: { secure: 0.72 },
    maxCount: { secure: 8 },
    dataCenters: [{ id: 'EU-RO-1', availability: 'HIGH' }],
    ...overrides,
  };
}

describe('Runpod GLM-5.3 artifact preparation script', () => {
  test('is dry-run-only unless execute is explicit', async () => {
    const service = { listPods: jest.fn() };
    const lines = [];

    await expect(main({
      argv: [],
      service,
      stdout: (line) => lines.push(line),
      stderr: jest.fn(),
    })).resolves.toBe(0);

    expect(service.listPods).not.toHaveBeenCalled();
    expect(lines.join(' ')).toContain('Dry run only');
    expect(lines.join(' ')).toContain('156822111075');
  });

  test('selects only an available same-location GPU below the hard one-dollar ceiling', () => {
    const selected = choosePreparationGpu([
      gpu({ id: 'expensive', price: { secure: 1.2 } }),
      gpu({ id: 'wrong-location', dataCenters: [{ id: 'US-TX-3', availability: 'HIGH' }] }),
      gpu({ id: 'cheap', price: { secure: 0.5 } }),
    ], 'EU-RO-1', 0.99);

    expect(selected.id).toBe('cheap');
    expect(choosePreparationGpu([gpu()], 'EU-RO-1', 0.99, 'missing')).toBeNull();
  });

  test('extracts only fixed readiness, stage, and safe failure signals from logs', () => {
    expect(preparationSignal([
      { line: 'arbitrary provider text' },
      { line: 'RUNPOD_ARTIFACT_STAGE stage=downloading_model total_bytes=1' },
    ])).toEqual({ status: 'preparing', stage: 'downloading_model' });
    expect(preparationSignal([{ line: 'RUNPOD_ARTIFACT_READY slug=x' }]))
      .toEqual({ status: 'ready', stage: 'ready' });
    expect(preparationSignal([{
      line: 'RUNPOD_ARTIFACT_FAILED code=PREPARATION_ALREADY_RUNNING secret=value',
    }])).toEqual({
      status: 'failed', stage: 'failed', code: 'PREPARATION_ALREADY_RUNNING',
    });
    expect(preparationSignal([
      { line: 'httpx.TimeoutException: request timed out' },
      { line: 'RUNPOD_ARTIFACT_FAILED code=HF_DOWNLOAD_FAILED shard=2' },
    ])).toEqual({
      status: 'failed', stage: 'failed', code: 'HF_DOWNLOAD_TIMEOUT',
    });
    expect(preparationSignal([
      { line: 'OSError: [Errno 28] No space left on device' },
      { line: 'RUNPOD_ARTIFACT_FAILED code=HF_DOWNLOAD_FAILED shard=3' },
    ])).toEqual({
      status: 'failed', stage: 'failed', code: 'RUNPOD_ARTIFACT_VOLUME_FULL',
    });
  });

  test('does not regress the reported stage when a provider log snapshot is empty', async () => {
    const service = {
      getPod: jest.fn().mockResolvedValue({ status: 'RUNNING' }),
      getPodLogSnapshot: jest.fn()
        .mockResolvedValueOnce({ events: [{ line: 'RUNPOD_ARTIFACT_STAGE stage=downloading_model' }] })
        .mockResolvedValueOnce({ events: [] })
        .mockResolvedValueOnce({ events: [{ line: 'RUNPOD_ARTIFACT_READY slug=x' }] }),
    };
    const stages = [];

    await expect(waitForPreparation(service, 'pod-1', {}, {
      timeoutMs: 1_000,
      pollIntervalMs: 0,
      sleepImpl: jest.fn().mockResolvedValue(),
      onStage: (stage) => stages.push(stage),
    })).resolves.toEqual(expect.objectContaining({
      signal: { status: 'ready', stage: 'ready' },
    }));

    expect(stages).toEqual(['downloading_model', 'ready']);
  });

  test('refuses an undersized volume before creating a template or Pod', async () => {
    const service = {
      listPods: jest.fn().mockResolvedValue([]),
      listNetworkVolumes: jest.fn().mockResolvedValue([{
        id: 'small-volume', name: 'glm-5-3-flash-ud-iq4-xs', size: 100, dataCenter: 'EU-RO-1',
      }]),
      getGpuTypes: jest.fn().mockResolvedValue([gpu()]),
      getAccountTemplates: jest.fn(),
      createPod: jest.fn(),
    };
    const errors = [];

    await expect(main({
      argv: [EXECUTE_FLAG],
      service,
      stdout: jest.fn(),
      stderr: (line) => errors.push(line),
    })).resolves.toBe(1);

    expect(service.getAccountTemplates).not.toHaveBeenCalled();
    expect(service.createPod).not.toHaveBeenCalled();
    expect(errors).toEqual([
      'Runpod artifact preparation failed: RUNPOD_ARTIFACT_VOLUME_TOO_SMALL',
    ]);
  });
});
