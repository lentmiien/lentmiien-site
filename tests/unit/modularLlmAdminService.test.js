jest.mock('../../utils/logger', () => ({
  warning: jest.fn(),
  error: jest.fn(),
  notice: jest.fn(),
  debug: jest.fn(),
}));

const logger = require('../../utils/logger');
const ModularLlmAdminService = require('../../services/modularLlmAdminService');

function createQuery(result) {
  const query = {
    sort: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(result),
  };
  query.sort.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.lean.mockReturnValue(query);
  return query;
}

function modelsPayload() {
  return {
    bundle: {
      id: 'qwen3-poc-v0.1',
      description: 'Proof of concept',
      cir_version: 'cir-0.1',
      air_version: 'air-0.1',
      runtime_mode: 'isolated',
      stages: {
        interpreter: {
          model_id: 'Qwen/Qwen3-0.6B',
          revision: 'revision-a',
          dtype: 'bf16',
          attention: 'sdpa',
          cache_dir: '/models/hf',
          local_path: '',
          adapter_path: '',
          max_input_tokens: 8192,
          max_new_tokens: 512,
          temperature: 0,
          top_p: 0.8,
          top_k: 20,
        },
        reasoner: {
          model_id: 'Qwen/Qwen3-4B-Instruct-2507',
          revision: 'revision-b',
          dtype: 'bf16',
          attention: 'sdpa',
          max_input_tokens: 8192,
          max_new_tokens: 768,
          temperature: 0,
          top_p: 0.8,
          top_k: 20,
        },
      },
    },
  };
}

