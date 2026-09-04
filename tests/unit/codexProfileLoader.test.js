const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CodexProfileLoadError,
  DEFAULT_MAX_PROFILE_BYTES,
  buildRemoteProfileReadCommand,
  loadCodexProfile,
  localProfilePath,
  parseCodexProfile,
} = require('../../services/codexProfileLoader');

describe('codexProfileLoader', () => {
  let tempDirectory;

  beforeEach(async () => {
    tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-profile-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tempDirectory, { recursive: true, force: true });
  });

  test('parses a profile-v2 TOML file into App Server thread config', () => {
    const config = parseCodexProfile(`
oss_provider = "local_ollama"
model_catalog_json = "/home/test/.codex/ollama-models.json"

[model_providers.local_ollama]
name = "Local Ollama"
base_url = "http://127.0.0.1:11434/v1"
wire_api = "responses"
stream_idle_timeout_ms = 900000
stream_max_retries = 5
`, 'ollama');

    expect(config).toEqual({
      oss_provider: 'local_ollama',
      model_catalog_json: '/home/test/.codex/ollama-models.json',
      model_providers: {
        local_ollama: {
          name: 'Local Ollama',
          base_url: 'http://127.0.0.1:11434/v1',
          wire_api: 'responses',
          stream_idle_timeout_ms: 900000,
          stream_max_retries: 5,
        },
      },
    });
  });

  test('loads a bounded profile from the configured local Codex home', async () => {
    await fs.promises.writeFile(
      path.join(tempDirectory, 'fast.config.toml'),
      'model = "gpt-5.6-luna"\nmodel_reasoning_effort = "low"\n',
      'utf8'
    );

    await expect(loadCodexProfile('fast', { type: 'local-windows' }, {
      codexHome: tempDirectory,
    })).resolves.toEqual({
      model: 'gpt-5.6-luna',
      model_reasoning_effort: 'low',
    });
    expect(localProfilePath('fast', tempDirectory))
      .toBe(path.join(tempDirectory, 'fast.config.toml'));
  });

  test('uses the remote Codex environment wrapper to read the target profile', async () => {
    const target = {
      type: 'remote-ssh-linux',
      connection: {
        destination: 'worker@example.test',
        sshBinaryPath: 'ssh-test',
        codexBinaryPath: 'codex',
        envWrapperPath: '/home/test/bin/codex-env',
        options: ['-o', 'BatchMode=yes'],
      },
    };
    const executeFile = jest.fn().mockResolvedValue({
      stdout: 'model_provider = "runpod_qwen"\n',
    });

    await expect(loadCodexProfile('lentmiien-qwen', target, { executeFile }))
      .resolves.toEqual({ model_provider: 'runpod_qwen' });
    expect(executeFile).toHaveBeenCalledWith(
      'ssh-test',
      expect.arrayContaining(['-T', '-o', 'BatchMode=yes', 'worker@example.test']),
      expect.objectContaining({
        maxBuffer: DEFAULT_MAX_PROFILE_BYTES + 1,
        timeout: expect.any(Number),
      })
    );
    const remoteCommand = executeFile.mock.calls[0][1].at(-1);
    expect(remoteCommand).toContain('/home/test/bin/codex-env');
    expect(remoteCommand).toContain('lentmiien-qwen.config.toml');
    expect(remoteCommand).not.toContain('model_provider');
  });

  test('rejects traversal, malformed TOML, oversized files, and private remote errors', async () => {
    expect(() => buildRemoteProfileReadCommand('../ollama', {
      type: 'remote-ssh-linux',
      connection: { destination: 'worker@example.test' },
    })).toThrow(expect.objectContaining({ code: 'CODEX_PROFILE_INVALID_NAME' }));
    expect(() => parseCodexProfile('model = [', 'ollama'))
      .toThrow(expect.objectContaining({ code: 'CODEX_PROFILE_INVALID' }));
    expect(() => parseCodexProfile(Buffer.alloc(2048), 'ollama', 1024))
      .toThrow(expect.objectContaining({ code: 'CODEX_PROFILE_TOO_LARGE' }));

    const executeFile = jest.fn().mockRejectedValue(new Error('private remote diagnostic'));
    const failure = await loadCodexProfile('ollama', {
      type: 'remote-ssh-linux',
      connection: { destination: 'worker@example.test' },
    }, { executeFile }).catch((error) => error);
    expect(failure).toBeInstanceOf(CodexProfileLoadError);
    expect(failure.code).toBe('CODEX_PROFILE_READ_FAILED');
    expect(failure.message).not.toContain('private remote diagnostic');
  });
});
