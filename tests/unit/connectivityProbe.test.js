const { EventEmitter } = require('events');
const { probe, probeTargets, isPublicIPv4 } = require('../../services/connectivityProbe');
const { getConnectivityConfig } = require('../../utils/connectivityConfig');
const config = getConnectivityConfig({});

function transport({ status = 204, body = '', latency = 100, dnsError = false, addresses = ['8.8.8.8'], stalled = false, requestError = false } = {}) {
  let time = 0;
  const resolver = { resolve4: jest.fn(dnsError ? () => Promise.reject(new Error('private detail')) : async () => addresses), cancel: jest.fn() };
  const request = jest.fn((_url, _options, callback) => {
    const req = new EventEmitter();
    req.destroy = jest.fn();
    req.end = () => {
      if (stalled) return;
      time = latency;
      if (requestError) return req.emit('error', new Error('private detail'));
      const response = new EventEmitter();
      response.statusCode = status;
      response.destroy = jest.fn();
      callback(response);
      response.emit('data', Buffer.from(body));
      response.emit('end');
    };
    return req;
  });
  return { request, resolver, now: () => time };
}

test.each([[100, false], [1499, false], [1500, true], [2000, true]])('good/slow latency %i', async (latency, degraded) => {
  const value = await probe(probeTargets(config)[0], config, transport({ latency }));
  expect(value).toMatchObject({ outcome: 'ok', latencyMs: latency, degraded });
});

test.each([
  [{ status: 302 }, 'http_status'], [{ status: 503 }, 'http_status'],
  [{ dnsError: true }, 'dns_error'], [{ requestError: true }, 'connection_error'],
  [{ body: 'x'.repeat(4097) }, 'oversized'], [{ addresses: ['127.0.0.1'] }, 'unsafe_address'],
])('bounded failing probes %j', async (options, outcome) => {
  expect(await probe(probeTargets(config)[0], config, transport(options))).toMatchObject({ outcome, degraded: true });
});

test.each(['0.0.0.0', '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '::1', '::ffff:127.0.0.1'])('rejects unsafe address %s', (address) => {
  expect(isPublicIPv4(address)).toBe(false);
});

test('DNS and connected stalls hit an absolute deadline and cancel work', async () => {
  jest.useFakeTimers();
  for (const stalledDns of [false, true]) {
    const deps = transport({ stalled: true });
    if (stalledDns) deps.resolver.resolve4.mockReturnValue(new Promise(() => {}));
    const pending = probe(probeTargets(config)[0], config, deps);
    await jest.advanceTimersByTimeAsync(config.timeoutMs);
    expect(await pending).toMatchObject({ outcome: 'timeout', degraded: true });
    expect(deps.resolver.cancel).toHaveBeenCalled();
  }
  jest.useRealTimers();
});

test('public app requires readiness JSON; pins DNS, forbids redirects and uses a cache-busting fixed path', async () => {
  const cfg = getConnectivityConfig({ CONNECTIVITY_PUBLIC_ORIGIN: 'https://example.com' });
  const target = probeTargets(cfg)[2];
  for (const body of ['<html>challenge</html>', '{"status":"ok"}', '{"status":"ok","database":"ready"}']) {
    const deps = transport({ status: 200, body });
    const value = await probe(target, cfg, deps);
    expect(value.outcome).toBe(body.includes('ready') ? 'ok' : 'unexpected_response');
    const [url, options] = deps.request.mock.calls[0];
    expect(url.pathname).toBe('/apphealth');
    expect(url.searchParams.has('connectivity')).toBe(true);
    expect(options).toMatchObject({ agent: false, maxHeaderSize: 8192 });
    const callback = jest.fn();
    options.lookup('example.com', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }], 4);
  }
  expect(probeTargets(config)).toHaveLength(2);
  expect(probeTargets(config)[1]).toMatchObject({ name: 'cloudflare', trace: true });
});

test('Cloudflare uses verified bounded GET and validates trace without retaining its contents', async () => {
  const target = probeTargets(config)[1];
  for (const [body, expected] of [['h=www.cloudflare.com\ncolo=NRT\nip=private-detail\n', 'ok'],
    ['<html>challenge</html>', 'unexpected_response'], ['h=example.com\ncolo=NRT\n', 'unexpected_response']]) {
    const deps = transport({ status: 200, body });
    const result = await probe(target, config, deps);
    expect(result).toMatchObject({ outcome: expected, httpReachable: true });
    expect(deps.request.mock.calls[0][1]).toMatchObject({ method: 'GET', rejectUnauthorized: true, agent: false });
    expect(JSON.stringify(result)).not.toContain('private-detail');
  }
  expect(await probe(target, config, transport({ status: 404 }))).toMatchObject({
    outcome: 'http_status', httpReachable: true, statusCode: 404, failurePhase: 'headers',
  });
});

