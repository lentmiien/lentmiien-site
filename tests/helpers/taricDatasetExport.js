/* Synthetic service-export fixture: no database, credentials, or providers. */
const domain = require('../../services/taric/historyDomain');
const { createHistory } = require('../../services/taric/history');
const { request, actor } = require('./taricHistoryFixture');
const { hash } = require('../../utils/taricProtocol');
async function exportedFixture() {
  const raw = Array.from({ length: 8 }, (_, i) => {
    const r = request(i + 1);
    r.input.input_hs_code = '001234';
    r.input.descriptive_name = `Synthetic category ${i} 日本語`;
    r.evidence.facts.name = `Synthetic "item" ${i}\n日本語 🧪`;
    r.evidence.facts.specifications = i === 2 ? null : `Synthetic specs ${i}\n{hs_code}`;
    r.result.description = 'WRONG MODEL DESCRIPTION — must never be used';
    const source = domain.derive(r).source;
    r.reviews = [{ revision: 2, latest: { source, revision: 2, sourceHash: hash(source), status: 'verified',
      target: i % 2 ? '0000000003' : '0000000002', approvedDescription: i === 3 ? null : `Synthetic approved ${i} "日本語"`,
      feedbackId: source.feedback.id, feedbackHash: hash(source.feedback), actor,
      note: 'Synthetic independent source', correction: i % 2 === 1,
      at: `2026-09-${i === 4 ? '21' : '22'}T00:00:00.000Z` } }];
    return r;
  });
  const archived = raw.pop();
  const aggregate = rows => ({ option() { return this; }, cursor() {
    return { async *[Symbol.asyncIterator]() { yield* rows; }, async close() {} };
  } });
  const query = rows => ({ select() { return this; }, sort() { return this; }, limit() { return this; },
    maxTimeMS() { return this; }, lean() { return this; }, async exec() { return rows; } });
  const models = {
    Request: { collection: { name: 'requests' }, aggregate: () => aggregate(raw) },
    Review: { collection: { name: 'reviews' }, aggregate: () => aggregate([{ ...archived.reviews[0], request: archived._id, live: [] }]) },
    Feedback: { collection: { name: 'feedback' } }, Run: { collection: { name: 'runs' } },
    Benchmark: { find: () => query([]) }, Export: { create: async () => {} },
  };
  const history = createHistory({ models, adminPrincipal: async () => ({ id: `admin_${actor}`, owner: 'synthetic-owner' }),
    now: () => new Date('2026-09-24T00:00:00.000Z') });
  const options = { mode: 'newest', limit: 200, perCode: 100 };
  const preview = await history.preview(actor, { options });
  return (await history.download(actor, { options, expectedSnapshotHash: preview.snapshotHash })).jsonl;
}
if (require.main === module) exportedFixture().then(jsonl => process.stdout.write(jsonl)).catch(() => { process.exitCode = 1; });
module.exports = { exportedFixture };
