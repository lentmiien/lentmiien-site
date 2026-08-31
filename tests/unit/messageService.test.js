const mockRenderMarkdownSafe = jest.fn((text) => `parsed:${text}`);

jest.mock('sharp', () =>
  jest.fn(() => ({
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    png: jest.fn().mockReturnThis(),
    webp: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('')),
    toFile: jest.fn().mockResolvedValue(),
    composite: jest.fn().mockReturnThis()
  }))
);

jest.mock('../../utils/ChatGPT', () => ({
  chatGPT: jest.fn(),
  chatGPTaudio: jest.fn(),
  chatGPT_beta: jest.fn(),
  chatGPT_o1: jest.fn(),
  chatGPT_Tool: jest.fn(),
  tts: jest.fn(),
  ig: jest.fn(),
  ig2: jest.fn(),
  imageEdit: jest.fn()
}));

jest.mock('../../utils/anthropic', () => ({ anthropic: jest.fn() }));
jest.mock('../../utils/groq', () => ({ groq: jest.fn(), groq_vision: jest.fn() }));
jest.mock('../../utils/google', () => ({ googleAI: jest.fn() }));
jest.mock('../../utils/lmstudio', () => ({ chat: jest.fn() }));
jest.mock('../../utils/OpenAI_API', () => ({
  chat: jest.fn(),
  fetchCompleted: jest.fn(),
  retrieveResponse: jest.fn(),
  convertResponseBody: jest.fn(),
}));
jest.mock('../../utils/Ollama_API', () => ({
  chat: jest.fn(),
  submitChatJob: jest.fn(),
  retrieveChatJob: jest.fn(),
  convertResponseBody: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  notice: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

jest.mock('../../database', () => {
  const AIModelCards = { find: jest.fn() };
  const Conversation5Model = { findById: jest.fn() };
  let nextMessageId = 1;
  const Chat5Model = jest.fn(function (doc = {}) {
    Object.assign(this, doc);
    this._id = doc._id || { toString: () => `chat5-${nextMessageId++}` };
    this.save = jest.fn().mockResolvedValue(this);
  });
  Chat5Model.find = jest.fn();
  Chat5Model.findOne = jest.fn();
  Chat5Model.findById = jest.fn();
  Chat5Model.deleteMany = jest.fn();
  return { AIModelCards, Chat5Model, Conversation5Model };
});

jest.mock('../../utils/chat5Markdown', () => ({ renderMarkdownSafe: mockRenderMarkdownSafe }));

const MessageService = require('../../services/messageService');
const { APP_SETTING_KEYS } = require('../../services/appSettingsService');
const { chatGPT, chatGPT_beta } = require('../../utils/ChatGPT');
const ai = require('../../utils/OpenAI_API');
const ollama = require('../../utils/Ollama_API');
const { AIModelCards, Chat5Model, Conversation5Model } = require('../../database');

const createMessageDoc = (id, overrides = {}) => ({
  _id: { toString: () => id },
  prompt: `prompt-${id}`,
  response: `response-${id}`,
  images: [],
  save: jest.fn().mockResolvedValue(),
  ...overrides
});

const createQueryChain = (result) => {
  const exec = jest.fn().mockResolvedValue(result);
  const sort = jest.fn().mockReturnValue({ exec });
  return { sort, exec };
};

describe('MessageService', () => {
  let messageModel;
  let fileMetaModel;
  let service;

  beforeEach(() => {
    mockRenderMarkdownSafe.mockClear();
    mockRenderMarkdownSafe.mockImplementation((text) => `parsed:${text}`);
    AIModelCards.find.mockReset();
    Chat5Model.mockClear();
    Chat5Model.find.mockReset();
    Chat5Model.findOne.mockReset();
    Chat5Model.findOne.mockResolvedValue(null);
    Chat5Model.findById.mockReset();
    Chat5Model.deleteMany.mockReset();
    Conversation5Model.findById.mockReset();
    ollama.chat.mockReset();
    ollama.submitChatJob.mockReset();
    ollama.retrieveChatJob.mockReset();
    ollama.convertResponseBody.mockReset();
    ai.fetchCompleted.mockReset();
    ai.chat.mockReset();
    ai.retrieveResponse.mockReset();
    ai.convertResponseBody.mockReset();
    chatGPT.mockReset();
    chatGPT_beta.mockReset();

    messageModel = {
      find: jest.fn(),
      findOne: jest.fn()
    };

    fileMetaModel = {};
    service = new MessageService(messageModel, fileMetaModel);
  });

  test('getMessageById retrieves single message', async () => {
    const doc = { _id: 'message-id' };
    messageModel.findOne.mockResolvedValue(doc);

    const result = await service.getMessageById('message-id');

    expect(messageModel.findOne).toHaveBeenCalledWith({ _id: 'message-id' });
    expect(result).toBe(doc);
  });

  test('getMessagesByIdArray sorts by provided ids and populates html', async () => {
    const msg1 = createMessageDoc('id1');
    const msg2 = createMessageDoc('id2');
    messageModel.find.mockResolvedValue([msg1, msg2]);

    const result = await service.getMessagesByIdArray(['id1', 'id2']);

    expect(messageModel.find).toHaveBeenCalledWith({ _id: ['id1', 'id2'] });
    expect(result.map((m) => m._id.toString())).toEqual(['id2', 'id1']);
    expect(mockRenderMarkdownSafe).toHaveBeenCalledTimes(4);
    expect(result[0].prompt_html).toBe('parsed:prompt-id2');
    expect(result[0].response_html).toBe('parsed:response-id2');
  });

  test('getMessagesByIdArray updates image flags when val_lookup provided', async () => {
    const message = createMessageDoc('id1', {
      images: [
        { filename: 'img-a', use_flag: 'low quality' },
        { filename: 'img-b', use_flag: 'high quality' }
      ]
    });
    const saveSpy = message.save;
    messageModel.find.mockResolvedValue([message]);

    const result = await service.getMessagesByIdArray(
      ['id1'],
      false,
      { 'img-a': '2', 'img-b': '2' }
    );

    expect(mockRenderMarkdownSafe).not.toHaveBeenCalled();
    expect(result[0].images[0].use_flag).toBe('high quality');
    expect(result[0].images[1].use_flag).toBe('high quality');
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  test('queues chat text embedding work without calling the foreground embedding API', async () => {
    const queue = {
      enqueue: jest.fn().mockResolvedValue({ status: 'pending' }),
      enqueueDelete: jest.fn(),
    };
    const directEmbeddingApi = {
      embed: jest.fn(),
      deleteEmbeddings: jest.fn(),
    };
    service.embeddingQueueService = queue;
    service.embeddingApiService = directEmbeddingApi;

    await service.syncTextEmbedding({
      message: {
        _id: { toString: () => 'chat-message-1' },
        contentType: 'text',
        content: { text: 'Queue this text' },
      },
      conversationId: 'conversation-1',
    });

    expect(queue.enqueue).toHaveBeenCalledWith(
      ['Queue this text'],
      {},
      [{
        collectionName: 'chat_message',
        documentId: 'chat-message-1',
        contentType: 'chat_message_text',
        parentCollection: 'conversation',
        parentId: 'conversation-1',
      }],
      { mode: 'default' },
    );
    expect(directEmbeddingApi.embed).not.toHaveBeenCalled();
  });

  test('queues a delete intent when chat text is cleared', async () => {
    const queue = {
      enqueue: jest.fn(),
      enqueueDelete: jest.fn().mockResolvedValue({ status: 'pending' }),
    };
    service.embeddingQueueService = queue;

    await service.syncTextEmbedding({
      message: {
        _id: { toString: () => 'chat-message-2' },
        contentType: 'text',
        content: { text: '   ' },
      },
      conversationId: 'conversation-2',
    });

    expect(queue.enqueueDelete).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'chat-message-2', parentId: 'conversation-2' }),
      { mode: 'default' },
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  test('does not queue an embedding for an explicitly excluded response placeholder', async () => {
    const queue = {
      enqueue: jest.fn(),
      enqueueDelete: jest.fn(),
    };
    service.embeddingQueueService = queue;

    await service.syncTextEmbedding({
      message: {
        _id: { toString: () => 'response-placeholder' },
        contentType: 'text',
        content: { text: 'Pending response' },
        embeddingRequested: false,
        embeddingStatus: 'disabled',
      },
      conversationId: 'conversation-placeholder',
    });

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(queue.enqueueDelete).not.toHaveBeenCalled();
  });

  test('disabling an embedded chat message removes default and high-quality vectors', async () => {
    const queue = {
      enqueue: jest.fn(),
      enqueueDelete: jest.fn().mockResolvedValue({ status: 'pending' }),
    };
    service.embeddingQueueService = queue;

    await service.syncTextEmbedding({
      message: {
        _id: { toString: () => 'disabled-embedded-message' },
        contentType: 'text',
        content: { text: 'Previously embedded text' },
        embeddingRequested: false,
        embeddingStatus: 'delete_pending',
      },
      conversationId: 'conversation-disabled-embedding',
    });

    const metadata = {
      collectionName: 'chat_message',
      documentId: 'disabled-embedded-message',
      contentType: 'chat_message_text',
      parentCollection: 'conversation',
      parentId: 'conversation-disabled-embedding',
    };
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(queue.enqueueDelete).toHaveBeenNthCalledWith(1, metadata, { mode: 'default' });
    expect(queue.enqueueDelete).toHaveBeenNthCalledWith(2, metadata, { mode: 'high_quality' });
  });

  test('queues manual high-quality chat embedding without using the foreground API', async () => {
    const queue = {
      enqueue: jest.fn().mockResolvedValue({ status: 'pending' }),
      enqueueDelete: jest.fn(),
    };
    const directEmbeddingApi = { embedHighQuality: jest.fn() };
    const message = {
      _id: { toString: () => 'chat-message-hq' },
      contentType: 'text',
      content: { text: 'High quality text' },
    };
    Conversation5Model.findById.mockResolvedValue({
      messages: [{ toString: () => 'chat-message-hq' }],
    });
    Chat5Model.findById.mockResolvedValue(message);
    service.embeddingQueueService = queue;
    service.embeddingApiService = directEmbeddingApi;

    await expect(service.embedMessageHighQuality({
      conversationId: 'conversation-hq',
      messageId: 'chat-message-hq',
    })).resolves.toEqual({ ok: true, queued: true });

    expect(queue.enqueue).toHaveBeenCalledWith(
      ['High quality text'],
      { task: 'document' },
      [expect.objectContaining({
        documentId: 'chat-message-hq',
        parentId: 'conversation-hq',
      })],
      { mode: 'high_quality', force: true },
    );
    expect(directEmbeddingApi.embedHighQuality).not.toHaveBeenCalled();
  });

  test('durably queues both embedding deletions before removing chat messages', async () => {
    const queue = {
      enqueueDelete: jest.fn().mockResolvedValue({ status: 'pending' }),
    };
    service.embeddingQueueService = queue;
    Chat5Model.deleteMany.mockResolvedValue({ deletedCount: 1 });

    await expect(service.deleteMessages(['chat-message-delete'], {
      conversationId: 'conversation-delete',
    })).resolves.toBe(1);

    const metadata = {
      collectionName: 'chat_message',
      documentId: 'chat-message-delete',
      contentType: 'chat_message_text',
      parentCollection: 'conversation',
      parentId: 'conversation-delete',
    };
    expect(queue.enqueueDelete).toHaveBeenNthCalledWith(
      1,
      metadata,
      { mode: 'default', force: true, verifySourceState: false },
    );
    expect(queue.enqueueDelete).toHaveBeenNthCalledWith(
      2,
      metadata,
      { mode: 'high_quality', force: true, verifySourceState: false },
    );
    expect(queue.enqueueDelete.mock.invocationCallOrder[1])
      .toBeLessThan(Chat5Model.deleteMany.mock.invocationCallOrder[0]);
  });

  test('deletes vectors using an active queued source when the conversation reference is gone', async () => {
    const storedSource = {
      collectionName: 'chat_message',
      documentId: 'unreferenced-chat-message',
      contentType: 'chat_message_text',
      parentCollection: 'conversation',
      parentId: 'conversation-from-queue',
    };
    const queue = {
      findStoredChatSource: jest.fn().mockResolvedValue(storedSource),
      enqueueDelete: jest.fn().mockResolvedValue({ status: 'pending' }),
    };
    service.embeddingQueueService = queue;
    Chat5Model.deleteMany.mockResolvedValue({ deletedCount: 1 });

    await expect(service.deleteMessages(['unreferenced-chat-message'])).resolves.toBe(1);

    expect(queue.findStoredChatSource).toHaveBeenCalledWith('unreferenced-chat-message');
    expect(queue.enqueueDelete).toHaveBeenNthCalledWith(1, storedSource, {
      mode: 'default',
      force: true,
      verifySourceState: false,
    });
    expect(queue.enqueueDelete).toHaveBeenNthCalledWith(2, storedSource, {
      mode: 'high_quality',
      force: true,
      verifySourceState: false,
    });
    expect(queue.enqueueDelete.mock.invocationCallOrder[1])
      .toBeLessThan(Chat5Model.deleteMany.mock.invocationCallOrder[0]);
  });

  test('getMessagesByUserId returns newest first and populates html', async () => {
    const docs = [
      { prompt: 'p1', response: 'r1' },
      { prompt: 'p2', response: 'r2' }
    ];
    const chain = createQueryChain(docs);
    messageModel.find.mockReturnValue({ sort: chain.sort });

    const result = await service.getMessagesByUserId('user-7');

    expect(messageModel.find).toHaveBeenCalledWith({ user_id: 'user-7' });
    expect(chain.sort).toHaveBeenCalledWith({ timestamp: -1 });
    expect(chain.exec).toHaveBeenCalledTimes(1);
    expect(mockRenderMarkdownSafe).toHaveBeenCalledTimes(4);
    expect(result[0].prompt_html).toBe('parsed:p1');
    expect(result[1].response_html).toBe('parsed:r2');
  });

  test('processFailedResponse returns retrieved failure details without iterating converted outputs', async () => {
    ai.retrieveResponse.mockResolvedValue({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    });

    const result = await service.processFailedResponse({}, 'resp-old');

    expect(ai.retrieveResponse).toHaveBeenCalledWith('resp-old');
    expect(result).toBe('Incomplete: max_output_tokens');
  });

  test('processFailedResponse reuses failure details already retrieved by recovery', async () => {
    const retrievedResponse = {
      status: 'failed',
      error: { message: 'Provider rejected the response' },
    };

    const result = await service.processFailedResponse({}, 'resp-failed', retrievedResponse);

    expect(ai.retrieveResponse).not.toHaveBeenCalled();
    expect(result).toBe('Provider rejected the response');
  });

  test('processCompletedResponse converts an already retrieved response without fetching it again', async () => {
    const retrievedResponse = {
      status: 'completed',
      output: [],
      output_text: 'Recovered response',
    };
    ai.convertResponseBody.mockResolvedValue([{ error: null }]);

    await service.processCompletedResponse({}, 'resp-recovered', retrievedResponse);

    expect(ai.convertResponseBody).toHaveBeenCalledWith(retrievedResponse);
    expect(ai.fetchCompleted).not.toHaveBeenCalled();
  });

  test('generateAIMessage submits an Ollama job and immediately saves a hidden placeholder', async () => {
    AIModelCards.find.mockResolvedValue([
      {
        provider: 'Local',
        api_model: 'llama3.2',
        context_type: 'system',
        in_modalities: ['text'],
      },
    ]);
    Chat5Model.find.mockResolvedValue([
      {
        _id: { toString: () => 'user-msg' },
        user_id: 'Lennart',
        contentType: 'text',
        content: { text: 'Use the tool' },
        hideFromBot: false,
      },
    ]);
    ollama.submitChatJob.mockResolvedValue({
      job_id: '02d58123-b2da-4412-8df5-1fbb47bb07cd',
      status: 'queued',
    });

    const conversation = {
      _id: { toString: () => 'conv-1' },
      category: 'chat',
      tags: ['demo'],
      members: ['Lennart'],
      metadata: {
        model: 'llama3.2',
        maxMessages: 10,
      },
      messages: ['user-msg'],
    };
    const result = await service.generateAIMessage({ conversation });

    expect(ollama.submitChatJob).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: expect.anything(),
        metadata: expect.objectContaining({ model: 'llama3.2' }),
      }),
      expect.any(Array),
      expect.objectContaining({ api_model: 'llama3.2' }),
      { includeLastToolBatch: false },
    );
    expect(ollama.chat).not.toHaveBeenCalled();
    expect(ollama.convertResponseBody).not.toHaveBeenCalled();
    expect(Chat5Model).toHaveBeenCalledWith(expect.objectContaining({
      contentType: 'text',
      hideFromBot: true,
      embeddingRequested: false,
      content: expect.objectContaining({ text: 'Pending response' }),
    }));
    expect(result).toMatchObject({
      response_id: '02d58123-b2da-4412-8df5-1fbb47bb07cd',
      response_provider: 'Ollama',
      msg: expect.objectContaining({ hideFromBot: true }),
    });
  });

  test('generateAIMessage saves an explicitly non-embeddable OpenAI placeholder', async () => {
    AIModelCards.find.mockResolvedValue([{
      provider: 'OpenAI',
      api_model: 'gpt-test',
      context_type: 'system',
      in_modalities: ['text'],
    }]);
    Chat5Model.find.mockResolvedValue([]);
    ai.chat.mockResolvedValue('resp-openai');
    const conversation = {
      _id: { toString: () => 'conv-openai' },
      category: 'chat',
      tags: ['demo'],
      members: ['Lennart'],
      metadata: { model: 'gpt-test', maxMessages: 10 },
      messages: [],
    };

    const result = await service.generateAIMessage({ conversation });

    expect(ai.chat).toHaveBeenCalled();
    expect(Chat5Model).toHaveBeenCalledWith(expect.objectContaining({
      contentType: 'text',
      hideFromBot: true,
      embeddingRequested: false,
      content: expect.objectContaining({ text: 'Pending response' }),
    }));
    expect(result).toMatchObject({
      response_id: 'resp-openai',
      msg: expect.objectContaining({ embeddingRequested: false }),
    });
  });

  test('processCompletedResponse saves all converted Ollama function messages', async () => {
    const job = {
      job_id: '02d58123-b2da-4412-8df5-1fbb47bb07cd',
      status: 'completed',
      result: {
        message: { role: 'assistant', content: '', tool_calls: [] },
      },
    };
    ollama.convertResponseBody.mockResolvedValue([
      {
        contentType: 'function_call',
        content: {
          toolCallId: 'call_1',
          callId: 'call_1',
          toolName: 'demo_tool',
          arguments: '{"prompt":"hello"}',
        },
        hideFromBot: true,
      },
      {
        contentType: 'function_call_output',
        content: {
          toolCallId: 'call_1',
          callId: 'call_1',
          toolName: 'demo_tool',
          toolOutput: '{"answer":"tool result"}',
          output: '{"answer":"tool result"}',
        },
        hideFromBot: true,
      },
      {
        contentType: 'text',
        content: {
          text: 'Final answer',
        },
        hideFromBot: false,
      },
    ]);

    service.syncTextEmbedding = jest.fn().mockResolvedValue();
    const conversation = {
      _id: { toString: () => 'conv-1' },
      category: 'chat',
      tags: ['demo'],
      metadata: {
        tools: ['demo_tool', 'web_search_preview'],
      },
    };
    const result = await service.processCompletedResponse(
      conversation,
      job.job_id,
      job,
      'Ollama',
    );

    expect(ollama.convertResponseBody).toHaveBeenCalledWith(job.result, {
      allowTextToolFallback: true,
      allowedToolNames: ['demo_tool'],
    });
    expect(ollama.retrieveChatJob).not.toHaveBeenCalled();
    expect(Chat5Model).toHaveBeenCalledWith(expect.objectContaining({
      contentType: 'function_call',
      hideFromBot: true,
      content: expect.objectContaining({
        responseId: job.job_id,
        outputIndex: 0,
      }),
    }));
    expect(Chat5Model).toHaveBeenCalledWith(expect.objectContaining({
      contentType: 'function_call_output',
      hideFromBot: true,
    }));
    expect(result.map((message) => message.contentType)).toEqual([
      'function_call',
      'function_call_output',
      'text',
    ]);
  });

  test('processCompletedResponse reuses outputs persisted by an earlier callback attempt', async () => {
    const job = {
      job_id: '62d58123-b2da-4412-8df5-1fbb47bb07cd',
      status: 'completed',
      result: { message: { role: 'assistant', content: 'Already saved' } },
    };
    const existing = {
      _id: { toString: () => 'existing-local-output' },
      contentType: 'text',
      content: {
        text: 'Already saved',
        responseId: job.job_id,
        outputIndex: 0,
      },
    };
    ollama.convertResponseBody.mockResolvedValue([{
      contentType: 'text',
      content: { text: 'Already saved' },
      hideFromBot: false,
    }]);
    Chat5Model.findOne.mockResolvedValue(existing);

    const result = await service.processCompletedResponse(
      { category: 'chat', tags: ['demo'], metadata: { tools: [] } },
      job.job_id,
      job,
      'Ollama',
    );

    expect(Chat5Model.findOne).toHaveBeenCalledWith({
      'content.responseId': job.job_id,
      'content.outputIndex': 0,
    });
    expect(Chat5Model).not.toHaveBeenCalled();
    expect(result).toEqual([existing]);
  });

  test('processCompletedResponse saves converted Ollama thinking before content', async () => {
    const job = {
      job_id: '12d58123-b2da-4412-8df5-1fbb47bb07cd',
      status: 'completed',
      result: {
        message: {
          role: 'assistant',
          content: 'Final answer',
          thinking: 'Plan the answer.',
        },
      },
    };
    ollama.convertResponseBody.mockResolvedValue([
      {
        contentType: 'reasoning',
        content: {
          text: 'Plan the answer.',
          summary: [{ type: 'summary_text', text: 'Plan the answer.' }],
        },
        hideFromBot: true,
      },
      {
        contentType: 'text',
        content: {
          text: 'Final answer',
        },
        hideFromBot: false,
      },
    ]);

    service.syncTextEmbedding = jest.fn().mockResolvedValue();
    const result = await service.processCompletedResponse(
      {
        _id: { toString: () => 'conv-1' },
        category: 'chat',
        tags: ['demo'],
        metadata: { tools: [] },
      },
      job.job_id,
      job,
      'Ollama',
    );

    expect(Chat5Model).toHaveBeenNthCalledWith(1, expect.objectContaining({
      contentType: 'reasoning',
      hideFromBot: true,
      content: expect.objectContaining({
        text: 'Plan the answer.',
        summary: [{ type: 'summary_text', text: 'Plan the answer.' }],
      }),
    }));
    expect(Chat5Model).toHaveBeenNthCalledWith(2, expect.objectContaining({
      contentType: 'text',
      hideFromBot: false,
      content: expect.objectContaining({
        text: 'Final answer',
      }),
    }));
    expect(result.map((message) => message.contentType)).toEqual([
      'reasoning',
      'text',
    ]);
  });

  test('getMessagesByCategoryUserId filters by category without html parsing', async () => {
    const docs = [{ prompt: 'p', response: 'r' }];
    const chain = createQueryChain(docs);
    messageModel.find.mockReturnValue({ sort: chain.sort });
    mockRenderMarkdownSafe.mockClear();

    const result = await service.getMessagesByCategoryUserId('updates', 'user-8');

    expect(messageModel.find).toHaveBeenCalledWith({ user_id: 'user-8', category: 'updates' });
    expect(chain.sort).toHaveBeenCalledWith({ timestamp: -1 });
    expect(chain.exec).toHaveBeenCalledTimes(1);
    expect(mockRenderMarkdownSafe).not.toHaveBeenCalled();
    expect(result).toBe(docs);
  });

  test('GenerateTitle gets the title model from app settings', async () => {
    const appSettingsService = {
      getValue: jest.fn().mockResolvedValue('title-model-from-db'),
    };
    service = new MessageService(messageModel, fileMetaModel, null, appSettingsService);
    service.loadMessagesInNewFormat = jest.fn().mockResolvedValue([
      {
        user_id: 'Lennart',
        contentType: 'text',
        content: { text: 'How should we name this?' },
      },
      {
        user_id: 'bot',
        contentType: 'text',
        content: { text: 'A concise title would work.' },
      },
    ]);
    chatGPT_beta.mockResolvedValue({
      output_parsed: { conversation_title: 'Database-backed Titles' },
    });

    await expect(service.GenerateTitle(['message-1', 'message-2']))
      .resolves.toBe('Database-backed Titles');
    expect(appSettingsService.getValue).toHaveBeenCalledWith(APP_SETTING_KEYS.CHAT5_TITLE_MODEL);
    expect(chatGPT_beta).toHaveBeenCalledWith(
      expect.any(Array),
      'title-model-from-db',
      true,
      expect.objectContaining({ title: 'title' })
    );
  });

  test('GenerateTitle surfaces model failures instead of saving an error as the title', async () => {
    const appSettingsService = {
      getValue: jest.fn().mockResolvedValue('invalid-title-model'),
    };
    service = new MessageService(messageModel, fileMetaModel, null, appSettingsService);
    service.loadMessagesInNewFormat = jest.fn().mockResolvedValue([]);
    chatGPT_beta.mockRejectedValue(new Error('model not found'));

    await expect(service.GenerateTitle([])).rejects.toThrow('Failed to generate conversation title');
  });

  test('generateChat5Summary gets a separate summary model from app settings', async () => {
    const appSettingsService = {
      getValue: jest.fn().mockResolvedValue('summary-model-from-db'),
    };
    service = new MessageService(messageModel, fileMetaModel, null, appSettingsService);
    chatGPT.mockResolvedValue({
      choices: [{ message: { content: 'A stored summary.' } }],
    });

    const summary = await service.generateChat5Summary({
      conversation: {},
      messages: [
        {
          user_id: 'Lennart',
          contentType: 'text',
          content: { text: 'Remember this.' },
          hideFromBot: false,
        },
        {
          user_id: 'bot',
          contentType: 'text',
          content: { text: 'I will.' },
          hideFromBot: false,
        },
      ],
    });

    expect(summary).toBe('A stored summary.');
    expect(appSettingsService.getValue).toHaveBeenCalledWith(APP_SETTING_KEYS.CHAT5_SUMMARY_MODEL);
    expect(chatGPT).toHaveBeenCalledWith(expect.any(Array), 'summary-model-from-db');
  });
});
