const mockModelCards = [
  { api_model: 'gpt-4.1-2025-04-14', provider: 'OpenAI' },
  { api_model: 'gpt-4.1-nano-2025-04-14', provider: 'OpenAI' },
  { api_model: 'o1-2024-12-17', provider: 'OpenAI' }
];

jest.mock('../../database', () => ({
  AIModelCards: { find: jest.fn().mockResolvedValue(mockModelCards) }
}));

jest.mock('../../utils/ChatGPT', () => ({
  upload_file: jest.fn(),
  download_file: jest.fn(),
  delete_file: jest.fn(),
  start_batch: jest.fn(),
  batch_status: jest.fn()
}));

jest.mock('../../utils/anthropic', () => ({
  anthropic_batch_start: jest.fn(),
  anthropic_batch_status: jest.fn(),
  anthropic_batch_results: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
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
  model.mockDocs = docs;
  return model;
};

const createBatchRequestModel = () => {
  const docs = [];
  const model = jest.fn(function (doc) {
    docs.push(doc);
    this.doc = doc;
    this.save = jest.fn().mockResolvedValue(doc);
    return this;
  });
  model.find = jest.fn();
  model.findOne = jest.fn();
  model.mockDocs = docs;
  return model;
};

describe('BatchService', () => {
  let BatchPromptDatabase;
  let BatchRequestDatabase;
  let messageService;
  let conversationService;
  let service;

  beforeAll(async () => {
    await flushPromises();
  });

  beforeEach(async () => {
    BatchPromptDatabase = createBatchPromptModel();
    BatchRequestDatabase = createBatchRequestModel();
    messageService = {
      CreateCustomMessage: jest.fn(),
      createMessage: jest.fn()
    };
    conversationService = {
      generateConversationFromMessages: jest.fn().mockResolvedValue('generated-conv'),
      createEmptyConversation: jest.fn().mockResolvedValue('new-conv'),
      copyConversation: jest.fn().mockResolvedValue('copied-conv'),
      updateConversation: jest.fn().mockResolvedValue(),
      loadProcessNewImageToBase64: jest.fn().mockResolvedValue({
        new_filename: 'processed.png',
        b64_img: 'b64-data'
      }),
      loadImageToBase64: jest.fn().mockResolvedValue('b64-from-store'),
      generateMessageArrayForConversation: jest.fn().mockResolvedValue([]),
      updateSummary: jest.fn(),
      getConversationsById: jest.fn(),
      getCategoryTagsForConversationsById: jest.fn(),
      appendMessageToConversation: jest.fn(),
      postToConversation: jest.fn()
    };
    service = new BatchService(
      BatchPromptDatabase,
      BatchRequestDatabase,
      messageService,
      conversationService
    );
    await flushPromises();
  });

  test('getAll returns prompts and recent requests', async () => {
    const promptDocs = [{ custom_id: 'p1' }];
    const requestDocs = [
      { id: 'r1', created_at: new Date() },
      { id: 'r2', created_at: new Date() }
    ];
    BatchPromptDatabase.find.mockResolvedValue(promptDocs);
    BatchRequestDatabase.find.mockResolvedValue(requestDocs);

    const result = await service.getAll();

    expect(BatchPromptDatabase.find).toHaveBeenCalledWith();
    expect(BatchRequestDatabase.find).toHaveBeenCalledWith({
      created_at: expect.objectContaining({ $gt: expect.any(Date) })
    });
    expect(result.prompts).toBe(promptDocs);
    expect(result.requests.map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  test('getPromptConversationIds filters duplicates and summary prompts', async () => {
    BatchPromptDatabase.find.mockResolvedValue([
      { conversation_id: 'c1', prompt: 'Question' },
      { conversation_id: 'c1', prompt: '@SUMMARY' },
      { conversation_id: 'c2', prompt: 'Request' }
    ]);

    const ids = await service.getPromptConversationIds();

    expect(ids).toEqual(['c1', 'c2']);
  });

  test('addPromptToBatch creates new conversation and saves prompt', async () => {
    BatchPromptDatabase.find.mockResolvedValue([]);

    const conversationId = await service.addPromptToBatch(
      'user-1',
      'Provide details',
      'new',
      ['img-path'],
      { title: 'Batch Title', tags: 'alpha,beta' },
      'gpt-4.1'
    );

    expect(conversationId).toBe('new-conv');
    expect(conversationService.createEmptyConversation).toHaveBeenCalledWith('user-1');
    expect(conversationService.updateConversation).toHaveBeenCalledWith(
      'new-conv',
      { title: 'Batch Title', tags: 'alpha,beta' },
      'batch+gpt-4.1-2025-04-14'
    );
    expect(conversationService.loadProcessNewImageToBase64).toHaveBeenCalledWith('img-path');
    expect(BatchPromptDatabase.mockDocs[0]).toMatchObject({
      title: 'Batch Title',
      conversation_id: 'new-conv',
      model: 'gpt-4.1-2025-04-14',
      prompt: 'Provide details',
      images: [
        { filename: 'processed.png', use_flag: 'high quality' }
      ]
    });
  });

  test('addPromptToBatch skips duplicate summary requests', async () => {
    BatchPromptDatabase.find.mockResolvedValueOnce([{ request_id: 'new' }]);

    const result = await service.addPromptToBatch(
      'user-1',
      '@SUMMARY',
      'conv-1',
      [],
      { title: 'Summary' },
      'gpt-4.1'
    );

    expect(result).toBeUndefined();
    expect(BatchPromptDatabase.mockDocs).toHaveLength(0);
  });

  test('triggerBatchRequest removes prompts when conversation missing', async () => {
    BatchPromptDatabase.find.mockResolvedValue([
      {
        custom_id: 'custom-1',
        conversation_id: 'conv-1',
        prompt: 'Hello',
        model: 'gpt-4.1-2025-04-14',
        images: []
      }
    ]);
    conversationService.generateMessageArrayForConversation.mockResolvedValueOnce(null);

    const result = await service.triggerBatchRequest();

    expect(BatchPromptDatabase.deleteOne).toHaveBeenCalledWith({ custom_id: 'custom-1' });
    expect(result).toEqual({ ids: [], requests: [] });
  });
});
