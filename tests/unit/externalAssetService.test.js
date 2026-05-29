const mockExternalAssetModel = jest.fn(function externalAssetCtor(doc) {
  this.doc = doc;
  this.save = jest.fn().mockResolvedValue({ _id: objectId('new-asset'), ...doc });
  return this;
});

mockExternalAssetModel.find = jest.fn();
mockExternalAssetModel.findByIdAndUpdate = jest.fn();
mockExternalAssetModel.findById = jest.fn();

const mockExchangeRate = {
  findOne: jest.fn(),
};

jest.mock('../../models/external_asset', () => mockExternalAssetModel);
jest.mock('../../models/exchange_rate', () => mockExchangeRate);

const service = require('../../services/externalAssetService');

function objectId(value) {
  return { toString: () => value };
}

function chainResolved(value) {
  return {
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

describe('externalAssetService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-05-29T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('converts foreign currency balances to JPY using latest JPY base rate', () => {
    const result = service.convertToJpy(1000, 'USD', {
      date: '2026-05-01',
      amount: 1,
      rates: { USD: 0.00625 },
    });

    expect(result).toMatchObject({
      value: 160000,
      rate: 0.00625,
      date: '2026-05-01',
      available: true,
    });
  });

  test('getSummary values savings and loans and builds interest scenarios', async () => {
    mockExternalAssetModel.find.mockReturnValue(chainResolved([
      {
        _id: objectId('asset-jpy'),
        name: 'JPY savings',
        kind: 'savings',
        currency: 'JPY',
        currentBalance: 100000,
        monthlyPayment: 10000,
        annualInterestRate: 1,
        compounding: 'monthly',
        active: true,
      },
      {
        _id: objectId('asset-usd'),
        name: 'USD savings',
        kind: 'savings',
        currency: 'USD',
        currentBalance: 1000,
        monthlyPayment: 100,
        annualInterestRate: 2,
        compounding: 'monthly',
        active: true,
      },
      {
        _id: objectId('loan-sek'),
        name: 'Student loan',
        kind: 'loan',
        currency: 'SEK',
        currentBalance: 20000,
        monthlyPayment: 0,
        annualInterestRate: 0,
        compounding: 'yearly',
        active: true,
      },
    ]));
    mockExchangeRate.findOne.mockReturnValue(chainResolved({
      date: '2026-05-01',
      amount: 1,
      rates: {
        USD: 0.00625,
        SEK: 0.0714,
      },
    }));

    const summary = await service.getSummary();

    expect(summary.totals.savingsJpy).toBeCloseTo(260000, 2);
    expect(summary.totals.loanJpy).toBeCloseTo(280112.04, 2);
    expect(summary.totals.netJpy).toBeCloseTo(-20112.04, 2);
    expect(summary.interestImpact.horizons.map((item) => item.label)).toEqual([
      'End 2026',
      'End 2027',
      'Age 50',
      'Age 65',
    ]);
    const configured = summary.interestImpact.scenarios.find((scenario) => scenario.key === 'configured');
    const age50 = configured.horizons.find((horizon) => horizon.key === 'age_50');
    expect(age50.interestJpy).toBeGreaterThan(0);
    expect(age50.extraVsZeroJpy).toBeGreaterThan(0);
  });
});
