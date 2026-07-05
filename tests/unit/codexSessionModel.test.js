const CodexSession = require('../../models/codex_session');

describe('CodexSession model', () => {
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
