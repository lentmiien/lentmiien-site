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
          filter: { _id: 'bottle', categoryId: 'water' },
          update: { $set: expect.objectContaining({ amount: 2 }) },
        }),
      }),
    ], { ordered: true, session });
    expect(session.endSession).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ convertedItems: 1, factor: 0.001, toUnit: 'L', mode: 'transaction' });
  });

  test('uses a persisted rollback journal on standalone MongoDB', async () => {
    const category = {
      _id: 'water',
      unit: 'mL',
      officialBaseline: 27000,
      contributionPerUnit: { domainUnits: 0.001 },
    };
    const items = [{ _id: 'bottle', categoryId: 'water', amount: 2000 }];
    const query = value => ({ lean: jest.fn().mockResolvedValue(value) });
    const CategoryModel = {
      findById: jest.fn(() => query(category)),
      updateOne: jest.fn()
        .mockResolvedValueOnce({ matchedCount: 1 })
        .mockResolvedValueOnce({ matchedCount: 1 }),
    };
    const ItemModel = {
      find: jest.fn(() => query(items)),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const JournalModel = {
      create: jest.fn().mockResolvedValue({}),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const connection = {
      db: {
        admin: jest.fn(() => ({
          command: jest.fn().mockResolvedValue({ isWritablePrimary: true }),
        })),
      },
      startSession: jest.fn(),
    };

    const result = await convertCategoryUnit({
      CategoryModel,
      ItemModel,
      JournalModel,
      connection,
      categoryId: 'water',
      newUnit: 'L',
      expectedCurrentUnit: 'mL',
    });

    expect(connection.startSession).not.toHaveBeenCalled();
    expect(JournalModel.create).toHaveBeenCalledWith(expect.objectContaining({
      categoryId: 'water',
      status: 'prepared',
      fromUnit: 'mL',
      toUnit: 'L',
      itemSnapshots: items,
    }));
    expect(CategoryModel.updateOne).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        _id: 'water',
        unit: 'mL',
        unitConversionLock: { $exists: false },
      }),
      { $set: { unitConversionLock: expect.objectContaining({ fromUnit: 'mL', toUnit: 'L' }) } },
      { runValidators: true, timestamps: false },
    );
    expect(result).toMatchObject({
      convertedItems: 1,
      factor: 0.001,
      toUnit: 'L',
      mode: 'guarded-rollback',
      operationId: expect.any(String),
    });
  });

  test('restores inventory and category values when a standalone conversion fails', async () => {
    const category = {
      _id: 'water',
      unit: 'mL',
      officialBaseline: 27000,
      contributionPerUnit: { domainUnits: 0.001 },
    };
    const items = [{ _id: 'bottle', categoryId: 'water', amount: 2000 }];
    const query = value => ({ lean: jest.fn().mockResolvedValue(value) });
    const CategoryModel = {
      findById: jest.fn(() => query(category)),
      updateOne: jest.fn()
        .mockResolvedValueOnce({ matchedCount: 1 })
        .mockResolvedValueOnce({ matchedCount: 0 })
        .mockResolvedValueOnce({ matchedCount: 1 }),
    };
    const ItemModel = {
      find: jest.fn(() => query(items)),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const JournalModel = {
      create: jest.fn().mockResolvedValue({}),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const logger = { warning: jest.fn(), error: jest.fn() };
    const connection = {
      db: {
        admin: jest.fn(() => ({
          command: jest.fn().mockResolvedValue({ isWritablePrimary: true }),
        })),
      },
    };

    await expect(convertCategoryUnit({
      CategoryModel,
      ItemModel,
      JournalModel,
      connection,
      logger,
      categoryId: 'water',
      newUnit: 'L',
      expectedCurrentUnit: 'mL',
    })).rejects.toThrow('No conversion was retained');

    expect(ItemModel.updateOne).toHaveBeenCalledTimes(2);
    expect(ItemModel.updateOne).toHaveBeenNthCalledWith(1,
      { _id: 'bottle', categoryId: 'water', amount: 2000 },
      { $set: { amount: 2 } },
      { runValidators: true },
    );
    expect(ItemModel.updateOne).toHaveBeenNthCalledWith(2,
      { _id: 'bottle', categoryId: 'water', amount: 2 },
      { $set: { amount: 2000 } },
      { runValidators: true },
    );
    expect(CategoryModel.updateOne.mock.calls[2][1]).toEqual({
      $unset: { unitConversionLock: 1 },
    });
    expect(JournalModel.updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      { $set: expect.objectContaining({ status: 'rolled-back' }) },
      { runValidators: true },
    );
    expect(logger.warning).toHaveBeenCalledWith(
      'Emergency stock unit conversion failed and was rolled back',
      expect.objectContaining({ category: 'emergency-stock' }),
    );
  });
});
