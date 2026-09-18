jest.mock('../../services/taric/amiamiBounded', () => ({ fetchImpersonated: jest.fn(() => { throw new Error('Network forbidden in unit tests'); }) }));
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const zlib = require('zlib');
const { boundedJson, createTransport } = require('../../services/taric/transport');
const { BASE_MODEL, TEST_ADAPTER } = require('../../utils/taricProtocol');
function stub({ status = 200, headers = {}, chunks = ['{}'], neverEnd = false } = {}) {
  return (_url, _options, callback) => {
    const req = new EventEmitter(); req.destroy = jest.fn();
    req.end = () => process.nextTick(() => {
      const res = neverEnd ? new Readable({ read() {} }) : Readable.from(chunks.map(c => Buffer.from(c)));
      res.statusCode = status; res.headers = { 'content-type': 'application/json', ...headers };
      callback(res);
    }); return req;
  };
}
test.each([{ status: 302 }, { headers: { 'content-type': 'text/html' } }, { headers: { 'content-encoding': 'gzip' } },
  { headers: { 'content-length': '9000' } }, { chunks: ['12345', '678901'] }, { chunks: ['{"a":1,"a":2}'] }])('bounded transport rejects %p', opts => expect(boundedJson(new URL('https://synthetic.test/'), { request: stub(opts), maxBytes: 10 })).rejects.toThrow('PROVIDER_FAILED'));
test('absolute deadline even if socket never ends', async () => {
  await expect(boundedJson(new URL('https://synthetic.test/'), { request: stub({ neverEnd: true }), deadlineMs: 10 })).rejects.toThrow('PROVIDER_FAILED');
});
test('transport succeeds with bounded chunks', async () => expect(boundedJson(new URL('https://synthetic.test/'), { request: stub({ chunks: ['{"ok":', 'true}'] }) })).resolves.toEqual({ ok: true }));
test.each([['gzip', zlib.gzipSync], ['deflate', zlib.deflateSync], ['br', zlib.brotliCompressSync]])('bounded %s decoding accepts JSON and rejects decoded bombs', async (encoding, compress) => {
  const request = text => stub({ headers: { 'content-encoding': encoding }, chunks: [compress(Buffer.from(text))] });
  await expect(boundedJson(new URL('https://synthetic.test/'), { request: request('{"ok":true}') })).resolves.toEqual({ ok: true });
  await expect(boundedJson(new URL('https://synthetic.test/'), { request: request(JSON.stringify({ text: 'x'.repeat(10000) })), maxBytes: 100, maxWireBytes: 1000 })).rejects.toThrow('PROVIDER_FAILED');
  await expect(boundedJson(new URL('https://synthetic.test/'), { request: request('{"ok":true}'), maxBytes: 1000, maxWireBytes: 5 })).rejects.toThrow('PROVIDER_FAILED');
});
test('absolute deadline includes waiting for DNS/connect before response headers', async () => {
  const req = new EventEmitter(); req.end = jest.fn(); req.destroy = jest.fn();
  await expect(boundedJson(new URL('https://synthetic.test/'), { request: () => req, deadlineMs: 10 })).rejects.toThrow('PROVIDER_FAILED');
  expect(req.destroy).toHaveBeenCalled();
});
test('AmiAmi fixed endpoint, identity, scode independence, no raw persistence', async () => {
  const json = jest.fn().mockResolvedValue({ RSuccess: true, item: { gcode: 'TEST-1', scode: 'OTHER', gname: 'Synthetic object' } });
  const transport = createTransport({ json, env: { TARIC_AMIAMI_TRANSPORT: 'native' } }); const detail = await transport.fetchFactual('TEST-1');
  expect(detail).toMatchObject({ gcode: 'TEST-1', scode: 'OTHER', itemName: 'Synthetic object' }); expect(detail.raw).toBeUndefined();
  expect(json.mock.calls[0][0].href).toBe('https://api.amiami.com/api/v1.0/item?gcode=TEST-1&lang=eng');
  expect(json.mock.calls[0][1].headers).toMatchObject({ 'X-User-Key': 'amiami_dev', Referer: 'https://www.amiami.com/eng/detail?gcode=TEST-1' });
  json.mockResolvedValue({ RSuccess: true, item: { gcode: 'WRONG' } });
  await expect(transport.fetchFactual('TEST-1')).rejects.toThrow('IDENTITY_MISMATCH');
  await expect(transport.fetchFactual('https://evil.test')).rejects.toThrow('INVALID_REQUEST');
});
test('actual Gateway envelope shape works; wrong/missing identities and tool calls never fall back', async () => {
  const content = '{"taric_code":"0000000001","description":"Synthetic description"}';
  const envelope = { model: BASE_MODEL, adapter_name: TEST_ADAPTER, content, raw_content: content, tool_calls: [], usage: { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 } };
  const json = jest.fn().mockResolvedValue(envelope);
  const t = createTransport({ json, env: { TARIC_GATEWAY_ORIGIN: 'http://gateway.test:8080', TARIC_GATEWAY_ALLOWED_ORIGINS: 'http://gateway.test:8080' } });
  const args = [{ descriptive_name: 'Synthetic', full_item_name: 'Synthetic toy', specs: '', hs_code: '950300' }, TEST_ADAPTER, ['0000000001'], 256];
  await expect(t.generate(...args)).resolves.toMatchObject({ taric_code: '0000000001', verification: 'unverified', training_approved: false });
  for (const patch of [{ model: 'wrong' }, { model: undefined }, { adapter_name: 'wrong' }, { adapter_name: undefined }, { tool_calls: [{}] }, { tool_calls: {} }, { tool_calls: 'call' }]) {
    json.mockResolvedValue({ ...envelope, ...patch });
    await expect(t.generate(...args)).rejects.toThrow('INVALID_RESULT');
  }
  json.mockResolvedValue(null); await expect(t.generate(...args)).rejects.toThrow('INVALID_RESULT');
  expect(json).toHaveBeenCalledTimes(9);
  expect(json.mock.calls.every(([url]) => url.pathname === '/qwen3-lora/generate')).toBe(true);
});
test('Gateway requires exact allowlisted operator origin and observed runtime identity', async () => {
  const json = jest.fn().mockImplementation(async url => url.pathname.endsWith('/model') ? { deployment_revision: 'd', model_revision: 'b', tokenizer_revision: 't' }
    : { adapters: [{ adapter_name: 'test', metadata: { artifact_sha256: 'a'.repeat(64) } }] });
  expect(() => createTransport({ env: {} }).configured()).toThrow('CONFIG_NOT_READY');
  const t = createTransport({ json, env: { TARIC_GATEWAY_ORIGIN: 'http://gateway.test:8080', TARIC_GATEWAY_ALLOWED_ORIGINS: 'http://gateway.test:8080' } });
  const identity = { deploymentRevision: 'd', baseRevision: 'b', tokenizerRevision: 't', adapterSha256: 'a'.repeat(64) };
  await expect(t.verifyIdentity('test', identity)).resolves.toBeUndefined();
  await expect(t.verifyIdentity('test', { ...identity, deploymentRevision: 'invented' })).rejects.toThrow('RELEASE_CLOSED');
  await expect(t.verifyIdentity('unknown', identity)).rejects.toThrow('RELEASE_CLOSED');
});

