const { buildEmergencyStockMigrationPlan } = require('../../services/emergencyStockMigrationService');

describe('Emergency Stock v2 migration planning', () => {
  test('turns the implausible work-glove date into an inspection due now without deleting legacy data', () => {
    const now = new Date('2026-08-22T00:00:00.000Z');
    const categories = [{
      _id: 'gloves',
      name: 'Work gloves',
      unit: 'pairs',
      recommendedStock: 3,
      rotationPeriodMonths: 12,
    }];
    const items = [{
      _id: 'glove-lot',
      categoryId: 'gloves',
      amount: 3,
      rotateDate: new Date('3035-01-01T00:00:00.000Z'),
    }];
    const plan = buildEmergencyStockMigrationPlan({ categories, items, now });

    expect(plan.classifications).toEqual({ durable: 1 });
    expect(plan.categoryUpdates[0].fields.managementMode).toBe('durable');
    expect(plan.itemUpdates[0].fields).toMatchObject({
      status: 'active',
      inspectionDueAt: now,
    });
    expect(plan.itemUpdates[0].fields).not.toHaveProperty('rotateDate');
  });
});
