const https = require('https');
const http = require('http');
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

const SAFE_CODES = new Set(['ENOTFOUND', 'ENODATA', 'EAI_AGAIN', 'ETIMEOUT', 'ETIMEDOUT',
  'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ECANCELLED',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_SSL_WRONG_VERSION_NUMBER', 'HPE_HEADER_OVERFLOW']);
function safeErrorCode(error) {
  return SAFE_CODES.has(error?.code) ? error.code : 'OTHER';
}

function probeTargets(config) {
  return [
    { name: 'internet', url: 'https://www.google.com/generate_204', status: 204 },
    { name: 'cloudflare', url: 'https://www.cloudflare.com/cdn-cgi/trace', status: 200, trace: true },
    ...(config.publicOrigin ? [{
      name: 'publicApp', url: `${config.publicOrigin}/apphealth`, status: 200, appHealth: true,
    }] : []),
  ];
}

// All phase values are monotonic elapsed milestones from request start, not additive durations.
// Null means unobserved (or inapplicable), never zero. No addresses or body data leave this function.
function httpProbe(target, config, { request, resolver, now = () => performance.now(), local = false }) {
  const started = now();
  const timings = { dnsMs: null, tcpMs: null, tlsMs: null, ttfbMs: null, totalMs: null };
  const elapsed = () => Math.max(0, Math.round((now() - started) * 100) / 100);
  return new Promise((resolve) => {
    let req;
    let response;
    let finished = false;
    let phase = local ? 'tcp' : 'dns';
    let statusCode = null;
    const finish = (outcome, errorCode = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolver?.cancel();
      response?.destroy();
      req?.destroy();
      timings.totalMs = elapsed();
      resolve({ name: target.name, outcome, statusCode, latencyMs: timings.totalMs,
        httpReachable: statusCode !== null, slow: timings.totalMs >= config.slowMs,
        degraded: outcome !== 'ok' || timings.totalMs >= config.slowMs,
        timings, failurePhase: outcome === 'ok' ? null : phase, errorCode });
    };
    const timer = setTimeout(() => finish('timeout', 'DEADLINE_EXCEEDED'), config.timeoutMs);
    const connect = (url, addresses) => {
      if (finished) return;
      phase = 'tcp';
      try {
        req = request(url, {
          method: 'GET', agent: false, maxHeaderSize: 8192, rejectUnauthorized: true,
          ...(local ? {} : { lookup: (_host, options, callback) => callback(null,
            options.all ? [{ address: addresses[0], family: 4 }] : addresses[0], 4) }),
          headers: { 'Cache-Control': 'no-cache, no-store', 'Accept-Encoding': 'identity' },
        }, (res) => {
          response = res;
          if (finished) { res.destroy(); return; }
          statusCode = res.statusCode;
          timings.ttfbMs = elapsed();
          phase = 'headers';
          if (res.statusCode !== target.status) return finish('http_status');
          phase = 'body';
          let size = 0;
          const chunks = [];
          res.on('data', (chunk) => {
            if (finished) return;
            size += chunk.length;
            if (size > 4096) return finish('oversized', 'BODY_LIMIT');
            if (target.appHealth || target.trace) chunks.push(chunk);
          });
          res.on('error', (error) => finish('connection_error', safeErrorCode(error)));
          res.on('aborted', () => finish('connection_error', 'RESPONSE_ABORTED'));
          res.on('end', () => {
            if (finished) return;
            phase = 'contract';
            if (target.appHealth) {
              try {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (body?.status !== 'ok' || body?.database !== 'ready') return finish('unexpected_response');
              } catch { return finish('unexpected_response'); }
            }
            if (target.trace) {
              const body = Buffer.concat(chunks).toString('utf8');
              if (!/^h=www\.cloudflare\.com\r?$/m.test(body) || !/^colo=[A-Z]{3}\r?$/m.test(body)) {
                return finish('unexpected_response');
              }
            }
            finish('ok');
          });
        });
        req.on('socket', (socket) => {
          socket.once('connect', () => {
            if (finished) return;
            timings.tcpMs = elapsed();
            phase = local ? 'headers' : 'tls';
          });
          socket.once('secureConnect', () => {
            if (finished) return;
            timings.tlsMs = elapsed();
            phase = 'headers';
          });
        });
        req.on('error', (error) => finish('connection_error', safeErrorCode(error)));
        req.end();
      } catch (error) { finish('connection_error', safeErrorCode(error)); }
    };
    try {
      const url = new URL(target.url);
      if (!local && (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)) {
        return finish('unsafe_address', 'INVALID_TARGET');
      }
      if (target.appHealth) url.searchParams.set('connectivity', randomUUID());
      if (local) connect(url);
      else resolver.resolve4(url.hostname).then((addresses) => {
        if (finished) return;
        timings.dnsMs = elapsed();
        if (!addresses.length || addresses.some((address) => !isPublicIPv4(address))) return finish('unsafe_address');
        connect(url, addresses);
      }).catch((error) => finish('dns_error', safeErrorCode(error)));
    } catch { finish('unsafe_address', 'INVALID_TARGET'); }
  });
}

function probe(target, config, { request = https.request, resolver = new Resolver(), now } = {}) {
  return httpProbe(target, config, { request, resolver, now });
}

// Only the actual listener port is injected by app.js. No request input, arbitrary URL or auth bypass.
function probeLocalHealth(port, config, { request = http.request, now } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.resolve({ name: 'localHealth', outcome: 'unavailable', degraded: true, errorCode: 'NO_LISTENER' });
  }
  return httpProbe({ name: 'localHealth', url: `http://127.0.0.1:${port}/apphealth`, status: 200, appHealth: true },
    { ...config, timeoutMs: Math.min(config.timeoutMs, 2000) }, { request, now, local: true });
}

module.exports = { probe, probeTargets, probeLocalHealth, isPublicIPv4, safeErrorCode };
