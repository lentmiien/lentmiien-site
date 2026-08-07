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

  afterEach(() => {
    jest.useRealTimers();
  });

  test('returns supported, non-deprecated OpenAI and local chat model cards and caches the lookup', async () => {
    mockFind.mockResolvedValue([
      { provider: 'OpenAI', api_model: 'gpt-current', model_type: 'chat' },
      { provider: 'OpenAI', api_model: 'gpt-deprecated', model_type: 'chat', deprecation_date: new Date('2000-01-01T00:00:00.000Z') },
      { provider: 'OpenAI', api_model: 'gpt-missing', model_type: 'chat' },
      { provider: 'Local', api_model: 'local-model', model_type: 'chat' },
      { provider: 'Local', api_model: 'local-scheduled', model_type: 'chat', deprecation_date: new Date('2999-01-01T00:00:00.000Z') },
      { provider: 'Local', api_model: 'local-deprecated', model_type: 'chat', deprecation_date: new Date('2000-01-01T00:00:00.000Z') },
      { provider: 'Local', api_model: 'local-embedding', model_type: 'embedding' },
    ]);
    mockGetOpenAIModels.mockReturnValue([
      { model: 'gpt-current' },
      { model: 'gpt-deprecated' },
    ]);

    const first = await listAvailableChatModels();
    const second = await listAvailableChatModels();

    expect(first.map((model) => model.api_model)).toEqual([
      'gpt-current',
      'local-model',
      'local-scheduled',
    ]);
    expect(second).toEqual(first);
    expect(mockFind).toHaveBeenCalledTimes(1);
    expect(mockGetOpenAIModels).toHaveBeenCalledTimes(1);
  });

  test('rechecks cached model deprecation dates as calendar days pass', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 15, 12, 0, 0));
    mockFind.mockResolvedValue([
      { provider: 'Local', api_model: 'local-expiring', model_type: 'chat', deprecation_date: new Date('2026-07-15T00:00:00.000Z') },
    ]);
    mockGetOpenAIModels.mockReturnValue([]);

    await expect(listAvailableChatModels()).resolves.toEqual([
      expect.objectContaining({ api_model: 'local-expiring' }),
    ]);

    jest.setSystemTime(new Date(2026, 6, 16, 12, 0, 0));

    await expect(listAvailableChatModels()).resolves.toEqual([]);
    expect(mockFind).toHaveBeenCalledTimes(1);
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
