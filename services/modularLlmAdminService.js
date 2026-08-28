const crypto = require('crypto');
const logger = require('../utils/logger');
const ModularLlmModelProfile = require('../models/modular_llm_model_profile');
const ModularLlmTestRun = require('../models/modular_llm_test_run');
const ModularLlmGatewayService = require('./modularLlmGatewayService');

const SERVICE_ID = ModularLlmGatewayService.SERVICE_ID;
const MODEL_PROFILE_COLLECTION = 'modular_llm_model_profiles';
const TEST_RUN_COLLECTION = 'modular_llm_test_runs';
const MAX_TEST_INPUT_LENGTH = 20000;
const MAX_STORED_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MAX_TRUNCATED_PREVIEW_LENGTH = 200000;
const MAX_RUN_LIST_LIMIT = 100;

class ModularLlmInputError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ModularLlmInputError';
    this.statusCode = statusCode;
  }
}

function resolveQuery(query, { lean = false } = {}) {
  let current = query;
  if (lean && current && typeof current.lean === 'function') {
    current = current.lean();
  }
  if (current && typeof current.exec === 'function') {
    return current.exec();
  }
  return current;
}

function plainDocument(value) {
  if (value && typeof value.toObject === 'function') {
    return value.toObject();
  }
  return value;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeLimitedString(value, label, maxLength, { required = false } = {}) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (required && !normalized) {
    throw new ModularLlmInputError(`${label} is required.`);
  }
  if (normalized.length > maxLength) {
    throw new ModularLlmInputError(`${label} must be ${maxLength.toLocaleString()} characters or fewer.`);
  }
  return normalized;
}

function checkboxValue(value, fallback = false) {
  const candidate = Array.isArray(value) ? value[value.length - 1] : value;
  if (candidate === undefined || candidate === null || candidate === '') return fallback;
  if (candidate === true || candidate === 1) return true;
  return ['true', '1', 'on', 'yes', 'enabled'].includes(String(candidate).toLowerCase());
}

function defaultUseCases(stage) {
  const defaults = {
    interpreter: ['input normalization', 'CIR generation'],
    reasoner: ['structured reasoning', 'AIR generation'],
    renderer: ['answer rendering'],
  };
  return defaults[stage] || [];
}

function normalizeModelBundle(payload) {
  const bundle = payload?.bundle;
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new Error('The Modular LLM Gateway returned an invalid model bundle.');
  }

  const bundleId = normalizeLimitedString(bundle.id, 'Bundle ID', 200, { required: true });
  const rawStages = bundle.stages;
  if (!rawStages || typeof rawStages !== 'object' || Array.isArray(rawStages)) {
    throw new Error('The Modular LLM Gateway model bundle has no valid stages.');
  }

  const stages = Object.entries(rawStages).map(([rawStage, rawConfig]) => {
    const stage = normalizeLimitedString(rawStage, 'Stage', 100, { required: true });
    if (!/^[a-z][a-z0-9_-]*$/i.test(stage)) {
      throw new Error(`The Modular LLM Gateway returned an invalid stage name: ${stage}`);
    }
    if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
      throw new Error(`The Modular LLM Gateway returned invalid configuration for ${stage}.`);
    }

    return {
      stage,
      modelId: normalizeLimitedString(rawConfig.model_id, `${stage} model ID`, 500, {
        required: true,
      }),
      revision: normalizeLimitedString(rawConfig.revision, 'Revision', 200),
      dtype: normalizeLimitedString(rawConfig.dtype, 'Dtype', 100),
      attention: normalizeLimitedString(rawConfig.attention, 'Attention', 100),
      cacheDir: normalizeLimitedString(rawConfig.cache_dir, 'Cache directory', 2000),
      localPath: normalizeLimitedString(rawConfig.local_path, 'Local path', 4000),
      adapterPath: normalizeLimitedString(rawConfig.adapter_path, 'Adapter path', 4000),
      maxInputTokens: finiteOrNull(rawConfig.max_input_tokens),
      maxNewTokens: finiteOrNull(rawConfig.max_new_tokens),
      temperature: finiteOrNull(rawConfig.temperature),
      topP: finiteOrNull(rawConfig.top_p),
      topK: finiteOrNull(rawConfig.top_k),
      gatewayConfig: rawConfig,
    };
  });

  if (!stages.length) {
    throw new Error('The Modular LLM Gateway model bundle contains no stages.');
  }

  return {
    bundleId,
    bundleDescription: normalizeLimitedString(bundle.description, 'Bundle description', 2000),
    runtimeMode: normalizeLimitedString(bundle.runtime_mode, 'Runtime mode', 100),
    cirVersion: normalizeLimitedString(bundle.cir_version, 'CIR version', 100),
    airVersion: normalizeLimitedString(bundle.air_version, 'AIR version', 100),
    stages,
  };
}

