const { main } = require('../../scripts/test-runpod-api-v2');

describe('Runpod API v2 connection script', () => {
  test('reports safe metadata and counts without exposing billing values or credentials', async () => {
    const stdout = jest.fn();
    const stderr = jest.fn();
    const service = {
      getApiMetadata: jest.fn().mockResolvedValue({
        title: 'Runpod REST API',
        version: '2.0.0',
        openapi: '3.1.0',
      }),
      getDashboard: jest.fn().mockResolvedValue({
        gpus: Array(2).fill({}),
        cpus: Array(3).fill({}),
        dataCenters: Array(4).fill({}),
        templates: Array(5).fill({}),
        billing: { records: Array(6).fill({ totalAmount: 9876.54 }) },
        errors: {},
      }),
    };

    await expect(main({ service, stdout, stderr })).resolves.toBe(0);

    const output = stdout.mock.calls.flat().join('\n');
    expect(output).toContain('Runpod REST API 2.0.0');
    expect(output).toContain('2 GPUs, 3 CPUs, 4 data centers, 5 official templates');
    expect(output).toContain('6 records');
    expect(output).not.toContain('9876.54');
    expect(stderr).not.toHaveBeenCalled();
    expect(service.getDashboard).toHaveBeenCalledWith({
      bucketSize: 'day',
      lastN: 30,
      forceRefresh: true,
    });
  });

  test('returns a non-zero result for partial endpoint failures', async () => {
    const stdout = jest.fn();
    const stderr = jest.fn();
    const service = {
      getApiMetadata: jest.fn().mockResolvedValue({
        title: 'Runpod REST API', version: '2.0.0', openapi: '3.1.0',
      }),
      getDashboard: jest.fn().mockResolvedValue({
        gpus: [], cpus: [], dataCenters: [], templates: [],
        billing: { records: [] },
        errors: { billing: { code: 'RUNPOD_HTTP_ERROR', status: 503 } },
      }),
    };

    await expect(main({ service, stdout, stderr })).resolves.toBe(1);
    expect(stderr).toHaveBeenCalledWith('Runpod billing check failed: RUNPOD_HTTP_ERROR (HTTP 503)');
  });

  test('does not echo thrown error messages', async () => {
    const stderr = jest.fn();
    const service = {
      getApiMetadata: jest.fn().mockRejectedValue(Object.assign(
        new Error('RUNPOD_API_KEY=secret-value'),
        { code: 'RUNPOD_NETWORK_ERROR' }
      )),
      getDashboard: jest.fn().mockResolvedValue({}),
    };

    await expect(main({ service, stdout: jest.fn(), stderr })).resolves.toBe(1);
    expect(stderr).toHaveBeenCalledWith('Runpod API v2 connection check failed: RUNPOD_NETWORK_ERROR');
    expect(JSON.stringify(stderr.mock.calls)).not.toContain('secret-value');
  });
});
