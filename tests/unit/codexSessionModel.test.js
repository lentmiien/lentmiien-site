const CodexSession = require('../../models/codex_session');
const CodexTurn = require('../../models/codex_turn');

describe('CodexSession model', () => {
  test('stores the provider and model used to resume a Codex session', () => {
    expect(CodexSession.schema.path('modelProvider').options).toEqual(expect.objectContaining({
      enum: ['openai', 'ollama', 'runpod-qwen', 'runpod-glm'],
      default: 'openai',
    }));
    expect(CodexSession.schema.path('model').options.maxlength).toBe(120);
    expect(CodexTurn.schema.path('modelProvider').options.enum).toEqual([
      'openai',
      'ollama',
      'runpod-qwen',
      'runpod-glm',
    ]);
  });

  test('only enforces unique Codex thread ids for stored string values', () => {
    const indexes = CodexSession.schema.indexes();
    const threadIndex = indexes.find(([keys]) => keys.codexThreadId === 1);

    expect(threadIndex).toBeTruthy();
    expect(threadIndex[1]).toEqual(expect.objectContaining({
      unique: true,
      name: 'codexThreadId_1',
      partialFilterExpression: {
        codexThreadId: { $type: 'string' },
      },
    }));
    expect(CodexSession.schema.path('codexThreadId').options.unique).toBeUndefined();
    expect(CodexSession.schema.path('codexThreadId').options.sparse).toBeUndefined();
    expect(CodexSession.schema.options.autoIndex).toBe(false);
  });
});
