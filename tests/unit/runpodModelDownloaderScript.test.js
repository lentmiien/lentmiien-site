const {
  EXECUTE_FLAG,
  chooseServingGpu,
  main,
  verifyInference,
} = require('../../scripts/test-runpod-model-downloader-v2');

function gpu(overrides = {}) {
  return {
    id: 'NVIDIA A40',
    name: 'A40',
    memory: 48,
    availability: 'HIGH',
    price: { secure: 0.49 },
    maxCount: { secure: 1 },
    dataCenters: [{ id: 'EU-RO-1', availability: 'HIGH' }],
    ...overrides,
  };
}

describe('standalone Runpod model downloader script', () => {
  test('is a no-op unless execute is explicitly requested', async () => {
    const stdout = jest.fn();
    const service = { listPods: jest.fn() };
    const mongooseInstance = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      connection: { readyState: 0 },
    };

    await expect(main({ argv: [], stdout, service, mongooseInstance }))
      .resolves.toBe(0);

    expect(stdout).toHaveBeenCalledWith('Dry run only. No Runpod or database resource was changed.');
    expect(service.listPods).not.toHaveBeenCalled();
    expect(mongooseInstance.connect).not.toHaveBeenCalled();
  });

  test('requires provider configuration before executing', async () => {
    const stderr = jest.fn();
    const mongooseInstance = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      connection: { readyState: 0 },
    };

    await expect(main({
      argv: [EXECUTE_FLAG],
      apiKey: '',
      mongoUrl: 'mongodb://configured',
      stderr,
      mongooseInstance,
    })).resolves.toBe(1);

    expect(stderr).toHaveBeenCalledWith('Runpod model downloader test failed: RUNPOD_NOT_CONFIGURED');
    expect(mongooseInstance.connect).not.toHaveBeenCalled();
  });

  test('selects the cheapest location-compatible GPU with at least 32 GB VRAM', () => {
    const selected = chooseServingGpu([
      gpu({ id: 'expensive', price: { secure: 0.8 } }),
      gpu({ id: 'too-small', memory: 24, price: { secure: 0.2 } }),
      gpu({ id: 'wrong-region', price: { secure: 0.3 }, dataCenters: [{ id: 'US-TX-1', availability: 'HIGH' }] }),
      gpu({ id: 'selected', price: { secure: 0.4 }, availability: 'LOW', dataCenters: [{ id: 'EU-RO-1', availability: 'LOW' }] }),
    ], 'EU-RO-1');

    expect(selected.id).toBe('selected');
    expect(chooseServingGpu([gpu({ memory: 24 })], 'EU-RO-1')).toBeNull();
  });

  test('performs a bounded non-redirecting Ollama inference check', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      response: 'OK',
      done: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(verifyInference(
      fetchImpl,
      'https://pod-123-11434.proxy.runpod.net',
      'qwen3.8:27b'
    )).resolves.toBe(true);

    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://pod-123-11434.proxy.runpod.net/api/generate');
    expect(options).toEqual(expect.objectContaining({
      method: 'POST',
      redirect: 'error',
    }));
    expect(JSON.parse(options.body)).toEqual(expect.objectContaining({
      model: 'qwen3.8:27b',
      stream: false,
    }));
  });
});