function normalizeUseCases(value) {
  const rawValues = Array.isArray(value) ? value : [value];
  const normalized = Array.from(new Set(rawValues
    .flatMap((entry) => String(entry || '').split(/[\n,]/))
    .map((entry) => entry.trim())
    .filter(Boolean)));

  if (normalized.length > 20) {
    throw new ModularLlmInputError('Use cases are limited to 20 entries.');
  }
  if (normalized.some((entry) => entry.length > 100)) {
    throw new ModularLlmInputError('Each use case must be 100 characters or fewer.');
  }
  return normalized;
}

function parseModelProfileInput(input = {}) {
  return {
    displayName: normalizeLimitedString(input.displayName, 'Display name', 200),
    useCases: normalizeUseCases(input.useCases),
    notes: normalizeLimitedString(input.notes, 'Notes', 5000),
    enabledForTesting: checkboxValue(input.enabledForTesting, false),
  };
}

function parsePipelineTestInput(input = {}) {
  const inputText = normalizeLimitedString(
    input.input,
    'Test input',
    MAX_TEST_INPUT_LENGTH,
    { required: true },
  );
  const maxRepairAttempts = Number(input.maxRepairAttempts ?? 1);
  if (![0, 1].includes(maxRepairAttempts)) {
    throw new ModularLlmInputError('Max repair attempts must be 0 or 1.');
  }

  return {
    inputText,
    maxRepairAttempts,
    persistGatewayRun: checkboxValue(input.persist, true),
    includeDiagnostics: checkboxValue(input.includeDiagnostics, true),
  };
}

function safeJsonSnapshot(value) {
  if (value === undefined || value === null) return null;
  try {
    const serialized = JSON.stringify(value);
    const bytes = Buffer.byteLength(serialized, 'utf8');
    if (bytes <= MAX_STORED_SNAPSHOT_BYTES) {
      return JSON.parse(serialized);
    }
    return {
      _truncated: true,
      originalBytes: bytes,
      preview: serialized.slice(0, MAX_TRUNCATED_PREVIEW_LENGTH),
    };
  } catch (error) {
    return {
      _unserializable: true,
      error: String(error.message || error).slice(0, 1000),
    };
  }
}

function unwrapGatewayPayload(payload) {
  if (payload?.detail && typeof payload.detail === 'object' && !Array.isArray(payload.detail)) {
    return payload.detail;
  }
  return payload;
}

function extractGatewayRunId(payload) {
  const artifact = unwrapGatewayPayload(payload);
  const value = artifact?.run_id
    || artifact?.runId
    || artifact?.details?.run_id
    || artifact?.error?.details?.run_id;
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
}

function extractOutput(payload) {
  const artifact = unwrapGatewayPayload(payload);
  const output = artifact?.output ?? artifact?.content ?? artifact?.answer ?? null;
  if (output === null || output === undefined) return null;
  if (typeof output === 'string') return output.slice(0, 1000000);
  try {
    return JSON.stringify(output, null, 2).slice(0, 1000000);
  } catch (error) {
    return String(output).slice(0, 1000000);
  }
}

function extractFailure(payload) {
  const artifact = unwrapGatewayPayload(payload);
  const errorPayload = artifact?.error
    || (typeof payload?.detail === 'string' ? payload.detail : null);
  if (!errorPayload) {
    return { type: null, message: null, details: null };
  }
  if (typeof errorPayload === 'string') {
    return { type: null, message: errorPayload.slice(0, 4000), details: null };
  }
  return {
    type: typeof errorPayload.type === 'string' ? errorPayload.type.slice(0, 200) : null,
    message: typeof errorPayload.message === 'string'
      ? errorPayload.message.slice(0, 4000)
      : null,
    details: safeJsonSnapshot(errorPayload.details || errorPayload),
  };
}

class ModularLlmAdminService {
  constructor({
    ModelProfileModel = ModularLlmModelProfile,
    TestRunModel = ModularLlmTestRun,
    gateway = new ModularLlmGatewayService(),
    now = () => new Date(),
  } = {}) {
    this.ModelProfileModel = ModelProfileModel;
    this.TestRunModel = TestRunModel;
    this.gateway = gateway;
    this.now = now;
  }

  getDashboardState() {
    return this.gateway.getDashboardState();
  }

  getRuntimeState() {
    return this.gateway.getRuntimeState();
  }

  getGatewayRun(runId) {
    return this.gateway.getRun(runId);
  }

