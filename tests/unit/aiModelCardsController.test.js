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
jest.mock('../../services/conversationService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../services/knowledgeService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../services/templateService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../services/ttsService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../services/toolManagerService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../services/trainingDataService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../services/chat5ModelCatalogService', () => ({
  invalidateChatModelCache: jest.fn(),
  listAvailableChatModels: jest.fn(),
}));
jest.mock('../../services/chat5QuickSettingService', () => ({
  Chat5QuickSettingService: jest.fn().mockImplementation(() => ({})),
  serializeQuickSetting: jest.fn(),
}));

const { AIModelCards } = require('../../database');
const { invalidateChatModelCache } = require('../../services/chat5ModelCatalogService');
const controller = require('../../controllers/chat5controller');

function validModelBody(overrides = {}) {
  return {
    model_name: 'Updated local model',
    provider: 'Local',
    api_model: 'local-model',
    input_1m_token_cost: '0',
    output_1m_token_cost: '0',
    model_type: 'chat',
    in_modalities: ['text'],
    out_modalities: ['text'],
    max_tokens: '65536',
    max_out_tokens: '16384',
    deprecation_date: '',
    context_type: 'system',
    return_to: '/chat5/ai_model_cards?filter_provider=Local&edit=model-1',
    ...overrides,
  };
}

function responseDouble() {
  return {
    redirect: jest.fn(),
    render: jest.fn(),
  };
}

describe('AI model card controller editing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('updates only token limits inline and returns to the active Local filter', async () => {
    const model = {
      max_tokens: 32768,
      max_out_tokens: 8192,
      save: jest.fn().mockResolvedValue(undefined),
    };
    AIModelCards.findById.mockResolvedValue(model);
    const req = {
      params: { id: 'model-1' },
      body: {
        max_tokens: '131072',
        max_out_tokens: '32768',
        return_to: '/chat5/ai_model_cards?filter_provider=Local',
      },
    };
    const res = responseDouble();

    await controller.update_model_card_tokens(req, res);

    expect(model.max_tokens).toBe(131072);
    expect(model.max_out_tokens).toBe(32768);
    expect(model.save).toHaveBeenCalledTimes(1);
    expect(invalidateChatModelCache).toHaveBeenCalledTimes(1);
    expect(res.redirect).toHaveBeenCalledWith('/chat5/ai_model_cards?filter_provider=Local&saved=tokens');
  });

  test('rejects invalid inline limits before loading a model', async () => {
    const req = {
      params: { id: 'model-1' },
      body: {
        max_tokens: 'not-a-number',
        max_out_tokens: '8192',
        return_to: '/chat5/ai_model_cards?filter_provider=Local',
      },
    };
    const res = responseDouble();

    await controller.update_model_card_tokens(req, res);

    expect(AIModelCards.findById).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/chat5/ai_model_cards?filter_provider=Local&error=invalid-token-limits');
  });

  test('updates a complete card without replacing its original added date', async () => {
    const addedDate = new Date('2025-01-02T00:00:00.000Z');
    const model = {
      model_name: 'Old name',
      added_date: addedDate,
      save: jest.fn().mockResolvedValue(undefined),
    };
    AIModelCards.findById.mockResolvedValue(model);
    const req = { params: { id: 'model-1' }, body: validModelBody() };
    const res = responseDouble();

    await controller.update_model_card(req, res);

    expect(model).toEqual(expect.objectContaining({
      model_name: 'Updated local model',
      max_tokens: 65536,
      max_out_tokens: 16384,
      added_date: addedDate,
    }));
    expect(model.save).toHaveBeenCalledTimes(1);
    expect(invalidateChatModelCache).toHaveBeenCalledTimes(1);
    expect(res.redirect).toHaveBeenCalledWith('/chat5/ai_model_cards?filter_provider=Local&saved=updated');
  });

  test('prefills full edit mode and exposes filter choices from stored cards', async () => {
    const storedModel = {
      _id: 'model-1',
      model_name: 'Local Qwen',
      provider: 'Local',
      api_model: 'qwen-local',
      input_1m_token_cost: 0,
      output_1m_token_cost: 0,
      model_type: 'chat',
      in_modalities: ['text', 'image'],
      out_modalities: ['text'],
      max_tokens: 32768,
      max_out_tokens: 8192,
      added_date: new Date('2026-08-01T00:00:00.000Z'),
      deprecation_date: null,
      batch_use: true,
      context_type: 'system',
    };
    AIModelCards.find.mockResolvedValue([storedModel]);
    const req = { query: { edit: 'model-1' } };
    const res = responseDouble();

    await controller.ai_model_cards(req, res);

    expect(res.render).toHaveBeenCalledWith('ai_model_cards', expect.objectContaining({
      editingModel: expect.objectContaining({ _id: 'model-1', model_name: 'Local Qwen' }),
      formDefaults: expect.objectContaining({ max_tokens: 32768, max_out_tokens: 8192 }),
      filterOptions: expect.objectContaining({
        providers: ['Local'],
        types: ['chat'],
        inputModalities: ['image', 'text'],
      }),
    }));
  });
});
