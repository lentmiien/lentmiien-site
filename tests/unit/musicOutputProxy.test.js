const { PassThrough, Writable } = require('stream');
const { once } = require('events');
jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));
const { proxyMusicOutput } = require('../../services/musicOutputProxy');
const { MusicGatewayService } = require('../../services/musicGatewayService');
function response() {
  const chunks = [];
  const res = new Writable({ write(chunk, _encoding, cb) { chunks.push(chunk); cb(); } });
  res.headers = {}; res.statusCode = 200;
  res.set = values => { Object.assign(res.headers, values); return res; };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.removeHeader = key => { delete res.headers[key]; };
  res.status = status => { res.statusCode = status; return res; };
  res.send = text => res.end(text); res.chunks = chunks;
  return res;
}
function fixture({ method = 'GET', status = 206, path = 'yue2:' + 'a'.repeat(32) + '/audio.flac', authorized = true } = {}) {
  const upstream = new PassThrough();
  const client = { request: jest.fn().mockResolvedValue({ status, data: upstream, headers: { 'content-type': 'audio/flac', 'content-length': '4', 'content-range': status === 416 ? 'bytes */20' : 'bytes 0-3/20', 'accept-ranges': 'bytes', etag: '"tag"', 'last-modified': 'Mon, 14 Sep 2026 00:00:00 GMT', 'set-cookie': 'SECRET' } }) };
  const req = { method, query: { path }, get: name => ({ range: 'bytes=0-3', 'if-range': '"tag"' }[name]) };
  const res = response();
  const options = { gateway: new MusicGatewayService({ baseUrl: 'http://mock.invalid' }), client, authorize: jest.fn().mockResolvedValue(authorized) };
  return { req, res, options, upstream, client };
}
test.each(['legacy/batch/audio.wav', 'yue2:' + 'a'.repeat(32) + '/audio.flac'])('GET forwards Range/If-Range and 206 for %s', async path => {
  const f = fixture({ path }); const done = once(f.res, 'finish');
  await proxyMusicOutput(f.req, f.res, f.options); f.upstream.end('test'); await done;
  expect(f.res.statusCode).toBe(206); expect(Buffer.concat(f.res.chunks).toString()).toBe('test');
  expect(f.client.request.mock.calls[0][0]).toMatchObject({ method: 'GET', params: { path }, headers: { range: 'bytes=0-3', 'if-range': '"tag"' }, maxRedirects: 0 });
  expect(f.res.headers).toMatchObject({ 'content-range': 'bytes 0-3/20', 'accept-ranges': 'bytes', etag: '"tag"', 'Cache-Control': 'private, no-store, max-age=0' });
  expect(f.res.headers).not.toHaveProperty('set-cookie');
});
test.each([200, 206])('HEAD sends upstream HEAD with status %s, headers and no body', async status => {
  const f = fixture({ method: 'HEAD', status }); await proxyMusicOutput(f.req, f.res, f.options);
  expect(f.client.request.mock.calls[0][0].method).toBe('HEAD'); expect(f.res.statusCode).toBe(status);
  expect(f.res.headers['content-length']).toBe('4'); expect(f.res.chunks).toHaveLength(0); expect(f.upstream.destroyed).toBe(true);
});
test('416 keeps Content-Range and does not forward upstream error payload', async () => {
  const f = fixture({ status: 416 }); await proxyMusicOutput(f.req, f.res, f.options);
  expect(f.res.statusCode).toBe(416); expect(f.res.headers['content-range']).toBe('bytes */20');
  expect(f.res.headers).not.toHaveProperty('content-length'); expect(f.res.chunks).toHaveLength(0);
});
test.each(['../secret.wav', '%2e%2e/audio.flac', 'https://evil/audio.wav', 'yue2:bad/audio.wav'])('unsafe path %s never reaches upstream', async path => {
  const f = fixture({ path }); await proxyMusicOutput(f.req, f.res, f.options);
  expect(f.res.statusCode).toBe(400); expect(f.client.request).not.toHaveBeenCalled();
});
test('unpersisted/foreign output is 404 without a Gateway lookup', async () => {
  const f = fixture({ authorized: false }); await proxyMusicOutput(f.req, f.res, f.options);
  expect(f.res.statusCode).toBe(404); expect(f.client.request).not.toHaveBeenCalled();
});
test('disconnect aborts transport and destroys upstream', async () => {
  const f = fixture(); await proxyMusicOutput(f.req, f.res, f.options); f.res.emit('close');
  expect(f.upstream.destroyed).toBe(true); expect(f.client.request.mock.calls[0][0].signal.aborted).toBe(true);
});
test('stream error is logged and closes the response', async () => {
  const f = fixture(); await proxyMusicOutput(f.req, f.res, f.options);
  f.upstream.emit('error', new Error('private upstream failure'));
  expect(f.res.statusCode).toBe(502); expect(require('../../utils/logger').warning).toHaveBeenCalledWith('Music output stream interrupted', { category: 'music' });
});
test('unexpected upstream status destroys error stream and sanitizes response', async () => {
  const f = fixture({ status: 503 }); await proxyMusicOutput(f.req, f.res, f.options);
  expect(f.res.statusCode).toBe(502); expect(f.upstream.destroyed).toBe(true);
});