  async listModelProfiles() {
    let query = this.ModelProfileModel.find({ serviceId: SERVICE_ID });
    if (query && typeof query.sort === 'function') {
      query = query.sort({ available: -1, bundleId: 1, stage: 1 });
    }
    return resolveQuery(query, { lean: true });
  }

  async syncModelCatalog({ updatedBy = '' } = {}) {
    const normalized = normalizeModelBundle(await this.gateway.getModels());
    const seenAt = this.now();
    const safeUpdatedBy = normalizeLimitedString(updatedBy, 'Updated by', 100);
    const operations = [
      {
        updateMany: {
          filter: { serviceId: SERVICE_ID, available: true },
          update: { $set: { available: false } },
        },
      },
      ...normalized.stages.map((stage) => ({
        updateOne: {
          filter: {
            serviceId: SERVICE_ID,
            bundleId: normalized.bundleId,
            stage: stage.stage,
          },
          update: {
            $set: {
              bundleDescription: normalized.bundleDescription,
              modelId: stage.modelId,
              revision: stage.revision,
              runtimeMode: normalized.runtimeMode,
              cirVersion: normalized.cirVersion,
              airVersion: normalized.airVersion,
              dtype: stage.dtype,
              attention: stage.attention,
              cacheDir: stage.cacheDir,
              localPath: stage.localPath,
              adapterPath: stage.adapterPath,
              maxInputTokens: stage.maxInputTokens,
              maxNewTokens: stage.maxNewTokens,
              temperature: stage.temperature,
              topP: stage.topP,
              topK: stage.topK,
              available: true,
              lastSeenAt: seenAt,
              gatewayConfig: stage.gatewayConfig,
            },
            $setOnInsert: {
              serviceId: SERVICE_ID,
              bundleId: normalized.bundleId,
              stage: stage.stage,
              displayName: `${stage.stage} · ${stage.modelId}`.slice(0, 200),
              useCases: defaultUseCases(stage.stage),
              enabledForTesting: true,
              firstSeenAt: seenAt,
              updatedBy: safeUpdatedBy,
            },
          },
          upsert: true,
        },
      })),
    ];

    const result = await this.ModelProfileModel.bulkWrite(operations, { ordered: true });
    return {
      bundleId: normalized.bundleId,
      stageCount: normalized.stages.length,
      matchedCount: result?.matchedCount || 0,
      modifiedCount: result?.modifiedCount || 0,
      upsertedCount: result?.upsertedCount || 0,
    };
  }

  async updateModelProfile(profileId, input = {}, { updatedBy = '' } = {}) {
    const normalizedId = normalizeLimitedString(profileId, 'Model profile ID', 100, {
      required: true,
    });
    const update = {
      ...parseModelProfileInput(input),
      updatedBy: normalizeLimitedString(updatedBy, 'Updated by', 100),
    };
    let query = this.ModelProfileModel.findOneAndUpdate(
      { _id: normalizedId, serviceId: SERVICE_ID },
      { $set: update },
      { new: true, runValidators: true },
    );
    const profile = await resolveQuery(query, { lean: true });
    if (!profile) {
      throw new ModularLlmInputError('Modular LLM model profile not found.', 404);
    }
    return profile;
  }

  async listTestRuns(limit = 30) {
    const normalizedLimit = Number.isSafeInteger(Number(limit))
      ? Math.min(Math.max(Number(limit), 1), MAX_RUN_LIST_LIMIT)
      : 30;
    let query = this.TestRunModel.find({ serviceId: SERVICE_ID });
    if (query && typeof query.sort === 'function') query = query.sort({ createdAt: -1 });
    if (query && typeof query.limit === 'function') query = query.limit(normalizedLimit);
    return resolveQuery(query, { lean: true });
  }

  getTestRun(runId) {
    const normalizedId = normalizeLimitedString(runId, 'Test run ID', 100, { required: true });
    return resolveQuery(
      this.TestRunModel.findOne({ _id: normalizedId, serviceId: SERVICE_ID }),
      { lean: true },
    );
  }

  findTestRunByGatewayRunId(runId) {
    const normalizedId = ModularLlmGatewayService.assertGatewayRunId(runId);
    return resolveQuery(
      this.TestRunModel.findOne({ gatewayRunId: normalizedId, serviceId: SERVICE_ID }),
      { lean: true },
    );
  }

  async finishTestRun(runId, update) {
    const query = this.TestRunModel.findByIdAndUpdate(
      runId,
      { $set: update },
      { new: true, runValidators: true },
    );
    return resolveQuery(query, { lean: true });
  }

