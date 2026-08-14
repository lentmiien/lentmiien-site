const mockModelCards = [
  {
    api_model: 'gpt-4.1-2025-04-14',
    provider: 'OpenAI',
    model_type: 'chat',
    batch_use: true,
    in_modalities: ['text'],
    context_type: 'system',
  },
  {
    api_model: 'gpt-4.1-nano-2025-04-14',
    provider: 'OpenAI',
    model_type: 'chat',
    batch_use: true,
    in_modalities: ['text'],
    context_type: 'system',
  },
  {
    api_model: 'gpt-5.6-luna',
    provider: 'OpenAI',
    model_type: 'chat',
    batch_use: true,
    in_modalities: ['text'],
    context_type: 'developer',
  },
  {
    api_model: 'gpt-5.6-sol',
    provider: 'OpenAI',
    model_type: 'chat',
    batch_use: true,
    in_modalities: ['text'],
    context_type: 'system',
  },
];

const mockSupportsReasoningModel = jest.fn(() => false);
const mockSupportsReasoningMode = jest.fn(() => false);

jest.mock('../../database', () => ({
  AIModelCards: { find: jest.fn().mockResolvedValue(mockModelCards) },
}));

jest.mock('../../utils/OpenAI_API', () => ({
  uploadBatchFile: jest.fn(),
  startBatchJob: jest.fn(),
  retrieveBatchStatus: jest.fn(),
  downloadBatchOutput: jest.fn(),
  deleteBatchFile: jest.fn(),
  convertResponseBody: jest.fn(),
  supportsReasoningModel: mockSupportsReasoningModel,
  supportsReasoningMode: mockSupportsReasoningMode,
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  warning: jest.fn(),
  notice: jest.fn(),
  info: jest.fn(),
}));

const { AIModelCards } = require('../../database');
const { uploadBatchFile, startBatchJob } = require('../../utils/OpenAI_API');
const BatchService = require('../../services/batchService');
const {
  invalidateBatchModelCache,
  resolveConfiguredDefaultModel,
  resolveConfiguredSummaryModel,
} = require('../../services/batchService');

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const createBatchPromptModel = () => {
  const docs = [];
  const model = jest.fn(function (doc) {
    docs.push(doc);
    this.doc = doc;
    this.save = jest.fn().mockResolvedValue(doc);
    return this;
  });
  model.find = jest.fn();
  model.findOne = jest.fn();
  model.deleteOne = jest.fn();
  model.updateMany = jest.fn();
  model.mockDocs = docs;
  return model;
};

const createBatchRequestModel = () => {
  const model = jest.fn(function (doc) {
    this.doc = doc;
    this.save = jest.fn().mockResolvedValue(doc);
    return this;
  });
  model.find = jest.fn();
  model.findOne = jest.fn();
  return model;
};

