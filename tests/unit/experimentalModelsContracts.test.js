const { randomUUID } = require('crypto');
const { parseInput, validateWevis, validateWav, WEVIS_TASKS, TAGS } = require('../../services/experimentalModels/contracts');
const { LabGateway, safeHeaders, redact } = require('../../services/experimentalModels/gateway');
const fileId = randomUUID();
const ming = { task: 'VOICE_DESIGN', text: 'Synthetic test.', language: 'en', controls: { style: 'Calm voice' } };
function wav(rate = 44100, seconds = 0.1) {
  const data = Math.floor(rate * seconds) * 2, bytes = Buffer.alloc(44 + data);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(data, 40); return bytes;
}
function vision(task = 'ocr') {
  return { schema_version: 1, model: 'wevisone-vl', upstream_model: 'tencent/WeVisOne-VL-4B', task, raw_text: 'Synthetic', text: 'Synthetic', regions: [], count: null, declared_count: null,
    complete: true, finish_reason: 'stop', coordinates: { bins: 1000, normalized_range: [0, 1], pixel_space: 'exif_oriented_original', original_size: { width: 128, height: 128 }, model_input_size: { width: 128, height: 128 }, resized: false },
    image: { source_size: [128, 128], original_size: [128, 128], model_input_size: [128, 128], exif_orientation_applied: true, scale_xy: [1, 1] }, text_order: 'model_generation_order' };
}
const source = { asset: { width: 128, height: 128 }, bytes: Buffer.from('synthetic PNG placeholder for mocked transport') };
const ok = (data, type = 'application/json', headers = {}) => ({ status: 200, data: Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data)), headers: { 'content-type': type, 'cache-control': 'no-store', ...headers } });

describe('verified form contracts', () => {
  test.each(WEVIS_TASKS)('serializes WeVis %s with exact task semantics', task => {
    const query = task === 'ocr' ? '' : task === 'referring' ? 'the red cup, near the plate' : 'red cup\nblue cup';
    expect(parseInput('wevisone-vl', { fileId, task, query })).toEqual({ fileId, task, query, max_new_tokens: 1024 });
  });
  test.each([
    { task: 'OCR' }, { task: 'ocr', query: ' ' }, { task: 'point', query: '' }, { task: 'point', query: ' '.repeat(1025) },
    { task: 'point', query: '<box>' }, { task: 'point', query: 'a\rb' }, { task: 'video' }, { url: 'https://invalid' },
    { experimental_inspect_failure: true }, { failure_inspection: { version: 1 } },
    { max_new_tokens: true }, { max_new_tokens: 0 }, { max_new_tokens: 4097 }, { max_new_tokens: '1024' }, { task: ['ocr', 'point'] }, { fileId: '../x' },
  ])('rejects invalid WeVis input %j', change => {
    expect(() => parseInput('wevisone-vl', { fileId, task: 'ocr', ...change })).toThrow();
  });
  test.each(['zh', 'en'])('Ming reference-free task serializers for %s omit inactive fields', language => {
    expect(parseInput('ming-tts', { ...ming, language, instruction: null })).toEqual({ ...ming, language, max_decode_steps: 200 });
    expect(parseInput('ming-tts', { task: 'FREEFORM', language, text: 'Hello', instruction: 'Speak calmly', controls: {} })).toEqual({ task: 'FREEFORM', language, text: 'Hello', instruction: 'Speak calmly', max_decode_steps: 200 });
  });
  test.each([
    { text: '' }, { text: ' '.repeat(501) }, { text: '<x>' }, { text: 'a\x01' }, { language: undefined }, { language: 'english' }, { language: 'ja' },
    { controls: {} }, { controls: { style: ' '.repeat(513) } }, { controls: { style: '  ' } }, { controls: { style: 'Calm', emotion: '高兴' } },
    { controls: { style: 'Calm', speed: 'slow' } }, { instruction: 'unused' }, { instruction: '' }, { reference_id: 'existing-voice' },
    { max_decode_steps: true }, { max_decode_steps: 7 }, { max_decode_steps: 401 }, { task: 'CLONE' }, { text: '[breathing]' }, { text: '[Uhm' },
    { text: '[[Uhm]]' }, { prompt: 'injected' }, { headers: {} }, { seed: 1 }, { controls: { style: '<secret>' } },
  ])('rejects invalid Ming fields %j', change => { expect(() => parseInput('ming-tts', { ...ming, ...change })).toThrow(); });
  test.each(['TTS', 'MULTILINGUAL', 'BASIC', 'EMOTION', 'DIALECT'])('requires an owned reference and consent for %s', task => {
    const controls = { BASIC: { speed: '慢速' }, EMOTION: { emotion: '高兴' }, DIALECT: { dialect: 'cantonese' } }[task];
    expect(() => parseInput('ming-tts', { task, text: 'Synthetic', language: task === 'MULTILINGUAL' ? 'ja' : 'zh', controls })).toThrow(/reference task/);
  });
  test.each(TAGS)('accepts exact speech tag [%s]', tag => { expect(parseInput('ming-tts', { ...ming, text: `[${tag}] Hello` }).text).toContain(tag); });
  test('freeform rejects mixed controls and missing instruction', () => {
    for (const value of [{ ...ming, task: 'FREEFORM', instruction: 'Calm' }, { task: 'FREEFORM', text: 'Hello', language: 'en', instruction: ' ' }]) {
      expect(() => parseInput('ming-tts', value)).toThrow();
    }
  });
});

