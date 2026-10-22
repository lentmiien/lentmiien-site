const { createCatalogService } = require('../../services/smallestBoxCatalogService');
const admin = 'a'.repeat(24), other = 'b'.repeat(24);
const boxes = Array.from({ length: 30 }, (_, i) => ({ id: `saved-${i}`, w: 100 + i, d: 80, h: 50, emptyWeight: 0.1, maxLoadWeight: 10 }));
let stored, sources, admins, shared, legacy, users, service;
const chain = value => ({ select() { return this; }, limit() { return this; }, lean: async () => typeof value === 'function' ? value() : value });
beforeEach(() => {
  stored = null; admins = [{ _id: admin }]; sources = [{ ownerId: admin, containers: structuredClone(boxes) }];
  shared = { findById: jest.fn(() => chain(() => stored)), findOneAndUpdate: jest.fn((filter, update) => chain(() => {
    if (update.$setOnInsert) { stored ||= { _id: 'shared', ...update.$setOnInsert }; return structuredClone(stored); }
    if (stored.revision !== filter.revision) return null;
    stored = { ...stored, ...update.$set, revision: stored.revision + 1 }; return structuredClone(stored);
  })) };
  legacy = { find: jest.fn(filter => chain(() => sources.filter(source => filter.ownerId.$in.includes(source.ownerId) && source.containers.length).slice(0, 2))) };
  users = { find: jest.fn(() => chain(admins)), findOne: jest.fn(filter => chain(admins.find(user => user._id === filter._id))) };
  service = createCatalogService({ shared, legacy, users, sourceOwner: () => '' });
});
test('preserves all 30 admin boxes and copies them to the shared catalog with empty tags', async () => {
  const before = structuredClone(sources);
  const result = await service.initialize();
  expect(result.containers).toEqual(boxes.map(box => ({ ...box, tags: [] })));
  expect(result.revision).toBe(0); expect(stored.migratedFrom).toBe(admin);
  expect(sources).toEqual(before);
  expect(shared.findOneAndUpdate).toHaveBeenCalledWith({ _id: 'shared' }, expect.objectContaining({ $setOnInsert: expect.any(Object) }), expect.objectContaining({ upsert: true }));
});
test('read-only fallback preserves boxes without migrating on GET', async () => {
  expect((await service.read()).containers).toHaveLength(30);
  expect(shared.findOneAndUpdate).not.toHaveBeenCalled();
});
test('repeated/concurrent initialization never overwrites shared edits or an intentionally cleared list', async () => {
  await Promise.all([service.initialize(), service.initialize()]);
  await service.save({ revision: 0, containers: [] });
  expect(await service.initialize()).toEqual({ containers: [], revision: 1 });
  expect(sources[0].containers).toHaveLength(30);
});
test('33 boxes and tags persist; stale shared saves are rejected', async () => {
  await service.initialize();
  const extended = Array.from({ length: 33 }, (_, i) => ({ ...boxes[0], id: `box-${i}`, tags: ['fold-box'] }));
  const results = await Promise.allSettled([service.save({ revision: 0, containers: extended }), service.save({ revision: 0, containers: [] })]);
  expect(results[0].status).toBe('fulfilled'); expect(results[1].reason.status).toBe(409);
  expect((await service.read()).containers).toEqual(extended);
});
test('non-admin legacy catalogs are not shared', async () => {
  sources = [{ ownerId: other, containers: boxes }];
  expect((await service.initialize()).containers).toEqual([]);
});
test('multiple nonempty admin catalogs fail closed until a valid source is selected', async () => {
  admins.push({ _id: other }); sources.push({ ownerId: other, containers: [{ ...boxes[0], id: 'other' }] });
  await expect(service.initialize()).rejects.toMatchObject({ code: 'MIGRATION_SOURCE_AMBIGUOUS' });
  expect(stored).toBeNull();
  const selected = createCatalogService({ shared, legacy, users, sourceOwner: () => admin });
  expect((await selected.initialize()).containers).toHaveLength(30);
});
test('invalid explicit source or storage failure cannot replace boxes with an empty catalog', async () => {
  const selected = createCatalogService({ shared, legacy, users, sourceOwner: () => other });
  await expect(selected.initialize()).rejects.toMatchObject({ code: 'MIGRATION_SOURCE_INVALID' });
  legacy.find.mockImplementation(() => { throw new Error('offline'); });
  await expect(service.initialize()).rejects.toThrow('offline'); expect(stored).toBeNull();
});