describe('BatchService (chat5)', () => {
  let BatchPromptDatabase;
  let BatchRequestDatabase;
  let service;

  beforeAll(async () => {
    await flushPromises();
  });

  beforeEach(async () => {
    invalidateBatchModelCache();
    AIModelCards.find.mockResolvedValue(mockModelCards);
    mockSupportsReasoningModel.mockReturnValue(false);
    mockSupportsReasoningMode.mockReturnValue(false);
    BatchPromptDatabase = createBatchPromptModel();
    BatchRequestDatabase = createBatchRequestModel();
    service = new BatchService(
      BatchPromptDatabase,
      BatchRequestDatabase,
      { processConvertedOutputs: jest.fn() },
      {},
    );
    await flushPromises();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('addPromptToBatch queues response entry when model supported', async () => {
    BatchPromptDatabase.find.mockResolvedValue([]);

    const payload = {
      userId: 'user-1',
      conversationId: 'conv-123',
      messageId: 'msg-456',
      model: 'gpt-4.1',
      title: 'Conversation',
      taskType: 'response',
    };

    const result = await service.addPromptToBatch(payload);

    expect(result).toBe('conv-123');
    expect(BatchPromptDatabase.mockDocs).toHaveLength(1);
    expect(BatchPromptDatabase.mockDocs[0]).toMatchObject({
      conversation_id: 'conv-123',
      message_id: 'msg-456',
      model: 'gpt-4.1-2025-04-14',
      task_type: 'response',
      user_id: 'user-1',
    });
  });

  test('addPromptToBatch uses the configured default when the selected model is ineligible', async () => {
    const appSettingsService = {
      getValue: jest.fn().mockResolvedValue('gpt-5.6-luna'),
    };
    service = new BatchService(
      BatchPromptDatabase,
      BatchRequestDatabase,
      { processConvertedOutputs: jest.fn() },
      {},
      appSettingsService,
    );

    const result = await service.addPromptToBatch({
      userId: 'user-1',
      conversationId: 'conv-123',
      messageId: 'msg-456',
      model: 'claude-ineligible-for-openai-batch',
      title: 'Conversation',
      taskType: 'response',
    });

    expect(result).toBe('conv-123');
    expect(appSettingsService.getValue).toHaveBeenCalledWith('chat5.batch.default_model');
    expect(BatchPromptDatabase.mockDocs[0]).toMatchObject({
      model: 'gpt-5.6-luna',
      task_type: 'response',
    });
  });

  test('does not read the batch default setting when the selected model is eligible', async () => {
    const appSettingsService = {
      getValue: jest.fn(),
    };
    service = new BatchService(
      BatchPromptDatabase,
      BatchRequestDatabase,
      { processConvertedOutputs: jest.fn() },
      {},
      appSettingsService,
    );

    await service.addPromptToBatch({
      userId: 'user-1',
      conversationId: 'conv-123',
      messageId: 'msg-456',
      model: 'gpt-4.1',
      title: 'Conversation',
      taskType: 'response',
    });

    expect(appSettingsService.getValue).not.toHaveBeenCalled();
    expect(BatchPromptDatabase.mockDocs[0]).toMatchObject({
      model: 'gpt-4.1-2025-04-14',
    });
  });

  test('addPromptToBatch skips summary duplicates', async () => {
    BatchPromptDatabase.find.mockResolvedValue([{ task_type: 'summary', request_id: 'new' }]);

    const result = await service.addPromptToBatch({
      userId: 'user-1',
      conversationId: 'conv-123',
      model: 'gpt-4.1',
      title: 'Summary',
      taskType: 'summary',
    });

    expect(result).toBe('conv-123');
    expect(BatchPromptDatabase.mockDocs).toHaveLength(0);
  });

  test('getPromptConversationIds returns pending response conversation ids', async () => {
    const docs = [
      { conversation_id: 'conv-1', request_id: 'new', task_type: 'response' },
      { conversation_id: 'conv-1', request_id: 'started', task_type: 'response' },
      { conversation_id: 'conv-2', request_id: 'new', task_type: 'summary' },
      { conversation_id: 'conv-3', request_id: 'new', task_type: 'response' },
    ];

    BatchPromptDatabase.find.mockImplementation((query) => {
      if (query && query.task_type === 'response') {
        return Promise.resolve(docs.filter((doc) => doc.task_type === 'response'));
      }
      return Promise.resolve(docs);
    });

    const ids = await service.getPromptConversationIds();

    expect(ids).toEqual(['conv-1', 'conv-3']);
  });

  test('triggerBatchRequest sends pro reasoning mode for GPT-5.6', async () => {
    const prompt = {
      custom_id: 'prompt-1',
      conversation_id: 'conv-1',
      message_id: 'msg-1',
      model: 'gpt-5.6-sol',
      task_type: 'response',
    };
    BatchPromptDatabase.find.mockResolvedValue([prompt]);
    BatchPromptDatabase.updateMany.mockResolvedValue({ modifiedCount: 1 });
    mockSupportsReasoningModel.mockReturnValue(true);
    mockSupportsReasoningMode.mockReturnValue(true);
    uploadBatchFile.mockResolvedValue({ id: 'file-1' });
    startBatchJob.mockResolvedValue({ id: 'batch-1', status: 'validating' });
    service._loadConversationSnapshot = jest.fn().mockResolvedValue({
      conversation: {
        metadata: {
          outputFormat: 'text',
          reasoning: 'max',
          mode: 'pro',
        },
      },
      messages: [],
    });
    service._buildInputFromSnapshot = jest.fn().mockResolvedValue([
      { role: 'user', content: [{ type: 'input_text', text: 'Review this.' }] },
    ]);

    await service.triggerBatchRequest();

    const request = JSON.parse(uploadBatchFile.mock.calls[0][0]);
    expect(request.body.reasoning).toEqual({
      effort: 'max',
      summary: 'detailed',
      mode: 'pro',
    });
  });

  test('resolves the automatic summary model from app settings', async () => {
    const appSettingsService = {
      getValue: jest.fn().mockResolvedValue('gpt-4.1-nano'),
    };

    await expect(resolveConfiguredSummaryModel(appSettingsService, 'gpt-4.1'))
      .resolves.toEqual(expect.objectContaining({
        model: 'gpt-4.1-nano-2025-04-14',
        usedFallback: false,
      }));
  });

  test('resolves the batch default model from app settings', async () => {
    const appSettingsService = {
      getValue: jest.fn().mockResolvedValue('gpt-5.6-luna'),
    };

    await expect(resolveConfiguredDefaultModel(appSettingsService))
      .resolves.toEqual({
        model: 'gpt-5.6-luna',
        configuredModel: 'gpt-5.6-luna',
        settingError: null,
      });
  });

  test('falls back to the completed request model when the configured summary model is unsupported', async () => {
    const appSettingsService = {
      getValue: jest.fn().mockResolvedValue('retired-summary-model'),
    };

    await expect(resolveConfiguredSummaryModel(appSettingsService, 'gpt-4.1-2025-04-14'))
      .resolves.toEqual(expect.objectContaining({
        model: 'gpt-4.1-2025-04-14',
        configuredModel: 'retired-summary-model',
        usedFallback: true,
      }));
  });

  test('reloads batch model cards after explicit cache invalidation', async () => {
    await resolveConfiguredSummaryModel({
      getValue: jest.fn().mockResolvedValue('gpt-4.1'),
    });
    invalidateBatchModelCache();
    await resolveConfiguredSummaryModel({
      getValue: jest.fn().mockResolvedValue('gpt-4.1'),
    });

    expect(AIModelCards.find).toHaveBeenCalledTimes(2);
  });
});
