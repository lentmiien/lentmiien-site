const mockMarkedParse = jest.fn((text) => `parsed:${text}`);

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
jest.mock('../../utils/OpenAI_API', () => ({ fetchCompleted: jest.fn(), retrieveResponse: jest.fn() }));
jest.mock('../../utils/Ollama_API', () => ({
  chat: jest.fn(),
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
  let nextMessageId = 1;
  const Chat5Model = jest.fn(function (doc = {}) {
    Object.assign(this, doc);
    this._id = doc._id || { toString: () => `chat5-${nextMessageId++}` };
    this.save = jest.fn().mockResolvedValue(this);
  });
  Chat5Model.find = jest.fn();
  Chat5Model.findById = jest.fn();
  return { AIModelCards, Chat5Model };
});

jest.mock('marked', () => ({ parse: mockMarkedParse }));

const MessageService = require('../../services/messageService');
const ai = require('../../utils/OpenAI_API');
const ollama = require('../../utils/Ollama_API');
const { AIModelCards, Chat5Model } = require('../../database');

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
    mockMarkedParse.mockClear();
    mockMarkedParse.mockImplementation((text) => `parsed:${text}`);
    AIModelCards.find.mockReset();
    Chat5Model.find.mockReset();
    ollama.chat.mockReset();
    ollama.convertResponseBody.mockReset();

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
    expect(mockMarkedParse).toHaveBeenCalledTimes(4);
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

    expect(mockMarkedParse).not.toHaveBeenCalled();
    expect(result[0].images[0].use_flag).toBe('high quality');
    expect(result[0].images[1].use_flag).toBe('high quality');
    expect(saveSpy).toHaveBeenCalledTimes(1);
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
    expect(mockMarkedParse).toHaveBeenCalledTimes(4);
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

  test('generateAIMessage saves all converted Ollama function messages', async () => {
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
    ollama.chat.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'Final answer' } }],
    });
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
    const result = await service.generateAIMessage({
      conversation: {
        _id: { toString: () => 'conv-1' },
        category: 'chat',
        tags: ['demo'],
        members: ['Lennart'],
        metadata: {
          model: 'llama3.2',
          maxMessages: 10,
        },
        messages: ['user-msg'],
      },
    });

    expect(ollama.chat).toHaveBeenCalled();
    expect(ollama.convertResponseBody).toHaveBeenCalled();
    expect(Chat5Model).toHaveBeenCalledWith(expect.objectContaining({
      contentType: 'function_call',
      hideFromBot: true,
    }));
    expect(Chat5Model).toHaveBeenCalledWith(expect.objectContaining({
      contentType: 'function_call_output',
      hideFromBot: true,
    }));
    expect(result.response_id).toBeNull();
    expect(result.messages.map((message) => message.contentType)).toEqual([
      'function_call',
      'function_call_output',
      'text',
    ]);
    expect(result.msg.content.text).toBe('Final answer');
  });

  test('getMessagesByCategoryUserId filters by category without html parsing', async () => {
    const docs = [{ prompt: 'p', response: 'r' }];
    const chain = createQueryChain(docs);
    messageModel.find.mockReturnValue({ sort: chain.sort });
    mockMarkedParse.mockClear();

    const result = await service.getMessagesByCategoryUserId('updates', 'user-8');

    expect(messageModel.find).toHaveBeenCalledWith({ user_id: 'user-8', category: 'updates' });
    expect(chain.sort).toHaveBeenCalledWith({ timestamp: -1 });
    expect(chain.exec).toHaveBeenCalledTimes(1);
    expect(mockMarkedParse).not.toHaveBeenCalled();
    expect(result).toBe(docs);
  });
});
