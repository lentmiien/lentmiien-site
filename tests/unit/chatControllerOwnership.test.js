const mockChatGPT = jest.fn();
const mockOpenAIAPICallLog = jest.fn();
const mockFind = jest.fn();
const mockInsertMany = jest.fn();

jest.mock('../../utils/ChatGPT', () => ({
  OpenAIAPICallLog: mockOpenAIAPICallLog,
  chatGPT: mockChatGPT,
}));
jest.mock('../../utils/utils', () => ({
  insertCharAt: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  notice: jest.fn(),
}));
jest.mock('../../utils/chat5Markdown', () => ({
  renderMarkdownSafe: jest.fn(value => value),
}));
jest.mock('../../database', () => ({
  ChatModel: {
    collection: { insertMany: mockInsertMany },
    find: mockFind,
  },
}));

const chatController = require('../../controllers/chatcontroller');

describe('Chat1 thread ownership', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockChatGPT.mockResolvedValue({
      choices: [{ message: { content: 'assistant reply' } }],
      usage: {
        completion_tokens: 3,
        prompt_tokens: 7,
        total_tokens: 10,
      },
    });
    mockOpenAIAPICallLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createResponse() {
    const response = {
      redirect: jest.fn(),
      send: jest.fn(),
      status: jest.fn(),
    };
    response.status.mockReturnValue(response);
    return response;
  }

  function createRequest(id) {
    return {
      body: {
        id: String(id),
        message: 'new question',
        system: 'system prompt',
        title: 'Thread title',
      },
      user: { name: 'alice' },
    };
  }

  test('rejects a non-owned nonzero thread without calling OpenAI or writing messages', async () => {
    mockFind.mockResolvedValue([
      {
        content: 'private message from bob',
        created: new Date('2026-08-27T00:00:00.000Z'),
        role: 'user',
        threadid: 7,
        username: 'bob',
      },
    ]);
    const response = createResponse();

    await chatController.post(createRequest(7), response);

    expect(mockFind).toHaveBeenCalledWith({ username: 'alice' });
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.send).toHaveBeenCalledWith('Chat not found.');
    expect(mockChatGPT).not.toHaveBeenCalled();
    expect(mockOpenAIAPICallLog).not.toHaveBeenCalled();
    expect(mockInsertMany).not.toHaveBeenCalled();
    expect(response.redirect).not.toHaveBeenCalled();
  });

  test('continues an owned thread without including a colliding foreign thread', async () => {
    mockFind.mockResolvedValue([
      {
        content: 'owned context',
        created: new Date('2026-08-27T00:00:00.000Z'),
        role: 'system',
        threadid: 7,
        username: 'alice',
      },
      {
        content: 'private message from bob',
        created: new Date('2026-08-27T00:01:00.000Z'),
        role: 'user',
        threadid: 7,
        username: 'bob',
      },
    ]);
    const response = createResponse();

    await chatController.post(createRequest(7), response);
    jest.runOnlyPendingTimers();

    expect(mockChatGPT).toHaveBeenCalledWith([
      { role: 'system', content: 'owned context' },
      { role: 'user', content: 'new question' },
    ], 'gpt-3.5-turbo');
    expect(mockInsertMany).toHaveBeenCalledWith([
      expect.objectContaining({ username: 'alice', role: 'user', threadid: 7 }),
      expect.objectContaining({ username: 'alice', role: 'assistant', threadid: 7 }),
    ]);
    expect(response.redirect).toHaveBeenCalledWith('/chat?id=7');
  });

  test('creates id zero as the next owned thread and saves the system prompt', async () => {
    mockFind.mockResolvedValue([
      { threadid: 4, username: 'alice' },
      { threadid: 99, username: 'bob' },
    ]);
    const response = createResponse();

    await chatController.post(createRequest(0), response);
    jest.runOnlyPendingTimers();

    expect(mockChatGPT).toHaveBeenCalledWith([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'new question' },
    ], 'gpt-3.5-turbo');
    expect(mockInsertMany).toHaveBeenCalledWith([
      expect.objectContaining({ username: 'alice', role: 'system', threadid: 5 }),
      expect.objectContaining({ username: 'alice', role: 'user', threadid: 5 }),
      expect.objectContaining({ username: 'alice', role: 'assistant', threadid: 5 }),
    ]);
    expect(response.redirect).toHaveBeenCalledWith('/chat?id=5');
  });
});
