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

jest.mock('../../models/runpod_pod', () => ({
  find: jest.fn(),
}));

jest.mock('../../models/role', () => ({
  findOne: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warning: jest.fn(),
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
const CodexTurn = require('../../models/codex_turn');
const CodexTurnMessage = require('../../models/codex_turn_message');
const CodexWorkspace = require('../../models/codex_workspace');
const CodexWorkspaceLock = require('../../models/codex_workspace_lock');
const RunpodPod = require('../../models/runpod_pod');
const Role = require('../../models/role');
const codexToolService = require('../../services/codexToolService');

function runpodPodQuery(pods) {
  return {
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(pods),
  };
}

beforeEach(() => {
  mockGetAppSettingValue.mockReset();
  mockGetAppSettingValue.mockResolvedValue('qwen3.6:27b');
  RunpodPod.find.mockReset();
  RunpodPod.find.mockReturnValue(runpodPodQuery([]));
  Role.findOne.mockReset();
  Role.findOne.mockResolvedValue(null);
});

describe('codexToolService runtime config', () => {
  const originalMaxEventsPerTurn = process.env.CODEX_MAX_EVENTS_PER_TURN;
  const originalCompletionExitGraceMs = process.env.CODEX_COMPLETION_EXIT_GRACE_MS;
  const originalLocalModels = process.env.CODEX_LOCAL_MODELS;
  const originalOllamaProfile = process.env.CODEX_OLLAMA_PROFILE;
  const originalRunpodProfileEnvFile = process.env.CODEX_RUNPOD_PROFILE_ENV_FILE;
  const originalRunpodProfileShell = process.env.CODEX_RUNPOD_PROFILE_SHELL;

  afterEach(() => {
    if (originalMaxEventsPerTurn === undefined) {
      delete process.env.CODEX_MAX_EVENTS_PER_TURN;
    } else {
      process.env.CODEX_MAX_EVENTS_PER_TURN = originalMaxEventsPerTurn;
    }
    if (originalCompletionExitGraceMs === undefined) {
      delete process.env.CODEX_COMPLETION_EXIT_GRACE_MS;
    } else {
      process.env.CODEX_COMPLETION_EXIT_GRACE_MS = originalCompletionExitGraceMs;
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
    if (originalRunpodProfileEnvFile === undefined) {
      delete process.env.CODEX_RUNPOD_PROFILE_ENV_FILE;
    } else {
      process.env.CODEX_RUNPOD_PROFILE_ENV_FILE = originalRunpodProfileEnvFile;
    }
    if (originalRunpodProfileShell === undefined) {
      delete process.env.CODEX_RUNPOD_PROFILE_SHELL;
    } else {
      process.env.CODEX_RUNPOD_PROFILE_SHELL = originalRunpodProfileShell;
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

  test('uses a short completion exit grace period and allows an override', () => {
    delete process.env.CODEX_COMPLETION_EXIT_GRACE_MS;
    expect(codexToolService.getRuntimeConfig().completionExitGraceMs).toBe(2000);

    process.env.CODEX_COMPLETION_EXIT_GRACE_MS = '3500';
    expect(codexToolService.getRuntimeConfig().completionExitGraceMs).toBe(3500);
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

  test('uses the shared Runpod profile environment file and shell defaults with overrides', () => {
    delete process.env.CODEX_RUNPOD_PROFILE_ENV_FILE;
    delete process.env.CODEX_RUNPOD_PROFILE_SHELL;
    expect(codexToolService.getRuntimeConfig()).toEqual(expect.objectContaining({
      runpodProfileEnvFile: '~/.codex/lentmiien.env',
      runpodProfileShell: '/bin/bash',
    }));

    process.env.CODEX_RUNPOD_PROFILE_ENV_FILE = '/opt/codex/runpod.env';
    process.env.CODEX_RUNPOD_PROFILE_SHELL = '/usr/bin/bash';
    expect(codexToolService.getRuntimeConfig()).toEqual(expect.objectContaining({
      runpodProfileEnvFile: '/opt/codex/runpod.env',
      runpodProfileShell: '/usr/bin/bash',
    }));
  });
});

describe('codexToolService Runpod model provider availability', () => {
  const admin = { name: 'admin', type_user: 'admin' };

  test('publishes only Runpod providers whose exact pods are running', async () => {
    RunpodPod.find.mockReturnValue(runpodPodQuery([
      { name: 'ollama-qwen' },
    ]));

    const config = await codexToolService.publicConfig({ user: admin });

    expect(config.modelProviderOptions.map((provider) => provider.value)).toEqual([
      'openai',
      'ollama',
      'runpod-qwen',
    ]);
    expect(config.modelProviderOptions).toContainEqual(expect.objectContaining({
      value: 'runpod-qwen',
      label: 'Qwen (Runpod)',
      controlMode: 'fixed-profile',
    }));
    expect(RunpodPod.find).toHaveBeenCalledWith({
      name: { $in: ['ollama-qwen', 'glm53-flash'] },
      providerStatus: 'RUNNING',
      lifecycleGroup: 'running',
      archivedAt: null,
    });
  });

  test('hides all Runpod providers when the pods are stopped or absent', async () => {
    const config = await codexToolService.publicConfig({ user: admin });

    expect(config.modelProviderOptions.map((provider) => provider.value)).toEqual([
      'openai',
      'ollama',
    ]);
  });

  test('does not disclose Runpod providers without the semantic capability', async () => {
    const config = await codexToolService.publicConfig({
      user: { name: 'standard-user', type_user: 'user' },
    });

    expect(config.modelProviderOptions.map((provider) => provider.value)).toEqual([
      'openai',
      'ollama',
    ]);
    expect(RunpodPod.find).not.toHaveBeenCalled();
  });

  test('allows an explicitly capability-granted account to use a running provider', async () => {
    Role.findOne
      .mockResolvedValueOnce({ permissions: ['codex.run.runpod_model'] })
      .mockResolvedValueOnce(null);
    RunpodPod.find.mockReturnValue(runpodPodQuery([{ name: 'glm53-flash' }]));

    const config = await codexToolService.publicConfig({
      user: { name: 'model-user', type_user: 'user' },
    });

    expect(config.modelProviderOptions.map((provider) => provider.value)).toEqual([
      'openai',
      'ollama',
      'runpod-glm',
    ]);
  });

  test('fails closed without breaking the Codex page when pod state cannot be read', async () => {
    RunpodPod.find.mockImplementation(() => {
      throw new Error('database unavailable');
    });

    const config = await codexToolService.publicConfig({ user: admin });

    expect(config.modelProviderOptions.map((provider) => provider.value)).toEqual([
      'openai',
      'ollama',
    ]);
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

function createLeanQuery(value) {
  return {
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('codexToolService.queueAdditionalTurnMessage', () => {
  const owner = { _id: 'user-1', name: 'Owner', type_user: 'user' };
  const runningTurn = {
    _id: 'turn-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    status: 'running',
    additionalMessageCount: 0,
    cancelRequestedAt: null,
    createdBy: { id: 'user-1', name: 'Owner' },
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('queues a bounded owner message and reserves one slot atomically', async () => {
    jest.spyOn(CodexTurn, 'findOne').mockReturnValue(createLeanQuery(runningTurn));
    const reserveQuery = { exec: jest.fn().mockResolvedValue({ ...runningTurn, additionalMessageCount: 1 }) };
    jest.spyOn(CodexTurn, 'findOneAndUpdate').mockReturnValue(reserveQuery);
    const queuedAt = new Date('2026-09-03T10:00:00.000Z');
    jest.spyOn(CodexTurnMessage, 'create').mockResolvedValue({
      _id: 'message-1',
      status: 'queued',
      queuedAt,
    });
    jest.spyOn(CodexTurn, 'exists').mockReturnValue({
      exec: jest.fn().mockResolvedValue({ _id: 'turn-1' }),
    });

    await expect(codexToolService.queueAdditionalTurnMessage(
      'turn-1',
      { message: '  Check the forgotten edge case.  ' },
      owner
    )).resolves.toEqual({
      accepted: true,
      message: { id: 'message-1', status: 'queued', queuedAt },
    });

    expect(CodexTurn.findOne).toHaveBeenCalledWith({
      _id: 'turn-1',
      'createdBy.id': 'user-1',
    });
    expect(CodexTurn.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'turn-1',
        'createdBy.id': 'user-1',
        status: 'running',
        cancelRequestedAt: null,
      }),
      { $inc: { additionalMessageCount: 1 } },
      { returnDocument: 'after' }
    );
    expect(CodexTurnMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      turnId: 'turn-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      message: 'Check the forgotten edge case.',
      createdBy: { id: 'user-1', name: 'Owner' },
    }));
  });

  test('fails closed when the principal lacks the steering capability', async () => {
    await expect(codexToolService.queueAdditionalTurnMessage(
      'turn-1',
      { message: 'Try to steer' },
      { _id: 'outsider-1', name: 'Outsider', type_user: 'other' }
    )).rejects.toMatchObject({ statusCode: 403 });

    expect(Role.findOne).toHaveBeenCalledTimes(2);
  });

  test('does not disclose a turn owned by another user', async () => {
    jest.spyOn(CodexTurn, 'findOne').mockReturnValue(createLeanQuery(null));

    await expect(codexToolService.queueAdditionalTurnMessage(
      'turn-foreign',
      { message: 'Try to steer' },
      owner
    )).rejects.toMatchObject({ statusCode: 404, message: 'Turn not found.' });

    expect(CodexTurn.findOne).toHaveBeenCalledWith({
      _id: 'turn-foreign',
      'createdBy.id': 'user-1',
    });
  });

  test('allows the declared admin object-scope override', async () => {
    const foreignTurn = {
      ...runningTurn,
      createdBy: { id: 'someone-else', name: 'Someone else' },
    };
    jest.spyOn(CodexTurn, 'findOne').mockReturnValue(createLeanQuery(foreignTurn));
    jest.spyOn(CodexTurn, 'findOneAndUpdate').mockReturnValue({
      exec: jest.fn().mockResolvedValue({ ...foreignTurn, additionalMessageCount: 1 }),
    });
    jest.spyOn(CodexTurnMessage, 'create').mockResolvedValue({
      _id: 'message-admin',
      status: 'queued',
      queuedAt: new Date(),
    });
    jest.spyOn(CodexTurn, 'exists').mockReturnValue({
      exec: jest.fn().mockResolvedValue({ _id: 'turn-1' }),
    });

    await expect(codexToolService.queueAdditionalTurnMessage(
      'turn-1',
      { message: 'Administrator correction' },
      { _id: 'admin-1', name: 'Admin', type_user: 'admin' }
    )).resolves.toEqual(expect.objectContaining({ accepted: true }));

    expect(CodexTurn.findOne).toHaveBeenCalledWith({ _id: 'turn-1' });
  });

  test('rejects terminal turns and malformed message objects', async () => {
    jest.spyOn(CodexTurn, 'findOne')
      .mockReturnValueOnce(createLeanQuery({ ...runningTurn, status: 'succeeded' }))
      .mockReturnValueOnce(createLeanQuery(runningTurn));

    await expect(codexToolService.queueAdditionalTurnMessage(
      'turn-1',
      { message: 'Too late' },
      owner
    )).rejects.toMatchObject({ statusCode: 409 });
    await expect(codexToolService.queueAdditionalTurnMessage(
      'turn-1',
      { message: 'Valid text', ownerId: 'user-2' },
      owner
    )).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('unsupported fields') });
  });

  test('rejects empty and oversized messages', async () => {
    jest.spyOn(CodexTurn, 'findOne').mockReturnValue(createLeanQuery(runningTurn));

    await expect(codexToolService.queueAdditionalTurnMessage(
      'turn-1',
      { message: '   ' },
      owner
    )).rejects.toMatchObject({ statusCode: 400, message: 'Message is required.' });
    await expect(codexToolService.queueAdditionalTurnMessage(
      'turn-1',
      { message: 'x'.repeat(20001) },
      owner
    )).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('too long') });
  });

  test('enforces the per-turn message limit before allocating more work', async () => {
    jest.spyOn(CodexTurn, 'findOne').mockReturnValue(createLeanQuery({
      ...runningTurn,
      additionalMessageCount: 20,
    }));
    const reserveSpy = jest.spyOn(CodexTurn, 'findOneAndUpdate');

    await expect(codexToolService.queueAdditionalTurnMessage(
      'turn-1',
      { message: 'One too many' },
      owner
    )).rejects.toMatchObject({ statusCode: 429 });

    expect(reserveSpy).not.toHaveBeenCalled();
  });

  test('fails a newly queued message when the turn completes during submission', async () => {
    jest.spyOn(CodexTurn, 'findOne').mockReturnValue(createLeanQuery(runningTurn));
    jest.spyOn(CodexTurn, 'findOneAndUpdate').mockReturnValue({
      exec: jest.fn().mockResolvedValue({ ...runningTurn, additionalMessageCount: 1 }),
    });
    jest.spyOn(CodexTurnMessage, 'create').mockResolvedValue({
      _id: 'message-raced',
      status: 'queued',
      queuedAt: new Date(),
    });
    jest.spyOn(CodexTurn, 'exists').mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    jest.spyOn(CodexTurnMessage, 'findOneAndUpdate').mockReturnValue({
      exec: jest.fn().mockResolvedValue({ _id: 'message-raced', status: 'failed' }),
    });
    const decrementQuery = { exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
    jest.spyOn(CodexTurn, 'updateOne').mockReturnValue(decrementQuery);

    await expect(codexToolService.queueAdditionalTurnMessage(
      'turn-1',
      { message: 'Late correction' },
      owner
    )).rejects.toMatchObject({
      statusCode: 409,
      message: 'The Codex turn is no longer accepting additional messages.',
    });

    expect(CodexTurnMessage.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'message-raced', status: 'queued' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'failed' }),
      }),
      { returnDocument: 'after' }
    );
    expect(CodexTurn.updateOne).toHaveBeenCalledWith(
      { _id: 'turn-1', additionalMessageCount: { $gt: 0 } },
      { $inc: { additionalMessageCount: -1 } }
    );
  });
});

describe('codexToolService.listTurnEventPage', () => {
  const owner = { _id: 'user-1', name: 'Owner', type_user: 'user' };
  const turn = {
    _id: 'turn-1',
    workspaceId: 'workspace-1',
    createdBy: { id: 'user-1' },
    eventCount: 2001,
    startedAt: new Date('2026-09-04T01:00:00.000Z'),
  };

  beforeEach(() => {
    CodexEvent.find.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockWorkspace() {
    const query = createLeanQuery({
      _id: 'workspace-1',
      rootPath: '/workspace/project',
      pathStyle: 'posix',
    });
    query.select = jest.fn().mockReturnValue(query);
    jest.spyOn(CodexWorkspace, 'findById').mockReturnValue(query);
    return query;
  }

  test('owner-scopes reads and returns a bounded descending page', async () => {
    jest.spyOn(CodexTurn, 'findOne').mockReturnValue(createLeanQuery(turn));
    mockWorkspace();
    const query = createEventQuery([
      { _id: 'event-90', turnId: 'turn-1', seq: 90, eventType: 'item.completed' },
      { _id: 'event-89', turnId: 'turn-1', seq: 89, eventType: 'item.completed' },
      { _id: 'event-88', turnId: 'turn-1', seq: 88, eventType: 'item.completed' },
    ]);
    CodexEvent.find.mockReturnValue(query);

    const page = await codexToolService.listTurnEventPage('turn-1', {
      user: owner,
      beforeSeq: 100,
      limit: 2,
      order: 'desc',
    });

    expect(CodexTurn.findOne).toHaveBeenCalledWith({
      _id: 'turn-1',
      'createdBy.id': 'user-1',
    });
    expect(CodexEvent.find).toHaveBeenCalledWith({
      turnId: 'turn-1',
      seq: { $lt: 100 },
    });
    expect(query.sort).toHaveBeenCalledWith({ seq: -1 });
    expect(query.limit).toHaveBeenCalledWith(3);
    expect(page).toEqual(expect.objectContaining({
      hasMore: true,
      total: 2001,
      nextBeforeSeq: 89,
      workspaceRoot: '/workspace/project',
    }));
    expect(page.events.map((event) => event.seq)).toEqual([90, 89]);
  });

  test('supports the explicit administrator object-scope override', async () => {
    jest.spyOn(CodexTurn, 'findOne').mockReturnValue(createLeanQuery({
      ...turn,
      createdBy: { id: 'another-user' },
    }));
    mockWorkspace();
    const query = createEventQuery([]);
    CodexEvent.find.mockReturnValue(query);

    await codexToolService.listTurnEventPage('turn-1', {
      user: { _id: 'admin-1', name: 'Admin', type_user: 'admin' },
      afterSeq: 5,
    });

    expect(CodexTurn.findOne).toHaveBeenCalledWith({ _id: 'turn-1' });
    expect(CodexEvent.find).toHaveBeenCalledWith({
      turnId: 'turn-1',
      seq: { $gt: 5 },
    });
  });

  test('caps requested raw-event pages at 250 records', async () => {
    jest.spyOn(CodexTurn, 'findOne').mockReturnValue(createLeanQuery(turn));
    mockWorkspace();
    const query = createEventQuery([]);
    CodexEvent.find.mockReturnValue(query);

    await codexToolService.listTurnEventPage('turn-1', {
      user: owner,
      limit: 1000,
      order: 'desc',
    });

    expect(query.limit).toHaveBeenCalledWith(251);
  });

  test('returns not found for a foreign owner without querying event data', async () => {
    jest.spyOn(CodexTurn, 'findOne').mockReturnValue(createLeanQuery(null));
    const eventFindSpy = CodexEvent.find;

    await expect(codexToolService.listTurnEventPage('turn-foreign', {
      user: owner,
    })).rejects.toMatchObject({ statusCode: 404, message: 'Turn not found.' });

    expect(CodexTurn.findOne).toHaveBeenCalledWith({
      _id: 'turn-foreign',
      'createdBy.id': 'user-1',
    });
    expect(eventFindSpy).not.toHaveBeenCalled();
  });

  test('fails closed before reading a turn when the capability is absent', async () => {
    const turnFindSpy = jest.spyOn(CodexTurn, 'findOne');

    await expect(codexToolService.listTurnEventPage('turn-1', {
      user: { _id: 'visitor-1', type_user: 'other' },
    })).rejects.toMatchObject({ statusCode: 403 });

    expect(turnFindSpy).not.toHaveBeenCalled();
  });

  test('keeps the compatibility list helper behind the same authorization boundary', async () => {
    jest.spyOn(CodexTurn, 'findOne').mockReturnValue(createLeanQuery(turn));
    mockWorkspace();
    const query = createEventQuery([
      { _id: 'event-1', turnId: 'turn-1', seq: 1, eventType: 'turn.started' },
    ]);
    CodexEvent.find.mockReturnValue(query);

    const events = await codexToolService.listTurnEvents('turn-1', { user: owner });

    expect(events).toHaveLength(1);
    expect(CodexTurn.findOne).toHaveBeenCalledWith({
      _id: 'turn-1',
      'createdBy.id': 'user-1',
    });
  });

  test('can serialize turn-page session metadata without owner, root, or thread identifiers', () => {
    const serialized = codexToolService.serializeSession({
      _id: 'session-1',
      workspaceId: 'workspace-1',
      targetId: 'target-1',
      codexThreadId: 'thread-private',
      createdBy: { id: 'user-1', name: 'Private Account Name' },
      title: 'Session',
    }, {
      workspace: {
        _id: 'workspace-1',
        targetId: 'target-1',
        name: 'Workspace',
        rootPath: '/home/private/project',
      },
      exposeOwner: false,
      exposeRootPath: false,
      exposeOperationalMetadata: false,
    });

    expect(serialized).not.toHaveProperty('createdBy');
    expect(serialized).not.toHaveProperty('codexThreadId');
    expect(serialized.workspace).not.toHaveProperty('rootPath');
  });
});

describe('codexToolService.cancelTurn authorization', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('owner-scopes cancellation and conceals foreign turns', async () => {
    const query = createLeanQuery(null);
    jest.spyOn(CodexTurn, 'findOne').mockReturnValue(query);

    await expect(codexToolService.cancelTurn('turn-foreign', {
      _id: 'user-1',
      name: 'Owner',
      type_user: 'user',
    })).rejects.toMatchObject({ statusCode: 404, message: 'Turn not found.' });

    expect(CodexTurn.findOne).toHaveBeenCalledWith({
      _id: 'turn-foreign',
      'createdBy.id': 'user-1',
    });
  });

  test('allows the declared admin override without returning owner metadata', async () => {
    const turn = {
      _id: 'turn-foreign',
      status: 'running',
      cancelRequestedAt: new Date('2026-09-04T01:00:00.000Z'),
      createdBy: { id: 'another-user', name: 'Private Account Name' },
    };
    jest.spyOn(CodexTurn, 'findOne').mockReturnValue(createLeanQuery(turn));

    const result = await codexToolService.cancelTurn('turn-foreign', {
      _id: 'admin-1',
      name: 'Admin',
      type_user: 'admin',
    });

    expect(CodexTurn.findOne).toHaveBeenCalledWith({ _id: 'turn-foreign' });
    expect(result).not.toHaveProperty('createdBy');
    expect(result).not.toHaveProperty('commandSummary');
  });

  test('fails closed before resolving the target when cancellation capability is absent', async () => {
    const findSpy = jest.spyOn(CodexTurn, 'findOne');

    await expect(codexToolService.cancelTurn('turn-1', {
      _id: 'visitor-1',
      name: 'Visitor',
      type_user: 'other',
    })).rejects.toMatchObject({ statusCode: 403 });

    expect(findSpy).not.toHaveBeenCalled();
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

  test('groups Runpod Qwen and GLM usage into the Ollama totals and price table', () => {
    const pricingByProvider = {
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
    };
    const turns = [
      {
        _id: 'qwen-turn',
        sessionId: 'qwen-session',
        modelProvider: 'runpod-qwen',
        sequence: 1,
        kind: 'question',
        status: 'succeeded',
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      },
      {
        _id: 'glm-turn',
        sessionId: 'glm-session',
        modelProvider: 'runpod-glm',
        sequence: 1,
        kind: 'question',
        status: 'succeeded',
        usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 },
      },
    ];

    const stats = codexToolService.buildSessionStats(turns, pricingByProvider);
    const serialized = codexToolService.serializeTurn(turns[0], { pricingByProvider });

    expect(stats.providerUsage.ollama.tokens.total).toBe(450);
    expect(stats.providerUsage.ollama.turnCount).toBe(2);
    expect(stats.providerUsage.openai.tokens.total).toBe(0);
    expect(stats.ollamaCost).toBeCloseTo(0.9, 8);
    expect(serialized).toEqual(expect.objectContaining({
      modelProvider: 'runpod-qwen',
      modelProviderLabel: 'Qwen (Runpod)',
      usageProvider: 'ollama',
      runpodBacked: true,
    }));
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

  test.each([
    ['runpod-qwen', 'ollama-qwen', 'lentmiien-qwen'],
    ['runpod-glm', 'glm53-flash', 'lentmiien-glm'],
  ])('resolves %s to its fixed Codex profile while its pod is running', async (
    modelProvider,
    podName,
    profile
  ) => {
    RunpodPod.find.mockReturnValue(runpodPodQuery([{ name: podName }]));

    await expect(codexToolService.resolveTurnRequestOptions({
      modelProvider,
      model: 'client-supplied-model',
      profile: 'client-supplied-profile',
      reasoningEffort: 'ultra',
    }, {}, {
      user: { name: 'admin', type_user: 'admin' },
    })).resolves.toEqual({
      requestProfileId: '',
      requestProfileName: '',
      modelProvider,
      model: '',
      profile,
      reasoningEffort: '',
    });
  });

  test('rejects a Runpod provider when its pod is not running', async () => {
    await expect(codexToolService.resolveTurnRequestOptions({
      modelProvider: 'runpod-qwen',
    }, {}, {
      user: { name: 'admin', type_user: 'admin' },
    })).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('not running'),
    });
  });

  test('returns a sanitized service error when Runpod availability cannot be verified', async () => {
    RunpodPod.find.mockImplementation(() => {
      throw new Error('mongodb://internal-host/provider-state');
    });

    await expect(codexToolService.resolveTurnRequestOptions({
      modelProvider: 'runpod-glm',
    }, {}, {
      user: { name: 'admin', type_user: 'admin' },
    })).rejects.toMatchObject({
      statusCode: 503,
      message: 'Runpod model availability could not be verified. Please try again.',
    });
  });

  test('rejects a Runpod provider without its semantic capability', async () => {
    RunpodPod.find.mockReturnValue(runpodPodQuery([{ name: 'ollama-qwen' }]));

    await expect(codexToolService.resolveTurnRequestOptions({
      modelProvider: 'runpod-qwen',
    }, {}, {
      user: { name: 'standard-user', type_user: 'user' },
    })).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('permission'),
    });
    expect(RunpodPod.find).not.toHaveBeenCalled();
  });
});