describe('terminal response contracts', () => {
  test.each([16000, 22050, 44100, 48000])('parses actual WAV rate %i', rate => { expect(validateWav(wav(rate))).toMatchObject({ sampleRate: rate, channels: 1, bitsPerSample: 16 }); });
  test.each(['magic', 'stereo', 'float', 'bits', 'length', 'empty', 'rate', 'duration', 'oversize', 'chunks'])('rejects invalid WAV %s', kind => {
    let data = wav();
    if (kind === 'magic') data.write('html'); if (kind === 'stereo') data.writeUInt16LE(2, 22); if (kind === 'float') data.writeUInt16LE(3, 20);
    if (kind === 'bits') data.writeUInt16LE(8, 34); if (kind === 'length') data.writeUInt32LE(1, 4); if (kind === 'empty') data = wav(44100, 0);
    if (kind === 'rate') data = wav(8000); if (kind === 'duration') data = wav(16000, 61); if (kind === 'oversize') data = Buffer.alloc(6291457);
    if (kind === 'chunks') data.writeUInt32LE(0xffffffff, 40);
    expect(() => validateWav(data)).toThrow();
  });
  test.each(['box', 'point', 'polygon'])('validates fractional %s regions in original coordinates', shape => {
    const data = vision('detection'), pixels = shape === 'box' ? [0.5, 1.5, 64, 128] : shape === 'point' ? [4.5, 6.25] : [0, 0, 128, 0, 64, 128];
    data.regions = [{ shape, label: '<img onerror=alert(1)>', pixels, normalized: pixels.map(v => v / 128) }];
    expect(validateWevis(data, { task: 'detection' }, source.asset)).toEqual(data);
  });
  test.each(['partial', 'count', 'bounds', 'shape', 'size', 'tokens', 'raw', 'task', 'coords', 'resize'])('rejects malformed WeVis %s', kind => {
    const data = vision();
    if (kind === 'partial') data.complete = false; if (kind === 'count') data.declared_count = 1; if (kind === 'size') data.image.original_size = [64, 64];
    if (kind === 'tokens') data.usage = {}; if (kind === 'raw') data.raw_text = 'x'.repeat(262145); if (kind === 'task') data.task = 'point';
    if (kind === 'coords') data.coordinates.pixel_space = 'model_input'; if (kind === 'resize') data.coordinates.model_input_size.width = 129;
    if (kind === 'bounds' || kind === 'shape') data.regions = [{ shape: kind === 'shape' ? 'mask' : 'point', label: 'test', normalized: [1, 1], pixels: [999, 999] }];
    expect(() => validateWevis(data, { task: 'ocr' }, source.asset)).toThrow();
  });
});

