const {
  EXECUTE_FLAG,
  TEST_MODEL,
  choosePlacement,
  main,
} = require('../../scripts/test-runpod-network-volume-v2');

function gpu(overrides = {}) {
  return {
    id: 'NVIDIA GeForce RTX 4090',
    name: 'RTX 4090',
    availability: 'HIGH',
    price: { secure: 0.74 },
    maxCount: { secure: 1 },
    dataCenters: [{ id: 'EU-RO-1', availability: 'MEDIUM' }],
    ...overrides,
  };
}

describe('Runpod network-volume live test script', () => {
  test('selects a sub-$1 GPU only where Standard network storage is offered', () => {
    expect(choosePlacement([gpu()], [{
      id: 'EU-RO-1', networkVolumeTypes: ['STANDARD'],
    }])).toEqual(expect.objectContaining({
      dataCenterId: 'EU-RO-1',
      gpu: expect.objectContaining({ id: 'NVIDIA GeForce RTX 4090' }),
    }));
    expect(choosePlacement([gpu()], [{
      id: 'EU-RO-1', networkVolumeTypes: ['HIGH_PERFORMANCE'],
    }])).toBeNull();
    expect(choosePlacement([gpu({ price: { secure: 1 } })], [{
      id: 'EU-RO-1', networkVolumeTypes: ['STANDARD'],
    }])).toBeNull();
  });

  test('is non-mutating unless execute is explicitly supplied', async () => {
    const stdout = jest.fn();
    const service = { createPod: jest.fn(), createNetworkVolume: jest.fn() };

    await expect(main({ argv: [], service, stdout })).resolves.toBe(0);

    expect(service.createPod).not.toHaveBeenCalled();
    expect(service.createNetworkVolume).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Dry run only'));
  });

  test('uses two sequential Pods, verifies reuse without a second pull, and removes the test volume', async () => {
    const service = {
      listPods: jest.fn().mockResolvedValue([]),
      getGpuTypes: jest.fn().mockResolvedValue([gpu()]),
      getDataCenters: jest.fn().mockResolvedValue([{
        id: 'EU-RO-1', networkVolumeTypes: ['STANDARD'],
      }]),
      getAccountTemplates: jest.fn().mockResolvedValue([{ id: 'template-1', name: 'lentmiien-ollama-gpu-v2' }]),
      updateTemplate: jest.fn().mockResolvedValue({ id: 'template-1' }),
      createTemplate: jest.fn(),
      createNetworkVolume: jest.fn().mockResolvedValue({ id: 'volume-1' }),
      createPod: jest.fn()
        .mockResolvedValueOnce({ id: 'pod-1', cost: 0.74 })
        .mockResolvedValueOnce({ id: 'pod-2', cost: 0.74 }),
      getPod: jest.fn()
        .mockResolvedValueOnce({ id: 'pod-1', status: 'RUNNING' })
        .mockResolvedValueOnce({ id: 'pod-2', status: 'RUNNING' }),
      deletePod: jest.fn().mockResolvedValue(true),
      deleteNetworkVolume: jest.fn().mockResolvedValue(true),
      listNetworkVolumes: jest.fn().mockResolvedValue([]),
    };
    const manager = {
      waitForOllama: jest.fn().mockResolvedValue(true),
      pullOllamaModel: jest.fn().mockResolvedValue(true),
      verifyOllamaModel: jest.fn().mockResolvedValue(true),
    };

    await expect(main({
      argv: [EXECUTE_FLAG],
      service,
      stdout: jest.fn(),
      stderr: jest.fn(),
      managerFactory: () => manager,
    })).resolves.toBe(0);

    expect(service.createPod).toHaveBeenCalledTimes(2);
    expect(service.deletePod.mock.calls).toEqual([['pod-1'], ['pod-2']]);
    expect(manager.pullOllamaModel).toHaveBeenCalledTimes(1);
    expect(manager.pullOllamaModel).toHaveBeenCalledWith(
      'https://pod-1-11434.proxy.runpod.net',
      TEST_MODEL
    );
    expect(manager.verifyOllamaModel).toHaveBeenCalledTimes(2);
    expect(service.deleteNetworkVolume).toHaveBeenCalledWith('volume-1');
    expect(service.createPod.mock.calls[0][0]).toEqual(expect.objectContaining({
      cloud: 'SECURE',
      mounts: { network: [{ volumeId: 'volume-1', path: '/workspace' }] },
      env: expect.objectContaining({ OLLAMA_MODELS: '/workspace/ollama/models' }),
      dataCenterIds: ['EU-RO-1'],
    }));
  });
});
