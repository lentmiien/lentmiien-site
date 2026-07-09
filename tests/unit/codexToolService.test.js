jest.mock('../../models/codex_event', () => ({
  find: jest.fn(),
}));

jest.mock('../../models/codex_workspace_lock', () => ({
  deleteMany: jest.fn(),
  collection: {
    indexes: jest.fn(),
    dropIndex: jest.fn(),
    createIndex: jest.fn(),
  },
}));

const CodexEvent = require('../../models/codex_event');
const CodexWorkspaceLock = require('../../models/codex_workspace_lock');
const codexToolService = require('../../services/codexToolService');

function createEventQuery(events) {
  const query = {
    sort: jest.fn(() => query),
    limit: jest.fn(() => query),
    lean: jest.fn(() => query),
    exec: jest.fn().mockResolvedValue(events),
  };
  return query;
}

describe('codexToolService.listTurnEvents', () => {
  beforeEach(() => {
    CodexEvent.find.mockReset();
  });

  test('returns all events when no limit is requested', async () => {
    const query = createEventQuery([
      { _id: 'event-1', turnId: 'turn-1', seq: 1, eventType: 'turn.started' },
      { _id: 'event-2', turnId: 'turn-1', seq: 2, eventType: 'turn.completed' },
    ]);
    CodexEvent.find.mockReturnValue(query);

    const events = await codexToolService.listTurnEvents('turn-1');

    expect(CodexEvent.find).toHaveBeenCalledWith({
      turnId: 'turn-1',
      seq: { $gt: 0 },
    });
    expect(query.sort).toHaveBeenCalledWith({ seq: 1 });
    expect(query.limit).not.toHaveBeenCalled();
    expect(events).toHaveLength(2);
  });

  test('honors explicit limits for callers that request one', async () => {
    const query = createEventQuery([]);
    CodexEvent.find.mockReturnValue(query);

    await codexToolService.listTurnEvents('turn-1', { afterSeq: 5, limit: 25 });

    expect(CodexEvent.find).toHaveBeenCalledWith({
      turnId: 'turn-1',
      seq: { $gt: 5 },
    });
    expect(query.limit).toHaveBeenCalledWith(25);
  });
});

describe('codexToolService lock index maintenance', () => {
  beforeEach(() => {
    CodexWorkspaceLock.deleteMany.mockReset();
    CodexWorkspaceLock.collection.indexes.mockReset();
    CodexWorkspaceLock.collection.dropIndex.mockReset();
    CodexWorkspaceLock.collection.createIndex.mockReset();

    CodexWorkspaceLock.deleteMany.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    });
    CodexWorkspaceLock.collection.dropIndex.mockResolvedValue({});
    CodexWorkspaceLock.collection.createIndex.mockResolvedValue('index-name');
  });

  test('repairs stale unique lock indexes that would serialize one worker globally', async () => {
    CodexWorkspaceLock.collection.indexes.mockResolvedValue([
      { name: '_id_', key: { _id: 1 }, unique: true },
      { name: 'workerId_1', key: { workerId: 1 }, unique: true },
      { name: 'workspaceId_custom', key: { workspaceId: 1 }, unique: true },
      { name: 'expiresAt_custom', key: { expiresAt: 1 }, expireAfterSeconds: 60 },
    ]);

    await codexToolService.ensureCodexWorkspaceLockIndexes();

    expect(CodexWorkspaceLock.collection.dropIndex).toHaveBeenCalledWith('workerId_1');
    expect(CodexWorkspaceLock.collection.dropIndex).toHaveBeenCalledWith('workspaceId_custom');
    expect(CodexWorkspaceLock.collection.dropIndex).toHaveBeenCalledWith('expiresAt_custom');
    expect(CodexWorkspaceLock.collection.createIndex).toHaveBeenCalledWith(
      { workspaceId: 1 },
      { unique: true, name: 'workspaceId_1' }
    );
    expect(CodexWorkspaceLock.collection.createIndex).toHaveBeenCalledWith(
      { workerId: 1 },
      { name: 'workerId_1' }
    );
    expect(CodexWorkspaceLock.collection.createIndex).toHaveBeenCalledWith(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'expiresAt_1' }
    );
  });

  test('classifies only workspace duplicate lock errors as queue conflicts', () => {
    expect(codexToolService.isWorkspaceLockConflictError({
      code: 11000,
      keyPattern: { workspaceId: 1 },
    })).toBe(true);

    expect(codexToolService.isWorkspaceLockConflictError({
      code: 11000,
      keyPattern: { workerId: 1 },
    })).toBe(false);
  });
});

