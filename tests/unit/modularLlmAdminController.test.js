const mockAdminService = {
  gateway: { gatewayBaseUrl: 'http://gateway.test:8080' },
  getDashboardState: jest.fn(),
  getRuntimeState: jest.fn(),
  listModelProfiles: jest.fn(),
  listTestRuns: jest.fn(),
  syncModelCatalog: jest.fn(),
  updateModelProfile: jest.fn(),
  createPipelineTest: jest.fn(),
  getTestRun: jest.fn(),
  getGatewayRun: jest.fn(),
  findTestRunByGatewayRunId: jest.fn(),
};

jest.mock('../../services/modularLlmAdminService', () => {
  class ModularLlmInputError extends Error {
    constructor(message, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  }

  class MockModularLlmAdminService {
    constructor() {
      return mockAdminService;
    }
  }
  MockModularLlmAdminService.MODEL_PROFILE_COLLECTION = 'modular_llm_model_profiles';
  MockModularLlmAdminService.TEST_RUN_COLLECTION = 'modular_llm_test_runs';
  MockModularLlmAdminService.MAX_TEST_INPUT_LENGTH = 20000;
  MockModularLlmAdminService.ModularLlmInputError = ModularLlmInputError;
  return MockModularLlmAdminService;
});

jest.mock('../../services/modularLlmGatewayService', () => {
  class MockModularLlmGatewayService {}
  MockModularLlmGatewayService.SERVICE_ID = 'modular_llm';
  MockModularLlmGatewayService.SERVICE_PREFIX = '/modular-llm';
  MockModularLlmGatewayService.gatewayResponseError = jest.fn(
    (error, fallback = 'Gateway request failed.') => error?.message || fallback,
  );
  MockModularLlmGatewayService.assertGatewayRunId = jest.fn((value) => {
    if (!/^run-[A-Za-z0-9_-]+$/.test(value)) {
      const error = new Error('Invalid Modular LLM Gateway run ID.');
      error.statusCode = 400;
      throw error;
    }
    return value;
  });
  return MockModularLlmGatewayService;
});

jest.mock('../../utils/logger', () => ({
  warning: jest.fn(),
  error: jest.fn(),
  notice: jest.fn(),
  debug: jest.fn(),
}));

const controller = require('../../controllers/modularLlmAdminController');

function request(overrides = {}) {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    user: { name: 'admin-user' },
    get: jest.fn((name) => (name.toLowerCase() === 'accept' ? 'application/json' : null)),
    ...overrides,
  };
}

function response() {
  const res = {
    json: jest.fn(),
    redirect: jest.fn(),
    render: jest.fn(),
    set: jest.fn(),
    status: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.set.mockReturnValue(res);
  return res;
}

describe('modularLlmAdminController', () => {
  test('renders partial live state and database history on the dashboard', async () => {
    mockAdminService.getDashboardState.mockResolvedValue({
      fetchedAt: '2026-08-28T00:00:00.000Z',
      baseUrl: 'http://gateway.test:8080',
      service: {
        service: 'modular-llm',
        bundle_id: 'bundle-1',
        container_state: 'created',
        running: false,
        runtime_mode: 'isolated_stage_workers',
      },
      health: { ok: true, status: 'suspended' },
      models: { bundle: { id: 'bundle-1', stages: {} } },
      schemas: { schemas: [] },
      runs: [],
      errors: {},
    });
    mockAdminService.listModelProfiles.mockResolvedValue([]);
    mockAdminService.listTestRuns.mockResolvedValue([]);
    const req = request();
    const res = response();

    await controller.index(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.render).toHaveBeenCalledWith(
      'admin_modular_llm',
      expect.objectContaining({
        adminBase: '/admin/ai-gateway/modular-llm',
        live: expect.objectContaining({
          serviceName: 'modular-llm',
          bundleId: 'bundle-1',
          serviceStatusDisplay: 'Suspended',
        }),
        profiles: [],
        localRuns: [],
      }),
    );
  });

  test('returns a no-store metadata snapshot for polling', async () => {
    mockAdminService.getRuntimeState.mockResolvedValue({
      fetchedAt: '2026-08-28T00:00:00.000Z',
      service: { service: 'modular-llm', bundle_id: 'bundle-1' },
      health: { ok: true, status: 'suspended', container_state: 'created' },
      errors: {},
    });
    const res = response();

    await controller.state(request(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      serviceStatusDisplay: 'Suspended',
      containerStateDisplay: 'Created',
    }));
  });

  test('returns the persisted detail URL after a successful pipeline test', async () => {
    mockAdminService.createPipelineTest.mockResolvedValue({
      _id: 'local-run-1',
      status: 'succeeded',
      operation: 'pipeline',
      inputText: 'Explain why 17 is prime.',
      durationMs: 12500,
      createdAt: '2026-08-28T00:00:00.000Z',
      output: '17 is prime.',
      gatewayRunId: 'run-success-1',
      httpStatus: 200,
    });
    const req = request({ body: { input: 'Explain why 17 is prime.' } });
    const res = response();

    await controller.createRun(req, res);

    expect(mockAdminService.createPipelineTest).toHaveBeenCalledWith(
      { input: 'Explain why 17 is prime.' },
      { requestedBy: 'admin-user' },
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      detailUrl: '/admin/ai-gateway/modular-llm/runs/local-run-1',
      error: null,
    }));
  });

  test('returns a failed test record for inspection instead of losing it', async () => {
    mockAdminService.createPipelineTest.mockResolvedValue({
      _id: 'local-run-failed',
      status: 'failed',
      operation: 'pipeline',
      inputText: 'Failure case.',
      durationMs: 9000,
      createdAt: '2026-08-28T00:00:00.000Z',
      output: null,
      gatewayRunId: 'run-failed-1',
      httpStatus: 502,
      errorMessage: 'CIR validation failed.',
    });
    const res = response();

    await controller.createRun(request({ body: { input: 'Failure case.' } }), res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: false,
      detailUrl: '/admin/ai-gateway/modular-llm/runs/local-run-failed',
      error: 'CIR validation failed.',
    }));
  });
});
