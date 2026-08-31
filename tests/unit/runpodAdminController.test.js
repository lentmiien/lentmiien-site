const {
  PRIVATE_NO_STORE,
  buildPageModel,
  createRunpodAdminController,
  mapBillingAmounts,
  parseDashboardQuery,
} = require('../../controllers/runpodAdminController');
const { RunpodConfigurationError } = require('../../services/runpodApiV2Service');

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    render: jest.fn().mockReturnThis(),
  };
}

function dashboard(overrides = {}) {
  return {
    apiVersion: 'v2',
    fetchedAt: '2026-09-01T01:02:03.000Z',
    gpus: [{
      id: 'NVIDIA H200',
      name: 'H200',
      manufacturer: 'NVIDIA',
      memory: 141,
      availability: 'HIGH',
      secure: true,
      community: false,
      price: { secure: 3.99 },
      maxCount: { secure: 8, community: 0 },
      cudaVersions: [{ version: '12.8', available: true }],
      dataCenters: [{ id: 'EU-1' }],
    }],
    cpus: [{
      id: 'cpu3c',
      name: 'Compute-Optimized',
      availability: 'MEDIUM',
      vcpu: { min: 2, max: 32 },
      price: { securePerVcpu: 0.03 },
      ramGbPerVcpu: 2,
      dataCenters: [],
    }],
    dataCenters: [{ id: 'EU-SE-1', name: 'Sweden', region: 'EUROPE' }],
    templates: [{
      id: 'runpod-torch-v21',
      name: 'Runpod Pytorch',
      image: 'runpod/pytorch:latest',
      env: { SHOULD_NOT_RENDER: 'private-value' },
    }],
    billing: {
      records: [{
        startTime: '2026-08-31T00:00:00Z',
        endTime: '2026-09-01T00:00:00Z',
        totalAmount: 10,
        podGpuAmount: 4,
        podDiskAmount: 1,
        serverlessGpuAmount: 2,
        storageStandardAmount: 1,
        endpointAmount: 1,
        clusterGpuAmount: 1,
      }],
      metadata: {
        query: {
          startTime: '2026-08-31T00:00:00Z',
          endTime: '2026-09-01T00:00:00Z',
          bucketSize: 'day',
        },
        totals: {
          totalAmount: 10,
          podGpuAmount: 4,
          podDiskAmount: 1,
          serverlessGpuAmount: 2,
          storageStandardAmount: 1,
          endpointAmount: 1,
          clusterGpuAmount: 1,
        },
      },
    },
    errors: {},
    ...overrides,
  };
}

