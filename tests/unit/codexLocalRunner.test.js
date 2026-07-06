const CodexLocalRunner = require('../../services/codexLocalRunner');

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
});
