jest.mock('sharp', () => jest.fn());
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const { win32 } = require('path');
const platform = Object.getOwnPropertyDescriptor(process, 'platform');
const env = { ...process.env };
afterEach(() => { jest.restoreAllMocks(); jest.dontMock('path'); Object.defineProperty(process, 'platform', platform); process.env = { ...env }; });
test('Windows default is preprovisioned private ProgramData; ADS, UNC and ambiguous paths fail closed', () => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  jest.doMock('path', () => win32);
  let storage; jest.isolateModules(() => { storage = require('../../services/localAi/inputStorage'); });
  delete process.env.LOCAL_AI_INPUT_DATA_DIR;
  expect(storage.storageRoot()).toBe('C:\\ProgramData\\LennartWebLocalAI\\inputs');
  for (const value of ['C:\\ProgramData\\inputs:stream', '\\\\host\\share', 'C:relative', 'C:\\unsafe.\\inputs', 'C:\\unsafe \\inputs']) {
    process.env.LOCAL_AI_INPUT_DATA_DIR = value; expect(() => storage.storageRoot()).toThrow('input_storage_config');
  }
});
test('native Windows ACL denial fails closed; successful inspection uses an argument array without a shell', async () => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  const exec = jest.spyOn(require('child_process'), 'execFile').mockImplementation((_program, _args, _options, callback) => callback(new Error('denied')));
  const { assertTrustedStorage } = require('../../services/gptImageStorageService');
  await expect(assertTrustedStorage('C:\\ProgramData\\LennartWebLocalAI')).rejects.toMatchObject({ code: 'GPT_IMAGE_STORAGE_PERMISSIONS' });
  exec.mockImplementation((_program, _args, _options, callback) => callback(null, '', ''));
  await expect(assertTrustedStorage('C:\\ProgramData\\LennartWebLocalAI')).resolves.toBeUndefined();
  expect(exec).toHaveBeenLastCalledWith(expect.stringContaining('powershell.exe'), expect.arrayContaining(['-StoragePath', 'C:\\ProgramData\\LennartWebLocalAI']),
    expect.objectContaining({ windowsHide: true, timeout: 10000, maxBuffer: 1024 }), expect.any(Function));
});
test('registered output root uses the same fail-closed Windows path and ACL boundary', () => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' }); jest.doMock('path', () => win32);
  let storage; jest.isolateModules(() => { storage = require('../../services/localAi/outputs'); });
  delete process.env.LOCAL_AI_OUTPUT_DATA_DIR;
  expect(storage.root()).toBe('C:\\ProgramData\\LennartWebLocalAI\\outputs');
  for (const value of ['C:\\ProgramData\\outputs:stream', '\\\\host\\share', 'C:relative', 'C:\\unsafe.\\outputs']) {
    process.env.LOCAL_AI_OUTPUT_DATA_DIR = value; expect(() => storage.root()).toThrow('output_storage_config');
  }
});
