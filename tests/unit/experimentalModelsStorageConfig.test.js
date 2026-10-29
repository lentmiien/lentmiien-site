const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const sharp = require('sharp');
jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));
const { resolveStorageRoot } = require('../../services/experimentalModels/storage');
const owner = 'a'.repeat(24);
let temp, originalRoot, originalVue;
function load(value) {
  if (value === undefined) delete process.env.EXPERIMENTAL_MODELS_STORAGE_ROOT;
  else process.env.EXPERIMENTAL_MODELS_STORAGE_ROOT = value;
  jest.resetModules(); // Simulate process initialization, including lazy static-guard imports.
  return { ...require('../../services/experimentalModels/storage'),
    ...require('../../services/experimentalModels/gateway'),
    ...require('../../services/experimentalModels/jobs'),
    guard: require('../../services/gptImageStorageService').guardStaticMedia };
}
beforeEach(async () => {
  originalRoot = process.env.EXPERIMENTAL_MODELS_STORAGE_ROOT;
  originalVue = process.env.VUE_PATH;
  delete process.env.VUE_PATH;
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'lab-config-'));
});
afterEach(async () => {
  jest.restoreAllMocks();
  if (originalRoot === undefined) delete process.env.EXPERIMENTAL_MODELS_STORAGE_ROOT;
  else process.env.EXPERIMENTAL_MODELS_STORAGE_ROOT = originalRoot;
  if (originalVue === undefined) delete process.env.VUE_PATH;
  else process.env.VUE_PATH = originalVue;
  await fs.rm(temp, { recursive: true, force: true });
});

test('unset retains the default; configured root is captured once for stores and static guards', async () => {
  expect(load().storageRoot()).toBe(path.resolve(__dirname, '../../private_data/experimental-models'));
  const root = path.join(temp, 'external');
  const module = load(root), store = new module.LabStore();
  process.env.EXPERIMENTAL_MODELS_STORAGE_ROOT = path.join(temp, 'later');
  expect(module.storageRoot()).toBe(root);
  expect(new module.LabStore().root).toBe(root);
  await store.sweep();
  expect(await fs.readdir(temp)).toEqual(['external']);
});

test.each(['', ' ', 'relative/store', ' /absolute', '/absolute ', '/bad\0path', '/bad\npath', '/bad\x7fpath', '/private/../public', '/private/./child'])('invalid POSIX setting fails closed: %j', async value => {
  expect(() => resolveStorageRoot(value, 'linux')).toThrow('configuration is invalid');
  const { LabStore } = load(value);
  const mkdir = jest.spyOn(fs, 'mkdir');
  await expect(new LabStore().sweep()).rejects.toMatchObject({ code: 'EXPERIMENTAL_MODELS_STORAGE_CONFIG' });
  expect(mkdir).not.toHaveBeenCalled();
});

test.each(['C:\\Protected\\Lab', 'c:/Protected/Lab/', '\\\\server\\share\\Lab', '//server/share/Lab', "C:\\Protected\\O'Brien $lab (1)"])(
  'accepts fully qualified Windows paths through the source platform helper: %s', value => {
    expect(resolveStorageRoot(value, 'win32')).toBe(path.win32.resolve(value));
  });
test.each(['', 'Lab', 'C:Lab', 'C:', '\\Lab', '/Lab', '\\\\server', '\\\\?\\C:\\Lab', '\\\\.\\C:\\Lab',
  'C:\\Lab:stream', 'C:\\Lab.', 'C:\\Lab \\child', 'C:\\NUL\\child', 'C:\\Lab\\..\\public', 'C:\\Lab\\.\\child', 'C:\\bad\npath'])(
  'rejects ambiguous Windows paths: %j', value => {
    expect(() => resolveStorageRoot(value, 'win32')).toThrow('configuration is invalid');
  });

