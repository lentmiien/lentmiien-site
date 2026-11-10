const exporter = require('../../services/taric/benchmarkExport');
const importer = require('../../services/taric/importer');
const domain = require('../../services/taric/historyDomain');
const { verified, request, id } = require('../helpers/taricHistoryFixture');

test('530 verified cases produce an importable 500-case balanced benchmark with exact human labels', async () => {
  const rows = Array.from({ length: 530 }, (_, index) => verified(index + 1, index < 520 ? '0000000002' : '0000000003'));
  const result = await exporter.build(rows);
  expect(result.summary).toMatchObject({ available: 530, selected: 500, distinctCodes: 2,
    excludedByReason: { overall_limit: 30 }, perCode: { '0000000002': 490, '0000000003': 10 } });
  expect(result.selected.slice(0, 2).map(row => row.target)).toEqual(['0000000002', '0000000003']);
  const parsed = await importer.preview(Buffer.from(result.csv));
  expect(parsed.manifest).toMatchObject({ rows: 500, accepted: 500, duplicates: 0, distinctCodes: 2, sha256: result.sha256 });
  expect(parsed.cases[0].target).toBe('0000000002');
  expect(parsed.cases[0].provenance).toContain(`verified-history:${id(520)};review:1;source:`);
  expect((await exporter.build([...rows].reverse())).csv).toBe(result.csv);
});

test('keeps newest unique JAN/input representatives, with no per-code cap or duplicate backfill', async () => {
  const one = verified(1);
  const sameJan = verified(2, '0000000002', { input: { ...request(2).input, jan: one.inputs.jan } });
  const sameInput = verified(3, '0000000002', { input: { ...request(1).input, jan: request(3).input.jan }, evidence: request(1).evidence });
  const result = await exporter.build(domain.classify([one, sameJan, sameInput]));
  expect(result.selected.map(row => row.id)).toEqual([id(3), id(2)]);
  expect(result.summary.excludedByReason).toEqual({ duplicate_product_or_input: 1 });
  expect((await exporter.build(Array.from({ length: 300 }, (_, i) => verified(i + 1)))).summary.selected).toBe(300);
});

test('preserves literal CSV inputs, quotes, unicode, line breaks, leading zeros and optional approved descriptions', async () => {
  const row = verified(1, '0000000002', { input: { jan: '00123456', descriptive_name: '=literal, "category"', input_hs_code: '010101', test: true },
    evidence: { facts: { name: '日本語 "item", name', specifications: 'one\r\ntwo, "three"\nfour' } } });
  row.review.approvedDescription = 'Reviewed, "description"';
  const empty = verified(2, '0000000003', { evidence: { facts: { name: 'Another item', specifications: null } } });
  const result = await exporter.build([row, empty]);
  const parsed = await importer.preview(Buffer.from(result.csv));
  expect(parsed.cases[0]).toMatchObject({ input: row.canonical, target: row.review.target, summary: row.review.approvedDescription, source_id: '00123456' });
  expect(parsed.cases[1]).toMatchObject({ input: { specs: '' }, summary: '' });
  expect(result.csv).not.toContain('Synthetic proposal');
  expect(result.csv).not.toContain('Synthetic verification');
});

test('excludes unreviewed, missing, stale, conflicting, busy, invalid and protected labels', async () => {
  const stale = verified(2); stale.eligible = false; stale.reasons = ['stale_source'];
  const busy = verified(3); busy.eligible = false; busy.reasons = ['local_reprocess_running'];
  const longName = verified(4, '0000000002', { evidence: { facts: { name: 'x'.repeat(1001) } } });
  const conflict = verified(5, '0000000003', { input: request(6).input });
  const rows = domain.classify([domain.derive(request(1)), stale, busy, longName, conflict, verified(6), verified(7), verified(8, '0000000002', { evidence: null })],
    [{ overlapHash: verified(7).overlapHash }]);
  const result = await exporter.build(rows);
  expect(result.summary.selected).toBe(0);
  expect(result.summary.excludedByReason).toEqual({ unreviewed: 1, stale_source: 1, local_reprocess_running: 1,
    invalid_benchmark_input: 1, conflicting_verified_targets: 2, independent_holdout_overlap: 1, missing_full_item_name: 1 });
});

test('excludes known v0 input, JAN and name overlap and keeps independent cases', async () => {
  const row = verified(1);
  const parsed = await importer.preview(Buffer.from((await exporter.build([row])).csv));
  const sameJan = verified(2, '0000000002', { input: { ...request(2).input, jan: row.inputs.jan } });
  const sameName = verified(3, '0000000002', { evidence: request(1).evidence });
  const training = { _id: 'v0', cases: [...parsed.cases, { sourceHash: row.sourceIdentityHash }] };
  const result = await exporter.build([row, sameJan, sameName, verified(4)], {}, training);
  expect(result.summary).toMatchObject({ selected: 1, excludedByReason: { known_training_overlap: 3 } });
  expect(result.trainingReference.id).toBe('v0');
});

test.each([{ limit: 0 }, { limit: 501 }, { limit: 1.5 }, { limit: '500' }, { limit: null }, { perCode: 20 }, null])('rejects invalid export options %j', value => {
  expect(() => exporter.options(value)).toThrow('INVALID_REQUEST');
});

test('fails explicitly at the importer byte ceiling instead of returning a partial benchmark', async () => {
  const rows = Array.from({ length: 200 }, (_, i) => verified(i + 1, '0000000002', {
    evidence: { facts: { name: `Large ${i}`, specifications: 'x'.repeat(12000) } },
  }));
  await expect(exporter.build(rows)).rejects.toMatchObject({ historyStatus: 413, historyCode: expect.stringContaining('reduce the row limit') });
  expect((await exporter.build(rows, { limit: 10 })).manifest.accepted).toBe(10);
});
