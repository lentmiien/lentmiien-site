jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const storage = require('../../services/localAi/inputStorage');
const { importSchema, verifyReceipt } = require('../../services/localAi/inputs');
const { parseSubmission } = require('../../services/localAi/policy');
const { prepareGenerationContext } = require('../../utils/chat5GenerationContext');
const { Gateway, config } = require('../../services/localAi/gateway');
const id = `in_${'a'.repeat(32)}`, sha = 'b'.repeat(64);
const reference = { artifact_id: id, sha256: sha };
const settings = { contextPrompt: 'Context', maxMessages: 5 };
let root;
beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'site-input-unit-')); process.env.LOCAL_AI_INPUT_DATA_DIR = root; });
afterAll(async () => { delete process.env.LOCAL_AI_INPUT_DATA_DIR; await fs.rm(root, { recursive: true, force: true }); });
test('single-frame supported rasters retain exact bytes, full decode rejects truncated files', async () => {
  for (const format of ['png', 'jpeg', 'webp', 'gif']) {
    const bytes = await sharp({ create: { width: 12, height: 9, channels: 3, background: 'red' } }).toFormat(format).toBuffer();
    const info = await storage.validateRaster(bytes);
    expect(info).toMatchObject({ bytes: bytes.length, sha256: storage.hash(bytes), width: 12, height: 9, frames: 1, normalization: 'identity-v1' });
    const artifact = `in_${format.padEnd(32, 'a').replace(/[^a-f0-9]/g, 'b')}`;
    await storage.publish(artifact, bytes, info);
    expect(await storage.read(artifact, info)).toEqual(bytes);
    await storage.publish(artifact, bytes, info);
    const changed = Buffer.from(bytes); changed[0] ^= 1;
    await expect(storage.publish(artifact, changed, { ...info, sha256: storage.hash(changed) })).rejects.toThrow('input_integrity_failed');
    await expect(storage.validateRaster(bytes.subarray(0, bytes.length / 2))).rejects.toThrow();
  }
});
test('dimensions, animation, SVG, forged media and large buffers fail closed', async () => {
  const wide = await sharp({ create: { width: 8193, height: 1, channels: 3, background: 'red' } }).png().toBuffer();
  await expect(storage.validateRaster(wide)).rejects.toMatchObject({ code: 'image_dimensions' });
  const pixels = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: 'red' } }).png().toBuffer();
  await expect(storage.validateRaster(pixels)).rejects.toMatchObject({ code: 'image_dimensions', status: 413 });
  await expect(storage.validateRaster(Buffer.from('<svg width="1" height="1"></svg>'))).rejects.toThrow();
  await expect(storage.validateRaster(Buffer.alloc(33554433))).rejects.toMatchObject({ status: 413 });
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  // Two image descriptors in one GIF.
  const animated = Buffer.concat([gif.subarray(0, -1), gif.subarray(19, -1), Buffer.from([0x3b])]);
  await expect(storage.validateRaster(animated)).rejects.toThrow();
});
test('symlink ancestors, hardlinks and unsafe static roots are rejected', async () => {
  const link = path.join(root, 'alias'); await fs.symlink(root, link);
  process.env.LOCAL_AI_INPUT_DATA_DIR = path.join(link, 'child');
  await expect(storage.ensureStorage()).rejects.toThrow();
  process.env.LOCAL_AI_INPUT_DATA_DIR = path.resolve('public/inputs');
  await expect(storage.ensureStorage()).rejects.toThrow('input_storage_unsafe');
  process.env.LOCAL_AI_INPUT_DATA_DIR = root;
  await fs.writeFile(path.join(root, 'foreign'), 'x');
  await fs.link(path.join(root, 'foreign'), path.join(root, `${id}.blob`));
  await expect(storage.read(id, { bytes: 1, sha256: storage.hash(Buffer.from('x')) })).rejects.toThrow('input_integrity_failed');
  await expect(storage.read('../secret', {})).rejects.toThrow('invalid_artifact_id');
});
test.each(['../x.png', '/x.png', 'https://host/x.png', 'x.png:secret', 'x[output].png', 'gateway_batch_x.png', 'x%2fp.png', 'x\\y.png'])('shared import disallows %s', filename => {
  expect(importSchema.safeParse({ source: { filename, subfolder: '' }, expected_sha256: sha }).success).toBe(false);
});
test('shared imports accept an optional expected revision and require a safe relative source', () => {
  expect(importSchema.safeParse({ source: { filename: 'x.png', subfolder: 'approved/nested' }, expected_sha256: sha }).success).toBe(true);
  expect(importSchema.safeParse({ source: { filename: 'x.png', subfolder: '../other' }, expected_sha256: sha }).success).toBe(false);
  expect(importSchema.safeParse({ source: { filename: 'x.png', subfolder: '' } }).success).toBe(true);
});
test('ref schema allows image-only user messages, rejects inline payloads and assistant images', () => {
  const request = { model: 'vision', messages: [{ role: 'user', content: '', images: [reference] }], max_tokens: 1 };
  expect(parseSubmission({ type: 'llm.chat', request }).request).toEqual(request);
  for (const images of [['https://host/x'], ['base64'], [{ ...reference, path: 'x' }], []]) expect(() => parseSubmission({ type: 'llm.chat', request: { ...request, messages: [{ ...request.messages[0], images }] } })).toThrow();
  expect(() => parseSubmission({ type: 'llm.chat', request: { ...request, messages: [{ ...request.messages[0], role: 'assistant' }] } })).toThrow();
});
test('history window, hidden messages, order, image-only and fallback/member context use authorized resolver', async () => {
  const image = { _id: 'img', user_id: 'alice', contentType: 'image', content: { image: 'untrusted-filename' } };
  const selected = [{ _id: 'old', contentType: 'text', content: { text: 'old' } }, { _id: 'hidden', hideFromBot: true }, image, { _id: 'answer', user_id: 'bot', contentType: 'text', content: { text: ' answer ' } }];
  const resolveImage = jest.fn(async m => { expect(m).toBe(image); return reference; });
  const result = await prepareGenerationContext({ conversation: { members: ['alice'] }, settings: { ...settings, contextPrompt: '', maxMessages: 3 }, selected, prompt: 'last', resolveImage });
  expect(result.messages[0].content).toContain('You are talking to alice.');
  expect(result.messages.slice(1)).toEqual([{ role: 'user', content: '', images: [reference] }, { role: 'assistant', content: 'answer' }, { role: 'user', content: 'last' }]);
  expect(resolveImage).toHaveBeenCalledTimes(1);
});
test.each(['tool', 'function_call', 'function_call_output', 'reasoning', 'video'])('selected %s history never executes or silently drops', async contentType => {
  await expect(prepareGenerationContext({ conversation: {}, settings, selected: [{ contentType, content: {} }], prompt: '' })).rejects.toThrow('batch_history_contains_tools_or_media');
});
test('fixed-origin multipart transfer and input lookup do not follow supplied URLs or redirects', async () => {
  const http = { request: jest.fn(async () => ({ data: {}, headers: {} })) };
  const gateway = new Gateway({ http, getConfig: () => ({ origin: 'http://127.0.0.1:9999', client: 'site', token: 'x'.repeat(40) }) });
  await gateway.putInput(id, Buffer.from('bytes')); await gateway.inputContent(id);
  expect(http.request.mock.calls[0][0]).toMatchObject({ maxRedirects: 0, maxBodyLength: 33554432 + 65536, url: `http://127.0.0.1:9999/batch/inputs/${id}` });
  expect(http.request.mock.calls[1][0]).toMatchObject({ maxRedirects: 0, maxContentLength: 33554432, url: `http://127.0.0.1:9999/batch/inputs/${id}/content` });
  expect(() => gateway.input('https://foreign')).toThrow('invalid_artifact_id');
});
test('media is off by default and forged upload receipts are rejected', () => {
  const old = process.env.LOCAL_AI_BATCH_MEDIA_ENABLED; delete process.env.LOCAL_AI_BATCH_MEDIA_ENABLED;
  expect(config().media).toBe(false); if (old !== undefined) process.env.LOCAL_AI_BATCH_MEDIA_ENABLED = old;
  expect(() => verifyReceipt({ _id: id, descriptor: { sha256: sha } }, { artifact_id: id, schema_version: 2, request_digest: sha, sha256: 'c'.repeat(64) })).toThrow('input_receipt_mismatch');
});