describe('codexToolService token usage helpers', () => {
  test('normalizes OpenAI-style token details into separated buckets', () => {
    const usage = codexToolService.normalizeTokenUsage({
      input_tokens: 1200,
      input_tokens_details: { cached_tokens: 800 },
      output_tokens: 300,
      output_tokens_details: { reasoning_tokens: 75 },
      total_tokens: 1500,
    });

    expect(usage).toEqual({
      input: 1200,
      cached: 800,
      output: 300,
      reasoning: 75,
      total: 1500,
    });
  });

  test('estimates costs without double-counting cached or reasoning tokens', () => {
    const cost = codexToolService.estimateTokenCost(
      {
        input: 1200,
        cached: 800,
        output: 300,
        reasoning: 75,
      },
      {
        currency: 'USD',
        unitTokens: 1000000,
        prices: {
          input: 2,
          cached: 0.5,
          output: 8,
          reasoning: 8,
        },
      }
    );

    expect(cost.billableTokens).toEqual({
      input: 400,
      cached: 800,
      output: 225,
      reasoning: 75,
    });
    expect(cost.total).toBeCloseTo(0.0036, 8);
  });

  test('derives per-turn token usage from cumulative resumed Codex usage', () => {
    const turns = codexToolService.annotateTurnsWithTokenUsage([
      {
        _id: 'turn-1',
        sessionId: 'session-1',
        sequence: 1,
        kind: 'action',
        usage: {
          input_tokens: 100,
          input_tokens_details: { cached_tokens: 20 },
          output_tokens: 40,
          output_tokens_details: { reasoning_tokens: 10 },
          total_tokens: 140,
        },
      },
      {
        _id: 'turn-2',
        sessionId: 'session-1',
        sequence: 2,
        kind: 'followup_action',
        usage: {
          input_tokens: 260,
          input_tokens_details: { cached_tokens: 70 },
          output_tokens: 90,
          output_tokens_details: { reasoning_tokens: 25 },
          total_tokens: 350,
        },
      },
      {
        _id: 'turn-3',
        sessionId: 'session-1',
        sequence: 3,
        kind: 'followup_question',
        usage: {
          input_tokens: 390,
          input_tokens_details: { cached_tokens: 120 },
          output_tokens: 130,
          output_tokens_details: { reasoning_tokens: 40 },
          total_tokens: 520,
        },
      },
    ]);

    expect(turns[0].tokenUsage).toEqual({
      input: 100,
      cached: 20,
      output: 40,
      reasoning: 10,
      total: 140,
    });
    expect(turns[1].tokenUsage).toEqual({
      input: 160,
      cached: 50,
      output: 50,
      reasoning: 15,
      total: 210,
    });
    expect(turns[2].tokenUsage).toEqual({
      input: 130,
      cached: 50,
      output: 40,
      reasoning: 15,
      total: 170,
    });
    expect(turns[1].sessionTokenUsage).toEqual({
      input: 260,
      cached: 70,
      output: 90,
      reasoning: 25,
      total: 350,
    });
  });

  test('keeps non-resumed retry usage independent', () => {
    const turns = codexToolService.annotateTurnsWithTokenUsage([
      {
        _id: 'turn-1',
        sessionId: 'session-1',
        sequence: 1,
        kind: 'question',
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      },
      {
        _id: 'turn-2',
        sessionId: 'session-1',
        sequence: 2,
        kind: 'question',
        commandSummary: { resume: false },
        usage: { input_tokens: 80, output_tokens: 20, total_tokens: 100 },
      },
    ]);

    expect(turns[1].tokenUsage).toEqual({
      input: 80,
      cached: 0,
      output: 20,
      reasoning: 0,
      total: 100,
    });
  });

  test('builds session totals from turn deltas instead of summing cumulative usage', () => {
    const stats = codexToolService.buildSessionStats([
      {
        _id: 'turn-1',
        sessionId: 'session-1',
        sequence: 1,
        kind: 'action',
        status: 'succeeded',
        usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 },
      },
      {
        _id: 'turn-2',
        sessionId: 'session-1',
        sequence: 2,
        kind: 'followup_action',
        status: 'succeeded',
        usage: { input_tokens: 260, output_tokens: 90, total_tokens: 350 },
      },
      {
        _id: 'turn-3',
        sessionId: 'session-1',
        sequence: 3,
        kind: 'followup_question',
        status: 'succeeded',
        usage: { input_tokens: 390, output_tokens: 130, total_tokens: 520 },
      },
    ], {
      currency: 'USD',
      unitTokens: 1000,
      prices: {
        input: 1,
        cached: 1,
        output: 1,
        reasoning: 1,
      },
    });

    expect(stats.tokens).toEqual({
      input: 390,
      cached: 0,
      output: 130,
      reasoning: 0,
      total: 520,
    });
    expect(stats.cost).toBeCloseTo(0.52, 8);
    expect(stats.averageTokensPerTurn).toBeCloseTo(520 / 3, 8);
  });

  test('serializes corrected turn cost while retaining cumulative session usage', () => {
    const [, turn] = codexToolService.annotateTurnsWithTokenUsage([
      {
        _id: 'turn-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        targetId: 'target-1',
        sequence: 1,
        kind: 'action',
        usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 },
      },
      {
        _id: 'turn-2',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        targetId: 'target-1',
        sequence: 2,
        kind: 'followup_action',
        usage: { input_tokens: 260, output_tokens: 90, total_tokens: 350 },
      },
    ]);

    const serialized = codexToolService.serializeTurn(turn, {
      pricing: {
        currency: 'USD',
        unitTokens: 1000,
        prices: {
          input: 1,
          cached: 1,
          output: 1,
          reasoning: 1,
        },
      },
    });

    expect(serialized.tokenUsage.total).toBe(210);
    expect(serialized.sessionTokenUsage.total).toBe(350);
    expect(serialized.costEstimate.total).toBeCloseTo(0.21, 8);
  });
});
