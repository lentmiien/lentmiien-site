const { EventEmitter } = require('events');
const { boundedJson, createTransport } = require('../../services/taric/transport');
function stub({ status = 200, headers = {}, chunks = ['{}'], neverEnd = false } = {}) {
  return (_url, _options, callback) => {
    const req = new EventEmitter(); req.destroy = jest.fn();
    req.end = () => process.nextTick(() => {
      const res = new EventEmitter(); res.statusCode = status; res.headers = { 'content-type': 'application/json', ...headers }; res.destroy = jest.fn();
      callback(res); if (neverEnd) return;
      for (const c of chunks) res.emit('data', Buffer.from(c)); res.emit('end');
    }); return req;
  };
}
test.each([{ status: 302 }, { headers: { 'content-type': 'text/html' } }, { headers: { 'content-encoding': 'gzip' } },
  { headers: { 'content-length': '9000' } }, { chunks: ['12345', '678901'] }, { chunks: ['{"a":1,"a":2}'] }])('bounded transport rejects %p', opts => expect(boundedJson(new URL('https://synthetic.test/'), { request: stub(opts), maxBytes: 10 })).rejects.toThrow('PROVIDER_FAILED'));
test('absolute deadline even if socket never ends', async () => {
  await expect(boundedJson(new URL('https://synthetic.test/'), { request: stub({ neverEnd: true }), deadlineMs: 10 })).rejects.toThrow('PROVIDER_FAILED');
});
test('transport succeeds with bounded chunks', async () => expect(boundedJson(new URL('https://synthetic.test/'), { request: stub({ chunks: ['{"ok":', 'true}'] }) })).resolves.toEqual({ ok: true }));
test('AmiAmi fixed endpoint, identity, scode independence, no raw persistence', async () => {
  const json = jest.fn().mockResolvedValue({ RSuccess: true, item: { gcode: 'TEST-1', scode: 'OTHER', gname: 'Synthetic object' } });
  const transport = createTransport({ json }); const detail = await transport.fetchFactual('TEST-1');
  expect(detail).toMatchObject({ gcode: 'TEST-1', scode: 'OTHER', itemName: 'Synthetic object' }); expect(detail.raw).toBeUndefined();
  expect(json.mock.calls[0][0].href).toBe('https://api.amiami.com/api/v1.0/item?gcode=TEST-1&lang=eng');
  json.mockResolvedValue({ RSuccess: true, item: { gcode: 'WRONG' } });
  await expect(transport.fetchFactual('TEST-1')).rejects.toThrow('IDENTITY_MISMATCH');
  await expect(transport.fetchFactual('https://evil.test')).rejects.toThrow('INVALID_REQUEST');
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
