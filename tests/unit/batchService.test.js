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
const mockConversation5Model = {
  findById: jest.fn(),
};

jest.mock('../../database', () => ({
  AIModelCards: { find: jest.fn().mockResolvedValue(mockModelCards) },
  Conversation5Model: mockConversation5Model,
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

const { AIModelCards, Conversation5Model } = require('../../database');
const {
  uploadBatchFile,
  startBatchJob,
  retrieveBatchStatus,
  downloadBatchOutput,
  deleteBatchFile,
} = require('../../utils/OpenAI_API');
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

const createConversation = (id, placeholderId) => ({
  _id: { toString: () => id },
  messages: placeholderId ? ['user-message', placeholderId] : ['user-message'],
  metadata: {},
  members: [],
  save: jest.fn().mockResolvedValue(),
});

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
      {
        deleteMessages: jest.fn().mockResolvedValue(1),
        loadMessagesInNewFormat: jest.fn().mockResolvedValue([]),
        processConvertedOutputs: jest.fn().mockResolvedValue([]),
      },
      { updateConversationDetails: jest.fn() },
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

  test('unknown-model prompts remove their response placeholder through shared deletion', async () => {
    const prompt = {
      custom_id: 'prompt-unknown-model',
      conversation_id: 'conv-unknown-model',
      message_id: 'ph-unknown-model',
      model: 'retired-model',
      task_type: 'response',
    };
    const conversation = createConversation('conv-unknown-model', 'ph-unknown-model');
    BatchPromptDatabase.find.mockResolvedValue([prompt]);
    Conversation5Model.findById.mockResolvedValue(conversation);

    await service.triggerBatchRequest();

    expect(conversation.messages).toEqual(['user-message']);
    expect(service.messageService.deleteMessages).toHaveBeenCalledWith(['ph-unknown-model'], {
      conversationId: 'conv-unknown-model',
    });
    expect(BatchPromptDatabase.deleteOne).toHaveBeenCalledWith({
      custom_id: 'prompt-unknown-model',
    });
    expect(uploadBatchFile).not.toHaveBeenCalled();
  });

  test('unavailable conversation snapshots still clean a queued response placeholder', async () => {
    const prompt = {
      custom_id: 'prompt-missing-snapshot',
      conversation_id: 'conv-missing-snapshot',
      message_id: 'ph-missing-snapshot',
      model: 'gpt-4.1-2025-04-14',
      task_type: 'response',
    };
    const conversation = createConversation('conv-missing-snapshot', 'ph-missing-snapshot');
    BatchPromptDatabase.find.mockResolvedValue([prompt]);
    service._loadConversationSnapshot = jest.fn().mockResolvedValue(null);
    Conversation5Model.findById.mockResolvedValue(conversation);

    await service.triggerBatchRequest();

    expect(conversation.messages).toEqual(['user-message']);
    expect(service.messageService.deleteMessages).toHaveBeenCalledWith(['ph-missing-snapshot'], {
      conversationId: 'conv-missing-snapshot',
    });
    expect(BatchPromptDatabase.deleteOne).toHaveBeenCalledWith({
      custom_id: 'prompt-missing-snapshot',
    });
  });

  test('empty batch input cleans the queued placeholder before discarding the prompt', async () => {
    const prompt = {
      custom_id: 'prompt-empty-input',
      conversation_id: 'conv-empty-input',
      message_id: 'ph-empty-input',
      model: 'gpt-4.1-2025-04-14',
      task_type: 'response',
    };
    const conversation = createConversation('conv-empty-input', 'ph-empty-input');
    BatchPromptDatabase.find.mockResolvedValue([prompt]);
    service._loadConversationSnapshot = jest.fn().mockResolvedValue({
      conversation,
      messages: [],
    });
    service._buildInputFromSnapshot = jest.fn().mockResolvedValue([]);

    await service.triggerBatchRequest();

    expect(conversation.messages).toEqual(['user-message']);
    expect(service.messageService.deleteMessages).toHaveBeenCalledWith(['ph-empty-input'], {
      conversationId: 'conv-empty-input',
    });
    expect(BatchPromptDatabase.deleteOne).toHaveBeenCalledWith({
      custom_id: 'prompt-empty-input',
    });
  });

  test.each(['failed', 'cancelled', 'expired'])(
    'terminal batch status %s cleans all queued response placeholders',
    async (status) => {
      const batch = {
        id: `batch-${status}`,
        status: 'in_progress',
        save: jest.fn().mockResolvedValue(),
      };
      const prompt = {
        custom_id: `prompt-${status}`,
        request_id: batch.id,
        conversation_id: `conv-${status}`,
        message_id: `ph-${status}`,
        task_type: 'response',
      };
      const conversation = createConversation(`conv-${status}`, `ph-${status}`);
      BatchRequestDatabase.findOne.mockResolvedValue(batch);
      retrieveBatchStatus.mockResolvedValue({ status });
      BatchPromptDatabase.find.mockResolvedValue([prompt]);
      Conversation5Model.findById.mockResolvedValue(conversation);

      const result = await service.checkBatchStatus(batch.id);

      expect(result.status).toBe(status);
      expect(conversation.messages).toEqual(['user-message']);
      expect(service.messageService.deleteMessages).toHaveBeenCalledWith([`ph-${status}`], {
        conversationId: `conv-${status}`,
      });
      expect(BatchPromptDatabase.deleteOne).toHaveBeenCalledWith({
        custom_id: `prompt-${status}`,
      });
    },
  );

  test('terminal batch status retains the prompt when shared placeholder cleanup fails', async () => {
    const batch = {
      id: 'batch-cleanup-failed',
      status: 'in_progress',
      save: jest.fn().mockResolvedValue(),
    };
    const prompt = {
      custom_id: 'prompt-cleanup-failed',
      request_id: batch.id,
      conversation_id: 'conv-cleanup-failed',
      message_id: 'ph-cleanup-failed',
      task_type: 'response',
    };
    const conversation = createConversation('conv-cleanup-failed', 'ph-cleanup-failed');
    BatchRequestDatabase.findOne.mockResolvedValue(batch);
    retrieveBatchStatus.mockResolvedValue({ status: 'failed' });
    BatchPromptDatabase.find.mockResolvedValue([prompt]);
    Conversation5Model.findById.mockResolvedValue(conversation);
    service.messageService.deleteMessages.mockRejectedValue(new Error('vector queue offline'));

    await service.checkBatchStatus(batch.id);

    expect(conversation.messages).toEqual(['user-message']);
    expect(BatchPromptDatabase.deleteOne).not.toHaveBeenCalled();
  });

  test('periodic terminal cleanup retries retained prompts without contacting the provider', async () => {
    const prompt = {
      custom_id: 'prompt-terminal-retry',
      request_id: 'batch-terminal-retry',
      conversation_id: 'conv-terminal-retry',
      message_id: 'ph-terminal-retry',
      task_type: 'response',
    };
    const unrelatedPrompt = {
      custom_id: 'prompt-still-running',
      request_id: 'batch-still-running',
      conversation_id: 'conv-still-running',
      message_id: 'ph-still-running',
      task_type: 'response',
    };
    const conversation = createConversation('conv-terminal-retry', 'ph-terminal-retry');
    BatchPromptDatabase.find.mockResolvedValue([unrelatedPrompt, prompt]);
    BatchRequestDatabase.find.mockResolvedValue([{
      id: prompt.request_id,
      status: 'failed',
    }]);
    Conversation5Model.findById.mockResolvedValue(conversation);
    service.messageService.deleteMessages
      .mockRejectedValueOnce(new Error('vector queue offline'))
      .mockResolvedValueOnce(0);

    await expect(service.retryTerminalPromptCleanup()).resolves.toEqual({
      attempted: 1,
      cleaned: 0,
      deferred: 1,
    });
    expect(BatchPromptDatabase.deleteOne).not.toHaveBeenCalled();

    await expect(service.retryTerminalPromptCleanup()).resolves.toEqual({
      attempted: 1,
      cleaned: 1,
      deferred: 0,
    });
    expect(BatchPromptDatabase.deleteOne).toHaveBeenCalledWith({
      custom_id: prompt.custom_id,
    });
    expect(retrieveBatchStatus).not.toHaveBeenCalled();
    expect(downloadBatchOutput).not.toHaveBeenCalled();
    expect(uploadBatchFile).not.toHaveBeenCalled();
    expect(startBatchJob).not.toHaveBeenCalled();
  });

  test('builds batch response input from the configured start message', async () => {
    const message = (id, userId, text) => ({
      _id: { toString: () => id },
      user_id: userId,
      contentType: 'text',
      content: { text },
      hideFromBot: false,
    });
    const messages = [
      message('message-1', 'Lennart', 'Before configured start'),
      message('message-2', 'bot', 'Configured start'),
      message('message-3', 'Lennart', 'Newest message'),
      message('placeholder', 'bot', 'Pending batch response'),
    ];

    const input = await service._buildInputFromSnapshot({
      prompt: { task_type: 'response', message_id: 'placeholder' },
      conversation: {
        metadata: {
          contextPrompt: '',
          startMessageId: 'message-2',
        },
      },
      messages,
      modelCard: { context_type: 'none', in_modalities: ['text'] },
    });

    expect(input).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Configured start' }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Newest message' }],
      },
    ]);
  });

  test('does not include messages after a queued batch response placeholder', async () => {
    const message = (id, userId, text) => ({
      _id: { toString: () => id },
      user_id: userId,
      contentType: 'text',
      content: { text },
      hideFromBot: false,
    });

    const input = await service._buildInputFromSnapshot({
      prompt: { task_type: 'response', message_id: 'placeholder' },
      conversation: {
        metadata: {
          contextPrompt: '',
          startMessageId: 'message-after-placeholder',
        },
      },
      messages: [
        message('message-before-placeholder', 'Lennart', 'Original request'),
        message('placeholder', 'bot', 'Pending batch response'),
        message('message-after-placeholder', 'Lennart', 'Later request'),
      ],
      modelCard: { context_type: 'none', in_modalities: ['text'] },
    });

    expect(input).toEqual([]);
  });

  test('completed batch record without a response body cleans its placeholder and prompt', async () => {
    const request = {
      id: 'batch-missing-body',
      status: 'completed',
      input_file_id: 'input-file',
      output_file_id: 'output-file',
      save: jest.fn().mockResolvedValue(),
    };
    const prompt = {
      custom_id: 'prompt-missing-body',
      request_id: request.id,
      conversation_id: 'conv-missing-body',
      message_id: 'ph-missing-body',
      task_type: 'response',
    };
    const conversation = createConversation('conv-missing-body', 'ph-missing-body');
    BatchRequestDatabase.find.mockResolvedValue([request]);
    downloadBatchOutput.mockResolvedValue([{ custom_id: prompt.custom_id }]);
    BatchPromptDatabase.findOne.mockResolvedValue(prompt);
    BatchPromptDatabase.find.mockResolvedValue([]);
    Conversation5Model.findById.mockResolvedValue(conversation);

    const result = await service.processBatchResponses();

    expect(result.prompts).toEqual([prompt.custom_id]);
    expect(conversation.messages).toEqual(['user-message']);
    expect(service.messageService.deleteMessages).toHaveBeenCalledWith(['ph-missing-body'], {
      conversationId: 'conv-missing-body',
    });
    expect(BatchPromptDatabase.deleteOne).toHaveBeenCalledWith({
      custom_id: prompt.custom_id,
    });
    expect(request.status).toBe('DONE');
  });

  test('completed batch response with a missing conversation still deletes its placeholder document', async () => {
    const request = {
      id: 'batch-missing-conversation',
      status: 'completed',
      input_file_id: 'input-file',
      output_file_id: 'output-file',
      save: jest.fn().mockResolvedValue(),
    };
    const prompt = {
      custom_id: 'prompt-missing-conversation',
      request_id: request.id,
      conversation_id: 'conv-missing-conversation',
      message_id: 'ph-missing-conversation',
      task_type: 'response',
    };
    BatchRequestDatabase.find.mockResolvedValue([request]);
    downloadBatchOutput.mockResolvedValue([{
      custom_id: prompt.custom_id,
      response: { body: { output: [] } },
    }]);
    BatchPromptDatabase.findOne.mockResolvedValue(prompt);
    BatchPromptDatabase.find.mockResolvedValue([]);
    Conversation5Model.findById.mockResolvedValue(null);

    const result = await service.processBatchResponses();

    expect(result.prompts).toEqual([prompt.custom_id]);
    expect(service.messageService.deleteMessages).toHaveBeenCalledWith(
      ['ph-missing-conversation'],
      { conversationId: 'conv-missing-conversation' },
    );
    expect(BatchPromptDatabase.deleteOne).toHaveBeenCalledWith({
      custom_id: prompt.custom_id,
    });
  });

  test('completed batch request cleans prompts omitted from the provider output', async () => {
    const request = {
      id: 'batch-omitted-response',
      status: 'completed',
      input_file_id: 'input-file',
      output_file_id: 'output-file',
      save: jest.fn().mockResolvedValue(),
    };
    const prompt = {
      custom_id: 'prompt-omitted-response',
      request_id: request.id,
      conversation_id: 'conv-omitted-response',
      message_id: 'ph-omitted-response',
      task_type: 'response',
    };
    const conversation = createConversation('conv-omitted-response', 'ph-omitted-response');
    BatchRequestDatabase.find.mockResolvedValue([request]);
    downloadBatchOutput.mockResolvedValue([]);
    BatchPromptDatabase.find.mockResolvedValue([prompt]);
    Conversation5Model.findById.mockResolvedValue(conversation);

    const result = await service.processBatchResponses();

    expect(result.prompts).toEqual([prompt.custom_id]);
    expect(conversation.messages).toEqual(['user-message']);
    expect(service.messageService.deleteMessages).toHaveBeenCalledWith(['ph-omitted-response'], {
      conversationId: 'conv-omitted-response',
    });
    expect(request.status).toBe('DONE');
  });

  test('completed batch keeps its request and files retriable when placeholder cleanup fails', async () => {
    const request = {
      id: 'batch-cleanup-deferred',
      status: 'completed',
      input_file_id: 'input-file',
      output_file_id: 'output-file',
      save: jest.fn().mockResolvedValue(),
    };
    const prompt = {
      custom_id: 'prompt-cleanup-deferred',
      request_id: request.id,
      conversation_id: 'conv-cleanup-deferred',
      message_id: 'ph-cleanup-deferred',
      task_type: 'response',
    };
    const conversation = createConversation('conv-cleanup-deferred', 'ph-cleanup-deferred');
    BatchRequestDatabase.find.mockResolvedValue([request]);
    downloadBatchOutput.mockResolvedValue([{ custom_id: prompt.custom_id }]);
    BatchPromptDatabase.findOne.mockResolvedValue(prompt);
    BatchPromptDatabase.find.mockResolvedValue([]);
    Conversation5Model.findById.mockResolvedValue(conversation);
    service.messageService.deleteMessages.mockRejectedValue(new Error('vector queue offline'));

    const result = await service.processBatchResponses();

    expect(result.requests).toEqual([]);
    expect(BatchPromptDatabase.deleteOne).not.toHaveBeenCalled();
    expect(request.status).toBe('completed');
    expect(request.save).not.toHaveBeenCalled();
    expect(deleteBatchFile).not.toHaveBeenCalled();
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
