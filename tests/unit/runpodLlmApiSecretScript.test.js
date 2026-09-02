const {
  DEFAULT_LLM_API_SECRET_NAME,
  main,
} = require('../../scripts/bootstrap-runpod-llm-api-secret');

describe('Runpod native LLM API Secret bootstrap', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  test('creates the dedicated Secret without exposing its value', async () => {
    const ensureSecret = jest.fn().mockResolvedValue({
      created: true,
      exists: true,
      id: 'secret-id',
      name: DEFAULT_LLM_API_SECRET_NAME,
    });
    const stdout = jest.fn();

    await expect(main({
      stdout,
      stderr: jest.fn(),
      env: {
        RUNPOD_API_KEY: 'runpod-key',
        RUNPOD_LLM_API_KEY: 'native-api-secret',
      },
      argv: [],
      ensureSecret,
    })).resolves.toEqual(expect.objectContaining({ created: true }));

    expect(ensureSecret).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'runpod-key',
      value: 'native-api-secret',
      name: DEFAULT_LLM_API_SECRET_NAME,
      missingValueCode: 'RUNPOD_LLM_API_KEY_NOT_CONFIGURED',
    }));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining(DEFAULT_LLM_API_SECRET_NAME));
    expect(stdout.mock.calls.flat().join(' ')).not.toContain('native-api-secret');
  });

  test('supports metadata-only checks and safe failures', async () => {
    const ensureSecret = jest.fn().mockResolvedValue({
      created: false,
      exists: true,
      id: 'secret-id',
      name: 'custom_llm_key',
    });
    await main({
      stdout: jest.fn(),
      stderr: jest.fn(),
      env: {
        RUNPOD_API_KEY: 'runpod-key',
        RUNPOD_LLM_API_SECRET_NAME: 'custom_llm_key',
      },
      argv: ['--check'],
      ensureSecret,
    });
    expect(ensureSecret).toHaveBeenCalledWith(expect.objectContaining({
      checkOnly: true,
      name: 'custom_llm_key',
    }));

    const stderr = jest.fn();
    ensureSecret.mockRejectedValueOnce({ code: 'RUNPOD_LLM_API_KEY_NOT_CONFIGURED' });
    await expect(main({
      stdout: jest.fn(),
      stderr,
      env: {},
      argv: [],
      ensureSecret,
    })).resolves.toBeNull();
    expect(stderr).toHaveBeenCalledWith(
      'Runpod LLM API Secret bootstrap failed: RUNPOD_LLM_API_KEY_NOT_CONFIGURED'
    );
  });
});
