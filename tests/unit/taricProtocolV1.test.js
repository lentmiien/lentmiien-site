const { input, render, payload, strictJson, output, hs, SYSTEM } = require('../../utils/taricProtocol');
const { preview, draft, overlaps } = require('../../services/taric/importer');
const { selectWinner, configuration } = require('../../services/taric/gate');
const { hash } = require('../../utils/taricProtocol');
const row = { descriptive_name: 'Synthetic toy', full_item_name: 'Synthetic plastic object', specs: '', hs_code: '9503.00' };
const csv = 'descriptive_name,full_item_name,specs,hs_code,taric_code,description_summary\nSynthetic toy,Synthetic plastic object,,9503.00,0000000001,Test description\n';
const review = { targetsReviewed: true, independent: true, trainingExcluded: true, provenance: 'Synthetic independent fixture', reviewer: 'test', sourceLineage: [], minExact: 1, maxInvalid: 0 };
test.each([undefined, false, true])('literal optional test flag %s', test => {
  const value = { item_code: 'TEST-1', descriptive_name: 'Synthetic', input_hs_code: '9503.00', ...(test === undefined ? {} : { test }) };
  expect(input(value).test).toBe(test === true); expect(input(value).input_hs_code).toBe('950300');
});
test.each(['true', 'false', 1, null, {}, []])('reject nonboolean flag %p', test => expect(() => input({ item_code: 'TEST-1', descriptive_name: 'Synthetic', input_hs_code: '950300', test })).toThrow('INVALID_REQUEST'));
test('caller facts, URL and unknown fields denied', () => {
  for (const field of ['facts', 'url', 'owner', 'adapter']) expect(() => input({ item_code: 'TEST-1', descriptive_name: 'Synthetic', input_hs_code: '950300', [field]: 'x' })).toThrow('INVALID_REQUEST');
});
test('trained literals retain empty spec block and dotted HS', () => {
  expect(render(row)).toBe('Please give me a description and suitable TARIC code for the following item:\n\nCategory: Synthetic toy\n\n### Synthetic plastic object\n\n\n\nOur HS code: 9503.00');
  expect(hs('0000.01')).toBe('000001');
  const p = payload(row, 'taric-v1-20260917-2');
  expect(p.messages[0]).toEqual({ role: 'system', content: SYSTEM });
  expect(p).toMatchObject({ do_sample: false, temperature: 0, repetition_penalty: 1.05, max_new_tokens: 256 });
  expect(p.response_format).toBeUndefined();
  expect(() => payload({ ...row, specs: '界'.repeat(1000) }, 'test')).toThrow('TOKEN_BUDGET');
});
test.each(['{"taric_code":"0000000001","taric_code":"0000000002","description":"x"}',
  '{"taric_code":"0000000001","description":""}', '{"taric_code":1,"description":"x"}',
  '```json\n{"taric_code":"0000000001","description":"x"}\n```',
  '{"taric_code":"0000000001","description":"x"} trailing', '{"taric_code":"0000000001"}',
  '{"taric_code":"0000000001","description":"x","extra":1}', '{"taric_code":"0000000001","description":"x"',
  '{"__proto__":{},"taric_code":"0000000001","description":"x"}'])('strict output rejects %s', content => expect(() => output({ content }, ['0000000001'])).toThrow('INVALID_RESULT'));
test('entire envelope content consistency, code membership, no HS-prefix restriction', () => {
  const content = '{"taric_code":"0000000001","description":"Synthetic description"}';
  expect(output({ content, raw_content: content }, ['0000000001']).verification).toBe('unverified');
  expect(() => output({ content, raw_content: 'different' }, ['0000000001'])).toThrow('INVALID_RESULT');
  expect(() => output({ content }, ['0000000002'])).toThrow('CATALOG_REJECTED');
  expect(() => strictJson('{"a":{"b":1,"b":2}}')).toThrow();
  expect(() => strictJson('{"x":1e999}')).toThrow();
});
test('CSV preserves code strings, deduplicates and never promotes training lineage', async () => {
  const parsed = await preview(Buffer.from(csv));
  expect(parsed.cases[0]).toMatchObject({ target: '0000000001', hsOriginal: '9503.00' });
  expect(parsed.manifest).toMatchObject({ rows: 1, accepted: 1, duplicates: 0, invalid: 0 });
  const training = draft(parsed, 0, review, null);
  expect(training).toMatchObject({ contaminated: true, releaseEligible: false });
  const copy = draft(parsed, 1, review, training);
  expect(copy).toMatchObject({ contaminated: true, releaseEligible: false });
  expect(copy.sourceLineage).toContain('v0');
  const renamed = { ...parsed, cases: parsed.cases.map(c => ({ ...c, overlapHash: 'different', sourceHash: 'different' })) };
  expect(draft(renamed, 2, { ...review, sourceLineage: ['v0'] }, training).contaminated).toBe(true);
  expect(overlaps(parsed.cases, training.cases).any).toBe(true);
  const doubled = await preview(Buffer.from(csv + csv.split('\n')[1] + '\n'));
  expect(doubled.manifest).toMatchObject({ rows: 2, accepted: 1, duplicates: 1 });
});
test.each(['descriptive_name,full_item_name,specs,hs_code,taric_code\na,b,,9503.00,1\n',
  'descriptive_name,descriptive_name\na,b\n', 'unknown\nx\n'])('invalid CSV never silently skips rows', async csvText => expect(preview(Buffer.from(csvText))).rejects.toThrow('IMPORT_INVALID'));
