const mockReceipt = {
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndDelete: jest.fn(),
};

const mockReceiptMappingRule = {
  find: jest.fn(),
  findByIdAndDelete: jest.fn(),
};

const toObjectId = (value) => ({ toString: () => value });
const decodeHtmlEntities = (value) => String(value || '')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, '\'')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  chat: {
    completions: {
      create: jest.fn(),
    },
  },
})), { virtual: true });

jest.mock('openai/helpers/zod', () => ({
  zodResponseFormat: jest.fn(),
}), { virtual: true });

jest.mock('zod', () => ({
  z: {
    object: jest.fn(() => ({})),
    string: jest.fn(() => ({})),
    number: jest.fn(() => ({})),
    enum: jest.fn(() => ({})),
  },
}), { virtual: true });

jest.mock('../../services/messageService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../services/conversationService', () => jest.fn().mockImplementation(() => ({
  loadProcessNewImageToBase64: jest.fn(),
})));
jest.mock('../../services/knowledgeService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../services/budgetService', () => ({
  getReferenceLists: jest.fn(),
  insertTransaction: jest.fn(),
}));
jest.mock('../../services/creditCardService', () => ({
  listCards: jest.fn(),
  createTransaction: jest.fn(),
}));

jest.mock('../../database', () => ({
  Chat4Model: {},
  Conversation4Model: {},
  Chat4KnowledgeModel: {},
  FileMetaModel: {},
  Receipt: mockReceipt,
  ReceiptMappingRule: mockReceiptMappingRule,
}));

const controller = require('../../controllers/receiptcontroller');
const BudgetService = require('../../services/budgetService');
const CreditCardService = require('../../services/creditCardService');
const pug = require('pug');
const path = require('path');

describe('receiptcontroller history filters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders the monthly history partial for a selected month', async () => {
    const receipts = [{ _id: { toString: () => '1' }, date: new Date('2025-12-10T00:00:00.000Z') }];
    const sort = jest.fn().mockResolvedValue(receipts);
    mockReceipt.find.mockReturnValue({ sort });
    const res = { render: jest.fn() };

    await controller.receipt_history({ query: { history: '2025-12' } }, res);

    const query = mockReceipt.find.mock.calls[0][0];
    expect(query.date.$gte.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(query.date.$lt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(sort).toHaveBeenCalledWith('-date');
    expect(res.render).toHaveBeenCalledWith('receipt_history_partial', expect.objectContaining({
      receipts,
      selectedHistory: '2025-12',
      historyLabel: 'December 2025',
    }));
  });

  test('redirects back to the selected history filter after editing a receipt', async () => {
    const receipt = {
      save: jest.fn().mockResolvedValue(),
    };
    mockReceipt.findById.mockResolvedValue(receipt);
    const res = { redirect: jest.fn() };

    await controller.correct_receipt({
      params: { id: 'abc123' },
      query: { history: '2025-12' },
      body: {
        date: '2025-12-05',
        amount: '123',
        method: 'cash',
        business_name: 'Store',
        business_address: 'Address',
        layout_text: 'OCR text',
      },
    }, res);

    expect(receipt.save).toHaveBeenCalledTimes(1);
    expect(receipt.amount).toBe(123);
    expect(receipt.method).toBe('cash');
    expect(receipt.layout_text).toBe('OCR text');
    expect(res.redirect).toHaveBeenCalledWith('/receipt?history=2025-12');
  });
});

