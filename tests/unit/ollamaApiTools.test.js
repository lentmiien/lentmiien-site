const mockGet = jest.fn();
const mockPost = jest.fn();
const mockGetToolDefinitions = jest.fn();
const mockGetTool = jest.fn();
const mockExecuteToolCall = jest.fn();
const mockRecordApiDebugLog = jest.fn().mockResolvedValue();

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
  createApiDebugLogger: jest.fn(() => mockRecordApiDebugLog),
}));

jest.mock('../../services/toolManagerService', () => jest.fn().mockImplementation(() => ({
  getToolDefinitions: mockGetToolDefinitions,
  getTool: mockGetTool,
  executeToolCall: mockExecuteToolCall,
})));

const {
  chat,
  submitChatJob,
  retrieveChatJob,
  buildWebhookUrl,
  verifyWebhookToken,
  convertResponseBody,
} = require('../../utils/Ollama_API');

describe('Ollama_API tool manager integration', () => {
  beforeEach(() => {
    process.env.OLLAMA_WEBHOOK_SECRET = 'test-ollama-webhook-secret-with-enough-entropy';
    process.env.OLLAMA_WEBHOOK_BASE_URL = 'https://my.lentmiien.com/';
    mockGet.mockReset();
    mockPost.mockReset();
    mockGetToolDefinitions.mockReset();
    mockGetTool.mockReset();
    mockExecuteToolCall.mockReset();
    mockRecordApiDebugLog.mockClear();
  });

  afterAll(() => {
    delete process.env.OLLAMA_WEBHOOK_SECRET;
    delete process.env.OLLAMA_WEBHOOK_BASE_URL;
  });

  test('submits a background job with the production webhook base and a derived token', async () => {
    mockGet.mockResolvedValue({
      data: { models: [{ id: 'background-model' }] },
      headers: {},
    });
    mockPost.mockResolvedValue({
      status: 202,
      data: {
        job_id: '02d58123-b2da-4412-8df5-1fbb47bb07cd',
        status: 'queued',
        status_url: '/llm/chat/jobs/02d58123-b2da-4412-8df5-1fbb47bb07cd',
      },
      headers: {},
    });

    const job = await submitChatJob(
      {
        _id: { toString: () => 'conv-background' },
        metadata: { tools: [], maxMessages: 10 },
      },
      [{
        user_id: 'Lennart',
        contentType: 'text',
        content: { text: 'Run this in the background.' },
        hideFromBot: false,
      }],
      {
        provider: 'Local',
        api_model: 'background-model',
        in_modalities: ['text'],
      },
    );

    expect(job).toMatchObject({
      job_id: '02d58123-b2da-4412-8df5-1fbb47bb07cd',
      status: 'queued',
    });
    expect(mockPost).toHaveBeenCalledWith(
      '/llm/chat/jobs',
      expect.objectContaining({
        model: 'background-model',
        stream: false,
        webhook_url: expect.stringMatching(/^https:\/\/my\.lentmiien\.com\/webhook\/ollama\?token=[0-9a-f]{64}$/),
      }),
      expect.objectContaining({ timeout: 30000 }),
    );
    const submittedPayload = mockPost.mock.calls[0][1];
    const token = new URL(submittedPayload.webhook_url).searchParams.get('token');
    expect(token).not.toContain(process.env.OLLAMA_WEBHOOK_SECRET);
    expect(verifyWebhookToken(token)).toBe(true);
    expect(buildWebhookUrl()).toBe(submittedPayload.webhook_url);

    const submissionLog = mockRecordApiDebugLog.mock.calls
      .map(([entry]) => entry)
      .find((entry) => entry.functionName === 'submitChatJob');
    expect(submissionLog.requestBody.webhook_url).not.toContain(token);
    expect(submissionLog.requestBody.webhook_url).toContain('redacted');
  });

  test('rejects an insecure public webhook base URL', () => {
    process.env.OLLAMA_WEBHOOK_BASE_URL = 'http://example.test/';
    expect(() => buildWebhookUrl()).toThrow('must use https unless it targets loopback');
  });

  test('retrieves a background job only from its canonical gateway path', async () => {
    mockGet.mockResolvedValue({
      data: {
        job_id: '12d58123-b2da-4412-8df5-1fbb47bb07cd',
        status: 'completed',
        status_url: 'https://attacker.invalid/result',
        result: { message: { role: 'assistant', content: 'Done.' } },
      },
      headers: {},
    });

    const job = await retrieveChatJob('12d58123-b2da-4412-8df5-1fbb47bb07cd');

    expect(mockGet).toHaveBeenCalledWith(
      '/llm/chat/jobs/12d58123-b2da-4412-8df5-1fbb47bb07cd',
      { timeout: 30000 },
    );
    expect(job.status_url).toBe('/llm/chat/jobs/12d58123-b2da-4412-8df5-1fbb47bb07cd');
    await expect(retrieveChatJob('../gpu/reservation')).rejects.toThrow('valid Ollama job ID');
  });

  test('replays the latest persisted tool result in a background follow-up job', async () => {
    mockGet.mockResolvedValue({
      data: { models: [{ id: 'background-tool-model' }] },
      headers: {},
    });
    mockGetToolDefinitions.mockResolvedValue([{
      type: 'function',
      function: {
        name: 'demo_tool',
        description: 'Demo tool',
        parameters: { type: 'object', properties: {} },
      },
    }]);
    mockGetTool.mockResolvedValue({ name: 'demo_tool', displayName: 'Demo Tool' });
    mockPost.mockResolvedValue({
      status: 202,
      data: {
        job_id: '52d58123-b2da-4412-8df5-1fbb47bb07cd',
        status: 'queued',
        status_url: '/llm/chat/jobs/52d58123-b2da-4412-8df5-1fbb47bb07cd',
      },
      headers: {},
    });

    await submitChatJob(
      { metadata: { tools: ['demo_tool'], maxMessages: 10 } },
      [
        {
          _id: 'user-tool',
          user_id: 'Lennart',
          contentType: 'text',
          content: { text: 'Use the tool.' },
          hideFromBot: false,
        },
        {
          _id: 'function-tool',
          user_id: 'bot',
          contentType: 'function_call',
          content: {
            toolCallId: 'call_replay',
            callId: 'call_replay',
            toolName: 'demo_tool',
            arguments: '{"prompt":"hello"}',
          },
          hideFromBot: true,
        },
        {
          _id: 'output-tool',
          user_id: 'bot',
          contentType: 'function_call_output',
          content: {
            toolCallId: 'call_replay',
            callId: 'call_replay',
            toolName: 'demo_tool',
            output: { answer: 42 },
          },
          hideFromBot: true,
        },
      ],
      {
        provider: 'Local',
        api_model: 'background-tool-model',
        in_modalities: ['text'],
      },
      { includeLastToolBatch: true },
    );

    const payload = mockPost.mock.calls[0][1];
    expect(payload.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        tool_calls: [expect.objectContaining({ id: 'call_replay' })],
      }),
      expect.objectContaining({
        role: 'tool',
        tool_call_id: 'call_replay',
        content: '{"answer":42}',
      }),
    ]));
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

  test('converts a single background-job tool request without exposing it as final text', async () => {
    const converted = await convertResponseBody({
      message: {
        role: 'assistant',
        content: 'demo_tool(prompt="hello")',
        tool_calls: [{
          id: 'call_background_1',
          type: 'function',
          function: {
            name: 'demo_tool',
            arguments: { prompt: 'hello' },
          },
        }],
      },
    }, {
      allowTextToolFallback: true,
      allowedToolNames: ['demo_tool'],
    });

    expect(converted).toHaveLength(1);
    expect(converted[0]).toMatchObject({
      contentType: 'function_call',
      hideFromBot: true,
      content: {
        toolCallId: 'call_background_1',
        toolName: 'demo_tool',
        arguments: '{"prompt":"hello"}',
      },
    });
  });

  test('converts Ollama thinking into a hidden reasoning message before text', async () => {
    const converted = await convertResponseBody({
      model: 'supergemma4:26b-uncensored',
      created_at: '2026-05-14T10:06:32.076439223Z',
      message: {
        role: 'assistant',
        content: 'Final answer',
        thinking: 'Draft the answer first.',
      },
      done: true,
    });

    expect(converted.map((message) => message.contentType)).toEqual([
      'reasoning',
      'text',
    ]);
    expect(converted[0]).toMatchObject({
      hideFromBot: true,
      content: {
        text: 'Draft the answer first.',
        summary: [{ type: 'summary_text', text: 'Draft the answer first.' }],
        raw: {
          type: 'reasoning',
          source: 'ollama_thinking',
          thinking: 'Draft the answer first.',
          model: 'supergemma4:26b-uncensored',
          created_at: '2026-05-14T10:06:32.076439223Z',
          role: 'assistant',
        },
        status: 'completed',
        error: null,
      },
    });
    expect(converted[1]).toMatchObject({
      hideFromBot: false,
      content: {
        text: 'Final answer',
      },
    });
  });

  test('orders Ollama tool thinking before tool calls and final text', async () => {
    const converted = await convertResponseBody({
      message: {
        role: 'assistant',
        content: 'Final answer',
        thinking: 'Summarize the tool result.',
      },
      tool_steps: [
        {
          round: 1,
          type: 'assistant',
          content: '',
          thinking: 'I should call the demo tool.',
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
        },
        {
          round: 2,
          type: 'assistant',
          content: 'Final answer',
          thinking: 'Summarize the tool result.',
          tool_calls: [],
        },
      ],
    });

    expect(converted.map((message) => message.contentType)).toEqual([
      'reasoning',
      'function_call',
      'function_call_output',
      'reasoning',
      'text',
    ]);
    expect(converted[0]).toMatchObject({
      content: {
        text: 'I should call the demo tool.',
        outputIndex: 0,
        raw: {
          round: 1,
        },
      },
    });
    expect(converted[3]).toMatchObject({
      content: {
        text: 'Summarize the tool result.',
        outputIndex: 2,
        raw: {
          round: 2,
        },
      },
    });
    expect(converted[4]).toMatchObject({
      hideFromBot: false,
      content: {
        text: 'Final answer',
      },
    });
  });
});