describe('fixed Gateway transport, privacy and no GPU calls in tests', () => {
  let http, gateway;
  beforeEach(() => { http = { request: jest.fn() }; gateway = new LabGateway({ http, env: { AI_GATEWAY_BASE_URL: 'http://gateway.invalid:8080', MING_ADMIN_TOKEN: 'synthetic-private-token', LLM_ADMIN_TOKEN: 'wrong-token' } }); });
  test('Ming sends only its scoped token, exact JSON and bounded long timeout', async () => {
    http.request.mockResolvedValue(ok(wav(), 'audio/wav', { 'x-generation-complete': 'true', 'set-cookie': 'secret', server: '/private/path' }));
    const result = await gateway.run('ming-tts', parseInput('ming-tts', ming));
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(http.request.mock.calls[0][0]).toMatchObject({ url: 'http://gateway.invalid:8080/tts/ming/tasks', timeout: 2000000, maxRedirects: 0,
      maxContentLength: 6291456, headers: { 'X-Ming-Token': 'synthetic-private-token', 'Content-Type': 'application/json' } });
    expect(JSON.stringify(http.request.mock.calls)).not.toContain('wrong-token');
    expect(result.metadata.sampleRate).toBe(44100); expect(result.headers).not.toHaveProperty('set-cookie'); expect(result.headers).not.toHaveProperty('server');
  });
  test.each(WEVIS_TASKS)('all WeVis tasks including %s use exact multipart endpoint', async task => {
    const output = vision(task); if (task.startsWith('count')) output.count = 0;
    http.request.mockResolvedValue(ok(output));
    await gateway.run('wevisone-vl', parseInput('wevisone-vl', { fileId, task, query: task === 'ocr' ? '' : 'cup' }), source);
    const config = http.request.mock.calls[0][0], wire = config.data.getBuffer().toString();
    expect(config.url).toBe('http://gateway.invalid:8080/perception/wevisone-vl'); expect(config.headers).not.toHaveProperty('X-Ming-Token');
    expect([...wire.matchAll(/ name="([^"]+)"(?:;|\r)/g)].map(m => m[1])).toEqual(['file', 'task', 'query', 'max_new_tokens']);
  });
  test.each([undefined, 1, 2, '1'])('failure inspection advertisement %s stays disabled until the exact contract is integrated', async version => {
    http.request.mockResolvedValueOnce(ok({ available: true, failure_inspection: { version, detail: '/private/path token=secret' } }))
      .mockResolvedValueOnce(ok({})).mockResolvedValueOnce(ok(vision()));
    const capabilities = await gateway.capabilities('wevisone-vl');
    expect(capabilities.failureInspection).toEqual({ enabled: false, status: 'contract_pending', advertisedVersion: version === 1 ? 1 : null });
    expect(JSON.stringify(capabilities)).not.toMatch(/private.path|token=secret/);
    await gateway.run('wevisone-vl', { fileId, task: 'ocr' }, source);
    const wire = http.request.mock.calls[2][0].data.getBuffer().toString();
    expect([...wire.matchAll(/ name="([^"]+)"(?:;|\r)/g)].map(m => m[1])).toEqual(['file', 'task', 'query', 'max_new_tokens']);
  });
  test('uncontracted WeVis 502 diagnostics and generic detail never escape as raw output or secrets', async () => {
    http.request.mockResolvedValue({ status: 502, data: Buffer.from(JSON.stringify({ detail: { code: 'output_not_valid', message: 'token=secret /private/path',
      failure_inspection: { version: 1, raw_text: '<img onerror=alert(1)> synthetic-private-token C:\\private\\file' } } })), headers: {} });
    await expect(gateway.run('wevisone-vl', { fileId, task: 'ocr' }, source)).rejects.toMatchObject({ code: 'gateway_error', status: 502 });
    try { await gateway.run('wevisone-vl', { fileId, task: 'ocr' }, source); } catch (error) {
      expect(JSON.stringify(error)).not.toMatch(/private|token=|img|raw_text|failure_inspection/);
    }
  });
  test('missing Ming configuration and invalid origins fail without a request', async () => {
    for (const env of [{}, { MING_ADMIN_TOKEN: 'x', AI_GATEWAY_BASE_URL: 'https://user:password@gateway.invalid' }, { MING_ADMIN_TOKEN: 'x', EXPERIMENTAL_MODELS_TIMEOUT_MS: '120000' }]) {
      const client = new LabGateway({ http, env }); await expect(client.run('ming-tts', ming)).rejects.toMatchObject({ status: 503 });
      await expect(client.capabilities('ming-tts')).rejects.toMatchObject({ status: 503 });
    }
    expect(http.request).not.toHaveBeenCalled();
  });
  test('capabilities are passive and cannot enable reference registration', async () => {
    http.request.mockResolvedValue(ok({ available: true, runtime_verified: true, container_state: 'stopped', optional_installation: true, private_catalog: ['secret'] }));
    expect(await gateway.capabilities('ming-tts')).toMatchObject({ available: true, runtime_verified: false, referenceAdapter: 'unsupported' });
    expect(http.request.mock.calls[0][0]).toMatchObject({ method: 'GET', url: 'http://gateway.invalid:8080/tts/ming/capabilities' });
  });
  test.each([401, 408, 409, 413, 422, 429, 499, 502, 503, 504])('HTTP %i does not produce partial artifacts or expose details', async status => {
    http.request.mockResolvedValue({ status, data: Buffer.from(JSON.stringify({ detail: [{ msg: '/private/path synthetic-private-token', input: 'private input', loc: ['body'] }] })), headers: { 'retry-after': '15', 'x-secret': 'synthetic-private-token' } });
    let error; try { await gateway.run('ming-tts', ming); } catch (e) { error = e; }
    expect(error.status).toBe(status); expect(JSON.stringify(error)).not.toMatch(/private.path|private input|synthetic-private-token/);
    expect(error.safeHeaders).toEqual({ 'Retry-After': '15' });
  });
  test('batch conflict preserves only recognized code and retry delay', async () => {
    http.request.mockResolvedValue({ status: 409, data: Buffer.from('{"detail":{"code":"gpu_batch_session_busy","private":"secret"}}'), headers: { 'retry-after': '15' } });
    await expect(gateway.run('ming-tts', ming)).rejects.toMatchObject({ code: 'gpu_batch_session_busy', safeHeaders: { 'Retry-After': '15' } });
  });
  test.each(['no-completion', 'json', 'oversize', 'timeout', 'redirect'])('rejects %s without retries', async kind => {
    if (kind === 'timeout') http.request.mockRejectedValue({ code: 'ECONNABORTED', config: { token: 'secret' } });
    else http.request.mockResolvedValue(kind === 'redirect' ? { status: 302, data: Buffer.from('secret'), headers: { location: 'http://evil.invalid' } } : ok(kind === 'oversize' ? Buffer.alloc(6291457) : wav(), kind === 'json' ? 'application/json' : 'audio/wav'));
    await expect(gateway.run('ming-tts', ming)).rejects.toBeDefined(); expect(http.request).toHaveBeenCalledTimes(1);
  });
  test('limits never receive Ming credentials and omit unrelated/private values', async () => {
    http.request.mockResolvedValueOnce(ok({ available: true, container_state: 'stopped' })).mockResolvedValueOnce(ok({ queue_timeout_sec: 900, upstream_timeout_sec: 630,
      successors: { ming_tts: { max_text_chars: 500, host_path: '/private/path' }, wevisone_vl: { max_new_tokens: 4096 }, unrelated: { secret: 'private' } } }));
    const capabilities = await gateway.capabilities('ming-tts');
    expect(http.request.mock.calls[1][0]).toMatchObject({ url: 'http://gateway.invalid:8080/limits', method: 'GET', headers: {} });
    expect(capabilities.limits).toEqual({ queue_timeout_sec: 900, upstream_timeout_sec: 630, successors: { ming_tts: { max_text_chars: 500 }, wevisone_vl: { max_new_tokens: 4096 } } });
  });
  test('sanitized structured output redacts JSON-escaped credentials and remains valid JSON', async () => {
    const output = vision(); output.raw_text = 'synthetic-private-token <img onerror=alert(1)>'; output.text = 'token="arbitrary-secret"';
    http.request.mockResolvedValue(ok(output));
    const result = await gateway.run('wevisone-vl', parseInput('wevisone-vl', { task: 'ocr', fileId }), source);
    expect(JSON.parse(result.bytes).raw_text).toContain('[redacted]'); expect(result.bytes.toString()).not.toMatch(/synthetic-private-token|arbitrary-secret/);
  });
  test('requires terminal no-store response and bounds wall-clock timeout with abort', async () => {
    const value = ok(wav(), 'audio/wav', { 'x-generation-complete': 'true' }); delete value.headers['cache-control'];
    http.request.mockResolvedValueOnce(value); await expect(gateway.run('ming-tts', ming)).rejects.toMatchObject({ code: 'invalid_response' });
    jest.useFakeTimers();
    try {
      http.request.mockImplementationOnce(config => new Promise((resolve, reject) => config.signal.addEventListener('abort', () => reject({ code: 'ERR_CANCELED' }))));
      const waiting = expect(gateway.run('ming-tts', ming)).rejects.toMatchObject({ code: 'completion_unknown' });
      await jest.advanceTimersByTimeAsync(2000000); await waiting;
    } finally { jest.useRealTimers(); }
  });
  test('transport refuses unknown paths and prevents Ming token leakage to other endpoints', async () => {
    for (const [model, path, method] of [['ming-tts', '/limits', 'GET'], ['ming-tts', '/tts/ming/voices', 'POST'], ['wevisone-vl', '/ocr', 'POST'], ['unknown', '/limits', 'GET']]) {
      await expect(gateway.send(model, path, { method, maxBytes: 1024 })).rejects.toMatchObject({ code: 'unknown_operation' });
    }
    expect(http.request).not.toHaveBeenCalled();
  });
  test('redacts embedded token-like strings and never dumps unsafe headers', () => {
    expect(redact('Bearer abc.def sk-testsecret token=arbitrary-secret synthetic-token', ['synthetic-token'])).not.toMatch(/abc.def|sk-testsecret|arbitrary-secret|synthetic-token/);
    expect(safeHeaders({ 'content-type': 'text/html', 'retry-after': '/secret', authorization: 'secret', 'cache-control': 'secret' })).toEqual({});
  });
});

test('passive capability cache coalesces reads, expires after one minute and bounds failures', async () => {
  let now = 1000; const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  const http = { request: jest.fn(async config => ok(config.url.endsWith('/limits') ? {} : { available: true, ephemeral_reference: { version: 1 } })) };
  const gateway = new LabGateway({ http, env: { AI_GATEWAY_BASE_URL: 'http://gateway.invalid', MING_ADMIN_TOKEN: 'synthetic' } });
  try {
    const results = await Promise.all(Array.from({ length: 10 }, () => gateway.capabilities('ming-tts')));
    expect(results.every(value => value.referenceAdapter === 'available')).toBe(true); expect(http.request).toHaveBeenCalledTimes(2);
    now += 60001; await gateway.capabilities('ming-tts'); expect(http.request).toHaveBeenCalledTimes(4);
    now += 60001; http.request.mockRejectedValue(new Error('private error'));
    for (let i = 0; i < 3; i += 1) await expect(gateway.capabilities('ming-tts')).rejects.toMatchObject({ code: 'gateway_transport' });
    expect(http.request).toHaveBeenCalledTimes(5);
    expect(http.request.mock.calls.every(([config]) => config.method === 'GET')).toBe(true);
    expect(gateway.discovery.size).toBe(1);
  } finally { clock.mockRestore(); }
});
