const {
  chooseGatewayGpu,
  main,
  runProviderOnlyTest,
  verifyAccessBlocksAnonymous,
} = require('../../scripts/test-runpod-cloudflare-gateway-v2');

function gpu(overrides = {}) {
  return {
    id: 'NVIDIA A40',
    name: 'A40',
    memory: 48,
    availability: 'HIGH',
    price: { secure: 0.5 },
    maxCount: { secure: 1 },
    dataCenters: [{ id: 'EU-RO-1', availability: 'HIGH' }],
    ...overrides,
  };
}

describe('Runpod Cloudflare gateway standalone check', () => {
  test('dry run does not connect to MongoDB or mutate provider state', async () => {
    const stdout = jest.fn();
    const mongooseInstance = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      connection: { readyState: 0 },
    };
    const service = { listPods: jest.fn() };

    await expect(main({
      argv: [],
      mongooseInstance,
      service,
      stdout,
      stderr: jest.fn(),
    })).resolves.toBe(0);

    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Dry run only'));
    expect(mongooseInstance.connect).not.toHaveBeenCalled();
    expect(service.listPods).not.toHaveBeenCalled();
  });

  test('preflight-only validates Access without reading Runpod or MongoDB', async () => {
    const stdout = jest.fn();
    const service = { listPods: jest.fn() };
    const mongooseInstance = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      connection: { readyState: 0 },
    };
    const verifyCloudflareAccessServiceToken = jest.fn().mockResolvedValue({
      anonymousStatus: 302,
      authenticatedStatus: 502,
    });

    await expect(main({
      argv: ['--execute', '--preflight-only'],
      mongooseInstance,
      service,
      managerFactory: () => ({ verifyCloudflareAccessServiceToken }),
      stdout,
      stderr: jest.fn(),
    })).resolves.toBe(0);

    expect(verifyCloudflareAccessServiceToken).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith('No Runpod resource was read or changed.');
    expect(service.listPods).not.toHaveBeenCalled();
    expect(mongooseInstance.connect).not.toHaveBeenCalled();
  });

  test('selects the cheapest compatible 32+ GB GPU in the volume data center', () => {
    const selected = chooseGatewayGpu([
      gpu({ id: 'expensive', price: { secure: 0.8 } }),
      gpu({ id: 'too-small', memory: 24, price: { secure: 0.2 } }),
      gpu({ id: 'cheap', price: { secure: 0.4 }, availability: 'LOW' }),
      gpu({
        id: 'wrong-region',
        price: { secure: 0.3 },
        dataCenters: [{ id: 'US-TX-1', availability: 'HIGH' }],
      }),
    ], 'EU-RO-1', 0.99);

    expect(selected.id).toBe('cheap');
  });

  test('requires Cloudflare Access to reject an anonymous Ollama request', async () => {
    const blocked = {
      ok: false,
      status: 403,
      body: { cancel: jest.fn().mockResolvedValue() },
    };
    await expect(verifyAccessBlocksAnonymous(
      jest.fn().mockResolvedValue(blocked),
      'https://llm.lentmiien.com/'
    )).resolves.toBe(403);

    const exposed = {
      ok: true,
      status: 200,
      body: { cancel: jest.fn().mockResolvedValue() },
    };
    await expect(verifyAccessBlocksAnonymous(
      jest.fn().mockResolvedValue(exposed),
      'https://llm.lentmiien.com/'
    )).rejects.toEqual(expect.objectContaining({
      code: 'RUNPOD_GATEWAY_ANONYMOUS_ACCESS',
    }));
  });

  test('fails the service-token preflight before reading or mutating Runpod resources', async () => {
    const service = {
      listPods: jest.fn(),
      deletePod: jest.fn(),
    };
    const stderr = jest.fn();

    await expect(runProviderOnlyTest({
      service,
      fetchImpl: jest.fn().mockResolvedValue(new Response(null, {
        status: 302,
        headers: { Location: 'https://lentmiien.cloudflareaccess.com/cdn-cgi/access/login' },
      })),
      model: 'qwen3.8:27b',
      volumeIdInput: 'volume-1',
      volumeNameInput: '',
      stdout: jest.fn(),
      stderr,
      managerOptions: {
        cloudflareGatewayUrl: 'https://llm.lentmiien.com',
        cloudflareAccessClientId: 'access-id',
        cloudflareAccessClientSecret: 'access-secret',
        cloudflareTunnelTokenConfigured: true,
      },
    })).resolves.toBe(1);

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining(
      'RUNPOD_CLOUDFLARE_ACCESS_DENIED'
    ));
    expect(service.listPods).not.toHaveBeenCalled();
    expect(service.deletePod).not.toHaveBeenCalled();
  });
});
