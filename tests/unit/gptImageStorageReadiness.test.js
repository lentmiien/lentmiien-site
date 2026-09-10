const fs = require('fs/promises');
const path = require('path');
const os = require('os');
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const logger = require('../../utils/logger');
const storage = require('../../services/gptImageStorageService');
let root, originalRoot, originalVue;
const denied = () => Object.assign(new Error('sensitive local path must not leak'), { code: 'EACCES' });
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'gpt-image-ready-'));
  originalRoot = process.env.GPT_IMAGE_STORAGE_DIR;
  originalVue = process.env.VUE_PATH;
  process.env.GPT_IMAGE_STORAGE_DIR = root;
  delete process.env.VUE_PATH;
});
afterEach(async () => {
  jest.restoreAllMocks();
  if (originalRoot === undefined) delete process.env.GPT_IMAGE_STORAGE_DIR; else process.env.GPT_IMAGE_STORAGE_DIR = originalRoot;
  if (originalVue === undefined) delete process.env.VUE_PATH; else process.env.VUE_PATH = originalVue;
  await fs.rm(root, { recursive: true, force: true });
});
test('startup and concurrent readiness probes create private files and remove only their own probes', async () => {
  const open = jest.spyOn(fs, 'open');
  await fs.writeFile(path.join(root, '.gpt-image-probe-existing'), 'keep');
  expect(await storage.initializeStorage()).toBe(true);
  await Promise.all(Array.from({ length: 6 }, () => storage.assertStorageReady()));
  const creates = open.mock.calls.filter(args => args[2] === 0o600);
  expect(creates).toHaveLength(7);
  expect(new Set(creates.map(args => args[0])).size).toBe(7);
  expect(creates.every(args => !storage.PRIVATE_NAME.test(path.basename(args[0])))).toBe(true);
  expect(await fs.readdir(root)).toEqual(['.gpt-image-probe-existing']);
  expect(logger.error).not.toHaveBeenCalled();
});
test('missing nested storage is created and verified; omitted configuration has the app-private default', async () => {
  delete process.env.GPT_IMAGE_STORAGE_DIR;
  expect(storage.storageRoot()).toBe(path.resolve(__dirname, '../../private_data/gpt-image'));
  process.env.GPT_IMAGE_STORAGE_DIR = path.join(root, 'new', 'images');
  await storage.assertStorageReady();
  expect(await fs.readdir(process.env.GPT_IMAGE_STORAGE_DIR)).toEqual([]);
  expect((await fs.stat(process.env.GPT_IMAGE_STORAGE_DIR)).mode & 0o777).toBe(0o700);
});
test.each(['', 'relative/images', ' /absolute', '/absolute\n', '/bad\0path'])('rejects invalid configuration %j at startup without exposing its value', async value => {
  process.env.GPT_IMAGE_STORAGE_DIR = value;
  expect(await storage.initializeStorage()).toBe(false);
  expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('generation disabled'), {
    category: 'startup:gpt_image', metadata: { stage: 'path', code: 'GPT_IMAGE_STORAGE_CONFIG' },
  });
  expect(await fs.readdir(root)).toEqual([]);
});
test.each(['public', 'games', 'node_modules', '.'])('rejects static root overlap in either direction: %s', async target => {
  process.env.GPT_IMAGE_STORAGE_DIR = path.resolve(__dirname, '../..', target);
  await expect(storage.assertStorageReady()).rejects.toMatchObject({ status: 503 });
});
test('rejects VUE overlap and canonical static aliases', async () => {
  process.env.VUE_PATH = path.join(root, 'vue');
  await expect(storage.assertStorageReady()).rejects.toThrow();
  const alias = path.join(root, 'static-alias');
  const privateRoot = path.join(root, 'private');
  await fs.mkdir(privateRoot);
  await fs.symlink(privateRoot, alias);
  process.env.GPT_IMAGE_STORAGE_DIR = privateRoot;
  process.env.VUE_PATH = alias;
  await expect(storage.assertStorageReady()).rejects.toThrow();
});
test('rejects symlink ancestors before mkdir, dangling links, and a file as root', async () => {
  const target = path.join(root, 'target');
  const alias = path.join(root, 'alias');
  await fs.mkdir(target);
  await fs.symlink(target, alias);
  process.env.GPT_IMAGE_STORAGE_DIR = path.join(alias, 'new');
  await expect(storage.assertStorageReady()).rejects.toThrow();
  expect(await fs.readdir(target)).toEqual([]);
  await fs.unlink(alias);
  await fs.symlink(path.join(root, 'absent'), alias);
  process.env.GPT_IMAGE_STORAGE_DIR = alias;
  await expect(storage.assertStorageReady()).rejects.toThrow();
  await fs.unlink(alias);
  await fs.writeFile(alias, 'file');
  await expect(storage.assertStorageReady()).rejects.toThrow();
});
test.each(['root', 'ancestor', 'owner'])('rejects untrusted %s using deterministic stat metadata', async kind => {
  const lstat = fs.lstat.bind(fs);
  jest.spyOn(fs, 'lstat').mockImplementation(async target => {
    const stat = await lstat(target);
    if (target === (kind === 'ancestor' ? path.dirname(root) : root)) {
      if (kind === 'owner') stat.uid = 987654;
      else stat.mode = (stat.mode & ~0o1000) | 0o022;
    }
    return stat;
  });
  await expect(storage.assertStorageReady()).rejects.toMatchObject({ status: 503 });
  expect(await fs.readdir(root)).toEqual([]);
});
test('existing unwritable directory passes mkdir but fails the actual create probe, then can recover', async () => {
  await fs.mkdir(root, { recursive: true });
  const open = jest.spyOn(fs, 'open').mockRejectedValueOnce(denied());
  expect(await storage.initializeStorage()).toBe(false);
  expect(logger.error).toHaveBeenCalledWith(expect.any(String), {
    category: 'startup:gpt_image', metadata: { stage: 'create', code: 'EACCES' },
  });
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('sensitive');
  expect(await fs.readdir(root)).toEqual([]);
  open.mockRestore();
  await expect(storage.assertStorageReady()).resolves.toBeUndefined();
});
test.each(['writeFile', 'sync', 'readFile', 'close'])('%s failure closes and cleans the private probe', async method => {
  const open = fs.open.bind(fs);
  jest.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args);
    if ((method === 'readFile') === (args[2] === undefined)) {
      jest.spyOn(handle, method).mockRejectedValueOnce(denied());
    }
    return handle;
  });
  await expect(storage.assertStorageReady()).rejects.toMatchObject({ status: 503, message: 'GPT Image storage is unavailable.' });
  expect(await fs.readdir(root)).toEqual([]);
});
test('failed deletion remains a failed preflight even if best-effort cleanup succeeds', async () => {
  const unlink = jest.spyOn(fs, 'unlink').mockRejectedValueOnce(denied());
  await expect(storage.assertStorageReady()).rejects.toMatchObject({ status: 503 });
  expect(unlink).toHaveBeenCalledTimes(2);
  expect(await fs.readdir(root)).toEqual([]);
});
test('persistent cleanup failure logs a redacted actionable issue; probe cannot be delivered', async () => {
  const unlink = jest.spyOn(fs, 'unlink').mockRejectedValue(denied());
  await expect(storage.assertStorageReady()).rejects.toThrow();
  const [probe] = await fs.readdir(root);
  expect(storage.PRIVATE_NAME.test(probe)).toBe(false);
  await expect(storage.readPrivateImage(probe)).rejects.toThrow();
  expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('cleanup failed'), { category: 'gpt_image', metadata: { code: 'EACCES' } });
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain(root);
  unlink.mockRestore();
});
test('probe read-back mismatch fails and removes the probe', async () => {
  const open = fs.open.bind(fs);
  jest.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args);
    if (args[2] === undefined) jest.spyOn(handle, 'readFile').mockResolvedValue(Buffer.from('wrong bytes'));
    return handle;
  });
  await expect(storage.assertStorageReady()).rejects.toMatchObject({ status: 503 });
  expect(logger.error).toHaveBeenCalledWith(expect.any(String), { category: 'gpt_image', metadata: { stage: 'read', code: 'GPT_IMAGE_STORAGE_PROBE' } });
  expect(await fs.readdir(root)).toEqual([]);
});
test('an exclusive-create collision never deletes a file it did not create', async () => {
  jest.spyOn(fs, 'open').mockRejectedValue(Object.assign(new Error('collision'), { code: 'EEXIST' }));
  const unlink = jest.spyOn(fs, 'unlink');
  await expect(storage.assertStorageReady()).rejects.toThrow();
  expect(unlink).not.toHaveBeenCalled();
});