function releaseFixture() {
  const runtime = { name: 'adapter-a', identity: 'immutable-a', verified: true, trustSource: 'Synthetic trusted gateway',
    deploymentRevision: 'deployment-1', baseRevision: 'base-1', tokenizerRevision: 'tokenizer-1', adapterSha256: 'a'.repeat(64), validUntil: '2099-01-01' };
  const s = { enabled: true, currentBenchmark: 'b', revision: 2, catalog: { approved: true, codes: ['0000000001'] }, runtime: { adapters: [runtime] }, maxTokens: 256 };
  const b = { _id: 'b', version: 1, state: 'published', releaseEligible: true, contaminated: false, review, cases: [row], policy: { minExact: 1, maxInvalid: 0 } };
  const r = { _id: 'r', benchmark: 'b', adapter: 'adapter-a', identity: 'immutable-a', state: 'complete', active: false, cancelRequested: false,
    passed: true, score: 1, exact: 1, invalid: 0, actualCount: 1, requestedCount: 1, results: [{}], createdAt: new Date(1), policy: b.policy,
    fingerprint: hash(configuration(s, 'adapter-a', 'code')) };
  return { s, b, r };
}
test('perfect v0 never opens release; drafts do not replace current', () => {
  const { s, b, r } = releaseFixture();
  expect(selectWinner(s, b, [r], 'code')._id).toBe('r');
  expect(() => selectWinner(s, { ...b, version: 0 }, [r], 'code')).toThrow('RELEASE_CLOSED');
  expect(() => selectWinner(s, { ...b, state: 'draft' }, [r], 'code')).toThrow('RELEASE_CLOSED');
  expect(() => selectWinner({ ...s, currentBenchmark: 'new' }, b, [r], 'code')).toThrow('RELEASE_CLOSED');
});
test.each([{ state: 'failed' }, { state: 'interrupted' }, { active: true }, { cancelRequested: true }, { actualCount: 0 }, { requestedCount: 0 }, { fingerprint: 'old' }, { results: [] }])('ineligible run %p', patch => {
  const { s, b, r } = releaseFixture(); expect(() => selectWinner(s, b, [{ ...r, ...patch }], 'code')).toThrow('RELEASE_CLOSED');
});
test('latest authoritative replacement supersedes even a perfect prior run', () => {
  const { s, b, r } = releaseFixture();
  expect(() => selectWinner(s, b, [r, { ...r, _id: 'r2', createdAt: new Date(2), state: 'pending' }], 'code')).toThrow('RELEASE_CLOSED');
});
test('highest passing exact score wins; deterministic immutable identity tie', () => {
  const { s, b, r } = releaseFixture(); b.policy.minExact = .5;
  s.runtime.adapters.push({ ...s.runtime.adapters[0], name: 'adapter-b', identity: 'immutable-b' });
  const second = { ...r, _id: 'r2', adapter: 'adapter-b', identity: 'immutable-b', fingerprint: hash(configuration(s, 'adapter-b', 'code')) };
  expect(selectWinner(s, b, [second, r], 'code').identity).toBe('immutable-a');
  r.score = 0; r.exact = 0;
  expect(selectWinner(s, b, [r, second], 'code').identity).toBe('immutable-b');
  expect(() => selectWinner(s, b, [second], 'changed-code')).toThrow('RELEASE_CLOSED');
});

test('monotonic run sequence beats random IDs and equal timestamps for replacement authority', () => {
  const { s, b, r } = releaseFixture();
  const replacement = { ...r, _id: 'a', sequence: 2, state: 'failed' };
  expect(() => selectWinner(s, b, [{ ...r, _id: 'z', sequence: 1 }, replacement], 'code')).toThrow('RELEASE_CLOSED');
});

test('bounded visible diagnostics survive JSON/catalog rejection without raw envelopes, tools or reasoning', () => {
  const { output } = require('../../utils/taricProtocol');
  for (const content of ['not JSON <script>alert(1)</script>', '{"taric_code":"9999999999","description":"Synthetic"}', '{"taric_code":"0000000001","taric_code":"9999999999","description":"Synthetic"}']) {
    let diagnostic;
    expect(() => output({ content, reasoning_content: 'PRIVATE-REASONING', tool_arguments: 'PRIVATE-TOOL' }, ['0000000001'], value => { diagnostic = value; })).toThrow();
    expect(diagnostic).toMatchObject({ visibleText: content, label: 'REJECTED', applicable: false, training_approved: false });
    expect(JSON.stringify(diagnostic)).not.toContain('PRIVATE');
  }
  let diagnostic;
  expect(() => output({ content: 'あ'.repeat(3000), raw_content: 'PRIVATE-RAW' }, [], value => { diagnostic = value; })).toThrow();
  expect(diagnostic.outputBytes).toBe(9000); expect(diagnostic.truncated).toBe(true);
  expect(Buffer.byteLength(diagnostic.visibleText)).toBeLessThanOrEqual(4096);
  expect(diagnostic.proposal).toBeNull();
});
