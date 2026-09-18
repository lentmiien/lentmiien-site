const http = require('http');
const zlib = require('zlib');
const { EventEmitter } = require('events');
const { nativeBody, decode } = require('../../services/taric/amiamiCurlChild');
const { fetchImpersonated } = require('../../services/taric/amiamiBounded');
// All real native requests are to this in-process loopback fixture only.
let server; let origin;
beforeEach(async () => {
  server = http.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
test.each([false, true])('installed libcurl WIRE cap aborts %s Content-Length transfer before getRespBody', async withLength => {
  let sent = 0;
  server.on('request', (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', ...(withLength ? { 'Content-Length': 1000000 } : {}) });
    const timer = setInterval(() => { sent += 4096; res.write(Buffer.alloc(4096)); if (sent >= 1000000) { clearInterval(timer); res.end(); } }, 2);
    res.on('close', () => clearInterval(timer));
  });
  await expect(nativeBody(new URL(origin), {}, null, { maxBytes: 8192 })).rejects.toMatchObject({ transport: { phase: 'limit' } });
  await new Promise(resolve => setTimeout(resolve, 10)); expect(sent).toBeLessThan(1000000);
});
test.each(['gzip', 'deflate', 'br', 'zstd'])('%s remains compressed in native buffer; separate decoded cap rejects bomb', async encoding => {
  const compress = { gzip: zlib.gzipSync, deflate: zlib.deflateSync, br: zlib.brotliCompressSync, zstd: zlib.zstdCompressSync }[encoding];
  const bytes = compress(Buffer.from(JSON.stringify({ value: 'x'.repeat(100000) })));
  server.on('request', (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': encoding }); res.end(bytes); });
  const result = await nativeBody(new URL(origin), {}, null, { maxBytes: 8192 });
  expect(result.bytes).toEqual(bytes); expect(() => decode(result, 8192)).toThrow();
});
test('matching Chrome136 request semantics, no redirect, HTTP403 and absolute native deadline', async () => {
  const seen = [];
  server.on('request', (req, res) => {
    seen.push(req.url);
    if (req.url === '/blocked') { res.writeHead(403); res.end('PRIVATE BODY'); }
    else if (req.url === '/redirect') { res.writeHead(302, { Location: '/target' }); res.end(); }
    else if (req.url === '/slow') { /* deadline must fire without any bytes */ }
    else { expect(req.headers['x-user-key']).toBe('amiami_dev'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }
  });
  expect(decode(await nativeBody(new URL(origin + '/api/v1.0/item?gcode=TEST-1&lang=eng'), { 'X-User-Key': 'amiami_dev' }, null))).toEqual({ ok: true });
  const denied = await nativeBody(new URL(origin + '/blocked'), {}, null).catch(e => e);
  expect(denied).toMatchObject({ code: 'HTTP_ACCESS_DENIED', transport: { status: 403 } }); expect(JSON.stringify(denied)).not.toContain('PRIVATE');
  await expect(nativeBody(new URL(origin + '/redirect'), {}, null)).rejects.toMatchObject({ transport: { status: 302 } });
  expect(seen).not.toContain('/target');
  await expect(nativeBody(new URL(origin + '/slow'), {}, null, { timeoutMs: 20 })).rejects.toMatchObject({ transport: { phase: 'timeout' } });
});
test('parent absolute timeout kills hung native helper; only code passes to child; errors are scrubbed', async () => {
  const child = new EventEmitter(); child.kill = jest.fn(() => { child.emit('exit'); return true; }); child.send = jest.fn();
  const spawn = jest.fn(() => child);
  await expect(fetchImpersonated('TEST-1', { spawn, deadlineMs: 5 })).rejects.toMatchObject({ transport: { phase: 'timeout' } });
  expect(child.kill).toHaveBeenCalled(); expect(child.send.mock.calls[0][0]).toMatchObject({ code: 'TEST-1' });
  expect(require('fs').existsSync(child.send.mock.calls[0][0].caPath)).toBe(false);
  expect(spawn.mock.calls[0][2].env).not.toHaveProperty('TARIC_GATEWAY_ADMIN_TOKEN');
  expect(() => fetchImpersonated('https://evil.test', { spawn })).toThrow('INVALID_REQUEST');
});
