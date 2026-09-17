const logger = require('../utils/logger');
const { SCHEMA_VERSION, TaricError, fail, object, string, hash, validateRequest, validateFeedback,
  validateScope, validateEvidence, idempotencyKey, validateCatalog, validateResult } = require('../utils/taricContracts');
const { validateRecommendationRecord, validateFeedbackRecord, requestHash } = require('../utils/taricRecords');

// Configuration validation is not runtime readiness. No provider is instantiated here.
function validateInferenceConfig(config = { mode: 'disabled' }) {
  if (config?.mode === 'disabled') fail('PROVIDER_DISABLED');
  object(config, ['mode', 'backend_id', 'base_model_id', 'adapter_id', 'template_id', 'catalog',
    'deadline_ms', 'max_input_bytes', 'max_output_bytes', 'max_output_tokens'], 'CONFIG_NOT_READY');
  if (!['adapter', 'reviewed_baseline'].includes(config.mode)) fail('CONFIG_NOT_READY');
  for (const key of ['backend_id', 'base_model_id', 'template_id']) string(config[key], 100, 'CONFIG_NOT_READY');
  if (config.mode === 'adapter') string(config.adapter_id, 100, 'CONFIG_NOT_READY');
  else if (config.adapter_id !== null) fail('CONFIG_NOT_READY');
  for (const [key, max] of Object.entries({ deadline_ms: 60000, max_input_bytes: 65536,
    max_output_bytes: 4096, max_output_tokens: 1024 })) {
    if (!Number.isInteger(config[key]) || config[key] < 1 || config[key] > max) fail('CONFIG_NOT_READY');
  }
  return { ...config, catalog: validateCatalog(config.catalog) };
}
function readiness() {
  return { ready: false, code: 'PROVIDER_DISABLED', provider: null };
}
function validateProviderResult(result, evidence, request, catalog) {
  const validatedRequest = validateRequest(request);
  const facts = validateEvidence(evidence);
  const suggestion = validateResult(result, catalog, validatedRequest.input_hs_code);
  if ((validatedRequest.item_code && validatedRequest.item_code !== facts.gcode)
    || (validatedRequest.jan && validatedRequest.jan !== facts.jan)
    || suggestion.basis_fields.some((field) => !facts.facts[field])) fail('INVALID_RESULT');
  return suggestion;
}

function createTaricRecommendationService({ recommendationModel, feedbackModel, evidenceService,
  catalog = null, serviceLogger = logger } = {}) {
  const approvedCatalog = catalog === null ? null : validateCatalog(catalog);
  const find = (model, filter) => model.findOne(filter).maxTimeMS(2000).lean().exec();
  function replay(record, digest) {
    if (record.requestHash !== digest) fail('IDEMPOTENCY_CONFLICT');
    return record;
  }
  async function safe(operation) {
    try { return await operation(); } catch (error) {
      if (error instanceof TaricError) throw error;
      serviceLogger.error('TARIC persistence failed', { category: 'taric-recommendation',
        metadata: { code: 'STORAGE_FAILED' } });
      throw new TaricError('STORAGE_FAILED');
    }
  }
  async function insertOrReplay(model, filter, digest, value) {
    try {
      const created = await model.create({ ...filter, requestHash: digest, ...value });
      return created.toObject ? created.toObject() : created;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const winner = await find(model, filter);
      if (!winner) fail('IDEMPOTENCY_CONFLICT');
      return replay(winner, digest);
    }
  }
  async function prepare({ scope, key, request }) {
    const filter = { ...validateScope(scope), idempotencyKey: idempotencyKey(key) };
    const input = validateRequest(request);
    const digest = requestHash(input);
    return safe(async () => {
      const previous = await find(recommendationModel, filter);
      if (previous) return replay(previous, digest);
      let evidence = null;
      let errorCode = null;
      try { evidence = await evidenceService.resolve(input); } catch (error) {
        errorCode = error instanceof TaricError ? error.code : 'STORAGE_FAILED';
        if (!(error instanceof TaricError)) serviceLogger.warning('TARIC evidence preparation failed', {
          category: 'taric-recommendation', metadata: { code: errorCode },
        });
      }
      const record = validateRecommendationRecord({ schema_version: SCHEMA_VERSION, request: input,
        evidence, suggestion: null, versions: null, state: errorCode ? 'failed' : 'prepared', error_code: errorCode });
      return insertOrReplay(recommendationModel, filter, digest, { snapshot: record });
    });
  }
  async function recordFeedback({ scope, key, recommendationId, feedback }) {
    const owner = validateScope(scope);
    const filter = { ...owner, idempotencyKey: idempotencyKey(key) };
    string(recommendationId, 24, 'NOT_FOUND', /^[a-f0-9]{24}$/);
    const input = validateFeedback(feedback);
    const digest = hash({ schema_version: SCHEMA_VERSION, recommendationId, feedback: input });
    return safe(async () => {
      const parent = await find(recommendationModel, { ...owner, _id: recommendationId });
      if (!parent) fail('NOT_FOUND');
      const original = validateRecommendationRecord(parent.snapshot);
      const previous = await find(feedbackModel, filter);
      if (previous) return replay(previous, digest);
      const final = await find(feedbackModel, { ...owner, recommendationId });
      if (final) fail('IDEMPOTENCY_CONFLICT');
      const snapshot = validateFeedbackRecord({ selected_code: input.selected_code,
        decision: original.suggestion ? (original.suggestion.code === input.selected_code ? 'accepted' : 'changed') : 'manual',
        catalog_status: approvedCatalog ? (approvedCatalog.codes.includes(input.selected_code) ? 'approved_member' : 'not_approved') : 'unknown',
        catalog_id: approvedCatalog?.id || null, catalog_version: approvedCatalog?.version || null,
        missing_evidence: !original.evidence, verification: 'unverified', training_approved: false,
        recommendation_hash: hash(original) });
      return insertOrReplay(feedbackModel, filter, digest, { recommendationId, snapshot });
    });
  }
  return { prepare, recordFeedback, readiness };
}

module.exports = { createTaricRecommendationService, readiness, validateInferenceConfig, validateProviderResult };
