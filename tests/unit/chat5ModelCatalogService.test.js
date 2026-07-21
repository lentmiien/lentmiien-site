const mockFind = jest.fn();
const mockGetOpenAIModels = jest.fn();

jest.mock('../../database', () => ({
  AIModelCards: { find: mockFind },
}));

jest.mock('../../utils/ChatGPT', () => ({
  GetOpenAIModels: mockGetOpenAIModels,
}));

const {
  invalidateChatModelCache,
  listAvailableChatModels,
} = require('../../services/chat5ModelCatalogService');

describe('Chat5 model catalog service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateChatModelCache();
  });

  test('returns supported OpenAI and local chat model cards and caches the result', async () => {
    mockFind.mockResolvedValue([
      { provider: 'OpenAI', api_model: 'gpt-current', model_type: 'chat' },
      { provider: 'OpenAI', api_model: 'gpt-missing', model_type: 'chat' },
      { provider: 'Local', api_model: 'local-model', model_type: 'chat' },
      { provider: 'Local', api_model: 'local-embedding', model_type: 'embedding' },
    ]);
    mockGetOpenAIModels.mockReturnValue([{ model: 'gpt-current' }]);

    const first = await listAvailableChatModels();
    const second = await listAvailableChatModels();

    expect(first.map((model) => model.api_model)).toEqual(['gpt-current', 'local-model']);
    expect(second).toBe(first);
    expect(mockFind).toHaveBeenCalledTimes(1);
    expect(mockGetOpenAIModels).toHaveBeenCalledTimes(1);
  });

  test('reloads model cards after invalidation', async () => {
    mockFind
      .mockResolvedValueOnce([{ provider: 'Local', api_model: 'first', model_type: 'chat' }])
      .mockResolvedValueOnce([{ provider: 'Local', api_model: 'second', model_type: 'chat' }]);
    mockGetOpenAIModels.mockReturnValue([]);

    await expect(listAvailableChatModels()).resolves.toEqual([
      expect.objectContaining({ api_model: 'first' }),
    ]);
    invalidateChatModelCache();
    await expect(listAvailableChatModels()).resolves.toEqual([
      expect.objectContaining({ api_model: 'second' }),
    ]);
  });
});
