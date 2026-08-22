const {
  cleanupResolvedItems,
  syncShoppingRequirements,
} = require('../../services/emergencyStockMaintenanceService');

describe('Emergency Stock maintenance', () => {
  test('cleanup only targets records explicitly resolved at least 30 days ago', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ deletedCount: 2 });
    const now = new Date('2026-08-22T00:00:00.000Z');
    const result = await cleanupResolvedItems({ ItemModel: { deleteMany }, now });

    expect(result.removed).toBe(2);
    expect(result.cutoff.toISOString()).toBe('2026-07-23T00:00:00.000Z');
    expect(deleteMany).toHaveBeenCalledWith({
      status: { $in: ['consumed', 'discarded', 'replaced'] },
      resolvedAt: { $type: 'date', $lte: new Date('2026-07-23T00:00:00.000Z') },
    });
    expect(deleteMany.mock.calls[0][0]).not.toHaveProperty('expiresAt');
    expect(deleteMany.mock.calls[0][0]).not.toHaveProperty('rotateDate');
  });

  test('sync preserves a planned state instead of creating a duplicate', async () => {
    const RequirementModel = {
      updateOne: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    };
    const categories = [{
      _id: 'paper',
      name: 'Toilet paper',
      unit: 'rolls',
      managementMode: 'rolling',
      preparednessDomain: 'other',
      applicable: true,
      emergencyFloor: 10,
      reorderPoint: 12,
      restockToAmount: 20,
      officialBaseline: 10,
    }];
    const existingRequirements = [{
      fingerprint: 'rolling:paper',
      status: 'planned',
    }];
    const result = await syncShoppingRequirements({
      RequirementModel,
      categories,
      items: [{ _id: 'lot', categoryId: 'paper', amount: 12, status: 'active' }],
      existingRequirements,
      now: new Date('2026-08-22T00:00:00.000Z'),
    });

    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0].status).toBe('planned');
    expect(RequirementModel.updateOne).toHaveBeenCalledTimes(1);
    expect(RequirementModel.updateOne.mock.calls[0][0]).toEqual({ fingerprint: 'rolling:paper' });
    expect(RequirementModel.updateOne.mock.calls[0][1].$set).not.toHaveProperty('status');
  });
});
