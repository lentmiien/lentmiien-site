const mockReceipt = {
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndDelete: jest.fn(),
};

const mockReceiptMappingRule = {
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndDelete: jest.fn(),
};

const toObjectId = (value) => ({ toString: () => value });
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
  getReceiptEntrySuggestions: jest.fn(),
  insertTransaction: jest.fn(),
}));
jest.mock('../../services/creditCardService', () => ({
  listCards: jest.fn(),
  getLabelSuggestions: jest.fn(),
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

describe('receiptcontroller mapping rules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders the mapping edit form for an existing rule', async () => {
    const rules = [{
      _id: toObjectId('rule-1'),
      name: 'Shop rule',
      target: 'budget',
      priority: 4,
      active: true,
      conditions: [{ field: 'business_name', operator: 'icontains', value: 'shop' }],
      updatedAt: new Date('2026-04-22T00:00:00.000Z'),
    }];
    const editRule = {
      _id: toObjectId('rule-1'),
      name: 'Shop rule',
      description: 'Use saved defaults',
      target: 'budget',
      priority: 4,
      active: true,
      conditions: [{ field: 'business_name', operator: 'icontains', value: 'shop' }],
      budgetPrefill: { from_account: 'cash', to_account: 'EXT', type: 'expense' },
      creditPrefill: { label: 'Shop card', external: false, externalMultiplier: 1 },
    };
    const sortRules = jest.fn().mockResolvedValue(rules);
    const res = { render: jest.fn() };

    mockReceiptMappingRule.findById.mockResolvedValue(editRule);
    mockReceiptMappingRule.find.mockReturnValue({ sort: sortRules });

    await controller.edit_mapping_rule_page({ params: { id: 'rule-1' } }, res);

    expect(mockReceiptMappingRule.findById).toHaveBeenCalledWith('rule-1');
    expect(sortRules).toHaveBeenCalledWith({ priority: -1, updatedAt: -1 });
    expect(res.render).toHaveBeenCalledWith('receipt_mappings', expect.objectContaining({
      rules,
      editRule: expect.objectContaining({
        id: 'rule-1',
        name: 'Shop rule',
        priority: 4,
        budgetPrefill: expect.objectContaining({ from_account: 'cash' }),
        creditPrefill: expect.objectContaining({ label: 'Shop card' }),
      }),
    }));
  });

  test('updates an existing mapping rule from the edit form', async () => {
    const rule = {
      _id: toObjectId('rule-1'),
      save: jest.fn().mockResolvedValue(),
    };
    const res = { redirect: jest.fn() };
    mockReceiptMappingRule.findById.mockResolvedValue(rule);

    await controller.update_mapping_rule({
      params: { id: 'rule-1' },
      body: {
        name: 'Updated rule',
        description: 'Updated note',
        target: 'credit',
        priority: '12',
        active: 'true',
        condition_field: ['business_name', 'layout_text'],
        condition_operator: ['icontains', 'regex'],
        condition_value: ['shop', 'total\\s+1200'],
        from_account_prefill: 'cash',
        to_account_prefill: 'EXT',
        transaction_business_prefill: 'Shop',
        categories_prefill: 'food',
        tags_prefill: 'receipt|daily',
        type_prefill: 'expense',
        from_fee_prefill: '0',
        to_fee_prefill: '10',
        cardId_prefill: '',
        label_prefill: 'Card label',
        external_prefill: 'true',
        externalMultiplier_prefill: '2.5',
      },
    }, res);

    expect(rule.name).toBe('Updated rule');
    expect(rule.target).toBe('credit');
    expect(rule.priority).toBe(12);
    expect(rule.active).toBe(true);
    expect(rule.conditions).toEqual([
      { field: 'business_name', operator: 'icontains', value: 'shop' },
      { field: 'layout_text', operator: 'regex', value: 'total\\s+1200' },
    ]);
    expect(rule.budgetPrefill).toEqual(expect.objectContaining({
      from_account: 'cash',
      to_account: 'EXT',
      to_fee: 10,
    }));
    expect(rule.creditPrefill).toEqual({
      label: 'Card label',
      external: true,
      externalMultiplier: 2.5,
    });
    expect(rule.save).toHaveBeenCalledTimes(1);
    expect(res.redirect).toHaveBeenCalledWith('/receipt/mappings');
  });

  test('quick-updates only mapping priority', async () => {
    const rule = {
      _id: toObjectId('rule-1'),
      name: 'Shop rule',
      priority: 0,
      save: jest.fn().mockResolvedValue(),
    };
    const res = { redirect: jest.fn() };
    mockReceiptMappingRule.findById.mockResolvedValue(rule);

    await controller.update_mapping_rule_priority({
      params: { id: 'rule-1' },
      body: { priority: '9' },
    }, res);

    expect(rule.priority).toBe(9);
    expect(rule.name).toBe('Shop rule');
    expect(rule.save).toHaveBeenCalledTimes(1);
    expect(res.redirect).toHaveBeenCalledWith('/receipt/mappings');
  });

  test('receipt mapping view renders edit and quick priority controls', () => {
    const html = pug.renderFile(path.join(process.cwd(), 'views/receipt_mappings.pug'), {
      rules: [{
        _id: toObjectId('rule-1'),
        name: 'Shop rule',
        target: 'credit',
        priority: 8,
        active: true,
        conditions: [{ field: 'business_name', operator: 'icontains', value: 'shop' }],
        updatedAt: new Date('2026-04-22T00:00:00.000Z'),
      }],
      editRule: {
        id: 'rule-1',
        name: 'Shop rule',
        description: 'Use card',
        target: 'credit',
        priority: 8,
        active: true,
        conditions: [{ field: 'business_name', operator: 'icontains', value: 'shop' }],
        budgetPrefill: { transaction_business: 'Shop', type: 'expense' },
        creditPrefill: { label: 'Card label', external: true, externalMultiplier: 2 },
      },
      errorMessage: null,
    });

    expect(html).toContain('Higher priority numbers are selected first');
    expect(html).toContain('action="/receipt/mappings/rule-1/priority"');
    expect(html).toContain('href="/receipt/mappings/rule-1/edit"');
    expect(html).toContain('Edit rule: Shop rule');
    expect(html).toContain('action="/receipt/mappings/rule-1"');
    expect(html).toContain('value="Card label"');
    expect(html).toContain('id="external_prefill" type="checkbox" name="external_prefill" value="true" checked');
  });
});

describe('receiptcontroller receipt entry form', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    BudgetService.getReceiptEntrySuggestions.mockResolvedValue({ businesses: [], tags: [] });
    CreditCardService.getLabelSuggestions.mockResolvedValue([]);
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
      receiptAutocomplete: {
        businesses: [],
        tags: [],
        creditLabels: [],
      },
    }));
  });

  test('supports legacy root-level credit mapping fields', async () => {
    const receipt = {
      _id: toObjectId('receipt-legacy'),
      date: new Date('2026-04-21T00:00:00.000Z'),
      amount: 4500,
      method: 'cash',
      business_name: 'Shop B',
      business_address: 'Address',
      layout_text: 'OCR text',
    };
    const legacyRule = {
      _id: toObjectId('rule-legacy'),
      name: 'Legacy card rule',
      target: 'credit',
      priority: 7,
      active: true,
      description: 'Legacy rule shape',
      conditions: [{ field: 'business_name', operator: 'icontains', value: 'shop' }],
      cardId: toObjectId('card-legacy'),
      label: 'Legacy label',
      external: true,
      externalMultiplier: 3,
      updatedAt: new Date('2026-04-22T00:00:00.000Z'),
    };
    const sortRules = jest.fn().mockResolvedValue([legacyRule]);
    const res = { render: jest.fn() };

    mockReceipt.findById.mockResolvedValue(receipt);
    mockReceiptMappingRule.find.mockReturnValue({ sort: sortRules });
    BudgetService.getReferenceLists.mockResolvedValue({
      accounts: [],
      categories: [],
      tags: [],
      types: ['expense'],
    });
    CreditCardService.listCards.mockResolvedValue([{ id: 'card-legacy', name: 'Visa' }]);

    await controller.receipt_entry_form({ params: { id: 'receipt-legacy' }, query: {} }, res);

    expect(res.render).toHaveBeenCalledWith('receipt_entry', expect.objectContaining({
      entryMode: 'credit',
      creditPrefill: expect.objectContaining({
        cardId: 'card-legacy',
        label: 'Legacy label',
        amount: 4500,
        external: true,
        externalMultiplier: 3,
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
    expect(html).toContain('autocomplete="off"');
    expect(html).toContain('data-single-autocomplete="businesses"');
    expect(html).toContain('data-single-autocomplete="creditLabels"');
    expect(html).toContain('id="external" type="checkbox" name="external" value="true" checked');

    const prefillMatch = html.match(/<script type="application\/json" id="prefill-data">([\s\S]*?)<\/script>/);
    expect(prefillMatch).not.toBeNull();
    expect(prefillMatch[1]).not.toContain('&quot;');
    const prefillData = JSON.parse(prefillMatch[1]);
    expect(prefillData.defaults.entryMode).toBe('budget');
    expect(prefillData.applied.entryMode).toBe('credit');
    expect(prefillData.applied.appliedRuleId).toBe('rule-1');
    expect(prefillData.applied.creditPrefill.external).toBe(true);
  });
});
