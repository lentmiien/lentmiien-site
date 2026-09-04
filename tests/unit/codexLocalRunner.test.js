const { EventEmitter } = require('events');

jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: jest.fn(),
}));

const { spawn } = require('child_process');
const logger = require('../../utils/logger');
const CodexLocalRunner = require('../../services/codexLocalRunner');

function createFakeChild() {
  const child = new EventEmitter();
  child.pid = 12345;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    destroyed: false,
    writableEnded: false,
    write: jest.fn(() => true),
    end: jest.fn(() => {
      child.stdin.writableEnded = true;
    }),
  };
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = jest.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

function writtenMessages(child) {
  return child.stdin.write.mock.calls.map(([line]) => JSON.parse(String(line).trim()));
}

async function waitForMessage(child, predicate) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const message = writtenMessages(child).find(predicate);
    if (message) {
      return message;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Expected Codex app-server message was not written.');
}

function respond(child, request, result) {
  child.stdout.emit('data', Buffer.from(`${JSON.stringify({ id: request.id, result })}\n`));
}

function rejectRequest(child, request, code = -32600) {
  child.stdout.emit('data', Buffer.from(`${JSON.stringify({
    id: request.id,
    error: { code, message: 'Provider detail that must stay private.' },
  })}\n`));
}

function notify(child, method, params) {
  child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method, params })}\n`));
}

function createRunInput(overrides = {}) {
  return {
    turn: {
      _id: 'turn-lifecycle',
      kind: 'question',
      prompt: 'Answer the question.',
      permissionMode: 'read-only',
      ...overrides.turn,
    },
    session: overrides.session || {},
    workspace: { rootPath: '/workspace/project' },
    target: { type: 'local-linux' },
    onEvent: overrides.onEvent || jest.fn().mockResolvedValue(),
    onCommand: overrides.onCommand,
    onThreadId: overrides.onThreadId,
    onTurnStarted: overrides.onTurnStarted,
    isCancellationRequested: overrides.isCancellationRequested,
  };
}

async function startAppServerTurn(runner, child, input, options = {}) {
  const resultPromise = runner.runTurn(input);
  const initialize = await waitForMessage(child, (message) => message.method === 'initialize');
  respond(child, initialize, {
    codexHome: '/home/test/.codex',
    platformFamily: 'unix',
    platformOs: 'linux',
    userAgent: 'codex-test',
  });
  await waitForMessage(child, (message) => message.method === 'initialized');
  const threadMethod = options.resume ? 'thread/resume' : 'thread/start';
  const threadRequest = await waitForMessage(child, (message) => message.method === threadMethod);
  respond(child, threadRequest, { thread: { id: options.threadId || 'thread-123' } });
  const turnRequest = await waitForMessage(child, (message) => message.method === 'turn/start');
  respond(child, turnRequest, {
    turn: { id: options.turnId || 'codex-turn-123', status: 'inProgress', items: [] },
  });
  await waitForMessage(child, (message) => message.method === 'turn/start');
  const deadline = Date.now() + 2000;
  while (!runner.activeRuns.has(String(input.turn._id)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return { resultPromise, threadRequest, turnRequest };
}

describe('CodexLocalRunner', () => {
  beforeEach(() => {
    spawn.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('builds a local app-server command that preserves turn settings', () => {
    const runner = new CodexLocalRunner({ binaryPath: 'codex-test', timeoutMs: 60000 });
    const command = runner.buildCommand({
      turn: {
        _id: 'turn-1',
        kind: 'action',
        model: 'gpt-5.6-terra',
        profile: 'local',
        reasoningEffort: 'high',
        permissionMode: 'workspace-write',
      },
      session: {},
      workspace: { rootPath: '/workspace/project' },
      target: { type: 'local-linux' },
    });

    expect(command.binary).toBe('codex-test');
    expect(command.args).toEqual(expect.arrayContaining([
      '-m', 'gpt-5.6-terra',
      '-p', 'local',
      '-C', '/workspace/project',
      '--sandbox', 'workspace-write',
      'app-server',
    ]));
    expect(command.args).not.toContain('exec');
    expect(command.args).not.toContain('Answer the question.');
    expect(command.commandSummary).toEqual(expect.objectContaining({
      operation: 'app-server',
      resume: false,
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high',
    }));
  });

  test('marks a follow-up for thread resume without putting its thread id on the command line', () => {
    const runner = new CodexLocalRunner({ binaryPath: 'codex-test', timeoutMs: 60000 });
    const command = runner.buildCommand({
      turn: {
        _id: 'turn-2',
        kind: 'followup_question',
        permissionMode: 'read-only',
      },
      session: { codexThreadId: 'thread-private' },
      workspace: { rootPath: '/workspace/project' },
    });

    expect(command.commandSummary.resume).toBe(true);
    expect(command.args).toContain('app-server');
    expect(command.args).not.toContain('thread-private');
  });

  test('adds the configured Ollama profile and OSS flag', () => {
    const runner = new CodexLocalRunner({
      binaryPath: 'codex-test',
      timeoutMs: 60000,
      ollamaProfile: 'local-qwen',
    });
    const command = runner.buildCommand({
      turn: {
        _id: 'turn-local',
        kind: 'question',
        modelProvider: 'ollama',
        model: 'qwen3.6:27b',
        permissionMode: 'read-only',
      },
      session: {},
      workspace: { rootPath: '/workspace/project' },
    });

    expect(command.args).toEqual(expect.arrayContaining([
      '--oss', '-p', 'local-qwen', '-m', 'qwen3.6:27b', 'app-server',
    ]));
    expect(command.commandSummary).toEqual(expect.objectContaining({
      modelProvider: 'ollama',
      model: 'qwen3.6:27b',
      oss: true,
      profile: 'local-qwen',
    }));
  });

  test('sources the shared environment for the fixed Runpod profile', () => {
    const runner = new CodexLocalRunner({
      binaryPath: 'codex-test',
      timeoutMs: 60000,
      runpodProfileEnvFile: '/home/tester/.codex/lentmiien.env',
      runpodProfileShell: '/bin/bash-test',
    });
    const command = runner.buildCommand({
      turn: {
        _id: 'turn-runpod',
        kind: 'action',
        modelProvider: 'runpod-qwen',
        model: 'ignored-model',
        reasoningEffort: 'ultra',
        permissionMode: 'yolo',
      },
      session: {},
      workspace: { rootPath: '/workspace/project' },
    });

    expect(command.binary).toBe('/bin/bash-test');
    expect(command.args).toEqual(expect.arrayContaining([
      '/home/tester/.codex/lentmiien.env',
      'codex-test',
      '-p',
      'lentmiien-qwen',
      '--dangerously-bypass-approvals-and-sandbox',
      'app-server',
    ]));
    expect(command.args[1]).toContain('. "$1"');
    expect(command.args).not.toContain('ignored-model');
    expect(command.commandSummary).toEqual(expect.objectContaining({
      profile: 'lentmiien-qwen',
      model: '',
      reasoningEffort: '',
    }));
  });

  test('builds an app-server stdio command over SSH', () => {
    const runner = new CodexLocalRunner({ binaryPath: 'codex-test', timeoutMs: 60000 });
    const command = runner.buildCommand({
      turn: {
        _id: 'turn-remote',
        kind: 'action',
        permissionMode: 'workspace-write',
      },
      session: {},
      workspace: { rootPath: '/home/lennart/project' },
      target: {
        type: 'remote-ssh-linux',
        connection: {
          destination: 'worker@example.test',
          sshBinaryPath: 'ssh-test',
          codexBinaryPath: 'codex',
          options: ['-o', 'BatchMode=yes'],
        },
      },
    });

    expect(command.binary).toBe('ssh-test');
    expect(command.args).toEqual(expect.arrayContaining([
      '-T', '-o', 'BatchMode=yes', 'worker@example.test',
    ]));
    const remoteCommand = command.args[command.args.length - 1];
    expect(remoteCommand).toContain('app-server');
    expect(remoteCommand).toContain('/home/lennart/project');
    expect(command.commandSummary).toEqual(expect.objectContaining({
      outputLocation: 'remote',
      sshDestination: 'worker@example.test',
    }));
  });

  describe('app-server lifecycle', () => {
    test('initializes, starts a thread, and records the completed turn', async () => {
      const child = createFakeChild();
      const onEvent = jest.fn().mockResolvedValue();
      const onThreadId = jest.fn().mockResolvedValue();
      const onTurnStarted = jest.fn().mockResolvedValue();
      spawn.mockReturnValue(child);
      const runner = new CodexLocalRunner({
        binaryPath: 'codex-test',
        timeoutMs: 60000,
        additionalMessageTimeoutMs: 1000,
        completionExitGraceMs: 100,
      });
      const input = createRunInput({ onEvent, onThreadId, onTurnStarted });
      const { resultPromise, threadRequest, turnRequest } = await startAppServerTurn(
        runner,
        child,
        input
      );
      notify(child, 'turn/started', {
        threadId: 'thread-123',
        turn: { id: 'codex-turn-123', status: 'inProgress', items: [] },
      });

      expect(threadRequest.params).toEqual(expect.objectContaining({
        cwd: '/workspace/project',
        approvalPolicy: 'never',
        sandbox: 'read-only',
      }));
      expect(turnRequest.params).toEqual(expect.objectContaining({
        threadId: 'thread-123',
        input: [{ type: 'text', text: 'Answer the question.' }],
        clientUserMessageId: 'turn-lifecycle',
      }));
      notify(child, 'item/completed', {
        threadId: 'thread-123',
        turnId: 'codex-turn-123',
        item: {
          id: 'agent-1',
          type: 'agentMessage',
          phase: 'final_answer',
          text: 'Finished response',
        },
      });
      notify(child, 'thread/tokenUsage/updated', {
        threadId: 'thread-123',
        turnId: 'codex-turn-123',
        tokenUsage: {
          total: {
            inputTokens: 120,
            cachedInputTokens: 40,
            outputTokens: 30,
            reasoningOutputTokens: 10,
            totalTokens: 150,
          },
        },
      });
      notify(child, 'turn/completed', {
        threadId: 'thread-123',
        turn: {
          id: 'codex-turn-123',
          status: 'completed',
          items: [],
        },
      });

      await expect(resultPromise).resolves.toEqual(expect.objectContaining({
        status: 'succeeded',
        finalResponse: 'Finished response',
        codexThreadId: 'thread-123',
        usage: {
          input_tokens: 120,
          cached_input_tokens: 40,
          output_tokens: 30,
          reasoning_output_tokens: 10,
          total_tokens: 150,
        },
      }));
      expect(onThreadId).toHaveBeenCalledWith('thread-123');
      expect(onTurnStarted).toHaveBeenCalledWith({
        threadId: 'thread-123',
        turnId: 'codex-turn-123',
      });
      expect(onTurnStarted).toHaveBeenCalledTimes(1);
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'item.completed',
        payload: expect.objectContaining({
          item: expect.objectContaining({ type: 'agent_message', text: 'Finished response' }),
        }),
      }));
      expect(child.stdin.end).toHaveBeenCalled();
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    test('retains actionable item starts and current plan states without retaining message starts', async () => {
      const child = createFakeChild();
      const onEvent = jest.fn().mockResolvedValue();
      spawn.mockReturnValue(child);
      const runner = new CodexLocalRunner({
        binaryPath: 'codex-test',
        timeoutMs: 60000,
        additionalMessageTimeoutMs: 1000,
        completionExitGraceMs: 100,
      });
      const input = createRunInput({ onEvent });
      const { resultPromise } = await startAppServerTurn(runner, child, input);

      notify(child, 'item/started', {
        threadId: 'thread-123',
        turnId: 'codex-turn-123',
        item: {
          id: 'command-1',
          type: 'commandExecution',
          command: 'npm test',
          status: 'inProgress',
        },
      });
      notify(child, 'item/started', {
        threadId: 'thread-123',
        turnId: 'codex-turn-123',
        item: {
          id: 'agent-message-1',
          type: 'agentMessage',
          text: '',
        },
      });
      notify(child, 'turn/plan/updated', {
        threadId: 'thread-123',
        turnId: 'codex-turn-123',
        plan: [
          { step: 'Inspect', status: 'completed' },
          { step: 'Implement', status: 'inProgress' },
          { step: 'Verify', status: 'pending' },
        ],
      });
      notify(child, 'turn/completed', {
        threadId: 'thread-123',
        turn: { id: 'codex-turn-123', status: 'completed', items: [] },
      });

      await expect(resultPromise).resolves.toEqual(expect.objectContaining({ status: 'succeeded' }));
      const storedEvents = onEvent.mock.calls.map(([event]) => event);
      expect(storedEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          eventType: 'item.started',
          payload: expect.objectContaining({
            item: expect.objectContaining({
              id: 'command-1',
              type: 'command_execution',
              status: 'inProgress',
            }),
          }),
        }),
        expect.objectContaining({
          eventType: 'turn.plan.updated',
          payload: expect.objectContaining({
            item: expect.objectContaining({
              type: 'todo_list',
              items: [
                { text: 'Inspect', status: 'completed', completed: true },
                { text: 'Implement', status: 'inProgress', completed: false },
                { text: 'Verify', status: 'pending', completed: false },
              ],
            }),
          }),
        }),
      ]));
      expect(storedEvents).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          eventType: 'item.started',
          payload: expect.objectContaining({
            item: expect.objectContaining({ id: 'agent-message-1' }),
          }),
        }),
      ]));
    });

    test('resumes a follow-up with history hydration disabled', async () => {
      const child = createFakeChild();
      spawn.mockReturnValue(child);
      const runner = new CodexLocalRunner({
        binaryPath: 'codex-test',
        timeoutMs: 60000,
        additionalMessageTimeoutMs: 1000,
        completionExitGraceMs: 100,
      });
      const input = createRunInput({
        turn: { kind: 'followup_question' },
        session: { codexThreadId: 'existing-thread' },
      });
      const { resultPromise, threadRequest } = await startAppServerTurn(runner, child, input, {
        resume: true,
        threadId: 'existing-thread',
      });

      expect(threadRequest.params).toEqual(expect.objectContaining({
        threadId: 'existing-thread',
        excludeTurns: true,
      }));
      notify(child, 'turn/completed', {
        threadId: 'existing-thread',
        turn: { id: 'codex-turn-123', status: 'completed', items: [] },
      });
      await expect(resultPromise).resolves.toEqual(expect.objectContaining({ status: 'succeeded' }));
    });

    test('retains cumulative thread usage for service-layer follow-up accounting', async () => {
      const child = createFakeChild();
      spawn.mockReturnValue(child);
      const runner = new CodexLocalRunner({
        binaryPath: 'codex-test',
        timeoutMs: 60000,
        additionalMessageTimeoutMs: 1000,
        completionExitGraceMs: 100,
      });
      const input = createRunInput({
        turn: { kind: 'followup_question' },
        session: { codexThreadId: 'existing-thread' },
      });
      const resultPromise = runner.runTurn(input);
      const initialize = await waitForMessage(child, (message) => message.method === 'initialize');
      respond(child, initialize, {
        codexHome: '/home/test/.codex',
        platformFamily: 'unix',
        platformOs: 'linux',
        userAgent: 'codex-test',
      });
      const resumeRequest = await waitForMessage(child, (message) => message.method === 'thread/resume');
      respond(child, resumeRequest, { thread: { id: 'existing-thread' } });
      notify(child, 'thread/tokenUsage/updated', {
        threadId: 'existing-thread',
        turnId: 'previous-turn',
        tokenUsage: {
          total: {
            inputTokens: 100,
            cachedInputTokens: 20,
            outputTokens: 40,
            reasoningOutputTokens: 10,
            totalTokens: 140,
          },
        },
      });
      const turnRequest = await waitForMessage(child, (message) => message.method === 'turn/start');
      respond(child, turnRequest, {
        turn: { id: 'current-turn', status: 'inProgress', items: [] },
      });
      notify(child, 'thread/tokenUsage/updated', {
        threadId: 'existing-thread',
        turnId: 'current-turn',
        tokenUsage: {
          total: {
            inputTokens: 135,
            cachedInputTokens: 25,
            outputTokens: 52,
            reasoningOutputTokens: 14,
            totalTokens: 187,
          },
        },
      });
      notify(child, 'turn/completed', {
        threadId: 'existing-thread',
        turn: { id: 'current-turn', status: 'completed', items: [] },
      });

      await expect(resultPromise).resolves.toEqual(expect.objectContaining({
        usage: {
          input_tokens: 135,
          cached_input_tokens: 25,
          output_tokens: 52,
          reasoning_output_tokens: 14,
          total_tokens: 187,
        },
      }));
    });

    test('steers the active turn over the same app-server connection', async () => {
      const child = createFakeChild();
      spawn.mockReturnValue(child);
      const runner = new CodexLocalRunner({
        binaryPath: 'codex-test',
        timeoutMs: 60000,
        additionalMessageTimeoutMs: 1000,
        completionExitGraceMs: 100,
      });
      const input = createRunInput();
      const { resultPromise } = await startAppServerTurn(runner, child, input);

      const steerPromise = runner.sendAdditionalMessage({
        turn: input.turn,
        message: 'Check the forgotten edge case.',
        messageId: 'message-1',
      });
      const steerRequest = await waitForMessage(child, (message) => message.method === 'turn/steer');
      expect(steerRequest.params).toEqual({
        threadId: 'thread-123',
        expectedTurnId: 'codex-turn-123',
        input: [{ type: 'text', text: 'Check the forgotten edge case.' }],
        clientUserMessageId: 'message-1',
      });
      respond(child, steerRequest, { turnId: 'codex-turn-123' });
      await expect(steerPromise).resolves.toEqual({
        accepted: true,
        commandSummary: {
          operation: 'turn.steer',
          transport: 'app-server-stdio',
        },
      });

      notify(child, 'turn/completed', {
        threadId: 'thread-123',
        turn: { id: 'codex-turn-123', status: 'completed', items: [] },
      });
      await resultPromise;
    });

    test('does not duplicate app-server user items in the detail stream', async () => {
      const child = createFakeChild();
      const onEvent = jest.fn().mockResolvedValue();
      spawn.mockReturnValue(child);
      const runner = new CodexLocalRunner({
        binaryPath: 'codex-test',
        timeoutMs: 60000,
        additionalMessageTimeoutMs: 1000,
        completionExitGraceMs: 100,
      });
      const input = createRunInput({ onEvent });
      const { resultPromise } = await startAppServerTurn(runner, child, input);

      notify(child, 'item/completed', {
        threadId: 'thread-123',
        turnId: 'codex-turn-123',
        item: {
          id: 'user-1',
          type: 'userMessage',
          clientId: 'message-1',
          content: [{ type: 'text', text: 'Additional private text' }],
        },
      });
      notify(child, 'turn/completed', {
        threadId: 'thread-123',
        turn: { id: 'codex-turn-123', status: 'completed', items: [] },
      });
      await resultPromise;

      expect(onEvent.mock.calls.flat()).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            item: expect.objectContaining({ type: 'user_message' }),
          }),
        }),
      ]));
    });

    test('returns a generic error when Codex rejects steering', async () => {
      const child = createFakeChild();
      spawn.mockReturnValue(child);
      const runner = new CodexLocalRunner({
        binaryPath: 'codex-test',
        timeoutMs: 60000,
        additionalMessageTimeoutMs: 1000,
        completionExitGraceMs: 100,
      });
      const input = createRunInput();
      const { resultPromise } = await startAppServerTurn(runner, child, input);

      const steerPromise = runner.sendAdditionalMessage({
        turn: input.turn,
        message: 'Private correction',
        messageId: 'message-private',
      });
      const steerRequest = await waitForMessage(child, (message) => message.method === 'turn/steer');
      rejectRequest(child, steerRequest);
      await expect(steerPromise).rejects.toThrow('Codex did not accept the additional message.');
      await expect(steerPromise).rejects.not.toThrow('Provider detail');

      notify(child, 'turn/completed', {
        threadId: 'thread-123',
        turn: { id: 'codex-turn-123', status: 'completed', items: [] },
      });
      await resultPromise;
    });

    test('finalizes from turn.completed when event persistence stalls', async () => {
      const child = createFakeChild();
      const warningSpy = jest.spyOn(logger, 'warning').mockResolvedValue();
      const onEvent = jest.fn((event) => event.eventType === 'turn.completed'
        ? new Promise(() => {})
        : Promise.resolve());
      spawn.mockReturnValue(child);
      const runner = new CodexLocalRunner({
        binaryPath: 'codex-test',
        timeoutMs: 60000,
        additionalMessageTimeoutMs: 1000,
        completionExitGraceMs: 10,
      });
      const input = createRunInput({ onEvent });
      const { resultPromise } = await startAppServerTurn(runner, child, input);

      notify(child, 'turn/completed', {
        threadId: 'thread-123',
        turn: { id: 'codex-turn-123', status: 'completed', items: [] },
      });

      await expect(resultPromise).resolves.toEqual(expect.objectContaining({ status: 'succeeded' }));
      expect(warningSpy).toHaveBeenCalledWith(
        'Codex event stream did not drain after turn.completed; finalizing from the terminal event',
        expect.objectContaining({
          category: 'codex_tool',
          metadata: expect.objectContaining({
            turnId: 'turn-lifecycle',
            pendingStreamTaskCount: 1,
          }),
        })
      );
    });
  });
});
