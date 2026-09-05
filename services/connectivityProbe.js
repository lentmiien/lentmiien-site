const https = require('https');
const { Resolver } = require('dns').promises;
const { BlockList, isIP } = require('net');
const { performance } = require('perf_hooks');
const { randomUUID } = require('crypto');

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 3],
]) blocked.addSubnet(address, prefix);

function isPublicIPv4(address) {
  return isIP(address) === 4 && !blocked.check(address);
}

function probeTargets(config) {
  return [
    { name: 'internet', url: 'https://www.google.com/generate_204', status: 204 },
    { name: 'cloudflare', url: 'https://www.cloudflare.com/cdn-cgi/trace', status: 200, head: true },
    ...(config.publicOrigin ? [{
      name: 'publicApp', url: `${config.publicOrigin}/apphealth`, status: 200, appHealth: true,
    }] : []),
  ];
}

// One absolute deadline includes cancellable DNS, TCP/TLS, headers and the small body.
// Resolve once and pin that public IPv4 address to prevent DNS rebinding.
function probe(target, config, { request = https.request, resolver = new Resolver(), now = () => performance.now() } = {}) {
  const started = now();
  return new Promise((resolve) => {
    let req;
    let response;
    let finished = false;
    const finish = (outcome, statusCode = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolver.cancel();
      response?.destroy();
      req?.destroy();
      const latencyMs = Math.max(0, Math.round(now() - started));
      resolve({ name: target.name, outcome, statusCode, latencyMs,
        degraded: outcome !== 'ok' || latencyMs >= config.slowMs });
    };
    const timer = setTimeout(() => finish('timeout'), config.timeoutMs);
    const url = new URL(target.url);
    if (target.appHealth) url.searchParams.set('connectivity', randomUUID());
    resolver.resolve4(url.hostname).then((addresses) => {
      if (finished) return;
      if (!addresses.length || addresses.some((address) => !isPublicIPv4(address))) return finish('unsafe_address');
      req = request(url, {
        method: target.head ? 'HEAD' : 'GET', agent: false, maxHeaderSize: 8192,
        lookup: (_host, options, callback) => callback(null,
          options.all ? [{ address: addresses[0], family: 4 }] : addresses[0], 4),
        headers: { 'Cache-Control': 'no-cache, no-store', 'Accept-Encoding': 'identity' },
      }, (res) => {
        response = res;
        if (res.statusCode !== target.status) return finish('http_status', res.statusCode);
        let size = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 4096) return finish('oversized', res.statusCode);
          if (target.appHealth) chunks.push(chunk);
        });
        res.on('error', () => finish('connection_error'));
        res.on('aborted', () => finish('connection_error'));
        res.on('end', () => {
          if (target.appHealth) {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              if (body.status !== 'ok' || body.database !== 'ready') return finish('unexpected_response', res.statusCode);
            } catch { return finish('unexpected_response', res.statusCode); }
          }
          finish('ok', res.statusCode);
        });
      });
      req.on('error', () => finish('connection_error'));
      req.end();
    }).catch(() => finish('dns_error'));
  });
}

module.exports = { probe, probeTargets, isPublicIPv4 };
