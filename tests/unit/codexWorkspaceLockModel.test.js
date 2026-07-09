const CodexWorkspaceLock = require('../../models/codex_workspace_lock');

describe('CodexWorkspaceLock model', () => {
  test('enforces one active lock per workspace without globally locking a worker', () => {
    const indexes = CodexWorkspaceLock.schema.indexes();
    const workspaceIndex = indexes.find(([keys]) => keys.workspaceId === 1);
    const workerIndex = indexes.find(([keys]) => keys.workerId === 1);
    const turnIndex = indexes.find(([keys]) => keys.turnId === 1);
    const ttlIndex = indexes.find(([keys]) => keys.expiresAt === 1);

    expect(workspaceIndex[1]).toEqual(expect.objectContaining({
      unique: true,
      name: 'workspaceId_1',
    }));
    expect(workerIndex[1]).toEqual(expect.objectContaining({ name: 'workerId_1' }));
    expect(turnIndex[1]).toEqual(expect.objectContaining({ name: 'turnId_1' }));
    expect(ttlIndex[1]).toEqual(expect.objectContaining({
      expireAfterSeconds: 0,
      name: 'expiresAt_1',
    }));
    expect(workerIndex[1].unique).toBeUndefined();
    expect(CodexWorkspaceLock.schema.path('workerId').options.unique).toBeUndefined();
    expect(CodexWorkspaceLock.schema.options.autoIndex).toBe(false);
  });
});
