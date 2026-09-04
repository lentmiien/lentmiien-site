const CodexChatToolService = require('../../services/codexChatToolService');

function query(value) {
  return {
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function terminalTurn(overrides = {}) {
  return {
    _id: 'turn-1',
    sessionId: 'session-1',
    status: 'succeeded',
    finalResponse: 'Codex finished the task.',
    errorMessage: '',
    completedAt: new Date('2026-09-05T01:00:00.000Z'),
    ...overrides,
  };
}

function createService(overrides = {}) {
  const turn = overrides.turn || terminalTurn();
  const service = overrides.service || {
    createSession: jest.fn().mockResolvedValue({
      turn: { id: turn._id },
      session: { id: turn.sessionId },
    }),
    listWorkspaces: jest.fn(),
    listRequestProfiles: jest.fn(),
    publicConfig: jest.fn(),
  };
  const turnModel = overrides.turnModel || {
    findById: jest.fn(() => query(turn)),
  };
  const pendingModel = overrides.pendingModel || {
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  return {
    service,
    turnModel,
    pendingModel,
    instance: new CodexChatToolService({
      service,
      turnModel,
      pendingModel,
      roleModel: { findOne: jest.fn().mockResolvedValue(null) },
      userModel: {
        findById: jest.fn(() => query({ _id: 'admin-1', name: 'Admin', type_user: 'admin' })),
      },
      appLogger: { error: jest.fn() },
      sleep: jest.fn().mockResolvedValue(),
      ...overrides.options,
    }),
  };
}

const adminContext = {
  user: { _id: 'admin-1', name: 'Admin', type_user: 'admin' },
  conversationId: 'conversation-1',
  responseId: 'response-1',
  callId: 'call-1',
};

describe('CodexChatToolService', () => {
  test('runs the development workspace with fixed OpenAI High/yolo inputs', async () => {
    const harness = createService();

    const result = await harness.instance.runLentmiienSiteLinux(
      { prompt: 'Implement the requested change.' },
      { ...adminContext, toolName: 'codex_lentmiien_site_linux' }
    );

    expect(harness.service.createSession).toHaveBeenCalledWith({
      workspaceId: '3b73bde5-4b30-4731-a0e4-45c4180864f2',
      mode: 'action',
      permissionMode: 'yolo',
      modelProvider: 'openai',
      requestProfileId: 'high',
      prompt: 'Implement the requested change.',
      confirmYolo: true,
    }, adminContext.user, {
      sessionId: expect.stringMatching(/^tool-session-[a-f0-9]{64}$/),
      turnId: expect.stringMatching(/^tool-turn-[a-f0-9]{64}$/),
    });
    expect(result).toMatchObject({
      status: 'succeeded',
      final_response: 'Codex finished the task.',
      session_url: '/codex/sessions/session-1',
      turn_url: '/codex/turns/turn-1',
    });
  });

  test('forces the production workspace to question/read-only mode', async () => {
    const harness = createService();

    await harness.instance.runLentmiienSiteProduction(
      { prompt: 'Investigate the live error.' },
      { ...adminContext, toolName: 'codex_lentmiien_site_production' }
    );

    expect(harness.service.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: '4ef51c48-3ecd-4ab1-ba3b-d8fe767f884b',
        mode: 'question',
        permissionMode: 'read-only',
        modelProvider: 'openai',
        requestProfileId: 'high',
        confirmYolo: false,
      }),
      adminContext.user,
      expect.any(Object)
    );
  });

  test('uses stable Codex resource IDs when a completed tool call is replayed', async () => {
    const harness = createService();
    const context = { ...adminContext, toolName: 'codex_ai_gateway_linux' };

    await harness.instance.runAiGatewayLinux({ prompt: 'Check the service.' }, context);
    await harness.instance.runAiGatewayLinux({ prompt: 'Check the service.' }, context);

    const firstIds = harness.service.createSession.mock.calls[0][2];
    const secondIds = harness.service.createSession.mock.calls[1][2];
    expect(secondIds).toEqual(firstIds);
  });

  test('rejects unknown general-run fields before Codex is queued', async () => {
    const harness = createService();

    await expect(harness.instance.runInWorkspace({
      workspace_id: 'workspace-1',
      prompt: 'Run it.',
      model_provider: 'openai',
      mode: 'action',
      permission_mode: 'workspace-write',
      confirm_yolo: true,
    }, adminContext)).rejects.toMatchObject({ statusCode: 400 });
    expect(harness.service.createSession).not.toHaveBeenCalled();
  });

  test('fails closed for a principal without the semantic capability', async () => {
    const harness = createService();

    await expect(harness.instance.runInWorkspace({
      workspace_id: 'workspace-1',
      prompt: 'Inspect it.',
      model_provider: 'openai',
      mode: 'question',
      permission_mode: 'read-only',
      request_profile_id: 'high',
    }, {
      user: { _id: 'user-1', name: 'User', type_user: 'user' },
    })).rejects.toMatchObject({ statusCode: 403 });
    expect(harness.service.createSession).not.toHaveBeenCalled();
  });

  test('requires the separate yolo capability for fixed development tools', async () => {
    const developer = { _id: 'developer-1', name: 'Developer', type_user: 'user' };
    const harness = createService({
      options: {
        userModel: { findById: jest.fn(() => query(developer)) },
        roleModel: {
          findOne: jest.fn(({ type }) => Promise.resolve({
            permissions: type === 'user' ? ['codex.run.workspace_write'] : [],
          })),
        },
      },
    });

    await expect(harness.instance.runLentmiienSiteLinux(
      { prompt: 'Implement it.' },
      { ...adminContext, user: developer }
    )).rejects.toMatchObject({ statusCode: 403 });
    expect(harness.service.createSession).not.toHaveBeenCalled();
  });

  test('returns current form choices without exposing workspace root paths', async () => {
    const harness = createService();
    harness.service.listWorkspaces.mockResolvedValue([{
      id: 'workspace-1',
      name: 'Workspace',
      rootPath: '/private/root',
      description: 'Test workspace',
      target: { name: 'Linux', type: 'local-linux', platform: 'linux', enabled: true },
      defaultQuestionPermission: 'read-only',
      defaultActionPermission: 'workspace-write',
      allowYolo: true,
    }]);
    harness.service.listRequestProfiles.mockResolvedValue([{
      id: 'high',
      name: 'High',
      description: 'Hard tasks',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'max',
      codexProfile: '',
    }]);
    harness.service.publicConfig.mockResolvedValue({
      yoloEnabled: true,
      maxPromptChars: 20000,
      modelProviderOptions: [{ value: 'openai', label: 'OpenAI' }],
      localModelOptions: [],
    });

    const result = await harness.instance.fetchRequestOptions({}, adminContext);

    expect(result.workspaces[0]).toMatchObject({
      id: 'workspace-1',
      name: 'Workspace',
      allows_yolo: true,
    });
    expect(result.workspaces[0]).not.toHaveProperty('rootPath');
    expect(JSON.stringify(result)).not.toContain('/private/root');
    expect(result.permission_modes.map((permission) => permission.value)).toEqual([
      'auto',
      'read-only',
      'workspace-write',
      'yolo',
    ]);
  });

  test('returns a bounded nonterminal result when the wait window expires', async () => {
    let timestamp = 0;
    const queued = terminalTurn({ status: 'queued', finalResponse: '', completedAt: null });
    const harness = createService({
      turn: queued,
      options: {
        now: () => new Date(timestamp),
        sleep: jest.fn(async (milliseconds) => {
          timestamp += milliseconds;
        }),
        env: {
          CODEX_CHAT_TOOL_WAIT_TIMEOUT_MS: '30000',
          CODEX_CHAT_TOOL_POLL_INTERVAL_MS: '10000',
        },
      },
    });

    const result = await harness.instance.runAiGatewayLinux(
      { prompt: 'Long task.' },
      { ...adminContext, toolName: 'codex_ai_gateway_linux' }
    );

    expect(result).toMatchObject({
      status: 'queued',
      final_response: '',
      error: expect.stringContaining('wait limit'),
      turn_url: '/codex/turns/turn-1',
    });
    expect(harness.pendingModel.updateOne).toHaveBeenCalled();
  });
});
