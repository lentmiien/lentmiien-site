const mockGet = jest.fn();
const mockPost = jest.fn();
const mockGetToolDefinitions = jest.fn();
const mockExecuteToolCall = jest.fn();

jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: mockGet,
    post: mockPost,
  })),
}));

jest.mock('../../utils/logger', () => ({
  notice: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../utils/apiDebugLogger', () => ({
  createApiDebugLogger: jest.fn(() => jest.fn().mockResolvedValue()),
}));

jest.mock('../../services/toolManagerService', () => jest.fn().mockImplementation(() => ({
  getToolDefinitions: mockGetToolDefinitions,
  executeToolCall: mockExecuteToolCall,
})));

const { chat } = require('../../utils/Ollama_API');

describe('Ollama_API tool manager integration', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockGetToolDefinitions.mockReset();
    mockExecuteToolCall.mockReset();
  });

  test('uses selected tool manager tools, ignores OpenAI built-ins, and completes the follow-up turn', async () => {
    mockGet.mockResolvedValue({
      data: {
        models: [{ id: 'llama3.2' }],
      },
      headers: {},
    });
    mockGetToolDefinitions.mockResolvedValue([
      {
        type: 'function',
        function: {
          name: 'demo_tool',
          description: 'Demo tool',
          parameters: {
            type: 'object',
            properties: {
              prompt: { type: 'string' },
            },
            required: ['prompt'],
          },
        },
      },
    ]);
    mockExecuteToolCall.mockResolvedValue({
      ok: true,
      tool: 'demo_tool',
      result: { answer: 'tool result' },
    });
    mockPost
      .mockResolvedValueOnce({
        data: {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'demo_tool',
                  arguments: '{"prompt":"hello"}',
                },
              },
            ],
          },
        },
        headers: {},
      })
      .mockResolvedValueOnce({
        data: {
          message: {
            role: 'assistant',
            content: 'The tool returned: tool result',
          },
        },
        headers: {},
      });

    const response = await chat(
      {
        members: ['Lennart'],
        metadata: {
          tools: ['image_generation', 'demo_tool', 'web_search_preview'],
          maxMessages: 10,
        },
      },
      [
        {
          user_id: 'Lennart',
          contentType: 'text',
          content: { text: 'Use the demo tool.' },
          hideFromBot: false,
        },
      ],
      {
        provider: 'Local',
        api_model: 'llama3.2',
        in_modalities: ['text'],
        context_type: 'system',
      },
    );

    expect(mockGetToolDefinitions).toHaveBeenCalledWith(['demo_tool'], {
      format: 'chat_completions',
      includeDisabled: false,
      strict: false,
    });
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockPost.mock.calls[0][1]).toMatchObject({
      model: 'llama3.2',
      stream: false,
      tools: [
        {
          type: 'function',
          function: expect.objectContaining({ name: 'demo_tool' }),
        },
      ],
    });
    expect(mockPost.mock.calls[0][1].tools).toHaveLength(1);
    expect(mockExecuteToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'call_1',
        function: expect.objectContaining({
          name: 'demo_tool',
          arguments: { prompt: 'hello' },
        }),
      }),
      expect.objectContaining({
        userName: 'Lennart',
        createdBy: 'Ollama',
      })
    );
    expect(mockPost.mock.calls[1][1].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'tool',
        tool_name: 'demo_tool',
        tool_call_id: 'call_1',
        content: '{"answer":"tool result"}',
      }),
    ]));
    expect(response.choices[0].message.content).toBe('The tool returned: tool result');
    expect(response.rounds).toBe(2);
  });
});