test.each(['public', 'games', 'node_modules', '.'])('rejects configured static overlap: %s', async mount => {
  const { LabStore } = load(path.resolve(__dirname, '../..', mount));
  const mkdir = jest.spyOn(fs, 'mkdir');
  await expect(new LabStore().sweep()).rejects.toThrow('Unsafe lab root');
  expect(mkdir).not.toHaveBeenCalled();
});
test('rejects VUE descendants, ancestors and canonical aliases before writes', async () => {
  const root = path.join(temp, 'private'), alias = path.join(temp, 'vue');
  await fs.mkdir(root); await fs.symlink(root, alias, 'junction');
  for (const mount of [root, path.join(root, 'nested'), temp, alias]) {
    process.env.VUE_PATH = mount;
    await expect(new (load(root).LabStore)().sweep()).rejects.toThrow('Unsafe lab root');
  }
  expect(await fs.readdir(root)).toEqual([]);
});
test('rejects root/ancestor symlinks, dangling links and unsafe ownership without creating a store', async () => {
  const target = path.join(temp, 'target'), alias = path.join(temp, 'alias');
  await fs.mkdir(target); await fs.symlink(target, alias, 'junction');
  for (const root of [alias, path.join(alias, 'new')]) await expect(new (load(root).LabStore)().sweep()).rejects.toThrow();
  expect(await fs.readdir(target)).toEqual([]);
  await fs.unlink(alias); await fs.symlink(path.join(temp, 'absent'), alias);
  await expect(new (load(alias).LabStore)().sweep()).rejects.toThrow();
  const stat = fs.lstat.bind(fs);
  jest.spyOn(fs, 'lstat').mockImplementation(async value => {
    const result = await stat(value);
    if (value === target) result.mode |= 0o022;
    return result;
  });
  await expect(new (load(target).LabStore)().sweep()).rejects.toMatchObject({ code: 'GPT_IMAGE_STORAGE_PERMISSIONS' });
});

test('external store keeps ownership, quotas, restart recovery, cleanup leases and old stores separate', async () => {
  const oldRoot = path.join(temp, 'old'), root = path.join(temp, 'new');
  const old = new (load(oldRoot).LabStore)(), binding = randomUUID();
  const oldSession = await old.create(owner, binding);
  const { LabStore } = load(root), store = new LabStore();
  const s = await store.create(owner, binding);
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#000' } }).png().toBuffer();
  const asset = await store.upload(owner, binding, s.id, { buffer: png, mimetype: 'image/png', originalname: 'test.png' });
  expect(await store.list(owner, randomUUID())).toEqual([]);
  await expect(store.get('b'.repeat(24), binding, s.id)).rejects.toMatchObject({ status: 404 });
  const recovered = new LabStore();
  expect((await recovered.get(owner, binding, s.id)).assets).toHaveLength(1);
  recovered.limits = { ...recovered.limits, globalBytes: 1 };
  await expect(recovered.upload(owner, binding, s.id, { buffer: png, mimetype: 'image/png', originalname: 'test.png' })).rejects.toMatchObject({ code: 'storage_limit' });
  const download = await recovered.download(owner, binding, s.id, asset.id);
  expect(await recovered.clear(owner, binding, s.id)).toMatchObject({ deletePending: true });
  await recovered.sweep(); expect(await fs.readdir(root)).toEqual([s.id]);
  await download.handle.close(); await recovered.sweep(); expect(await fs.readdir(root)).toEqual([]);
  const next = await new LabStore().create(owner, binding);
  await new LabStore({ now: () => next.expiresAt }).sweep();
  expect(await fs.readdir(root)).toEqual([]);
  expect(await fs.readdir(oldRoot)).toEqual([oldSession.id]);
});

test('static guard denies direct and compressed aliases into the captured custom store', async () => {
  const root = path.join(temp, 'private'), publicRoot = path.join(temp, 'static');
  const { LabStore, guard } = load(root); await new LabStore().sweep(); await fs.mkdir(publicRoot);
  const file = path.join(root, 'synthetic.png'); await fs.writeFile(file, 'synthetic');
  for (const suffix of ['', '.gz', '.br']) {
    await fs.symlink(file, path.join(publicRoot, `alias${suffix}`));
    const middleware = jest.fn(), res = { status: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(), end: jest.fn() };
    await guard(publicRoot, middleware)({ path: '/alias' }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404); expect(middleware).not.toHaveBeenCalled();
    await fs.unlink(path.join(publicRoot, `alias${suffix}`));
  }
});

test('custom path is absent from raw request inspectors and invalid-config errors', async () => {
  const root = path.join(temp, 'private (special)+');
  const { LabStore, LabGateway, LabJobs } = load(root), store = new LabStore();
  const gateway = new LabGateway({ env: { MING_ADMIN_TOKEN: 'synthetic-token' } });
  const jobs = new LabJobs({ store, gateway }); jest.spyOn(jobs, 'kick').mockImplementation(() => {});
  const binding = randomUUID(), s = await store.create(owner, binding);
  const job = await jobs.submit(owner, binding, s.id, 'ming-tts', { task: 'VOICE_DESIGN', text: root, language: 'en', controls: { style: 'Calm' } }, async () => true);
  expect(job.request).not.toContain(root); expect(job.request).toContain('[private storage]');
  expect(JSON.stringify(await store.get(owner, binding, s.id))).not.toContain(root);
  const bad = load('relative-sensitive-path');
  await expect(new bad.LabStore().sweep()).rejects.toThrow('Experimental Models storage configuration is invalid.');
});

