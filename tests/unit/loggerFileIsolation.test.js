jest.mock('fs', () => ({ promises: { mkdir: jest.fn(), appendFile: jest.fn() } }));
jest.mock('child_process', () => ({ execFileSync: jest.fn() }));

describe('application log sink and process attribution', () => {
  const originalEnvironment = process.env.NODE_ENV;
  const originalWorker = process.env.JEST_WORKER_ID;

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    require('fs').promises.mkdir.mockResolvedValue();
    require('fs').promises.appendFile.mockResolvedValue();
    require('child_process').execFileSync.mockReturnValue('a'.repeat(40) + '\n');
  });

  afterEach(() => {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
    if (originalWorker === undefined) delete process.env.JEST_WORKER_ID;
    else process.env.JEST_WORKER_ID = originalWorker;
    jest.restoreAllMocks();
  });

  test.each(['test', 'production'])('Jest never creates or appends production logs with NODE_ENV=%s', async (environment) => {
    process.env.NODE_ENV = environment;
    process.env.JEST_WORKER_ID = '1';
    await require('../../utils/logger').warning('Synthetic failure', { category: 'test' });
    expect(console.warn).toHaveBeenCalled();
    expect(require('fs').promises.mkdir).not.toHaveBeenCalled();
    expect(require('fs').promises.appendFile).not.toHaveBeenCalled();
    expect(require('child_process').execFileSync).not.toHaveBeenCalled();
  });

  test('NODE_ENV=test also isolates subprocesses without a Jest worker ID', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.JEST_WORKER_ID;
    await require('../../utils/logger').warning('Synthetic subprocess failure');
    expect(require('fs').promises.appendFile).not.toHaveBeenCalled();
  });

  test('production entries retain the file sink and bounded process/revision attribution', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JEST_WORKER_ID;
    const logger = require('../../utils/logger');
    await logger.warning('Synthetic production failure', { metadata: { password: 'synthetic-secret' } });
    await logger.notice('Second synthetic entry');
    const calls = require('fs').promises.appendFile.mock.calls;
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0][1])).toMatchObject({
      runtime: { pid: process.pid, startedAt: expect.any(String), environment: 'production', revision: 'a'.repeat(40) },
      metadata: { password: '[redacted secret]' },
    });
    expect(calls[0][0]).toMatch(/app-\d{4}-\d{2}-\d{2}\.log$/);
    expect(require('child_process').execFileSync).toHaveBeenCalledTimes(1);
  });
});
