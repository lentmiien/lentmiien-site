const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
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
test.each(['audio', 'video'])('validates synthetic %s and always removes query staging', async kind => {
  const name = path.join(root, kind === 'audio' ? 'test.wav' : 'test.mp4');
  const args = kind === 'audio' ? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-ac', '1', '-ar', '16000'] : ['-f', 'lavfi', '-i', 'color=red:s=32x32:r=4:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'];
  execFileSync('ffmpeg', ['-v', 'error', ...args, name]);
  const content = await fs.readFile(name);
  await expect(files.validate(upload(content, path.basename(name), kind === 'audio' ? 'audio/wav' : 'video/mp4'), kind)).resolves.toEqual(expect.objectContaining({ bytes: content.length }));
  expect(await fs.readdir(path.join(root, 'staging'))).toEqual([]);
  await expect(files.validate(upload(content.subarray(0, 20), path.basename(name), kind === 'audio' ? 'audio/wav' : 'video/mp4'), kind)).rejects.toThrow();
  expect(await fs.readdir(path.join(root, 'staging'))).toEqual([]);
});
test('decoded duration overrun is rejected and staging removed', async () => {
  const name = path.join(root, 'long.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '10.1', name]);
  await expect(files.validate(upload(await fs.readFile(name), 'long.wav', 'audio/wav'), 'audio')).rejects.toThrow('10s');
  expect(await fs.readdir(path.join(root, 'staging'))).toEqual([]);
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
  const alias = path.join(root, 'alias'); await fs.symlink(root, alias);
  await expect(new Files(alias).init()).rejects.toThrow('Symlink');
  await expect(new Files(path.join(alias, 'must-not-create')).init()).rejects.toThrow('Symlink');
  await expect(fs.stat(path.join(root, 'must-not-create'))).rejects.toHaveProperty('code', 'ENOENT');
});
test('animated WebP is rejected rather than embedding only the first frame', async () => {
  const name = path.join(root, 'animated.webp');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=8x8:rate=2:duration=1', '-c:v', 'libwebp_anim', '-loop', '0', name]);
  await expect(files.validate(upload(await fs.readFile(name), 'animated.webp', 'image/webp'), 'image')).rejects.toThrow('animated');
});
