const mockGet = jest.fn();
const mockPost = jest.fn();
const mockGetToolDefinitions = jest.fn();
const mockGetTool = jest.fn();
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
  getTool: mockGetTool,
  executeToolCall: mockExecuteToolCall,
})));

const { chat, convertResponseBody } = require('../../utils/Ollama_API');

describe('Ollama_API tool manager integration', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockGetToolDefinitions.mockReset();
    mockGetTool.mockReset();
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
    mockGetTool.mockResolvedValue({
      name: 'demo_tool',
      displayName: 'Demo Tool',
      description: 'Looks up a demo value.',
    });
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
    expect(mockPost.mock.calls[0][1].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('Use tools when needed. These are the tools available to you:\n- Demo Tool: Looks up a demo value.'),
      }),
    ]));
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
    expect(response.tool_steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool',
        name: 'demo_tool',
        tool_call_id: 'call_1',
        call_id: 'call_1',
      }),
    ]));
  });

  test('converts Ollama tool steps into persistable function call messages', async () => {
    const converted = await convertResponseBody({
      message: {
        role: 'assistant',
        content: 'Final answer',
      },
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Final answer',
          },
        },
      ],
      tool_steps: [
        {
          round: 1,
          type: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'demo_tool',
                arguments: { prompt: 'hello' },
              },
            },
          ],
        },
        {
          round: 1,
          type: 'tool',
          name: 'demo_tool',
          tool_call_id: 'call_1',
          call_id: 'call_1',
          arguments: { prompt: 'hello' },
          content: '{"answer":"tool result"}',
          error: null,
          execution: {
            ok: true,
            tool: 'demo_tool',
          },
        },
      ],
    });

    expect(converted.map((message) => message.contentType)).toEqual([
      'function_call',
      'function_call_output',
      'text',
    ]);
    expect(converted[0]).toMatchObject({
      hideFromBot: true,
      content: {
        toolCallId: 'call_1',
        callId: 'call_1',
        toolName: 'demo_tool',
        arguments: '{"prompt":"hello"}',
      },
    });
    expect(converted[1]).toMatchObject({
      hideFromBot: true,
      content: {
        toolCallId: 'call_1',
        callId: 'call_1',
        toolName: 'demo_tool',
        toolOutput: '{"answer":"tool result"}',
        output: '{"answer":"tool result"}',
        status: 'completed',
      },
    });
    expect(converted[2]).toMatchObject({
      hideFromBot: false,
      content: {
        text: 'Final answer',
      },
    });
  });
});
