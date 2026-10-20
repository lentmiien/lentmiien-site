const { initializeIndexes } = require('../../services/localAi/admission');
const { errorDiagnostic } = require('../../services/localAi/diagnostics');
const valid = () => [
  { name: 'admission_slot_unique', unique: true, key: { slot: 1 }, partialFilterExpression: { slot: { $type: 'number' } } },
  { name: 'admission_owner_slot_unique', unique: true, key: { ownerId: 1, ownerSlot: 1 }, partialFilterExpression: { ownerSlot: { $type: 'number' } } },
  { name: 'slot_1', unique: true, key: { slot: 1 } },
];
function db(indexes) {
  const model = () => ({ createCollection: jest.fn(async () => {}), createIndexes: jest.fn(async () => {}) });
  return { Job: { ...model(), collection: { indexes: jest.fn(async () => indexes), dropIndex: jest.fn(async () => {}) } }, Token: model() };
}
test.each([
  index => { index.unique = false; }, index => { index.sparse = true; },
  index => { delete index.partialFilterExpression; }, index => { index.partialFilterExpression.slot.$type = 'string'; },
  index => { index.key = { wrong: 1 }; },
])('rejects incorrectly provisioned replacement constraints before removing legacy protection', async mutate => {
  const indexes = valid(); mutate(indexes[0]); const models = db(indexes);
  const error = await initializeIndexes(models).catch(value => value);
  expect(error.code).toBe('admission_index_invalid');
  expect(errorDiagnostic(error, 'initialize')).toEqual({ operation: 'Job.verify_indexes', reasonClass: 'application_error', reasonCode: 'admission_index_invalid', applicationStatus: 503 });
  expect(models.Job.collection.dropIndex).not.toHaveBeenCalled();
});
test('explicit provisioning retries a failure and drops only legacy slot constraints after verifying replacements', async () => {
  const models = db(valid());
  models.Token.createCollection.mockRejectedValueOnce(new Error('temporary failure'));
  await expect(initializeIndexes(models)).rejects.toThrow('temporary failure');
  expect(models.Job.collection.dropIndex).not.toHaveBeenCalled();
  await initializeIndexes(models);
  expect(models.Token.createCollection).toHaveBeenCalledTimes(2);
  expect(models.Token.createIndexes).toHaveBeenCalledTimes(1);
  expect(models.Job.collection.dropIndex).toHaveBeenCalledTimes(1);
  expect(models.Job.collection.dropIndex).toHaveBeenCalledWith('slot_1');
});
