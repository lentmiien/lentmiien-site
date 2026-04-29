const ToolManagerService = require('../../services/toolManagerService');

function findOneChain(result) {
  return {
    lean: () => ({
      exec: async () => result,
    }),
  };
}

describe('ToolManagerService', () => {
  test('formats stored Responses tool JSON for Chat Completions', () => {
    const definition = ToolManagerService.formatToolDefinition({
      name: 'demo_tool',
      description: 'Demo',
      toolDefinition: {
        type: 'function',
        name: 'demo_tool',
        description: 'Run the demo tool.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
          },
          required: ['prompt'],
        },
        strict: false,
      },
    }, 'chat_completions');

    expect(definition).toEqual({
      type: 'function',
      function: {
        name: 'demo_tool',
        description: 'Run the demo tool.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
          },
          required: ['prompt'],
        },
        strict: false,
      },
    });
  });

  test('executes a Chat Completions style tool call through the registered handler', async () => {
    const tool = {
      name: 'demo_tool',
      enabled: true,
      handlerKey: 'demo.execute',
      toolDefinition: {
        type: 'function',
        name: 'demo_tool',
        parameters: { type: 'object', properties: {} },
      },
    };
    const execute = jest.fn(async (args, context) => ({
      args,
      userName: context.userName,
    }));
    const service = new ToolManagerService({
      toolModel: {
        findOne: jest.fn(() => findOneChain(tool)),
      },
      handlers: {
        'demo.execute': { execute },
      },
      seeds: [],
    });

    const result = await service.executeToolCall({
      id: 'call_123',
      function: {
        name: 'demo_tool',
        arguments: '{"prompt":"hello"}',
      },
    }, { userName: 'Lennart' });

    expect(execute).toHaveBeenCalledWith(
      { prompt: 'hello' },
      expect.objectContaining({
        userName: 'Lennart',
        toolName: 'demo_tool',
        toolCallId: 'call_123',
      })
    );
    expect(result).toMatchObject({
      ok: true,
      tool: 'demo_tool',
      toolCallId: 'call_123',
      result: {
        args: { prompt: 'hello' },
        userName: 'Lennart',
      },
    });
  });

  test('formats a tool result as an OpenAI Responses function_call_output', () => {
    const service = new ToolManagerService({
      toolModel: {},
      handlers: {},
      seeds: [],
    });

    expect(service.formatToolResultForOpenAI({
      type: 'function_call',
      call_id: 'call_456',
      name: 'demo_tool',
      arguments: '{}',
    }, { ok: true })).toEqual({
      type: 'function_call_output',
      call_id: 'call_456',
      output: '{"ok":true}',
    });
  });
});
