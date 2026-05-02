process.env.OPENAI_API_KEY_PRIVATE = 'test-key';

jest.mock('sharp', () =>
  jest.fn(() => ({
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('jpg')),
  }))
);

jest.mock('../../utils/logger', () => ({
  notice: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../utils/apiDebugLogger', () => ({
  createApiDebugLogger: jest.fn(() => jest.fn().mockResolvedValue()),
}));

const mockResponsesCreate = jest.fn();
const mockGetToolJson = jest.fn();

jest.mock('../../services/toolManagerService', () => jest.fn().mockImplementation(() => ({
  getToolJson: mockGetToolJson,
})));

jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    responses: { retrieve: jest.fn(), create: mockResponsesCreate },
    embeddings: { create: jest.fn() },
    files: {
      create: jest.fn(),
      content: jest.fn(),
      delete: jest.fn(),
    },
    batches: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
    videos: {
      create: jest.fn(),
      retrieve: jest.fn(),
      downloadContent: jest.fn(),
    },
  })),
  toFile: jest.fn(),
}));

const { convertResponseBody, chat } = require('../../utils/OpenAI_API');

describe('OpenAI_API response conversion', () => {
  beforeEach(() => {
    mockResponsesCreate.mockReset();
    mockGetToolJson.mockReset();
  });

  test('converts image items without result into a tool fallback instead of throwing', async () => {
    const converted = await convertResponseBody({
      id: 'resp-old',
      status: 'completed',
      output: [
        {
          id: 'out-1',
          type: 'image_generation_call',
          status: 'completed',
          revised_prompt: 'A castle on a hill',
        },
      ],
      error: null,
    });

    expect(converted).toEqual([
      {
        contentType: 'tool',
        content: expect.objectContaining({
          text: null,
          image: null,
          audio: null,
          tts: null,
          transcript: null,
          revisedPrompt: 'A castle on a hill',
          imageQuality: null,
          toolOutput: 'image_generation_call: status: completed, revised_prompt: A castle on a hill',
          outputId: 'out-1',
          responseId: 'resp-old',
          outputIndex: 0,
        }),
        hideFromBot: true,
      },
      { error: null },
    ]);
  });

  test('converts reasoning response items into replayable hidden messages', async () => {
    const converted = await convertResponseBody({
      id: 'resp-reasoning',
      status: 'completed',
      output: [
        {
          id: 'rs_123',
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'Planning the tool call' }],
        },
      ],
      error: null,
    });

    expect(converted).toEqual([
      {
        contentType: 'reasoning',
        content: expect.objectContaining({
          text: 'Planning the tool call',
          outputId: 'rs_123',
          responseId: 'resp-reasoning',
          outputIndex: 0,
          summary: [{ type: 'summary_text', text: 'Planning the tool call' }],
          raw: expect.objectContaining({ type: 'reasoning', id: 'rs_123' }),
        }),
        hideFromBot: true,
      },
      { error: null },
    ]);
  });

  test('converts function_call response items into persistable messages', async () => {
    const converted = await convertResponseBody({
      id: 'resp-tools',
      status: 'completed',
      output: [
        {
          id: 'fc_123',
          type: 'function_call',
          call_id: 'call_123',
          name: 'demo_tool',
          arguments: '{"prompt":"hello"}',
          status: 'completed',
        },
      ],
      error: null,
    });

    expect(converted).toEqual([
      {
        contentType: 'function_call',
        content: expect.objectContaining({
          toolCallId: 'fc_123',
          callId: 'call_123',
          toolName: 'demo_tool',
          arguments: '{"prompt":"hello"}',
          raw: expect.objectContaining({ type: 'function_call' }),
          status: 'completed',
        }),
        hideFromBot: true,
      },
      { error: null },
    ]);
  });

  test('chat resolves custom tools and only includes last tool batch when requested', async () => {
    mockGetToolJson.mockResolvedValue({
      type: 'function',
      name: 'demo_tool',
      description: 'Demo tool',
      parameters: { type: 'object', properties: {} },
    });
    mockResponsesCreate.mockResolvedValue({ id: 'resp-next' });

    const conversation = {
      metadata: {
        tools: ['web_search_preview', 'demo_tool'],
        maxMessages: 20,
        outputFormat: 'text',
      },
    };
    const model = {
      api_model: 'gpt-4.1',
      context_type: 'system',
      in_modalities: ['text'],
    };
    const messages = [
      {
        _id: 'user-1',
        user_id: 'Lennart',
        contentType: 'text',
        content: { text: 'Use the tool' },
        hideFromBot: false,
      },
      {
        _id: 'rs-1',
        user_id: 'bot',
        contentType: 'reasoning',
        content: {
          text: 'Need a tool',
          outputId: 'rs_123',
          responseId: 'resp-tools',
          summary: [{ type: 'summary_text', text: 'Need a tool' }],
        },
        hideFromBot: true,
      },
      {
        _id: 'fc-1',
        user_id: 'bot',
        contentType: 'function_call',
        content: {
          toolCallId: 'fc_123',
          callId: 'call_123',
          toolName: 'demo_tool',
          arguments: { prompt: 'hello' },
          responseId: 'resp-tools',
        },
        hideFromBot: true,
      },
      {
        _id: 'out-1',
        user_id: 'bot',
        contentType: 'function_call_output',
        content: {
          callId: 'call_123',
          output: { ok: true },
        },
        hideFromBot: true,
      },
    ];

    await chat(conversation, messages, model, { includeLastToolBatch: true });

    expect(mockGetToolJson).toHaveBeenCalledWith('demo_tool', {
      format: 'responses',
      includeDisabled: false,
    });
    expect(mockResponsesCreate).toHaveBeenCalledWith(expect.objectContaining({
      tools: [
        { type: 'web_search_preview' },
        {
          type: 'function',
          name: 'demo_tool',
          description: 'Demo tool',
          parameters: { type: 'object', properties: {} },
        },
      ],
      input: expect.arrayContaining([
        expect.objectContaining({ role: 'user' }),
        expect.objectContaining({ type: 'reasoning', id: 'rs_123' }),
        expect.objectContaining({ type: 'function_call', call_id: 'call_123', name: 'demo_tool' }),
        expect.objectContaining({ type: 'function_call_output', call_id: 'call_123', output: '{"ok":true}' }),
      ]),
    }));

    const input = mockResponsesCreate.mock.calls[0][0].input;
    const reasoningIndex = input.findIndex(item => item.type === 'reasoning');
    const functionCallIndex = input.findIndex(item => item.type === 'function_call');
    const functionOutputIndex = input.findIndex(item => item.type === 'function_call_output');
    expect(reasoningIndex).toBeGreaterThan(-1);
    expect(reasoningIndex).toBeLessThan(functionCallIndex);
    expect(functionCallIndex).toBeLessThan(functionOutputIndex);
  });
});
