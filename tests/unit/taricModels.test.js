const mongoose = require('mongoose');
const { SCHEMA_VERSION, hash } = require('../../utils/taricContracts');
const { requestHash } = require('../../utils/taricRecords');

describe('dormant TARIC schemas (no Mongo connection)', () => {
  const before = mongoose.modelNames();
  const { createRecommendationSchema } = require('../../models/taric_recommendation');
  const { createFeedbackSchema } = require('../../models/taric_feedback');
  test('imports register no models and disable automatic collections/indexes', () => {
    expect(mongoose.modelNames()).toEqual(before);
    for (const schema of [createRecommendationSchema(), createFeedbackSchema()]) {
      expect(schema.options).toMatchObject({ autoIndex: false, autoCreate: false, bufferCommands: false, strict: 'throw' });
      expect(schema.indexes()[0]).toEqual([{ ownerId: 1, principalId: 1, idempotencyKey: 1 }, { unique: true }]);
      expect(schema.indexes().some(([, options]) => options.expireAfterSeconds !== undefined)).toBe(false);
    }
  });
  test('validates snapshots and prohibits verification escalation and missing scopes', async () => {
    const connection = mongoose.createConnection();
    const Recommendation = connection.model('SyntheticRecommendation', createRecommendationSchema());
    const Feedback = connection.model('SyntheticFeedback', createFeedbackSchema());
    const request = { jan: '00123456', descriptive_name: 'Test', input_hs_code: '123456' };
    const record = { ownerId: 'owner', principalId: 'principal', idempotencyKey: 'key-000000000001', requestHash: requestHash(request),
      snapshot: { schema_version: SCHEMA_VERSION, request, evidence: null, suggestion: null, versions: null,
        state: 'failed', error_code: 'EVIDENCE_NOT_FOUND' } };
    await expect(new Recommendation(record).validate()).resolves.toBeUndefined();
    await expect(new Recommendation({ ...record, requestHash: 'a'.repeat(64) }).validate()).rejects.toThrow();
    await expect(new Recommendation({ ...record, ownerId: null }).validate()).rejects.toThrow();
    expect(() => new Recommendation({ ...record, raw: 'not allowed' })).toThrow();
    const feedback = { ...record, recommendationId: new mongoose.Types.ObjectId(), snapshot: { selected_code: '1234560000',
      decision: 'accepted', catalog_status: 'unknown', catalog_id: null, catalog_version: null,
      missing_evidence: false, verification: 'unverified', training_approved: false, recommendation_hash: hash(record.snapshot) } };
    feedback.requestHash = hash({ schema_version: SCHEMA_VERSION, recommendationId: feedback.recommendationId.toString(),
      feedback: { selected_code: feedback.snapshot.selected_code } });
    await expect(new Feedback(feedback).validate()).resolves.toBeUndefined();
    await expect(new Feedback({ ...feedback, requestHash: 'a'.repeat(64) }).validate()).rejects.toThrow();
    await expect(new Feedback({ ...feedback, snapshot: { ...feedback.snapshot, verification: 'verified' } }).validate()).rejects.toThrow();
    await expect(new Feedback({ ...feedback, snapshot: { ...feedback.snapshot, training_approved: true } }).validate()).rejects.toThrow();
    await expect(Recommendation.updateOne({}, { $set: { ownerId: 'other' } })).rejects.toThrow('append-only');
    await expect(Feedback.deleteMany({})).rejects.toThrow('append-only');
    await connection.close();
  });
});
