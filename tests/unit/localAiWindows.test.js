jest.mock('fs/promises', () => ({ mkdir: jest.fn(), open: jest.fn(), rename: jest.fn(), unlink: jest.fn(), readFile: jest.fn() }));
jest.mock('sharp', () => jest.fn(() => ({ metadata: async () => ({ format: 'png', width: 256, height: 256 }), raw: () => ({ toBuffer: async () => Buffer.alloc(1) }) })));
const fs = require('fs/promises');
const crypto = require('crypto');
const os = require('os');
const { win32 } = require('path');
const { ownerIdentity, previousCoordinatorTerminated } = require('../../services/localAi/coordinator');
const { errorDiagnostic } = require('../../services/localAi/diagnostics');
describe('Windows Local AI platform behavior (no real Windows filesystem)', () => {
  const env = process.env.LOCAL_AI_BATCH_DATA_DIR;
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    process.env.LOCAL_AI_BATCH_DATA_DIR = 'C:\\ProgramData\\LennartWebLocalAI';
    jest.doMock('path', () => win32);
  });
  afterEach(() => {
    jest.restoreAllMocks(); jest.dontMock('path');
    Object.defineProperty(process, 'platform', platform);
    if (env === undefined) delete process.env.LOCAL_AI_BATCH_DATA_DIR; else process.env.LOCAL_AI_BATCH_DATA_DIR = env;
  });
  test('uses Windows paths, flushes file before rename, never opens a directory for fsync', async () => {
    let artifacts; jest.isolateModules(() => { artifacts = require('../../services/localAi/artifacts'); });
    const handle = { writeFile: jest.fn(), sync: jest.fn(), close: jest.fn() };
    fs.open.mockResolvedValue(handle); fs.unlink.mockResolvedValue();
    const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const operation = { id: 'synthetic-image', result: { artifact: { bytes: bytes.length, sha256, media_type: 'image/png' } } };
    const gateway = { output: async () => ({ data: bytes, headers: { 'content-type': 'image/png' } }) };
    const result = await artifacts.importImage(gateway, { request: { prompt: { 5: { inputs: { width: 256, height: 256 } } } } }, operation);
    expect(result.artifactId).toBe('synthetic-image');
    expect(artifacts.filePath(operation.id)).toBe('C:\\ProgramData\\LennartWebLocalAI\\synthetic-image.png');
    expect(fs.open).toHaveBeenCalledTimes(1);
    expect(fs.open).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), 'wx', 0o600);
    expect(handle.sync.mock.invocationCallOrder[0]).toBeLessThan(fs.rename.mock.invocationCallOrder[0]);
    expect(handle.close.mock.invocationCallOrder[0]).toBeLessThan(fs.rename.mock.invocationCallOrder[0]);
  });
  test('Windows coordinator identity avoids /proc; permission failure cannot prove termination', async () => {
    expect(await ownerIdentity()).toEqual({ ownerHost: os.hostname(), ownerPid: process.pid, ownerProcessStart: null });
    expect(fs.readFile).not.toHaveBeenCalled();
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); });
    const control = { holder: 'old', ownerHost: os.hostname(), ownerPid: 123 };
    expect(await previousCoordinatorTerminated(control)).toBe(false);
    kill.mockImplementation(() => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); });
    expect(await previousCoordinatorTerminated(control)).toBe(true);
    expect(errorDiagnostic(Object.assign(new Error('private path'), { code: 'EPERM', syscall: 'open' }), 'artifact.open'))
      .toEqual({ operation: 'artifact.open', reasonClass: 'system_error', systemCode: 'EPERM', syscall: 'open' });
  });
});
