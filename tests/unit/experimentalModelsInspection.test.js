jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const { CAPABILITY, OUTPUT_MESSAGES, RUNTIME_REASONS, compatible, decodeInspection } = require('../../services/experimentalModels/wevisInspection');
const { LabGateway } = require('../../services/experimentalModels/gateway');
const { WEVIS_TASKS } = require('../../services/experimentalModels/contracts');
const { vision } = require('../helpers/experimentalModelsFixtures');
const input = { fileId: '11111111-1111-4111-8111-111111111111', task: 'ocr', query: '', max_new_tokens: 1024 };
const source = { bytes: Buffer.from('synthetic image'), asset: { width: 128, height: 128 } };
const envelope = (changes = {}, code = 'model_output_invalid') => ({ detail: { code, model_output_valid: false, diagnostics: {
  version: 1, stage: 'normalize', reason: 'unrecognized_output', raw_text: 'None', raw_available: true, raw_length: 4, raw_truncated: false,
  task: 'ocr', max_new_tokens: 1024, generated_tokens: 2, finish_reason: 'stop', eos_observed: true, ...changes } } });
const bytes = value => Buffer.from(JSON.stringify(value));
const response = (data, status = 200, headers = {}) => ({ status, data: bytes(data), headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
function client(failure, capability = CAPABILITY) {
  const http = { request: jest.fn(async options => options.url.endsWith('/capabilities') ? response({ available: true, failure_inspection: capability })
    : options.url.endsWith('/limits') ? response({}) : failure) };
  return { http, gateway: new LabGateway({ http, env: { AI_GATEWAY_BASE_URL: 'http://gateway.invalid', MING_ADMIN_TOKEN: 'synthetic-private-token' } }) };
}
const parse = value => decodeInspection(bytes(value), input);
test.each(Object.keys(OUTPUT_MESSAGES))('accepts exact normalize reason %s', reason => {
  const value = envelope({ reason, ...(reason === 'generation_incomplete' ? { finish_reason: 'length', eos_observed: false } : {}) });
  expect(parse(value)).toEqual(value.detail);
});
test.each(Object.entries(RUNTIME_REASONS))('accepts exact runtime pair %s/%s with explicit unavailable raw', (stage, reason) => {
  const value = envelope({ stage, reason, raw_text: null, raw_available: false, raw_length: null,
    generated_tokens: null, finish_reason: null, eos_observed: null }, 'runtime_failed');
  expect(parse(value)).toEqual(value.detail);
  expect(() => parse(envelope({ ...value.detail.diagnostics, raw_text: '', raw_available: true, raw_length: 0 }, 'runtime_failed'))).toThrow();
});
test.each(['generation', 'raw_decode'])('%s accepts observed metadata, including non-budget length', stage => {
  expect(parse(envelope({ stage, reason: RUNTIME_REASONS[stage], raw_text: null, raw_available: false, raw_length: null,
    generated_tokens: 3, finish_reason: 'length', eos_observed: false }, 'runtime_failed')).diagnostics.generated_tokens).toBe(3);
});
test('empty decoded raw differs from unavailable; code points differ from UTF-16', () => {
  expect(parse(envelope({ raw_text: '', raw_length: 0, reason: 'empty_output' })).diagnostics.raw_available).toBe(true);
  expect(parse(envelope({ raw_text: '😀', raw_length: 1 })).diagnostics.raw_length).toBe(1);
  expect(() => parse(envelope({ raw_text: '😀', raw_length: 2 }))).toThrow();
  const d = { raw_text: '😀'.repeat(4096), raw_length: 4097, raw_truncated: true };
  expect(parse(envelope(d)).diagnostics.raw_truncated).toBe(true);
  expect(() => parse(envelope({ ...d, raw_text: '😀'.repeat(4097), raw_length: 4098 }))).toThrow();
  expect(parse(envelope({ raw_text: 'a'.repeat(16381), raw_length: 16382, raw_truncated: true })).diagnostics.raw_truncated).toBe(true);
  expect(() => parse(envelope({ raw_text: 'a'.repeat(16380), raw_length: 16381, raw_truncated: true }))).toThrow();
});
test.each([
  { version: true }, { version: 2 }, { stage: 'exception' }, { reason: 'private exception' }, { task: 'unknown' }, { task: 'detection' },
  { max_new_tokens: 1023 }, { max_new_tokens: true }, { max_new_tokens: 1.5 }, { generated_tokens: true }, { generated_tokens: -1 },
  { generated_tokens: 1025 }, { generated_tokens: 0.5 }, { generated_tokens: null }, { generated_tokens: 0 },
  { raw_available: 1 }, { raw_available: false }, { raw_text: null }, { raw_text: {} }, { raw_text: '\ud800', raw_length: 1 },
  { raw_length: true }, { raw_length: -1 }, { raw_length: 3 }, { raw_length: 4.5 }, { raw_length: Number.MAX_SAFE_INTEGER + 1 },
  { raw_truncated: 0 }, { raw_truncated: true }, { raw_text: 'é'.repeat(8193), raw_length: 8193 },
  { finish_reason: 'eos' }, { finish_reason: null }, { finish_reason: 'length', eos_observed: false }, { eos_observed: 1 },
  { eos_observed: false }, { eos_observed: null }, { reason: 'generation_incomplete' },
])('rejects malformed metadata %j', changes => { expect(() => parse(envelope(changes))).toThrow(); });
test('rejects missing/extra keys at every level, duplicate keys, malformed UTF8/JSON and body excess', () => {
  for (const where of [v => v, v => v.detail, v => v.detail.diagnostics]) {
    const value = envelope(); where(value).extra = 'private exception'; expect(() => parse(value)).toThrow();
    for (const key of Object.keys(where(envelope()))) {
      const missing = envelope(); delete where(missing)[key]; expect(() => parse(missing)).toThrow();
    }
  }
  for (const data of [Buffer.from('{"detail":{},"detail":{}}'), Buffer.from([0xff]), Buffer.from('{'), Buffer.alloc(102401, 32)]) {
    expect(() => decodeInspection(data, input)).toThrow();
  }
  for (const change of [{ code: 'exception' }, { model_output_valid: true }, { model_output_valid: 0 }]) {
    const value = envelope(); Object.assign(value.detail, change); expect(() => parse(value)).toThrow();
  }
});
test.each(WEVIS_TASKS)('opts in with literal true only through perception for %s; binds actual task/budget', async task => {
  const value = envelope({ task }), { gateway, http } = client(response(value, 502));
  await expect(gateway.run('wevisone-vl', { ...input, task, query: task === 'ocr' ? '' : 'synthetic' }, source))
    .rejects.toMatchObject({ status: 502, code: 'model_output_invalid', inspectionBytes: bytes(value) });
  const config = http.request.mock.calls.find(([options]) => options.method === 'POST')[0];
  expect(config.url).toBe('http://gateway.invalid/perception/wevisone-vl');
  expect(config.data.getBuffer().toString()).toMatch(/name="experimental_inspect_failure"\r\n\r\ntrue\r\n/);
  expect(config.headers['X-Ming-Token']).toBeUndefined();
});
test.each([undefined, {}, { ...CAPABILITY, version: 2 }, { ...CAPABILITY, default: true }, { ...CAPABILITY, extra: 'unknown' }])('unsupported capability %j keeps normal request fields', async capability => {
  const { gateway, http } = client(response(vision('ocr')), capability === undefined ? null : capability);
  expect((await gateway.run('wevisone-vl', input, source)).status).toBe(200);
  expect(http.request.mock.calls.find(([o]) => o.method === 'POST')[0].data.getBuffer().toString()).not.toContain('experimental_inspect_failure');
});
test('capability requires every exact member; discovery is sanitized', async () => {
  for (const key of Object.keys(CAPABILITY)) { const v = { ...CAPABILITY }; delete v[key]; expect(compatible(v)).toBe(false); }
  const { gateway } = client(response(envelope(), 502));
  expect((await gateway.capabilities('wevisone-vl')).failureInspection).toEqual({ enabled: true, status: 'available', advertisedVersion: 1 });
});
test('server secret and configured private-root variants are redacted after validation, HTML remains literal', async () => {
  const root = require('../../services/experimentalModels/storage').storageRoot();
  {
    const raw = '<script>window.pwned=true</script> synthetic-private-token ' + root.toUpperCase().replaceAll('/', '\\');
    const { gateway } = client(response(envelope({ raw_text: raw, raw_length: Array.from(raw).length }), 502));
    const error = await gateway.run('wevisone-vl', input, source).catch(e => e);
    const value = JSON.parse(error.inspectionBytes);
    expect(value.detail.diagnostics.raw_text).toBe('<script>window.pwned=true</script> [redacted] [private storage]');
    expect(value.detail.diagnostics.raw_length).toBe(Array.from(raw).length);
  }
});
test.each([409, 422, 429, 503, 504])('noninspection HTTP %i retains generic semantics and never attaches raw', async status => {
  const { gateway } = client(response(envelope(), status));
  const error = await gateway.run('wevisone-vl', input, source).catch(e => e);
  expect(error.status).toBe(status); expect(error.inspectionBytes).toBeUndefined();
});
test.each(['unknown', 'extra', 'missing-cache', 'wrong-type', 'over-body', 'truncated-body'])('redacts %s protocol failure', async kind => {
  const value = kind === 'unknown' ? { detail: { code: 'runtime_failed', message: '/private/root synthetic-private-token' } } : envelope();
  if (kind === 'extra') value.detail.exception = '/private/root synthetic-private-token';
  const failure = response(value, 502, kind === 'missing-cache' ? { 'cache-control': '' } : kind === 'wrong-type' ? { 'content-type': 'text/plain' } : {});
  if (kind === 'over-body') failure.data = Buffer.concat([failure.data, Buffer.alloc(102400, 32)]);
  if (kind === 'truncated-body') failure.data = failure.data.subarray(0, 40);
  const { gateway } = client(failure), error = await gateway.run('wevisone-vl', input, source).catch(e => e);
  expect(error).toMatchObject({ code: 'gateway_error', status: 502, message: 'Gateway runtime, response schema or output size failed.' });
  expect(error.inspectionBytes).toBeUndefined(); expect(JSON.stringify(error)).not.toMatch(/private.root|synthetic-private-token/);
});

test('discovery failure warns once without content; cached fallback never sends the flag', async () => {
  const { gateway, http } = client(response(vision('ocr')));
  const original = http.request.getMockImplementation();
  http.request.mockImplementation(options => options.url.endsWith('/capabilities')
    ? Promise.reject(new Error('secret private exception')) : original(options));
  for (let i = 0; i < 2; i++) expect((await gateway.run('wevisone-vl', input, source)).status).toBe(200);
  const logger = require('../../utils/logger');
  expect(logger.warning).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(logger.warning.mock.calls)).not.toMatch(/secret private exception/);
  expect(http.request.mock.calls.filter(([o]) => o.method === 'POST').every(([o]) => !o.data.getBuffer().toString().includes('experimental_inspect_failure'))).toBe(true);
});
test('an unsolicited inspection on old Gateway remains generic', async () => {
  const { gateway } = client(response(envelope(), 502), null);
  await expect(gateway.run('wevisone-vl', input, source)).rejects.toMatchObject({ code: 'gateway_error', status: 502 });
});
test('redaction expansion cannot exceed the raw byte cap', async () => {
  const { gateway } = client(response(envelope({ raw_text: 'x'.repeat(16384), raw_length: 16384 }), 502));
  gateway.env.MING_ADMIN_TOKEN = 'x';
  const error = await gateway.run('wevisone-vl', input, source).catch(e => e);
  expect(error.code).toBe('gateway_error'); expect(error.inspectionBytes).toBeUndefined();
});
