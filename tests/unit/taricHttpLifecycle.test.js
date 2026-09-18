// Real loopback sockets, including delays beyond Node's 5s Agent idle timeout.
const http = require('http');
const { getEventListeners } = require('events');
const { boundedJson } = require('../../services/taric/transport');
let server; let origin; let nextId; let requests; let pending;
beforeEach(async () => {
  nextId = 0; requests = []; pending = new Set(); const sockets = new WeakMap();
  server = http.createServer(async (req, res) => {
    if (!sockets.has(req.socket)) sockets.set(req.socket, ++nextId);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ path: req.url, socket: sockets.get(req.socket), bytes: Buffer.concat(chunks).length, length: req.headers['content-length'] });
    res.setHeader('Content-Type', 'application/json');
    const delay = Number(req.url.split('/').at(-1)) || 0;
    if (req.url.startsWith('/body/')) { res.writeHead(200); res.write('{"ok":'); }
    if (req.url.startsWith('/reset/')) { req.socket.destroy(); return; }
    const timer = setTimeout(() => { pending.delete(timer); res.end(req.url.startsWith('/body/') ? 'true}' : '{"ok":true}'); }, delay);
    pending.add(timer);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { for (const timer of pending) clearTimeout(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
const call = (path, opts = {}) => boundedJson(new URL(origin + path), opts);
test('cold 7s, metadata/create 5s budget, warm 6s, status, delayed body 6s all reuse one socket', async () => {
  const observations = []; const events = []; const controller = new AbortController();
  const globalTimeout = http.globalAgent.options.timeout;
  for (const [path, deadlineMs] of [['/headers/7000', 60000], ['/openapi/0', 4000], ['/create/0', 5000],
    ['/headers/6000', 60000], ['/status/0', 5000], ['/body/6000', 60000]]) {
    await expect(call(path, { deadlineMs, method: 'POST', body: { synthetic: '日本語' }, signal: controller.signal,
      onEvent: (event, value) => events.push({ event, ...value }),
      onDiagnostic: value => observations.push(value) })).resolves.toEqual({ ok: true });
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  }
  expect(new Set(requests.map(r => r.socket)).size).toBe(1);
  expect(requests.every(r => r.bytes === Number(r.length))).toBe(true);
  expect(observations.filter(o => o.deadlineMs === 60000).every(o => o.durationMs >= 5900 && o.requestFinished && o.terminal)).toBe(true);
  expect(observations.slice(1).every(o => o.reusedSocket)).toBe(true);
  expect(new Set(observations.map(o => o.socketId)).size).toBe(1);
  expect(observations.every(o => !o.socketTimeoutObserved)).toBe(true);
  expect(http.globalAgent.options.timeout).toBe(globalTimeout);
  expect(events.filter(e => e.event === 'outbound_finished').every(e => e.socketTimeoutMs === e.deadlineMs && e.requestTimeoutMs === e.deadlineMs)).toBe(true);
  expect(events.filter(e => e.event === 'complete')).toHaveLength(6);
  console.info('Loopback lifecycle evidence', observations.map(({ deadlineMs, durationMs, socketId, reusedSocket, phase }) => ({ deadlineMs, durationMs, socketId, reusedSocket, phase })));
}, 25000);
test('completed short deadline and abort cannot destroy the following reused request', async () => {
  const controller = new AbortController();
  await call('/metadata/0', { deadlineMs: 100, signal: controller.signal });
  const next = call('/headers/250', { deadlineMs: 1000 });
  controller.abort();
  await expect(next).resolves.toEqual({ ok: true });
  expect(requests[0].socket).toBe(requests[1].socket);
});
test('local deadline covers delayed body and destroys only its active request; next request works', async () => {
  const events = []; const onDiagnostic = jest.fn();
  const failure = await call('/body/1000', { deadlineMs: 70, onDiagnostic, onEvent: event => events.push(event) }).catch(e => e);
  expect(failure.transport).toMatchObject({ phase: 'timeout', deadlineMs: 70, dispatched: true, terminal: false, requestFinished: true,
    abortTag: 'LOCAL_ABORT', abortOrigin: 'absolute_deadline' });
  expect(onDiagnostic).toHaveBeenCalledTimes(1);
  expect(events.filter(e => e === 'failed')).toHaveLength(1);
  expect(failure.transport.durationMs).toBeGreaterThanOrEqual(60);
  await expect(call('/headers/0')).resolves.toEqual({ ok: true });
  expect(requests[0].socket).not.toBe(requests[1].socket);
});
test('active cancellation is clientabort, remote reset remains http ECONNRESET, both release listeners', async () => {
  const controller = new AbortController();
  const response = call('/headers/1000', { signal: controller.signal, deadlineMs: 60000 });
  const timer = setTimeout(() => controller.abort(), 50);
  try { await expect(response).rejects.toMatchObject({ transport: { phase: 'clientabort', deadlineMs: 60000 } }); }
  finally { clearTimeout(timer); }
  expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  const remote = await call('/reset/0', { deadlineMs: 60000 }).catch(e => e);
  expect(remote.transport).toMatchObject({ phase: 'http', socketCode: 'ECONNRESET', deadlineMs: 60000, wireBytes: 0 });
  expect(remote.transport).not.toHaveProperty('abortTag');
});

test.each([['worker_stop', 'worker_stop'], [new Error('PRIVATE-CANCEL-REASON'), 'unspecified'],
  [new DOMException('PRIVATE-CANCEL-REASON', 'AbortError'), 'abort_error']])('cancellation reason is a safe enum (%#)', async (reason, expected) => {
  const controller = new AbortController();
  const result = call('/headers/1000', { signal: controller.signal }).catch(e => e);
  const timer = setTimeout(() => controller.abort(reason), 25);
  try {
    const error = await result;
    expect(error.transport).toMatchObject({ abortTag: 'LOCAL_ABORT', abortReason: expected });
    expect(JSON.stringify(error)).not.toContain('PRIVATE');
  } finally { clearTimeout(timer); }
});
