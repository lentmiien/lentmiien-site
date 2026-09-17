const c = require('../../utils/taricContracts');
const { snapshot } = require('../../services/taricEvidenceService');
const { readiness, validateInferenceConfig, validateProviderResult } = require('../../services/taricRecommendationService');

const request = { jan: '00123456', item_code: 'FIGURE-0001', descriptive_name: 'Figure', input_hs_code: '001234' };
const catalog = { id: 'synthetic', version: 'test-1', approved: true, codes: ['0012340000', '9999990000'] };
const row = { gcode: request.item_code, listing: { gcode: request.item_code, itemName: 'Test figure' },
  details: { janCode: request.jan, itemName: 'Factual figure', specifications: 'Plastic', details: 'Small model' } };

describe('TARIC strict contracts', () => {
  test('preserves string identities and leading zeros without checksum or country inference', () => {
    expect(c.validateRequest(request)).toEqual(request);
    expect(c.jan('0000000000000')).toBe('0000000000000');
    expect(c.hash({ b: 2, a: 1 })).toBe(c.hash({ a: 1, b: 2 }));
  });
  test.each(['FIGURE-205029', 'FIGURE-100001', 'GOODS-200002', 'GOODS-300003'])(
    'accepts the gcode form %s already documented in the API or existing fixtures', (itemCode) => {
      expect(c.validateRequest({ ...request, item_code: itemCode }).item_code).toBe(itemCode);
    });
  test.each([
    { jan: 12345678 }, { jan: '123' }, { jan: '00123456\n' }, { item_code: 'FIGURE-1\n' },
    { jan: ' 00123456' }, { item_code: 'https://amiami.com/a' },
    { item_code: '../FIGURE-1' }, { item_code: 'A/B' }, { item_code: 'A?x' }, { item_code: 'A%2fB' },
    { item_code: 'A_1' }, { item_code: 'A'.repeat(65) }, { input_hs_code: 123456 },
    { input_hs_code: '' }, { input_hs_code: null }, { input_hs_code: '1234' },
    { input_hs_code: '12345600' }, { descriptive_name: 'a'.repeat(501) }, { ownerId: 'hijack' },
    { specifications: 'injected' }, { descriptive_name: '\u0000name' },
  ])('rejects malformed and unknown fields %j', (change) => {
    expect(() => c.validateRequest({ ...request, ...change })).toThrow(c.TaricError);
  });
  test('requires identifiers and HS6 and rejects oversized/deep objects', () => {
    expect(() => c.validateRequest({ descriptive_name: 'n', input_hs_code: '123456' })).toThrow();
    expect(() => c.validateRequest({ jan: '00123456', descriptive_name: 'n' })).toThrow();
    expect(() => c.validateRequest({ ...request, jan: { nested: 'x'.repeat(5000) } })).toThrow();
    expect(() => c.idempotencyKey('short')).toThrow();
    expect(() => c.idempotencyKey('key-123456789012\n')).toThrow();
    expect(() => c.idempotencyKey('x'.repeat(129))).toThrow();
    expect(() => c.validateScope({ ownerId: 'a', principalId: 'b', userId: 'c' })).toThrow();
  });
  test('feedback cannot assert decision, verification, facts, confidence or training approval', () => {
    expect(c.validateFeedback({ selected_code: '0012340000' })).toEqual({ selected_code: '0012340000' });
    for (const key of ['decision', 'verification', 'training_approved', 'confidence', 'facts']) {
      expect(() => c.validateFeedback({ selected_code: '0012340000', [key]: true })).toThrow();
    }
    expect(() => c.validateFeedback({ selected_code: 1234567890 })).toThrow();
  });
  test('strict catalog output validation allows HS disagreement as a warning', () => {
    const evidence = snapshot(row, request, 'local_item_code');
    const result = validateProviderResult({ code: '9999990000', basis_fields: ['name'] }, evidence, request, catalog);
    expect(result).toMatchObject({ warnings: ['input_hs_prefix_mismatch'], verification: 'unverified', training_approved: false });
    expect(() => validateProviderResult({ code: '1111111111', basis_fields: ['name'] }, evidence, request, catalog))
      .toThrow('CATALOG_REJECTED');
    for (const invalid of ['{"code":"0012340000"}', { code: '0012340000', basis_fields: ['name'], confidence: 1 },
      { code: 12340000, basis_fields: ['name'] }, { code: '0012340000', basis_fields: ['remarks'] },
      { code: '0012340000', basis_fields: ['name', 'name'] }]) {
      expect(() => validateProviderResult(invalid, evidence, request, catalog)).toThrow();
    }
    expect(() => c.validateResult({ code: '0012340000', basis_fields: ['name'] }, { ...catalog, approved: false }, '001234')).toThrow();
  });
  test('snapshot hash covers exact facts, metadata and version, not listingHash', () => {
    const evidence = snapshot({ ...row, listingHash: 'unrelated' }, request, 'local_item_code');
    expect(evidence.facts.name).toBe('Factual figure');
    expect(evidence.provenance.identity).toBe('both_agree');
    expect(evidence.warnings).toEqual(['source_timestamp_missing']);
    expect(snapshot({ ...row, listingHash: 'changed' }, request, 'local_item_code')).toEqual(evidence);
    const changed = JSON.parse(JSON.stringify(evidence));
    expect(c.validateEvidence(changed)).toEqual(evidence);
    changed.facts.name = 'Tampered';
    expect(() => c.validateEvidence(changed)).toThrow('EVIDENCE_INVALID');
    const { hash, ...content } = evidence;
    expect(hash).toBe(c.hash(content));
    expect(c.hash({ ...content, schema_version: 'different' })).not.toBe(hash);
  });
  test('missing specs do not require invented facts; HTML remains inert source text', () => {
    const evidence = snapshot({ ...row, details: { janCode: request.jan, details: '<b>Source</b>' } }, request, 'local_item_code');
    expect(evidence.facts).toMatchObject({ name: 'Test figure', specifications: null, details: '<b>Source</b>' });
    expect(evidence.warnings).toEqual(['specifications_missing', 'listing_name_fallback', 'source_timestamp_missing']);
    expect(evidence.provenance.fields.specifications).toBe(false);
    expect(() => snapshot({ ...row, details: { ...row.details, specifications: 'x'.repeat(12001) } }, request, 'local_item_code')).toThrow();
  });
  test('separate scode provenance is bounded, hash-covered and never a result basis field', () => {
    const evidence = snapshot({ ...row, details: { ...row.details, scode: 'separate_upstream_code' } }, request, 'local_item_code');
    expect(c.validateEvidence(evidence)).toEqual(evidence);
    expect(evidence.hash).not.toBe(snapshot(row, request, 'local_item_code').hash);
    expect(() => c.validateEvidence({ ...evidence, provenance: { ...evidence.provenance, scode: 'tampered' } }))
      .toThrow('EVIDENCE_INVALID');
    for (const scode of [42, 'x'.repeat(65), { gcode: request.item_code }]) {
      expect(() => snapshot({ ...row, details: { ...row.details, scode } }, request, 'local_item_code'))
        .toThrow('EVIDENCE_INVALID');
    }
    expect(() => validateProviderResult({ code: '0012340000', basis_fields: ['scode'] }, evidence, request, catalog))
      .toThrow('INVALID_RESULT');
  });
  test('disabled inference remains disabled even after a configuration is structurally validated', () => {
    expect(readiness()).toEqual({ ready: false, code: 'PROVIDER_DISABLED', provider: null });
    expect(() => validateInferenceConfig()).toThrow('PROVIDER_DISABLED');
    const config = { mode: 'adapter', backend_id: 'synthetic', base_model_id: 'synthetic-base', adapter_id: 'test-only',
      template_id: 't1', catalog, deadline_ms: 1000, max_input_bytes: 1000, max_output_bytes: 1000, max_output_tokens: 100 };
    expect(validateInferenceConfig(config)).toEqual(config);
    expect(() => validateInferenceConfig({ ...config, adapter_id: null })).toThrow();
    expect(() => validateInferenceConfig({ ...config, deadline_ms: 60001 })).toThrow();
    expect(validateInferenceConfig({ ...config, mode: 'reviewed_baseline', adapter_id: null }).adapter_id).toBeNull();
    expect(readiness().ready).toBe(false);
  });
});
