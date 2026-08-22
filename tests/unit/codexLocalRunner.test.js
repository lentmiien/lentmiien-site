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
  child.stdin = { end: jest.fn() };
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = jest.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

async function waitForSpawn() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (spawn.mock.calls.length > 0) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('Codex runner did not spawn its child process.');
}

function createRunInput(onEvent) {
  return {
    turn: {
      _id: 'turn-lifecycle',
      kind: 'question',
      prompt: 'Answer the question.',
      permissionMode: 'read-only',
    },
    session: {},
    workspace: { rootPath: '/workspace/project' },
    onEvent,
  };
}

describe('CodexLocalRunner', () => {
  test('builds a new-session exec command that reads prompt from stdin', () => {
    const runner = new CodexLocalRunner({
      binaryPath: 'codex-test',
      timeoutMs: 60000,
    });

    const command = runner.buildCommand({
      turn: {
        _id: 'turn-1',
        kind: 'action',
        model: '',
        profile: '',
        permissionMode: 'workspace-write',
      },
      session: {},
      workspace: { rootPath: '/workspace/project' },
    });

    expect(command.binary).toBe('codex-test');
    expect(command.args).toEqual(expect.arrayContaining([
      'exec',
      '--json',
      '--cd',
      '/workspace/project',
      '--sandbox',
      'workspace-write',
      '-',
    ]));
    expect(command.args[command.args.length - 1]).toBe('-');
    expect(command.commandSummary.resume).toBe(false);
  });

  test('builds a follow-up resume command with the stored Codex session id', () => {
    const runner = new CodexLocalRunner({
      binaryPath: 'codex-test',
      timeoutMs: 60000,
    });

    const command = runner.buildCommand({
      turn: {
        _id: 'turn-2',
        kind: 'followup_question',
        model: 'gpt-5',
        profile: 'local',
        permissionMode: 'read-only',
      },
      session: { codexThreadId: 'codex-session-123' },
      workspace: { rootPath: '/workspace/project' },
    });

    expect(command.args).toEqual(expect.arrayContaining([
      '-m',
      'gpt-5',
      '-p',
      'local',
      'resume',
      'codex-session-123',
      '-',
    ]));
    expect(command.commandSummary.resume).toBe(true);
  });

  test('adds the Ollama OSS flags for a local-model turn', () => {
    const runner = new CodexLocalRunner({
      binaryPath: 'codex-test',
      timeoutMs: 60000,
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
      '--oss',
      '-p',
      'ollama',
      '-m',
      'qwen3.6:27b',
    ]));
    expect(command.commandSummary).toEqual(expect.objectContaining({
      modelProvider: 'ollama',
      model: 'qwen3.6:27b',
      oss: true,
      profile: 'ollama',
    }));
  });

  test('allows the Ollama Codex profile to be configured', () => {
    const runner = new CodexLocalRunner({
      binaryPath: 'codex-test',
      timeoutMs: 60000,
      ollamaProfile: 'local-qwen',
    });

    const command = runner.buildCommand({
      turn: {
        _id: 'turn-local-profile',
        kind: 'question',
        modelProvider: 'ollama',
        model: 'qwen3.6:27b',
        permissionMode: 'read-only',
      },
      session: {},
      workspace: { rootPath: '/workspace/project' },
    });

    expect(command.args).toEqual(expect.arrayContaining([
      '--oss',
      '-p',
      'local-qwen',
    ]));
    expect(command.commandSummary.profile).toBe('local-qwen');
  });

  test('uses the dangerous bypass flag only for yolo mode', () => {
    const runner = new CodexLocalRunner({
      binaryPath: 'codex-test',
      timeoutMs: 60000,
    });

    const command = runner.buildCommand({
      turn: {
        _id: 'turn-3',
        kind: 'action',
        model: '',
        profile: '',
        permissionMode: 'yolo',
      },
      session: {},
      workspace: { rootPath: '/workspace/project' },
    });

    expect(command.args).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(command.args).not.toContain('--sandbox');
  });

  test('builds a remote SSH command for Linux targets', () => {
    const runner = new CodexLocalRunner({
      binaryPath: 'codex-test',
      timeoutMs: 60000,
    });

    const command = runner.buildCommand({
      turn: {
        _id: 'turn-4',
        kind: 'action',
        model: '',
        profile: '',
        permissionMode: 'workspace-write',
      },
      session: {},
      workspace: { rootPath: '/home/lennart/Programming/lentmiien-site' },
      target: {
        type: 'remote-ssh-linux',
        connection: {
          destination: 'lennart@192.168.0.20',
          sshBinaryPath: 'ssh-test',
          codexBinaryPath: 'codex',
          envWrapperPath: '/home/lennart/bin/codex-env',
          tempDir: '/var/tmp',
          options: ['-o', 'BatchMode=yes'],
        },
      },
    });

    expect(command.binary).toBe('ssh-test');
    expect(command.outputLocation).toBe('remote');
    expect(command.outputPath).toMatch(/^\/var\/tmp\/codex-last-message-turn-4-/);
    expect(command.args).toEqual(expect.arrayContaining([
      '-T',
      '-o',
      'BatchMode=yes',
      'lennart@192.168.0.20',
    ]));
    const remoteCommand = command.args[command.args.length - 1];
    expect(remoteCommand).toContain('/home/lennart/bin/codex-env');
    expect(remoteCommand).toContain('codex');
    expect(remoteCommand).toContain('/home/lennart/Programming/lentmiien-site');
    expect(remoteCommand).toContain('--sandbox');
    expect(remoteCommand).toContain('workspace-write');
    expect(command.commandSummary.sshDestination).toBe('lennart@192.168.0.20');
    expect(command.remoteRead.args).toContain('lennart@192.168.0.20');
  });

  test('maps remote yolo mode to the dangerous bypass flag', () => {
    const runner = new CodexLocalRunner({
      binaryPath: 'codex-test',
      timeoutMs: 60000,
    });

    const command = runner.buildCommand({
      turn: {
        _id: 'turn-5',
        kind: 'action',
        model: '',
        profile: '',
        permissionMode: 'yolo',
      },
      session: {},
      workspace: { rootPath: '/workspace/project' },
      target: {
        type: 'remote-ssh-linux',
        connection: {
          destination: 'lennart@192.168.0.20',
          codexBinaryPath: 'codex',
          envWrapperPath: '/home/lennart/bin/codex-env',
        },
      },
    });

    const remoteCommand = command.args[command.args.length - 1];
    expect(remoteCommand).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(remoteCommand).not.toContain('--sandbox');
  });

  describe('turn lifecycle', () => {
    let warningSpy;

    beforeEach(() => {
      spawn.mockReset();
      warningSpy = jest.spyOn(logger, 'warning').mockResolvedValue();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('settles successfully from turn.completed when child close never arrives', async () => {
      const child = createFakeChild();
      const usage = {
        input_tokens: 120,
        cached_input_tokens: 40,
        output_tokens: 30,
      };
      const terminalEvent = { type: 'turn.completed', usage };
      const onEvent = jest.fn().mockResolvedValue();
      spawn.mockReturnValue(child);
      const runner = new CodexLocalRunner({
        binaryPath: 'codex-test',
        timeoutMs: 60000,
        completionExitGraceMs: 10,
      });
      runner.readFinalResponse = jest.fn().mockResolvedValue('Finished response');

      const resultPromise = runner.runTurn(createRunInput(onEvent));
      await waitForSpawn();
      child.stdout.emit('data', Buffer.from(`${JSON.stringify(terminalEvent)}\n`));

      const result = await resultPromise;

      expect(result).toEqual(expect.objectContaining({
        status: 'succeeded',
        exitCode: null,
        finalResponse: 'Finished response',
        usage,
      }));
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'turn.completed',
        payload: terminalEvent,
      }));
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      expect(warningSpy).toHaveBeenCalledWith(
        'Codex process did not exit after turn.completed; finalizing from the terminal event',
        expect.objectContaining({
          category: 'codex_tool',
          metadata: expect.objectContaining({
            turnId: 'turn-lifecycle',
            completionExitGraceMs: 10,
          }),
        })
      );
    });

    test('lets turn.completed override a racing nonzero child close', async () => {
      const child = createFakeChild();
      const usage = { input_tokens: 25, output_tokens: 10 };
      spawn.mockReturnValue(child);
      const runner = new CodexLocalRunner({
        binaryPath: 'codex-test',
        timeoutMs: 60000,
        completionExitGraceMs: 1000,
      });
      runner.readFinalResponse = jest.fn().mockResolvedValue('Completed before exit');

      const resultPromise = runner.runTurn(createRunInput(jest.fn().mockResolvedValue()));
      await waitForSpawn();
      child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'turn.completed', usage })}\n`));
      child.exitCode = 1;
      child.emit('close', 1, null);

      await expect(resultPromise).resolves.toEqual(expect.objectContaining({
        status: 'succeeded',
        exitCode: 1,
        usage,
      }));
      expect(child.kill).not.toHaveBeenCalled();
      expect(warningSpy).not.toHaveBeenCalled();
    });

    test('settles when terminal event persistence never finishes', async () => {
      const child = createFakeChild();
      const usage = { input_tokens: 50, output_tokens: 20 };
      const onEvent = jest.fn(() => new Promise(() => {}));
      spawn.mockReturnValue(child);
      const runner = new CodexLocalRunner({
        binaryPath: 'codex-test',
        timeoutMs: 60000,
        completionExitGraceMs: 10,
      });
      runner.readFinalResponse = jest.fn().mockResolvedValue('Persisted final response');

      const resultPromise = runner.runTurn(createRunInput(onEvent));
      await waitForSpawn();
      child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'turn.completed', usage })}\n`));

      await expect(resultPromise).resolves.toEqual(expect.objectContaining({
        status: 'succeeded',
        finalResponse: 'Persisted final response',
        usage,
      }));
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
