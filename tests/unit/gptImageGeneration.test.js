const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const sharp = require('sharp');
jest.mock('../../services/toolExecutionPrincipalService', () => ({ resolveAuthorizedToolPrincipal: jest.fn(async context => context.user) }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('../../models/gpt_image_generation', () => ({ insertMany: jest.fn(), find: jest.fn(), deleteMany: jest.fn() }));
jest.mock('openai', () => {
  const client = { images: { generate: jest.fn(), edit: jest.fn() } };
  const OpenAI = jest.fn(() => client);
  OpenAI.client = client;
  OpenAI.toFile = jest.fn(async (buffer, name, options) => ({ buffer, name, options }));
  return OpenAI;
});
const OpenAI = require('openai');
const model = require('../../models/gpt_image_generation');
const storage = require('../../services/gptImageStorageService');
const service = require('../../services/gptImageService');
const models = ['gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'];
let root, png, originalRoot, originalKey;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'gpt-image-test-'));
  originalRoot = process.env.GPT_IMAGE_STORAGE_DIR;
  originalKey = process.env.OPENAI_API_KEY;
  process.env.GPT_IMAGE_STORAGE_DIR = root;
  process.env.OPENAI_API_KEY = 'synthetic-test-key';
  png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#ff000080' } }).png().toBuffer();
  const response = { data: [{ b64_json: png.toString('base64') }] };
  OpenAI.client.images.generate.mockReset().mockResolvedValue(response);
  OpenAI.client.images.edit.mockReset().mockResolvedValue(response);
  model.deleteMany.mockReturnValue({ exec: async () => ({ deletedCount: 1 }) });
  model.insertMany.mockReset().mockImplementation(async docs => docs.map((doc, i) => ({ ...doc, _id: String(i).padStart(24, 'a') })));
});
afterEach(async () => {
  if (originalRoot === undefined) delete process.env.GPT_IMAGE_STORAGE_DIR; else process.env.GPT_IMAGE_STORAGE_DIR = originalRoot;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  await fs.rm(root, { recursive: true, force: true });
  jest.restoreAllMocks();
});
test.each(models)('%s generation persists accurate metadata and only private media', async imageModel => {
  const result = await service.createImageGeneration({ rawOptions: { model: imageModel, prompt: 'Private synthetic prompt' } });
  expect(OpenAI.client.images.generate).toHaveBeenCalledWith({ model: imageModel, prompt: 'Private synthetic prompt', n: 1, quality: 'medium', size: '1024x1024', background: 'auto', output_format: 'png', moderation: 'auto', user: 'tool' });
  expect(result.images[0]).toMatchObject({ model: imageModel, outputUrl: expect.stringMatching(/^\/gpt-image\/media\//) });
  const name = result.images[0].outputFileName;
  expect(name).not.toContain('synthetic');
  expect(await storage.readPrivateImage(name)).toEqual(png);
  await expect(fs.access(path.join(__dirname, '../../public/img', name))).rejects.toThrow();
});
test.each(models)('%s edits uploaded references using bytes, with no public upload copy', async imageModel => {
  const result = await service.createImageGeneration({ rawOptions: { model: imageModel, prompt: 'Edit' }, uploadedFiles: [{ buffer: png, originalname: '../../evil.html', mimetype: 'image/png', size: png.length }] });
  expect(result.requestType).toBe('edit');
  expect(OpenAI.client.images.generate).not.toHaveBeenCalled();
  expect(OpenAI.client.images.edit).toHaveBeenCalledWith(expect.objectContaining({ model: imageModel, image: expect.objectContaining({ buffer: png, name: expect.stringMatching(/\.png$/) }) }));
  expect(OpenAI.client.images.edit.mock.calls[0][0]).not.toHaveProperty('input_fidelity');
  const input = model.insertMany.mock.calls[0][0][0].inputImages[0];
  expect(input.url).toMatch(/^\/gpt-image\/media\//);
  expect(input).not.toHaveProperty('absolutePath');
  expect(input).not.toHaveProperty('buffer');
  expect(await fs.readdir(root)).toHaveLength(2);
});
test.each(models)('%s reuses another user private gallery image', async imageModel => {
  const stored = await storage.writeImage(png);
  const id = 'b'.repeat(24);
  const doc = { _id: id, generationId: 'previous', createdBy: 'different-user', outputFileName: stored.fileName, outputUrl: stored.url };
  model.find.mockReturnValue({ select: () => ({ lean: () => ({ exec: async () => [doc] }) }) });
  const result = await service.createImageGeneration({ rawOptions: { model: imageModel, prompt: 'Reuse' }, selectedImageIds: [id] });
  expect(result.requestType).toBe('edit');
  expect(OpenAI.toFile).toHaveBeenCalledWith(png, stored.fileName, { type: 'image/png' });
  expect(model.find).toHaveBeenCalledWith({ _id: { $in: [id] } });
});
test.each(models)('%s resolves legacy URLs locally and preserves metadata', async imageModel => {
  const read = jest.spyOn(storage, 'readLibraryImage').mockResolvedValue(png);
  const id = 'c'.repeat(24);
  const doc = { _id: id, outputFileName: 'Legacy Image.PNG', outputUrl: '/img/Legacy%20Image.PNG' };
  model.find.mockReturnValue({ select: () => ({ lean: () => ({ exec: async () => [doc] }) }) });
  await service.createImageGeneration({ rawOptions: { model: imageModel, prompt: 'Legacy' }, selectedImageIds: [id] });
  expect(read).toHaveBeenCalledWith({ fileName: doc.outputFileName, url: doc.outputUrl });
  expect(model.insertMany.mock.calls[0][0][0].inputImages[0].url).toBe(doc.outputUrl);
});
test('rejects invalid uploaded bytes before provider calls and leaves no files', async () => {
  await expect(service.createImageGeneration({ rawOptions: { prompt: 'Test' }, uploadedFiles: [{ buffer: Buffer.from('<svg></svg>') }] })).rejects.toThrow();
  expect(OpenAI.client.images.edit).not.toHaveBeenCalled();
  expect(await fs.readdir(root)).toEqual([]);
});
test('provider failure cleans uploaded references and does not expose its body', async () => {
  OpenAI.client.images.edit.mockRejectedValue(new Error('sensitive provider body'));
  await expect(service.createImageGeneration({ rawOptions: { prompt: 'Test' }, uploadedFiles: [{ buffer: png }] })).rejects.toThrow('Unable to generate');
  expect(await fs.readdir(root)).toEqual([]);
});
test('database failure cleans new outputs and uploaded references', async () => {
  model.insertMany.mockRejectedValue(new Error('database unavailable'));
  await expect(service.createImageGeneration({ rawOptions: { prompt: 'Test' }, uploadedFiles: [{ buffer: png }] })).rejects.toThrow();
  expect(await fs.readdir(root)).toEqual([]);
});
test('original edit fallback is retained; new models never silently drop options', async () => {
  const error = Object.assign(new Error("Unknown parameter: 'quality'"), { status: 400 });
  OpenAI.client.images.edit.mockRejectedValueOnce(error).mockResolvedValueOnce({ data: [{ b64_json: png.toString('base64') }] });
  await service.createImageGeneration({ rawOptions: { prompt: 'Test' }, uploadedFiles: [{ buffer: png }] });
  expect(OpenAI.client.images.edit).toHaveBeenCalledTimes(2);
  expect(OpenAI.client.images.edit.mock.calls[1][0]).not.toHaveProperty('quality');
  OpenAI.client.images.edit.mockReset().mockRejectedValue(error);
  await expect(service.createImageGeneration({ rawOptions: { model: models[1], prompt: 'Test', quality: 'max' }, uploadedFiles: [{ buffer: png }] })).rejects.toThrow();
  expect(OpenAI.client.images.edit).toHaveBeenCalledTimes(1);
});
test('per-user concurrency rejects overlapping paid work and releases after failure', async () => {
  let reject;
  OpenAI.client.images.generate.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  const first = service.createImageGeneration({ rawOptions: { prompt: 'Test' }, user: { _id: 'same' } });
  const failure = expect(first).rejects.toThrow();
  await expect(service.createImageGeneration({ rawOptions: { prompt: 'Test' }, user: { _id: 'same' } })).rejects.toMatchObject({ status: 429 });
  while (!OpenAI.client.images.generate.mock.calls.length) await new Promise(resolve => setImmediate(resolve));
  reject(new Error('stop'));
  await failure;
});

test('partial database save rollback targets only this batch; failed rollback retains private files', async () => {
  model.insertMany.mockRejectedValue(new Error('partial insert'));
  model.deleteMany.mockReturnValue({ exec: async () => { throw new Error('database unavailable'); } });
  await expect(service.createImageGeneration({ rawOptions: { prompt: 'Test' } })).rejects.toThrow();
  expect(model.deleteMany).toHaveBeenCalledWith({ generationId: model.insertMany.mock.calls[0][0][0].generationId });
  expect(await fs.readdir(root)).toHaveLength(1);
});

test.each(models.flatMap(imageModel => ['jpeg', 'webp'].map(format => [imageModel, format])))('%s writes %s with matching MIME and compression metadata', async (imageModel, format) => {
  const bytes = await sharp(png).toFormat(format).toBuffer();
  OpenAI.client.images.generate.mockResolvedValue({ data: [{ b64_json: bytes.toString('base64') }], output_format: format });
  const result = await service.createImageGeneration({ rawOptions: { model: imageModel, prompt: 'Test', outputFormat: format, outputCompression: 80 } });
  expect(OpenAI.client.images.generate).toHaveBeenCalledWith(expect.objectContaining({ model: imageModel, output_format: format, output_compression: 80 }));
  expect(result.images[0].outputMimeType).toBe(`image/${format}`);
  expect(model.insertMany.mock.calls[0][0][0].outputCompression).toBe(80);
});
test('count and input bounds reject before provider execution', async () => {
  for (const options of [{ rawOptions: { prompt: 'Test', n: 11 } }, { rawOptions: { prompt: 'Test' }, uploadedFiles: Array(9).fill({ buffer: png }) }, { rawOptions: { prompt: 'Test' }, selectedImageIds: Array(17).fill('a'.repeat(24)) }]) {
    await expect(service.createImageGeneration(options)).rejects.toMatchObject({ status: 400 });
  }
  expect(OpenAI.client.images.generate).not.toHaveBeenCalled();
  expect(OpenAI.client.images.edit).not.toHaveBeenCalled();
});

test.each(['create', 'write', 'read', 'delete'])('storage %s failure prevents all provider calls, including with no references', async operation => {
  const failure = Object.assign(new Error('private path'), { code: 'EACCES' });
  if (operation === 'delete') jest.spyOn(fs, 'unlink').mockRejectedValueOnce(failure);
  else {
    const open = fs.open.bind(fs);
    jest.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (operation === 'create') throw failure;
      const handle = await open(...args);
      if (operation === 'write' && args[2] === 0o600) jest.spyOn(handle, 'writeFile').mockRejectedValueOnce(failure);
      if (operation === 'read' && args[2] === undefined) jest.spyOn(handle, 'readFile').mockRejectedValueOnce(failure);
      return handle;
    });
  }
  await expect(service.createImageGeneration({ rawOptions: { prompt: 'Test' } })).rejects.toMatchObject({ status: 503 });
  expect(OpenAI.client.images.generate).not.toHaveBeenCalled();
  expect(OpenAI.client.images.edit).not.toHaveBeenCalled();
  expect(model.insertMany).not.toHaveBeenCalled();
  expect(await fs.readdir(root)).toEqual([]);
});
test.each(['generate', 'edit'])('rechecks storage immediately before %s after an earlier successful probe', async operation => {
  const ready = storage.assertStorageReady.bind(storage);
  jest.spyOn(storage, 'assertStorageReady').mockImplementationOnce(ready).mockRejectedValueOnce(Object.assign(new Error('GPT Image storage is unavailable.'), { status: 503, expose: true }));
  await expect(service.createImageGeneration({ rawOptions: { prompt: 'Test' }, uploadedFiles: operation === 'edit' ? [{ buffer: png }] : [] })).rejects.toMatchObject({ status: 503 });
  expect(storage.assertStorageReady).toHaveBeenCalledTimes(2);
  expect(OpenAI.client.images.generate).not.toHaveBeenCalled();
  expect(OpenAI.client.images.edit).not.toHaveBeenCalled();
  expect(await fs.readdir(root)).toEqual([]);
});
test('storage is rechecked before a compatibility retry, and failure prevents the second provider call', async () => {
  const ready = storage.assertStorageReady.bind(storage);
  jest.spyOn(storage, 'assertStorageReady').mockImplementationOnce(ready).mockImplementationOnce(ready).mockRejectedValueOnce(Object.assign(new Error('GPT Image storage is unavailable.'), { status: 503, expose: true }));
  OpenAI.client.images.edit.mockRejectedValueOnce(Object.assign(new Error("Unknown parameter: 'quality'"), { status: 400 }));
  await expect(service.createImageGeneration({ rawOptions: { prompt: 'Test' }, uploadedFiles: [{ buffer: png }] })).rejects.toMatchObject({ status: 503 });
  expect(OpenAI.client.images.edit).toHaveBeenCalledTimes(1);
  expect(await fs.readdir(root)).toEqual([]);
});

describe('real tool result Markdown through shared chat and browser sanitizers', () => {
  let dom;
  const { toClientMessage } = require('../../utils/chat5Realtime');
  const { renderMarkdownSafe, isSafeRenderedImageSource, sanitizeRenderedHtml } = require('../../utils/chat5Markdown');
  const readFileSync = require('fs').readFileSync;
  const createDOMPurify = require('dompurify');
  const GptImageToolService = require('../../services/gptImageToolService');
  const tool = new GptImageToolService();
  const url = '/gpt-image/media/gpt-image-private-12345678-1234-4234-8234-123456789abc.png';
  beforeAll(async () => {
    const { JSDOM } = await import('jsdom');
    dom = new JSDOM('', { url: 'https://site.invalid/chat5', runScripts: 'outside-only' });
    dom.window.DOMPurify = createDOMPurify(dom.window);
  });
  afterAll(() => dom?.window.close());
  function clientHtml(file, html) {
    const source = readFileSync(path.join(__dirname, '../../public/js', file), 'utf8');
    const names = file === 'chat5.js' ? ['isSafeMarkdownImageSource', 'removeUnsafeMarkdownImageSources'] : ['isSafeMarkdownImageSource', 'sanitizeDisplayHtml'];
    for (const name of names) {
      const start = source.indexOf(`function ${name}(`);
      const end = source.indexOf('\n}', start) + 2;
      dom.window.eval(source.slice(start, end));
    }
    if (file === 'chat5_5.js') return dom.window.sanitizeDisplayHtml(html);
    const container = dom.window.document.createElement('div');
    container.innerHTML = dom.window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_ATTR: ['style'], FORBID_TAGS: ['embed', 'form', 'iframe', 'object', 'style'] });
    dom.window.removeUnsafeMarkdownImageSources(container);
    return container.innerHTML;
  }
  test.each(models.flatMap(modelName => ['png', 'jpeg', 'webp'].map(format => [modelName, format])))('%s tool %s result survives server and both client sanitizers', async (modelName, format) => {
    const bytes = await sharp(png).toFormat(format).toBuffer();
    OpenAI.client.images.generate.mockResolvedValue({ data: [{ b64_json: bytes.toString('base64') }], output_format: format });
    const result = await tool.execute({ prompt: 'Test', output_format: format }, { user: { _id: 'a'.repeat(24), type_user: 'user' } }, modelName);
    const html = toClientMessage({ content: { text: result.markdown } }).content.html;
    expect(html).toContain(`src="${result.images[0].url}"`);
    for (const file of ['chat5.js', 'chat5_5.js']) expect(clientHtml(file, html)).toContain(`src="${result.images[0].url}"`);
  });
  test.each([
    url + '?download=1', url + '#x', url + '/extra', url + '%3fx=1', url.replace('.png', '.svg'), url.replace('.png', '.jpeg'), url.replace('.png', '.PNG'),
    url.replace('12345678-', '12345678x'), url.replace('12345678', 'ABCDEF12'), url.replace('12345678', '%31' + '2345678'),
    '/gpt-image/api/generate', '/gpt-image/media/anything.png', '/gpt-image/media/' + '-'.repeat(36) + '.png',
    '/gpt-image/media/../media/' + url.split('/').pop(), '/gpt-image/media/%2e%2e/media/' + url.split('/').pop(),
    '/img/..' + url, '/img/%2e%2e' + url, '/gpt-image/media/%252e%252e/file.png', '/gpt-image//media/' + url.split('/').pop(),
    'https://site.invalid' + url, '//site.invalid' + url, 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=',
    url.replace('/media/', '\\media\\'), url.replace('/media/', '/me\tdia/'),
  ])('denies malicious or noncontract private source %j in actual sanitizers', source => {
    expect(isSafeRenderedImageSource(source)).toBe(false);
    expect(renderMarkdownSafe(`![test](<${source}>)`)).not.toMatch(/<img[^>]*\ssrc=/);
    const rawHtml = `<img src="${source}" onerror="alert(1)">`;
    expect(sanitizeRenderedHtml(rawHtml)).not.toMatch(/<img[^>]*\ssrc=/);
    for (const file of ['chat5.js', 'chat5_5.js']) {
      const html = clientHtml(file, rawHtml);
      expect(html).not.toMatch(/<img[^>]*\ssrc=/);
      expect(html).not.toContain('onerror=');
    }
  });
  test.each([url + '\n', ' ' + url])('raw whitespace is rejected; DOMPurify may canonicalize it to the exact passive URL', source => {
    expect(isSafeRenderedImageSource(source)).toBe(false);
    expect(sanitizeRenderedHtml(`<img src="${source}">`)).not.toMatch(/<img[^>]*\ssrc=/);
    for (const file of ['chat5.js', 'chat5_5.js']) {
      expect(clientHtml(file, `<img src="${source}">`)).toBe(`<img src="${url}">`);
    }
  });
  test.each(['/img/Existing%20Image.PNG', '/ocr/example.png?version=1', 'data:image/png;base64,AA=='])('preserves existing source %s', source => {
    const html = renderMarkdownSafe(`![Legacy](${source})`);
    expect(html).toContain(`src="${source}"`);
    for (const file of ['chat5.js', 'chat5_5.js']) expect(clientHtml(file, html)).toContain(`src="${source}"`);
  });
});

test.each(['relative', 'static', 'symlink', 'uploads'])('unsafe/unwritable %s storage fails before any generation or edit call', async kind => {
  if (kind === 'relative') process.env.GPT_IMAGE_STORAGE_DIR = 'relative/private';
  if (kind === 'static') process.env.GPT_IMAGE_STORAGE_DIR = path.resolve(__dirname, '../../public');
  if (kind === 'symlink') {
    const alias = path.join(root, 'alias');
    await fs.symlink(root, alias);
    process.env.GPT_IMAGE_STORAGE_DIR = alias;
  }
  if (kind === 'uploads') jest.spyOn(fs, 'open').mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
  await expect(service.createImageGeneration({ rawOptions: { prompt: 'Test' }, uploadedFiles: kind === 'uploads' ? [{ buffer: png }] : [] })).rejects.toMatchObject({ status: 503 });
  expect(OpenAI.client.images.generate).not.toHaveBeenCalled();
  expect(OpenAI.client.images.edit).not.toHaveBeenCalled();
});