describe('runpodAdminController', () => {
  test('renders a private no-store dashboard with validated filters', async () => {
    const runpodService = { getDashboard: jest.fn().mockResolvedValue(dashboard()) };
    const appLogger = { warning: jest.fn(), error: jest.fn() };
    const controller = createRunpodAdminController({ runpodService, appLogger });
    const res = createResponse();

    await controller.index({ query: { bucketSize: 'week', lastN: '12', refresh: '1' } }, res);

    expect(runpodService.getDashboard).toHaveBeenCalledWith({
      bucketSize: 'week',
      lastN: 12,
      forceRefresh: true,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', PRIVATE_NO_STORE);
    expect(res.render).toHaveBeenCalledWith('admin_runpod', expect.objectContaining({
      pageTitle: 'Runpod API v2 - Admin',
      pageError: null,
      summary: expect.objectContaining({
        gpuCount: 1,
        availableGpuCount: 1,
        billingTotal: 10,
      }),
      billing: expect.objectContaining({
        recordCount: 1,
        totals: {
          total: 10,
          pods: 5,
          serverless: 2,
          storage: 1,
          endpoints: 1,
          clusters: 1,
        },
      }),
    }));
    expect(JSON.stringify(res.render.mock.calls[0][1])).not.toContain('private-value');
    expect(appLogger.warning).not.toHaveBeenCalled();
  });

  test.each([
    [{ bucketSize: 'minute', lastN: '30' }],
    [{ bucketSize: 'day', lastN: '0' }],
    [{ bucketSize: 'day', lastN: '367' }],
    [{ bucketSize: ['day', 'week'], lastN: '30' }],
    [{ bucketSize: 'day', lastN: '30', providerUrl: 'http://127.0.0.1' }],
    [{ bucketSize: 'day', lastN: '30', refresh: 'yes' }],
  ])('rejects malformed or unknown query input before provider work: %p', async (query) => {
    const runpodService = { getDashboard: jest.fn() };
    const controller = createRunpodAdminController({
      runpodService,
      appLogger: { warning: jest.fn(), error: jest.fn() },
    });
    const res = createResponse();

    await controller.index({ query }, res);

    expect(runpodService.getDashboard).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', PRIVATE_NO_STORE);
    expect(res.render).toHaveBeenCalledWith('admin_runpod', expect.objectContaining({
      pageError: expect.any(String),
    }));
  });

  test('keeps useful sections visible and logs only safe metadata on partial failure', async () => {
    const secret = 'never-log-this-provider-body';
    const runpodService = {
      getDashboard: jest.fn().mockResolvedValue(dashboard({
        errors: {
          billing: {
            code: 'RUNPOD_HTTP_ERROR',
            status: 503,
            message: secret,
            providerBody: secret,
          },
        },
      })),
    };
    const appLogger = { warning: jest.fn(), error: jest.fn() };
    const controller = createRunpodAdminController({ runpodService, appLogger });
    const res = createResponse();

    await controller.index({ query: {} }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.render).toHaveBeenCalledWith('admin_runpod', expect.objectContaining({
      gpus: expect.arrayContaining([expect.objectContaining({ id: 'NVIDIA H200' })]),
      errorSections: [expect.objectContaining({
        section: 'billing',
        code: 'RUNPOD_HTTP_ERROR',
        status: 503,
        message: 'Billing history request failed with HTTP 503.',
      })],
    }));
    expect(appLogger.warning).toHaveBeenCalledWith(
      'Runpod admin dashboard loaded with provider failures',
      {
        category: 'runpod_api_v2',
        metadata: {
          failedSections: ['billing'],
          errorCodes: ['RUNPOD_HTTP_ERROR'],
          providerStatuses: [503],
        },
      }
    );
    expect(JSON.stringify(appLogger.warning.mock.calls)).not.toContain(secret);
  });

  test('returns a safe 503 when the API key is not configured', async () => {
    const runpodService = {
      getDashboard: jest.fn().mockRejectedValue(new RunpodConfigurationError()),
    };
    const appLogger = { warning: jest.fn(), error: jest.fn() };
    const controller = createRunpodAdminController({ runpodService, appLogger });
    const res = createResponse();

    await controller.index({ query: {} }, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.render).toHaveBeenCalledWith('admin_runpod', expect.objectContaining({
      pageError: 'Runpod is not configured on this server. Add RUNPOD_API_KEY and try again.',
    }));
    expect(appLogger.error).toHaveBeenCalledWith(
      'Runpod API v2 integration is not configured',
      expect.objectContaining({ category: 'runpod_api_v2' })
    );
  });

  test('returns 502 when every provider section failed', async () => {
    const errors = Object.fromEntries(
      ['gpus', 'cpus', 'dataCenters', 'templates', 'billing']
        .map((section) => [section, { code: 'RUNPOD_NETWORK_ERROR', message: 'Unavailable.' }])
    );
    const runpodService = { getDashboard: jest.fn().mockResolvedValue(dashboard({ errors })) };
    const controller = createRunpodAdminController({
      runpodService,
      appLogger: { warning: jest.fn(), error: jest.fn() },
    });
    const res = createResponse();

    await controller.index({ query: {} }, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.render).toHaveBeenCalledWith('admin_runpod', expect.objectContaining({
      pageError: 'Runpod data is temporarily unavailable.',
    }));
  });
});

describe('Runpod admin mapping helpers', () => {
  test('sums resource billing components without trusting a missing total', () => {
    expect(mapBillingAmounts({
      podGpuAmount: 1,
      podCpuAmount: 2,
      serverlessFeeAmount: 3,
      storageStandardAmount: 4,
      endpointAmount: 5,
      clusterNetworkingAmount: 6,
    })).toEqual({
      total: 21,
      pods: 3,
      serverless: 3,
      storage: 4,
      endpoints: 5,
      clusters: 6,
    });
  });

  test('normalizes provider strings and bounds returned collections', () => {
    const model = buildPageModel(dashboard({
      gpus: [{ id: 'gpu\u0000id', name: 'GPU\nName', availability: 'unexpected' }],
      billing: {
        records: Array.from({ length: 400 }, (_, index) => ({
          startTime: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00Z`,
        })),
        metadata: { totals: {} },
      },
    }));

    expect(model.gpus[0]).toEqual(expect.objectContaining({
      id: 'gpu id',
      name: 'GPU Name',
      availability: 'UNKNOWN',
    }));
    expect(model.billing.records).toHaveLength(366);
  });

  test('accepts only single allowlisted dashboard query values', () => {
    expect(parseDashboardQuery({ bucketSize: 'year', lastN: '2', refresh: '0' })).toEqual({
      valid: true,
      errors: [],
      filters: { bucketSize: 'year', lastN: 2, forceRefresh: false },
    });
  });
});
