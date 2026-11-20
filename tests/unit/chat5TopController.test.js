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
const mockChangeMessage = jest.fn();
const mockList = jest.fn();
const mockPending = jest.fn();
jest.mock('../../services/conversationService', () => jest.fn().mockImplementation(() => ({ listUserConversations: mockList, fetchPending: mockPending, changeChatMessage: mockChangeMessage })));
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

const id = 'a'.repeat(24);
const messageId = 'b'.repeat(24);

test.each([
  { params: { messageId: 'bad' } }, { params: { id: 'NEW' } }, { params: { action: 'deleteAll' } },
  { query: { member: 'foreign' } }, { body: { messages: [] } },
])('rejects invalid message action inputs before database work', async override => {
  const req = { query: {}, ...override, params: { id, messageId, action: 'hide', ...override.params } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await controller.changeChatMessage(req, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(mockChangeMessage).not.toHaveBeenCalled();
});

test('broadcasts committed changes only to the selected conversation and handles lost membership', async () => {
  const room = { emit: jest.fn() };
  const io = { to: jest.fn(() => room), conversationRoom: value => 'conversation:' + value };
  const req = { params: { id, messageId, action: 'remove' }, user: { name: 'member' }, query: {}, app: { get: () => io } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  mockChangeMessage.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await controller.changeChatMessage(req, res);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(io.to).not.toHaveBeenCalled();
  await controller.changeChatMessage(req, res);
  expect(mockChangeMessage).toHaveBeenCalledWith(id, 'member', messageId, 'remove');
  expect(io.to).toHaveBeenCalledWith('conversation:' + id);
  expect(room.emit).toHaveBeenCalledWith('chat5-messages-removed', { conversationId: id, removedIds: [messageId] });
});