test.each([['ENOTFOUND', 'dns'], ['ECONNREFUSED', 'connect'], ['CERT_HAS_EXPIRED', 'tls']])('sanitized pre-dispatch %s preserves phase without address, body or credential', async (code, phase) => {
  const req = new EventEmitter(); req.destroy = jest.fn(); req.end = () => process.nextTick(() => req.emit('error', Object.assign(new Error('SECRET-hostname'), { code })));
  const error = await boundedJson(new URL('https://synthetic.test/'), { request: () => req, correlationId: 'b'.repeat(32) }).catch(e => e);
  expect(error.transport).toMatchObject({ phase, dispatched: false, terminal: false, socketCode: code, correlationId: 'b'.repeat(32) });
  expect(JSON.stringify(error)).not.toContain('SECRET');
});
test.each([[503, 'http'], [403, 'http']])('confirmed HTTP %i is terminal without reading its body', async (status, phase) => {
  const error = await boundedJson(new URL('https://synthetic.test/'), { request: stub({ status, chunks: ['SECRET-provider-error'] }) }).catch(e => e);
  expect(error.transport).toMatchObject({ phase, status, terminal: true, wireBytes: 0 });
  expect(JSON.stringify(error)).not.toContain('SECRET');
});
test('timeout after dispatch is uncertain; confirmed HTTP response and DNS failure are definite', async () => {
  const { TaricError } = require('../../utils/taricContracts');
  const json = jest.fn();
  const t = createTransport({ json, env: { TARIC_GATEWAY_ORIGIN: 'https://synthetic.test', TARIC_GATEWAY_ALLOWED_ORIGINS: 'https://synthetic.test' } });
  const row = { descriptive_name: 'Synthetic', full_item_name: 'Synthetic', specs: '', hs_code: '950300' };
  for (const [transport, code] of [[{ phase: 'timeout', dispatched: true, terminal: false }, 'INFERENCE_UNCERTAIN'],
    [{ phase: 'http', dispatched: true, terminal: true, status: 503 }, 'PROVIDER_FAILED'], [{ phase: 'dns', dispatched: false, terminal: false }, 'PROVIDER_FAILED']]) {
    json.mockRejectedValueOnce(Object.assign(new TaricError('PROVIDER_FAILED'), { transport }));
    await expect(t.generate(row, TEST_ADAPTER, ['0000000001'], 256)).rejects.toMatchObject({ code, transport });
  }
});
test('JSON, decompression, size and abort failures expose bounded structured categories', async () => {
  const cases = [[stub({ chunks: ['bad json'] }), {}, 'json'], [stub({ chunks: ['bad gzip'], headers: { 'content-encoding': 'gzip' } }), {}, 'decode'],
    [stub({ chunks: ['{"large":"data"}'] }), { maxBytes: 5 }, 'limit']];
  for (const [request, options, phase] of cases) {
    const error = await boundedJson(new URL('https://synthetic.test/'), { request, ...options }).catch(e => e);
    expect(error.transport.phase).toBe(phase); expect(error.transport.durationMs).toBeGreaterThanOrEqual(0);
  }
  const controller = new AbortController(); controller.abort();
  await expect(boundedJson(new URL('https://synthetic.test/'), { signal: controller.signal, request: stub() })).rejects.toMatchObject({ transport: { phase: 'clientabort', dispatched: false } });
});

