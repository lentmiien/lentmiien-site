const {
  MAX_TEST_HOURLY_COST_USD,
  chooseGpu,
  main,
  waitForDeletion,
  waitForStatus,
} = require('../../scripts/test-runpod-pod-lifecycle-v2');

function responseGpu(overrides = {}) {
  return {
    id: 'NVIDIA GeForce RTX 4090',
    name: 'RTX 4090',
    memory: 24,
    availability: 'HIGH',
    price: { secure: 0.69 },
    maxCount: { secure: 1 },
    ...overrides,
  };
}

describe('standalone Runpod Pod lifecycle script', () => {
  test('is a no-op unless the explicit execute flag is present', async () => {
    const service = { listPods: jest.fn() };
    const stdout = jest.fn();

    await expect(main({ argv: [], service, stdout, stderr: jest.fn() })).resolves.toBe(0);

    expect(service.listPods).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledWith('Dry run only. No Runpod resource was changed.');
  });

  test('prefers availability, enforces one GPU, and stays below one dollar per hour', () => {
    const selected = chooseGpu([
      responseGpu({
        id: 'NVIDIA RTX A4500',
        name: 'RTX A4500',
        availability: 'LOW',
        price: { secure: 0.2 },
      }),
      responseGpu(),
      responseGpu({
        id: 'NVIDIA RTX A5000',
        availability: 'HIGH',
        price: { secure: MAX_TEST_HOURLY_COST_USD },
      }),
    ]);

    expect(selected.id).toBe('NVIDIA GeForce RTX 4090');
    expect(selected.price.secure).toBeLessThan(MAX_TEST_HOURLY_COST_USD);
  });

  test('runs create, Ollama setup, stop, start, persistence check, and verified deletion', async () => {
    const statusQueue = ['RUNNING', 'EXITED', 'RUNNING'];
    const service = {
      listPods: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      getGpuTypes: jest.fn().mockResolvedValue([responseGpu()]),
      getAccountTemplates: jest.fn().mockResolvedValue([{ id: 'template-1', name: 'lentmiien-ollama-gpu-v2' }]),
      updateTemplate: jest.fn().mockResolvedValue({ id: 'template-1' }),
      createTemplate: jest.fn(),
      createPod: jest.fn().mockResolvedValue({ id: 'pod-1', cost: 0.69 }),
      getPod: jest.fn().mockImplementation(() => Promise.resolve({
        id: 'pod-1', status: statusQueue.shift(),
      })),
      transitionPod: jest.fn().mockResolvedValue({ id: 'pod-1' }),
      deletePod: jest.fn().mockResolvedValue(true),
    };
    const manager = {
      waitForOllama: jest.fn().mockResolvedValue(true),
      pullOllamaModel: jest.fn().mockResolvedValue(true),
      verifyOllamaModel: jest.fn().mockResolvedValue(true),
    };
    const managerFactory = jest.fn().mockReturnValue(manager);
    const stdout = jest.fn();

    await expect(main({
      argv: ['--execute'],
      service,
      managerFactory,
      stdout,
      stderr: jest.fn(),
      sleepImpl: jest.fn().mockResolvedValue(),
    })).resolves.toBe(0);

    expect(service.createPod).toHaveBeenCalledWith(expect.objectContaining({
      cloud: 'SECURE',
      gpu: { id: 'NVIDIA GeForce RTX 4090', count: 1 },
    }));
    expect(service.transitionPod.mock.calls).toEqual([
      ['pod-1', 'stop'],
      ['pod-1', 'start'],
    ]);
    expect(manager.pullOllamaModel).toHaveBeenCalledWith(
      'https://pod-1-11434.proxy.runpod.net',
      'qwen2.5:0.5b'
    );
    expect(manager.verifyOllamaModel).toHaveBeenCalledTimes(2);
    expect(service.deletePod).toHaveBeenCalledWith('pod-1');
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Delete verified'));
  });

  test('cleans up the created Pod after a setup failure and returns a safe error code', async () => {
    const secret = 'provider-token-secret';
    const service = {
      listPods: jest.fn().mockResolvedValue([]),
      getGpuTypes: jest.fn().mockResolvedValue([responseGpu()]),
      getAccountTemplates: jest.fn().mockResolvedValue([]),
      createTemplate: jest.fn().mockResolvedValue({ id: 'template-1' }),
      updateTemplate: jest.fn(),
      createPod: jest.fn().mockResolvedValue({ id: 'pod-1', cost: 0.69 }),
      getPod: jest.fn().mockRejectedValue(Object.assign(new Error(secret), {
        code: 'RUNPOD_NETWORK_ERROR',
      })),
      deletePod: jest.fn().mockResolvedValue(true),
    };
    const stderr = jest.fn();

    await expect(main({
      argv: ['--execute'],
      service,
      stdout: jest.fn(),
      stderr,
      sleepImpl: jest.fn().mockResolvedValue(),
    })).resolves.toBe(1);

    expect(service.deletePod).toHaveBeenCalledWith('pod-1');
    expect(JSON.stringify(stderr.mock.calls)).not.toContain(secret);
    expect(stderr).toHaveBeenCalledWith('Runpod Pod lifecycle test failed: RUNPOD_NETWORK_ERROR');
  });

  test('bounded status and deletion pollers stop as soon as provider state matches', async () => {
    const service = {
      getPod: jest.fn().mockResolvedValue({ id: 'pod-1', status: 'RUNNING' }),
      listPods: jest.fn().mockResolvedValue([]),
    };

    await expect(waitForStatus(service, 'pod-1', 'RUNNING')).resolves.toEqual(
      expect.objectContaining({ status: 'RUNNING' })
    );
    await expect(waitForDeletion(service, 'pod-1')).resolves.toBe(true);
  });
});
