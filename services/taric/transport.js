const https = require('https');
const tls = require('tls');
const http = require('http');
const zlib = require('zlib');
const { Transform, Writable, pipeline } = require('stream');
const { TaricError, fail, gcode, object } = require('../../utils/taricContracts');
const { strictJson, payload, output, hash } = require('../../utils/taricProtocol');
const { normalizeDetail } = require('../amiamiScraperService');

function boundedJson(url, { method = 'GET', body, headers = {}, deadlineMs = 15000, maxBytes = 262144,
  maxWireBytes = maxBytes, signal, correlationId, onDiagnostic, successStatuses = [200], tlsOptions = {},
  request = url.protocol === 'https:' ? https.request : http.request } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let settled = false; let req; let response; let decoder; let timer;
    let dispatched = false; let terminal = false; let wireSize = 0; let size = 0; let phase = 'connect';
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      onDiagnostic?.(require('../../utils/taricDiagnostics').errorStatus({ phase: error?.transport?.phase || 'http',
        dispatched, terminal, status: response?.statusCode, wireBytes: wireSize, decodedBytes: size,
        durationMs: Date.now() - started, correlationId }));
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) { response?.destroy(); decoder?.destroy(); req?.destroy(); reject(error); } else resolve(value);
    };
    const rejectSafe = (where, cause) => {
      if (settled) return;
      const error = new TaricError('PROVIDER_FAILED');
      error.transport = require('../../utils/taricDiagnostics').errorStatus({ phase: where,
        dispatched, terminal, status: response?.statusCode, socketCode: cause?.code,
        wireBytes: wireSize, decodedBytes: size, durationMs: Date.now() - started, correlationId });
      finish(error);
    };
    const abort = () => rejectSafe('clientabort');
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    const serialized = body === undefined ? null : JSON.stringify(body);
    if (serialized && Buffer.byteLength(serialized) > 16384) return rejectSafe('limit');
    timer = setTimeout(() => rejectSafe('timeout'), deadlineMs);
    try {
      req = request(url, { ...tlsOptions, method, headers: { Accept: 'application/json', 'Accept-Encoding': 'identity',
        ...(serialized ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(serialized) } : {}), ...headers } }, res => {
        response = res; phase = 'http';
        if (settled) { res.destroy(); return; }
        // A received HTTP status is a confirmed response, not a lost generation reply.
        terminal = res.statusCode !== 200;
        if (!successStatuses.includes(res.statusCode)) return rejectSafe('http');
        if (!/^application\/json(?:\s*;|$)/i.test(res.headers['content-type'] || '')) return rejectSafe('envelope');
        const encoding = (res.headers['content-encoding'] || 'identity').trim().toLowerCase();
        if (!['identity', 'gzip', 'deflate', 'br'].includes(encoding)) return rejectSafe('decode');
        if (res.headers['content-length'] && (!/^\d+$/.test(res.headers['content-length']) || Number(res.headers['content-length']) > maxWireBytes)) return rejectSafe('limit');
        const chunks = [];
        const wireLimit = new Transform({ transform(chunk, _encoding, next) {
          wireSize += chunk.length;
          if (wireSize > maxWireBytes) { phase = 'limit'; return next(new Error('Limit')); }
          next(null, chunk);
        } });
        decoder = encoding === 'gzip' ? zlib.createGunzip() : encoding === 'deflate' ? zlib.createInflate()
          : encoding === 'br' ? zlib.createBrotliDecompress() : new Transform({ transform(chunk, _encoding, next) { next(null, chunk); } });
        phase = 'decode';
        const sink = new Writable({ write(chunk, _encoding, next) {
          size += chunk.length;
          if (size > maxBytes) { phase = 'limit'; return next(new Error('Limit')); }
          chunks.push(chunk); next();
        } });
        pipeline(res, wireLimit, decoder, sink, error => {
          if (settled) return;
          if (error) {
            // A truncated response may have lost the remote completion; malformed
            // fully received invalid JSON is terminal; early stream failures stay uncertain.
            if (!res.complete && error.code === 'ERR_STREAM_PREMATURE_CLOSE') terminal = false;
            return rejectSafe(phase, error);
          }
          terminal = true;
          let text;
          try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
          catch (error) { return rejectSafe('decode', error); }
          try { finish(null, strictJson(text, 'PROVIDER_FAILED')); }
          catch (error) { rejectSafe('json', error); }
        });
      });
      req.on('socket', socket => {
        const connected = () => { dispatched = true; phase = 'http'; };
        if (socket.connecting) {
          socket.once('lookup', error => { phase = error ? 'dns' : 'connect'; });
          socket.once(url.protocol === 'https:' ? 'secureConnect' : 'connect', connected);
          if (url.protocol === 'https:') socket.once('connect', () => { phase = 'tls'; });
        } else if (!socket.encrypted || socket.authorized) connected();
      });
      req.on('finish', () => { dispatched = true; });
      req.on('error', cause => {
        const where = ['ENOTFOUND', 'EAI_AGAIN'].includes(cause.code) ? 'dns'
          : /TLS|CERT|VERIFY/.test(cause.code || '') ? 'tls' : phase;
        rejectSafe(where, cause);
      });
      req.end(serialized || undefined);
    } catch (cause) { rejectSafe(phase, cause); }
  });
}
function createTransport({ json = boundedJson, env = process.env, impersonated = require('./amiamiBounded').fetchImpersonated } = {}) {
  // Gateway configuration is immutable for this client, including owned cleanup.
  env = { ...env };
  function gatewayOrigin() {
    let origin;
    try { origin = new URL(env.TARIC_GATEWAY_ORIGIN); } catch (_) { fail('CONFIG_NOT_READY'); }
    const allowed = (env.TARIC_GATEWAY_ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
    if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash || !allowed.includes(origin.origin)) fail('CONFIG_NOT_READY');
    return origin;
  }
  const gateway = (path, options = {}) => {
    const url = new URL(path, gatewayOrigin());
    return json(url, { deadlineMs: 5000, ...options, headers: { ...options.headers,
      ...(env.TARIC_GATEWAY_TOKEN ? { Authorization: `Bearer ${env.TARIC_GATEWAY_TOKEN}` } : {}),
      ...(env.TARIC_GATEWAY_ADMIN_TOKEN ? { 'X-Admin-Token': env.TARIC_GATEWAY_ADMIN_TOKEN } : {}),
    } });
  };
  const sessionAdapter = require('./gatewaySessions').createGatewaySessions(gateway, {
    capabilities: require('./gatewayCapabilities').createGatewayCapabilities(gateway, { fingerprint: () => hash({
      origin: env.TARIC_GATEWAY_ORIGIN, allowlist: env.TARIC_GATEWAY_ALLOWED_ORIGINS,
      proxy: env.TARIC_GATEWAY_TOKEN, admin: env.TARIC_GATEWAY_ADMIN_TOKEN,
    }) }),
  });
  async function adapters() {
    const raw = await gateway('/qwen3-lora/adapters');
    const list = Array.isArray(raw) ? raw : raw?.adapters;
    if (!Array.isArray(list) || list.length > 500) fail('PROVIDER_FAILED');
    return list.map(a => ({ name: a.adapter_name || a.name || a.metadata?.adapter_name,
      artifactSha256: a.metadata?.artifact_sha256 || null })).filter(a =>
      typeof a.name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(a.name));
  }
  async function verifyIdentity(adapter, expected) {
    // Never interpret an arbitrary user-entered hash as observation of the runtime.
    // The fixed trusted gateway must expose these exact immutable metadata fields.
    const model = await gateway('/qwen3-lora/model');
    const known = await adapters();
    const active = known.find(a => a.name === adapter);
    if (!expected || model.deployment_revision !== expected.deploymentRevision
      || model.model_revision !== expected.baseRevision || model.tokenizer_revision !== expected.tokenizerRevision
      || active?.artifactSha256 !== expected.adapterSha256) fail('RELEASE_CLOSED');
  }
  async function generate(row, adapter, codes, maxTokens, identity, options = {}) {
    const body = payload(row, adapter, maxTokens);
    if (identity) await verifyIdentity(adapter, identity);
    let envelope;
    try { envelope = await gateway('/qwen3-lora/generate', { method: 'POST', body, deadlineMs: 60000, maxBytes: 16384, signal: options.signal, correlationId: options.correlationId }); }
    catch (cause) {
      const status = require('../../utils/taricDiagnostics').errorStatus(cause.transport);
      const error = new TaricError(status && (!status.dispatched || status.terminal) ? 'PROVIDER_FAILED' : 'INFERENCE_UNCERTAIN');
      error.transport = status;
      throw error;
    }
    if (!require('../../utils/taricProtocol').validEnvelope(envelope, adapter)) {
      try { output({ content: envelope?.content, tool_calls: ['invalid envelope'] }, codes, options.onDiagnostics); }
      catch (error) { error.transport = { phase: 'envelope', dispatched: true, terminal: true }; throw error; }
    }
    const result = output(envelope, codes, options.onDiagnostics);
    if (identity) await verifyIdentity(adapter, identity);
    return result;
  }
  async function fetchFactual(code) {
    gcode(code);
    const url = new URL('https://api.amiami.com/api/v1.0/item');
    url.searchParams.set('gcode', code); url.searchParams.set('lang', 'eng');
    let data;
    try {
      // Per-request trust only for this fixed origin. Never relax hostname/chain checks
      // or mutate Node's global CA set (especially the private Gateway transport).
      const ca = [...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])];
      const mode = env.TARIC_AMIAMI_TRANSPORT || 'curl';
      if (!['curl', 'native'].includes(mode)) fail('CONFIG_NOT_READY');
      data = mode === 'curl' ? await impersonated(code) : await json(url, { deadlineMs: 15000, maxBytes: 262144, tlsOptions: { ca, rejectUnauthorized: true }, headers: {
        Accept: 'application/json,text/plain,*/*',
        'X-User-Key': 'amiami_dev', 'Accept-Language': 'en-US,en;q=0.9',
        Referer: `https://www.amiami.com/eng/detail?gcode=${code}`,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      } });
    } catch (cause) {
      const status = require('../../utils/taricDiagnostics').errorStatus(cause.transport);
      const code = ['TLS_CHAIN_UNTRUSTED', 'FETCH_DISABLED'].includes(cause.code) ? cause.code : status?.status === 403 ? 'HTTP_ACCESS_DENIED'
        : status?.phase === 'tls' && ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(status.socketCode) ? 'TLS_CHAIN_UNTRUSTED' : 'FETCH_FAILED';
      const error = new TaricError(code); error.transport = status; throw error;
    }
    try {
      if (data?.RSuccess !== true || !data.item || data.item.gcode !== code) fail('IDENTITY_MISMATCH');
      object(data.item, Object.keys(data.item), 'EVIDENCE_INVALID');
      // Pure shared normalization. Native buffering is capped before body exposure.
      return normalizeDetail(data, { includeRaw: false });
    } catch (error) {
      const safe = error instanceof TaricError ? error : new TaricError('EVIDENCE_INVALID');
      safe.transport = { phase: 'envelope', dispatched: true, terminal: true };
      throw safe;
    }
  }
  return { adapters, verifyIdentity, generate, fetchFactual, sessionAdapter, fingerprint: () => hash({ origin: env.TARIC_GATEWAY_ORIGIN || null, allowlist: env.TARIC_GATEWAY_ALLOWED_ORIGINS || null }), configured: () => { gatewayOrigin(); return true; } };
}
module.exports = { boundedJson, createTransport };
