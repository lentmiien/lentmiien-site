const {
  buildConvertedCategoryFields,
  buildConvertedItemFields,
  convertCategoryUnit,
  resolveUnitConversion,
} = require('../../services/emergencyStockUnitService');

describe('Emergency Stock unit conversion safeguards', () => {
  test('converts quantities and inverse per-unit contributions together', () => {
    const conversion = resolveUnitConversion('mL', 'L');
    const categoryFields = buildConvertedCategoryFields({
      unit: 'mL',
      officialBaseline: 27000,
      emergencyFloor: 27000,
      reorderPoint: 29000,
      restockToAmount: 36000,
      normalConsumptionRate: 2000,
      packageSize: 2000,
      milestones: [{ deadline: new Date('2026-09-30T00:00:00.000Z'), target: 36000 }],
      contributionPerUnit: { domainUnits: 0.001 },
    }, conversion);
    const itemFields = buildConvertedItemFields({
      amount: 2000,
      packageSize: 2000,
      contributionOverride: { stapleServings: 0.002 },
    }, conversion);

    expect(conversion).toMatchObject({ factor: 0.001, toUnit: 'L', automatic: true });
    expect(categoryFields).toMatchObject({
      unit: 'L',
      officialBaseline: 27,
      emergencyFloor: 27,
      reorderPoint: 29,
      restockToAmount: 36,
      normalConsumptionRate: 2,
      packageSize: 2,
      contributionPerUnit: expect.objectContaining({ domainUnits: 1 }),
    });
    expect(categoryFields.milestones[0].target).toBe(36);
    expect(itemFields).toMatchObject({
      amount: 2,
      packageSize: 2,
      contributionOverride: expect.objectContaining({ stapleServings: 2 }),
    });
  });

  test('rejects dimension changes and requires an explicit factor for unknown units', () => {
    expect(() => resolveUnitConversion('mL', 'kg')).toThrow('different things');
    expect(() => resolveUnitConversion('bottles', 'cases')).toThrow('explicit conversion factor');
    expect(resolveUnitConversion('bottles', 'cases', 0.25)).toMatchObject({
      factor: 0.25,
      automatic: false,
    });
  });

  test('applies the category and every inventory update in one transaction', async () => {
    const category = {
      _id: 'water',
      unit: 'mL',
      officialBaseline: 27000,
      contributionPerUnit: { domainUnits: 0.001 },
    };
    const items = [{ _id: 'bottle', categoryId: 'water', amount: 2000 }];
    const query = value => ({
      session: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(value),
    });
    const CategoryModel = {
      findById: jest.fn(() => query(category)),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const ItemModel = {
      find: jest.fn(() => query(items)),
      bulkWrite: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const session = {
      withTransaction: jest.fn(async callback => callback()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const connection = { startSession: jest.fn().mockResolvedValue(session) };

    const result = await convertCategoryUnit({
      CategoryModel,
      ItemModel,
      connection,
      categoryId: 'water',
      newUnit: 'L',
      expectedCurrentUnit: 'mL',
    });

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(CategoryModel.updateOne).toHaveBeenCalledWith(
      { _id: 'water', unit: 'mL' },
      { $set: expect.objectContaining({ unit: 'L', officialBaseline: 27 }) },
      { session, runValidators: true },
    );
    expect(ItemModel.bulkWrite).toHaveBeenCalledWith([
      expect.objectContaining({
        updateOne: expect.objectContaining({
          filter: { _id: 'bottle' },
          update: { $set: expect.objectContaining({ amount: 2 }) },
        }),
      }),
    ], { ordered: true, session });
    expect(session.endSession).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ convertedItems: 1, factor: 0.001, toUnit: 'L' });
  });
});
