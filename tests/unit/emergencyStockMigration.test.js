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

  test('makes legacy conditional categories undecided instead of generating purchases', () => {
    const plan = buildEmergencyStockMigrationPlan({
      categories: [{
        _id: 'menstrual',
        name: 'Menstrual products (if applicable)',
        unit: 'items',
        recommendedStock: 40,
        managementMode: 'rolling',
        conditional: true,
        applicable: true,
      }],
      items: [],
      now: new Date('2026-08-22T00:00:00.000Z'),
    });

    expect(plan.categoryUpdates[0].fields).toMatchObject({
      applicabilityStatus: 'undecided',
      applicable: false,
      targetStrategy: 'fixed',
    });
  });

  test('persists the dedicated role for already-classified food lots', () => {
    const plan = buildEmergencyStockMigrationPlan({
      categories: [{
        _id: 'snacks',
        name: 'Snacks',
        unit: 'packs',
        managementMode: 'rolling',
        preparednessDomain: 'food',
        applicabilityStatus: 'applicable',
        targetStrategy: 'duration-scaled',
      }],
      items: [{
        _id: 'snack-lot',
        categoryId: 'snacks',
        amount: 5,
        status: 'active',
        quantityUpdatedAt: new Date('2026-08-20T00:00:00.000Z'),
        contributionOverride: { supplementalServings: 1 },
      }],
      now: new Date('2026-08-22T00:00:00.000Z'),
    });

    expect(plan.itemUpdates).toEqual([
      expect.objectContaining({
        id: 'snack-lot',
        fields: { foodRole: 'supplemental' },
      }),
    ]);
  });
});
