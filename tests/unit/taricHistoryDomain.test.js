const d = require('../../services/taric/historyDomain');
const { request, verified, id } = require('../helpers/taricHistoryFixture');
test('human choice, valid proposal and rejected candidate stay distinct; export allowlist strips secret extras', () => {
  const raw = request(1, { result: null, error: 'CATALOG_REJECTED', diagnostics: { proposal: { taric_code: '9999999999', description: '<img src=x onerror=alert(1)>' }, reasoning: 'SECRET', visibleText: 'SECRET' }, headers: 'SECRET', sessionId: 'SECRET' });
  const row = d.derive(raw);
  expect(row.suggestion).toBeNull(); expect(row.diagnostic.label).toContain('UNVALIDATED');
  expect(row.feedback.code).toBe('0000000002'); expect(row.reviewStatus).toBe('unreviewed');
  expect(JSON.stringify(row)).not.toContain('SECRET');
  expect(d.candidate(verified())).toMatchObject({ targetCode: '0000000002', approvedDescription: null, formatterPending: true });
});
test('missing evidence permits a verified label but blocks source candidate profile; specifications optional', () => {
  expect(verified(1, '9999999999', { evidence: null })).toMatchObject({ reviewStatus: 'verified', eligible: false, reasons: ['missing_full_item_name'] });
  expect(verified(1, '9999999999', { evidence: { facts: { name: 'Synthetic name', specifications: null } } }).eligible).toBe(true);
  expect(verified().warnings).toContain('approved_description_missing_formatter_pending');
});
test('late feedback, even same code, binds a new snapshot and makes prior review stale', () => {
  const raw = request(1, { feedback: [] }); const before = d.derive(raw);
  raw.reviews = [{ revision: 1, latest: { status: 'verified', target: '0000000001', sourceHash: before.sourceHash } }];
  expect(d.derive(raw).stale).toBe(false);
  raw.feedback = [{ _id: id(100), selected_code: '0000000001' }];
  expect(d.derive(raw)).toMatchObject({ stale: true, eligible: false, reviewStatus: 'needs_review' });
});
test.each([{ owner: 'foreign' }, { search: { $ne: '' } }, { from: '2026-02-30' }, { from: '2026-09-10', to: '2026-09-09' }, { from: 'today' }, { mode: 'all' }, { state: 'random' }, { review: 'approved' }, { error: 'arbitrary' }, { jan: '1' }, { code: '123' }, { cursor: 'bad' }, { search: 'a'.repeat(101) }, JSON.parse('{"__proto__":{}}')])('rejects malformed/unknown query %j', input => expect(() => d.filters(input)).toThrow());
test('UTC inclusive days, literal search, feedback filters and same-population denominator', () => {
  const row = verified();
  expect(d.matches(row, d.filters({ from: '2026-09-20', to: '2026-09-20', feedback: 'changed', eligible: 'yes' }))).toBe(true);
  expect(d.matches(row, { search: '.*' })).toBe(false);
  expect(d.matches(row, { from: '2026-09-21' })).toBe(false);
  const matched = [row, d.derive(request(2, { feedback: [] }))].filter(r => d.matches(r, { feedback: 'present' }));
  expect(d.stats(matched)).toMatchObject({ total: 1, feedback: 1, decisions: { changed: { count: 1, denominator: 1 } } });
  expect(d.stats([])).toMatchObject({ total: 0, decisions: { accepted: { count: 0, denominator: 0 } } });
});
test('deterministic newest and balanced round robin with caps and exact partition of skip reasons', () => {
  const rows = [verified(1, '0000000001'), verified(2, '0000000001'), verified(3, '0000000001'), verified(4, '0000000002'), verified(5, '0000000002')];
  const newest = d.select(rows, { limit: 3, perCode: 2 });
  expect(newest.selected.map(r => r.id)).toEqual([id(5), id(4), id(3)]);
  const balanced = d.select(rows, { mode: 'balanced', limit: 3, perCode: 1 });
  expect(balanced.selected.map(r => r.id)).toEqual([id(3), id(5)]);
  expect(d.select([...rows].reverse(), { mode: 'balanced', limit: 3, perCode: 1 })).toEqual(balanced);
  expect(Object.values(balanced.summary.excludedByReason).reduce((a, b) => a + b, 0) + balanced.selected.length).toBe(rows.length);
});
test('duplicate normalized inputs choose latest review; contradictory JAN and identical inputs exclude all', () => {
  const a = verified(1); const b = verified(2, '0000000002', { input: request(1).input, evidence: request(1).evidence });
  expect(d.select(d.classify([a, b]), {}).selected.map(r => r.id)).toEqual([id(2)]);
  const contradiction = { ...b, review: { ...b.review, target: '9999999999' } };
  expect(d.classify([a, contradiction]).every(r => r.reasons.includes('conflicting_verified_targets'))).toBe(true);
  const variant = verified(3, '9999999999', { input: { ...request(3).input, jan: a.inputs.jan } });
  expect(d.classify([a, variant]).every(r => !r.eligible)).toBe(true);
  const stale = { ...contradiction, stale: true };
  expect(d.classify([a, stale])[0].eligible).toBe(true);
});
test('independent held-out normalized identities are excluded without treating v0 as a holdout', () => {
  const row = verified();
  expect(d.classify([row], [{ overlapHash: row.overlapHash }])[0].reasons).toContain('independent_holdout_overlap');
  expect(d.classify([row], [{ sourceHash: row.sourceIdentityHash }])[0].eligible).toBe(false);
  expect(d.classify([row], [])[0].eligible).toBe(true);
});
test.each([{ mode: 'oversample' }, { limit: 0 }, { limit: 201 }, { perCode: 101 }, { perCode: 1.5 }, { owner: 'foreign' }])('selector rejects unsafe options %j', input => expect(() => d.options(input)).toThrow());

test('a captured accepted diagnostic is not mislabeled as a rejected proposal', () => {
  const row = d.derive(request(1, { diagnostics: { applicable: true, proposal: { taric_code: '0000000001', description: 'Synthetic' } } }));
  expect(row.diagnostic).toBeNull(); expect(row.suggestion.code).toBe('0000000001');
});
test('history operations bound concurrent work and release slots after failure', async () => {
  const { createHistory } = require('../../services/taric/history');
  const { fail } = require('../../utils/taricContracts');
  let release; const gate = new Promise(resolve => { release = resolve; });
  const history = createHistory({ models: {}, adminPrincipal: async () => { await gate; fail('FORBIDDEN'); } });
  const first = history.list('a'.repeat(24), {}).catch(e => e.code);
  const second = history.list('a'.repeat(24), {}).catch(e => e.code);
  await expect(history.list('a'.repeat(24), {})).rejects.toThrow('RATE_LIMITED');
  release(); expect(await Promise.all([first, second])).toEqual(['FORBIDDEN', 'FORBIDDEN']);
  await expect(history.list('a'.repeat(24), {})).rejects.toThrow('FORBIDDEN');
});
