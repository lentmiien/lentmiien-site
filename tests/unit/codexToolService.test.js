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

const mockGetAppSettingValue = jest.fn();

jest.mock('../../services/appSettingsService', () => ({
  APP_SETTING_KEYS: {
    CODEX_LOCAL_MODELS: 'codex.local_models',
  },
  appSettingsService: {
    getValue: mockGetAppSettingValue,
  },
}));

const CodexEvent = require('../../models/codex_event');
const CodexWorkspaceLock = require('../../models/codex_workspace_lock');
const codexToolService = require('../../services/codexToolService');

beforeEach(() => {
  mockGetAppSettingValue.mockReset();
  mockGetAppSettingValue.mockResolvedValue('qwen3.6:27b');
});

describe('codexToolService runtime config', () => {
  const originalMaxEventsPerTurn = process.env.CODEX_MAX_EVENTS_PER_TURN;
  const originalLocalModels = process.env.CODEX_LOCAL_MODELS;
  const originalOllamaProfile = process.env.CODEX_OLLAMA_PROFILE;

  afterEach(() => {
    if (originalMaxEventsPerTurn === undefined) {
      delete process.env.CODEX_MAX_EVENTS_PER_TURN;
    } else {
      process.env.CODEX_MAX_EVENTS_PER_TURN = originalMaxEventsPerTurn;
    }
    if (originalLocalModels === undefined) {
      delete process.env.CODEX_LOCAL_MODELS;
    } else {
      process.env.CODEX_LOCAL_MODELS = originalLocalModels;
    }
    if (originalOllamaProfile === undefined) {
      delete process.env.CODEX_OLLAMA_PROFILE;
    } else {
      process.env.CODEX_OLLAMA_PROFILE = originalOllamaProfile;
    }
  });

  test('persists up to 2000 turn events by default', () => {
    delete process.env.CODEX_MAX_EVENTS_PER_TURN;

    expect(codexToolService.getRuntimeConfig().maxEventsPerTurn).toBe(2000);
  });

  test('allows the event persistence limit to be overridden', () => {
    process.env.CODEX_MAX_EVENTS_PER_TURN = '2500';

    expect(codexToolService.getRuntimeConfig().maxEventsPerTurn).toBe(2500);
  });

  test('loads comma-separated Ollama models from app settings and ignores the legacy environment value', async () => {
    process.env.CODEX_LOCAL_MODELS = 'legacy-model:latest';
    mockGetAppSettingValue.mockResolvedValue(
      'llama4:scout, qwen3.6:27b, qwen3.6:14b, llama4:scout'
    );

    const config = await codexToolService.publicConfig();

    expect(mockGetAppSettingValue).toHaveBeenCalledWith('codex.local_models');
    expect(config.localModelOptions).toEqual([
      expect.objectContaining({ value: 'llama4:scout', label: 'llama4:scout' }),
      expect.objectContaining({ value: 'qwen3.6:27b', label: 'Qwen 3.6 27B' }),
      expect.objectContaining({ value: 'qwen3.6:14b', label: 'qwen3.6:14b' }),
    ]);
  });

  test('reads the Ollama model setting again for each public config request', async () => {
    mockGetAppSettingValue
      .mockResolvedValueOnce('qwen3.6:27b')
      .mockResolvedValueOnce('llama4:scout');

    const firstConfig = await codexToolService.publicConfig();
    const secondConfig = await codexToolService.publicConfig();

    expect(firstConfig.localModelOptions.map((option) => option.value)).toEqual(['qwen3.6:27b']);
    expect(secondConfig.localModelOptions.map((option) => option.value)).toEqual(['llama4:scout']);
    expect(mockGetAppSettingValue).toHaveBeenCalledTimes(2);
  });

  test('rejects an app setting that contains no model names', async () => {
    mockGetAppSettingValue.mockResolvedValue(' , , ');

    await expect(codexToolService.publicConfig()).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringContaining('codex.local_models'),
    });
  });

  test('uses the ollama Codex profile by default and allows an override', () => {
    delete process.env.CODEX_OLLAMA_PROFILE;
    expect(codexToolService.getRuntimeConfig().ollamaProfile).toBe('ollama');

    process.env.CODEX_OLLAMA_PROFILE = 'local-qwen';
    expect(codexToolService.getRuntimeConfig().ollamaProfile).toBe('local-qwen');
  });
});

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

  test('normalizes reasoning tokens reported by Codex turn completion events', () => {
    const rawUsage = {
      input_tokens: 1154244,
      cached_input_tokens: 1056000,
      cache_write_input_tokens: 0,
      output_tokens: 16956,
      reasoning_output_tokens: 7093,
    };

    const usage = codexToolService.normalizeTokenUsage(rawUsage);
    const cost = codexToolService.estimateTokenCost(rawUsage, {
      currency: 'USD',
      unitTokens: 1000000,
      prices: {
        input: 2,
        cached: 0.5,
        output: 8,
        reasoning: 8,
      },
    });

    expect(usage).toEqual({
      input: 1154244,
      cached: 1056000,
      output: 16956,
      reasoning: 7093,
      total: 1171200,
    });
    expect(cost.billableTokens).toEqual({
      input: 98244,
      cached: 1056000,
      output: 9863,
      reasoning: 7093,
    });
    expect(cost.breakdown.output + cost.breakdown.reasoning)
      .toBeCloseTo((16956 * 8) / 1000000, 8);
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

  test('keeps OpenAI and Ollama costs in separate provider totals', () => {
    const stats = codexToolService.buildSessionStats([
      {
        _id: 'openai-turn',
        sessionId: 'openai-session',
        modelProvider: 'openai',
        sequence: 1,
        kind: 'question',
        status: 'succeeded',
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      },
      {
        _id: 'ollama-turn',
        sessionId: 'ollama-session',
        modelProvider: 'ollama',
        model: 'qwen3.6:27b',
        sequence: 1,
        kind: 'question',
        status: 'succeeded',
        usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 },
      },
    ], {
      openai: {
        provider: 'openai',
        currency: 'USD',
        unitTokens: 1000,
        prices: { input: 1, cached: 1, output: 1, reasoning: 1 },
      },
      ollama: {
        provider: 'ollama',
        currency: 'USD',
        unitTokens: 1000,
        prices: { input: 2, cached: 2, output: 2, reasoning: 2 },
      },
    });

    expect(stats.cost).toBeCloseTo(0.15, 8);
    expect(stats.ollamaCost).toBeCloseTo(0.4, 8);
    expect(stats.combinedCost).toBeCloseTo(0.55, 8);
    expect(stats.providerUsage.openai.tokens.total).toBe(150);
    expect(stats.providerUsage.ollama.tokens.total).toBe(200);
  });

  test('serializes an Ollama turn using only the Ollama price table', () => {
    const serialized = codexToolService.serializeTurn({
      _id: 'ollama-turn',
      sessionId: 'ollama-session',
      workspaceId: 'workspace-1',
      targetId: 'target-1',
      modelProvider: 'ollama',
      model: 'qwen3.6:27b',
      sequence: 1,
      kind: 'question',
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    }, {
      pricingByProvider: {
        openai: {
          provider: 'openai',
          unitTokens: 1000,
          prices: { input: 100, cached: 100, output: 100, reasoning: 100 },
        },
        ollama: {
          provider: 'ollama',
          unitTokens: 1000,
          prices: { input: 2, cached: 2, output: 2, reasoning: 2 },
        },
      },
    });

    expect(serialized.modelProvider).toBe('ollama');
    expect(serialized.costEstimate.provider).toBe('ollama');
    expect(serialized.costEstimate.total).toBeCloseTo(0.3, 8);
  });
});

describe('codexToolService local model request options', () => {
  test('resolves an Ollama request without an OpenAI profile or reasoning override', async () => {
    await expect(codexToolService.resolveTurnRequestOptions({
      modelProvider: 'ollama',
      model: 'qwen3.6:27b',
      requestProfileId: 'default',
      reasoningEffort: 'high',
    })).resolves.toEqual({
      requestProfileId: '',
      requestProfileName: '',
      modelProvider: 'ollama',
      model: 'qwen3.6:27b',
      profile: '',
      reasoningEffort: '',
    });
  });

  test('rejects switching an existing Ollama session back to OpenAI', async () => {
    await expect(codexToolService.resolveTurnRequestOptions({
      modelProvider: 'openai',
    }, {}, {
      requiredModelProvider: 'ollama',
      defaultModel: 'qwen3.6:27b',
    })).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('cannot switch'),
    });
  });

  test('validates an Ollama submission against the latest app setting value', async () => {
    mockGetAppSettingValue.mockResolvedValue('llama4:scout');

    await expect(codexToolService.resolveTurnRequestOptions({
      modelProvider: 'ollama',
      model: 'qwen3.6:27b',
    })).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('not configured'),
    });
  });
});
