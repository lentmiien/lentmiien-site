const fs = require('fs/promises');
const os = require('os');
const path = require('path');
jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));
const { wav } = require('../../scripts/embeddinggemma2-fixtures');
const { signature } = require('../../services/embeddingGemma2/files');
const sharp = require('sharp');
const { Files } = require('../../services/embeddingGemma2/files');
let root; let files;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'eg2-test-')); files = new Files(root); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const upload = (buffer, originalname, mimetype) => ({ buffer, originalname, mimetype });
test('validates original synthetic PNG and rejects format, MIME, animation and pixel overflows', async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).png().toBuffer();
  expect(await files.validate(upload(png, 'red.png', 'image/png'), 'image')).toEqual({ filename: 'red.png', mime: 'image/png', bytes: png.length });
  await expect(files.validate(upload(png, 'red.png', 'application/octet-stream'), 'image')).resolves.toEqual(expect.objectContaining({ mime: 'image/png' }));
  await expect(files.validate(upload(png, 'evil.svg', 'image/svg+xml'), 'image')).rejects.toThrow();
  await expect(files.validate(upload(Buffer.from('<svg onload="alert(1)"/>'), 'evil.png', 'image/png'), 'image')).rejects.toThrow();
  const large = await sharp({ create: { width: 4097, height: 1, channels: 3, background: 'red' } }).png().toBuffer();
  await expect(files.validate(upload(large, 'wide.png', 'image/png'), 'image')).rejects.toThrow('limits');
  await expect(files.validate(upload(Buffer.alloc(8388609), 'huge.png', 'image/png'), 'image')).rejects.toThrow('8 MiB');
});
test('audio signature validation does not pretend to decode duration or write query staging', async () => {
  for (const seconds of [1, 10.1]) {
    const content = wav(seconds);
    await expect(files.validate(upload(content, 'tone.wav', 'audio/wav'), 'audio')).resolves.toEqual(expect.objectContaining({ bytes: content.length }));
  }
  expect(await fs.readdir(root)).toEqual([]);
  await expect(files.validate(upload(wav().subarray(0, 20), 'bad.wav', 'audio/wav'), 'audio')).rejects.toThrow();
});
test('identifies bounded MP4 and EBML brands and rejects mismatches and inconclusive signatures', async () => {
  const mp4 = Buffer.from('000000186674797069736f6d0000000069736f6d6d703432000000086d6f6f76000000096d64617400', 'hex');
  await expect(files.validate(upload(mp4, 'clip.mp4', 'video/mp4'), 'video')).resolves.toEqual(expect.objectContaining({ mime: 'video/mp4' }));
  await expect(files.validate(upload(mp4, 'clip.mov', 'video/quicktime'), 'video')).rejects.toThrow();
  const webm = Buffer.from('1a45dfa3874282847765626d', 'hex');
  expect(signature(webm)).toBe('webm');
  await expect(files.validate(upload(webm, 'clip.mkv', 'video/x-matroska'), 'video')).rejects.toThrow();
  for (const buffer of [Buffer.from('ID3invalidmetadata'), Buffer.from('fff150800000000000000000', 'hex'), Buffer.from('1a45dfa38000000000000000', 'hex'), Buffer.from('00000018667479706865696300000000686569636d696631', 'hex'), Buffer.from('OggSinvalid media')]) expect(() => signature(buffer)).toThrow();
  expect(await fs.readdir(root)).toEqual([]);
});
test('opaque files, traversal and symlink protections apply to read/write/delete', async () => {
  const name = files.name(); await files.write(name, Buffer.from('fixture'));
  const { handle } = await files.open(name); expect((await handle.readFile()).toString()).toBe('fixture'); await handle.close();
  for (const bad of ['../other', '/tmp/other', '%2e%2e', 'a'.repeat(49)]) {
    await expect(files.open(bad)).rejects.toThrow(); await expect(files.remove(bad)).rejects.toThrow();
  }
  await files.remove(name);
  const outside = path.join(root, 'outside'); await fs.writeFile(outside, 'keep');
  await fs.symlink(outside, files.resolve(name));
  await expect(files.open(name)).rejects.toThrow(); await expect(files.remove(name)).rejects.toThrow();
  expect(await fs.readFile(outside, 'utf8')).toBe('keep');
  await expect(files.write(name, Buffer.from('replace'))).rejects.toThrow();
  const alias = path.join(root, 'alias'); await fs.symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(new Files(alias).init()).rejects.toThrow('Symlink');
  await expect(new Files(path.join(alias, 'must-not-create')).init()).rejects.toThrow('Symlink');
  await expect(fs.stat(path.join(root, 'must-not-create'))).rejects.toHaveProperty('code', 'ENOENT');
});
test('animated WebP is rejected rather than embedding only the first frame', async () => {
  const pixels = Buffer.concat([Buffer.alloc(8 * 8 * 3, 0), Buffer.alloc(8 * 8 * 3, 255)]);
  const content = await sharp(pixels, { raw: { width: 8, height: 16, channels: 3, pageHeight: 8 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  await expect(files.validate(upload(content, 'animated.webp', 'image/webp'), 'image')).rejects.toThrow('animated');
});
test('hardlinks, nonregular files and bounded writes are rejected', async () => {
  const name = files.name(); const second = files.name();
  await files.write(name, Buffer.from('test')); await fs.link(files.resolve(name), files.resolve(second));
  await expect(files.open(name)).rejects.toThrow(); await expect(files.remove(second)).rejects.toThrow();
  const directory = files.name(); await fs.mkdir(files.resolve(directory));
  await expect(files.open(directory)).rejects.toThrow(); await expect(files.remove(directory)).rejects.toThrow();
  await expect(files.write(files.name(), Buffer.alloc(8388609))).rejects.toThrow('size');
  await expect(files.write(files.name(), Buffer.alloc(0))).rejects.toThrow('size');
});
test.each(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP'])('simulated unsupported O_NOFOLLOW %s retries read-only without that flag', async code => {
  // POSIX flag handling simulation works on Windows too; real verified fallback/races below.
  const handle = { close: jest.fn() };
  const io = { open: jest.fn().mockRejectedValueOnce(Object.assign(new Error('unsupported'), { code })).mockResolvedValue(handle) };
  const fallback = new Files('/pilot', { platform: 'linux', io, flags: { O_NOFOLLOW: 0x20000, O_RDONLY: 0 } });
  expect(await fallback.openHandle('/pilot/asset', 0)).toBe(handle);
  expect(io.open).toHaveBeenCalledTimes(2); expect(io.open.mock.calls[0][1]).toBe(0x20000); expect(io.open.mock.calls[1][1]).toBe(0);
});
test('missing O_NOFOLLOW uses verified read-only handles; permission errors never fallback', async () => {
  const name = files.name(); await files.write(name, Buffer.from('test'));
  const io = { ...fs, open: jest.fn((...args) => fs.open(...args)) };
  const fallback = new Files(root, { io, flags: { ...require('fs').constants, O_NOFOLLOW: undefined } });
  const { handle } = await fallback.open(name); await handle.close(); expect(io.open.mock.calls[0][1]).toBe(0);
  io.open.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
  await expect(fallback.open(name)).rejects.toHaveProperty('code', 'EACCES'); expect(io.open).toHaveBeenCalledTimes(2);
});
test('replacement between lstat and open is detected and opened handle closed', async () => {
  const name = files.name(); await files.write(name, Buffer.from('original'));
  let opened;
  const io = { ...fs, open: async (...args) => {
    await fs.rename(files.resolve(name), path.join(root, 'old'));
    await fs.writeFile(files.resolve(name), 'replaced');
    opened = await fs.open(...args); jest.spyOn(opened, 'close'); return opened;
  } };
  await expect(new Files(root, { io }).open(name)).rejects.toThrow('changed'); expect(opened.close).toHaveBeenCalled();
});
test('failed writes close handles and leave bounded intent assets for service rollback', async () => {
  const name = files.name(); let opened;
  const io = { ...fs, open: async (...args) => {
    opened = await fs.open(...args); jest.spyOn(opened, 'close');
    jest.spyOn(opened, 'writeFile').mockRejectedValue(Object.assign(new Error('full'), { code: 'ENOSPC' })); return opened;
  } };
  await expect(new Files(root, { io }).write(name, Buffer.from('test'))).rejects.toHaveProperty('code', 'ENOSPC');
  expect(opened.close).toHaveBeenCalled(); await files.remove(name);
});
test('recovery never creates staging, rejects unsafe entries and bounds cleanup', async () => {
  await files.clearStaging(); expect(await fs.readdir(root)).toEqual([]);
  await fs.mkdir(path.join(root, 'staging'));
  const staging = new Files(path.join(root, 'staging')); await staging.write(staging.name(), Buffer.from('query'));
  await files.clearStaging(); expect(await fs.readdir(staging.root)).toEqual([]);
  await fs.writeFile(path.join(staging.root, 'unexpected'), 'keep');
  await expect(files.clearStaging()).rejects.toThrow('Unexpected');
  await fs.unlink(path.join(staging.root, 'unexpected'));
  for (let i = 0; i < 9; i++) await staging.write(staging.name(), Buffer.from('query'));
  await expect(files.clearStaging()).rejects.toThrow('bounded');
});

test('BMFF external references and reference movies cannot reach Gateway or original playback', async () => {
  const box = (type, content) => { const b = Buffer.alloc(8); b.writeUInt32BE(8 + content.length); b.write(type, 4); return Buffer.concat([b, content]); };
  const ftyp = Buffer.from('000000186674797069736f6d0000000069736f6d6d703432', 'hex');
  const dref = flags => box('dref', Buffer.concat([Buffer.from('0000000000000001', 'hex'), box('url ', Buffer.from([0, 0, 0, flags]))]));
  const movie = content => Buffer.concat([ftyp, box('moov', box('trak', box('mdia', box('minf', box('dinf', content))))), box('mdat', Buffer.from([0]))]);
  await expect(files.validate(upload(movie(dref(1)), 'safe.mp4', 'video/mp4'), 'video')).resolves.toBeDefined();
  for (const content of [dref(0), box('rmra', Buffer.alloc(0))]) await expect(files.validate(upload(movie(content), 'unsafe.mp4', 'video/mp4'), 'video')).rejects.toThrow('External');
});
test('missing no-follow support still rejects a symlink swapped during open', async () => {
  const name = files.name(); await files.write(name, Buffer.from('original'));
  const outside = path.join(root, 'outside'); await fs.writeFile(outside, 'outside'); let opened;
  const io = { ...fs, open: async (...args) => {
    await fs.unlink(files.resolve(name)); await fs.symlink(outside, files.resolve(name));
    opened = await fs.open(...args); jest.spyOn(opened, 'close'); return opened;
  } };
  const fallback = new Files(root, { io, flags: { ...require('fs').constants, O_NOFOLLOW: undefined } });
  await expect(fallback.open(name)).rejects.toThrow('Unsafe'); expect(opened.close).toHaveBeenCalled();
  expect(await fs.readFile(outside, 'utf8')).toBe('outside');
});
test('fixture generator creates only synthetic files and refuses overwrite', async () => {
  const { generate } = require('../../scripts/embeddinggemma2-fixtures');
  const directory = path.join(root, 'fixtures'); await generate(directory);
  expect((await fs.readdir(directory)).sort()).toEqual(['red-square.png', 'red-square.txt', 'tone.wav', 'too-long.wav']);
  await expect(generate(directory)).rejects.toHaveProperty('code', 'EEXIST');
  for (const [name, mime, kind] of [['red-square.png', 'image/png', 'image'], ['tone.wav', 'audio/wav', 'audio']]) {
    const bytes = await fs.readFile(path.join(directory, name)); expect(bytes.length).toBeLessThan(8388608);
    await expect(files.validate(upload(bytes, name, mime), kind)).resolves.toBeDefined();
  }
});
