const { createTaricRecommendationService, validateProviderResult } = require('../../services/taricRecommendationService');
const { snapshot } = require('../../services/taricEvidenceService');
const { TaricError, SCHEMA_VERSION } = require('../../utils/taricContracts');
const { requestHash } = require('../../utils/taricRecords');

const scope = { ownerId: 'owner1', principalId: 'integration1' };
const request = { item_code: 'FIGURE-1', descriptive_name: 'Figure', input_hs_code: '123456' };
const key = 'recommendation-key-0001';
const feedbackKey = 'feedback-key-0001';
const evidence = snapshot({ gcode: 'FIGURE-1', listing: { gcode: 'FIGURE-1', itemName: 'Source name' } }, request, 'local_item_code');
const catalog = { id: 'synthetic', version: '1', approved: true, codes: ['1234560000'] };
function model() {
  const rows = [];
  const find = (filter) => rows.find((row) => Object.entries(filter).every(([key, value]) => row[key] === value));
  return { rows, findOne: jest.fn((filter) => {
    const query = { maxTimeMS: () => query, lean: () => query, exec: async () => find(filter) || null };
    return query;
  }), create: jest.fn(async (value) => {
    if (rows.some((row) => row.ownerId === value.ownerId && row.principalId === value.principalId
      && (row.idempotencyKey === value.idempotencyKey
        || (value.recommendationId && row.recommendationId === value.recommendationId)))) {
      throw Object.assign(new Error('duplicate'), { code: 11000 });
    }
    const row = { _id: (rows.length + 1).toString(16).padStart(24, '0'), ...JSON.parse(JSON.stringify(value)) };
    rows.push(row);
    return row;
  }) };
}
function setup(options = {}) {
  const recommendationModel = model();
  const feedbackModel = model();
  const evidenceService = { resolve: jest.fn().mockResolvedValue(evidence) };
  const serviceLogger = { warning: jest.fn(), error: jest.fn() };
  return { recommendationModel, feedbackModel, evidenceService, serviceLogger,
    service: createTaricRecommendationService({ recommendationModel, feedbackModel, evidenceService, serviceLogger, ...options }) };
}
describe('internal TARIC preparation and feedback only', () => {
  test('prepares immutable evidence without calling a provider; replay and conflict are scoped', async () => {
    const provider = { generate: jest.fn() };
    const state = setup({ provider }); // Unsupported injection cannot enable inference.
    const first = await state.service.prepare({ scope, key, request });
    expect(first.snapshot).toMatchObject({ state: 'prepared', suggestion: null, versions: null, evidence });
    expect(state.service.readiness().ready).toBe(false);
    expect(provider.generate).not.toHaveBeenCalled();
    expect(await state.service.prepare({ scope, key, request })).toEqual(first);
    expect(state.evidenceService.resolve).toHaveBeenCalledTimes(1);
    await expect(state.service.prepare({ scope, key, request: { ...request, descriptive_name: 'Changed' } }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await state.service.prepare({ scope: { ...scope, principalId: 'other' }, key, request });
    expect(state.recommendationModel.rows).toHaveLength(2);
  });
  test('concurrent inserts converge on the unique scoped record; work is not exactly once', async () => {
    const state = setup();
    const [a, b] = await Promise.all([state.service.prepare({ scope, key, request }), state.service.prepare({ scope, key, request })]);
    expect(a._id).toBe(b._id);
    expect(state.recommendationModel.rows).toHaveLength(1);
    expect(state.evidenceService.resolve).toHaveBeenCalledTimes(2);
  });
  test('persists a lookup failure with an ID for manual feedback, without verification upgrade', async () => {
    const state = setup();
    state.evidenceService.resolve.mockRejectedValue(new TaricError('FETCH_DISABLED'));
    const parent = await state.service.prepare({ scope, key, request });
    expect(parent._id).toMatch(/^[a-f0-9]{24}$/);
    expect(parent.snapshot).toMatchObject({ state: 'failed', evidence: null, error_code: 'FETCH_DISABLED' });
    const feedback = await state.service.recordFeedback({ scope, key: feedbackKey, recommendationId: parent._id,
      feedback: { selected_code: '0000000000' } });
    expect(feedback.snapshot).toMatchObject({ decision: 'manual', missing_evidence: true, catalog_status: 'unknown',
      verification: 'unverified', training_approved: false });
  });
  test.each(['ownerId', 'principalId'])('denies foreign feedback by %s without disclosing parent', async (field) => {
    const state = setup();
    const parent = await state.service.prepare({ scope, key, request });
    await expect(state.service.recordFeedback({ scope: { ...scope, [field]: 'foreign' }, key: feedbackKey,
      recommendationId: parent._id, feedback: { selected_code: '1234560000' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(state.feedbackModel.create).not.toHaveBeenCalled();
  });
  test('feedback replays same choice, rejects changes and rejects second final choice under another key', async () => {
    const state = setup({ catalog });
    const parent = await state.service.prepare({ scope, key, request });
    const args = { scope, key: feedbackKey, recommendationId: parent._id, feedback: { selected_code: '9999999999' } };
    const first = await state.service.recordFeedback(args);
    expect(first.snapshot.catalog_status).toBe('not_approved');
    expect(await state.service.recordFeedback(args)).toEqual(first);
    await expect(state.service.recordFeedback({ ...args, feedback: { selected_code: '1234560000' } }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(state.service.recordFeedback({ ...args, key: 'another-feedback-key' }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  test.each([['1234560000', 'accepted'], ['9999990000', 'changed']])(
    'derives %s as %s from synthetic saved suggestion, never client confidence', async (selectedCode, decision) => {
      const state = setup({ catalog });
      const suggestion = validateProviderResult({ code: '1234560000', basis_fields: ['name'] }, evidence, request, catalog);
      const parent = await state.recommendationModel.create({ ...scope, idempotencyKey: key, requestHash: requestHash(request),
        snapshot: { schema_version: SCHEMA_VERSION, request, evidence, suggestion, state: 'suggested', error_code: null,
          versions: { backend_id: 'synthetic', base_model_id: 'synthetic', adapter_id: null, template_id: 'synthetic',
            catalog_id: catalog.id, catalog_version: catalog.version } } });
      const result = await state.service.recordFeedback({ scope, key: feedbackKey, recommendationId: parent._id,
        feedback: { selected_code: selectedCode } });
      expect(result.snapshot).toMatchObject({ decision, verification: 'unverified', training_approved: false });
    });
  test('validation fails before storage; operational errors are logged without contents', async () => {
    const state = setup();
    await expect(state.service.prepare({ scope, key, request: { ...request, ownerId: 'evil' } })).rejects.toThrow();
    expect(state.recommendationModel.findOne).not.toHaveBeenCalled();
    state.recommendationModel.create.mockRejectedValue(new Error('private database information'));
    await expect(state.service.prepare({ scope, key, request })).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
    expect(JSON.stringify(state.serviceLogger.error.mock.calls)).not.toContain('private database information');
  });
});
