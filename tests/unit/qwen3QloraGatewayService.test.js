jest.mock('axios', () => jest.fn());
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  warning: jest.fn(),
}));
jest.mock('../../utils/apiDebugLogger', () => ({
  createApiDebugLogger: jest.fn(() => jest.fn().mockResolvedValue()),
}));

const axios = require('axios');
const Qwen3QloraGatewayService = require('../../services/qwen3QloraGatewayService');

describe('Qwen3QloraGatewayService', () => {
  beforeEach(() => {
    axios.mockImplementation(async (options) => ({
      data: { path: new URL(options.url).pathname },
      headers: {},
      status: 200,
    }));
  });

  test('loads the documented metadata endpoints without starting the container', async () => {
    const service = new Qwen3QloraGatewayService({
      gatewayBaseUrl: 'http://gateway.test:8080',
      infoTimeoutMs: 4321,
    });

    const state = await service.getDashboardState();
    const paths = axios.mock.calls.map(([options]) => new URL(options.url).pathname);

    expect(paths).toEqual(expect.arrayContaining([
      '/qwen3-qlora',
      '/qwen3-qlora/health',
      '/qwen3-qlora/model',
      '/qwen3-qlora/datasets',
      '/qwen3-qlora/train/jobs',
      '/qwen3-qlora/adapters',
      '/limits',
    ]));
    expect(paths).not.toContain('/qwen3-qlora/container');
    expect(state.servicePrefix).toBe('/qwen3-qlora');
    expect(state.errors).toEqual({});
    expect(axios.mock.calls.every(([options]) => options.timeout === 4321)).toBe(true);
  });

  test('uses the QLoRA-specific long timeouts for model preparation and generation', async () => {
    const service = new Qwen3QloraGatewayService({
      gatewayBaseUrl: 'http://gateway.test:8080',
      actionTimeoutMs: 1200,
      downloadTimeoutMs: 4500,
      generateTimeoutMs: 43800,
    });

    await service.downloadModel();
    await service.generate({ prompt: 'Hello' });
    await service.createTrainingJob({ dataset_id: 'dataset-1' });

    expect(axios).toHaveBeenNthCalledWith(1, expect.objectContaining({
      method: 'post',
      url: 'http://gateway.test:8080/qwen3-qlora/model/download',
      timeout: 4500,
    }));
    expect(axios).toHaveBeenNthCalledWith(2, expect.objectContaining({
      method: 'post',
      url: 'http://gateway.test:8080/qwen3-qlora/generate',
      timeout: 43800,
    }));
    expect(axios).toHaveBeenNthCalledWith(3, expect.objectContaining({
      method: 'post',
      url: 'http://gateway.test:8080/qwen3-qlora/train/jobs',
      timeout: 1200,
    }));
  });

  test('reserves only QLoRA and sends the admin token only in mutation headers', async () => {
    const service = new Qwen3QloraGatewayService({
      gatewayBaseUrl: 'http://gateway.test:8080',
      actionTimeoutMs: 1200,
      adminToken: 'admin-secret',
    });

    await service.reserveGpu({ idleTimeoutSec: 1800 });

    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: 'post',
      url: 'http://gateway.test:8080/gpu/reservation',
      data: {
        container_id: 'qwen3_qlora',
        wait: true,
        idle_timeout_sec: 1800,
      },
      headers: { 'X-Admin-Token': 'admin-secret' },
      timeout: 1200,
    }));
  });

  test('rechecks ownership before releasing a QLoRA reservation', async () => {
    axios
      .mockResolvedValueOnce({
        data: { active: true, service: 'qwen3_qlora' },
        headers: {},
        status: 200,
      })
      .mockResolvedValueOnce({
        data: { active: false, service: null },
        headers: {},
        status: 200,
      });
    const service = new Qwen3QloraGatewayService({
      gatewayBaseUrl: 'http://gateway.test:8080',
      adminToken: 'admin-secret',
    });

    await expect(service.releaseGpuReservation()).resolves.toEqual({ active: false, service: null });

    expect(axios).toHaveBeenNthCalledWith(1, expect.objectContaining({
      method: 'get',
      url: 'http://gateway.test:8080/gpu/reservation',
    }));
    expect(axios).toHaveBeenNthCalledWith(2, expect.objectContaining({
      method: 'delete',
      url: 'http://gateway.test:8080/gpu/reservation',
      headers: { 'X-Admin-Token': 'admin-secret' },
    }));
  });

  test('refuses to release another service reservation', async () => {
    axios.mockResolvedValueOnce({
      data: { active: true, service: 'ollama' },
      headers: {},
      status: 200,
    });
    const service = new Qwen3QloraGatewayService({ gatewayBaseUrl: 'http://gateway.test:8080' });

    await expect(service.releaseGpuReservation()).rejects.toMatchObject({
      message: 'The active GPU reservation belongs to ollama.',
      statusCode: 409,
    });
    expect(axios).toHaveBeenCalledTimes(1);
  });

  test('reports partial dashboard failures without discarding healthy metadata', async () => {
    axios.mockImplementation(async (options) => {
      const path = new URL(options.url).pathname;
      if (path === '/qwen3-qlora/model') {
        const error = new Error('upstream unavailable');
        error.response = { status: 503, data: { detail: 'model unavailable' } };
        throw error;
      }
      return { data: { path }, headers: {}, status: 200 };
    });
    const service = new Qwen3QloraGatewayService({ gatewayBaseUrl: 'http://gateway.test:8080' });

    const state = await service.getDashboardState();

    expect(state.health).toEqual({ path: '/qwen3-qlora/health' });
    expect(state.model).toBeNull();
    expect(state.errors.model).toBe('Gateway returned 503: model unavailable');
  });
});
