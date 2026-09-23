const { derive } = require('../../services/taric/historyDomain');
const actor = 'a'.repeat(24);
const id = n => n.toString(16).padStart(32, '0');
function request(n = 1, overrides = {}) {
  const row = { _id: id(n), owner: 'synthetic-owner', principal: 'integration', key: `synthetic-key-${n}`,
    input: { jan: String(10000000 + n), descriptive_name: `Synthetic category ${n}`, input_hs_code: '950300', test: true },
    evidence: { facts: { name: `Synthetic 商品 ${n}`, specifications: 'Synthetic line 1\nSynthetic line 2', details: null }, hash: 'b'.repeat(64), provenance: { source: 'amiami', fetched_at: '2026-09-01T00:00:00.000Z' } },
    result: { taric_code: '0000000001', description: 'Synthetic proposal' }, admission: { adapter: 'synthetic-adapter', fingerprint: 'c'.repeat(64) },
    state: 'complete', active: false, createdAt: new Date('2026-09-20T12:00:00Z'), finishedAt: new Date('2026-09-20T12:00:01Z'),
    feedback: [{ _id: id(n + 10000), selected_code: '0000000002', decision: 'changed', createdAt: new Date('2026-09-20T13:00:00Z') }], ...overrides };
  if (row.result === null && overrides.feedback === undefined) row.feedback[0].decision = 'manual';
  return row;
}
function verified(n = 1, code = '0000000002', overrides = {}) {
  const raw = request(n, overrides); const source = derive(raw);
  raw.reviews = [{ revision: 1, latest: { revision: 1, status: 'verified', target: code, sourceHash: source.sourceHash,
    approvedDescription: null, actor, at: new Date(Date.UTC(2026, 8, 21, 0, 0, n)).toISOString(), note: 'Synthetic verification', correction: false } }];
  return derive(raw);
}
module.exports = { actor, id, request, verified };
