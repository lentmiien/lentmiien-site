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
];

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
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  notice: jest.fn(),
  info: jest.fn(),
}));

const { AIModelCards } = require('../../database');
const BatchService = require('../../services/batchService');

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
});
