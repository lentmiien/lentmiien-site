jest.mock('../../database', () => {
  const AIModelCards = jest.fn().mockImplementation(function AIModelCard(payload) {
    Object.assign(this, payload);
    this.save = jest.fn().mockResolvedValue(this);
  });
  AIModelCards.find = jest.fn();
  AIModelCards.findById = jest.fn();
  AIModelCards.findByIdAndDelete = jest.fn();
  return {
    AIModelCards,
    Chat4Model: {},
    Conversation4Model: {},
    Conversation5Model: {},
    Chat4KnowledgeModel: {},
    FileMetaModel: {},
    Chat3TemplateModel: {},
    Chat5QuickSettingModel: {},
    ChatPersonalityModel: {},
    ChatResponseTypeModel: {},
  };
});

jest.mock('../../utils/ChatGPT', () => ({ GetOpenAIModels: jest.fn(() => []) }));
jest.mock('../../utils/anthropic', () => ({ GetAnthropicModels: jest.fn(() => []) }));
jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warning: jest.fn(),
  notice: jest.fn(),
}));
jest.mock('../../utils/chat5Markdown', () => ({
  renderMessageHtml: jest.fn(),
  renderMessagesHtml: jest.fn(),
}));

jest.mock('../../services/messageService', () => jest.fn().mockImplementation(() => ({})));
const mockList = jest.fn();
const mockPending = jest.fn();
jest.mock('../../services/conversationService', () => jest.fn().mockImplementation(() => ({ listUserConversations: mockList, fetchPending: mockPending })));
jest.mock('../../services/knowledgeService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../services/templateService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../services/ttsService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../services/toolManagerService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../services/trainingDataService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../services/chat5ModelCatalogService', () => ({
  invalidateChatModelCache: jest.fn(),
  listAvailableChatModels: jest.fn(),
}));
jest.mock('../../services/batchService', () => ({
  invalidateBatchModelCache: jest.fn(),
}));
jest.mock('../../services/chat5QuickSettingService', () => ({
  Chat5QuickSettingService: jest.fn().mockImplementation(() => ({})),
  serializeQuickSetting: jest.fn(),
}));

const { AIModelCards } = require('../../database');
const controller = require('../../controllers/chat5controller');


const logger = require('../../utils/logger');

beforeEach(() => {
  mockList.mockResolvedValue([{ _id: 'mine', title: 'Private title', category: 'Work', updatedAt: new Date(), metadata: { model: 'retired' } }]);
  mockPending.mockResolvedValue(['foreign-id', 'mine']);
});

test('loads even deprecated model cards for only the scoped list and exposes no foreign pending IDs', async () => {
  const lean = jest.fn().mockResolvedValue([{ api_model: 'retired', model_name: 'Retired', deprecation_date: '2020-01-01' }]);
  AIModelCards.find.mockReturnValue({ select: () => ({ lean }) });
  const res = { render: jest.fn() };
  const next = jest.fn();
  await controller.view_chat5_top({ user: { name: 'owner' }, query: { user: 'foreign' } }, res, next);
  expect(mockList).toHaveBeenCalledWith('owner');
  expect(AIModelCards.find).toHaveBeenCalledWith({ api_model: { $in: ['retired'] } });
  const locals = res.render.mock.calls[0][1];
  expect(locals.conversations[0].filters.deprecation).toEqual(['deprecated']);
  expect(locals.conversations[0].isPending).toBe(true);
  expect(JSON.stringify(locals)).not.toContain('foreign-id');
  expect(next).not.toHaveBeenCalled();
});

test('catalog failure keeps conversations available, reports degraded status, and logs no payload', async () => {
  AIModelCards.find.mockReturnValue({ select: () => ({ lean: async () => { throw new Error('sensitive diagnostic'); } }) });
  const res = { render: jest.fn() };
  await controller.view_chat5_top({ user: { name: 'owner' } }, res, jest.fn());
  const locals = res.render.mock.calls[0][1];
  expect(locals.modelCardsUnavailable).toBe(true);
  expect(locals.conversations[0].filters.deprecation).toEqual(['unknown']);
  expect(logger.warning).toHaveBeenCalledWith('Failed to load model cards for Chat5 conversation list', {
    category: 'chat5', metadata: { errorName: 'Error' },
  });
});

test('logs and forwards conversation list failures', async () => {
  const error = new Error('private diagnostic');
  mockList.mockRejectedValue(error);
  const next = jest.fn();
  const res = { render: jest.fn() };
  await controller.view_chat5_top({ user: { name: 'owner' } }, res, next);
  expect(res.render).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledWith(error);
  expect(logger.error).toHaveBeenCalledWith('Failed to load Chat5 conversation list', {
    category: 'chat5', metadata: { errorName: 'Error' },
  });
});