describe('ModularLlmAdminService', () => {
  test('syncs discovered models without overwriting admin-managed metadata', async () => {
    const ModelProfileModel = {
      bulkWrite: jest.fn().mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
        upsertedCount: 2,
      }),
    };
    const gateway = { getModels: jest.fn().mockResolvedValue(modelsPayload()) };
    const now = new Date('2026-08-28T00:00:00.000Z');
    const service = new ModularLlmAdminService({
      ModelProfileModel,
      TestRunModel: {},
      gateway,
      now: () => now,
    });

    const result = await service.syncModelCatalog({ updatedBy: 'admin-user' });

    expect(result).toMatchObject({
      bundleId: 'qwen3-poc-v0.1',
      stageCount: 2,
      upsertedCount: 2,
    });
    const [operations, options] = ModelProfileModel.bulkWrite.mock.calls[0];
    expect(options).toEqual({ ordered: true });
    expect(operations[0]).toEqual({
      updateMany: {
        filter: { serviceId: 'modular_llm', available: true },
        update: { $set: { available: false } },
      },
    });
    expect(operations[1].updateOne.filter).toEqual({
      serviceId: 'modular_llm',
      bundleId: 'qwen3-poc-v0.1',
      stage: 'interpreter',
    });
    expect(operations[1].updateOne.update.$set).toMatchObject({
      modelId: 'Qwen/Qwen3-0.6B',
      available: true,
      lastSeenAt: now,
    });
    expect(operations[1].updateOne.update.$set).not.toHaveProperty('displayName');
    expect(operations[1].updateOne.update.$set).not.toHaveProperty('useCases');
    expect(operations[1].updateOne.update.$setOnInsert).toMatchObject({
      updatedBy: 'admin-user',
      useCases: ['input normalization', 'CIR generation'],
      enabledForTesting: true,
    });
  });

  test('validates pipeline input and checkbox values', () => {
    expect(ModularLlmAdminService.parsePipelineTestInput({
      input: '  Explain why 17 is prime.  ',
      maxRepairAttempts: '0',
      persist: ['false', 'true'],
      includeDiagnostics: 'false',
    })).toEqual({
      inputText: 'Explain why 17 is prime.',
      maxRepairAttempts: 0,
      persistGatewayRun: true,
      includeDiagnostics: false,
    });

    expect(() => ModularLlmAdminService.parsePipelineTestInput({
      input: 'test',
      maxRepairAttempts: 2,
    })).toThrow('Max repair attempts must be 0 or 1.');
    expect(() => ModularLlmAdminService.parsePipelineTestInput({ input: ' ' }))
      .toThrow('Test input is required.');
  });

  test('stores a successful pipeline response and Gateway correlation ID', async () => {
    const gateway = {
      runPipeline: jest.fn().mockResolvedValue({
        run_id: 'run-success-1',
        status: 'succeeded',
        bundle_id: 'qwen3-poc-v0.1',
        output: '17 is prime.',
        stages: { interpreter: { ok: true } },
      }),
    };
    const TestRunModel = {
      create: jest.fn().mockResolvedValue({ _id: 'local-success-1' }),
      findByIdAndUpdate: jest.fn((id, update) => createQuery({ _id: id, ...update.$set })),
    };
    const timestamps = [
      new Date('2026-08-28T00:00:00.000Z'),
      new Date('2026-08-28T00:00:12.500Z'),
    ];
    const service = new ModularLlmAdminService({
      ModelProfileModel: {},
      TestRunModel,
      gateway,
      now: jest.fn(() => timestamps.shift()),
    });

    const run = await service.createPipelineTest({
      input: 'Explain why 17 is prime.',
      maxRepairAttempts: '1',
      persist: 'true',
      includeDiagnostics: 'true',
    }, { requestedBy: 'admin-user' });

    expect(TestRunModel.create).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'pipeline',
      status: 'running',
      requestedBy: 'admin-user',
      inputText: 'Explain why 17 is prime.',
      inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(gateway.runPipeline).toHaveBeenCalledWith({
      input: 'Explain why 17 is prime.',
      maxRepairAttempts: 1,
      persist: true,
      includeDiagnostics: true,
    });
    expect(run).toMatchObject({
      _id: 'local-success-1',
      status: 'succeeded',
      gatewayRunId: 'run-success-1',
      bundleId: 'qwen3-poc-v0.1',
      output: '17 is prime.',
      durationMs: 12500,
    });
  });

  test('retains a failed Gateway response as an inspectable local run', async () => {
    const gatewayError = new Error('Request failed with status code 502');
    gatewayError.response = {
      status: 502,
      data: {
        run_id: 'run-failed-1',
        status: 'failed',
        bundle_id: 'qwen3-poc-v0.1',
        failed_stage: 'interpreter',
        error: {
          type: 'StageExecutionError',
          message: 'CIR output remained invalid.',
          details: { worker_error: { type: 'SchemaValidationError' } },
        },
      },
    };
    const gateway = { runPipeline: jest.fn().mockRejectedValue(gatewayError) };
    const TestRunModel = {
      create: jest.fn().mockResolvedValue({ _id: 'local-failed-1' }),
      findByIdAndUpdate: jest.fn((id, update) => createQuery({ _id: id, ...update.$set })),
    };
    const timestamps = [
      new Date('2026-08-28T00:00:00.000Z'),
      new Date('2026-08-28T00:00:09.000Z'),
    ];
    const service = new ModularLlmAdminService({
      ModelProfileModel: {},
      TestRunModel,
      gateway,
      now: jest.fn(() => timestamps.shift()),
    });

    const run = await service.createPipelineTest({ input: 'Test failure persistence.' });

    expect(run).toMatchObject({
      status: 'failed',
      gatewayRunId: 'run-failed-1',
      gatewayStatus: 'failed',
      failedStage: 'interpreter',
      httpStatus: 502,
      errorType: 'StageExecutionError',
      errorMessage: 'CIR output remained invalid.',
      durationMs: 9000,
    });
    expect(run.errorDetails).toEqual({ worker_error: { type: 'SchemaValidationError' } });
    expect(logger.warning).toHaveBeenCalledWith(
      'Modular LLM pipeline test failed',
      expect.objectContaining({
        category: 'modular_llm_admin',
        metadata: expect.objectContaining({
          localRunId: 'local-failed-1',
          gatewayRunId: 'run-failed-1',
          failedStage: 'interpreter',
        }),
      }),
    );
  });

  test('unwraps FastAPI detail envelopes when correlating failed runs', async () => {
    const gatewayError = new Error('Gateway stage failed');
    gatewayError.response = {
      status: 502,
      data: {
        detail: {
          run_id: 'run-wrapped-1',
          status: 'failed',
          bundle_id: 'bundle-wrapped',
          failed_stage: 'reasoner',
          error: {
            type: 'StageExecutionError',
            message: 'AIR validation failed.',
            details: { schema: 'air-0.1' },
          },
        },
      },
    };
    const TestRunModel = {
      create: jest.fn().mockResolvedValue({ _id: 'local-wrapped-1' }),
      findByIdAndUpdate: jest.fn((id, update) => createQuery({ _id: id, ...update.$set })),
    };
    const timestamps = [
      new Date('2026-08-28T00:00:00.000Z'),
      new Date('2026-08-28T00:00:05.000Z'),
    ];
    const service = new ModularLlmAdminService({
      ModelProfileModel: {},
      TestRunModel,
      gateway: { runPipeline: jest.fn().mockRejectedValue(gatewayError) },
      now: jest.fn(() => timestamps.shift()),
    });

    const run = await service.createPipelineTest({ input: 'Wrapped failure.' });

    expect(run).toMatchObject({
      gatewayRunId: 'run-wrapped-1',
      bundleId: 'bundle-wrapped',
      failedStage: 'reasoner',
      errorType: 'StageExecutionError',
      errorMessage: 'AIR validation failed.',
      errorDetails: { schema: 'air-0.1' },
    });
    expect(run.response).toEqual(gatewayError.response.data);
  });

  test('parses future-facing use case metadata without duplicates', () => {
    expect(ModularLlmAdminService.parseModelProfileInput({
      displayName: 'Interpreter canary',
      useCases: 'CIR generation, support routing\nCIR generation',
      notes: 'Gold-set candidate.',
      enabledForTesting: ['false', 'true'],
    })).toEqual({
      displayName: 'Interpreter canary',
      useCases: ['CIR generation', 'support routing'],
      notes: 'Gold-set candidate.',
      enabledForTesting: true,
    });
  });
});