describe('receiptcontroller receipt entry form', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders credit mapping state and receipt defaults separately', async () => {
    const receipt = {
      _id: toObjectId('receipt-1'),
      date: new Date('2026-04-21T00:00:00.000Z'),
      amount: 3210,
      method: 'cash',
      business_name: 'Shop A',
      business_address: 'Address',
      layout_text: 'OCR text',
    };
    const rule = {
      _id: toObjectId('rule-1'),
      name: 'Card rule',
      target: 'credit',
      priority: 5,
      active: true,
      description: 'Use the card tracker',
      conditions: [{ field: 'business_name', operator: 'icontains', value: 'shop' }],
      budgetPrefill: {},
      creditPrefill: {
        cardId: toObjectId('card-1'),
        label: 'Mapped label',
        external: true,
        externalMultiplier: 2.5,
      },
      updatedAt: new Date('2026-04-22T00:00:00.000Z'),
    };
    const sortRules = jest.fn().mockResolvedValue([rule]);
    const res = { render: jest.fn() };

    mockReceipt.findById.mockResolvedValue(receipt);
    mockReceiptMappingRule.find.mockReturnValue({ sort: sortRules });
    BudgetService.getReferenceLists.mockResolvedValue({
      accounts: [{ _id: toObjectId('cash-wallet'), name: 'Travel cash wallet' }],
      categories: [],
      tags: [],
      types: ['expense'],
    });
    CreditCardService.listCards.mockResolvedValue([{ id: 'card-1', name: 'Visa' }]);

    await controller.receipt_entry_form({ params: { id: 'receipt-1' }, query: {} }, res);

    expect(sortRules).toHaveBeenCalledWith({ priority: -1, updatedAt: -1 });
    expect(res.render).toHaveBeenCalledWith('receipt_entry', expect.objectContaining({
      entryMode: 'credit',
      appliedRuleId: 'rule-1',
      defaultEntryMode: 'budget',
      defaultBudgetPrefill: expect.objectContaining({
        amount: 3210,
        date: '2026-04-21',
        from_account: 'cash-wallet',
      }),
      defaultCreditPrefill: expect.objectContaining({
        amount: 3210,
        transactionDate: '2026-04-21',
        label: 'Shop A',
        external: false,
        externalMultiplier: 1,
      }),
      creditPrefill: expect.objectContaining({
        cardId: 'card-1',
        transactionDate: '2026-04-21',
        label: 'Mapped label',
        amount: 3210,
        external: true,
        externalMultiplier: 2.5,
      }),
    }));
  });

  test('receipt entry view renders the credit section open and external checked for an applied credit rule', () => {
    const html = pug.renderFile(path.join(process.cwd(), 'views/receipt_entry.pug'), {
      receipt: {
        _id: toObjectId('receipt-1'),
        date: new Date('2026-04-21T00:00:00.000Z'),
        amount: 3210,
        method: 'cash',
        business_name: 'Shop A',
        business_address: 'Address',
        layout_text: 'OCR text',
      },
      accounts: [],
      categories: [],
      tags: [],
      types: ['expense'],
      creditCards: [],
      mappingMatches: [{
        id: 'rule-1',
        name: 'Card rule',
        target: 'credit',
        priority: 5,
        description: 'Use the card tracker',
        conditions: [{ field: 'business_name', operator: 'icontains', value: 'shop' }],
        budgetPrefill: {},
        creditPrefill: {
          cardId: '',
          label: 'Mapped label',
          external: true,
          externalMultiplier: 2.5,
        },
      }],
      appliedRuleId: 'rule-1',
      defaultBudgetPrefill: {
        from_account: 'cash-wallet',
        to_account: 'EXT',
        from_fee: 0,
        to_fee: 0,
        amount: 3210,
        date: '2026-04-21',
        categories: '',
        tags: '',
        type: 'expense',
        transaction_business: 'Shop A',
      },
      defaultCreditPrefill: {
        cardId: '',
        transactionDate: '2026-04-21',
        label: 'Shop A',
        amount: 3210,
        external: false,
        externalMultiplier: 1,
      },
      defaultEntryMode: 'budget',
      budgetPrefill: {
        from_account: 'cash-wallet',
        to_account: 'EXT',
        from_fee: 0,
        to_fee: 0,
        amount: 3210,
        date: '2026-04-21',
        categories: '',
        tags: '',
        type: 'expense',
        transaction_business: 'Shop A',
      },
      creditPrefill: {
        cardId: '',
        transactionDate: '2026-04-21',
        label: 'Mapped label',
        amount: 3210,
        external: true,
        externalMultiplier: 2.5,
      },
      entryMode: 'credit',
    });

    expect(html).toContain('class="ledger-form is-hidden" data-section="budget"');
    expect(html).toContain('class="ledger-form" data-section="credit"');
    expect(html).toContain('id="external" type="checkbox" name="external" value="true" checked');

    const prefillMatch = html.match(/<script type="application\/json" id="prefill-data">([\s\S]*?)<\/script>/);
    expect(prefillMatch).not.toBeNull();
    const prefillData = JSON.parse(decodeHtmlEntities(prefillMatch[1]));
    expect(prefillData.defaults.entryMode).toBe('budget');
    expect(prefillData.applied.entryMode).toBe('credit');
    expect(prefillData.applied.appliedRuleId).toBe('rule-1');
    expect(prefillData.applied.creditPrefill.external).toBe(true);
  });
});
