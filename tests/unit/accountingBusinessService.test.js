const mockMappingModel = {
  findOneAndUpdate: jest.fn(),
  bulkWrite: jest.fn(),
  countDocuments: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  distinct: jest.fn(),
};

const mockTransactionDbModel = {
  distinct: jest.fn(),
  find: jest.fn(),
};

const mockCreditCardTransaction = {
  distinct: jest.fn(),
  find: jest.fn(),
};

jest.mock('../../models/accounting_business_mapping', () => mockMappingModel);
jest.mock('../../models/transaction_db', () => mockTransactionDbModel);
jest.mock('../../models/credit_card_transaction', () => mockCreditCardTransaction);

const service = require('../../services/accountingBusinessService');

const objectId = (value) => ({ toString: () => value });

function chainResolved(value) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

describe('accountingBusinessService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('ensureBusiness creates a default Other mapping', async () => {
    mockMappingModel.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: objectId('map-1'),
        name: 'Cafe',
        normalizedName: 'cafe',
        groupName: 'Other',
        sources: ['budget'],
      }),
    });

    const result = await service.ensureBusiness(' Cafe ', { source: service.SOURCE_BUDGET });

    expect(mockMappingModel.findOneAndUpdate).toHaveBeenCalledWith(
      { normalizedName: 'cafe' },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          name: 'Cafe',
          normalizedName: 'cafe',
          groupName: 'Other',
        }),
        $addToSet: { sources: 'budget' },
      }),
      expect.objectContaining({ upsert: true, new: true }),
    );
    expect(result).toMatchObject({
      id: 'map-1',
      name: 'Cafe',
      groupName: 'Other',
    });
  });

  test('seedFromExistingTransactions seeds budget businesses and card labels', async () => {
    mockTransactionDbModel.distinct.mockResolvedValue(['Cafe', ' cafe ', 'Market']);
    mockCreditCardTransaction.distinct.mockResolvedValue(['Amazon']);
    mockMappingModel.bulkWrite
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1, upsertedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0, upsertedCount: 1 });
    mockMappingModel.countDocuments.mockResolvedValue(3);

    const result = await service.seedFromExistingTransactions();

    expect(mockTransactionDbModel.distinct).toHaveBeenCalledWith('transaction_business', {
      transaction_business: { $nin: ['', null] },
    });
    expect(mockCreditCardTransaction.distinct).toHaveBeenCalledWith('label', {
      label: { $nin: ['', null] },
    });
    expect(mockMappingModel.bulkWrite).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      budgetNames: 2,
      creditCardLabels: 1,
      totalMappings: 3,
    });
  });

  test('getAnalytics combines budget and credit card rows by group', async () => {
    mockMappingModel.find.mockReturnValue(chainResolved([
      {
        _id: objectId('map-1'),
        name: 'Cafe',
        normalizedName: 'cafe',
        groupName: 'Food',
        sources: ['budget', 'credit_card'],
      },
    ]));
    mockTransactionDbModel.find.mockReturnValue(chainResolved([
      {
        _id: objectId('tx-1'),
        transaction_business: 'Cafe',
        date: 20240510,
        type: 'expense',
        amount: 100,
        from_fee: 0,
        to_fee: 0,
        categories: 'Food',
      },
    ]));
    mockCreditCardTransaction.find.mockReturnValue(chainResolved([
      {
        _id: objectId('card-tx-1'),
        label: 'Cafe',
        transactionDate: new Date('2024-05-11T00:00:00Z'),
        amount: 200,
        external: false,
      },
    ]));

    const analytics = await service.getAnalytics({ scope: 'group', value: 'Food' });

    expect(analytics.summary).toMatchObject({
      transactionCount: 2,
      totalSpend: 300,
      activeMonths: 1,
      averageMonthlySpend: 300,
    });
    expect(analytics.monthly).toEqual([
      expect.objectContaining({
        label: '2024-05',
        budgetSpend: 100,
        creditSpend: 200,
        totalSpend: 300,
      }),
    ]);
    expect(analytics.yearly[0]).toMatchObject({ label: '2024', totalSpend: 300 });
    expect(analytics.transactions.map((tx) => tx.source)).toEqual(['credit_card', 'budget']);
  });
});
