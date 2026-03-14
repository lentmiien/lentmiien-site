const mockReceipt = {
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndDelete: jest.fn(),
};

const mockReceiptMappingRule = {
  find: jest.fn(),
  findByIdAndDelete: jest.fn(),
};

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