test('Windows ACL invocation uses literal argv, preserves escaping and fails closed without chmod', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const execFile = jest.spyOn(require('child_process'), 'execFile').mockImplementation((_file, _args, _options, callback) => callback(new Error('sensitive path')));
  const chmod = jest.spyOn(fs, 'chmod');
  const root = "C:\\Protected\\O'Brien $lab (1)";
  try {
    const { assertTrustedStorage } = require('../../services/gptImageStorageService');
    await expect(assertTrustedStorage(root)).rejects.toMatchObject({ code: 'GPT_IMAGE_STORAGE_PERMISSIONS', message: 'GPT Image storage is unavailable.' });
    expect(execFile.mock.calls[0][1].slice(-2)).toEqual(['-StoragePath', root]);
    expect(execFile.mock.calls[0][1]).toContain('-File'); expect(execFile.mock.calls[0][1]).not.toContain('-Command');
    expect(chmod).not.toHaveBeenCalled();
  } finally { Object.defineProperty(process, 'platform', platform); }
});

test('Windows path casing and separators cannot bypass VUE containment or inspector redaction', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  jest.doMock('path', () => path.win32);
  jest.doMock('sharp', () => sharp);
  jest.spyOn(fs, 'realpath').mockImplementation(async value => value);
  const mkdir = jest.spyOn(fs, 'mkdir');
  try {
    process.env.VUE_PATH = 'C:\\Protected\\Lab';
    const { LabStore, LabGateway } = load('c:/protected/lab/child');
    await expect(new LabStore().sweep()).rejects.toThrow('Unsafe lab root');
    expect(mkdir).not.toHaveBeenCalled();
    const gateway = new LabGateway({ env: {} });
    for (const value of ['C:\\PROTECTED\\LAB\\CHILD\\file', 'c:/protected/lab/child/file']) {
      const serialized = JSON.stringify({ raw_text: value });
      const sanitized = JSON.stringify(JSON.parse(serialized), (_key, item) => typeof item === 'string' ? gateway.sanitize(item) : item);
      expect(sanitized).toContain('[private storage]'); expect(sanitized).not.toMatch(/protected/i);
    }
  } finally { jest.dontMock('sharp'); jest.dontMock('path'); Object.defineProperty(process, 'platform', platform); jest.resetModules(); }
});

test('rejects a noncanonical existing ancestor before mkdir (including filesystem short-name aliases)', async () => {
  const root = path.join(temp, 'new'), realpath = fs.realpath.bind(fs);
  jest.spyOn(fs, 'realpath').mockImplementation(async value => value === temp ? path.join(temp, 'canonical-name') : realpath(value));
  const mkdir = jest.spyOn(fs, 'mkdir');
  await expect(new (load(root).LabStore)().sweep()).rejects.toThrow('Unsafe lab root');
  expect(mkdir).not.toHaveBeenCalled();
});

test('sanitizes custom paths in parsed raw JSON responses without exposing them in Gateway errors', async () => {
  const root = path.join(temp, 'private (special)+'), { LabGateway } = load(root);
  const output = require('../helpers/experimentalModelsFixtures').vision('ocr');
  output.raw_text = root; output.text = `File ${root}/result.json`;
  const http = { request: jest.fn().mockResolvedValue({ status: 200, data: Buffer.from(JSON.stringify(output)), headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }) };
  const gateway = new LabGateway({ http, env: {} });
  const input = { task: 'ocr', fileId: randomUUID() }, source = { asset: { width: 128, height: 128 }, bytes: Buffer.from('synthetic transport placeholder') };
  const result = await gateway.run('wevisone-vl', input, source);
  expect(result.bytes.toString()).not.toContain(root); expect(JSON.parse(result.bytes).raw_text).toBe('[private storage]');
  http.request.mockResolvedValue({ status: 503, data: Buffer.from(JSON.stringify({ detail: root })), headers: {} });
  await expect(gateway.run('wevisone-vl', input, source)).rejects.toMatchObject({ message: 'Gateway model is unavailable or unconfigured.' });
});
