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
});
