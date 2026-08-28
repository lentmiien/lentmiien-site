const ModularLlmGatewayService = require('../../services/modularLlmGatewayService');

function response(data) {
  return Promise.resolve({ data });
}

describe('ModularLlmGatewayService', () => {
  test('submits the documented pipeline payload with the long-running timeout', async () => {
    const httpClient = {
      get: jest.fn(),
      post: jest.fn().mockResolvedValue({
        data: {
          run_id: 'run-unit-1',
          status: 'succeeded',
          output: '17 has no divisors other than 1 and itself.',
        },
      }),
    };
    const service = new ModularLlmGatewayService({
      gatewayBaseUrl: 'http://gateway.test:8080',
      runTimeoutMs: 123456,
      httpClient,
    });

    const result = await service.runPipeline({
      input: 'Explain why 17 is prime.',
      maxRepairAttempts: 1,
      persist: true,
      includeDiagnostics: false,
    });

    expect(result).toMatchObject({ run_id: 'run-unit-1', status: 'succeeded' });
    expect(httpClient.post).toHaveBeenCalledWith(
      'http://gateway.test:8080/modular-llm/pipeline/run',
      {
        input: 'Explain why 17 is prime.',
        max_repair_attempts: 1,
        persist: true,
        include_diagnostics: false,
      },
      expect.objectContaining({
        timeout: 123456,
        responseType: 'json',
        maxContentLength: 4 * 1024 * 1024,
      }),
    );
  });

  test('builds a partial dashboard when one metadata endpoint is unavailable', async () => {
    const httpClient = {
      post: jest.fn(),
      get: jest.fn((url) => {
        if (url.endsWith('/health')) {
          const error = new Error('offline');
          error.code = 'ECONNREFUSED';
          return Promise.reject(error);
        }
        if (url.endsWith('/models')) return response({ bundle: { id: 'bundle-1', stages: {} } });
        if (url.endsWith('/schemas')) return response({ schemas: [] });
        if (url.endsWith('/runs')) return response({ runs: [] });
        return response({ service: 'modular-llm', running: false });
      }),
    };
    const service = new ModularLlmGatewayService({
      gatewayBaseUrl: 'http://gateway.test:8080',
      httpClient,
    });

    const state = await service.getDashboardState();

    expect(state.service).toMatchObject({ service: 'modular-llm' });
    expect(state.health).toBeNull();
    expect(state.runs).toEqual([]);
    expect(state.errors).toEqual({ health: 'The Modular LLM Gateway is unreachable.' });
    expect(httpClient.get).toHaveBeenCalledTimes(5);
  });

  test('limits run-list reads and rejects unsafe run identifiers', async () => {
    const httpClient = {
      post: jest.fn(),
      get: jest.fn().mockResolvedValue({ data: { runs: [] } }),
    };
    const service = new ModularLlmGatewayService({
      gatewayBaseUrl: 'http://gateway.test:8080',
      httpClient,
    });

    await service.listRuns(999);

    expect(httpClient.get).toHaveBeenCalledWith(
      'http://gateway.test:8080/modular-llm/runs',
      expect.objectContaining({ params: { limit: 100 } }),
    );
    expect(() => service.getRun('../secret')).toThrow('Invalid Modular LLM Gateway run ID.');
    expect(httpClient.get).toHaveBeenCalledTimes(1);
  });

  test.each([
    [409, 'already processing'],
    [422, 'input or intermediate schema'],
    [429, 'GPU admission'],
    [503, 'container or GPU'],
    [504, 'execution deadline'],
  ])('maps Gateway status %s to an actionable message', (status, expected) => {
    const error = { response: { status, data: {} } };
    expect(ModularLlmGatewayService.gatewayResponseError(error)).toContain(expected);
  });

  test('extracts an actionable message from a FastAPI detail envelope', () => {
    const error = {
      response: {
        status: 502,
        data: {
          detail: {
            run_id: 'run-failed-1',
            error: { message: 'CIR output remained invalid.' },
          },
        },
      },
    };

    expect(ModularLlmGatewayService.gatewayResponseError(error))
      .toBe('CIR output remained invalid.');
  });
});
