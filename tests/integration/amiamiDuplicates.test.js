const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { schema } = require('../../models/amiami_item');
const { resolveSavedItems } = require('../../services/amiamiItemRedirects');
const { createDuplicateService } = require('../../services/amiamiDuplicateService');

const uri = process.env.AMIAMI_DUPLICATES_TEST_MONGO_URI;
const suite = uri ? describe : describe.skip;

suite('Duplicate review on standalone MongoDB', () => {
  let connection, Item, service;
  beforeAll(async () => {
    connection = await mongoose.createConnection(uri, { dbName: 'amiami_duplicate_test_' + randomUUID() }).asPromise();
    Item = connection.model('item', schema);
    await Item.init();
    service = createDuplicateService(Item);
  });
  afterAll(async () => {
    if (connection) {
      try { await connection.dropDatabase(); } finally { await connection.close(); }
    }
  });
  async function seed(codes) {
    await Item.deleteMany({});
    return Item.create(codes.map((janCode, index) => ({
      gcode: 'FIG-' + index, url: 'item', sourceUrl: 'fixture', firstSeenAt: new Date(),
      lastSeenAt: new Date(), listingChangedAt: new Date(),
      listing: { gcode: 'FIG-' + index, url: 'item' },
      details: { janCode, brand: 'Brand ' + index, raw: { index } },
    })));
  }

  test('groups exact nonblank JANs and merges only the chosen pair, including legacy records', async () => {
    const [first, second, third] = await seed(['0123', '0123', '0123', '123', '', null, null, ' ']);
    await Item.collection.updateOne({ _id: first._id }, { $unset: { __v: 1, updatedAt: 1 } });
    expect(await service.groups()).toMatchObject([{ _id: '0123', count: 3 }]);
    const group = await service.group('0123', first.id);
    expect(group.items.map(item => String(item._id))).toEqual([second.id, third.id]);
    const { snapshot } = await service.compare(first.id, third.id);
    await service.merge(first.id, third.id, { snapshot, details_brand: 'remove' });
    expect(await Item.findById(first.id).lean()).toMatchObject({
      gcode: first.gcode, details: { brand: third.details.brand, raw: { index: 0 } },
    });
    const alias = await Item.findById(third.id).lean();
    expect(alias).toEqual({ _id: third._id, gcode: third.gcode, mergedInto: first._id });
    expect(await Item.countDocuments({ 'details.janCode': '0123' })).toBe(2);
    expect(await service.groups()).toMatchObject([{ _id: '0123', count: 2 }]);
    await expect(service.merge(first.id, third.id, { snapshot, details_brand: 'remove' })).rejects.toMatchObject({ status: 409 });
    const next = await service.compare(second.id, first.id);
    await service.merge(second.id, first.id, { snapshot: next.snapshot, details_brand: 'keep' });
    const [saved] = await resolveSavedItems(Item, [alias]);
    expect(saved._id).toEqual(second._id);
    expect(await Item.distinct('gcode', { 'details.janCode': '0123' })).toEqual([second.gcode]);
    expect(await service.groups()).toEqual([]);
  });

  test('opposite simultaneous decisions always leave a survivor', async () => {
    const [one, two] = await seed(['0987', '0987']);
    const pairs = await Promise.all([service.compare(one.id, two.id), service.compare(two.id, one.id)]);
    const results = await Promise.allSettled(pairs.map(pair =>
      service.merge(String(pair.keep._id), String(pair.remove._id), { snapshot: pair.snapshot, details_brand: 'keep' })));
    const successes = results.filter(result => result.status === 'fulfilled').length;
    expect(successes).toBeLessThanOrEqual(1);
    expect(await Item.countDocuments()).toBe(2);
    expect(await Item.countDocuments({ mergedInto: null })).toBe(2 - successes);
    for (const result of results.filter(result => result.status === 'rejected')) {
      expect(result.reason.status).toBe(409);
    }
  });
});