test('fixed AmiAmi native trust adds OS CAs per request only; Gateway headers and trust stay independent', async () => {
  const json = jest.fn().mockResolvedValue({ RSuccess: true, item: { gcode: 'TEST-1', gname: 'Synthetic' } });
  const env = { TARIC_AMIAMI_TRANSPORT: 'native', TARIC_GATEWAY_ORIGIN: 'http://gateway.test', TARIC_GATEWAY_ALLOWED_ORIGINS: 'http://gateway.test',
    TARIC_GATEWAY_TOKEN: 'PRIVATE-PROXY', TARIC_GATEWAY_ADMIN_TOKEN: 'PRIVATE-ADMIN' };
  const t = createTransport({ json, env }); await t.fetchFactual('TEST-1');
  const opts = json.mock.calls[0][1];
  expect(opts.tlsOptions.rejectUnauthorized).toBe(true); expect(opts.tlsOptions.ca.length).toBeGreaterThan(0);
  expect(opts.headers.Accept).toBe('application/json,text/plain,*/*');
  expect(opts.headers).not.toHaveProperty('X-Admin-Token'); expect(opts.headers).not.toHaveProperty('Authorization');
  json.mockResolvedValue([]); await t.adapters();
  expect(json.mock.calls[1][1]).not.toHaveProperty('tlsOptions');
  expect(json.mock.calls[1][1].headers).toEqual({ Authorization: 'Bearer PRIVATE-PROXY', 'X-Admin-Token': 'PRIVATE-ADMIN' });
});
test.each([[{ phase: 'tls', socketCode: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }, 'TLS_CHAIN_UNTRUSTED'],
  [{ phase: 'http', status: 403 }, 'HTTP_ACCESS_DENIED']])('AmiAmi distinguishes %p without exposing upstream text', async (transport, code) => {
  const json = jest.fn().mockRejectedValue(Object.assign(new Error('PRIVATE-CERT-OR-BODY'), { transport }));
  const t = createTransport({ json, env: { TARIC_AMIAMI_TRANSPORT: 'native' } });
  const error = await t.fetchFactual('TEST-1').catch(e => e);
  expect(error.code).toBe(code); expect(JSON.stringify(error)).not.toContain('PRIVATE');
});
test('default impersonating transport is explicitly injected, normalized and never falls back after HTTP403', async () => {
  const json = jest.fn(); const impersonated = jest.fn().mockResolvedValue({ RSuccess: true, item: { gcode: 'TEST-1', gname: 'Synthetic' } });
  const t = createTransport({ json, impersonated, env: {} });
  expect(await t.fetchFactual('TEST-1')).toMatchObject({ gcode: 'TEST-1' }); expect(impersonated).toHaveBeenCalledWith('TEST-1');
  impersonated.mockRejectedValue(Object.assign(new Error('PRIVATE'), { transport: { phase: 'http', status: 403 } }));
  await expect(t.fetchFactual('TEST-2')).rejects.toThrow('HTTP_ACCESS_DENIED'); expect(json).not.toHaveBeenCalled();
});