test('monotonic milestones record incomplete connection phases and safe errors', async () => {
  let time = 0;
  const socket = new EventEmitter();
  const req = new EventEmitter();
  req.destroy = jest.fn();
  const res = new EventEmitter();
  res.statusCode = 200; res.destroy = jest.fn();
  const resolver = { resolve4: async () => { time = 10; return ['8.8.8.8']; }, cancel: jest.fn() };
  const request = (_url, _options, callback) => {
    req.end = () => {
      req.emit('socket', socket);
      time = 20; socket.emit('connect');
      time = 40; socket.emit('secureConnect');
      time = 80; callback(res);
      time = 90; res.emit('data', Buffer.from('{"status":"ok","database":"ready"}'));
      time = 100; res.emit('end');
    };
    return req;
  };
  const target = probeTargets(getConnectivityConfig({ CONNECTIVITY_PUBLIC_ORIGIN: 'https://example.com' }))[2];
  expect(await probe(target, config, { request, resolver, now: () => time })).toMatchObject({
    outcome: 'ok', timings: { dnsMs: 10, tcpMs: 20, tlsMs: 40, ttfbMs: 80, totalMs: 100 },
  });
  expect(req.destroy).toHaveBeenCalledTimes(1);
  expect(res.destroy).toHaveBeenCalledTimes(1);
  req.end = () => {};
  const failure = transport({ requestError: true });
  const result = await probe(target, config, failure);
  expect(result).toMatchObject({ failurePhase: 'tcp', errorCode: 'OTHER', httpReachable: false,
    timings: { tcpMs: null, tlsMs: null, ttfbMs: null } });
});

test('DNS and body deadlines retain precise partial observations and dispose resources', async () => {
  jest.useFakeTimers();
  try {
    const deps = transport({ stalled: true });
    deps.resolver.resolve4.mockReturnValue(new Promise(() => {}));
    let pending = probe(probeTargets(config)[0], config, deps);
    await jest.advanceTimersByTimeAsync(config.timeoutMs);
    expect(await pending).toMatchObject({ failurePhase: 'dns', errorCode: 'DEADLINE_EXCEEDED', timings: { dnsMs: null } });
    let response;
    let req;
    const request = (_url, _options, callback) => {
      req = new EventEmitter(); req.destroy = jest.fn();
      req.end = () => {
        response = new EventEmitter(); response.statusCode = 200; response.destroy = jest.fn(); callback(response);
      };
      return req;
    };
    pending = probe(probeTargets(config)[1], config, { ...transport(), request });
    await jest.advanceTimersByTimeAsync(config.timeoutMs);
    expect(await pending).toMatchObject({ outcome: 'timeout', failurePhase: 'body', httpReachable: true, statusCode: 200 });
    expect(req.destroy).toHaveBeenCalledTimes(1);
    expect(response.destroy).toHaveBeenCalledTimes(1);
    response.emit('end');
    expect(req.destroy).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

test.each(['http://example.com', 'https://user:secret@example.com', 'https://example.com:8080', 'invalid'])('rejects invalid outbound URL %s before DNS', async (url) => {
  const deps = transport();
  expect(await probe({ name: 'internet', url, status: 200 }, config, deps)).toMatchObject({ outcome: 'unsafe_address' });
  expect(deps.resolver.resolve4).not.toHaveBeenCalled();
  expect(deps.request).not.toHaveBeenCalled();
});


test('TLS failure reports safe code and completed TCP only; aborted body keeps HTTP reachability', async () => {
  const resolver = { resolve4: async () => ['8.8.8.8'], cancel: jest.fn() };
  let req;
  const request = (_url, _options, callback) => {
    req = new EventEmitter(); req.destroy = jest.fn();
    req.end = () => {
      const socket = new EventEmitter(); req.emit('socket', socket); socket.emit('connect');
      req.emit('error', Object.assign(new Error('sensitive cert detail'), { code: 'CERT_HAS_EXPIRED' }));
    };
    return req;
  };
  const result = await probe(probeTargets(config)[0], config, { request, resolver });
  expect(result).toMatchObject({ outcome: 'connection_error', failurePhase: 'tls', errorCode: 'CERT_HAS_EXPIRED',
    timings: { tcpMs: expect.any(Number), tlsMs: null, ttfbMs: null } });
  expect(JSON.stringify(result)).not.toContain('sensitive');
  const aborted = (_url, _options, callback) => {
    req = new EventEmitter(); req.destroy = jest.fn();
    req.end = () => {
      const res = new EventEmitter(); res.statusCode = 200; res.destroy = jest.fn();
      callback(res); res.emit('aborted');
    };
    return req;
  };
  expect(await probe(probeTargets(config)[1], config, { request: aborted, resolver })).toMatchObject({
    outcome: 'connection_error', failurePhase: 'body', httpReachable: true, errorCode: 'RESPONSE_ABORTED',
  });
});
