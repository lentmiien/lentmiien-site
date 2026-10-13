jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));
const { storageRoot, contains, samePath } = require('../../services/embeddingGemma2/paths');
const { Files } = require('../../services/embeddingGemma2/files');
const path = require('path');
const publicRoot = 'C:\\Projects\\lentmiien-site\\public';
const root = 'C:\\Projects\\lentmiien-site\\private_data\\embeddinggemma2_test';
test.each(['C:relative', '\\relative', '\\\\host\\share', '\\\\?\\C:\\pilot', '\\\\.\\C:\\pilot', 'C:\\pilot:stream', 'C:\\pilot\\..\\other', 'C:\\pilot\\.', 'C:\\pilot.\\data', 'C:\\pilot \\data', 'C:\\NUL.txt', 'C:\\COM1\\data', 'C:\\PROGRA~1\\pilot', 'C:\\', 'c:\\PROJECTS\\LENTMIIEN-SITE\\PUBLIC\\media', 'C:\\Projects'])('rejects unsafe Windows root %s', value => {
  expect(() => storageRoot(value, publicRoot, 'win32')).toThrow();
});
test('Windows containment respects drives, separators, case and component boundaries', () => {
  expect(storageRoot(root, publicRoot, 'win32')).toBe(root);
  expect(storageRoot('C:/Projects/lentmiien-site/private_data/embeddinggemma2_test', publicRoot, 'win32')).toBe(root);
  expect(samePath(root, root.toLowerCase(), 'win32')).toBe(true);
  expect(contains(publicRoot, 'C:\\Projects\\lentmiien-site\\publicity', 'win32')).toBe(false);
  expect(contains(publicRoot, 'D:\\Projects\\lentmiien-site\\public', 'win32')).toBe(false);
});
function setup() {
  const name = 'a'.repeat(48); const target = path.win32.join(root, name);
  const stat = (file, big = true) => ({ dev: big ? 1n : 1, ino: big ? (file ? 3n : 2n) : (file ? 3 : 2), nlink: big ? 1n : 1, size: big ? 4n : 4, isFile: () => file, isDirectory: () => !file, isSymbolicLink: () => false });
  const handle = { stat: jest.fn(async options => stat(true, Boolean(options?.bigint))), close: jest.fn() };
  const io = { lstat: jest.fn(async value => stat(value === target)), realpath: jest.fn(async value => value.toLowerCase()), mkdir: jest.fn(), open: jest.fn(async () => handle), unlink: jest.fn() };
  return { files: new Files(root, { platform: 'win32', io }), io, handle, name, target, stat };
}
test('simulated win32 opens read-only without O_NOFOLLOW and lazily creates missing directories', async () => {
  const { files, io, handle, name } = setup();
  await files.open(name); expect(io.mkdir).not.toHaveBeenCalled(); expect(io.open.mock.calls[0][1]).toBe(require('fs').constants.O_RDONLY);
  await handle.close();
  io.lstat.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  await expect(files.init()).resolves.toBeUndefined(); expect(io.mkdir).toHaveBeenCalledTimes(1);
});
test('native Windows default config needs no environment or precreated directory', () => {
  const { config } = require('../../services/embeddingGemma2/config');
  const settings = config({}, { platform: 'win32', checkout: 'C:\\Projects\\lentmiien-site' });
  expect(settings.enabled).toBe(true); expect(settings.root).toBe(root);
});
test('Windows mkdir permission failure stays local and does not change ACLs', async () => {
  const { files, io } = setup();
  io.lstat.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  io.mkdir.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
  await expect(files.init()).rejects.toHaveProperty('code', 'EACCES');
  expect(io.open).not.toHaveBeenCalled();
});
test.each(['C:\\other', '\\\\host\\share', 'a'.repeat(48) + ':stream', '../' + 'a'.repeat(48), 'A'.repeat(48), 'NUL'])('asset references cannot introduce Windows paths: %s', name => {
  expect(() => setup().files.resolve(name)).toThrow();
});
test('simulated junction ancestor and realpath redirection fail closed', async () => {
  const { files, io, stat } = setup();
  io.lstat.mockResolvedValueOnce({ ...stat(false), isSymbolicLink: () => true });
  await expect(files.init()).rejects.toThrow('Symlink');
  io.realpath.mockResolvedValueOnce('D:\\redirected'); await expect(files.init()).rejects.toThrow('Symlink');
  expect(io.open).not.toHaveBeenCalled();
});
test('handle replacement, root replacement and hardlinks fail closed on simulated win32', async () => {
  const { files, io, handle, name, stat } = setup();
  handle.stat.mockResolvedValueOnce({ ...stat(true), ino: 99n });
  await expect(files.open(name)).rejects.toThrow('changed'); expect(handle.close).toHaveBeenCalled();
  io.lstat.mockImplementation(async value => ({ ...stat(value.endsWith(name)), ino: 999n }));
  await expect(files.init()).rejects.toThrow('replaced');
  const next = setup(); next.io.lstat.mockImplementation(async value => ({ ...stat(value === next.target), nlink: 2n }));
  await expect(next.files.open(next.name)).rejects.toThrow('Unsafe'); expect(next.io.open).not.toHaveBeenCalled();
});
test('Windows sharing violation leaves file intact for delete reconciliation', async () => {
  const { files, io, name } = setup(); io.unlink.mockRejectedValue(Object.assign(new Error('sharing'), { code: 'EPERM' }));
  await expect(files.remove(name)).rejects.toHaveProperty('code', 'EPERM');
  expect(io.unlink).toHaveBeenCalledTimes(1);
});