  async createPipelineTest(input = {}, { requestedBy = '' } = {}) {
    const parsed = parsePipelineTestInput(input);
    const startedAt = this.now();
    const created = await this.TestRunModel.create({
      serviceId: SERVICE_ID,
      operation: 'pipeline',
      status: 'running',
      requestedBy: normalizeLimitedString(requestedBy, 'Requested by', 100),
      inputText: parsed.inputText,
      inputSha256: crypto.createHash('sha256').update(parsed.inputText).digest('hex'),
      maxRepairAttempts: parsed.maxRepairAttempts,
      persistGatewayRun: parsed.persistGatewayRun,
      includeDiagnostics: parsed.includeDiagnostics,
      startedAt,
    });
    const createdRun = plainDocument(created);
    const runId = String(createdRun._id);

    try {
      const payload = await this.gateway.runPipeline({
        input: parsed.inputText,
        maxRepairAttempts: parsed.maxRepairAttempts,
        persist: parsed.persistGatewayRun,
        includeDiagnostics: parsed.includeDiagnostics,
      });
      const completedAt = this.now();
      const artifact = unwrapGatewayPayload(payload);
      const failure = extractFailure(payload);
      const succeeded = artifact?.status !== 'failed' && !artifact?.error;
      const update = {
        status: succeeded ? 'succeeded' : 'failed',
        gatewayRunId: extractGatewayRunId(payload),
        gatewayStatus: typeof artifact?.status === 'string'
          ? artifact.status.slice(0, 100)
          : (succeeded ? 'succeeded' : 'failed'),
        bundleId: typeof artifact?.bundle_id === 'string' ? artifact.bundle_id.slice(0, 200) : null,
        failedStage: typeof artifact?.failed_stage === 'string'
          ? artifact.failed_stage.slice(0, 100)
          : null,
        output: extractOutput(payload),
        httpStatus: 200,
        errorType: failure.type,
        errorMessage: failure.message,
        errorDetails: failure.details,
        response: safeJsonSnapshot(payload),
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        completedAt,
      };
      return await this.finishTestRun(runId, update) || { ...createdRun, ...update };
    } catch (error) {
      const completedAt = this.now();
      const gatewayPayload = error?.response?.data || null;
      const artifact = unwrapGatewayPayload(gatewayPayload);
      const failure = extractFailure(gatewayPayload);
      const gatewaySnapshot = safeJsonSnapshot(gatewayPayload);
      const httpStatus = Number(error?.response?.status);
      const update = {
        status: 'failed',
        gatewayRunId: extractGatewayRunId(gatewayPayload),
        gatewayStatus: typeof artifact?.status === 'string'
          ? artifact.status.slice(0, 100)
          : 'failed',
        bundleId: typeof artifact?.bundle_id === 'string'
          ? artifact.bundle_id.slice(0, 200)
          : null,
        failedStage: typeof artifact?.failed_stage === 'string'
          ? artifact.failed_stage.slice(0, 100)
          : null,
        output: extractOutput(gatewayPayload),
        httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599
          ? httpStatus
          : 502,
        errorType: failure.type || (typeof error?.name === 'string' ? error.name.slice(0, 200) : null),
        errorMessage: failure.message
          || ModularLlmGatewayService.gatewayResponseError(error).slice(0, 4000),
        errorDetails: failure.details || gatewaySnapshot || safeJsonSnapshot({
          code: error?.code || null,
          message: error?.message || String(error),
        }),
        response: gatewaySnapshot,
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        completedAt,
      };

      logger.warning('Modular LLM pipeline test failed', {
        category: 'modular_llm_admin',
        metadata: {
          localRunId: runId,
          gatewayRunId: update.gatewayRunId,
          httpStatus: update.httpStatus,
          failedStage: update.failedStage,
          errorType: update.errorType,
        },
      });

      return await this.finishTestRun(runId, update) || { ...createdRun, ...update };
    }
  }
}

ModularLlmAdminService.MODEL_PROFILE_COLLECTION = MODEL_PROFILE_COLLECTION;
ModularLlmAdminService.TEST_RUN_COLLECTION = TEST_RUN_COLLECTION;
ModularLlmAdminService.MAX_TEST_INPUT_LENGTH = MAX_TEST_INPUT_LENGTH;
ModularLlmAdminService.ModularLlmInputError = ModularLlmInputError;
ModularLlmAdminService.normalizeModelBundle = normalizeModelBundle;
ModularLlmAdminService.parseModelProfileInput = parseModelProfileInput;
ModularLlmAdminService.parsePipelineTestInput = parsePipelineTestInput;
ModularLlmAdminService.safeJsonSnapshot = safeJsonSnapshot;

module.exports = ModularLlmAdminService;
