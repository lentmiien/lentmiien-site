const { createLifeLogLabels, labelWindow, parseLabelQuery } = require('../../services/accountLifeLogLabels');
const { resolvePolicy } = require('../../services/accountSurfacePolicy');
const owner = '111111111111111111111111';
const now = new Date('2026-09-21T03:04:05.006Z');
let policy;
beforeEach(async () => {
  policy = await resolvePolicy({ _id: owner, name: 'synthetic', type_user: 'admin' }, { findOne: async () => null }, owner);
});
// Synthetic query adapter executes the requested date/regex predicate and sort;
// separate assertions lock down projection, resource bounds and absence of LIMIT.
function fixture(records) {
  let filter; let projection; let sort;
  const close = jest.fn(async () => {});
  const query = {
    select: jest.fn(p => { projection = p; return query; }),
    sort: jest.fn(s => { sort = s; return query; }),
    maxTimeMS: jest.fn(() => query), setOptions: jest.fn(() => query), lean: jest.fn(() => query),
    cursor: jest.fn(() => ({ close, async *[Symbol.asyncIterator]() {
      const regex = new RegExp(filter.label.$regex, filter.label.$options);
      const found = records.filter(e => e.timestamp >= filter.timestamp.$gte && e.timestamp <= filter.timestamp.$lte && regex.test(e.label));
      found.sort((a, b) => b.timestamp - a.timestamp || b._id - a._id);
      for (const entry of found) yield { label: entry.label };
    } })),
  };
  const model = jest.fn(() => ({ find: jest.fn(f => { filter = f; return query; }) }));
  return { search: createLifeLogLabels({ model, now: () => now }), model, query, close, filter: () => filter, projection: () => projection, sort: () => sort };
}
const record = (label, timestamp, id = 1) => ({ _id: id, label, timestamp: new Date(timestamp), createdAt: now, text: 'Private synthetic note', value: 'Private synthetic value' });

test('matching months-old label survives thousands of newer unrelated records; canonical date excludes old imports/future records', async () => {
  const newer = Array.from({ length: 3000 }, (_, i) => record(`Unrelated ${i}`, '2026-09-20', i));
  const f = fixture([...newer, record('Historical Match', '2026-01-01'), record('Historical too old', '2025-09-21T03:04:05.005Z'), record('Historical future', '2026-09-21T03:04:05.007Z')]);
  expect(await f.search(policy, { q: 'historical' })).toEqual(['Historical Match']);
  expect(f.projection()).toEqual({ _id: 0, label: 1 }); expect(f.sort()).toEqual({ timestamp: -1, _id: -1 });
  expect(f.filter()).not.toHaveProperty('createdAt');
  expect(f.query.maxTimeMS).toHaveBeenCalledWith(2000);
  expect(f.query.setOptions).toHaveBeenCalledWith({ sanitizeFilter: false, allowDiskUse: false });
  expect(f.query.cursor).toHaveBeenCalledWith({ batchSize: 100 }); expect(f.close).toHaveBeenCalled();
});

test('rolling cutoff includes both exact boundaries, excludes adjacent milliseconds and uses entry timestamp even for old creation', async () => {
  const f = fixture([
    record('Start', '2025-09-21T03:04:05.006Z'), record('Before', '2025-09-21T03:04:05.005Z'),
    { ...record('End', now), createdAt: new Date('2020-01-01') }, record('After', '2026-09-21T03:04:05.007Z'),
  ]);
  expect(await f.search(policy, {})).toEqual(['End', 'Start']);
  expect(labelWindow(now)).toEqual({ $gte: new Date('2025-09-21T03:04:05.006Z'), $lte: now });
});

test.each([
  ['2024-02-29T12:30:00.123Z', '2023-02-28T12:30:00.123Z'],
  ['2025-02-28T12:30:00.123Z', '2024-02-28T12:30:00.123Z'],
  ['2025-03-01T00:00:00.000Z', '2024-03-01T00:00:00.000Z'],
  ['2026-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'],
])('calendar year %s starts at %s', (end, start) => {
  expect(labelWindow(new Date(end)).$gte.toISOString()).toBe(start);
});

test('case-insensitive dedupe keeps latest casing, timestamp/id ordering, and five unique labels after arbitrarily many duplicates', async () => {
  const records = Array.from({ length: 500 }, (_, i) => record(i % 2 ? ' Mood ' : 'MOOD', '2026-09-20', i));
  const f = fixture([...records, record('Énergie', '2026-09-19', 2), record('énergie', '2026-09-19', 1),
    ...['Work', 'Walk', 'Water', 'Sleep', 'Read'].map((l, i) => record(l, '2026-09-18', 10 - i)),
    record('   ', now), record('x'.repeat(161), now)]);
  expect(await f.search(policy, { q: '' })).toEqual(['Mood', 'Énergie', 'Work', 'Walk', 'Water']);
});

test.each(['.*', '[', 'a+b', '(x)', '$', '\\', '?', '日'])('query %s is a literal substring', async q => {
  const f = fixture([record(`Prefix ${q} suffix`, now), record('Other synthetic label', now)]);
  expect(await f.search(policy, { q })).toEqual([`Prefix ${q} suffix`]);
});

test.each([{ q: [] }, { q: {} }, { q: ['x', 'y'] }, { q: 'x'.repeat(161) }, { q: '\0' }, { owner: owner }, { limit: 100 }, { q: 1 }])('invalid query is rejected before model access %#', async q => {
  const f = fixture([]); await expect(f.search(policy, q)).rejects.toThrow('Invalid'); expect(f.model).not.toHaveBeenCalled();
});
test('empty/whitespace/maximum query input is bounded and normalized', () => {
  expect(parseLabelQuery({})).toBe(''); expect(parseLabelQuery({ q: '  ' })).toBe('');
  expect(parseLabelQuery({ q: ' x ' })).toBe('x'); expect(parseLabelQuery({ q: 'x'.repeat(160) })).toHaveLength(160);
});

test.each(['foreign', 'missing-owner', 'missing-capability', 'missing-account', 'ordinary-user', 'anonymous'])('%s cannot read any owner data', async scenario => {
  const f = fixture([record('Private synthetic label', now)]);
  if (scenario === 'foreign' || scenario === 'missing-owner') policy.isOwner = false;
  if (scenario === 'missing-capability') policy.capabilities = policy.capabilities.filter(c => c !== 'dashboard.personal.read');
  if (scenario === 'missing-account') policy.capabilities = policy.capabilities.filter(c => c !== 'dashboard.account.read');
  if (scenario === 'ordinary-user') policy.isAdmin = false;
  if (scenario === 'anonymous') policy.user = null;
  await expect(f.search(policy, {})).rejects.toThrow('denied'); expect(f.model).not.toHaveBeenCalled();
});

test('cursor failure closes resources and fails the whole result, never returning partial suggestions', async () => {
  const f = fixture([]); const close = jest.fn(async () => {});
  f.query.cursor.mockReturnValue({ close, async *[Symbol.asyncIterator]() { yield { label: 'Partial' }; throw new Error('Synthetic timeout'); } });
  await expect(f.search(policy, {})).rejects.toThrow('Synthetic timeout'); expect(close).toHaveBeenCalled();
});
