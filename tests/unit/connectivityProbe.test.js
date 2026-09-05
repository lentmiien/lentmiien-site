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
  expect(probeTargets(config)[1]).toMatchObject({ name: 'cloudflare', head: true });
});
